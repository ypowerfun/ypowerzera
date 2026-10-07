import { signPayload, verifySignature } from "@/lib/signature";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import type { PaymentProvider } from "./types";

const API = "https://api.stripe.com/v1";

async function stripePost(path: string, params: Record<string, string>, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const { stripeSecretKey } = getEnv();
  if (!stripeSecretKey) throw new AppError("Pagamentos indisponíveis no momento.");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? res.statusText;
    console.error("[stripe] erro", path, msg);
    throw new AppError("Não foi possível falar com o provedor de pagamento. Tente novamente.");
  }
  return json;
}

/** Monta os parâmetros da sessão de Checkout (cartão e, em BRL, Pix). Exportado para teste. */
export function buildCheckoutParams(args: {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  currency: string;
  tournamentName: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}): Record<string, string> {
  const currency = args.currency.toLowerCase();
  const p: Record<string, string> = {
    mode: "payment",
    client_reference_id: args.orderId,
    "metadata[orderId]": args.orderId,
    "metadata[orderNumber]": args.orderNumber,
    "payment_intent_data[metadata][orderId]": args.orderId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": String(args.totalCents),
    "line_items[0][price_data][product_data][name]": `Inscrição: ${args.tournamentName}`.slice(0, 120),
    "line_items[0][price_data][product_data][description]": `Pedido ${args.orderNumber} (inscrição + taxa de serviço)`,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    // Stripe exige expiração entre 30 min e 24 h
    expires_at: String(Math.floor(args.expiresAt.getTime() / 1000)),
    "payment_method_types[0]": "card",
  };
  if (currency === "brl") p["payment_method_types[1]"] = "pix";
  if (args.customerEmail) p.customer_email = args.customerEmail;
  return p;
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createCheckout({ order, tournament, customerEmail, successUrl, cancelUrl }) {
    const minExpiry = Date.now() + 31 * 60_000;
    const expiresAt = new Date(Math.max(order.expiresAt.getTime(), minExpiry));
    const session = await stripePost(
      "/checkout/sessions",
      buildCheckoutParams({
        orderId: order.id,
        orderNumber: order.number,
        totalCents: order.totalCents,
        currency: order.currency,
        tournamentName: tournament.name,
        customerEmail,
        successUrl,
        cancelUrl,
        expiresAt,
      }),
      // A expiração muda a cada clique em "Pagar" (a Stripe exige 30 min no futuro): a chave de idempotência precisa mudar junto,
      // senão o segundo clique recebe "chave reutilizada com parâmetros diferentes" e o pagamento nunca abre.
      `checkout-${order.id}-${Math.floor(expiresAt.getTime() / 1000)}`,
    );
    return { redirectUrl: String(session.url), sessionId: String(session.id) };
  },
  async refund(order, amountCents, reason) {
    if (!order.providerPaymentId) throw new AppError("Pedido sem pagamento associado no provedor.");
    const refund = await stripePost(
      "/refunds",
      {
        payment_intent: order.providerPaymentId,
        amount: String(amountCents),
        "metadata[orderId]": order.id,
        "metadata[reason]": reason.slice(0, 200),
      },
      `refund-${order.id}-${order.refundedCents}-${amountCents}`,
    );
    return { refundId: String(refund.id) };
  },
};

/** Verifica o cabeçalho `Stripe-Signature` (t=...,v1=...). */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSeconds = 300, nowMs = Date.now()): boolean {
  return verifySignature(rawBody, header, secret, toleranceSeconds, nowMs);
}

/** Gera um cabeçalho válido (usado nos testes). */
export function signStripePayload(rawBody: string, secret: string, nowMs = Date.now()): string {
  return signPayload(rawBody, secret, nowMs);
}
