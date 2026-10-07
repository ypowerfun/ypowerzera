import { randomInt } from "node:crypto";
import type { Coupon, Order, Prisma, Tournament } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { formatMoney, priceOrder, type PriceBreakdown } from "@/lib/money";
import { audit } from "./audit";
import { notify } from "./notifications";
import { assertOrgAccess, canManageOrg, requireActor } from "./permissions";
import { getProvider } from "./payments";
import type { Actor } from "./types";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newOrderNumber(now = new Date()): string {
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `PA-${ym}-${suffix}`;
}

// ───────────────────────── Cupons ─────────────────────────

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export async function findValidCoupon(tx: Tx, code: string, tournament: Pick<Tournament, "id" | "orgId">, now = new Date()): Promise<Coupon> {
  const coupon = await tx.coupon.findUnique({ where: { code: normalizeCouponCode(code) } });
  const invalid = new AppError("Cupom inválido ou expirado.");
  if (!coupon || !coupon.active) throw invalid;
  if (coupon.expiresAt && coupon.expiresAt < now) throw invalid;
  if (coupon.tournamentId && coupon.tournamentId !== tournament.id) throw invalid;
  if (coupon.orgId && coupon.orgId !== tournament.orgId) throw invalid;
  if (coupon.maxRedemptions !== null && coupon.redeemed >= coupon.maxRedemptions) throw new AppError("Este cupom atingiu o limite de usos.");
  return coupon;
}

