import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { completeOrder, expireStaleReservations, failOrder, releaseParticipant } from "./orders";
import { verifyStripeSignature } from "./payments/stripe";
import type { HttpResult } from "./pix-webhooks";

const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z
      .object({
        id: z.string().optional(),
        client_reference_id: z.string().nullish(),
        metadata: z.record(z.string(), z.string()).nullish(),
        payment_status: z.string().optional(),
        payment_intent: z.string().nullish(),
        amount_total: z.number().nullish(),
        currency: z.string().nullish(),
      })
      .passthrough(),
  }),
});

/**
 * Webhook da Stripe: assinatura verificada (HMAC + tolerância), evento idempotente, valor e moeda conferidos
 * contra o pedido. O pedido é identificado por `client_reference_id`/metadata criados por nós.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<HttpResult> {
  const { stripeWebhookSecret } = getEnv();
  if (!stripeWebhookSecret || !verifyStripeSignature(rawBody, signature, stripeWebhookSecret)) {
    return { status: 400, body: { error: "invalid_signature" } };
  }
  let ev;
  try {
    ev = eventSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, body: { error: "invalid_payload" } };
  }
  const seen = await db.paymentEvent.findUnique({ where: { provider_eventId: { provider: "stripe", eventId: ev.id } } });
  if (seen) return { status: 200, body: { ok: true, duplicate: true } };

  const obj = ev.data.object;
  const orderId = obj.client_reference_id ?? obj.metadata?.orderId ?? null;
  try {
    // pedido desconhecido (ex.: conta Stripe compartilhada com outro produto): ignora com 200, sem pedir reenvio
    const known = orderId ? await db.order.findUnique({ where: { id: orderId }, select: { id: true } }) : null;
    if (orderId && known) {
      switch (ev.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          if (obj.payment_status === "paid") {
            await completeOrder(orderId, { paymentId: obj.payment_intent ?? undefined, method: "stripe", amountTotal: obj.amount_total ?? undefined, currency: obj.currency ?? undefined });
          }
          break;
        case "checkout.session.async_payment_failed":
          await failOrder(orderId, "Pagamento não aprovado pelo provedor.");
          break;
        case "checkout.session.expired": {
          const order = await db.order.findUnique({ where: { id: orderId } });
          if (order?.status === "PENDING") {
            await db.$transaction(async (tx) => {
              await tx.order.update({ where: { id: orderId }, data: { status: "EXPIRED" } });
              if (order.participantId) await releaseParticipant(tx, order.participantId);
            });
            await expireStaleReservations(db, order.tournamentId);
          }
          break;
        }
      }
    }
    await db.paymentEvent.create({ data: { provider: "stripe", eventId: ev.id, type: ev.type } }).catch((e: unknown) => {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    });
  } catch (e) {
    console.error("[stripe-webhook] erro", e instanceof Error ? e.message : e);
    return { status: 500, body: { error: "processing_failed" } };
  }
  return { status: 200, body: { ok: true } };
}
