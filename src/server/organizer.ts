import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "./audit";
import { notify } from "./notifications";
import { assertTournamentAccess, requireActor } from "./permissions";
import type { Actor } from "./types";

export async function organizerOverview(actor: Pick<Actor, "id" | "role">) {
  const userId = actor.id;
  const isAdmin = actor.role === "ADMIN";
  // quem voltou a ser jogador só gerencia onde é equipe de apoio (STAFF): é a mesma regra de canManageOrg
  const memberships = await db.orgMember.findMany({ where: { userId, ...(isAdmin || actor.role === "ORGANIZER" ? {} : { role: "STAFF" as const }) }, include: { org: true } });
  const orgIds = memberships.map((m) => m.orgId);
  // o admin gerencia TODAS as organizações; os demais, só aquelas de que fazem parte
  const orgs = isAdmin
    ? (await db.organization.findMany({ orderBy: { name: "asc" } })).map((o) => ({ id: o.id, name: o.name, role: (memberships.find((m) => m.orgId === o.id)?.role ?? "PLATFORM") as "OWNER" | "ADMIN" | "STAFF" | "PLATFORM" }))
    : memberships.map((m) => ({ id: m.orgId, name: m.org.name, role: m.role as "OWNER" | "ADMIN" | "STAFF" | "PLATFORM" }));
  const tournaments = await db.tournament.findMany({
    where: isAdmin ? {} : { orgId: { in: orgIds } },
    orderBy: { startsAt: "desc" },
    take: 50,
    include: { org: { select: { name: true } }, _count: { select: { participants: { where: { status: { in: ["REGISTERED", "CHECKED_IN", "PENDING_PAYMENT"] } } } } } },
  });
  return { memberships, orgs, tournaments };
}

export async function markPrizePaid(actorIn: Actor | null, awardId: string, note?: string) {
  const actor = requireActor(actorIn);
  const a = await db.prizeAward.findUnique({ where: { id: awardId }, include: { tournament: true, participant: true } });
  if (!a) throw new AppError("Premiação não encontrada.", "NOT_FOUND");
  await assertTournamentAccess(actor, a.tournament, "admin");
  if (a.status === "PAID") return;
  await db.prizeAward.update({ where: { id: awardId }, data: { status: "PAID", paidAt: new Date(), note: note?.trim().slice(0, 200) || null } });
  await audit(actor.id, "prize.paid", "PrizeAward", awardId, { amountCents: a.amountCents });
  await notify(a.participant.userId, "prize.paid", "Premiação paga", `Sua premiação de ${a.tournament.name} (${a.placement}º lugar) foi marcada como paga.`, `/torneios/${a.tournament.slug}`);
}

export async function financials(tournamentId: string) {
  const orders = await db.order.findMany({ where: { tournamentId }, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { displayName: true, username: true } }, coupon: true } });
  const paid = orders.filter((o) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.status));
  const gross = paid.reduce((s, o) => s + o.subtotalCents - o.discountCents, 0);
  const refunded = paid.reduce((s, o) => s + o.refundedCents, 0);
  const fees = paid.reduce((s, o) => s + o.serviceFeeCents, 0);
  const coupons = await db.coupon.findMany({ where: { tournamentId }, orderBy: { createdAt: "desc" } });
  const prizes = await db.prizeAward.findMany({ where: { tournamentId }, orderBy: { placement: "asc" }, include: { participant: { select: { name: true } } } });
  return { orders, gross, refunded, fees, coupons, prizes, paidCount: paid.length };
}
