import type { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "./audit";
import { effectiveRole } from "./auth";
import { notify } from "./notifications";
import { requireActor, requireAdmin } from "./permissions";
import type { Actor } from "./types";

export const ROLE_LABELS: Record<Role, string> = { ADMIN: "Administrador", ORGANIZER: "Organizador", USER: "Jogador" };

export const USERS_PAGE_SIZE = 25;

/** Lista usuários para o painel do admin (busca por nome, usuário ou e-mail; filtro por cargo). */
export async function listUsers(actorIn: Actor | null, opts: { q?: string; role?: Role; page?: number } = {}) {
  const actor = requireActor(actorIn);
  requireAdmin(actor);
  const q = (opts.q ?? "").trim().slice(0, 80);
  const where: Prisma.UserWhereInput = {
    ...(opts.role ? { role: opts.role } : {}),
    ...(q ? { OR: [{ email: { contains: q } }, { username: { contains: q } }, { displayName: { contains: q } }] } : {}),
  };
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
      select: { id: true, email: true, username: true, displayName: true, role: true, emailVerifiedAt: true, createdAt: true, bannedAt: true },
    }),
  ]);
  const ids = users.map((u) => u.id);
  const orgs = await db.orgMember.groupBy({ by: ["userId"], where: { userId: { in: ids }, role: { in: ["OWNER", "ADMIN"] } }, _count: { _all: true } });
  const teams = await db.teamMember.groupBy({ by: ["userId"], where: { userId: { in: ids }, role: "CAPTAIN", team: { deletedAt: null } }, _count: { _all: true } });
  const orgCount = new Map(orgs.map((o) => [o.userId, o._count._all]));
  const teamCount = new Map(teams.map((t) => [t.userId, t._count._all]));
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
    users: users.map((u) => ({ ...u, effectiveRole: effectiveRole(u), orgsManaged: orgCount.get(u.id) ?? 0, teamsLed: teamCount.get(u.id) ?? 0 })),
  };
}

export interface RoleChangeResult {
  changed: boolean;
  from: Role;
  to: Role;
  /** Ao rebaixar: o que a pessoa deixa de gerenciar (para o admin saber o impacto). */
  impact?: { orgs: number; activeTournaments: number };
}

/**
 * Admin troca o cargo de um usuário entre JOGADOR (USER) e ORGANIZADOR (ORGANIZER).
 * Travas: só admin; não altera a si mesmo nem outro administrador; troca atômica (compare-and-set); tudo auditado.
 */
export async function setUserRole(actorIn: Actor | null, userId: string, role: Role): Promise<RoleChangeResult> {
  const actor = requireActor(actorIn);
  requireAdmin(actor);
  if (role !== "USER" && role !== "ORGANIZER") throw new AppError("Escolha Jogador ou Organizador.");
  if (userId === actor.id) throw new AppError("Você não pode alterar o seu próprio cargo.", "FORBIDDEN");
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  if (effectiveRole(target) === "ADMIN") throw new AppError("O cargo de um administrador não é alterado por aqui.", "FORBIDDEN");
  if (target.role === role) return { changed: false, from: target.role, to: role };

  const res = await db.$transaction(async (tx) => {
    // compare-and-set: se outro admin mudou o cargo nesse meio-tempo, não sobrescreve às cegas
    const upd = await tx.user.updateMany({ where: { id: target.id, role: target.role }, data: { role } });
    if (upd.count === 0) throw new AppError("O cargo deste usuário mudou agora há pouco. Recarregue a página.", "CONFLICT");
    await audit(actor.id, "user.role", "User", target.id, { from: target.role, to: role }, tx);
    let impact: RoleChangeResult["impact"];
    if (role === "USER") {
      const managed = await tx.orgMember.findMany({ where: { userId: target.id, role: { in: ["OWNER", "ADMIN"] } }, select: { orgId: true } });
      const activeTournaments = await tx.tournament.count({ where: { orgId: { in: managed.map((m) => m.orgId) }, status: { in: ["REGISTRATION", "CHECK_IN", "LIVE"] } } });
      impact = { orgs: managed.length, activeTournaments };
    }
    await notify(
      target.id,
      "user.role",
      role === "ORGANIZER" ? "Você agora é organizador" : "Seu acesso de organizador foi removido",
      role === "ORGANIZER" ? "Você já pode criar organizações e campeonatos na área Organizar." : "Você voltou a ser jogador. Seus times e sua conta continuam como estavam.",
      role === "ORGANIZER" ? "/organizar" : "/conta",
      tx,
    );
    return impact;
  });
  return { changed: true, from: target.role, to: role, impact: res };
}
