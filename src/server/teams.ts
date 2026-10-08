import { Prisma, type ChallengeStatus, type ParticipantStatus, type TournamentStatus, type WithdrawalStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/crypto";
import { audit } from "./audit";
import { notify } from "./notifications";
import { uniqueSlug } from "./orgs";
import { requireActor, requireVerified } from "./permissions";
import { freezeWallet } from "./wallet";
import { rateLimit } from "./rate-limit";
import type { Actor } from "./types";
import { getGame } from "@/games";

const teamSchema = z.object({
  name: z.string().trim().min(3, "Nome do time: mínimo de 3 caracteres.").max(40),
  tag: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,5}$/, "A TAG deve ter de 2 a 5 letras/números."),
  gameId: z.string().optional(),
  description: z.string().trim().max(300).optional(),
});

export async function createTeam(actorIn: Actor | null, input: unknown) {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const { name, tag, gameId, description } = parsed.data;
  const game = gameId ? getGame(gameId) : undefined;
  if (gameId && !game) throw new AppError("Jogo inválido.");
  await rateLimit(`team-create:${actor.id}`, 10, 86400, "Você já criou vários times hoje.");
  const clash = await db.team.findFirst({ where: { name: { equals: name }, deletedAt: null }, select: { id: true } });
  if (clash) throw new AppError("Já existe um time com esse nome.", "CONFLICT");
  const slug = await uniqueSlug(name, async (s) => !!(await db.team.findUnique({ where: { slug: s } })));
  // time e capitão juntos: tudo-ou-nada (e sem escrita aninhada, que o motor do D1 não consegue desfazer)
  return db.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { name, tag, gameId: game?.id ?? null, description, slug, ownerId: actor.id } });
    await tx.teamMember.create({ data: { teamId: team.id, userId: actor.id, role: "CAPTAIN" } });
    return team;
  });
}

async function requireCaptain(actor: Actor, teamId: string) {
  const team = await db.team.findUnique({ where: { id: teamId }, include: { members: true } });
  if (!team) throw new AppError("Time não encontrado.", "NOT_FOUND");
  const me = team.members.find((m) => m.userId === actor.id);
  if (actor.role !== "ADMIN" && me?.role !== "CAPTAIN") throw new AppError("Só o capitão pode fazer isso.", "FORBIDDEN");
  if (team.deletedAt) throw new AppError("Este time foi excluído.", "FORBIDDEN");
  return team;
}

export async function inviteToTeam(actorIn: Actor | null, teamId: string, username: string, role: "PLAYER" | "SUB" = "PLAYER") {
  const actor = requireActor(actorIn);
  const team = await requireCaptain(actor, teamId);
  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!user) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  if (user.id === actor.id && !team.members.some((m) => m.userId === actor.id)) throw new AppError("Você não pode convidar a si mesmo para um time que não é seu.", "FORBIDDEN");
  if (team.members.some((m) => m.userId === user.id)) throw new AppError("Esta pessoa já está no time.", "CONFLICT");
  if (team.members.length >= 15) throw new AppError("O time atingiu o limite de 15 membros.");
  const pending = await db.teamInvite.findFirst({ where: { teamId, userId: user.id, status: "PENDING", expiresAt: { gt: new Date() } } });
  if (pending) throw new AppError("Já existe um convite pendente para esta pessoa.", "CONFLICT");
  const invite = await db.teamInvite.create({
    data: { teamId, invitedById: actor.id, userId: user.id, role, token: randomToken(24), expiresAt: new Date(Date.now() + 7 * 86400_000) },
  });
  await notify(user.id, "team.invite", `Convite para o time ${team.name}`, `${actor.displayName ?? "Um capitão"} convidou você para entrar no time [${team.tag}] ${team.name}.`, "/times");
  return invite;
}

export async function respondToInvite(actorIn: Actor | null, inviteId: string, accept: boolean) {
  const actor = requireActor(actorIn);
  const invite = await db.teamInvite.findUnique({ where: { id: inviteId }, include: { team: true } });
  if (!invite || invite.userId !== actor.id) throw new AppError("Convite não encontrado.", "NOT_FOUND");
  if (invite.status !== "PENDING") throw new AppError("Este convite não está mais disponível.");
  if (invite.expiresAt < new Date()) throw new AppError("Este convite expirou.");
  if (!accept) {
    await db.teamInvite.update({ where: { id: invite.id }, data: { status: "DECLINED" } });
    return;
  }
  await db.$transaction(async (tx) => {
    const exists = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: invite.teamId, userId: actor.id } } });
    if (!exists) await tx.teamMember.create({ data: { teamId: invite.teamId, userId: actor.id, role: invite.role } });
    await tx.teamInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });
  });
  await notify(invite.team.ownerId, "team.joined", "Novo integrante", `${actor.displayName ?? "Um jogador"} entrou no time ${invite.team.name}.`, `/times/${invite.team.slug}`);
}

