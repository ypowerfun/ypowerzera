import { Prisma, type Challenge } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { getGame } from "@/games";
import { audit } from "./audit";
import { requireKyc } from "./kyc";
import { moneyConfig, isWholeCredits } from "./money-config";
import { notify } from "./notifications";
import { requireActor, requireVerified } from "./permissions";
import { rateLimit } from "./rate-limit";
import { requireTeamLeader } from "./team-auth";
import { getOrCreateTeamWallet, getPlatformWallet, postLedger } from "./wallet";
import type { Actor } from "./types";
import { getEnv } from "@/lib/env";

export interface LineupMember {
  userId: string;
  displayName: string;
  handle: string;
}

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 } as const;

/** Taxa da plataforma sobre o pote (2 × stake). Limitada a 50% da stake para nunca superar o prêmio. */
export function challengeFee(stakeCents: number, feeBps: number): number {
  return Math.min(Math.floor((stakeCents * 2 * feeBps) / 10_000), Math.floor(stakeCents / 2));
}

async function buildLineup(teamId: string, userIds: string[], gameId: string, teamSize: number): Promise<LineupMember[]> {
  const ids = [...new Set(userIds)];
  if (ids.length !== teamSize) throw new AppError(`Escale exatamente ${teamSize} jogador(es) para este modo.`);
  const members = await db.teamMember.findMany({ where: { teamId, userId: { in: ids } }, include: { user: { include: { gameAccounts: { where: { gameId } } } } } });
  if (members.length !== ids.length) throw new AppError("Todos os escalados precisam ser membros da equipe.");
  return members.map((m) => {
    if (m.user.bannedAt) throw new AppError(`${m.user.displayName} está suspenso e não pode jogar.`, "FORBIDDEN");
    const acc = m.user.gameAccounts[0];
    if (!acc) throw new AppError(`${m.user.displayName} ainda não vinculou a conta do jogo em Minha conta → Contas de jogo.`);
    return { userId: m.userId, displayName: m.user.displayName, handle: acc.handle };
  });
}

async function assertTeamEligible(team: { id: string; createdAt: Date }) {
  const cfg = moneyConfig();
  if (Date.now() - team.createdAt.getTime() < cfg.teamMinAgeHours * 3600_000) {
    throw new AppError(`Equipes novas só podem disputar desafios valendo créditos após ${cfg.teamMinAgeHours} horas da criação.`, "FORBIDDEN");
  }
}

async function sessionIps(userIds: string[], days = 7): Promise<Set<string>> {
  const rows = await db.session.findMany({ where: { userId: { in: userIds }, createdAt: { gte: new Date(Date.now() - days * 86400_000) }, ip: { not: null } }, select: { ip: true } });
  return new Set(rows.map((r) => r.ip!).filter((ip) => ip && ip !== "unknown"));
}

export async function expireOpenChallenges(now = new Date()): Promise<number> {
  const stale = await db.challenge.findMany({ where: { status: "OPEN", expiresAt: { lt: now } }, select: { id: true } });
  let n = 0;
  for (const c of stale) if (await cancelOpen(c.id, "EXPIRED", "Desafio expirado sem adversário.")) n++;
  return n;
}

async function cancelOpen(id: string, to: "CANCELED" | "EXPIRED", memo: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const res = await tx.challenge.updateMany({ where: { id, status: "OPEN" }, data: { status: to } });
    if (res.count === 0) return false;
    const c = await tx.challenge.findUniqueOrThrow({ where: { id } });
    const w = await getOrCreateTeamWallet(tx, c.creatorTeamId);
    await postLedger(tx, { walletId: w.id, type: "STAKE_REFUND", available: c.stakeCents, locked: -c.stakeCents, refType: "challenge", refId: id, key: `ch-refund:${id}:creator`, memo, allowFrozen: true });
    return true;
  });
}

/**
 * Cria um desafio. A stake do criador é BLOQUEADA na hora (escrow): o desafio aberto já está 100% garantido.
 */
