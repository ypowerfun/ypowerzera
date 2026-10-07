import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { linkGame, makeOrg, makeUser, uid } from "./factories";
import { admin, balances, emailOf, fund, makeLeader, nextCpf } from "./wallet-helpers";
import { createTournament, publishTournament, startTournament, cancelTournament } from "@/server/tournaments";
import { checkIn, disqualifyParticipant, registerForTournament, withdrawRegistration } from "@/server/registration";
import { reportMatch, setMatchResult } from "@/server/matches";
import { cancelPendingOrder, completeOrder, createCoupon, releaseCoupon } from "@/server/orders";
import { submitKyc, reviewKyc } from "@/server/kyc";
import { handlePixWebhook, handleTransferAuthorization } from "@/server/pix-webhooks";
import { flatParams } from "@/lib/url";
import { acceptChallenge, createChallenge, reportChallengeResult } from "@/server/challenges";
import { createDeposit, reconcilePendingDeposits, resolveHeldDeposit } from "@/server/deposits";
import { handlePixWebhook as pixWebhook } from "@/server/pix-webhooks";
import { mockPayCharge, mockReverseCharge } from "@/server/pix/mock";
import { lastMailTo } from "@/server/mailer";
import { stripeProvider } from "@/server/payments/stripe";
import type { Actor } from "@/server/types";

const future = (h: number) => new Date(Date.now() + h * 3600_000);

async function setup(extra: Record<string, unknown> = {}) {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const t = await createTournament(owner, {
    orgId: org.id, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", name: `Copa dinheiro ${uid()}`, startsAt: future(48), maxParticipants: 16, requireCheckIn: true, ...extra,
  });
  await publishTournament(owner, t.id);
  return { owner, org, t };
}

async function paidPlayer(tournamentId: string, fee = 2000) {
  const u = await makeUser();
  await linkGame(u, "sf6");
  const r = await registerForTournament(u, { tournamentId, acceptRules: true });
  await completeOrder(r.orderId!, { amountTotal: fee + fee / 10, currency: "BRL", paymentId: `pi_${uid()}`, method: "card" });
  return { u, ...r };
}

describe("parâmetros repetidos na URL não derrubam a página", () => {
  it("fica o primeiro valor", () => {
    expect(flatParams({ q: ["a", "b"], pagina: "2", vazio: undefined })).toEqual({ q: "a", pagina: "2", vazio: undefined });
  });
});

describe("webhook do Pix sem assinatura não enche o banco", () => {
  const savedProvider = process.env.PIX_PROVIDER;
  afterEach(() => {
    if (savedProvider === undefined) delete process.env.PIX_PROVIDER;
    else process.env.PIX_PROVIDER = savedProvider;
  });

  it("40 chamadas forjadas gravam no máximo 5 registros de auditoria", async () => {
    await db.rateLimit.deleteMany({ where: { key: "webhook-rejected-audit" } });
    const before = await db.auditLog.count({ where: { action: "security.webhook_rejected" } });
    for (let i = 0; i < 40; i++) {
      const r = await handlePixWebhook(new Headers(), JSON.stringify({ forjado: i }));
      expect([401, 503]).toContain(r.status);
    }
    const added = (await db.auditLog.count({ where: { action: "security.webhook_rejected" } })) - before;
    expect(added).toBeLessThanOrEqual(5);
  });
});

describe("autorização de transferência sem assinatura também não enche o banco", () => {
  it("40 chamadas forjadas gravam no máximo 5 registros", async () => {
    await db.rateLimit.deleteMany({ where: { key: "transfer-auth-rejected-audit" } });
    const before = await db.auditLog.count({ where: { action: "security.transfer_auth_rejected" } });
    for (let i = 0; i < 40; i++) {
      const r = await handleTransferAuthorization(new Headers(), JSON.stringify({ forjado: i }));
      expect([401, 503]).toContain(r.status);
    }
    expect((await db.auditLog.count({ where: { action: "security.transfer_auth_rejected" } })) - before).toBeLessThanOrEqual(5);
  });
});

