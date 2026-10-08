import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { onlyDigits } from "@/lib/cpf";
import { PASSWORD, linkGame, makeOrg, makeUser, uid } from "./factories";
import { admin, balances, emailOf, lastOtp, leaderWithWinnings, makeLeader, newAdmin, nextCpf, type Leader } from "./wallet-helpers";
import { confirmDeposit, createDeposit, reconcilePendingDeposits } from "@/server/deposits";
import { adminAdjustWallet, adminOverview } from "@/server/admin-wallet";
import { createTournament, publishTournament } from "@/server/tournaments";
import { registerForTournament } from "@/server/registration";
import { getPixProvider, pixAvailable } from "@/server/pix";
import { asaasPix } from "@/server/pix/asaas";
import { mockPix } from "@/server/pix/mock";
import { stripePix } from "@/server/pix/stripe";
import { handlePixWebhook, handleTransferAuthorization } from "@/server/pix-webhooks";
import { signStripePayload } from "@/server/payments/stripe";
import { handleStripeWebhook } from "@/server/stripe-webhook";
import { walletReadiness } from "@/server/settings";
import { freezeWallet, reconcileAll } from "@/server/wallet";
import {
  MANUAL_PAYOUT,
  adminResolveProcessing,
  adminRevealPayoutKey,
  confirmWithdrawal,
  notManualPayout,
  processDueWithdrawals,
  processWithdrawal,
  reconcileProcessing,
  requestWithdrawal,
  reviewWithdrawal,
} from "@/server/withdrawals";

const SECRET = "whsec_stripe_pix_test_secret";
const KEY = "sk_test_chave_secreta_do_teste_123456";

const ENV_KEYS = ["PIX_PROVIDER", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PIX_REQUIRE_PAYER_DOC", "STRIPE_PIX_COLLECT_TAX_ID", "PAYOUTS_PAUSED", "ASAAS_API_KEY", "NODE_ENV"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;

/** Escolhe o provedor de Pix; o Stripe já vem com as chaves e com a regra de produção (CPF do pagador obrigatório). */
function usePix(name: "mock" | "stripe") {
  env.PIX_PROVIDER = name;
  env.STRIPE_SECRET_KEY = KEY;
  env.STRIPE_WEBHOOK_SECRET = SECRET;
  env.PIX_REQUIRE_PAYER_DOC = "true";
}

// ───────────── Stripe simulado (fetch) ─────────────

interface FakeSession {
  id: string;
  pi: string;
  depositId: string;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid";
  amount_total: number;
  currency: string;
  taxIds: Array<{ type: string; value: string }>;
  charge: { refunded?: boolean; amount_refunded?: number; disputed?: boolean } | null;
}
interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  form: URLSearchParams | null;
  signal: unknown;
}

const sessions = new Map<string, FakeSession>();
let calls: Call[] = [];
let seq = 0;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function sessionBody(s: FakeSession, expandCharge: boolean) {
  return {
    id: s.id,
    object: "checkout.session",
    status: s.status,
    payment_status: s.payment_status,
    amount_total: s.amount_total,
    currency: s.currency,
    customer_details: s.payment_status === "paid" ? { email: "pagador@example.com", tax_ids: s.taxIds } : null,
    payment_intent: expandCharge ? { id: s.pi, object: "payment_intent", latest_charge: s.charge ? { id: `ch_${s.pi}`, object: "charge", ...s.charge } : null } : s.pi,
  };
}

