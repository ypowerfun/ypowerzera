"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { bool, guard, int, str, type FormState } from "@/lib/action-helpers";
import { parseLocalDateTime } from "@/lib/dates";
import { parseMoneyToCents } from "@/lib/money";
import { slugify } from "@/lib/slug";
import { parseStageSettings } from "@/lib/stage-form";
import { db } from "@/lib/db";
import { getPreset, getGame } from "@/games";
import type { StageSettings } from "@/engine";
import { AppError } from "@/lib/errors";
import {
  applySeeding,
  cancelTournament,
  createTournament,
  deleteDraft,
  openCheckIn,
  publishTournament,
  startNextStage,
  startTournament,
  updateTournament,
  type CreateTournamentInput,
  type UpdateTournamentInput,
} from "@/server/tournaments";
import { checkIn, disqualifyParticipant, setParticipantSeed, undoCheckIn, withdrawRegistration } from "@/server/registration";
import { forfeitMatch, resetMatch, scheduleMatch, setMatchResult } from "@/server/matches";
import { setBrGameCode, submitBrResults } from "@/server/leaderboard";
import { createCoupon, refundOrder } from "@/server/orders";
import { markPrizePaid } from "@/server/organizer";
import { addOrgMember, deleteOrganization, updateOrganization } from "@/server/orgs";
import { requireUser, toActor } from "@/server/session";

function dateField(fd: FormData, k: string): Date | null {
  return parseLocalDateTime(str(fd, k));
}

function moneyField(fd: FormData, k: string): number {
  const v = str(fd, k);
  if (!v) return 0;
  const c = parseMoneyToCents(v);
  if (c === null) throw new AppError("Valor em reais inválido (use, por exemplo, 25,00).");
  return c;
}

function customFields(fd: FormData) {
  const out = [];
  for (let i = 1; i <= 4; i++) {
    const label = str(fd, `cf${i}_label`);
    if (!label) continue;
    const type = (["text", "select", "checkbox"] as const).find((t) => t === str(fd, `cf${i}_type`)) ?? "text";
    const key = slugify(label).replace(/-/g, "_").slice(0, 30) || `campo_${i}`;
    out.push({
      key: key.length < 2 ? `campo_${i}` : key,
      label,
      type,
      required: bool(fd, `cf${i}_required`),
      private: bool(fd, `cf${i}_private`),
      options: type === "select" ? str(fd, `cf${i}_options`).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    });
  }
  return out;
}

export async function createTournamentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/organizar/novo");
  const res = await guard(async () => {
    const startsAt = dateField(fd, "startsAt");
    if (!startsAt) throw new AppError("Informe a data e hora de início.");
    const pool = moneyField(fd, "prizePool");
    const split = [1, 2, 3].map((p) => ({ placement: p, label: ["Campeão", "Vice-campeão", "3º lugar"][p - 1], percent: Number(str(fd, `split${p}`) || 0) })).filter((s) => s.percent > 0);
    const mapPool = str(fd, "mapPool").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const input: CreateTournamentInput = {
      orgId: str(fd, "orgId"),
      gameId: str(fd, "gameId"),
      modeId: str(fd, "modeId"),
      presetId: str(fd, "presetId"),
      name: str(fd, "name"),
      summary: str(fd, "summary") || undefined,
      description: str(fd, "description") || undefined,
      region: str(fd, "region") || undefined,
      platform: str(fd, "platform") || undefined,
      startsAt,
      registrationOpensAt: dateField(fd, "registrationOpensAt"),
      registrationClosesAt: dateField(fd, "registrationClosesAt"),
      checkInOpensAt: dateField(fd, "checkInOpensAt"),
      checkInClosesAt: dateField(fd, "checkInClosesAt"),
      maxParticipants: int(fd, "maxParticipants"),
      minParticipants: Number.isFinite(int(fd, "minParticipants")) ? int(fd, "minParticipants") : undefined,
      entryFeeCents: moneyField(fd, "entryFee"),
      prizePoolCents: pool,
      prizeSplit: pool > 0 && split.length ? split : undefined,
      allowPlayerReporting: bool(fd, "allowPlayerReporting"),
      requireCheckIn: bool(fd, "requireCheckIn"),
      seedingMethod: (["MANUAL", "RANDOM", "RATING"] as const).find((s) => s === str(fd, "seedingMethod")) ?? "RANDOM",
      customFields: customFields(fd),
      mapPool: mapPool.length ? mapPool : undefined,
      visibility: str(fd, "visibility") === "UNLISTED" ? "UNLISTED" : "PUBLIC",
      streamUrl: str(fd, "streamUrl"),
      discordUrl: str(fd, "discordUrl"),
    };
    if (!Number.isFinite(input.maxParticipants)) throw new AppError("Informe o número de vagas.");
    return createTournament(toActor(user), input);
  });
  if (!res.ok) return { error: res.error };
  redirect(`/organizar/${res.value.id}?criado=1`);
}

