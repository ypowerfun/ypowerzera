import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/crypto";
import { audit } from "./audit";
import { notify } from "./notifications";
import { uniqueSlug } from "./orgs";
import { requireActor, requireVerified } from "./permissions";
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
  if (gameId && !getGame(gameId)) throw new AppError("Jogo inválido.");
  await rateLimit(`team-create:${actor.id}`, 10, 86400, "Você já criou vários times hoje.");
  const clash = await db.team.findFirst({ where: { name: { equals: name } }, select: { id: true } });
  if (clash) throw new AppError("Já existe um time com esse nome.", "CONFLICT");
  const slug = await uniqueSlug(name, async (s) => !!(await db.team.findUnique({ where: { slug: s } })));
  return db.team.create({
    data: { name, tag, gameId: gameId || null, description, slug, ownerId: actor.id, members: { create: { userId: actor.id, role: "CAPTAIN" } } },
  });
}

async function requireCaptain(actor: Actor, teamId: string) {
  const team = await db.team.findUnique({ where: { id: teamId }, include: { members: true } });
  if (!team) throw new AppError("Time não encontrado.", "NOT_FOUND");
  const me = team.members.find((m) => m.userId === actor.id);
  if (actor.role !== "ADMIN" && me?.role !== "CAPTAIN") throw new AppError("Só o capitão pode fazer isso.", "FORBIDDEN");
  return team;
}

export async function inviteToTeam(actorIn: Actor | null, teamId: string, username: string, role: "PLAYER" | "SUB" = "PLAYER") {
  const actor = requireActor(actorIn);
  const team = await requireCaptain(actor, teamId);
  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!user) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
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
  if (!team) throw new AppError("Time não encontrado.", "NOT_FOUND");
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

export async function setMemberRole(actorIn: Actor | null, teamId: string, userId: string, role: "CAPTAIN" | "PLAYER" | "SUB") {
  const actor = requireActor(actorIn);
  const team = await requireCaptain(actor, teamId);
  const target = team.members.find((m) => m.userId === userId);
  if (!target) throw new AppError("Membro não encontrado.", "NOT_FOUND");
  await db.$transaction(async (tx) => {
    await tx.teamMember.update({ where: { id: target.id }, data: { role } });
    if (role === "CAPTAIN" && userId !== actor.id) {
      // transferência de capitania: o capitão anterior vira jogador
      await tx.teamMember.updateMany({ where: { teamId, userId: actor.id }, data: { role: "PLAYER" } });
      await tx.team.update({ where: { id: teamId }, data: { ownerId: userId } });
    }
  });
}

export async function myTeams(userId: string) {
  return db.teamMember.findMany({ where: { userId }, include: { team: { include: { members: { include: { user: true } } } } }, orderBy: { team: { name: "asc" } } });
}

export async function pendingInvites(userId: string) {
  return db.teamInvite.findMany({ where: { userId, status: "PENDING", expiresAt: { gt: new Date() } }, include: { team: true, invitedBy: true } });
}