describe("início do campeonato: quem fica de fora é avisado e, se já pagou antes do fim do check-in, reembolsado", () => {
  async function tournamentWithNoShow(checkInClosed: boolean) {
    const { owner, t } = await setup({ entryFeeCents: 2000 });
    const players: Actor[] = [];
    for (let i = 0; i < 4; i++) players.push((await paidPlayer(t.id)).u);
    const noShow = await paidPlayer(t.id);
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id, userId: { in: players.map((p) => p.id) } } })) await checkIn(owner, p.id);
    if (checkInClosed) await db.tournament.update({ where: { id: t.id }, data: { checkInClosesAt: new Date(Date.now() - 3600_000) } });
    await startTournament(owner, t.id);
    return { noShow };
  }

  it("check-in ainda aberto: reembolsa e avisa", async () => {
    const { noShow } = await tournamentWithNoShow(false);
    expect((await db.order.findUniqueOrThrow({ where: { id: noShow.orderId! } })).status).toMatch(/REFUNDED/);
    const n = await db.notification.findFirstOrThrow({ where: { userId: noShow.u.id, kind: "participant.dropped" } });
    expect(n.body).toMatch(/reembolsado/);
  });

  it("check-in já encerrado: a regra do campeonato vale (sem reembolso), mas a pessoa é avisada", async () => {
    const { noShow } = await tournamentWithNoShow(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: noShow.orderId! } })).status).toBe("PAID");
    const n = await db.notification.findFirstOrThrow({ where: { userId: noShow.u.id, kind: "participant.dropped" } });
    expect(n.body).not.toMatch(/reembolsado/);
    expect(n.body).toMatch(/check-in/);
  });
});

describe("cupom: o contador nunca fica negativo e o uso volta ao desistir", () => {
  it("cancelar o mesmo pedido duas vezes ao mesmo tempo devolve o cupom uma vez só", async () => {
    const { owner, org, t } = await setup({ entryFeeCents: 2000 });
    const coupon = await createCoupon(owner, { orgId: org.id, tournamentId: t.id, code: `PROMO${uid().slice(-5)}`, percentOff: 50, maxRedemptions: 3 });
    const u = await makeUser();
    await linkGame(u, "sf6");
    const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true, couponCode: coupon.code });
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemed).toBe(1);
    await Promise.allSettled([cancelPendingOrder(u, r.orderId!), cancelPendingOrder(u, r.orderId!)]);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemed).toBe(0);
    await cancelPendingOrder(u, r.orderId!); // de novo, sem efeito
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemed).toBe(0);
  });

  it("devolver um uso com o contador em zero não o deixa negativo (liberaria usos além do limite)", async () => {
    const { owner, org, t } = await setup({ entryFeeCents: 2000 });
    const coupon = await createCoupon(owner, { orgId: org.id, tournamentId: t.id, code: `ZERO${uid().slice(-5)}`, percentOff: 10, maxRedemptions: 1 });
    await releaseCoupon(db, coupon.id);
    await releaseCoupon(db, coupon.id);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemed).toBe(0);
  });

  it("inscrição grátis por cupom de 100% devolve o uso ao desistir (não dá para esgotar o cupom em loop)", async () => {
    const { owner, org, t } = await setup({ entryFeeCents: 2000 });
    const coupon = await createCoupon(owner, { orgId: org.id, tournamentId: t.id, code: `FREE${uid().slice(-5)}`, percentOff: 100, maxRedemptions: 1 });
    const u = await makeUser();
    await linkGame(u, "sf6");
    for (let i = 0; i < 3; i++) {
      await db.rateLimit.deleteMany({ where: { key: { startsWith: "coupon:" } } });
      const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true, couponCode: coupon.code });
      expect(r.status).toBe("REGISTERED");
      expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemed).toBe(1);
      await withdrawRegistration(u, r.participantId);
      expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemed).toBe(0);
    }
    // e outra pessoa ainda consegue usar o cupom limitado
    const other = await makeUser();
    await linkGame(other, "sf6");
    expect((await registerForTournament(other, { tournamentId: t.id, acceptRules: true, couponCode: coupon.code })).status).toBe("REGISTERED");
  });
});

describe("desclassificado não apaga a punição desistindo", () => {
  it("a desistência é recusada e a inscrição continua desclassificada", async () => {
    const { owner, t } = await setup();
    const u = await makeUser();
    await linkGame(u, "sf6");
    const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
    await disqualifyParticipant(owner, r.participantId, "Uso de programa proibido");
    await expect(withdrawRegistration(u, r.participantId)).rejects.toThrow(/desclassificada/);
    await expect(registerForTournament(u, { tournamentId: t.id, acceptRules: true })).rejects.toThrow(/já está inscrito/);
    expect((await db.participant.findUniqueOrThrow({ where: { id: r.participantId } })).status).toBe("DISQUALIFIED");
    // a organização continua podendo remover
    await withdrawRegistration(owner, r.participantId);
    expect(await db.participant.findUnique({ where: { id: r.participantId } })).toBeNull();
  });
});

