import { Prisma } from "@prisma/client";
import { db, type TxClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  applyVeto,
  availableMaps,
  createVeto,
  isVetoComplete,
  nextStep,
  resolveStage,
  validateScore,
  vetoResult,
  type SlotSource,
  type StageSettings,
  type Team,
  type VetoState,
} from "@/engine";
import { getGame } from "@/games";
import { audit } from "./audit";
import { notify } from "./notifications";
import { assertTournamentAccess, requireActor } from "./permissions";
import { rateLimit } from "./rate-limit";
import { forfeitScore, loadStage, syncStage } from "./stage-runner";
import type { Actor } from "./types";

type MatchFull = Prisma.MatchGetPayload<{ include: { stage: { include: { tournament: true } }; participantA: true; participantB: true } }>;

async function loadMatch(tx: TxClient | typeof db, id: string): Promise<MatchFull> {
  const m = await tx.match.findUnique({ where: { id }, include: { stage: { include: { tournament: true } }, participantA: true, participantB: true } });
  if (!m) throw new AppError("Partida não encontrada.", "NOT_FOUND");
  return m;
}

function allowDraw(settings: StageSettings): boolean {
  return (settings.type === "ROUND_ROBIN" || settings.type === "SWISS") && settings.allowDraw;
}

function checkScore(match: MatchFull, scoreA: number, scoreB: number) {
  const settings = match.stage.settings as unknown as StageSettings;
  const res = validateScore(match.bestOf, scoreA, scoreB, { allowDraw: allowDraw(settings) });
  if (!res.ok) throw new AppError(res.error);
  return res.winner;
}

/** Chaves das partidas que dependem (direta ou indiretamente) do resultado da partida `key`. */
function descendants(specs: Array<{ key: string; a: SlotSource; b: SlotSource }>, key: string): Set<string> {
  const out = new Set<string>();
  const queue = [key];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const s of specs) {
      const refs = [s.a, s.b].some((src) => "match" in src && src.match === cur);
      if (refs && !out.has(s.key)) {
        out.add(s.key);
        queue.push(s.key);
      }
    }
  }
  return out;
}

async function assertEditable(tx: TxClient, match: MatchFull) {
  const t = match.stage.tournament;
  if (t.status !== "LIVE") throw new AppError(t.status === "COMPLETED" ? "O campeonato já foi encerrado." : "O campeonato não está em andamento.");
  if (match.stage.status === "PENDING") throw new AppError("Esta fase ainda não começou.");
  const ctx = await loadStage(tx, match.stageId);
  const type = ctx.settings.type;
  if (type === "SWISS") {
    const later = ctx.matches.filter((m) => m.round > match.round);
    if (later.some((m) => ["COMPLETED", "REPORTED", "DISPUTED"].includes(m.status) && m.status !== "BYE")) {
      throw new AppError("As rodadas seguintes já têm resultados. Reverta-os antes de alterar esta partida.");
    }
    // rodadas seguintes sem resultado serão regeneradas
    if (later.length) await tx.match.deleteMany({ where: { stageId: match.stageId, round: { gt: match.round } } });
  } else if (type !== "ROUND_ROBIN") {
    const resolved = resolveStage(ctx.input);
    for (const k of descendants(ctx.input.specs.map((s) => ({ key: s.key, a: s.a, b: s.b })), match.key)) {
      if (resolved.get(k)?.status === "completed") throw new AppError("As partidas seguintes já foram jogadas. Reverta-as antes de alterar esta.");
    }
  } else {
    const next = await tx.stage.findFirst({ where: { tournamentId: match.stage.tournamentId, order: match.stage.order + 1 } });
    if (next && next.status !== "PENDING") throw new AppError("A próxima fase já começou; não é possível alterar este resultado.");
  }
  const nextStage = await tx.stage.findFirst({ where: { tournamentId: match.stage.tournamentId, order: match.stage.order + 1 } });
  if (nextStage && nextStage.status !== "PENDING") throw new AppError("A próxima fase já começou; não é possível alterar este resultado.");
}

async function writeResult(tx: TxClient, match: MatchFull, scoreA: number, scoreB: number, opts: { forfeit?: "a" | "b" | null; note?: string } = {}) {
  const winner = checkScore(match, scoreA, scoreB);
  await tx.match.update({
    where: { id: match.id },
    data: {
      scoreA,
      scoreB,
      winnerSide: winner ?? "draw",
      forfeit: opts.forfeit ?? null,
      status: "COMPLETED",
      completedAt: new Date(),
      ...(opts.note !== undefined ? { notes: opts.note } : {}),
    },
  });
  await tx.matchDispute.updateMany({ where: { matchId: match.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date(), resolution: opts.note ?? "Resolvida pelo resultado final." } });
  await syncStage(tx, match.stageId);
}