function installFakeStripe() {
  sessions.clear();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      calls.push({ method, url, headers: init.headers as Record<string, string>, form: typeof init.body === "string" ? new URLSearchParams(init.body) : null, signal: init.signal });
      if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
        const form = new URLSearchParams(String(init.body));
        const id = `cs_test_${++seq}_${uid()}`;
        sessions.set(id, {
          id,
          pi: `pi_${id}`,
          depositId: form.get("client_reference_id") ?? "",
          status: "open",
          payment_status: "unpaid",
          amount_total: Number(form.get("line_items[0][price_data][unit_amount]")),
          currency: form.get("line_items[0][price_data][currency]") ?? "",
          taxIds: [],
          charge: null,
        });
        return json(200, { id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}` });
      }
      const one = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_[\w]+)$/);
      if (method === "GET" && one) {
        const s = sessions.get(one[1]);
        if (!s) return json(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such checkout.session" } });
        return json(200, sessionBody(s, url.searchParams.getAll("expand[]").includes("payment_intent.latest_charge")));
      }
      if (method === "GET" && url.pathname === "/v1/checkout/sessions") {
        const pi = url.searchParams.get("payment_intent");
        return json(200, { object: "list", data: [...sessions.values()].filter((s) => s.pi === pi).map((s) => ({ id: s.id })) });
      }
      return json(404, { error: { type: "invalid_request_error", message: "rota desconhecida" } });
    }),
  );
}

/** O pagador conclui o Pix no Stripe (o CPF vem do que ele digitou na página). */
function stripePays(s: FakeSession, cpf: string | null, over: Partial<FakeSession> = {}) {
  Object.assign(s, { status: "complete", payment_status: "paid", taxIds: cpf ? [{ type: "br_cpf", value: cpf }] : [], charge: {} }, over);
}

// ───────────── Eventos assinados ─────────────

interface Delivery {
  raw: string;
  sig: string;
}
const sign = (raw: string, nowMs = Date.now()): Delivery => ({ raw, sig: signStripePayload(raw, SECRET, nowMs) });
const eventId = () => `evt_${uid()}`;

function sessionEvent(type: string, s: FakeSession, over: Record<string, unknown> = {}, id = eventId()): Delivery {
  return sign(
    JSON.stringify({
      id,
      type,
      data: {
        object: {
          id: s.id,
          object: "checkout.session",
          client_reference_id: s.depositId,
          metadata: { kind: "wallet_deposit", depositId: s.depositId },
          payment_status: s.payment_status,
          payment_intent: s.pi,
          amount_total: s.amount_total,
          currency: s.currency,
          ...over,
        },
      },
    }),
  );
}
const chargeEvent = (type: "charge.refunded" | "charge.dispute.created", pi: string, id = eventId()) =>
  sign(JSON.stringify({ id, type, data: { object: type === "charge.refunded" ? { id: `ch_${pi}`, object: "charge", payment_intent: pi, refunded: true } : { id: `dp_${pi}`, object: "dispute", charge: `ch_${pi}`, payment_intent: pi } } }));

const deliver = (d: Delivery) => handleStripeWebhook(d.raw, d.sig);

// ───────────── Cenários ─────────────

async function newDeposit(l: Leader, cents = 10_000) {
  const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: cents });
  return { dep, s: sessions.get(dep.providerChargeId!)! };
}

/** Depósito pago e creditado pelo caminho completo (webhook assinado → reconsulta → crédito). */
async function creditedDeposit(l: Leader, cents = 10_000) {
  const { dep, s } = await newDeposit(l, cents);
  stripePays(s, l.cpf);
  expect((await deliver(sessionEvent("checkout.session.async_payment_succeeded", s))).status).toBe(200);
  expect((await db.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe("CONFIRMED");
  return { dep, s };
}

const depositOf = (id: string) => db.deposit.findUniqueOrThrow({ where: { id } });
const apiCalls = () => calls.length;

let consoleError: MockInstance;
beforeEach(async () => {
  usePix("stripe");
  delete env.STRIPE_PIX_COLLECT_TAX_ID;
  delete env.PAYOUTS_PAUSED;
  await db.rateLimit.deleteMany();
  installFakeStripe();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete env[k];
    else env[k] = savedEnv[k];
  }
});

describe("Stripe Pix: criar a cobrança", () => {
  it("cria uma sessão de Checkout só com Pix, em BRL, com os campos e cabeçalhos certos", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 12_000);

    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url.href).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(c.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(c.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(c.headers["Stripe-Version"]).toMatch(/^\d{4}-\d{2}-\d{2}\.\w+$/); // versão fixada
    expect(c.headers["Idempotency-Key"]).toBe(`wallet-deposit-${dep.id}`);
    expect(c.signal).toBeInstanceOf(AbortSignal); // tempo limite

    const f = c.form!;
    expect(f.get("mode")).toBe("payment");
    expect(f.getAll("payment_method_types[0]")).toEqual(["pix"]);
    expect(f.get("payment_method_types[1]")).toBeNull(); // nada de cartão
    expect(f.get("line_items[0][quantity]")).toBe("1");
    expect(f.get("line_items[0][price_data][currency]")).toBe("brl");
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe("12000"); // o valor vem do depósito no servidor
    expect(f.get("client_reference_id")).toBe(dep.id);
    expect(f.get("metadata[kind]")).toBe("wallet_deposit");
    expect(f.get("metadata[depositId]")).toBe(dep.id);
    expect(f.get("payment_intent_data[metadata][depositId]")).toBe(dep.id);
    expect(f.get("success_url")).toBe("http://localhost:3000/carteira");
    expect(f.get("cancel_url")).toBe("http://localhost:3000/carteira");
    expect(f.get("tax_id_collection[enabled]")).toBe("true");

    // o Checkout só aceita expirar entre 30 min e 24 h; o prazo do Pix (10 s a 14 dias) acompanha o prazo do depósito
    const now = Date.now() / 1000;
    const expiresAt = Number(f.get("expires_at"));
    expect(expiresAt).toBeGreaterThan(now + 30 * 60);
    expect(expiresAt).toBeLessThan(now + 24 * 3600);
    const pixSeconds = Number(f.get("payment_method_options[pix][expires_after_seconds]"));
    expect(pixSeconds).toBeGreaterThanOrEqual(10);
    expect(pixSeconds).toBeLessThanOrEqual(30 * 60);

    // a página hospedada fica onde ficaria o copia-e-cola; não há QR próprio
    expect(dep).toMatchObject({ provider: "stripe", providerChargeId: s.id, pixCopyPaste: `https://checkout.stripe.com/c/pay/${s.id}`, pixQrImage: null, status: "PENDING" });
  });

  it("STRIPE_PIX_COLLECT_TAX_ID=false não pede o CPF na página (o depósito vai para o admin conferir)", async () => {
    env.STRIPE_PIX_COLLECT_TAX_ID = "false";
    await newDeposit(await makeLeader());
    expect(calls[0].form!.get("tax_id_collection[enabled]")).toBeNull();
  });

  it("erro do Stripe vira mensagem genérica, sem vazar a chave nem o corpo, e o depósito falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(401, { error: { type: "invalid_request_error", code: "api_key_invalid", message: `Invalid API Key provided: ${KEY}` } })),
    );
    const l = await makeLeader();
    const err = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/recusou ou não respondeu/);
    expect((err as AppError).message).not.toContain(KEY);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("401");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("Invalid API Key");
    expect((await db.deposit.findFirstOrThrow({ where: { teamId: l.team.id } })).status).toBe("FAILED");
  });

  it("sem resposta (tempo esgotado), resposta fora do formato e endereço http: tudo falha fechado", async () => {
    const l = await makeLeader();
    const attempt = () => createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("The operation timed out", "TimeoutError"))));
    await expect(attempt()).rejects.toThrow(/recusou ou não respondeu/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200 })));
    await expect(attempt()).rejects.toThrow(/recusou ou não respondeu/);
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { id: "cs_test_1", url: "http://checkout.stripe.com/inseguro" })));
    await expect(attempt()).rejects.toThrow(/recusou ou não respondeu/);
    expect(await db.deposit.count({ where: { teamId: l.team.id, status: "FAILED" } })).toBe(3);
    expect(await db.deposit.count({ where: { teamId: l.team.id, status: { not: "FAILED" } } })).toBe(0);
  });
});