export async function removeFromTeam(actorIn: Actor | null, teamId: string, userId: string) {
  const actor = requireActor(actorIn);
  const team = await db.team.findUnique({ where: { id: teamId }, include: { members: true } });
  if (!team || team.deletedAt) throw new AppError("Time não encontrado.", "NOT_FOUND");
  const self = userId === actor.id;
  if (!self) await requireCaptain(actor, teamId);
  const target = team.members.find((m) => m.userId === userId);
  if (!target) return;
  if (target.role === "CAPTAIN" && team.members.filter((m) => m.role === "CAPTAIN").length === 1) {
    throw new AppError("Transfira a capitania antes de sair do time.");
  }
  await db.teamMember.delete({ where: { id: target.id } });
  await audit(actor.id, self ? "team.leave" : "team.kick", "Team", teamId, { userId });
}

const HANDOVER_STATUSES: ParticipantStatus[] = ["REGISTERED", "CHECKED_IN", "WAITLIST"];

/**
 * Quem controla a inscrição de um time em campeonatos (relatar placar, disputa, veto, check-in, desistir) é o `userId` da
 * inscrição, gravado no dia em que o capitão a fez. Quando a capitania muda, o ex-capitão não pode seguir mandando no time e o novo
 * capitão precisa assumir: as inscrições em andamento passam para ele. (Inscrição aguardando pagamento fica como está: o pedido de
 * pagamento é de quem a fez e expira em 30 minutos.)
 */
async function handOverRegistrations(tx: Prisma.TransactionClient, teamId: string, toUserId: string): Promise<void> {
  const open = await tx.participant.findMany({
    where: { teamId, userId: { not: toUserId }, status: { in: HANDOVER_STATUSES }, tournament: { status: { in: ["DRAFT", "REGISTRATION", "CHECK_IN", "LIVE"] } } },
    select: { id: true, tournamentId: true },
  });
  for (const p of open) {
    // a unicidade (campeonato + usuário) impede dois cadastros do mesmo usuário: se o novo capitão já tem outro, mantém como está
    const clash = await tx.participant.findUnique({ where: { tournamentId_userId: { tournamentId: p.tournamentId, userId: toUserId } }, select: { id: true } });
    if (clash) continue;
    await tx.participant.update({ where: { id: p.id }, data: { userId: toUserId } });
  }
}

export async function setMemberRole(actorIn: Actor | null, teamId: string, userId: string, role: "CAPTAIN" | "PLAYER" | "SUB") {
  const actor = requireActor(actorIn);
  const team = await requireCaptain(actor, teamId);
  const target = team.members.find((m) => m.userId === userId);
  if (!target) throw new AppError("Membro não encontrado.", "NOT_FOUND");
  const actorIsCaptain = team.members.some((m) => m.userId === actor.id && m.role === "CAPTAIN");
  // O administrador gerencia qualquer time, mas não vira líder de um que não é dele: o líder é quem movimenta o dinheiro.
  if (role === "CAPTAIN" && actor.role === "ADMIN" && userId === actor.id && !actorIsCaptain) {
    throw new AppError("Administradores não podem se tornar líder de um time. Transfira a capitania para um integrante.", "FORBIDDEN");
  }
  if (role !== "CAPTAIN" && target.role === "CAPTAIN") throw new AppError("Para tirar a capitania, transfira-a para outro integrante.");
  await db.$transaction(async (tx) => {
    await tx.teamMember.update({ where: { id: target.id }, data: { role } });
    if (role === "CAPTAIN") {
      // transferência de capitania: QUALQUER outro capitão vira jogador (quem transfere pode ser um admin que nem é do time)
      await tx.teamMember.updateMany({ where: { teamId, role: "CAPTAIN", NOT: { userId } }, data: { role: "PLAYER" } });
      await tx.team.update({ where: { id: teamId }, data: { ownerId: userId } });
      await handOverRegistrations(tx, teamId, userId);
      if (target.role !== "CAPTAIN") await audit(actor.id, "team.captain", "Team", teamId, { to: userId, byAdmin: actor.role === "ADMIN" && !actorIsCaptain }, tx);
    }
  });
}

