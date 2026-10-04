import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeOrg, makeUser, linkGame } from "./factories";
import { admin, balances, fund, makeLeader, newAdmin } from "./wallet-helpers";
import { createTournament, publishTournament } from "@/server/tournaments";
import { registerForTournament } from "@/server/registration";
import { handleStripeWebhook } from "@/server/stripe-webhook";
import { buildCheckoutParams, signStripePayload, verifyStripeSignature } from "@/server/payments/stripe";
import { adminAdjustWallet, adminFreezeWallet, adminOverview, adminUnfreezeWallet } from "@/server/admin-wallet";
import { cronAuthorized, runWalletCron } from "@/server/cron";
import { reconcileAll } from "@/server/wallet";
import { createChallenge } from "@/server/challenges";

const SECRET = "whsec_test_secret_123";
beforeEach(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  await db.rateLimit.deleteMany();
});

async function paidOrder() {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const t = await createTournament(owner, { orgId: org.id, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", name: `Copa paga ${Math.random().toString(36).slice(2, 7)}`, startsAt: new Date(Date.now() + 48 * 3600_000), maxParticipants: 8, entryFeeCents: 2000 });
  await publishTournament(owner, t.id);
  const u = await makeUser();
  await linkGame(u, "sf6");
  const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
  return { t, u, r };
}

const sessionEvent = (id: string, type: string, orderId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, type, data: { object: { id: `cs_${id}`, client_reference_id: orderId, payment_status: "paid", payment_intent: `pi_${id}`, amount_total: 2200, currency: "brl", ...extra } } });

const send = (body: string, sig = signStripePayload(body, SECRET)) => handleStripeWebhook(body, sig);

describe("webhook da Stripe", () => {
  it("assinatura: rejeita ausente, errada, adulterada e antiga", async () => {
    const { r } = await paidOrder();
    const body = sessionEvent("evt_sig", "checkout.session.completed", r.orderId!);
    expect((await handleStripeWebhook(body, null)).status).toBe(400);
    expect((await handleStripeWebhook(body, signStripePayload(body, "outro-segredo"))).status).toBe(400);
    expect((await handleStripeWebhook(body + " ", signStripePayload(body, SECRET))).status).toBe(400); // corpo alterado
    expect((await handleStripeWebhook(body, signStripePayload(body, SECRET, Date.now() - 10 * 60_000))).status).toBe(400);
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET), SECRET)).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId! } })).status).toBe("PENDING");
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await handleStripeWebhook(body, signStripePayload(body, SECRET))).status).toBe(400); // sem segredo configurado nada passa
  });

  it("pagamento confirmado registra o participante; o mesmo evento não repete efeitos", async () => {
    const { r } = await paidOrder();
    const body = sessionEvent("evt_ok", "checkout.session.completed", r.orderId!);
    expect((await send(body)).status).toBe(200);
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId! } });
    expect(order.status).toBe("PAID");
    expect(order.providerPaymentId).toBe("pi_evt_ok");
    expect((await db.participant.findUniqueOrThrow({ where: { id: r.participantId } })).status).toBe("REGISTERED");
    const again = await send(body);
    expect(again.body).toMatchObject({ duplicate: true });
  });

  it("valor ou moeda divergentes não confirmam a inscrição", async () => {
    const { r } = await paidOrder();
    await send(sessionEvent("evt_amt", "checkout.session.completed", r.orderId!, { amount_total: 100 }));
    expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId! } })).status).toBe("FAILED");
    expect((await db.participant.findUniqueOrThrow({ where: { id: r.participantId } })).status).toBe("PENDING_PAYMENT");
    expect(await db.auditLog.count({ where: { action: "order.amount_mismatch", entityId: r.orderId! } })).toBe(1);
    const second = await paidOrder();
    await send(sessionEvent("evt_cur", "checkout.session.completed", second.r.orderId!, { currency: "usd" }));
    expect((await db.order.findUniqueOrThrow({ where: { id: second.r.orderId! } })).status).toBe("FAILED");
  });

  it("não pago, pedido inexistente e evento desconhecido são ignorados com segurança", async () => {
    const { r } = await paidOrder();
    expect((await send(sessionEvent("evt_unpaid", "checkout.session.completed", r.orderId!, { payment_status: "unpaid" }))).status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId! } })).status).toBe("PENDING");
    expect((await send(sessionEvent("evt_ghost", "checkout.session.completed", "pedido-que-nao-existe"))).status).toBe(200); // pedido alheio: ignora, sem reenvio infinito
    expect((await send(sessionEvent("evt_other", "customer.created", r.orderId!))).status).toBe(200);
    expect((await handleStripeWebhook("não é json", signStripePayload("não é json", SECRET))).status).toBe(400);
  });

  it("sessão expirada libera a vaga", async () => {
    const { r } = await paidOrder();
    await send(sessionEvent("evt_exp", "checkout.session.expired", r.orderId!, { payment_status: "unpaid" }));
    expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId! } })).status).toBe("EXPIRED");
    expect(await db.participant.findUnique({ where: { id: r.participantId } })).toBeNull();
  });

  it("parâmetros do Checkout: Pix só em BRL, valores inteiros e referência do pedido", () => {
    const base = { orderId: "o1", orderNumber: "PA-202610-ABC123", totalCents: 2200, tournamentName: "Copa", successUrl: "https://x/ok", cancelUrl: "https://x/no", expiresAt: new Date(Date.now() + 3600_000) };
    const brl = buildCheckoutParams({ ...base, currency: "BRL" });
    expect(brl["payment_method_types[1]"]).toBe("pix");
    expect(brl["line_items[0][price_data][unit_amount]"]).toBe("2200");
    expect(brl["line_items[0][price_data][currency]"]).toBe("brl");
    expect(brl.client_reference_id).toBe("o1");
    expect(buildCheckoutParams({ ...base, currency: "USD" })["payment_method_types[1]"]).toBeUndefined();
  });
});