describe("Stripe Pix: reconsulta (getCharge)", () => {
  it("traduz o estado da sessão e lê o CPF e o valor da API", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 10_000);
    const get = () => stripePix.getCharge(dep.providerChargeId!);

    expect(await get()).toMatchObject({ status: "PENDING", amountCents: 10_000, payerDocument: null, currency: "BRL" });
    const last = calls[calls.length - 1];
    expect(last.method).toBe("GET");
    expect(last.url.pathname).toBe(`/v1/checkout/sessions/${s.id}`);
    expect(last.url.searchParams.get("expand[]")).toBe("payment_intent.latest_charge");
    expect(last.headers["Stripe-Version"]).toBeTruthy();

    stripePays(s, "123.456.789-09");
    expect(await get()).toMatchObject({ status: "PAID", payerDocument: "12345678909" }); // só dígitos
    s.charge = { amount_refunded: 500 }; // reembolso parcial também reverte (o admin ajusta a diferença)
    expect((await get()).status).toBe("REVERSED");
    s.charge = { disputed: true };
    expect((await get()).status).toBe("REVERSED");
    s.charge = { refunded: true };
    expect((await get()).status).toBe("REVERSED");

    s.charge = {};
    s.taxIds = [{ type: "br_cnpj", value: "12.345.678/0001-95" }]; // CNPJ não prova que o pagador é o titular do CPF
    expect((await get()).payerDocument).toBeNull();

    Object.assign(s, { status: "expired", payment_status: "unpaid" });
    expect((await get()).status).toBe("EXPIRED");
  });

  it("erro 404 do Stripe não credita nada e não vaza o corpo", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l);
    sessions.delete(s.id);
    await expect(confirmDeposit(dep.providerChargeId!)).rejects.toThrow(/recusou ou não respondeu/);
    expect((await depositOf(dep.id)).status).toBe("PENDING");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("No such checkout.session");
  });
});

