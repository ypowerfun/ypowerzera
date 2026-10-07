import { z } from "zod";
import { safeEqual } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import type { ChargeInfo, PixEvent, PixProvider, TransferAuthRequest, TransferInfo } from "./types";

/**
 * Adaptador do Asaas (Pix cobrança e Pix transferência).
 *
 * ⚠️ NÃO VALIDADO contra a API real/sandbox: foi escrito a partir do conhecimento público da API e a documentação
 * oficial não pôde ser consultada ao implementar. Por isso é defensivo — toda resposta é validada com zod, nada é
 * creditado por resposta de API (só após webhook autenticado + reconsulta + conferência de valor) e qualquer erro
 * faz o fluxo falhar com segurança (depósito não credita; saque volta o saldo). Valide no SANDBOX
 * (ASAAS_ENV=sandbox, padrão) antes de ir à produção.
 *
 * Autenticação dos webhooks: o Asaas envia o token configurado no cabeçalho `asaas-access-token`.
 * Autorização de saque: com o "mecanismo de validação de saque via webhook" do Asaas ativo, cada transferência feita por
 * API é submetida ao nosso servidor antes de ser executada (veja server/pix-webhooks.ts → authorizeTransfer).
 */

const base = () => (getEnv().asaasEnv === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3");

async function call(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown> {
  const { asaasApiKey } = getEnv();
  if (!asaasApiKey) throw new AppError("Provedor Pix não configurado.");
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", access_token: asaasApiKey, "User-Agent": "prime-arena" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* corpo não-JSON */
  }
  if (!res.ok) {
    console.error(`[asaas] ${method} ${path} → ${res.status}`);
    throw new AppError("O provedor de pagamentos recusou ou não respondeu. Tente novamente em instantes.");
  }
  return json;
}

const customerSchema = z.object({ id: z.string() });
const paymentSchema = z.object({ id: z.string(), status: z.string(), value: z.number(), pixTransaction: z.string().nullish() });
const qrSchema = z.object({ payload: z.string(), encodedImage: z.string().nullish() });
const transferSchema = z.object({ id: z.string(), status: z.string(), endToEndIdentifier: z.string().nullish(), failReason: z.string().nullish() });

const toCents = (v: number) => Math.round(v * 100);
const toReais = (cents: number) => Number((cents / 100).toFixed(2));

function chargeStatus(s: string): ChargeInfo["status"] {
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(s)) return "PAID";
  if (["REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE"].includes(s)) return "REVERSED";
  if (s === "OVERDUE") return "EXPIRED";
  if (s === "DELETED") return "CANCELED";
  return "PENDING";
}

function transferStatus(s: string): TransferInfo["status"] {
  if (s === "DONE") return "DONE";
  if (["FAILED", "CANCELLED", "CANCELED", "REFUSED"].includes(s)) return "FAILED";
  return "PENDING";
}