/** Atalho para ações do ciclo de vida: executa e recarrega a página. */
function lifecycle(run: (actor: ReturnType<typeof toActor>, id: string, fd: FormData) => Promise<unknown>, ok: string) {
  return async (_: FormState, fd: FormData): Promise<FormState> => {
    const user = await requireUser();
    const id = str(fd, "tournamentId");
    const res = await guard(() => run(toActor(user), id, fd));
    if (!res.ok) return { error: res.error };
    revalidatePath(`/organizar/${id}`, "layout");
    revalidatePath("/torneios", "layout");
    return { success: ok };
  };
}

export const publishAction = lifecycle((a, id) => publishTournament(a, id), "Campeonato publicado! As inscrições estão abertas.");
export const openCheckInAction = lifecycle((a, id) => openCheckIn(a, id), "Check-in aberto. Os inscritos foram avisados.");
export const startAction = lifecycle((a, id) => startTournament(a, id), "Campeonato iniciado! As chaves foram geradas.");
export const nextStageAction = lifecycle((a, id) => startNextStage(a, id), "Próxima fase iniciada.");
export const seedingAction = lifecycle((a, id) => applySeeding(a, id), "Seeds aplicados conforme o método do campeonato.");
export const cancelTournamentAction = lifecycle(async (a, id, fd) => {
  const r = await cancelTournament(a, id, str(fd, "reason"));
  if (r.refundFailures.length) throw new AppError(`Cancelado, mas alguns reembolsos falharam: ${r.refundFailures.join("; ")}`);
}, "Campeonato cancelado e inscrições reembolsadas.");

export async function deleteDraftAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => deleteDraft(toActor(user), str(fd, "tournamentId")));
  if (!res.ok) return { error: res.error };
  redirect("/organizar");
}

export async function updateTournamentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "tournamentId");
  const res = await guard(async () => {
    const patch: UpdateTournamentInput = {
      name: str(fd, "name"),
      summary: str(fd, "summary"),
      description: str(fd, "description"),
      rules: str(fd, "rules"),
      region: str(fd, "region"),
      platform: str(fd, "platform"),
      streamUrl: str(fd, "streamUrl"),
      discordUrl: str(fd, "discordUrl"),
      visibility: str(fd, "visibility") === "UNLISTED" ? "UNLISTED" : "PUBLIC",
      allowPlayerReporting: bool(fd, "allowPlayerReporting"),
    };
    const startsAt = dateField(fd, "startsAt");
    if (startsAt) patch.startsAt = startsAt;
    for (const k of ["registrationOpensAt", "registrationClosesAt", "checkInOpensAt", "checkInClosesAt"] as const) if (fd.has(k)) patch[k] = dateField(fd, k);
    if (fd.has("maxParticipants") && Number.isFinite(int(fd, "maxParticipants"))) patch.maxParticipants = int(fd, "maxParticipants");
    if (fd.has("minParticipants") && Number.isFinite(int(fd, "minParticipants"))) patch.minParticipants = int(fd, "minParticipants");
    if (fd.has("prizePool")) patch.prizePoolCents = moneyField(fd, "prizePool");
    if (fd.has("entryFee")) patch.entryFeeCents = moneyField(fd, "entryFee");
    const pools = str(fd, "mapPool").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (fd.has("mapPool") && pools.length) patch.mapPool = pools;
    const t = await db.tournament.findUnique({ where: { id }, select: { startedAt: true, status: true } });
    if (t?.startedAt || t?.status === "LIVE") {
      delete patch.maxParticipants;
      delete patch.minParticipants;
      delete patch.entryFeeCents;
    }
    return updateTournament(toActor(user), id, patch);
  });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/organizar/${id}`, "layout");
  return { success: "Configurações salvas." };
}

export async function updateStagesAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "tournamentId");
  const res = await guard(async () => {
    const t = await db.tournament.findUnique({ where: { id }, include: { stages: { orderBy: { order: "asc" } } } });
    if (!t) throw new AppError("Campeonato não encontrado.", "NOT_FOUND");
    const stages = t.stages.map((s) => {
      const prefix = `s${s.order}_`;
      const prev = s.settings as unknown as StageSettings;
      return { name: str(fd, `${prefix}name`) || s.name, settings: parseStageSettings(prev, (k) => String(fd.get(prefix + k) ?? "")) };
    });
    return updateTournament(toActor(user), id, { stages });
  });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/organizar/${id}`, "layout");
  return { success: "Fases atualizadas." };
}

// ───────────── participantes ─────────────

function simple(run: (actor: ReturnType<typeof toActor>, fd: FormData) => Promise<unknown>, ok: string, path?: (fd: FormData) => string) {
  return async (_: FormState, fd: FormData): Promise<FormState> => {
    const user = await requireUser();
    const res = await guard(() => run(toActor(user), fd));
    if (!res.ok) return { error: res.error };
    revalidatePath(path ? path(fd) : "/organizar", "layout");
    return { success: ok };
  };
}