export async function createChallenge(
  actorIn: Actor | null,
  input: { teamId: string; gameId: string; modeId: string; bestOf: number; stakeCents: number; lineupUserIds: string[]; invitedTeamId?: string; notes?: string; expiresInHours?: number },
): Promise<Challenge> {
  if (!getEnv().walletEnabled) throw new AppError("Os desafios estão desativados.", "FORBIDDEN");
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const cfg = moneyConfig();
  const game = getGame(input.gameId);
  if (!game) throw new AppError("Jogo inválido.");
  const mode = game.modes.find((m) => m.id === input.modeId);
  if (!mode) throw new AppError("Modo inválido para este jogo.");
  if (mode.teamSize > 5) throw new AppError("Este modo não está disponível para desafios.");
  if (![1, 3, 5].includes(input.bestOf)) throw new AppError("Escolha melhor de 1, 3 ou 5.");
  if (!isWholeCredits(input.stakeCents)) throw new AppError("A aposta deve ser em créditos inteiros (1 crédito = R$ 1,00).");
  if (input.stakeCents < cfg.stakeMinCents || input.stakeCents > cfg.stakeMaxCents) {
    throw new AppError(`A aposta deve ficar entre ${formatMoney(cfg.stakeMinCents)} e ${formatMoney(cfg.stakeMaxCents)}.`);
  }
  const team = await requireTeamLeader(actor, input.teamId);
  await requireKyc(actor.id, "verified");
  await assertTeamEligible(team);
  if (input.invitedTeamId === team.id) throw new AppError("Você não pode desafiar a própria equipe.");
  if (input.invitedTeamId && !(await db.team.findUnique({ where: { id: input.invitedTeamId } }))) throw new AppError("Equipe convidada não encontrada.", "NOT_FOUND");
  await rateLimit(`challenge:create:${actor.id}`, 20, 3600, "Muitos desafios criados. Aguarde um pouco.");
  const lineup = await buildLineup(team.id, input.lineupUserIds, input.gameId, mode.teamSize);
  const hours = Math.min(Math.max(input.expiresInHours ?? cfg.challengeOpenTtlHours, 1), 72);

  return db.$transaction(async (tx) => {
    const open = await tx.challenge.count({ where: { creatorTeamId: team.id, status: "OPEN" } });
    if (open >= cfg.maxOpenChallengesPerTeam) throw new AppError(`Sua equipe já tem ${open} desafios abertos. Cancele algum antes de criar outro.`);
    const c = await tx.challenge.create({
      data: {
        gameId: input.gameId,
        modeId: input.modeId,
        bestOf: input.bestOf,
        stakeCents: input.stakeCents,
        feeBps: cfg.challengeFeeBps,
        creatorTeamId: team.id,
        creatorUserId: actor.id,
        invitedTeamId: input.invitedTeamId ?? null,
        creatorLineup: lineup as unknown as Prisma.InputJsonValue,
        notes: input.notes?.trim().slice(0, 300) || null,
        expiresAt: new Date(Date.now() + hours * 3600_000),
      },
    });
    const wallet = await getOrCreateTeamWallet(tx, team.id);
    await postLedger(tx, { walletId: wallet.id, type: "STAKE_LOCK", available: -input.stakeCents, locked: input.stakeCents, refType: "challenge", refId: c.id, key: `ch-lock:${c.id}:creator`, memo: "Aposta bloqueada (desafio criado)", actorId: actor.id });
    await audit(actor.id, "challenge.create", "Challenge", c.id, { stakeCents: c.stakeCents, teamId: team.id }, tx);
    if (c.invitedTeamId) {
      const invited = await tx.team.findUniqueOrThrow({ where: { id: c.invitedTeamId } });
      await notify(invited.ownerId, "challenge.invited", "Você foi desafiado!", `${team.name} desafiou sua equipe por ${formatMoney(c.stakeCents)}.`, `/desafios/${c.id}`, tx);
    }
    return c;
  }, SERIALIZABLE);
}