export const asaasPix: PixProvider = {
  name: "asaas",

  async createCharge({ externalReference, amountCents, expiresAt, payer }) {
    const customer = customerSchema.parse(await call("POST", "/customers", { name: payer.name, cpfCnpj: payer.cpf, externalReference: `payer:${payer.cpf.slice(-4)}` }));
    const payment = paymentSchema.parse(
      await call("POST", "/payments", {
        customer: customer.id,
        billingType: "PIX",
        value: toReais(amountCents),
        dueDate: expiresAt.toISOString().slice(0, 10),
        externalReference,
        description: "Créditos Prime Arena",
      }),
    );
    const qr = qrSchema.parse(await call("GET", `/payments/${payment.id}/pixQrCode`));
    return { chargeId: payment.id, copyPaste: qr.payload, qrImage: qr.encodedImage ?? null };
  },

  async getCharge(chargeId): Promise<ChargeInfo> {
    const p = paymentSchema.parse(await call("GET", `/payments/${encodeURIComponent(chargeId)}`));
    // O documento do pagador não vem neste objeto: fica desconhecido (null) e o sistema trata como "não verificado".
    return { status: chargeStatus(p.status), amountCents: toCents(p.value), payerDocument: null };
  },

  verifyWebhook(headers) {
    const { asaasWebhookToken } = getEnv();
    const got = headers.get("asaas-access-token");
    return !!asaasWebhookToken && !!got && safeEqual(got, asaasWebhookToken);
  },

  parseWebhook(rawBody): PixEvent[] {
    const b = z
      .object({ id: z.string().optional(), event: z.string(), payment: z.object({ id: z.string(), externalReference: z.string().nullish() }).optional(), transfer: z.object({ id: z.string(), externalReference: z.string().nullish() }).optional() })
      .parse(JSON.parse(rawBody));
    const id = b.id ?? `${b.event}:${b.payment?.id ?? b.transfer?.id}`;
    if (b.payment) {
      if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(b.event)) return [{ id, type: "CHARGE_PAID", chargeId: b.payment.id, externalReference: b.payment.externalReference ?? undefined }];
      if (["PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_REFUND_IN_PROGRESS"].includes(b.event)) return [{ id, type: "CHARGE_REVERSED", chargeId: b.payment.id }];
    }
    if (b.transfer) {
      if (b.event === "TRANSFER_DONE") return [{ id, type: "TRANSFER_DONE", transferId: b.transfer.id, externalReference: b.transfer.externalReference ?? undefined }];
      if (["TRANSFER_FAILED", "TRANSFER_CANCELLED"].includes(b.event)) return [{ id, type: "TRANSFER_FAILED", transferId: b.transfer.id, externalReference: b.transfer.externalReference ?? undefined }];
    }
    return [{ id, type: "IGNORED" }];
  },

  async sendPix({ externalReference, amountCents, pixKey, description }) {
    const t = transferSchema.parse(
      await call("POST", "/transfers", {
        value: toReais(amountCents),
        pixAddressKey: pixKey,
        pixAddressKeyType: "CPF",
        description: `${description} WD:${externalReference}`.slice(0, 140),
        externalReference,
      }),
    );
    return { transferId: t.id, status: transferStatus(t.status), endToEndId: t.endToEndIdentifier ?? null };
  },

  async getTransfer(transferId): Promise<TransferInfo> {
    const t = transferSchema.parse(await call("GET", `/transfers/${encodeURIComponent(transferId)}`));
    return { status: transferStatus(t.status), endToEndId: t.endToEndIdentifier ?? null, failureReason: t.failReason ?? null };
  },

  verifyTransferAuthorization(headers) {
    const { asaasTransferAuthToken } = getEnv();
    const got = headers.get("asaas-access-token");
    return !!asaasTransferAuthToken && !!got && safeEqual(got, asaasTransferAuthToken);
  },

  parseTransferAuthorization(rawBody): TransferAuthRequest {
    const b = z
      .object({
        transfer: z
          .object({ id: z.string().nullish(), value: z.number(), externalReference: z.string().nullish(), description: z.string().nullish(), pixAddressKey: z.string().nullish() })
          .optional(),
        value: z.number().optional(),
      })
      .parse(JSON.parse(rawBody));
    const t = b.transfer;
    const fromDescription = t?.description?.match(/WD:([A-Za-z0-9]+)/)?.[1];
    return {
      transferId: t?.id ?? null,
      externalReference: t?.externalReference ?? fromDescription ?? null,
      amountCents: toCents(t?.value ?? b.value ?? 0),
      pixKey: t?.pixAddressKey ?? null,
    };
  },

  // Formato de resposta do mecanismo de validação de saque do Asaas (conforme a documentação pública; validar no sandbox).
  formatTransferAuthResponse: (r) => (r.approved ? { status: "APPROVED" } : { status: "REFUSED", refuseReason: (r.reason ?? "Recusado").slice(0, 200) }),
};