describe("relato de placar e textos da organização", () => {
  async function live() {
    const { owner, t } = await setup();
    const players = new Map<string, Actor>();
    for (let i = 0; i < 4; i++) {
      const u = await makeUser();
      await linkGame(u, "sf6");
      await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
      players.set(u.id, u);
    }
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    const match = await db.match.findFirstOrThrow({ where: { status: "READY", stage: { tournamentId: t.id } }, include: { participantA: true, participantB: true } });
    return { owner, t, match, a: players.get(match.participantA!.userId)!, b: players.get(match.participantB!.userId)! };
  }

  it("repetir o mesmo placar não avisa o adversário de novo", async () => {
    const { match, a, b } = await live();
    for (let i = 0; i < 5; i++) await reportMatch(a, match.id, 2, 0);
    expect(await db.notification.count({ where: { userId: b.id, kind: "match.reported" } })).toBe(1);
    await reportMatch(a, match.id, 2, 1); // placar diferente: avisa de novo
    expect(await db.notification.count({ where: { userId: b.id, kind: "match.reported" } })).toBe(2);
  });

  it("textos livres da organização têm limite", async () => {
    const { owner, t, match } = await live();
    await expect(setMatchResult(owner, match.id, 2, 0, "x".repeat(501))).rejects.toThrow(/500 caracteres/);
    const p = await db.participant.findFirstOrThrow({ where: { tournamentId: t.id } });
    await expect(disqualifyParticipant(owner, p.id, "y".repeat(501))).rejects.toThrow(/500 caracteres/);
    await expect(cancelTournament(owner, t.id, "z".repeat(501))).rejects.toThrow(/500 caracteres/);
  });
});

describe("KYC: o CPF não pode ser 'reservado' por quem não é o titular", () => {
  it("um envio ainda não verificado cede o lugar ao titular; um CPF já verificado continua protegido", async () => {
    const adm = await admin();
    const cpf = nextCpf();
    const squatter = await makeUser();
    const owner = await makeUser();
    await submitKyc(squatter, { fullName: "Pessoa Que Reservou", cpf, birthDate: "1990-01-01" });
    // o titular de verdade envia o mesmo CPF: assume o lugar, o envio do outro é retirado e os dois lados são avisados
    await submitKyc(owner, { fullName: "Titular Verdadeiro Silva", cpf, birthDate: "1991-02-02" });
    expect(await db.kycProfile.findUnique({ where: { userId: squatter.id } })).toBeNull();
    expect((await db.kycProfile.findUniqueOrThrow({ where: { userId: owner.id } })).status).toBe("PENDING");
    expect(await db.notification.count({ where: { userId: squatter.id, kind: "kyc.displaced" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "kyc.displaced", entityId: squatter.id } })).toBe(1);
    // depois de verificado pelo admin, ninguém mais toma o CPF
    await reviewKyc(adm, owner.id, "approve");
    await expect(submitKyc(squatter, { fullName: "Pessoa Que Reservou", cpf, birthDate: "1990-01-01" })).rejects.toThrow(/já está vinculado/);
    expect((await db.kycProfile.findUniqueOrThrow({ where: { userId: owner.id } })).status).toBe("VERIFIED");
  });
});

describe("configuração de produção do Pix", () => {
  const KEYS = ["NODE_ENV", "PIX_PROVIDER", "PIX_REQUIRE_PAYER_DOC"];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else (process.env as Record<string, string>)[k] = saved[k]!;
    }
  });

  it("com Asaas em produção o CPF do pagador é exigido por padrão (o Asaas não informa quem pagou)", () => {
    const env = process.env as Record<string, string>;
    env.NODE_ENV = "production";
    env.PIX_PROVIDER = "asaas";
    delete env.PIX_REQUIRE_PAYER_DOC;
    expect(getEnv().pixRequirePayerDoc).toBe(true);
    env.PIX_REQUIRE_PAYER_DOC = "false";
    expect(getEnv().pixRequirePayerDoc).toBe(false);
    env.NODE_ENV = "test";
    delete env.PIX_REQUIRE_PAYER_DOC;
    expect(getEnv().pixRequirePayerDoc).toBe(false);
  });
});

describe("desafio: quem alega vitória avisa o adversário também por e-mail", () => {
  it("o líder do outro lado recebe o link para confirmar ou contestar", async () => {
    const a = await makeLeader();
    const b = await makeLeader();
    await fund(a, 20_000);
    await fund(b, 20_000);
    const c = await createChallenge(a.user, { teamId: a.team.id, gameId: "sf6", modeId: "1v1", bestOf: 3, stakeCents: 5_000, lineupUserIds: [a.user.id] });
    await acceptChallenge(b.user, c.id, { teamId: b.team.id, lineupUserIds: [b.user.id] });
    expect(await reportChallengeResult(a.user, c.id, "WON")).toBe("reported");
    const mail = lastMailTo(await emailOf(b.user));
    expect(mail?.subject).toMatch(/Confirme o resultado/);
    expect(mail?.text).toContain(`/desafios/${c.id}`);
    // quem alegou não recebe o próprio aviso
    expect(lastMailTo(await emailOf(a.user))?.subject ?? "").not.toMatch(/Confirme o resultado/);
  });
});

