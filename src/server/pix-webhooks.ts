import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "./audit";
import { confirmDeposit, reverseDeposit } from "./deposits";
import { getPixProvider } from "./pix";
import { authorizeTransfer, handleTransferEvent } from "./withdrawals";

export interface HttpResult {
  status: number;
  body: unknown;
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
    await audit(null, "security.webhook_rejected", "Webhook", provider.name, { reason: "invalid_signature" }).catch(() => undefined);
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
      let result = "ignored";
      switch (ev.type) {
        case "CHARGE_PAID":
          if (ev.chargeId) result = await confirmDeposit(ev.chargeId);
          break;
        case "CHARGE_REVERSED":
          if (ev.chargeId) result = await reverseDeposit(ev.chargeId);
          break;
        case "TRANSFER_DONE":
        case "TRANSFER_FAILED":
          result = await handleTransferEvent(ev.type, { transferId: ev.transferId, externalReference: ev.externalReference });
          break;
      }
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
  if (!provider.verifyTransferAuthorization(headers, rawBody)) {
    await audit(null, "security.transfer_auth_rejected", "Webhook", provider.name, { reason: "invalid_signature" }).catch(() => undefined);
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