export async function createCoupon(
  actorIn: Actor | null,
  input: { orgId: string; tournamentId?: string; code: string; percentOff?: number; amountOffCents?: number; maxRedemptions?: number; expiresAt?: Date | null },
) {
  const actor = requireActor(actorIn);
  await assertOrgAccess(actor, input.orgId, "admin");
  const code = normalizeCouponCode(input.code);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new AppError("O código deve ter de 3 a 24 caracteres (letras, números, - e _).");
  if (!input.percentOff && !input.amountOffCents) throw new AppError("Informe um desconto em % ou em valor.");
  if (input.percentOff && (input.percentOff < 1 || input.percentOff > 100)) throw new AppError("O desconto deve ficar entre 1% e 100%.");
  if (input.percentOff && input.amountOffCents) throw new AppError("Use desconto em % ou em valor, não os dois.");
  if (await db.coupon.findUnique({ where: { code } })) throw new AppError("Já existe um cupom com este código.", "CONFLICT");
  if (input.tournamentId) {
    const t = await db.tournament.findUnique({ where: { id: input.tournamentId } });
    if (!t || t.orgId !== input.orgId) throw new AppError("Campeonato inválido para este cupom.");
  }
  const coupon = await db.coupon.create({
    data: {
      code,
      orgId: input.orgId,
      tournamentId: input.tournamentId || null,
      percentOff: input.percentOff ?? null,
      amountOffCents: input.amountOffCents ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
  await audit(actor.id, "coupon.create", "Coupon", coupon.id, { code });
  return coupon;
}

// ───────────────────────── Pedidos ─────────────────────────

export function quote(tournament: Pick<Tournament, "entryFeeCents">, coupon?: Coupon | null): PriceBreakdown {
  return priceOrder(tournament.entryFeeCents, getEnv().platformFeeBps, coupon);
}

/**
 * Cria o pedido da inscrição dentro da transação de registro. Se o total for zero
 * (campeonato gratuito ou cupom de 100%), devolve null e o chamador registra direto.
 */
export async function createRegistrationOrder(
  tx: Tx,
  args: { userId: string; tournament: Tournament; participantId: string; coupon?: Coupon | null; now?: Date },
): Promise<Order | null> {
  const now = args.now ?? new Date();
  const price = quote(args.tournament, args.coupon);
  if (args.tournament.entryFeeCents === 0) return null;
  const expiresAt = new Date(now.getTime() + getEnv().reservationMinutes * 60_000);
  const free = price.totalCents === 0;
  if (args.coupon) await tx.coupon.update({ where: { id: args.coupon.id }, data: { redeemed: { increment: 1 } } });
  const order = await tx.order.create({
    data: {
      number: newOrderNumber(now),
      userId: args.userId,
      tournamentId: args.tournament.id,
      participantId: args.participantId,
      status: free ? "PAID" : "PENDING",
      currency: args.tournament.currency,
      subtotalCents: price.subtotalCents,
      discountCents: price.discountCents,
      serviceFeeCents: price.serviceFeeCents,
      totalCents: price.totalCents,
      couponId: args.coupon?.id ?? null,
      provider: free ? "free" : getEnv().paymentsProvider,
      method: free ? "free" : null,
      paidAt: free ? now : null,
      expiresAt,
    },
  });
  return order;
}

export async function getOrderForUser(actor: Actor, orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { tournament: true, participant: true, coupon: true } });
  if (!order) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  if (order.userId !== actor.id && !(await canManageOrg(actor, order.tournament.orgId, "staff"))) {
    // quem gerencia a organização do evento (e o admin) também vê; quem foi rebaixado a jogador, não
    throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  }
  return order;
}

/** Inicia o checkout no provedor e devolve a URL de pagamento. */
export async function startCheckout(actorIn: Actor | null, orderId: string): Promise<{ redirectUrl: string }> {
  const actor = requireActor(actorIn);
  const order = await db.order.findUnique({ where: { id: orderId }, include: { tournament: true, user: true } });
  if (!order || order.userId !== actor.id) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  if (order.status !== "PENDING") throw new AppError("Este pedido não está aguardando pagamento.");
  if (order.expiresAt < new Date()) {
    await expireStaleReservations(db, order.tournamentId);
    throw new AppError("A reserva da sua vaga expirou. Faça a inscrição novamente.");
  }
  const provider = getProvider();
  const base = getEnv().appUrl;
  const out = await provider.createCheckout({
    order,
    tournament: order.tournament,
    customerEmail: order.user.email,
    successUrl: `${base}/checkout/${order.id}/sucesso`,
    cancelUrl: `${base}/checkout/${order.id}/cancelado`,
  });
  await db.order.update({ where: { id: order.id }, data: { providerSessionId: out.sessionId ?? null, provider: provider.name } });
  return { redirectUrl: out.redirectUrl };
}

export interface PaymentInfo {
  paymentId?: string | null;
  method?: string | null;
  amountTotal?: number;
  currency?: string;
}

/**
 * Conclui o pedido (chamado pelo webhook da Stripe ou pelo checkout simulado). Idempotente.
 * Libera a vaga: participante PENDING_PAYMENT → REGISTERED. Se a reserva já tinha expirado
 * e a vaga foi perdida, o valor é reembolsado automaticamente.
 */
export async function completeOrder(orderId: string, info: PaymentInfo = {}): Promise<"paid" | "already" | "refunded" | "mismatch"> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { tournament: true, participant: true } });
  if (!order) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  if (order.status === "PAID" || order.status === "REFUNDED" || order.status === "PARTIALLY_REFUNDED") return "already";

  if (info.amountTotal !== undefined && (info.amountTotal !== order.totalCents || (info.currency && info.currency.toUpperCase() !== order.currency.toUpperCase()))) {
    await db.order.update({ where: { id: orderId }, data: { status: "FAILED", failureReason: "Valor pago diverge do pedido (revisão manual necessária)." } });
    await audit(null, "order.amount_mismatch", "Order", orderId, { expected: order.totalCents, got: info.amountTotal, currency: info.currency });
    return "mismatch";
  }

  const participant = order.participant;
  const reservationAlive = !!participant && ["PENDING_PAYMENT", "REGISTERED", "CHECKED_IN"].includes(participant.status);
  if (!reservationAlive || order.status === "EXPIRED" || order.status === "CANCELED") {
    // pagamento chegou tarde demais: marca como pago e devolve
    await db.order.update({
      where: { id: orderId },
      data: { status: "PAID", paidAt: new Date(), providerPaymentId: info.paymentId ?? null, method: info.method ?? null },
    });
    await refundOrderInternal(orderId, order.totalCents, "Pagamento recebido após a expiração da reserva da vaga.", null);
    await notify(order.userId, "order.refunded", "Pagamento reembolsado", `O pagamento do pedido ${order.number} chegou depois da reserva expirar e foi reembolsado.`, `/conta/pedidos`);
    return "refunded";
  }

  await db.$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date(), providerPaymentId: info.paymentId ?? undefined, method: info.method ?? undefined },
    });
    if (res.count === 0) return; // outro processo já concluiu
    if (participant && participant.status === "PENDING_PAYMENT") {
      await tx.participant.update({ where: { id: participant.id }, data: { status: "REGISTERED", reservedUntil: null } });
    }
    await notify(order.userId, "order.paid", "Inscrição confirmada", `Recebemos seu pagamento do pedido ${order.number}. Você está inscrito em ${order.tournament.name}.`, `/torneios/${order.tournament.slug}`, tx);
    await audit(order.userId, "order.paid", "Order", orderId, { method: info.method }, tx);
  });
  return "paid";
}

