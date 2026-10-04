import { Prisma, type Participant, type Tournament } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { checkInWindow, refundsOnWithdrawal, registrationWindow } from "@/lib/phases";
import { audit } from "./audit";
import { notify } from "./notifications";
import {
  activeCount,
  autoRefundOnWithdrawal,
  createRegistrationOrder,
  expireStaleReservations,
  findValidCoupon,
  promoteWaitlist,
  releaseParticipant,
} from "./orders";
import { assertTournamentAccess, requireActor, requireVerified } from "./permissions";
import { syncStage } from "./stage-runner";
import type { Actor, CustomField, RosterMember } from "./types";

export interface RegisterInput {
  tournamentId: string;
  teamId?: string;
  starterIds?: string[];
  subIds?: string[];
  customAnswers?: Record<string, string>;
  couponCode?: string;
  acceptRules: boolean;
}

export interface RegisterResult {
  participantId: string;
  status: "REGISTERED" | "PENDING_PAYMENT" | "WAITLIST";
  orderId?: string;
}

export function validateCustomAnswers(fields: CustomField[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const raw = (answers[f.key] ?? "").toString().trim();
    if (f.type === "checkbox") {
      const checked = raw === "on" || raw === "true" || raw === "1";
      if (f.required && !checked) throw new AppError(`Você precisa marcar: ${f.label}.`);
      out[f.key] = checked ? "true" : "false";
      continue;
    }
    if (!raw) {
      if (f.required) throw new AppError(`Preencha o campo: ${f.label}.`);
      continue;
    }
    if (raw.length > 300) throw new AppError(`${f.label} é muito longo.`);
    if (f.type === "select" && !f.options?.includes(raw)) throw new AppError(`Valor inválido em ${f.label}.`);
    out[f.key] = raw;
  }
  return out;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retriable = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2034" || e.code === "P2028");
      if (!retriable || i >= attempts - 1) throw e;
    }
  }
}

export async function registerForTournament(actorIn: Actor | null, input: RegisterInput): Promise<RegisterResult> {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  if (!input.acceptRules) throw new AppError("Você precisa aceitar o regulamento para se inscrever.");

  return withRetry(() =>
    db.$transaction(
      async (tx) => {
        const now = new Date();
        const t = await tx.tournament.findUnique({ where: { id: input.tournamentId } });
        if (!t) throw new AppError("Campeonato não encontrado.", "NOT_FOUND");
        await expireStaleReservations(tx, t.id, now);

        const window = registrationWindow(t, now);
        if (window === "not_open") throw new AppError("As inscrições ainda não abriram.");
        if (window === "closed") throw new AppError("As inscrições deste campeonato estão encerradas.");

        const me = await tx.user.findUnique({ where: { id: actor.id } });
        if (!me || me.bannedAt) throw new AppError("Sua conta não pode se inscrever.", "FORBIDDEN");

        const existing = await tx.participant.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: actor.id } } });
        if (existing && existing.status !== "WITHDRAWN") throw new AppError("Você já está inscrito neste campeonato.", "CONFLICT");
        if (existing) await releaseParticipant(tx, existing.id);

        const { roster, name, tag, teamId } = await buildRoster(tx, t, actor, input);

        const fields = (t.customFields as unknown as CustomField[] | null) ?? [];
        const answers = validateCustomAnswers(fields, input.customAnswers ?? {});

        const taken = await activeCount(tx, t.id, now);
        const full = taken >= t.maxParticipants;
        const coupon = !full && input.couponCode?.trim() && t.entryFeeCents > 0 ? await findValidCoupon(tx, input.couponCode, t, now) : null;
        if (input.couponCode?.trim() && t.entryFeeCents === 0) throw new AppError("Este campeonato é gratuito; não é preciso cupom.");

        const status: Participant["status"] = full ? "WAITLIST" : t.entryFeeCents > 0 ? "PENDING_PAYMENT" : "REGISTERED";
        const participant = await tx.participant
          .create({
            data: {
              tournamentId: t.id,
              userId: actor.id,
              teamId,
              name,
              tag,
              status,
              roster: roster as unknown as Prisma.InputJsonValue,
              customAnswers: answers as unknown as Prisma.InputJsonValue,
              reservedUntil: status === "PENDING_PAYMENT" ? new Date(now.getTime() + 30 * 60_000) : null,
              rosterEntries: { create: roster.map((r) => ({ tournamentId: t.id, userId: r.userId, role: r.role })) },
            },
          })
          .catch((e: unknown) => {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
              throw new AppError("Um dos jogadores do elenco já está inscrito neste campeonato em outra inscrição.", "CONFLICT");
            }
            throw e;
          });

        if (status === "PENDING_PAYMENT") {
          const order = await createRegistrationOrder(tx, { userId: actor.id, tournament: t, participantId: participant.id, coupon, now });
          if (order && order.status === "PAID") {
            await tx.participant.update({ where: { id: participant.id }, data: { status: "REGISTERED", reservedUntil: null } });
            return { participantId: participant.id, status: "REGISTERED" as const, orderId: order.id };
          }
          if (order) {
            await tx.participant.update({ where: { id: participant.id }, data: { reservedUntil: order.expiresAt } });
            return { participantId: participant.id, status: "PENDING_PAYMENT" as const, orderId: order.id };
          }
        }
        await audit(actor.id, "participant.register", "Tournament", t.id, { participantId: participant.id, status }, tx);
        return { participantId: participant.id, status: status as RegisterResult["status"] };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 },
    ),
  );
}

