import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import { audit } from "./audit";
import { assertOrgAccess, requireActor, requireOrganizer, requireVerified } from "./permissions";
import { rateLimit } from "./rate-limit";
import type { Actor } from "./types";

async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "item";
  let slug = root;
  for (let i = 2; await exists(slug); i++) slug = `${root}-${i}`;
  return slug;
}

export async function createOrganization(actorIn: Actor | null, input: { name: string; description?: string }) {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  requireOrganizer(actor);
  const parsed = z
    .object({ name: z.string().trim().min(3, "Nome da organização: mínimo de 3 caracteres.").max(60), description: z.string().trim().max(500).optional() })
    .safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  await rateLimit(`org-create:${actor.id}`, 5, 86400, "Você já criou várias organizações hoje.");
  const slug = await uniqueSlug(parsed.data.name, async (s) => !!(await db.organization.findUnique({ where: { slug: s } })));
  const org = await db.$transaction(async (tx) => {
    const o = await tx.organization.create({
      data: { name: parsed.data.name, slug, description: parsed.data.description, members: { create: { userId: actor.id, role: "OWNER" } } },
    });
    await audit(actor.id, "org.create", "Organization", o.id, { name: o.name }, tx);
    return o;
  });
  return org;
}

export async function addOrgMember(actorIn: Actor | null, orgId: string, username: string, role: "ADMIN" | "STAFF") {
  const actor = requireActor(actorIn);
  await assertOrgAccess(actor, orgId, "admin");
  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!user) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  const existing = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: user.id } } });
  if (existing) throw new AppError("Esta pessoa já faz parte da organização.", "CONFLICT");
  await db.orgMember.create({ data: { orgId, userId: user.id, role } });
  await audit(actor.id, "org.member.add", "Organization", orgId, { userId: user.id, role });
}

export async function removeOrgMember(actorIn: Actor | null, orgId: string, userId: string) {
  const actor = requireActor(actorIn);
  await assertOrgAccess(actor, orgId, "admin");
  const m = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!m) return;
  if (m.role === "OWNER") throw new AppError("O dono da organização não pode ser removido.");
  await db.orgMember.delete({ where: { id: m.id } });
  await audit(actor.id, "org.member.remove", "Organization", orgId, { userId });
}

export async function myOrganizations(userId: string) {
  return db.orgMember.findMany({ where: { userId }, include: { org: true }, orderBy: { org: { name: "asc" } } });
}

export { uniqueSlug };