const TX = { timeout: 30000 };

/** Relato de placar feito por um dos lados (capitão). Dois relatos iguais fecham a partida; divergentes abrem disputa. */
export async function reportMatch(actorIn: Actor | null, matchId: string, scoreA: number, scoreB: number): Promise<"reported" | "completed" | "disputed"> {
  const actor = requireActor(actorIn);
  await rateLimit(`report:${actor.id}`, 40, 3600, "Muitos relatos de placar seguidos. Aguarde um pouco.");
  return db.$transaction(async (tx) => {
    const m = await loadMatch(tx, matchId);
    const t = m.stage.tournament;
    if (t.status !== "LIVE") throw new AppError("O campeonato não está em andamento.");
    if (!["READY", "REPORTED", "DISPUTED"].includes(m.status)) throw new AppError("Esta partida não está aberta para relato de placar.");
    if (!t.allowPlayerReporting) throw new AppError("Neste campeonato apenas a organização lança resultados.", "FORBIDDEN");
    const side: "a" | "b" | null = m.participantA?.userId === actor.id ? "a" : m.participantB?.userId === actor.id ? "b" : null;
    if (!side) throw new AppError("Só os capitães dos dois lados podem relatar o placar.", "FORBIDDEN");
    checkScore(m, scoreA, scoreB);

    const mine = { scoreA, scoreB, byUserId: actor.id, at: new Date().toISOString() };
    const other = (side === "a" ? m.reportB : m.reportA) as { scoreA: number; scoreB: number } | null;
    const data: Prisma.MatchUpdateInput = side === "a" ? { reportA: mine } : { reportB: mine };

    if (!other) {
      await tx.match.update({ where: { id: m.id }, data: { ...data, status: "REPORTED" } });
      const opp = side === "a" ? m.participantB : m.participantA;
      // repetir o mesmo placar não avisa o adversário de novo (senão dá para inundá-lo de notificações)
      const prev = (side === "a" ? m.reportA : m.reportB) as { scoreA: number; scoreB: number } | null;
      const repeated = !!prev && prev.scoreA === scoreA && prev.scoreB === scoreB;
      if (opp && !repeated) await notify(opp.userId, "match.reported", "Confirme o placar", `${side === "a" ? m.participantA?.name : m.participantB?.name} reportou ${scoreA} × ${scoreB}. Confirme ou conteste.`, `/partidas/${m.id}`, tx);
      return "reported" as const;
    }
    if (other.scoreA === scoreA && other.scoreB === scoreB) {
      await tx.match.update({ where: { id: m.id }, data });
      const fresh = await loadMatch(tx, matchId);
      await writeResult(tx, fresh, scoreA, scoreB);
      return "completed" as const;
    }
    await tx.match.update({ where: { id: m.id }, data: { ...data, status: "DISPUTED" } });
    const open = await tx.matchDispute.findFirst({ where: { matchId: m.id, status: "OPEN" } });
    if (!open) {
      await tx.matchDispute.create({ data: { matchId: m.id, openedById: actor.id, reason: "Relatos de placar divergentes." } });
      const staff = await tx.orgMember.findMany({ where: { orgId: t.orgId }, select: { userId: true } });
      await notify(staff.map((s) => s.userId), "match.disputed", "Partida em disputa", `${t.name}: ${m.participantA?.name} × ${m.participantB?.name}`, `/organizar/${t.id}/partidas`, tx);
    }
    return "disputed" as const;
  }, TX);
}