describe("administração de carteiras", () => {
  it("congelar e descongelar exigem admin sem vínculo, motivo e sem dívida", async () => {
    const l = await makeLeader();
    await fund(l, 10_000);
    const stranger = await makeUser();
    await expect(adminFreezeWallet(stranger, l.walletId, "tentando congelar sem ser admin")).rejects.toThrow(/administradores/);
    const insider = await newAdmin();
    await db.teamMember.create({ data: { teamId: l.team.id, userId: insider.id, role: "PLAYER" } });
    await expect(adminFreezeWallet(insider, l.walletId, "sou da equipe e quero congelar")).rejects.toThrow(/Conflito/);
    await expect(adminFreezeWallet(await admin(), l.walletId, "curto")).rejects.toThrow(/10 caracteres/);
    await adminFreezeWallet(await admin(), l.walletId, "Suspeita de fraude: depósitos de terceiros");
    // carteira congelada: não cria desafio nem saca
    await expect(createChallenge(l.user, { teamId: l.team.id, gameId: "sf6", modeId: "1v1", bestOf: 1, stakeCents: 1_000, lineupUserIds: [l.user.id] })).rejects.toThrow(/congelada/);
    await db.wallet.update({ where: { id: l.walletId }, data: { debtCents: 500 } });
    await expect(adminUnfreezeWallet(await admin(), l.walletId, "Análise concluída, tudo certo")).rejects.toThrow(/dívida/);
    await db.wallet.update({ where: { id: l.walletId }, data: { debtCents: 0 } });
    await expect(adminUnfreezeWallet(await admin(), l.walletId, "ok")).rejects.toThrow(/10 caracteres/);
    await adminUnfreezeWallet(await admin(), l.walletId, "Análise concluída, tudo certo");
    expect((await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } })).frozenAt).toBeNull();
    expect(await db.auditLog.count({ where: { entityId: l.walletId, action: { in: ["wallet.freeze", "wallet.unfreeze"] } } })).toBe(2);
  });

  it("ajuste manual: teto, motivo detalhado, novo lançamento no razão e saldo nunca negativo", async () => {
    const l = await makeLeader();
    await fund(l, 10_000);
    await expect(adminAdjustWallet(await admin(), l.walletId, 0, "ajuste sem valor algum aqui")).rejects.toThrow(/diferente de zero/);
    await expect(adminAdjustWallet(await admin(), l.walletId, 300_000, "ajuste acima do teto permitido")).rejects.toThrow(/R\$ 2\.000/);
    await expect(adminAdjustWallet(await admin(), l.walletId, 500, "curto")).rejects.toThrow(/15 caracteres/);
    await expect(adminAdjustWallet(await admin(), l.walletId, -20_000, "débito maior que o saldo existente")).rejects.toThrow(/Saldo insuficiente/);
    const before = await db.ledgerEntry.count({ where: { walletId: l.walletId } });
    await adminAdjustWallet(await admin(), l.walletId, 1_500, "Crédito de cortesia por falha na plataforma");
    expect(await db.ledgerEntry.count({ where: { walletId: l.walletId } })).toBe(before + 1);
    expect((await balances(l.walletId)).available).toBe(11_500);
    const r = await reconcileAll();
    expect(r.ok, r.mismatches.join("; ")).toBe(true);
    const o = await adminOverview();
    expect(typeof o.kyc).toBe("number");
  });
});

describe("job agendado", () => {
  it("só executa com o segredo correto (comparação em tempo constante)", () => {
    process.env.CRON_SECRET = "segredo-do-cron-com-mais-de-16";
    expect(cronAuthorized("Bearer segredo-do-cron-com-mais-de-16")).toBe(true);
    expect(cronAuthorized("segredo-do-cron-com-mais-de-16")).toBe(true);
    expect(cronAuthorized("Bearer errado")).toBe(false);
    expect(cronAuthorized(null)).toBe(false);
    process.env.CRON_SECRET = "curto";
    expect(cronAuthorized("Bearer curto")).toBe(false); // segredo fraco nunca vale
    delete process.env.CRON_SECRET;
    expect(cronAuthorized("Bearer ")).toBe(false);
  });

  it("roda as rotinas e a conciliação fecha", async () => {
    const r = await runWalletCron();
    expect(r.ledgerOk).toBe(true);
    expect(r.withdrawals).toHaveProperty("processed");
  });
});
