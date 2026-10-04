import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "./types";

/** Só o LÍDER (capitão) da equipe movimenta o dinheiro dela. Administradores não movimentam saldo de terceiros. */
export async function requireTeamLeader(actor: Actor, teamId: string) {
  const team = await db.team.findUnique({ where: { id: teamId }, include: { members: true } });
  if (!team) throw new AppError("Equipe não encontrada.", "NOT_FOUND");
  const me = team.members.find((m) => m.userId === actor.id);
  if (me?.role !== "CAPTAIN") throw new AppError("Somente o líder da equipe pode movimentar o saldo dela.", "FORBIDDEN");
  return team;
}

export async function leaderTeams(userId: string) {
  return db.teamMember.findMany({ where: { userId, role: "CAPTAIN" }, include: { team: { include: { wallet: true } } }, orderBy: { team: { name: "asc" } } });
}