/** Contestação explícita com motivo (o lado discorda do placar reportado pelo adversário). */
export async function openDispute(actorIn: Actor | null, matchId: string, reason: string) {
  const actor = requireActor(actorIn);
  const m = await loadMatch(db, matchId);
  const mine = m.participantA?.userId === actor.id || m.participantB?.userId === actor.id;
  if (!mine) throw new AppError("Só os participantes da partida podem abrir disputa.", "FORBIDDEN");
  if (!["REPORTED", "READY", "DISPUTED"].includes(m.status)) throw new AppError("Esta partida não permite disputa agora.");
  if (m.stage.tournament.status !== "LIVE") throw new AppError("O campeonato não está em andamento.");
  const text = reason.trim();
  if (text.length < 5) throw new AppError("Descreva o motivo da disputa (mínimo de 5 caracteres).");
  if (text.length > 600) throw new AppError("O motivo pode ter até 600 caracteres. Se precisar de mais, anexe um link.");
  await rateLimit(`dispute:${actor.id}`, 10, 3600, "Muitas disputas seguidas. Aguarde um pouco.");
  await db.$transaction(async (tx) => {
    await tx.match.update({ where: { id: m.id }, data: { status: "DISPUTED" } });
    const open = await tx.matchDispute.findFirst({ where: { matchId: m.id, status: "OPEN" } });
    if (open) {
      // Mensagens extras entram no mesmo registro, com teto total (o texto não pode crescer sem limite) e sem novo aviso à organização.
      const joined = `${open.reason}\n${text}`;
      if (joined.length > 4000) throw new AppError("Esta disputa já tem muitas mensagens. Aguarde a decisão da organização.");
      await tx.matchDispute.update({ where: { id: open.id }, data: { reason: joined } });
      return;
    }
    await tx.matchDispute.create({ data: { matchId: m.id, openedById: actor.id, reason: text } });
    const t = m.stage.tournament;
    const staff = await tx.orgMember.findMany({ where: { orgId: t.orgId }, select: { userId: true } });
    await notify(staff.map((s) => s.userId), "match.disputed", "Partida em disputa", `${t.name}: ${m.participantA?.name} × ${m.participantB?.name}`, `/organizar/${t.id}/partidas`, tx);
  });
}

/** A organização define o resultado final (resolve disputas e permite correções). */
export async function setMatchResult(actorIn: Actor | null, matchId: string, scoreA: number, scoreB: number, note?: string) {
  const actor = requireActor(actorIn);
  if ((note ?? "").length > 500) throw new AppError("A observação pode ter até 500 caracteres.");
  await db.$transaction(async (tx) => {
    const m = await loadMatch(tx, matchId);
    await assertTournamentAccess(actor, m.stage.tournament, "staff", tx);
    if (!m.participantAId || !m.participantBId) throw new AppError("A partida ainda não tem os dois participantes.");
    if (m.status === "COMPLETED") await assertEditable(tx, m);
    else if (!["READY", "REPORTED", "DISPUTED"].includes(m.status)) throw new AppError("Esta partida ainda não pode receber resultado.");
    else if (m.stage.tournament.status !== "LIVE") throw new AppError("O campeonato não está em andamento.");
    await writeResult(tx, m, scoreA, scoreB, { note: note?.trim() || undefined });
    await audit(actor.id, "match.set_result", "Match", m.id, { scoreA, scoreB, note }, tx);
  }, TX);
}

export async function forfeitMatch(actorIn: Actor | null, matchId: string, loserSide: "a" | "b", reason: string) {
  const actor = requireActor(actorIn);
  await db.$transaction(async (tx) => {
    const m = await loadMatch(tx, matchId);
    await assertTournamentAccess(actor, m.stage.tournament, "staff", tx);
    if (!m.participantAId || !m.participantBId) throw new AppError("A partida ainda não tem os dois participantes.");
    if (m.status === "COMPLETED") await assertEditable(tx, m);
    else if (!["READY", "REPORTED", "DISPUTED"].includes(m.status)) throw new AppError("Esta partida ainda não pode receber resultado.");
    if (reason.trim().length < 3) throw new AppError("Informe o motivo do W.O.");
    if (reason.length > 500) throw new AppError("O motivo pode ter até 500 caracteres.");
    const sc = forfeitScore(m.bestOf, loserSide === "a" ? "b" : "a");
    await writeResult(tx, m, sc.scoreA, sc.scoreB, { forfeit: loserSide, note: `W.O.: ${reason.trim()}` });
    await audit(actor.id, "match.forfeit", "Match", m.id, { loserSide, reason }, tx);
  }, TX);
}