async function buildRoster(tx: Tx, t: Tournament, actor: Actor, input: RegisterInput) {
  const solo = t.teamSize === 1;
  let starterIds: string[];
  let subIds: string[] = [];
  let teamId: string | null = null;
  let name: string;
  let tag: string | null = null;

  if (solo) {
    starterIds = [actor.id];
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    name = user.displayName;
  } else {
    if (!input.teamId) throw new AppError("Selecione o time que vai participar.");
    const team = await tx.team.findUnique({ where: { id: input.teamId }, include: { members: true } });
    if (!team) throw new AppError("Time não encontrado.", "NOT_FOUND");
    const me = team.members.find((m) => m.userId === actor.id);
    if (!me || (me.role !== "CAPTAIN" && actor.role !== "ADMIN")) throw new AppError("Só o capitão do time pode inscrevê-lo.", "FORBIDDEN");
    teamId = team.id;
    name = team.name;
    tag = team.tag;
    starterIds = [...new Set(input.starterIds ?? [])];
    subIds = [...new Set(input.subIds ?? [])].filter((id) => !starterIds.includes(id));
    if (starterIds.length !== t.teamSize) throw new AppError(`Selecione exatamente ${t.teamSize} titulares.`);
    if (subIds.length > t.maxSubs) throw new AppError(`Este campeonato permite no máximo ${t.maxSubs} reserva(s).`);
    if (![...starterIds, ...subIds].includes(actor.id)) throw new AppError("O capitão precisa estar no elenco (titular ou reserva).");
    const memberIds = new Set(team.members.map((m) => m.userId));
    for (const id of [...starterIds, ...subIds]) if (!memberIds.has(id)) throw new AppError("Todos os jogadores do elenco precisam ser membros do time.");
  }

  const allIds = [...starterIds, ...subIds];
  const users = await tx.user.findMany({ where: { id: { in: allIds } }, include: { gameAccounts: { where: { gameId: t.gameId } } } });
  const roster: RosterMember[] = [];
  for (const id of allIds) {
    const u = users.find((x) => x.id === id);
    if (!u) throw new AppError("Jogador não encontrado.", "NOT_FOUND");
    if (u.bannedAt) throw new AppError(`${u.displayName} está suspenso e não pode participar.`, "FORBIDDEN");
    const acc = u.gameAccounts[0];
    if (!acc) throw new AppError(`${u.displayName} ainda não vinculou a conta do jogo. Cadastre em Minha conta → Contas de jogo.`);
    const identity = acc.data as unknown as Record<string, string>;
    if (t.platform && identity.platform && t.platform !== "Todas" && identity.platform !== t.platform) {
      throw new AppError(`${u.displayName} joga em ${identity.platform}, mas este campeonato é para ${t.platform}.`);
    }
    roster.push({ userId: u.id, displayName: u.displayName, handle: acc.handle, role: starterIds.includes(id) ? "starter" : "sub", identity });
  }
  return { roster, name, tag, teamId };
}

export async function withdrawRegistration(actorIn: Actor | null, participantId: string): Promise<void> {
  const actor = requireActor(actorIn);
  const p = await db.participant.findUnique({ where: { id: participantId }, include: { tournament: true, orders: true } });
  if (!p) throw new AppError("Inscrição não encontrada.", "NOT_FOUND");
  const mine = p.userId === actor.id;
  if (!mine) await assertTournamentAccess(actor, p.tournament, "staff");
  if (!["DRAFT", "REGISTRATION", "CHECK_IN"].includes(p.tournament.status)) {
    throw new AppError("O campeonato já começou. Peça à organização para desclassificar a inscrição.");
  }
  const refundable = !mine || refundsOnWithdrawal(p.tournament);
  const paid = p.orders.find((o) => o.status === "PAID" || o.status === "PARTIALLY_REFUNDED");
  await db.$transaction(async (tx) => {
    for (const o of p.orders.filter((x) => x.status === "PENDING")) {
      await tx.order.update({ where: { id: o.id }, data: { status: "CANCELED" } });
      if (o.couponId) await tx.coupon.update({ where: { id: o.couponId }, data: { redeemed: { decrement: 1 } } }).catch(() => undefined);
    }
    await releaseParticipant(tx, p.id);
    await promoteWaitlist(tx, p.tournamentId);
    await audit(actor.id, mine ? "participant.withdraw" : "participant.remove", "Tournament", p.tournamentId, { participantId: p.id }, tx);
  });
  if (paid && refundable) await autoRefundOnWithdrawal(paid.id);
  if (!mine) await notify(p.userId, "participant.removed", "Inscrição removida", `A organização removeu sua inscrição em ${p.tournament.name}.`, `/torneios/${p.tournament.slug}`);
}