describe("Stripe Pix: webhook de depósito", () => {
  it("sem assinatura, com assinatura velha, de outro segredo ou corpo alterado: recusado e nada acontece", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l);
    stripePays(s, l.cpf);
    const ev = sessionEvent("checkout.session.async_payment_succeeded", s);
    const before = apiCalls();

    expect((await handleStripeWebhook(ev.raw, null)).status).toBe(400);
    expect((await handleStripeWebhook(ev.raw, signStripePayload(ev.raw, SECRET, Date.now() - 10 * 60_000))).status).toBe(400); // replay antigo
    expect((await handleStripeWebhook(ev.raw, signStripePayload(ev.raw, "outro-segredo"))).status).toBe(400);
    expect((await handleStripeWebhook(`${ev.raw} `, ev.sig)).status).toBe(400);
    expect(apiCalls()).toBe(before); // nem consultou o Stripe
    expect((await depositOf(dep.id)).status).toBe("PENDING");
    expect(await balances(l.walletId)).toEqual({ available: 0, locked: 0 });

    // o endereço genérico do Pix também exige a assinatura do Stripe
    expect((await handlePixWebhook(new Headers(), ev.raw)).status).toBe(401);
    expect((await depositOf(dep.id)).status).toBe("PENDING");
  });

  it("pago pelo titular: reconsulta o Stripe, credita uma vez e a conciliação fecha", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 15_000);
    stripePays(s, l.cpf);
    const before = apiCalls();
    const res = await deliver(sessionEvent("checkout.session.async_payment_succeeded", s));
    expect(res.status).toBe(200);
    expect(apiCalls()).toBe(before + 1); // a verdade veio da API
    expect(calls[calls.length - 1].url.pathname).toBe(`/v1/checkout/sessions/${s.id}`);

    const d = await depositOf(dep.id);
    expect(d.status).toBe("CONFIRMED");
    expect(d.payerDocHash).toBeTruthy();
    expect(await balances(l.walletId)).toEqual({ available: 15_000, locked: 0 });
    expect(await db.auditLog.count({ where: { action: "deposit.credited", entityId: dep.id } })).toBe(1);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("o mesmo evento duas vezes (e a mesma sessão por outro evento) não credita em dobro", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 10_000);
    stripePays(s, l.cpf);
    const first = sessionEvent("checkout.session.async_payment_succeeded", s);
    expect((await deliver(first)).body).toEqual({ ok: true });
    const before = apiCalls();
    expect((await deliver(first)).body).toMatchObject({ ok: true, duplicate: true });
    expect(apiCalls()).toBe(before); // duplicado: nem reconsulta
    expect((await deliver(sessionEvent("checkout.session.completed", s))).status).toBe(200); // outro evento, mesma sessão
    expect(await balances(l.walletId)).toEqual({ available: 10_000, locked: 0 });
    expect(await db.ledgerEntry.count({ where: { refType: "deposit", refId: dep.id } })).toBe(1);
    expect(await db.paymentEvent.count({ where: { provider: "stripe", eventId: JSON.parse(first.raw).id } })).toBe(1);
  });

  it("eventos diferentes da mesma sessão chegando ao mesmo tempo creditam uma vez só", async () => {
    const l = await makeLeader();
    const { s } = await newDeposit(l, 10_000);
    stripePays(s, l.cpf);
    const results = await Promise.all([1, 2, 3].map(() => deliver(sessionEvent("checkout.session.async_payment_succeeded", s)))); // 3 eventos diferentes
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await balances(l.walletId)).toEqual({ available: 10_000, locked: 0 });
  });

  it("webhook diz 'pago', mas a API diz 'não pago': nada é creditado", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l);
    // s continua unpaid na API; o corpo do evento (forjado ou atrasado) afirma o contrário
    const res = await deliver(sessionEvent("checkout.session.completed", s, { payment_status: "paid" }));
    expect(res.status).toBe(200);
    expect((await depositOf(dep.id)).status).toBe("PENDING");
    expect(await balances(l.walletId)).toEqual({ available: 0, locked: 0 });
    expect(await db.ledgerEntry.count({ where: { refType: "deposit", refId: dep.id } })).toBe(0);
  });

  it("'completed' com pagamento ainda pendente (Pix não pago) é ignorado sem consultar a API", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l);
    const before = apiCalls();
    expect((await deliver(sessionEvent("checkout.session.completed", s))).status).toBe(200);
    expect(apiCalls()).toBe(before);
    expect((await depositOf(dep.id)).status).toBe("PENDING");
  });

  it("valor divergente na API retém o depósito para o admin", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 10_000);
    stripePays(s, l.cpf, { amount_total: 1_000 });
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", s, { amount_total: 10_000 })); // o corpo "confere", a API não
    const d = await depositOf(dep.id);
    expect(d.status).toBe("HELD");
    expect(d.holdReason).toMatch(/diverge/);
    expect(await balances(l.walletId)).toEqual({ available: 0, locked: 0 });
  });

  it("moeda diferente de BRL retém o depósito", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 10_000);
    stripePays(s, l.cpf, { currency: "usd" });
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", s));
    const d = await depositOf(dep.id);
    expect(d.status).toBe("HELD");
    expect(d.holdReason).toMatch(/BRL/);
    expect(await balances(l.walletId)).toEqual({ available: 0, locked: 0 });
  });

  it("CPF do pagador diferente do titular retém; sem CPF retém (padrão de produção); com a regra desligada credita", async () => {
    const other = await makeLeader();
    const { dep, s } = await newDeposit(other, 10_000);
    stripePays(s, nextCpf()); // CPF de outra pessoa
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", s));
    expect(await depositOf(dep.id)).toMatchObject({ status: "HELD", holdReason: expect.stringMatching(/não confere/) });
    expect((await balances(other.walletId)).available).toBe(0);

    const none = await makeLeader();
    const b = await newDeposit(none, 10_000);
    stripePays(b.s, null); // o pagador não informou CPF
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", b.s));
    expect(await depositOf(b.dep.id)).toMatchObject({ status: "HELD", holdReason: expect.stringMatching(/não informou o CPF/) });

    const cnpj = await makeLeader();
    const c = await newDeposit(cnpj, 10_000);
    stripePays(c.s, null, { taxIds: [{ type: "br_cnpj", value: "12345678000195" }] });
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", c.s));
    expect((await depositOf(c.dep.id)).status).toBe("HELD");

    env.PIX_REQUIRE_PAYER_DOC = "false";
    const off = await makeLeader();
    const d = await newDeposit(off, 10_000);
    stripePays(d.s, null);
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", d.s));
    expect((await depositOf(d.dep.id)).status).toBe("CONFIRMED");
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("sessão expirada ou Pix vencido tira o depósito da fila; um pagamento tardio ainda é conferido", async () => {
    const l = await makeLeader();
    const a = await newDeposit(l, 10_000);
    Object.assign(a.s, { status: "expired" });
    expect((await deliver(sessionEvent("checkout.session.expired", a.s))).status).toBe(200);
    expect((await depositOf(a.dep.id)).status).toBe("EXPIRED");
    expect(await db.auditLog.count({ where: { action: "deposit.expired_by_provider", entityId: a.dep.id } })).toBe(1);

    const b = await newDeposit(l, 10_000);
    expect((await deliver(sessionEvent("checkout.session.async_payment_failed", b.s))).status).toBe(200);
    expect((await depositOf(b.dep.id)).status).toBe("EXPIRED");
    expect((await balances(l.walletId)).available).toBe(0);

    // expirar não é decisão sobre dinheiro: se a API disser que foi pago, o caminho normal credita
    const c = await newDeposit(l, 10_000);
    await deliver(sessionEvent("checkout.session.async_payment_failed", c.s));
    stripePays(c.s, l.cpf);
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", c.s));
    expect((await depositOf(c.dep.id)).status).toBe("CONFIRMED");
    expect(await balances(l.walletId)).toEqual({ available: 10_000, locked: 0 });
  });

  it("estorno (charge.refunded) retira o crédito, congela a carteira e é idempotente", async () => {
    const l = await makeLeader();
    const { dep, s } = await creditedDeposit(l, 10_000);
    s.charge = { refunded: true, amount_refunded: 10_000 };
    const ev = chargeEvent("charge.refunded", s.pi);
    expect((await deliver(ev)).status).toBe(200);

    expect((await depositOf(dep.id)).status).toBe("REVERSED");
    const w = await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } });
    expect(w).toMatchObject({ balanceCents: 0, debtCents: 0 });
    expect(w.frozenAt).not.toBeNull();
    expect((await deliver(ev)).body).toMatchObject({ duplicate: true });
    expect((await deliver(chargeEvent("charge.refunded", s.pi))).status).toBe(200); // outro evento, mesmo estorno
    expect(await db.ledgerEntry.count({ where: { refType: "deposit", refId: dep.id, type: "DEPOSIT_REVERSAL" } })).toBe(1);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("contestação (charge.dispute.created) sem saldo vira dívida e congela, como no Asaas", async () => {
    const l = await makeLeader();
    const { dep, s } = await creditedDeposit(l, 10_000);
    await adminAdjustWallet(await admin(), l.walletId, -8_000, "Ajuste de teste: simula o saldo já gasto em desafios");
    s.charge = { disputed: true };
    expect((await deliver(chargeEvent("charge.dispute.created", s.pi))).status).toBe(200);

    expect((await depositOf(dep.id)).status).toBe("REVERSED");
    const w = await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } });
    expect(w.balanceCents).toBe(0);
    expect(w.debtCents).toBe(8_000); // o que não deu para retirar vira dívida
    expect(w.frozenAt).not.toBeNull();
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("estorno só no corpo do webhook (a API diz que não houve) e pagamento que não é nosso são ignorados", async () => {
    const l = await makeLeader();
    const { dep, s } = await creditedDeposit(l, 10_000);
    expect((await deliver(chargeEvent("charge.refunded", s.pi))).status).toBe(200); // s.charge continua {} na API
    expect((await depositOf(dep.id)).status).toBe("CONFIRMED");
    expect(await balances(l.walletId)).toEqual({ available: 10_000, locked: 0 });
    expect((await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } })).frozenAt).toBeNull();

    expect((await deliver(chargeEvent("charge.refunded", "pi_de_outro_produto"))).status).toBe(200);
    expect((await deliver(chargeEvent("charge.dispute.created", "pi_de_outro_produto"))).status).toBe(200);
    expect((await depositOf(dep.id)).status).toBe("CONFIRMED");
  });

  it("estornado enquanto retido: nada foi creditado, vai para devolvido", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 10_000);
    stripePays(s, nextCpf()); // CPF de terceiro → retido
    await deliver(sessionEvent("checkout.session.async_payment_succeeded", s));
    expect((await depositOf(dep.id)).status).toBe("HELD");
    s.charge = { refunded: true };
    await deliver(chargeEvent("charge.refunded", s.pi));
    expect((await depositOf(dep.id)).status).toBe("REFUNDED");
    expect(await balances(l.walletId)).toEqual({ available: 0, locked: 0 });
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("evento desconhecido, sessão desconhecida e outros produtos: 200 sem efeito", async () => {
    const before = apiCalls();
    expect((await deliver(sign(JSON.stringify({ id: eventId(), type: "customer.created", data: { object: { id: "cus_1" } } })))).body).toEqual({ ok: true });
    const ghost = { id: "cs_test_fantasma", pi: "pi_x", depositId: "dep_inexistente", status: "complete", payment_status: "paid", amount_total: 10_000, currency: "brl", taxIds: [], charge: null } as FakeSession;
    expect((await deliver(sessionEvent("checkout.session.async_payment_succeeded", ghost))).status).toBe(200); // depósito que não existe
    expect((await deliver(sessionEvent("checkout.session.expired", ghost))).status).toBe(200);
    expect((await deliver(sign(JSON.stringify({ id: eventId(), type: "checkout.session.completed", data: { object: { id: "cs_outro", payment_status: "paid", metadata: { kind: "assinatura" } } } })))).status).toBe(200);
    expect(apiCalls()).toBe(before);
    expect((await handleStripeWebhook("não é json", sign("não é json").sig)).status).toBe(400);
  });

  it("o mesmo evento pelo endereço genérico do Pix (/api/webhooks/pix) também credita só após reconsultar", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 10_000);
    const ev = sessionEvent("checkout.session.async_payment_succeeded", s, { payment_status: "paid" }); // a API ainda diz unpaid
    const headers = new Headers({ "stripe-signature": ev.sig });
    expect((await handlePixWebhook(headers, ev.raw)).status).toBe(200);
    expect((await depositOf(dep.id)).status).toBe("PENDING");

    stripePays(s, l.cpf);
    const ev2 = sessionEvent("checkout.session.async_payment_succeeded", s);
    expect((await handlePixWebhook(new Headers({ "stripe-signature": ev2.sig }), ev2.raw)).status).toBe(200);
    expect((await depositOf(dep.id)).status).toBe("CONFIRMED");
    expect(await balances(l.walletId)).toEqual({ available: 10_000, locked: 0 });

    const r = chargeEvent("charge.refunded", s.pi);
    s.charge = { refunded: true };
    await handlePixWebhook(new Headers({ "stripe-signature": r.sig }), r.raw);
    expect((await depositOf(dep.id)).status).toBe("REVERSED");
  });

  it("a rede de segurança do agendador também credita o Pix cujo webhook se perdeu", async () => {
    const l = await makeLeader();
    const { dep, s } = await newDeposit(l, 10_000);
    stripePays(s, l.cpf);
    await db.deposit.update({ where: { id: dep.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await reconcilePendingDeposits(new Date(), 200)).credited).toBeGreaterThanOrEqual(1);
    expect((await depositOf(dep.id)).status).toBe("CONFIRMED");
  });

  it("a inscrição em campeonato continua funcionando no mesmo endereço", async () => {
    const owner = await makeUser();
    const org = await makeOrg(owner);
    const t = await createTournament(owner, { orgId: org.id, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", name: `Copa Stripe ${uid()}`, startsAt: new Date(Date.now() + 48 * 3600_000), maxParticipants: 8, entryFeeCents: 2000 });
    await publishTournament(owner, t.id);
    const u = await makeUser();
    await linkGame(u, "sf6");
    const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
    const raw = JSON.stringify({ id: eventId(), type: "checkout.session.completed", data: { object: { id: "cs_pedido", client_reference_id: r.orderId, payment_status: "paid", payment_intent: "pi_pedido", amount_total: 2200, currency: "brl" } } });
    expect((await deliver(sign(raw))).status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId! } })).status).toBe("PAID");
  });
});

