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

export async function orgRoleOf(userId: string, orgId: string, client: Tx = db): Promise<OrgRole | null> {
  const m = await client.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  return m?.role ?? null;
}

/** "admin" = dono/admin da organização; "staff" = pode operar partidas e participantes. */
export async function canManageOrg(actor: Actor, orgId: string, level: "admin" | "staff", client: Tx = db): Promise<boolean> {
  if (actor.role === "ADMIN") return true;
  const role = await orgRoleOf(actor.id, orgId, client);
  if (!role) return false;
  return level === "staff" ? true : role === "OWNER" || role === "ADMIN";
}

export async function assertOrgAccess(actor: Actor, orgId: string, level: "admin" | "staff", client: Tx = db): Promise<void> {
  if (!(await canManageOrg(actor, orgId, level, client))) throw new AppError("Você não tem permissão para esta ação.", "FORBIDDEN");
}

/** Dentro de uma transação, passe o `tx` em `client`: nunca consulte o `db` global ali dentro. */
export async function assertTournamentAccess(actor: Actor, tournament: Pick<Tournament, "orgId">, level: "admin" | "staff", client: Tx = db): Promise<void> {
  await assertOrgAccess(actor, tournament.orgId, level, client);
}
