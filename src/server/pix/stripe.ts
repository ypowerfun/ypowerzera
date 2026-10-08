import { z } from "zod";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { onlyDigits } from "@/lib/cpf";
import { verifyStripeSignature } from "../payments/stripe";
import type { ChargeInfo, PixEvent, PixProvider } from "./types";

/**
 * Adaptador do Stripe para os DEPÓSITOS da carteira: a cobrança é uma sessão do Stripe Checkout só com Pix (BRL).
 *
 * Diferenças para o Asaas:
 *  - o QR Code fica numa página hospedada pelo Stripe: o endereço dela vai em `pixCopyPaste` (sem mudar o banco) e a tela mostra
 *    o botão "Pagar com Pix" em vez do QR + copia-e-cola;
 *  - o Stripe NÃO paga Pix a terceiros: `canSendPix` é falso e o saque é pago à mão pelo administrador (veja withdrawals.ts);
 *  - o CPF de quem pagou só existe se o pagador o digitar na página do Stripe (campo personalizado `custom_fields` do Checkout). É um dado DECLARADO, não
 *    confirmado pelo banco: sem ele (ou com outro CPF) o depósito fica retido para o administrador conferir.
 *
 * ⚠️ NÃO VALIDADO contra a API real: a documentação oficial (docs.stripe.com) não pôde ser aberta ao escrever isto. Por isso é
 * defensivo como o do Asaas — toda resposta passa por zod, nada é creditado por resposta de API ou corpo de webhook (só após
 * webhook autenticado + reconsulta + conferência de valor, moeda e CPF) e qualquer erro faz o fluxo falhar com segurança.
 * Valide no modo de teste do Stripe antes de operar (veja docs/CONFIGURAR_PIX.md).
 */

const API = "https://api.stripe.com/v1";
/** Versão da API fixada: trocar a versão padrão da conta no painel não pode mudar, em silêncio, o formato que este código lê. */
const API_VERSION = "2025-09-30.clover";
const GENERIC_ERROR = "O provedor de pagamentos recusou ou não respondeu. Tente novamente em instantes.";
const NO_PAYOUT = "O Stripe não paga Pix a terceiros: o saque é pago manualmente pelo administrador.";

/** Marca que identifica, nos eventos, as sessões que são depósitos (as de inscrição em campeonato não têm). */
export const DEPOSIT_KIND = "wallet_deposit";

/** Só letras minúsculas e "_" (tipo/código de erro do Stripe) vão para o log; qualquer outra coisa pode carregar dado sensível. */
const logTag = (v: unknown) => (typeof v === "string" && /^[a-z_]{1,64}$/.test(v) ? v : "-");

async function call<T>(
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  opts: { form?: Record<string, string>; query?: Record<string, string>; idempotencyKey?: string } = {},
): Promise<T> {
  const { stripeSecretKey } = getEnv();
  if (!stripeSecretKey) throw new AppError("Provedor Pix não configurado.");
  const url = `${API}${path}${opts.query ? `?${new URLSearchParams(opts.query).toString()}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Stripe-Version": API_VERSION,
        ...(opts.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error(`[stripe-pix] ${method} ${path} → sem resposta (${e instanceof Error ? e.name : "erro"})`);
    throw new AppError(GENERIC_ERROR);
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* corpo não-JSON */
  }
  if (!res.ok) {
    // Nunca registra a mensagem do erro: ela pode ecoar pedaços da chave. Só status, tipo e código.
    const err = (json as { error?: { type?: unknown; code?: unknown; param?: unknown } } | null)?.error;
    // `param` (nome do campo que o Stripe recusou, ex.: custom_fields[0][key]) ajuda a achar o problema e não carrega segredo
    const param = typeof err?.param === "string" && /^[A-Za-z0-9_[\]]{1,80}$/.test(err.param) ? err.param : "-";
    console.error(`[stripe-pix] ${method} ${path} → ${res.status} ${logTag(err?.type)} ${logTag(err?.code)} param=${param}`);
    throw new AppError(GENERIC_ERROR);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error(`[stripe-pix] ${method} ${path} → resposta fora do formato esperado`);
    throw new AppError(GENERIC_ERROR);
  }
  return parsed.data;
}

const createdSchema = z.object({
  id: z.string().startsWith("cs_"),
  url: z.string().refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "endereço da página de pagamento inválido"),
});