export async function failOrder(orderId: string, reason: string): Promise<void> {
  await db.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "FAILED", failureReason: reason.slice(0, 300) } });
}

/** Libera reservas vencidas: pedidos expiram e a vaga volta; a fila de espera é promovida. */
export async function expireStaleReservations(tx: Tx = db, tournamentId?: string, now = new Date()): Promise<number> {
  const stale = await tx.participant.findMany({
    where: { status: "PENDING_PAYMENT", reservedUntil: { lt: now }, ...(tournamentId ? { tournamentId } : {}) },
    select: { id: true, tournamentId: true },
  });
  for (const p of stale) {
    const orders = await tx.order.findMany({ where: { participantId: p.id, status: "PENDING" } });
    for (const o of orders) {
      await tx.order.update({ where: { id: o.id }, data: { status: "EXPIRED" } });
      if (o.couponId) await tx.coupon.update({ where: { id: o.couponId }, data: { redeemed: { decrement: 1 } } }).catch(() => undefined);
    }
    await releaseParticipant(tx, p.id);
  }
  const tournaments = [...new Set(stale.map((p) => p.tournamentId))];
  for (const id of tournaments) await promoteWaitlist(tx, id, now);
  return stale.length;
}

/** Remove a inscrição (e o elenco) liberando os jogadores para outras inscrições. */
export async function releaseParticipant(tx: Tx, participantId: string): Promise<void> {
  await tx.rosterEntry.deleteMany({ where: { participantId } });
  await tx.participant.delete({ where: { id: participantId } }).catch(() => undefined);
}

export async function activeCount(tx: Tx, tournamentId: string, now = new Date()): Promise<number> {
  return tx.participant.count({
    where: {
      tournamentId,
      OR: [{ status: { in: ["REGISTERED", "CHECKED_IN"] } }, { status: "PENDING_PAYMENT", reservedUntil: { gt: now } }],
    },
  });
}

/** Promove a fila de espera para as vagas livres. Pagos ganham uma janela de 24 h para pagar. */
export async function promoteWaitlist(tx: Tx, tournamentId: string, now = new Date()): Promise<void> {
  const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
  if (!t || (t.status !== "REGISTRATION" && t.status !== "CHECK_IN")) return;
  let free = t.maxParticipants - (await activeCount(tx, tournamentId, now));
  if (free <= 0) return;
  const queue = await tx.participant.findMany({ where: { tournamentId, status: "WAITLIST" }, orderBy: { registeredAt: "asc" }, take: free });
  for (const p of queue) {
    if (free <= 0) break;
    if (t.entryFeeCents === 0) {
      await tx.participant.update({ where: { id: p.id }, data: { status: "REGISTERED" } });
      await notify(p.userId, "waitlist.promoted", "Você entrou no campeonato!", `Abriu uma vaga em ${t.name} e sua inscrição foi confirmada.`, `/torneios/${t.slug}`, tx);
    } else {
      const reservedUntil = new Date(now.getTime() + 24 * 3600_000);
      await tx.participant.update({ where: { id: p.id }, data: { status: "PENDING_PAYMENT", reservedUntil } });
      const order = await createRegistrationOrder(tx, { userId: p.userId, tournament: t, participantId: p.id, now });
      if (order) await tx.order.update({ where: { id: order.id }, data: { expiresAt: reservedUntil } });
      await notify(p.userId, "waitlist.promoted", "Abriu uma vaga para você!", `Pague a inscrição de ${t.name} em até 24 horas para garantir a vaga.`, order ? `/checkout/${order.id}` : `/torneios/${t.slug}`, tx);
    }
    free--;
  }
}

