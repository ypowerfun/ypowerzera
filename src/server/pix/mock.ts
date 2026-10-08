import { db } from "@/lib/db";
import { mockWebhookSecret, randomToken } from "@/lib/crypto";
import { signPayload, verifySignature } from "@/lib/signature";
import type { ChargeInfo, PixEvent, PixProvider, TransferAuthRequest, TransferInfo } from "./types";

/**
 * Provedor Pix SIMULADO. Funciona só em desenvolvimento/testes e persiste o estado no banco.
 * Os webhooks simulados são ASSINADOS (HMAC) e passam exatamente pelo mesmo código de produção.
 */
export const mockPix: PixProvider = {
  name: "mock",
  canSendPix: true,

  async createCharge({ externalReference, amountCents }) {
    const row = await db.mockPixCharge.create({ data: { amountCents, externalReference } });
    return { chargeId: row.id, copyPaste: `00020126MOCKPIX${row.id}5204000053039865406${(amountCents / 100).toFixed(2)}6304ABCD`, qrImage: null };
  },

  async getCharge(chargeId): Promise<ChargeInfo> {
    const row = await db.mockPixCharge.findUnique({ where: { id: chargeId } });
    if (!row) return { status: "CANCELED", amountCents: 0, payerDocument: null };
    return { status: row.status as ChargeInfo["status"], amountCents: row.amountCents, payerDocument: row.payerDoc };
  },

  verifyWebhook(headers, rawBody) {
    return verifySignature(rawBody, headers.get("x-mock-signature"), mockWebhookSecret());
  },

  parseWebhook(rawBody): PixEvent[] {
    const b = JSON.parse(rawBody) as { id?: string; type?: string; chargeId?: string; transferId?: string; externalReference?: string };
    const map: Record<string, PixEvent["type"]> = {
      "charge.paid": "CHARGE_PAID",
      "charge.reversed": "CHARGE_REVERSED",
      "transfer.done": "TRANSFER_DONE",
      "transfer.failed": "TRANSFER_FAILED",
    };
    return [{ id: String(b.id ?? ""), type: map[b.type ?? ""] ?? "IGNORED", chargeId: b.chargeId, transferId: b.transferId, externalReference: b.externalReference }];
  },

  async sendPix({ externalReference, amountCents, pixKey }) {
    const existing = await db.mockPixTransfer.findUnique({ where: { externalReference } });
    if (existing) return { transferId: existing.id, status: existing.status as TransferInfo["status"], endToEndId: existing.endToEndId };
    const row = await db.mockPixTransfer.create({ data: { externalReference, amountCents, pixKey } });
    return { transferId: row.id, status: "PENDING" };
  },

  async getTransfer(transferId): Promise<TransferInfo> {
    const row = await db.mockPixTransfer.findUnique({ where: { id: transferId } });
    if (!row) return { status: "FAILED", failureReason: "Transferência inexistente" };
    return { status: row.status as TransferInfo["status"], endToEndId: row.endToEndId };
  },

  verifyTransferAuthorization(headers, rawBody) {
    return verifySignature(rawBody, headers.get("x-mock-signature"), mockWebhookSecret());
  },

  parseTransferAuthorization(rawBody): TransferAuthRequest {
    const b = JSON.parse(rawBody) as { transferId?: string; externalReference?: string; amountCents?: number; pixKey?: string };
    return { transferId: b.transferId ?? null, externalReference: b.externalReference ?? null, amountCents: Number(b.amountCents ?? 0), pixKey: b.pixKey ?? null };
  },

  formatTransferAuthResponse: (r) => ({ approved: r.approved, reason: r.reason ?? null }),
};

// ───────────── Auxiliares de simulação (dev/testes) ─────────────

export function buildMockWebhook(body: Record<string, unknown>): { rawBody: string; headers: Headers } {
  const rawBody = JSON.stringify({ id: `evt_${randomToken(8)}`, ...body });
  return { rawBody, headers: new Headers({ "x-mock-signature": signPayload(rawBody, mockWebhookSecret()) }) };
}

/** Marca a cobrança como paga no provedor simulado e devolve o webhook assinado correspondente. */
export async function mockPayCharge(chargeId: string, payerDoc: string | null) {
  const row = await db.mockPixCharge.update({ where: { id: chargeId }, data: { status: "PAID", payerDoc } });
  return buildMockWebhook({ type: "charge.paid", chargeId: row.id, externalReference: row.externalReference });
}

export async function mockReverseCharge(chargeId: string) {
  const row = await db.mockPixCharge.update({ where: { id: chargeId }, data: { status: "REVERSED" } });
  return buildMockWebhook({ type: "charge.reversed", chargeId: row.id, externalReference: row.externalReference });
}

export async function mockFinishTransfer(transferId: string, ok: boolean) {
  const row = await db.mockPixTransfer.update({
    where: { id: transferId },
    data: { status: ok ? "DONE" : "FAILED", endToEndId: ok ? `E${randomToken(16).replace(/[^A-Za-z0-9]/g, "A").slice(0, 31)}` : null },
  });
  return buildMockWebhook({ type: ok ? "transfer.done" : "transfer.failed", transferId: row.id, externalReference: row.externalReference });
}

/** Corpo assinado que o provedor enviaria para autorizar uma transferência. */
export function mockTransferAuthRequest(args: { transferId?: string; externalReference: string; amountCents: number; pixKey: string }) {
  return buildMockWebhook({ ...args });
}