const chargeSchema = z.object({
  refunded: z.boolean(),
  amount_refunded: z.number(),
  disputed: z.boolean(),
  billing_details: z.object({ tax_id: z.string().nullish() }).nullish(),
});
const sessionSchema = z.object({
  id: z.string(),
  status: z.string().nullish(),
  payment_status: z.string(),
  amount_total: z.number().nullish(),
  currency: z.string().nullish(),
  customer_details: z.object({ tax_ids: z.array(z.object({ type: z.string(), value: z.string().nullish() })).nullish() }).nullish(),
  custom_fields: z.array(z.object({ key: z.string(), numeric: z.object({ value: z.string().nullish() }).nullish() })).nullish(),
  payment_intent: z.union([z.string(), z.object({ latest_charge: z.union([z.string(), chargeSchema]).nullish() })]).nullish(),
});
const instructionsSchema = z.object({
  payment_intent: z
    .object({
      next_action: z
        .object({ pix_display_qr_code: z.object({ data: z.string().nullish(), image_url_png: z.string().nullish(), hosted_instructions_url: z.string().nullish() }).nullish() })
        .nullish(),
    })
    .nullish(),
});
const sessionListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

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
        payment_intent: z.union([z.string(), z.object({ id: z.string() })]).nullish(),
      })
      .passthrough(),
  }),
});

/**
 * Estado da cobrança no pagamento: "reversed" (estornado, reembolsado — inclusive parcial: o crédito inteiro é retirado e o admin
 * ajusta a diferença — ou contestado), "clean" ou "unknown" quando o Stripe não devolveu os dados do pagamento (formato mudou,
 * chave restrita sem leitura de cobranças…). "unknown" NUNCA pode virar PAGO: falha fechada.
 */
function chargeState(session: z.infer<typeof sessionSchema>): "reversed" | "clean" | "unknown" {
  const pi = session.payment_intent;
  const charge = pi && typeof pi === "object" ? pi.latest_charge : null;
  if (!charge || typeof charge === "string") return "unknown";
  return charge.refunded || charge.amount_refunded > 0 || charge.disputed ? "reversed" : "clean";
}

const cpfDigits = (v: string | null | undefined): string | null => {
  const d = v ? onlyDigits(v) : "";
  return d.length === 11 ? d : null;
};

/**
 * O CPF DIGITADO pelo pagador na página do Stripe, só dígitos (campo numérico "cpf" que nós mesmos pedimos; se o Stripe o expuser
 * também na cobrança ou no cliente, serve de alternativa). É um dado DECLARADO, não confirmado pelo banco: veja ChargeInfo.payerDocVerified.
 */
function payerCpf(session: z.infer<typeof sessionSchema>): string | null {
  const field = session.custom_fields?.find((f) => f.key === "cpf")?.numeric?.value;
  const pi = session.payment_intent;
  const charge = pi && typeof pi === "object" && pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  return cpfDigits(field) ?? cpfDigits(charge?.billing_details?.tax_id) ?? cpfDigits(session.customer_details?.tax_ids?.find((t) => t.type === "br_cpf")?.value);
}

/** Acha a sessão de depósito de um pagamento (estorno e contestação chegam com o PaymentIntent, não com a sessão). */
export async function findCheckoutSessionId(paymentIntentId: string): Promise<string | null> {
  const list = await call("GET", "/checkout/sessions", sessionListSchema, { query: { payment_intent: paymentIntentId, limit: "1" } });
  return list.data[0]?.id ?? null;
}