describe("Stripe: clicar em 'Pagar' de novo abre outra sessão (a chave de idempotência acompanha a expiração)", () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  });

  it("duas tentativas em horários diferentes usam chaves diferentes", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_chave_de_teste_do_vitest";
    const keys: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
      keys.push(init.headers["Idempotency-Key"]);
      return { ok: true, json: async () => ({ id: "cs_1", url: "https://stripe.test/pay" }) } as unknown as Response;
    });
    const order = { id: "ord_idem", number: "PA-1", totalCents: 2200, currency: "BRL", expiresAt: new Date(Date.now() + 10 * 60_000) };
    const tournament = { name: "Copa" };
    const args = { order, tournament, customerEmail: "a@b.com", successUrl: "https://x/ok", cancelUrl: "https://x/no" } as unknown as Parameters<typeof stripeProvider.createCheckout>[0];
    await stripeProvider.createCheckout(args);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await stripeProvider.createCheckout(args);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((k) => k.startsWith("checkout-ord_idem-"))).toBe(true);
  });
});

describe("Pix pago com o webhook perdido é creditado pela reconsulta do agendador", () => {
  it("credita uma vez só e ignora o que ainda não foi pago", async () => {
    const l = await makeLeader();
    const paid = await createDeposit(l.user, { teamId: l.team.id, amountCents: 3_000 });
    const unpaid = await createDeposit(l.user, { teamId: l.team.id, amountCents: 2_000 });
    await mockPayCharge(paid.providerChargeId!, l.cpf); // o banco confirmou o pagamento, mas o webhook nunca chegou
    // recém-criadas: ainda não são reconsultadas
    expect((await reconcilePendingDeposits()).credited).toBe(0);
    await db.deposit.updateMany({ where: { id: { in: [paid.id, unpaid.id] } }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    const r = await reconcilePendingDeposits();
    expect(r.credited).toBeGreaterThanOrEqual(1);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("CONFIRMED");
    expect((await db.deposit.findUniqueOrThrow({ where: { id: unpaid.id } })).status).toBe("PENDING");
    expect((await balances(l.walletId)).available).toBe(3_000);
    await reconcilePendingDeposits(); // de novo: não credita em dobro
    expect((await balances(l.walletId)).available).toBe(3_000);
  });
});

describe("reembolso automático que falha depois da desistência não se perde", () => {
  it("a desistência vale, o erro vira aviso à organização e a quem pagou", async () => {
    const { owner, t } = await setup({ entryFeeCents: 2000 });
    const p = await paidPlayer(t.id);
    // o provedor não consegue devolver (pedido sem pagamento associado)
    await db.order.update({ where: { id: p.orderId! }, data: { provider: "stripe", providerPaymentId: null } });
    await expect(withdrawRegistration(p.u, p.participantId)).resolves.toBeUndefined();
    expect(await db.participant.findUnique({ where: { id: p.participantId } })).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: p.orderId! } })).status).toBe("PAID");
    expect(await db.notification.count({ where: { userId: owner.id, kind: "order.refund_failed" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: p.u.id, kind: "order.refund_pending" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "order.refund_failed", entityId: p.orderId! } })).toBe(1);
  });
});

describe("depósito retido: o admin não libera Pix que já foi estornado", () => {
  it("estorno que chega enquanto retido marca o depósito; e liberar rechecando o provedor recusa o estornado", async () => {
    const adm = await admin();
    // (a) o estorno chega pelo webhook enquanto o depósito está retido
    const a = await makeLeader();
    const held = await fund(a, 3_000, { payerCpf: nextCpf() }); // CPF de outra pessoa: fica retido
    expect((await db.deposit.findUniqueOrThrow({ where: { id: held.dep.id } })).status).toBe("HELD");
    const rev = await mockReverseCharge(held.dep.providerChargeId!);
    await pixWebhook(rev.headers, rev.rawBody);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: held.dep.id } })).status).toBe("REFUNDED");
    await expect(resolveHeldDeposit(adm, held.dep.id, "credit", "tentando liberar depois do estorno")).rejects.toThrow(/não está retido/);
    expect((await balances(a.walletId)).available).toBe(0);

    // (b) o webhook do estorno se perdeu: a liberação reconsulta o provedor e recusa
    const b = await makeLeader();
    const held2 = await fund(b, 3_000, { payerCpf: nextCpf() });
    await mockReverseCharge(held2.dep.providerChargeId!); // sem entregar o webhook
    await expect(resolveHeldDeposit(adm, held2.dep.id, "credit", "liberando sem saber do estorno")).rejects.toThrow(/não mostra este Pix como pago/);
    expect((await balances(b.walletId)).available).toBe(0);
    await resolveHeldDeposit(adm, held2.dep.id, "refund", "devolvendo o valor ao pagador");
  });
});
