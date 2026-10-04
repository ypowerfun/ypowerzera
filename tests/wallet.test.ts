import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { decryptField, hmacHex } from "@/lib/crypto";
import { generateCpf, isValidCpf, onlyDigits } from "@/lib/cpf";
import { makeUser } from "./factories";
import { admin, backdate, balances, fund, makeKycUser, makeLeader, nextCpf, newAdmin } from "./wallet-helpers";
import { getKyc, reviewKyc, submitKyc } from "@/server/kyc";
import { createDeposit, resolveHeldDeposit } from "@/server/deposits";
import { handlePixWebhook } from "@/server/pix-webhooks";
import { buildMockWebhook, mockPayCharge, mockReverseCharge } from "@/server/pix/mock";
import { freezeWallet, getOrCreateTeamWallet, getPlatformWallet, postLedger, reconcileAll, withdrawableBreakdown } from "@/server/wallet";
import { signPayload } from "@/lib/signature";
import { mockWebhookSecret } from "@/lib/crypto";

async function clearLimits() {
  await db.rateLimit.deleteMany();
}
beforeEach(clearLimits);

describe("CPF e criptografia", () => {
  it("valida dígitos verificadores e rejeita sequências", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
    for (let i = 1; i < 50; i++) expect(isValidCpf(generateCpf(i * 977))).toBe(true);
  });

  it("AES-GCM: cifra/decifra e detecta adulteração", async () => {
    const { encryptField } = await import("@/lib/crypto");
    const c = encryptField("52998224725");
    expect(c).not.toContain("52998224725");
    expect(decryptField(c)).toBe("52998224725");
    expect(encryptField("52998224725")).not.toBe(c); // IV aleatório
    const parts = c.split(".");
    parts[3] = parts[3].slice(0, -2) + "AA";
    expect(() => decryptField(parts.join("."))).toThrow();
    expect(hmacHex("123", "cpf")).toBe(hmacHex("123", "cpf"));
    expect(hmacHex("123", "cpf")).not.toBe(hmacHex("123", "outro"));
  });
});

