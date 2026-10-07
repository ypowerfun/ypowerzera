import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "./types";
import type { OrgRole, Tournament } from "@prisma/client";

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) throw new AppError("Faça login para continuar.", "UNAUTHENTICATED");
  return actor;
}

export function requireVerified(actor: Actor): void {
  if (!actor.emailVerifiedAt && actor.role !== "ADMIN") {
    throw new AppError("Confirme seu e-mail para continuar. Reenvie o link em Minha conta.", "FORBIDDEN");
  }
}

/** Só administradores. */
export function requireAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") throw new AppError("Somente administradores podem fazer isso.", "FORBIDDEN");
}

/**
 * Cargos do site: ADMIN (tudo), ORGANIZER (cria organizações e campeonatos) e USER (jogador).
 * Criar organização/campeonato exige ORGANIZER ou ADMIN; quem é só jogador pede acesso ao administrador.
 */
export function requireOrganizer(actor: Actor): void {
  if (actor.role !== "ADMIN" && actor.role !== "ORGANIZER") {
    throw new AppError("Somente organizadores podem fazer isso. Peça a um administrador para liberar o seu acesso.", "FORBIDDEN");
  }
}

export async function orgRoleOf(userId: string, orgId: string, client: Tx = db): Promise<OrgRole | null> {
  const m = await client.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  return m?.role ?? null;
}

/** "admin" = dono/admin da organização; "staff" = pode operar partidas e participantes. */
export async function canManageOrg(actor: Actor, orgId: string, level: "admin" | "staff", client: Tx = db): Promise<boolean> {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { deletedAt: true } });
  if (!org) return false;
  if (actor.role === "ADMIN") return true; // o admin segue enxergando o histórico de uma organização excluída
  if (org.deletedAt) return false; // para os demais, organização excluída não é mais gerenciável
  const role = await orgRoleOf(actor.id, orgId, client);
  if (!role) return false;
  // Quem voltou a ser jogador perde a gestão (dono/admin da organização); só continua como equipe de apoio (STAFF),
  // que é uma função delegada pelo organizador e opera partidas e participantes.
  if (actor.role !== "ORGANIZER") return level === "staff" && role === "STAFF";
  return level === "staff" ? true : role === "OWNER" || role === "ADMIN";
}

/** Ações DA organização (criar campeonato, cupom, membros): a organização precisa existir e não estar excluída, nem para o admin. */
export async function assertOrgAccess(actor: Actor, orgId: string, level: "admin" | "staff", client: Tx = db): Promise<void> {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { deletedAt: true } });
  if (!org || org.deletedAt) throw new AppError("Organização não encontrada.", "NOT_FOUND");
  if (!(await canManageOrg(actor, orgId, level, client))) throw new AppError("Você não tem permissão para esta ação.", "FORBIDDEN");
}

/** Dentro de uma transação, passe o `tx` em `client`: nunca consulte o `db` global ali dentro. */
export async function assertTournamentAccess(actor: Actor, tournament: Pick<Tournament, "orgId">, level: "admin" | "staff", client: Tx = db): Promise<void> {
  if (!(await canManageOrg(actor, tournament.orgId, level, client))) throw new AppError("Você não tem permissão para esta ação.", "FORBIDDEN");
}