export const stripePix: PixProvider = {
  name: "stripe",
  canSendPix: false,

  async createCharge({ externalReference, amountCents, expiresAt }) {
    const env = getEnv();
    const now = Date.now();
    // O Stripe só aceita sessão que expire entre 30 min e 24 h depois de criada (31 min de folga para o relógio e a rede).
    const sessionExpiresAt = Math.min(Math.max(expiresAt.getTime(), now + 31 * 60_000), now + 23 * 3600_000);
    // O prazo do Pix em si (10 s a 14 dias) conta a partir do momento em que o pagador conclui a página do Stripe.
    const pixSeconds = Math.min(1_209_600, Math.max(10, Math.floor((expiresAt.getTime() - now) / 1000)));
    const session = await call("POST", "/checkout/sessions", createdSchema, {
      idempotencyKey: `wallet-deposit-${externalReference}`,
      form: {
        mode: "payment",
        "payment_method_types[0]": "pix",
        client_reference_id: externalReference,
        "metadata[kind]": DEPOSIT_KIND,
        "metadata[depositId]": externalReference,
        "payment_intent_data[metadata][kind]": DEPOSIT_KIND,
        "payment_intent_data[metadata][depositId]": externalReference,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "brl",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": "Créditos Prime Arena",
        "line_items[0][price_data][product_data][description]": "1 crédito = R$ 1,00",
        expires_at: String(Math.floor(sessionExpiresAt / 1000)),
        "payment_method_options[pix][expires_after_seconds]": String(pixSeconds),
        success_url: `${env.appUrl}/carteira`,
        cancel_url: `${env.appUrl}/carteira`,
        // pede o CPF do titular num campo numérico nosso (11 dígitos); é declarado pelo pagador, veja payerCpf
        ...(env.stripePixCollectTaxId
          ? {
              "custom_fields[0][key]": "cpf",
              "custom_fields[0][label][type]": "custom",
              "custom_fields[0][label][custom]": "CPF do titular da conta (só números)",
              "custom_fields[0][type]": "numeric",
              "custom_fields[0][numeric][minimum_length]": "11",
              "custom_fields[0][numeric][maximum_length]": "11",
            }
          : {}),
      },
    });
    // A página hospedada do Stripe substitui o QR + copia-e-cola: o endereço dela é guardado onde ficaria o copia-e-cola.
    return { chargeId: session.id, copyPaste: session.url, qrImage: null };
  },

  async getCharge(chargeId): Promise<ChargeInfo> {
    const s = await call("GET", `/checkout/sessions/${encodeURIComponent(chargeId)}`, sessionSchema, { query: { "expand[]": "payment_intent.latest_charge" } });
    const state = chargeState(s);
    let status: ChargeInfo["status"];
    if (state === "reversed") status = "REVERSED";
    else if (s.payment_status === "paid") {
      if (state === "unknown") {
        // Pago, mas sem os dados da cobrança: não dá para saber se foi estornado. Não credita; o agendador reconsulta mais tarde.
        console.error("[stripe-pix] sessão paga sem os dados da cobrança (latest_charge): tratada como pendente");
        status = "PENDING";
      } else status = "PAID";
    } else status = s.status === "expired" ? "EXPIRED" : "PENDING";
    return { status, amountCents: s.amount_total ?? 0, payerDocument: payerCpf(s), payerDocVerified: false, currency: s.currency?.toUpperCase() };
  },

  async getPaymentInstructions(chargeId) {
    const s = await call("GET", `/checkout/sessions/${encodeURIComponent(chargeId)}`, instructionsSchema, { query: { "expand[]": "payment_intent" } });
    const q = s.payment_intent?.next_action?.pix_display_qr_code;
    if (!q?.data) return null;
    const png = q.image_url_png && /^https:\/\//.test(q.image_url_png) ? q.image_url_png : null;
    return { copyPaste: q.data, qrImage: png };
  },

  verifyWebhook(headers, rawBody) {
    const { stripeWebhookSecret } = getEnv();
    return !!stripeWebhookSecret && verifyStripeSignature(rawBody, headers.get("stripe-signature"), stripeWebhookSecret);
  },

  parseWebhook(rawBody): PixEvent[] {
    const parsed = eventSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) return [{ id: "invalid", type: "IGNORED" }];
    const ev = parsed.data;
    const obj = ev.data.object;
    const isDeposit = obj.metadata?.kind === DEPOSIT_KIND;
    switch (ev.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (isDeposit && obj.id) {
          // No Pix o "completed" chega com payment_status=unpaid (o pagador acabou de enviar o formulário e ainda não pagou):
          // então só atualizamos o QR Code/copia-e-cola da tela. Quem credita é o "paid".
          if (obj.payment_status === "paid") return [{ id: ev.id, type: "CHARGE_PAID", chargeId: obj.id, externalReference: obj.client_reference_id ?? undefined }];
          return [{ id: ev.id, type: "CHARGE_CREATED", chargeId: obj.id }];
        }
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        if (isDeposit && obj.id) return [{ id: ev.id, type: "CHARGE_EXPIRED", chargeId: obj.id, externalReference: obj.client_reference_id ?? undefined }];
        break;
      case "charge.refunded":
      case "charge.dispute.created": {
        // O evento descreve a cobrança/contestação, não a sessão: o PaymentIntent leva à sessão (findCheckoutSessionId).
        // Pagamentos que sabidamente não são depósitos (ex.: inscrições, que levam outra marca) nem chegam a consultar o Stripe.
        const kind = obj.metadata?.kind;
        const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id;
        if ((kind && kind !== DEPOSIT_KIND) || obj.metadata?.orderId) break;
        if (pi) return [{ id: ev.id, type: "CHARGE_REVERSED", paymentIntentId: pi }];
        break;
      }
    }
    return [{ id: ev.id, type: "IGNORED" }];
  },

  async sendPix() {
    throw new AppError(NO_PAYOUT);
  },
  async getTransfer() {
    throw new AppError(NO_PAYOUT);
  },
  verifyTransferAuthorization() {
    throw new AppError(NO_PAYOUT);
  },
  parseTransferAuthorization() {
    throw new AppError(NO_PAYOUT);
  },
  formatTransferAuthResponse() {
    throw new AppError(NO_PAYOUT);
  },
};