/** Aceita um desafio aberto. A transição OPEN→ACCEPTED é atômica: só UM adversário consegue. */
export async function acceptChallenge(actorIn: Actor | null, challengeId: string, input: { teamId: string; lineupUserIds: string[] }): Promise<Challenge> {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const cfg = moneyConfig();
  const before = await db.challenge.findUnique({ where: { id: challengeId } });
  if (!before) throw new AppError("Desafio não encontrado.", "NOT_FOUND");
  const game = getGame(before.gameId)!;
  const mode = game.modes.find((m) => m.id === before.modeId)!;
  const team = await requireTeamLeader(actor, input.teamId);
  await requireKyc(actor.id, "verified");
  await assertTeamEligible(team);
  if (team.id === before.creatorTeamId) throw new AppError("Você não pode aceitar o desafio da própria equipe.");
  if (before.invitedTeamId && before.invitedTeamId !== team.id) throw new AppError("Este desafio é um convite direto para outra equipe.", "FORBIDDEN");
  await rateLimit(`challenge:accept:${actor.id}`, 30, 3600, "Muitas tentativas. Aguarde um pouco.");

  // anti-conluio: equipes com integrantes em comum não se enfrentam
  const [creatorTeam, myMembers] = await Promise.all([
    db.team.findUniqueOrThrow({ where: { id: before.creatorTeamId }, include: { members: true } }),
    db.teamMember.findMany({ where: { teamId: team.id } }),
  ]);
  const creatorIds = new Set(creatorTeam.members.map((m) => m.userId));
  if (myMembers.some((m) => creatorIds.has(m.userId))) throw new AppError("Equipes com integrantes em comum não podem se enfrentar.", "FORBIDDEN");

  const lineup = await buildLineup(team.id, input.lineupUserIds, before.gameId, mode.teamSize);
  const creatorLineup = before.creatorLineup as unknown as LineupMember[];

  const flags: string[] = [];
  const [ipsA, ipsB] = await Promise.all([sessionIps(creatorLineup.map((l) => l.userId).concat(creatorTeam.ownerId)), sessionIps(lineup.map((l) => l.userId).concat(actor.id))]);
  if ([...ipsA].some((ip) => ipsB.has(ip))) flags.push("SAME_IP");
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const repeats = await db.challenge.count({
    where: {
      status: "SETTLED",
      settledAt: { gte: weekAgo },
      OR: [
        { creatorTeamId: before.creatorTeamId, opponentTeamId: team.id },
        { creatorTeamId: team.id, opponentTeamId: before.creatorTeamId },
      ],
    },
  });
  if (repeats + 1 >= cfg.repeatedPairThreshold) flags.push("REPEATED_PAIR");

  const accepted = await db.$transaction(async (tx) => {
    const res = await tx.challenge.updateMany({
      where: { id: challengeId, status: "OPEN", expiresAt: { gt: new Date() }, creatorTeamId: { not: team.id } },
      data: { status: "ACCEPTED", opponentTeamId: team.id, opponentUserId: actor.id, opponentLineup: lineup as unknown as Prisma.InputJsonValue, acceptedAt: new Date(), riskFlags: flags as unknown as Prisma.InputJsonValue },
    });
    if (res.count === 0) throw new AppError("Este desafio não está mais disponível (já aceito, cancelado ou expirado).", "CONFLICT");
    const c = await tx.challenge.findUniqueOrThrow({ where: { id: challengeId } });
    const wallet = await getOrCreateTeamWallet(tx, team.id);
    // se faltar saldo, a transação inteira é desfeita (o desafio volta a ficar aberto)
    await postLedger(tx, { walletId: wallet.id, type: "STAKE_LOCK", available: -c.stakeCents, locked: c.stakeCents, refType: "challenge", refId: c.id, key: `ch-lock:${c.id}:opponent`, memo: "Aposta bloqueada (desafio aceito)", actorId: actor.id });
    await audit(actor.id, "challenge.accept", "Challenge", c.id, { teamId: team.id, flags }, tx);
    await notify(creatorTeam.ownerId, "challenge.accepted", "Desafio aceito!", `${team.name} aceitou seu desafio. Combinem a partida e, ao final, informem o resultado.`, `/desafios/${c.id}`, tx);
    return c;
  }, SERIALIZABLE);
  return accepted;
}

export async function cancelChallenge(actorIn: Actor | null, challengeId: string): Promise<void> {
  const actor = requireActor(actorIn);
  const c = await db.challenge.findUnique({ where: { id: challengeId } });
  if (!c) throw new AppError("Desafio não encontrado.", "NOT_FOUND");
  await requireTeamLeader(actor, c.creatorTeamId);
  if (!(await cancelOpen(challengeId, "CANCELED", "Desafio cancelado pelo criador."))) {
    throw new AppError("Só desafios abertos (sem adversário) podem ser cancelados. Depois do aceite, informe o resultado ou abra uma disputa.");
  }
  await audit(actor.id, "challenge.cancel", "Challenge", challengeId);
}

type Side = "a" | "b";

