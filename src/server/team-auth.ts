import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "./types";

/**
 * Só o LÍDER (capitão) da equipe movimenta o dinheiro dela. Administradores não movimentam saldo de terceiros.
 * Equipe EXCLUÍDA não deposita, não aposta e não saca, exceto (`allowReleased`) o saque do saldo que o admin liberou.
 */
export async function requireTeamLeader(actor: Actor, teamId: string, opts: { allowReleased?: boolean } = {}) {
  const team = await db.team.findUnique({ where: { id: teamId }, include: { members: true } });
  if (!team) throw new AppError("Equipe não encontrada.", "NOT_FOUND");
  const me = team.members.find((m) => m.userId === actor.id);
  if (me?.role !== "CAPTAIN") throw new AppError("Somente o líder da equipe pode movimentar o saldo dela.", "FORBIDDEN");
  if (team.deletedAt) {
    if (!opts.allowReleased) throw new AppError("Esta equipe foi excluída e não movimenta mais o saldo.", "FORBIDDEN");
    if (!team.balanceReleasedAt) throw new AppError("O saldo desta equipe excluída está bloqueado. Peça a revisão ao administrador para liberar o saque.", "FORBIDDEN");
  }
  return team;
}

/** Times que a pessoa lidera e que estão ativos (os excluídos ficam em `leaderDeletedTeams`). */
export async function leaderTeams(userId: string) {
  return db.teamMember.findMany({ where: { userId, role: "CAPTAIN", team: { deletedAt: null } }, include: { team: { include: { wallet: true } } }, orderBy: { team: { name: "asc" } } });
}

/** Times EXCLUÍDOS que a pessoa liderava e que ainda têm saldo (ou pedido de revisão) a resolver. */
export async function leaderDeletedTeams(userId: string) {
  const rows = await db.teamMember.findMany({
    where: { userId, role: "CAPTAIN", team: { deletedAt: { not: null } } },
    include: { team: { include: { wallet: true, releaseRequests: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    orderBy: { team: { deletedAt: "desc" } },
  });
  return rows.filter((r) => (r.team.wallet?.balanceCents ?? 0) > 0 || (r.team.wallet?.lockedCents ?? 0) > 0 || r.team.releaseRequests[0]?.status === "PENDING");
}
