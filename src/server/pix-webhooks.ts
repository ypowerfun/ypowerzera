import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "./audit";
import { rateLimit } from "./rate-limit";
import { confirmDeposit, expireDepositByCharge, reverseDeposit } from "./deposits";
import { getPixProvider, type PixEvent } from "./pix";
import { findCheckoutSessionId } from "./pix/stripe";
import { authorizeTransfer, handleTransferEvent } from "./withdrawals";

export interface HttpResult {
  status: number;
  body: unknown;
}

/**
 * Aplica UM evento já autenticado. O corpo só aponta a cobrança; quem decide é a máquina de estados, que reconsulta o provedor.
 * Compartilhado com o webhook do Stripe (stripe-webhook.ts), que recebe depósitos e inscrições no mesmo endereço.
 */
export async function applyPixEvent(ev: PixEvent): Promise<string> {
  switch (ev.type) {
    case "CHARGE_PAID":
      return ev.chargeId ? confirmDeposit(ev.chargeId) : "ignored";
    case "CHARGE_EXPIRED":
      return ev.chargeId ? expireDepositByCharge(ev.chargeId) : "ignored";
    case "CHARGE_REVERSED": {
      // O Stripe avisa do estorno/contestação pelo pagamento (PaymentIntent): a sessão do depósito é achada consultando o Stripe.
      const chargeId = ev.chargeId ?? (ev.paymentIntentId ? await findCheckoutSessionId(ev.paymentIntentId) : null);
      return chargeId ? reverseDeposit(chargeId) : "ignored";
    }
    case "TRANSFER_DONE":
    case "TRANSFER_FAILED":
      return handleTransferEvent(ev.type, { transferId: ev.transferId, externalReference: ev.externalReference });
    default:
      return "ignored";
  }
}

/**
 * Webhook do provedor Pix. Ordem de defesa:
 *  1. autenticidade (assinatura/token, comparação em tempo constante) — sem isso, 401 e nada é lido;
 *  2. o corpo só diz "olhe a cobrança X": o estado real é reconsultado no provedor;
 *  3. idempotência por evento + máquinas de estado atômicas (reentregas e corridas não duplicam dinheiro);
 *  4. em caso de erro interno devolve 500 para o provedor reenviar.
 */
export async function handlePixWebhook(headers: Headers, rawBody: string): Promise<HttpResult> {
  let provider;
  try {
    provider = getPixProvider();
  } catch {
    return { status: 503, body: { error: "unavailable" } };
  }
  if (!provider.verifyWebhook(headers, rawBody)) {
    console.warn("[pix-webhook] assinatura/token inválido");
    // Qualquer pessoa da internet pode chamar este endereço sem assinatura: no máximo 5 registros a cada 10 minutos,
    // senão cada requisição forjada gravaria uma linha no banco (disco enchendo).
    await rateLimit("webhook-rejected-audit", 5, 600)
      .then(() => audit(null, "security.webhook_rejected", "Webhook", provider.name, { reason: "invalid_signature" }))
      .catch(() => undefined);
    return { status: 401, body: { error: "unauthorized" } };
  }
  let events;
  try {
    events = provider.parseWebhook(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_payload" } };
  }
  const results: Array<{ id: string; result: string }> = [];
  try {
    for (const ev of events) {
      const result = await applyPixEvent(ev);
      if (ev.id) {
        // registro de eventos já tratados (o processamento em si já é idempotente pelas máquinas de estado)
        const seen = await db.paymentEvent.findUnique({ where: { provider_eventId: { provider: provider.name, eventId: ev.id } } });
        if (!seen) {
          await db.paymentEvent.create({ data: { provider: provider.name, eventId: ev.id, type: ev.type } }).catch((e: unknown) => {
            if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
          });
        }
      }
      results.push({ id: ev.id, result });
    }
  } catch (e) {
    console.error("[pix-webhook] erro ao processar", e instanceof Error ? e.message : e);
    return { status: 500, body: { error: "processing_failed" } };
  }
  return { status: 200, body: { ok: true, results } };
}

/** Endpoint de autorização de transferência (o provedor consulta antes de executar cada saque feito via API). */
export async function handleTransferAuthorization(headers: Headers, rawBody: string): Promise<HttpResult> {
  let provider;
  try {
    provider = getPixProvider();
  } catch {
    return { status: 503, body: { error: "unavailable" } };
  }
  // Provedor que não paga Pix (Stripe) não tem o que autorizar: o saque é pago à mão pelo administrador.
  if (!provider.canSendPix) return { status: 404, body: { error: "not_applicable" } };
  if (!provider.verifyTransferAuthorization(headers, rawBody)) {
    await rateLimit("transfer-auth-rejected-audit", 5, 600)
      .then(() => audit(null, "security.transfer_auth_rejected", "Webhook", provider.name, { reason: "invalid_signature" }))
      .catch(() => undefined);
    return { status: 401, body: { error: "unauthorized" } };
  }
  let req;
  try {
    req = provider.parseTransferAuthorization(rawBody);
  } catch {
    return { status: 400, body: provider.formatTransferAuthResponse({ approved: false, reason: "payload inválido" }) };
  }
  const result = await authorizeTransfer(req);
  return { status: 200, body: provider.formatTransferAuthResponse(result) };
}