async function sideOf(client: Tx, actor: Actor, c: Challenge): Promise<{ side: Side; teamId: string }> {
  const ca = await client.teamMember.findFirst({ where: { teamId: c.creatorTeamId, userId: actor.id, role: "CAPTAIN" } });
  const cb = c.opponentTeamId ? await client.teamMember.findFirst({ where: { teamId: c.opponentTeamId, userId: actor.id, role: "CAPTAIN" } }) : null;
  if (ca) return { side: "a", teamId: c.creatorTeamId };
  if (cb) return { side: "b", teamId: c.opponentTeamId! };
  throw new AppError("Somente os líderes das duas equipes podem informar o resultado.", "FORBIDDEN");
}

/** Efetiva o resultado: perdedor perde a stake; vencedor recebe a própria stake de volta + (stake − taxa). */
export async function settleChallengeTx(tx: Prisma.TransactionClient, id: string, winnerSide: Side, by: { actorId: string | null; note?: string; resolvedById?: string }): Promise<boolean> {
  const c0 = await tx.challenge.findUniqueOrThrow({ where: { id } });
  if (!c0.opponentTeamId) throw new AppError("Desafio sem adversário.");
  const winnerTeam = winnerSide === "a" ? c0.creatorTeamId : c0.opponentTeamId;
  const loserTeam = winnerSide === "a" ? c0.opponentTeamId : c0.creatorTeamId;
  const fee = challengeFee(c0.stakeCents, c0.feeBps);
  const res = await tx.challenge.updateMany({
    where: { id, status: { in: ["ACCEPTED", "REPORTED", "DISPUTED"] } },
    data: { status: "SETTLED", winnerTeamId: winnerTeam, settledAt: new Date(), feeCents: fee, resolvedById: by.resolvedById ?? null, resolutionNote: by.note ?? null },
  });
  if (res.count === 0) return false;
  const [ww, lw, pw] = await Promise.all([getOrCreateTeamWallet(tx, winnerTeam), getOrCreateTeamWallet(tx, loserTeam), getPlatformWallet(tx)]);
  const ref = { refType: "challenge", refId: id, allowFrozen: true };
  await postLedger(tx, { ...ref, walletId: lw.id, type: "STAKE_LOSS", available: 0, locked: -c0.stakeCents, key: `ch-loss:${id}`, memo: "Desafio perdido" });
  await postLedger(tx, { ...ref, walletId: ww.id, type: "STAKE_RETURN", available: c0.stakeCents, locked: -c0.stakeCents, key: `ch-return:${id}`, memo: "Aposta própria devolvida" });
  await postLedger(tx, { ...ref, walletId: ww.id, type: "PRIZE_WIN", available: c0.stakeCents - fee, key: `ch-prize:${id}`, memo: "Prêmio do desafio" });
  if (fee > 0) await postLedger(tx, { ...ref, walletId: pw.id, type: "FEE", available: fee, key: `ch-fee:${id}`, memo: "Taxa do desafio" });
  await audit(by.actorId, "challenge.settle", "Challenge", id, { winnerTeam, fee, note: by.note }, tx);
  return true;
}

async function voidTx(tx: Prisma.TransactionClient, id: string, by: { actorId: string; note: string }): Promise<boolean> {
  const c = await tx.challenge.findUniqueOrThrow({ where: { id } });
  const res = await tx.challenge.updateMany({ where: { id, status: { in: ["ACCEPTED", "REPORTED", "DISPUTED"] } }, data: { status: "VOID", settledAt: new Date(), resolvedById: by.actorId, resolutionNote: by.note } });
  if (res.count === 0) return false;
  for (const [teamId, tag] of [[c.creatorTeamId, "creator"], [c.opponentTeamId!, "opponent"]] as const) {
    const w = await getOrCreateTeamWallet(tx, teamId);
    await postLedger(tx, { walletId: w.id, type: "STAKE_REFUND", available: c.stakeCents, locked: -c.stakeCents, refType: "challenge", refId: id, key: `ch-refund:${id}:${tag}`, memo: "Desafio anulado", allowFrozen: true });
  }
  await audit(by.actorId, "challenge.void", "Challenge", id, { note: by.note }, tx);
  return true;
}