/** Desiste de pagar: cancela o pedido e libera a vaga. */
export async function cancelPendingOrder(actorIn: Actor | null, orderId: string): Promise<void> {
  const actor = requireActor(actorIn);
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== actor.id) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  if (order.status !== "PENDING") return;
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: "CANCELED" } });
    if (order.couponId) await tx.coupon.update({ where: { id: order.couponId }, data: { redeemed: { decrement: 1 } } }).catch(() => undefined);
    if (order.participantId) await releaseParticipant(tx, order.participantId);
    await promoteWaitlist(tx, order.tournamentId);
  });
}

// ───────────────────────── Reembolso ─────────────────────────

async function refundOrderInternal(orderId: string, amountCents: number, reason: string, createdById: string | null): Promise<void> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  const remaining = order.totalCents - order.refundedCents;
  if (amountCents <= 0 || amountCents > remaining) throw new AppError("Valor de reembolso inválido.");
  let refundId: string | undefined;
  if (order.provider !== "free") {
    const provider = getProviderByName(order.provider);
    refundId = (await provider.refund(order, amountCents, reason)).refundId;
  }
  const refunded = order.refundedCents + amountCents;
  await db.$transaction([
    db.refund.create({ data: { orderId, amountCents, reason, providerRefundId: refundId, createdById } }),
    db.order.update({ where: { id: orderId }, data: { refundedCents: refunded, status: refunded >= order.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED" } }),
  ]);
}

function getProviderByName(name: string) {
  const p = getProvider();
  if (p.name !== name) {
    // pedidos antigos criados com outro provedor só podem ser reembolsados por ele
    throw new AppError(`Este pedido foi pago via "${name}", que não é o provedor ativo.`);
  }
  return p;
}

/** Reembolso manual feito pela organização. Reembolso total remove a inscrição (se o campeonato não começou). */
export async function refundOrder(actorIn: Actor | null, orderId: string, input: { amountCents?: number; reason: string }) {
  const actor = requireActor(actorIn);
  const order = await db.order.findUnique({ where: { id: orderId }, include: { tournament: true } });
  if (!order) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  await assertOrgAccess(actor, order.tournament.orgId, "admin");
  if (order.status !== "PAID" && order.status !== "PARTIALLY_REFUNDED") throw new AppError("Só é possível reembolsar pedidos pagos.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AppError("Informe o motivo do reembolso.");
  const amount = input.amountCents ?? order.totalCents - order.refundedCents;
  await refundOrderInternal(orderId, amount, reason, actor.id);
  const updated = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (updated.status === "REFUNDED" && order.participantId && ["DRAFT", "REGISTRATION", "CHECK_IN"].includes(order.tournament.status)) {
    await db.$transaction(async (tx) => {
      await releaseParticipant(tx, order.participantId!);
      await promoteWaitlist(tx, order.tournamentId);
    });
  }
  await audit(actor.id, "order.refund", "Order", orderId, { amount, reason });
  await notify(order.userId, "order.refunded", "Reembolso realizado", `Reembolsamos ${formatMoney(amount, order.currency)} do pedido ${order.number}.`, "/conta/pedidos");
  return updated;
}

/** Reembolso automático ao desistir antes do check-in (política padrão da plataforma). */
export async function autoRefundOnWithdrawal(orderId: string): Promise<void> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || (order.status !== "PAID" && order.status !== "PARTIALLY_REFUNDED")) return;
  const remaining = order.totalCents - order.refundedCents;
  if (remaining > 0) await refundOrderInternal(orderId, remaining, "Desistência antes do check-in (reembolso automático).", null);
}

export async function ordersOfUser(userId: string) {
  return db.order.findMany({ where: { userId }, include: { tournament: true }, orderBy: { createdAt: "desc" } });
}

export type { Prisma };