export async function myTeams(userId: string) {
  return db.teamMember.findMany({ where: { userId, team: { deletedAt: null } }, include: { team: { include: { members: { include: { user: true } } } } }, orderBy: { team: { name: "asc" } } });
}

export async function pendingInvites(userId: string) {
  return db.teamInvite.findMany({ where: { userId, status: "PENDING", expiresAt: { gt: new Date() } }, include: { team: true, invitedBy: true } });
}

const OPEN_CHALLENGE: ChallengeStatus[] = ["OPEN", "ACCEPTED", "REPORTED", "DISPUTED"];
const OPEN_WITHDRAWAL: WithdrawalStatus[] = ["PENDING_CONFIRMATION", "UNDER_REVIEW", "APPROVED", "PROCESSING"];
const LIVE_TOURNAMENT: TournamentStatus[] = ["REGISTRATION", "CHECK_IN", "LIVE"];
const ACTIVE_PARTICIPANT: ParticipantStatus[] = ["PENDING_PAYMENT", "REGISTERED", "CHECKED_IN", "WAITLIST"];

/**
 * Exclui o time (exclusão LÓGICA: a carteira e o razão imutável permanecem). Só o líder ou um admin.
 * Não exclui com desafio, saque, Pix pendente ou campeonato em andamento. O saldo que sobrar fica BLOQUEADO
 * (carteira congelada) até o líder pedir a revisão e um admin liberar para saque (veja team-release.ts).
 */
export async function deleteTeam(actorIn: Actor | null, teamId: string, input: { reason?: string } = {}): Promise<{ balanceCents: number }> {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const team = await requireCaptain(actor, teamId); // líder ou admin; recusa time já excluído
  const reason = (input.reason ?? "").trim().slice(0, 300);
  const isLeader = team.members.some((m) => m.userId === actor.id && m.role === "CAPTAIN");
  if (!isLeader && reason.length < 10) throw new AppError("Informe o motivo da exclusão (mínimo de 10 caracteres).");

  const now = new Date();
  return db.$transaction(
    async (tx) => {
      const t = await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: { wallet: true, members: true } });
      if (t.deletedAt) throw new AppError("Este time já foi excluído.", "CONFLICT");
      const [challenges, withdrawals, pixPending, tournaments] = await Promise.all([
        tx.challenge.count({ where: { status: { in: OPEN_CHALLENGE }, OR: [{ creatorTeamId: teamId }, { opponentTeamId: teamId }] } }),
        tx.withdrawal.count({ where: { teamId, status: { in: OPEN_WITHDRAWAL } } }),
        tx.deposit.count({ where: { teamId, status: "PENDING", expiresAt: { gt: now } } }),
        tx.participant.count({ where: { teamId, status: { in: ACTIVE_PARTICIPANT }, tournament: { status: { in: LIVE_TOURNAMENT } } } }),
      ]);
      const blockers: string[] = [];
      if (challenges) blockers.push(`${challenges} desafio(s) em andamento (conclua ou cancele)`);
      if (withdrawals) blockers.push(`${withdrawals} saque(s) em andamento`);
      if (pixPending) blockers.push(`${pixPending} Pix pendente(s) (aguarde expirar)`);
      if (tournaments) blockers.push(`inscrição em ${tournaments} campeonato(s) em andamento (cancele a inscrição)`);
      if (blockers.length) throw new AppError(`Não é possível excluir o time agora: ${blockers.join("; ")}.`);

      await tx.team.update({ where: { id: teamId }, data: { deletedAt: now, deletedById: actor.id } });
      await tx.teamInvite.updateMany({ where: { teamId, status: "PENDING" }, data: { status: "REVOKED" } });
      const balanceCents = t.wallet?.balanceCents ?? 0;
      // sempre congela: qualquer valor que ainda chegue (ex.: Pix pago com atraso) também espera a revisão do admin
      if (t.wallet) await freezeWallet(tx, t.wallet.id, `Equipe excluída em ${now.toLocaleDateString("pt-BR")}: saldo bloqueado até a revisão do administrador.`);
      await audit(actor.id, "team.delete", "Team", teamId, { balanceCents, byAdmin: !isLeader, reason: reason || null }, tx);
      await notify(
        t.members.filter((m) => m.userId !== actor.id).map((m) => m.userId),
        "team.deleted",
        `O time ${t.name} foi excluído`,
        isLeader ? "O líder excluiu o time." : "Um administrador excluiu o time.",
        "/times",
        tx,
      );
      return { balanceCents };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 },
  );
}