/**
 * Resultado informado por um líder.
 *  - LOST (reconhece a derrota): efetiva na hora a favor do adversário — é a confirmação mais forte possível.
 *  - WON: fica "REPORTED"; o adversário confirma, contesta ou, em stakes baixas, a janela de contestação se encerra.
 *  - NO_SHOW: o adversário não apareceu → vai para a análise de um administrador.
 */
export async function reportChallengeResult(actorIn: Actor | null, challengeId: string, outcome: "WON" | "LOST" | "NO_SHOW"): Promise<"settled" | "reported" | "disputed"> {
  const actor = requireActor(actorIn);
  const cfg = moneyConfig();
  return db.$transaction(async (tx) => {
    const c = await tx.challenge.findUniqueOrThrow({ where: { id: challengeId } }).catch(() => {
      throw new AppError("Desafio não encontrado.", "NOT_FOUND");
    });
    const { side } = await sideOf(tx, actor, c);
    if (!["ACCEPTED", "REPORTED", "DISPUTED"].includes(c.status)) throw new AppError("Este desafio não está em andamento.");
    const other: Side = side === "a" ? "b" : "a";

    if (outcome === "LOST") {
      if (!(await settleChallengeTx(tx, c.id, other, { actorId: actor.id, note: "Derrota reconhecida pelo líder." }))) throw new AppError("Este desafio já foi encerrado.");
      await notifyBoth(tx, c, "Desafio encerrado", "O resultado foi confirmado e os créditos foram movimentados.");
      return "settled" as const;
    }
    if (outcome === "NO_SHOW") {
      await tx.challenge.update({ where: { id: c.id }, data: { status: "DISPUTED", disputeReason: `Equipe ${side === "a" ? "A" : "B"} informa que o adversário não compareceu.` } });
      await notifyAdmins(tx, c);
      return "disputed" as const;
    }
    // WON
    if (c.reportedBy && c.reportedBy !== side && c.reportedWinner === other) {
      // os dois alegam vitória: disputa
      await tx.challenge.update({ where: { id: c.id }, data: { status: "DISPUTED", disputeReason: "As duas equipes alegam vitória.", autoSettleAt: null } });
      await notifyAdmins(tx, c);
      return "disputed" as const;
    }
    if (c.status === "DISPUTED") throw new AppError("Este desafio está em disputa e será decidido por um administrador.");
    const autoAt = c.stakeCents <= cfg.autoSettleMaxStakeCents ? new Date(Date.now() + cfg.autoSettleWindowMinutes * 60_000) : null;
    await tx.challenge.update({ where: { id: c.id }, data: { status: "REPORTED", reportedBy: side, reportedWinner: side, reportedAt: new Date(), autoSettleAt: autoAt } });
    const opp = side === "a" ? c.opponentTeamId! : c.creatorTeamId;
    const oppTeam = await tx.team.findUniqueOrThrow({ where: { id: opp } });
    await notify(oppTeam.ownerId, "challenge.reported", "Confirme o resultado", autoAt ? `Se você não responder em ${cfg.autoSettleWindowMinutes} min, o resultado será efetivado.` : "Confirme ou conteste o resultado informado.", `/desafios/${c.id}`, tx);
    return "reported" as const;
  }, SERIALIZABLE);
}

async function notifyBoth(tx: Prisma.TransactionClient, c: Challenge, title: string, body: string) {
  const teams = await tx.team.findMany({ where: { id: { in: [c.creatorTeamId, c.opponentTeamId!] } } });
  await notify(teams.map((t) => t.ownerId), "challenge.settled", title, body, `/desafios/${c.id}`, tx);
}

async function notifyAdmins(tx: Prisma.TransactionClient, c: Challenge) {
  const admins = await tx.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await notify(admins.map((a) => a.id), "challenge.disputed", "Desafio em disputa", `Desafio ${c.id} aguarda decisão.`, `/admin/desafios`, tx);
}

export async function disputeChallenge(actorIn: Actor | null, challengeId: string, reason: string): Promise<void> {
  const actor = requireActor(actorIn);
  if (reason.trim().length < 10) throw new AppError("Descreva o motivo da disputa (mínimo de 10 caracteres).");
  await db.$transaction(async (tx) => {
    const c = await tx.challenge.findUniqueOrThrow({ where: { id: challengeId } }).catch(() => {
      throw new AppError("Desafio não encontrado.", "NOT_FOUND");
    });
    await sideOf(tx, actor, c);
    const res = await tx.challenge.updateMany({ where: { id: c.id, status: { in: ["ACCEPTED", "REPORTED"] } }, data: { status: "DISPUTED", disputeReason: reason.trim().slice(0, 500), autoSettleAt: null } });
    if (res.count === 0) throw new AppError("Este desafio não pode ser contestado agora.");
    await notifyAdmins(tx, c);
    await audit(actor.id, "challenge.dispute", "Challenge", c.id, { reason }, tx);
  });
}

