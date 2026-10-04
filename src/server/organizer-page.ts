import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canManageOrg } from "./permissions";
import { requireUser, toActor } from "./session";

/** Carrega o campeonato para as telas de gestão. Quem não é da organização recebe 404 (não revela a existência). */
export async function loadManaged(id: string) {
  const user = await requireUser(`/organizar/${id}`);
  const t = await db.tournament.findUnique({ where: { id }, include: { org: true, stages: { orderBy: { order: "asc" } } } });
  if (!t) notFound();
  const actor = toActor(user);
  if (!(await canManageOrg(actor, t.orgId, "staff"))) notFound();
  const admin = await canManageOrg(actor, t.orgId, "admin");
  return { user, actor, t, admin };
}

export function requireNotStarted(t: { status: string }, id: string) {
  if (["LIVE", "COMPLETED", "CANCELED"].includes(t.status)) redirect(`/organizar/${id}`);
}