describe("Stripe Pix: saque manual (o Stripe não paga Pix a terceiros)", () => {
  /** Saque confirmado, aprovado pelo admin e com a janela de cancelamento vencida. O dinheiro é ganho com o Pix simulado. */
  async function approvedWithdrawal(cents = 5_000) {
    usePix("mock");
    const { winner } = await leaderWithWinnings(20_000, 10_000);
    usePix("stripe");
    const { withdrawalId } = await requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: cents, password: PASSWORD, nonce: `nonce-${uid()}-${Math.random()}` });
    expect(await confirmWithdrawal(winner.user, withdrawalId, lastOtp(await emailOf(winner.user)))).toBe("under_review");
    await reviewWithdrawal(await admin(), withdrawalId, "approve", "Conferido pelo analista de risco");
    await db.withdrawal.update({ where: { id: withdrawalId }, data: { processAfter: new Date(Date.now() - 1000) } });
    return { winner, id: withdrawalId };
  }

  it("processar NÃO chama o provedor: fica em PROCESSING como manual, auditado, e os jobs o ignoram", async () => {
    const { winner, id } = await approvedWithdrawal(5_000);
    const transfers = await db.mockPixTransfer.count();
    const before = await balances(winner.walletId);

    // três processos ao mesmo tempo: só UM assume o saque (APPROVED → PROCESSING)
    const out = await Promise.all([processWithdrawal(id), processWithdrawal(id), processWithdrawal(id)]);
    expect(out.filter((r) => r === "manual")).toHaveLength(1);
    expect(out.filter((r) => r === "skipped")).toHaveLength(2);

    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w).toMatchObject({ status: "PROCESSING", provider: MANUAL_PAYOUT, providerTransferId: null, paidAt: null });
    expect(apiCalls()).toBe(0); // nenhuma chamada ao Stripe
    expect(await db.mockPixTransfer.count()).toBe(transfers);
    expect(await db.auditLog.count({ where: { action: "withdrawal.manual_payout_pending", entityId: id } })).toBe(1);
    expect(await balances(winner.walletId)).toEqual(before); // o dinheiro continua em custódia até o admin pagar

    // a conciliação automática ignora saques manuais (não há transferência no provedor)
    expect(await db.withdrawal.findMany({ where: { id, ...notManualPayout } })).toHaveLength(0);
    await db.withdrawal.update({ where: { id }, data: { updatedAt: new Date(Date.now() - 3600_000) } });
    await reconcileProcessing(10);
    expect(await db.withdrawal.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROCESSING", provider: MANUAL_PAYOUT });
    expect(apiCalls()).toBe(0);

    // o admin vê o saque na fila (e ele não conta como "preso")
    expect((await adminOverview()).manualPayouts).toBeGreaterThanOrEqual(1);
  });

  it("o job agendado conta o saque manual como processado e não o envia a ninguém", async () => {
    const { id } = await approvedWithdrawal(5_000);
    const out = await processDueWithdrawals(new Date(), 200);
    expect(out.processed).toBeGreaterThanOrEqual(1);
    expect(await db.withdrawal.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROCESSING", provider: MANUAL_PAYOUT, providerTransferId: null });
    expect(apiCalls()).toBe(0);
  });

  it("o admin vê a chave Pix (CPF verificado) só por clique, auditado, e só com os guardas em dia", async () => {
    const { winner, id } = await approvedWithdrawal(5_000);
    await processWithdrawal(id);
    const adm = await admin();

    const shown = await adminRevealPayoutKey(adm, id);
    expect(shown).toEqual({ pixKey: onlyDigits(winner.cpf), netCents: 5_000 });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "withdrawal.payout_key_revealed", entityId: id } });
    expect(log.actorId).toBe(adm.id);
    expect(JSON.stringify(log.meta)).not.toContain(onlyDigits(winner.cpf)); // o CPF nunca vai para a auditoria

    // quatro olhos: nem o solicitante, nem quem não é admin, nem admin da própria equipe
    await expect(adminRevealPayoutKey(winner.user, id)).rejects.toThrow(/administradores/);
    const insider = await newAdmin();
    await db.teamMember.create({ data: { teamId: winner.team.id, userId: insider.id, role: "PLAYER" } });
    await expect(adminRevealPayoutKey(insider, id)).rejects.toThrow(/pertence a esta equipe/);
    await expect(adminResolveProcessing(insider, id, "paid", "Pago no banco, comprovante conferido")).rejects.toThrow(/Conflito/);
    await expect(adminRevealPayoutKey(null, id)).rejects.toThrow();

    // saques pausados e carteira congelada: a chave não é mostrada
    env.PAYOUTS_PAUSED = "true";
    await expect(adminRevealPayoutKey(adm, id)).rejects.toThrow(/pausados/);
    delete env.PAYOUTS_PAUSED;
    await freezeWallet(db, winner.walletId, "carteira em análise (teste)");
    await expect(adminRevealPayoutKey(adm, id)).rejects.toThrow(/congelada/);
    await db.wallet.update({ where: { id: winner.walletId }, data: { frozenAt: null, frozenReason: null } });

    // só saque manual em andamento
    await expect(adminRevealPayoutKey(adm, "saque-inexistente")).rejects.toThrow(/não aguarda pagamento manual/);
    expect(await db.auditLog.count({ where: { action: "withdrawal.payout_key_revealed", entityId: id } })).toBe(1);
  });

  it("o admin marca como pago: o dinheiro sai da custódia uma vez só e a conciliação fecha", async () => {
    const { winner, id } = await approvedWithdrawal(5_000);
    await processWithdrawal(id);
    const before = await balances(winner.walletId);

    await expect(adminResolveProcessing(await admin(), id, "paid", "ok")).rejects.toThrow(/Descreva/);
    expect(await adminResolveProcessing(await admin(), id, "paid", "Pix feito no banco, comprovante conferido", "E12345678202601011200abcdefghijk")).toBe(true);
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w).toMatchObject({ status: "PAID", endToEndId: "E12345678202601011200abcdefghijk", provider: MANUAL_PAYOUT });
    expect(await balances(winner.walletId)).toEqual({ available: before.available, locked: before.locked - 5_000 });
    expect(await adminResolveProcessing(await admin(), id, "paid", "Pix feito no banco, comprovante conferido").catch((e: unknown) => (e as Error).message)).toMatch(/não está em processamento/);
    expect(await db.ledgerEntry.count({ where: { refType: "withdrawal", refId: id, type: "WITHDRAWAL_PAID" } })).toBe(1);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("o admin marca como 'não paguei': o valor volta ao saldo da equipe", async () => {
    const { winner, id } = await approvedWithdrawal(5_000);
    await processWithdrawal(id);
    const before = await balances(winner.walletId);

    expect(await adminResolveProcessing(await admin(), id, "failed", "Não consegui pagar, devolvendo ao saldo")).toBe(true);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
    expect(await balances(winner.walletId)).toEqual({ available: before.available + 5_000, locked: before.locked - 5_000 });
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("o Stripe recusa qualquer método de envio com um erro claro e o endereço de autorização não se aplica", async () => {
    for (const run of [
      () => stripePix.sendPix({ externalReference: "w", amountCents: 100, pixKey: "x", description: "d" }),
      () => stripePix.getTransfer("t"),
      () => stripePix.verifyTransferAuthorization(new Headers(), ""),
      () => stripePix.parseTransferAuthorization(""),
      () => stripePix.formatTransferAuthResponse({ approved: true }),
    ]) {
      await expect(Promise.resolve().then(run)).rejects.toThrow(AppError);
      await expect(Promise.resolve().then(run)).rejects.toThrow(/não paga Pix a terceiros/);
    }
    expect(await handleTransferAuthorization(new Headers(), "{}")).toEqual({ status: 404, body: { error: "not_applicable" } });
    expect(await db.auditLog.count({ where: { action: "security.transfer_auth_rejected", entityId: "stripe" } })).toBe(0);
  });
});

describe("Stripe Pix: escolha do provedor e ambiente", () => {
  it("getPixProvider() devolve o Stripe (sem envio de Pix) e exige as duas chaves", () => {
    expect(getPixProvider()).toBe(stripePix);
    expect(getPixProvider()).toMatchObject({ name: "stripe", canSendPix: false });
    expect(pixAvailable()).toBe(true);
    delete env.STRIPE_SECRET_KEY;
    expect(() => getPixProvider()).toThrow(/Stripe não configurado/);
    expect(pixAvailable()).toBe(false);
    env.STRIPE_SECRET_KEY = KEY;
    delete env.STRIPE_WEBHOOK_SECRET;
    expect(() => getPixProvider()).toThrow(/Stripe não configurado/);
    expect(stripePix.verifyWebhook(new Headers({ "stripe-signature": signStripePayload("{}", "") }), "{}")).toBe(false); // sem segredo nada passa
  });

  it("os outros provedores continuam enviando Pix", () => {
    expect(mockPix.canSendPix).toBe(true);
    expect(asaasPix.canSendPix).toBe(true);
    env.PIX_PROVIDER = "asaas";
    env.ASAAS_API_KEY = "k";
    expect(getPixProvider()).toBe(asaasPix);
    env.PIX_PROVIDER = "mock";
    expect(getPixProvider()).toBe(mockPix);
  });

  it("em produção a regra do CPF do pagador é padrão para o Stripe e pode ser desligada", () => {
    env.NODE_ENV = "production";
    delete env.PIX_REQUIRE_PAYER_DOC;
    expect(getEnv().pixRequirePayerDoc).toBe(true);
    env.PIX_REQUIRE_PAYER_DOC = "false";
    expect(getEnv().pixRequirePayerDoc).toBe(false);
    env.NODE_ENV = "test";
    delete env.PIX_REQUIRE_PAYER_DOC;
    expect(getEnv().pixRequirePayerDoc).toBe(false);
    expect(getEnv().stripePixCollectTaxId).toBe(true);
  });

  it("a lista de pendências da carteira pede as chaves do Stripe e explica o saque manual", () => {
    env.NODE_ENV = "production";
    delete env.STRIPE_SECRET_KEY;
    const bad = walletReadiness().items.find((i) => i.key === "pix")!;
    expect(bad).toMatchObject({ ok: false, label: "Provedor de Pix (Stripe)" });
    expect(bad.hint).toMatch(/STRIPE_SECRET_KEY/);
    env.STRIPE_SECRET_KEY = KEY;
    const ok = walletReadiness().items.find((i) => i.key === "pix")!;
    expect(ok.ok).toBe(true);
    expect(ok.hint).toMatch(/à mão/);
  });
});