const tPath = (fd: FormData) => `/organizar/${str(fd, "tournamentId")}`;
export const setSeedAction = simple((a, fd) => setParticipantSeed(a, str(fd, "participantId"), str(fd, "seed") ? int(fd, "seed") : null, str(fd, "rating") ? int(fd, "rating") : undefined), "Seed salvo.", tPath);
export const removeParticipantAction = simple((a, fd) => withdrawRegistration(a, str(fd, "participantId")), "Inscrição removida (reembolso automático quando aplicável).", tPath);
export const dqAction = simple((a, fd) => disqualifyParticipant(a, str(fd, "participantId"), str(fd, "reason")), "Inscrição desclassificada.", tPath);
export const staffCheckInAction = simple((a, fd) => (str(fd, "undo") ? undoCheckIn(a, str(fd, "participantId")) : checkIn(a, str(fd, "participantId"))), "Check-in atualizado.", tPath);

// ───────────── partidas ─────────────

export const setResultAction = simple((a, fd) => setMatchResult(a, str(fd, "matchId"), int(fd, "scoreA"), int(fd, "scoreB"), str(fd, "note")), "Resultado lançado.", tPath);
export const forfeitAction = simple((a, fd) => forfeitMatch(a, str(fd, "matchId"), str(fd, "loser") === "b" ? "b" : "a", str(fd, "reason")), "W.O. registrado.", tPath);
export const resetMatchAction = simple((a, fd) => resetMatch(a, str(fd, "matchId")), "Resultado desfeito.", tPath);
export const scheduleAction = simple((a, fd) => scheduleMatch(a, str(fd, "matchId"), dateField(fd, "at")), "Horário salvo.", tPath);

export async function brResultsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const gameId = str(fd, "brGameId");
  const rows: Array<{ participantId: string; placement: number; kills: number }> = [];
  for (const pid of fd.getAll("pid").map(String)) {
    const placement = str(fd, `place_${pid}`);
    if (!placement) continue;
    rows.push({ participantId: pid, placement: Number(placement), kills: Number(str(fd, `kills_${pid}`) || 0) });
  }
  const res = await guard(async () => {
    const code = str(fd, "code");
    if (code) await setBrGameCode(toActor(user), gameId, code);
    await submitBrResults(toActor(user), gameId, rows, { fillMissing: bool(fd, "fillMissing"), code: code || undefined });
  });
  if (!res.ok) return { error: res.error };
  revalidatePath(tPath(fd), "layout");
  return { success: "Resultados lançados. A classificação foi atualizada." };
}

// ───────────── financeiro ─────────────

export const createCouponAction = simple(
  (a, fd) => {
    const pct = int(fd, "percent");
    const amount = str(fd, "amount") ? parseMoneyToCents(str(fd, "amount")) : null;
    return createCoupon(a, {
      orgId: str(fd, "orgId"),
      tournamentId: str(fd, "tournamentId"),
      code: str(fd, "code"),
      percentOff: Number.isFinite(pct) && pct > 0 ? pct : undefined,
      amountOffCents: amount ?? undefined,
      maxRedemptions: Number.isFinite(int(fd, "max")) && int(fd, "max") > 0 ? int(fd, "max") : undefined,
    });
  },
  "Cupom criado.",
  tPath,
);
export const refundAction = simple((a, fd) => refundOrder(a, str(fd, "orderId"), { reason: str(fd, "reason") }), "Reembolso realizado.", tPath);
export const prizePaidAction = simple((a, fd) => markPrizePaid(a, str(fd, "awardId"), str(fd, "note")), "Premiação marcada como paga.", tPath);
export const updateOrgAction = simple((a, fd) => updateOrganization(a, str(fd, "orgId"), { name: str(fd, "name"), description: str(fd, "description") || undefined }), "Organização atualizada.", () => "/organizar");

/** Exclui a organização (só digitando o nome exato) e volta ao painel com a confirmação. */
export async function deleteOrgAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/organizar");
  const res = await guard(() => deleteOrganization(toActor(user), str(fd, "orgId"), { confirmName: str(fd, "confirmName") }));
  if (!res.ok) return { error: res.error };
  revalidatePath("/organizar", "layout");
  redirect("/organizar?ok=org-excluida");
}

export const addOrgMemberAction = simple((a, fd) => addOrgMember(a, str(fd, "orgId"), str(fd, "username"), str(fd, "role") === "ADMIN" ? "ADMIN" : "STAFF"), "Membro adicionado à organização.", () => "/organizar");

export async function gameHint(gameId: string, presetId: string) {
  return { game: getGame(gameId)?.name, preset: getPreset(gameId, presetId)?.name };
}
