import { addD1OrgMember, removeD1OrgMember, updateD1Organization, deleteD1Organization } from "./d1/organizations";
import { sitesDatabase } from "@/lib/sites-d1";
import { createD1Organization } from "./d1/create-groups";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import { audit } from "./audit";
import { notify } from "./notifications";
import { assertOrgAccess, requireActor, requireOrganizer, requireVerified } from "./permissions";
import { rateLimit } from "./rate-limit";
import type { Actor } from "./types";

async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "item";
  let slug = root;
  for (let i = 2; await exists(slug); i++) slug = `${root}-${i}`;
  return slug;
}

const orgInput = z.object({
  name: z.string().trim().min(3, "Nome da organização: mínimo de 3 caracteres.").max(60, "Nome da organização: máximo de 60 caracteres."),
  description: z.string().trim().max(500, "A descrição aceita até 500 caracteres.").optional(),
});

export async function createOrganization(actorIn: Actor | null, input: { name: string; description?: string }) {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  requireOrganizer(actor);
  const parsed = orgInput.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  await rateLimit(`org-create:${actor.id}`, 5, 86400, "Você já criou várias organizações hoje.");
  const slug = await uniqueSlug(parsed.data.name, async (s) => !!(await db.organization.findUnique({ where: { slug: s } })));
  const d1 = sitesDatabase();
  if (d1) {
    const id = await createD1Organization(d1, { actorId: actor.id, isAdmin: actor.role === "ADMIN", name: parsed.data.name, description: parsed.data.description ?? null, slug });
    return db.organization.findUniqueOrThrow({ where: { id } });
  }
  const org = await db.$transaction(async (tx) => {
    const o = await tx.organization.create({
      data: { name: parsed.data.name, slug, description: parsed.data.description, members: { create: { userId: actor.id, role: "OWNER" } } },
    });
    await audit(actor.id, "org.create", "Organization", o.id, { name: o.name }, tx);
    return o;
  });
  return org;
}

/** Dono da organização (ou admin da plataforma): só eles criam e removem outros admins da organização. */
async function isOrgOwnerOrPlatformAdmin(actor: Actor, orgId: string): Promise<boolean> {
  if (actor.role === "ADMIN") return true;
  const me = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: actor.id } }, select: { role: true } });
  return me?.role === "OWNER";
}

export async function addOrgMember(actorIn: Actor | null, orgId: string, username: string, role: "ADMIN" | "STAFF") {
  const actor = requireActor(actorIn);
  await assertOrgAccess(actor, orgId, "admin");
  if (role === "ADMIN" && !(await isOrgOwnerOrPlatformAdmin(actor, orgId))) throw new AppError("Só o dono da organização pode adicionar outro admin.", "FORBIDDEN");
  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!user) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  const existing = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: user.id } } });
  if (existing) throw new AppError("Esta pessoa já faz parte da organização.", "CONFLICT");
  const d1 = sitesDatabase();
  if (d1) return addD1OrgMember(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", orgId, userId: user.id, role });
  await db.orgMember.create({ data: { orgId, userId: user.id, role } });
  await audit(actor.id, "org.member.add", "Organization", orgId, { userId: user.id, role });
}

export async function removeOrgMember(actorIn: Actor | null, orgId: string, userId: string) {
  const actor = requireActor(actorIn);
  await assertOrgAccess(actor, orgId, "admin");
  const m = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!m) throw new AppError("Esta pessoa não faz parte da organização.", "NOT_FOUND");
  if (m.role === "OWNER") throw new AppError("O dono da organização não pode ser removido.");
  if (m.role === "ADMIN" && !(await isOrgOwnerOrPlatformAdmin(actor, orgId))) throw new AppError("Só o dono da organização pode remover um admin.", "FORBIDDEN");
  const d1 = sitesDatabase();
  if (d1) return removeD1OrgMember(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", orgId, userId });
  await db.orgMember.delete({ where: { id: m.id } });
  await audit(actor.id, "org.member.remove", "Organization", orgId, { userId });
}