describe("KYC", () => {
  it("menor de idade, CPF inválido e CPF duplicado são barrados; CPF fica cifrado", async () => {
    const u = await makeUser();
    await expect(submitKyc(u, { fullName: "Menor de Idade", cpf: nextCpf(), birthDate: new Date(Date.now() - 16 * 365 * 86400_000).toISOString().slice(0, 10) })).rejects.toThrow(/18 anos/);
    await expect(submitKyc(u, { fullName: "Fulano Silva", cpf: "111.111.111-11", birthDate: "1990-01-01" })).rejects.toThrow(/CPF inválido/);
    await expect(submitKyc(u, { fullName: "Fulano", cpf: nextCpf(), birthDate: "1990-01-01" })).rejects.toThrow(/Nome/i);
    const cpf = nextCpf();
    await submitKyc(u, { fullName: "Fulano de Tal", cpf, birthDate: "1990-01-01" });
    const row = await db.kycProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(row.cpfEnc).not.toContain(cpf);
    expect(JSON.stringify(row)).not.toContain(cpf);
    expect(decryptField(row.cpfEnc)).toBe(cpf);
    expect(row.status).toBe("PENDING");
    const other = await makeUser();
    await expect(submitKyc(other, { fullName: "Outra Pessoa", cpf, birthDate: "1991-02-02" })).rejects.toThrow(/outra conta/);
    // formatação diferente do mesmo CPF também é detectada
    await expect(submitKyc(other, { fullName: "Outra Pessoa", cpf: cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"), birthDate: "1991-02-02" })).rejects.toThrow(/outra conta/);
  });

  it("só administrador revisa, e não o próprio cadastro", async () => {
    const u = await makeUser();
    await submitKyc(u, { fullName: "Fulano de Tal", cpf: nextCpf(), birthDate: "1990-01-01" });
    const stranger = await makeUser();
    await expect(reviewKyc(stranger, u.id, "approve")).rejects.toThrow(/administradores/);
    const adm = await newAdmin();
    await submitKyc(adm, { fullName: "Admin Silva", cpf: nextCpf(), birthDate: "1990-01-01" });
    await expect(reviewKyc(adm, adm.id, "approve")).rejects.toThrow(/próprio/);
    await expect(reviewKyc(adm, u.id, "reject", "x")).rejects.toThrow(/motivo/);
    await reviewKyc(adm, u.id, "approve");
    expect((await getKyc(u.id))?.status).toBe("VERIFIED");
    await expect(submitKyc(u, { fullName: "Fulano de Tal", cpf: nextCpf(), birthDate: "1990-01-01" })).rejects.toThrow(/já foram verificados/);
  });
});

describe("razão contábil (ledger)", () => {
  it("é idempotente e recusa reuso da chave com dados diferentes", async () => {
    const l = await makeLeader();
    await db.$transaction(async (tx) => {
      await postLedger(tx, { walletId: l.walletId, type: "ADJUSTMENT", available: 5000, refType: "t", refId: "1", key: "k-idem", allowFrozen: true });
      await postLedger(tx, { walletId: l.walletId, type: "ADJUSTMENT", available: 5000, refType: "t", refId: "1", key: "k-idem", allowFrozen: true });
    });
    expect((await balances(l.walletId)).available).toBe(5000);
    await expect(db.$transaction((tx) => postLedger(tx, { walletId: l.walletId, type: "ADJUSTMENT", available: 9999, refType: "t", refId: "1", key: "k-idem", allowFrozen: true }))).rejects.toThrow(/idempotência/);
    expect((await balances(l.walletId)).available).toBe(5000);
  });

  it("nunca fica negativo, mesmo com 10 saídas concorrentes", async () => {
    const l = await makeLeader();
    await db.$transaction((tx) => postLedger(tx, { walletId: l.walletId, type: "ADJUSTMENT", available: 10000, refType: "t", refId: "x", key: "seed-balance", allowFrozen: true }));
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        db.$transaction((tx) => postLedger(tx, { walletId: l.walletId, type: "STAKE_LOCK", available: -3000, locked: 3000, refType: "t", refId: String(i), key: `race-${i}` })),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
    const b = await balances(l.walletId);
    expect(b).toEqual({ available: 1000, locked: 9000 });
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("carteira congelada bloqueia saídas, mas aceita créditos", async () => {
    const l = await makeLeader();
    await db.$transaction((tx) => postLedger(tx, { walletId: l.walletId, type: "ADJUSTMENT", available: 5000, refType: "t", refId: "x", key: `seed-${l.walletId}`, allowFrozen: true }));
    await freezeWallet(db, l.walletId, "teste");
    await expect(db.$transaction((tx) => postLedger(tx, { walletId: l.walletId, type: "STAKE_LOCK", available: -100, locked: 100, refType: "t", refId: "y", key: `lock-${l.walletId}` }))).rejects.toThrow(/congelada/);
    await db.$transaction((tx) => postLedger(tx, { walletId: l.walletId, type: "ADJUSTMENT", available: 100, refType: "t", refId: "z", key: `credit-${l.walletId}`, allowFrozen: true }));
    expect((await balances(l.walletId)).available).toBe(5100);
  });

  it("a conciliação detecta adulteração direta do saldo", async () => {
    const l = await makeLeader();
    await fund(l, 5000_00 / 10);
    expect((await reconcileAll()).ok).toBe(true);
    await db.wallet.update({ where: { id: l.walletId }, data: { balanceCents: { increment: 100 } } });
    const r = await reconcileAll();
    expect(r.ok).toBe(false);
    expect(r.mismatches.join(" ")).toMatch(/saldo/);
    await db.wallet.update({ where: { id: l.walletId }, data: { balanceCents: { decrement: 100 } } });
    expect((await reconcileAll()).ok).toBe(true);
  });
});

describe("depósitos Pix", () => {
  it("só o líder da equipe deposita; exige KYC e valores válidos", async () => {
    const l = await makeLeader();
    const member = await makeKycUser();
    await db.teamMember.create({ data: { teamId: l.team.id, userId: member.user.id, role: "PLAYER" } });
    await expect(createDeposit(member.user, { teamId: l.team.id, amountCents: 5000 })).rejects.toThrow(/líder/);
    const outsider = await makeKycUser();
    await expect(createDeposit(outsider.user, { teamId: l.team.id, amountCents: 5000 })).rejects.toThrow(/líder/);
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 550 })).rejects.toThrow(/inteiros/);
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 500 })).rejects.toThrow(/mínimo/);
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 5_000_000 })).rejects.toThrow(/máximo/);
    const noKyc = await makeUser();
    const { createTeam } = await import("@/server/teams");
    const t = await createTeam(noKyc, { name: `Sem KYC ${Math.random()}`, tag: "SKY" });
    await expect(createDeposit(noKyc, { teamId: t.id, amountCents: 5000 })).rejects.toThrow(/identidade/);
    const unverified = await makeUser({ verified: false });
    await expect(createDeposit(unverified, { teamId: l.team.id, amountCents: 5000 })).rejects.toThrow(/e-mail/i);
  });

  it("webhook com assinatura inválida é rejeitado e nada é creditado", async () => {
    const l = await makeLeader();
    const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    await db.mockPixCharge.update({ where: { id: dep.providerChargeId! }, data: { status: "PAID", payerDoc: l.cpf } });
    const forged = JSON.stringify({ id: "evt_forjado", type: "charge.paid", chargeId: dep.providerChargeId });
    const bad = await handlePixWebhook(new Headers({ "x-mock-signature": signPayload(forged, "segredo-errado") }), forged);
    expect(bad.status).toBe(401);
    const none = await handlePixWebhook(new Headers(), forged);
    expect(none.status).toBe(401);
    expect((await balances(l.walletId)).available).toBe(0);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe("PENDING");
  });

  it("replay de assinatura antiga é rejeitado (tolerância de 5 min)", async () => {
    const l = await makeLeader();
    const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    await db.mockPixCharge.update({ where: { id: dep.providerChargeId! }, data: { status: "PAID", payerDoc: l.cpf } });
    const body = JSON.stringify({ id: "evt_old", type: "charge.paid", chargeId: dep.providerChargeId });
    const old = signPayload(body, mockWebhookSecret(), Date.now() - 10 * 60_000);
    expect((await handlePixWebhook(new Headers({ "x-mock-signature": old }), body)).status).toBe(401);
    expect((await balances(l.walletId)).available).toBe(0);
  });

  it("credita uma vez só: reentrega e webhooks concorrentes não duplicam", async () => {
    const l = await makeLeader();
    const { rawBody, headers, res } = await fund(l, 10_000);
    expect(res.status).toBe(200);
    expect((await balances(l.walletId)).available).toBe(10_000);
    // reentrega do mesmo webhook
    expect((await handlePixWebhook(headers, rawBody)).status).toBe(200);
    // 5 entregas concorrentes de um novo evento para a mesma cobrança
    const dep2 = await createDeposit(l.user, { teamId: l.team.id, amountCents: 20_000 });
    const hook = await mockPayCharge(dep2.providerChargeId!, l.cpf);
    await Promise.all(Array.from({ length: 5 }, () => handlePixWebhook(hook.headers, hook.rawBody)));
    expect((await balances(l.walletId)).available).toBe(30_000);
    expect(await db.ledgerEntry.count({ where: { walletId: l.walletId, type: "DEPOSIT" } })).toBe(2);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("evento legítimo (assinado) dizendo PAGO enquanto o provedor diz PENDENTE não credita", async () => {
    const l = await makeLeader();
    const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    const { rawBody, headers } = buildMockWebhook({ type: "charge.paid", chargeId: dep.providerChargeId });
    const r = await handlePixWebhook(headers, rawBody);
    expect(r.status).toBe(200);
    expect((await balances(l.walletId)).available).toBe(0);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe("PENDING");
  });

  it("cobrança desconhecida é ignorada", async () => {
    const { rawBody, headers } = buildMockWebhook({ type: "charge.paid", chargeId: "nao-existe" });
    const r = await handlePixWebhook(headers, rawBody);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain("ignored");
  });

  it("valor pago divergente retém o depósito sem creditar", async () => {
    const l = await makeLeader();
    const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    await db.mockPixCharge.update({ where: { id: dep.providerChargeId! }, data: { amountCents: 1_000 } });
    const hook = await mockPayCharge(dep.providerChargeId!, l.cpf);
    await handlePixWebhook(hook.headers, hook.rawBody);
    const after = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(after.status).toBe("HELD");
    expect(after.holdReason).toMatch(/diverge/);
    expect((await balances(l.walletId)).available).toBe(0);
  });

  it("CPF do pagador diferente do titular retém; só admin sem conflito libera ou devolve", async () => {
    const l = await makeLeader();
    const { dep } = await fund(l, 10_000, { payerCpf: nextCpf() });
    const held = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(held.status).toBe("HELD");
    expect(held.holdReason).toMatch(/CPF/);
    expect((await balances(l.walletId)).available).toBe(0);
    const stranger = await makeUser();
    await expect(resolveHeldDeposit(stranger, dep.id, "credit", "tentando liberar")).rejects.toThrow(/administradores/);
    await expect(resolveHeldDeposit(await admin(), dep.id, "credit", "ok")).rejects.toThrow(/5 caracteres/);
    // admin que pertence à equipe não pode decidir
    const insider = await newAdmin();
    await db.teamMember.create({ data: { teamId: l.team.id, userId: insider.id, role: "PLAYER" } });
    await expect(resolveHeldDeposit(insider, dep.id, "credit", "Conflito de interesse aqui")).rejects.toThrow(/Conflito/);
    await resolveHeldDeposit(await admin(), dep.id, "refund", "Pagador era terceiro; devolvido ao pagador");
    expect((await db.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe("REFUNDED");
    expect((await balances(l.walletId)).available).toBe(0);
    expect((await reconcileAll()).ok).toBe(true);

    const { dep: dep2 } = await fund(l, 5_000, { payerCpf: nextCpf() });
    await resolveHeldDeposit(await admin(), dep2.id, "credit", "Titular comprovou a origem do pagamento");
    expect((await balances(l.walletId)).available).toBe(5_000);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("pagamento tardio (Pix expirado) ainda é creditado", async () => {
    const l = await makeLeader();
    const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    await db.deposit.update({ where: { id: dep.id }, data: { status: "EXPIRED" } });
    const hook = await mockPayCharge(dep.providerChargeId!, l.cpf);
    await handlePixWebhook(hook.headers, hook.rawBody);
    expect((await balances(l.walletId)).available).toBe(10_000);
  });

  it("estorno (MED) retira o crédito; sem saldo vira dívida e congela", async () => {
    const l = await makeLeader();
    const { dep } = await fund(l, 10_000);
    // parte do saldo some (simula uso)
    await db.$transaction((tx) => postLedger(tx, { walletId: l.walletId, type: "ADJUSTMENT", available: -6_000, refType: "t", refId: "x", key: `use-${l.walletId}`, allowFrozen: true }));
    const rev = await mockReverseCharge(dep.providerChargeId!);
    await handlePixWebhook(rev.headers, rev.rawBody);
    const w = await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } });
    expect(w.balanceCents).toBe(0);
    expect(w.debtCents).toBe(6_000);
    expect(w.frozenAt).not.toBeNull();
    expect((await db.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe("REVERSED");
    // estornar de novo não faz nada
    await handlePixWebhook(rev.headers, rev.rawBody);
    expect((await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } })).debtCents).toBe(6_000);
  });

  it("limites: Pix pendentes e total diário", async () => {
    const l = await makeLeader();
    for (let i = 0; i < 3; i++) await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 })).rejects.toThrow(/pendentes/);
  });
});

describe("saldo sacável (giro e retenções)", () => {
  it("depósito sem jogar não é sacável; depósito recente fica retido", async () => {
    const l = await makeLeader();
    await fund(l, 20_000);
    let b = await withdrawableBreakdown(db, l.walletId);
    expect(b.balanceCents).toBe(20_000);
    expect(b.withdrawableCents).toBe(0);
    expect(b.unplayedDepositsCents).toBe(20_000);
    await backdate(l.walletId, 100); // passou a janela de retenção, mas continua sem giro
    b = await withdrawableBreakdown(db, l.walletId);
    expect(b.recentDepositsCents).toBe(0);
    expect(b.withdrawableCents).toBe(0);
  });

  it("platform wallet existe e a conciliação segue íntegra", async () => {
    await getPlatformWallet(db);
    expect((await reconcileAll()).ok).toBe(true);
  });
});