export async function checkIn(actorIn: Actor | null, participantId: string): Promise<void> {
  const actor = requireActor(actorIn);
  const p = await db.participant.findUnique({ where: { id: participantId }, include: { tournament: true } });
  if (!p) throw new AppError("Inscrição não encontrada.", "NOT_FOUND");
  const staff = p.userId !== actor.id;
  if (staff) await assertTournamentAccess(actor, p.tournament, "staff");
  if (!staff) {
    const w = checkInWindow(p.tournament);
    if (w === "not_open") throw new AppError("O check-in ainda não abriu.");
    if (w === "closed") throw new AppError("O check-in já foi encerrado.");
  }
  if (p.status === "CHECKED_IN") return;
  if (p.status !== "REGISTERED") throw new AppError("Só inscrições confirmadas podem fazer check-in.");
  await db.participant.update({ where: { id: p.id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
}

export async function undoCheckIn(actorIn: Actor | null, participantId: string): Promise<void> {
  const actor = requireActor(actorIn);
  const p = await db.participant.findUnique({ where: { id: participantId }, include: { tournament: true } });
  if (!p) throw new AppError("Inscrição não encontrada.", "NOT_FOUND");
  if (p.userId !== actor.id) await assertTournamentAccess(actor, p.tournament, "staff");
  if (!["REGISTRATION", "CHECK_IN"].includes(p.tournament.status)) throw new AppError("O campeonato já começou.");
  if (p.status === "CHECKED_IN") await db.participant.update({ where: { id: p.id }, data: { status: "REGISTERED", checkedInAt: null } });
}

// ───────────────────────── Operações da organização ─────────────────────────

export async function setParticipantSeed(actorIn: Actor | null, participantId: string, seed: number | null, rating?: number | null): Promise<void> {
  const actor = requireActor(actorIn);
  const p = await db.participant.findUnique({ where: { id: participantId }, include: { tournament: true } });
  if (!p) throw new AppError("Inscrição não encontrada.", "NOT_FOUND");
  await assertTournamentAccess(actor, p.tournament, "staff");
  if (p.tournament.status === "LIVE" || p.tournament.status === "COMPLETED") throw new AppError("O campeonato já começou; o seed não pode mais ser alterado.");
  if (seed !== null && (!Number.isInteger(seed) || seed < 1 || seed > 1024)) throw new AppError("Seed inválido.");
  await db.participant.update({ where: { id: p.id }, data: { seed, ...(rating !== undefined ? { rating } : {}) } });
}

/** Desclassifica uma inscrição. Em campeonato em andamento, as partidas pendentes viram W.O. para os adversários. */
export async function disqualifyParticipant(actorIn: Actor | null, participantId: string, reason: string): Promise<void> {
  const actor = requireActor(actorIn);
  const p = await db.participant.findUnique({ where: { id: participantId }, include: { tournament: { include: { stages: true } } } });
  if (!p) throw new AppError("Inscrição não encontrada.", "NOT_FOUND");
  await assertTournamentAccess(actor, p.tournament, "staff");
  if (reason.trim().length < 3) throw new AppError("Informe o motivo da desclassificação.");
  if (p.status === "DISQUALIFIED") return;
  await db.$transaction(
    async (tx) => {
      await tx.participant.update({ where: { id: p.id }, data: { status: "DISQUALIFIED", dqReason: reason.trim() } });
      if (p.tournament.status === "LIVE") {
        for (const stage of p.tournament.stages.filter((s) => s.status === "LIVE")) await syncStage(tx, stage.id);
      }
      await audit(actor.id, "participant.dq", "Tournament", p.tournamentId, { participantId: p.id, reason }, tx);
      await notify(p.userId, "participant.dq", "Inscrição desclassificada", `${p.tournament.name}: ${reason.trim()}`, `/torneios/${p.tournament.slug}`, tx);
    },
    { timeout: 30000 },
  );
}

export async function listParticipants(tournamentId: string) {
  return db.participant.findMany({ where: { tournamentId }, orderBy: [{ seed: "asc" }, { registeredAt: "asc" }], include: { user: { select: { id: true, username: true, displayName: true } } } });
}