/** Renomeia e/ou edita a descrição. O endereço (slug) não muda. Dono e admin da organização, ou um admin da plataforma. */
export async function updateOrganization(actorIn: Actor | null, orgId: string, input: { name: string; description?: string }) {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  await assertOrgAccess(actor, orgId, "admin"); // também recusa organização excluída
  const parsed = orgInput.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  await rateLimit(`org-update:${actor.id}`, 30, 3600, "Muitas alterações seguidas. Tente de novo em instantes.");
  const description = parsed.data.description || null;
  const d1 = sitesDatabase();
  if (d1) {
    await updateD1Organization(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", orgId, name: parsed.data.name, description });
    return db.organization.findUniqueOrThrow({ where: { id: orgId } });
  }
  return db.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (before.deletedAt) throw new AppError("Organização não encontrada.", "NOT_FOUND");
    const org = await tx.organization.update({ where: { id: orgId }, data: { name: parsed.data.name, description } });
    await audit(actor.id, "org.update", "Organization", orgId, { from: before.name, to: org.name }, tx);
    return org;
  });
}

/**
 * Exclui a organização (exclusão LÓGICA: ela some das listas e deixa de ser gerenciável; o histórico de campeonatos, pedidos e
 * premiações permanece). Só o dono (organizador) ou um admin da plataforma, e só digitando o nome exato da organização.
 * Não exclui com campeonato aberto/em andamento nem com premiação pendente de pagamento.
 */
export async function deleteOrganization(actorIn: Actor | null, orgId: string, input: { confirmName: string }) {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const found = await db.organization.findUnique({ where: { id: orgId }, include: { members: true } });
  if (!found || found.deletedAt) throw new AppError("Organização não encontrada.", "NOT_FOUND");
  const isOwner = found.members.some((m) => m.userId === actor.id && m.role === "OWNER");
  if (actor.role !== "ADMIN" && !(isOwner && actor.role === "ORGANIZER")) throw new AppError("Só o dono da organização ou um administrador pode excluí-la.", "FORBIDDEN");
  if ((input.confirmName ?? "").trim() !== found.name) throw new AppError("Para excluir, digite o nome exato da organização.");

  const d1 = sitesDatabase();
  if (d1) return deleteD1Organization(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", orgId, confirmName: input.confirmName.trim() });
  const now = new Date();
  await db.$transaction(
    async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, include: { members: true } });
      if (org.deletedAt) throw new AppError("Organização não encontrada.", "NOT_FOUND");
      const [active, prizes] = await Promise.all([
        tx.tournament.count({ where: { orgId, status: { in: ["REGISTRATION", "CHECK_IN", "LIVE"] } } }),
        tx.prizeAward.count({ where: { status: "PENDING", tournament: { orgId } } }),
      ]);
      const blockers: string[] = [];
      if (active) blockers.push(`${active} campeonato(s) aberto(s) ou em andamento (conclua ou cancele)`);
      if (prizes) blockers.push(`${prizes} premiação(ões) ainda não paga(s)`);
      if (blockers.length) throw new AppError(`Não é possível excluir a organização agora: ${blockers.join("; ")}.`);
      await tx.organization.update({ where: { id: orgId }, data: { deletedAt: now } });
      const drafts = await tx.tournament.count({ where: { orgId, status: "DRAFT" } });
      await audit(actor.id, "org.delete", "Organization", orgId, { name: org.name, byAdmin: !isOwner, drafts }, tx);
      await notify(
        org.members.filter((m) => m.userId !== actor.id).map((m) => m.userId),
        "org.deleted",
        `A organização ${org.name} foi excluída`,
        isOwner ? "O dono excluiu a organização." : "Um administrador da plataforma excluiu a organização.",
        "/organizar",
        tx,
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function myOrganizations(userId: string) {
  return db.orgMember.findMany({ where: { userId, org: { deletedAt: null } }, include: { org: true }, orderBy: { org: { name: "asc" } } });
}

export { uniqueSlug };