/** Desfaz o resultado de uma partida (somente se as partidas seguintes não foram jogadas). */
export async function resetMatch(actorIn: Actor | null, matchId: string) {
  const actor = requireActor(actorIn);
  await db.$transaction(async (tx) => {
    const m = await loadMatch(tx, matchId);
    await assertTournamentAccess(actor, m.stage.tournament, "staff", tx);
    if (!["COMPLETED", "REPORTED", "DISPUTED"].includes(m.status)) throw new AppError("Esta partida não tem resultado para desfazer.");
    if (m.status === "COMPLETED") await assertEditable(tx, m);
    await tx.match.update({
      where: { id: m.id },
      data: { status: "READY", scoreA: null, scoreB: null, winnerSide: null, forfeit: null, reportA: Prisma.DbNull, reportB: Prisma.DbNull, completedAt: null },
    });
    await tx.matchDispute.updateMany({ where: { matchId: m.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date(), resolution: "Resultado desfeito pela organização." } });
    await syncStage(tx, m.stageId);
    await audit(actor.id, "match.reset", "Match", m.id, {}, tx);
  }, TX);
}

export async function scheduleMatch(actorIn: Actor | null, matchId: string, at: Date | null) {
  const actor = requireActor(actorIn);
  const m = await loadMatch(db, matchId);
  await assertTournamentAccess(actor, m.stage.tournament, "staff");
  await db.match.update({ where: { id: m.id }, data: { scheduledAt: at } });
  for (const p of [m.participantA, m.participantB]) {
    if (p && at) await notify(p.userId, "match.scheduled", "Partida agendada", `${m.stage.tournament.name}: ${m.participantA?.name} × ${m.participantB?.name}`, `/partidas/${m.id}`);
  }
}

// ───────────────────────── Veto de mapas ─────────────────────────

function poolFor(m: MatchFull): string[] {
  const custom = m.stage.tournament.mapPool as unknown as string[] | null;
  if (custom?.length) return custom;
  return getGame(m.stage.tournament.gameId)?.mapPool?.maps ?? [];
}

export function vetoAvailable(m: { bestOf: number; stage: { tournament: { gameId: string; mapPool: unknown } } }): boolean {
  const game = getGame(m.stage.tournament.gameId);
  if (!game?.vetoSupported) return false;
  const pool = (m.stage.tournament.mapPool as string[] | null)?.length ? (m.stage.tournament.mapPool as string[]) : (game.mapPool?.maps ?? []);
  return pool.length >= m.bestOf + 2 && [1, 3, 5].includes(m.bestOf);
}

export async function vetoAction(actorIn: Actor | null, matchId: string, map: string): Promise<VetoState> {
  const actor = requireActor(actorIn);
  return db.$transaction(async (tx) => {
    const m = await loadMatch(tx, matchId);
    if (!["READY", "REPORTED"].includes(m.status)) throw new AppError("O veto só pode ser feito em partidas liberadas.");
    if (!vetoAvailable(m)) throw new AppError("Esta partida não usa veto de mapas.");
    const team: Team | null = m.participantA?.userId === actor.id ? "a" : m.participantB?.userId === actor.id ? "b" : null;
    if (!team) throw new AppError("Só os capitães da partida participam do veto.", "FORBIDDEN");
    const state = (m.vetoState as unknown as VetoState | null) ?? createVeto(poolFor(m), m.bestOf, "a");
    let next: VetoState;
    try {
      next = applyVeto(state, team, map);
    } catch (e) {
      throw new AppError(e instanceof Error ? e.message : "Ação inválida no veto.");
    }
    const data: Prisma.MatchUpdateInput = { vetoState: next as unknown as Prisma.InputJsonValue };
    if (isVetoComplete(next)) data.games = vetoResult(next) as unknown as Prisma.InputJsonValue;
    await tx.match.update({ where: { id: m.id }, data });
    const upcoming = nextStep(next);
    const other = team === "a" ? m.participantB : m.participantA;
    if (upcoming && other && upcoming.team !== team) await notify(other.userId, "match.veto", "Sua vez no veto", `${m.stage.tournament.name}: escolha um mapa.`, `/partidas/${m.id}`, tx);
    return next;
  });
}

export function currentVeto(m: MatchFull | { bestOf: number; vetoState: unknown; stage: { tournament: { mapPool: unknown; gameId: string } } }): VetoState | null {
  if (!vetoAvailable(m as never)) return null;
  const existing = m.vetoState as unknown as VetoState | null;
  if (existing) return existing;
  const pool = ((m.stage.tournament.mapPool as string[] | null)?.length ? (m.stage.tournament.mapPool as string[]) : (getGame(m.stage.tournament.gameId)?.mapPool?.maps ?? [])) as string[];
  return createVeto(pool, m.bestOf, "a");
}

export { availableMaps, nextStep };