export async function submitChallengeEvidence(actorIn: Actor | null, challengeId: string, text: string): Promise<void> {
  const actor = requireActor(actorIn);
  const c = await db.challenge.findUnique({ where: { id: challengeId } });
  if (!c) throw new AppError("Desafio não encontrado.", "NOT_FOUND");
  const { side } = await sideOf(db, actor, c);
  if (["SETTLED", "VOID", "CANCELED", "EXPIRED", "OPEN"].includes(c.status)) throw new AppError("Não é possível anexar provas agora.");
  const clean = text.trim().slice(0, 1000);
  if (clean.length < 3) throw new AppError("Descreva a prova (texto ou links de prints/vídeos).");
  await db.challenge.update({ where: { id: c.id }, data: side === "a" ? { evidenceA: clean } : { evidenceB: clean } });
}

/** Decisão de um administrador (sem conflito de interesse) para desafios em disputa. */
export async function resolveChallenge(actorIn: Actor | null, challengeId: string, outcome: "creator" | "opponent" | "void", note: string): Promise<void> {
  const actor = requireActor(actorIn);
  if (actor.role !== "ADMIN") throw new AppError("Apenas administradores podem decidir disputas.", "FORBIDDEN");
  if (note.trim().length < 10) throw new AppError("Descreva a decisão (mínimo de 10 caracteres).");
  await db.$transaction(async (tx) => {
    const c = await tx.challenge.findUniqueOrThrow({ where: { id: challengeId } }).catch(() => {
      throw new AppError("Desafio não encontrado.", "NOT_FOUND");
    });
    if (c.status !== "DISPUTED") throw new AppError("Este desafio não está em disputa.");
    const members = await tx.teamMember.findMany({ where: { teamId: { in: [c.creatorTeamId, c.opponentTeamId!] }, userId: actor.id } });
    if (members.length) throw new AppError("Conflito de interesse: você pertence a uma das equipes.", "FORBIDDEN");
    const ok = outcome === "void" ? await voidTx(tx, c.id, { actorId: actor.id, note: note.trim() }) : await settleChallengeTx(tx, c.id, outcome === "creator" ? "a" : "b", { actorId: actor.id, resolvedById: actor.id, note: note.trim() });
    if (!ok) throw new AppError("Este desafio já foi encerrado.");
    await notifyBoth(tx, c, "Disputa decidida", note.trim());
  }, SERIALIZABLE);
}

/** Job: efetiva resultados reportados sem contestação (stakes baixas) e destrava desafios esquecidos. */
export async function runChallengeMaintenance(now = new Date()): Promise<{ expired: number; autoSettled: number; stale: number }> {
  const expired = await expireOpenChallenges(now);
  let autoSettled = 0;
  const due = await db.challenge.findMany({ where: { status: "REPORTED", autoSettleAt: { lte: now } } });
  for (const c of due) {
    const ok = await db.$transaction((tx) => settleChallengeTx(tx, c.id, c.reportedWinner as Side, { actorId: null, note: "Resultado efetivado automaticamente (sem contestação no prazo)." }), SERIALIZABLE);
    if (ok) autoSettled++;
  }
  const stale = await db.challenge.updateMany({
    where: { status: "ACCEPTED", acceptedAt: { lt: new Date(now.getTime() - 24 * 3600_000) } },
    data: { status: "DISPUTED", disputeReason: "Nenhum resultado informado em 24 horas." },
  });
  return { expired, autoSettled, stale: stale.count };
}

export async function listOpenChallenges(filter: { gameId?: string } = {}) {
  await expireOpenChallenges();
  return db.challenge.findMany({ where: { status: "OPEN", expiresAt: { gt: new Date() }, invitedTeamId: null, ...(filter.gameId ? { gameId: filter.gameId } : {}) }, orderBy: { createdAt: "desc" }, include: { creatorTeam: true }, take: 50 });
}
