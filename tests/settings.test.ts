import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PASSWORD, makeUser } from "./factories";
import { admin, balances, emailOf, fund, lastOtp, leaderWithWinnings, makeLeader } from "./wallet-helpers";
import { assertWalletOn, isWalletOn, setWalletEnabled, setWithdrawalsNeedAdminApproval, walletReadiness, walletState, withdrawalsNeedAdminApproval } from "@/server/settings";
import { createDeposit } from "@/server/deposits";
import { acceptChallenge, createChallenge } from "@/server/challenges";
import { confirmWithdrawal, expireStaleWithdrawalConfirmations, requestWithdrawal, reviewWithdrawal } from "@/server/withdrawals";
import { handlePixWebhook } from "@/server/pix-webhooks";
import { mockPayCharge } from "@/server/pix/mock";
import { reconcileAll } from "@/server/wallet";

const ENV_KEYS = ["NODE_ENV", "WALLET_ENABLED", "PIX_PROVIDER", "ALLOW_MOCK_PIX", "ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN", "ASAAS_TRANSFER_AUTH_TOKEN", "DATA_ENCRYPTION_KEY", "CRON_SECRET", "APP_URL"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const nonce = () => `nonce-${Math.random().toString(36).slice(2)}-${Date.now()}`;

beforeEach(async () => {
  await db.rateLimit.deleteMany();
});
afterEach(async () => {
  await db.siteSetting.deleteMany({ where: { key: { in: ["wallet.enabled", "withdraw.requireAdminApproval"] } } });
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = savedEnv[k]!;
  }
});

const challengeInput = (l: Awaited<ReturnType<typeof makeLeader>>) => ({ teamId: l.team.id, gameId: "sf6", modeId: "1v1", bestOf: 3, stakeCents: 1_000, lineupUserIds: [l.user.id] });

describe("chave da Carteira (admin)", () => {
  it("padrão: carteira ligada e pronta (ambiente de teste) e todo saque exige o admin", async () => {
    const s = await walletState();
    expect(s).toMatchObject({ switchOn: true, envBlocked: false, effective: true, withdrawRequireAdmin: true });
    expect(s.readiness.ready).toBe(true);
    expect(await isWalletOn()).toBe(true);
    await expect(assertWalletOn()).resolves.toBeUndefined();
  });

  it("desligada: nenhuma operação NOVA de dinheiro passa", async () => {
    const l = await makeLeader();
    await fund(l, 20_000);
    const opponent = await makeLeader();
    await fund(opponent, 20_000);
    const open = await createChallenge(l.user, challengeInput(l));

    await setWalletEnabled(await admin(), false);
    expect(await isWalletOn()).toBe(false);
    await expect(assertWalletOn()).rejects.toThrow(/desativada/);
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 1_000 })).rejects.toThrow(/desativada/);
    await expect(createChallenge(l.user, challengeInput(l))).rejects.toThrow(/desativada/);
    await expect(acceptChallenge(opponent.user, open.id, { teamId: opponent.team.id, lineupUserIds: [opponent.user.id] })).rejects.toThrow(/desativada/);
    await expect(requestWithdrawal(l.user, { teamId: l.team.id, amountCents: 2_000, password: PASSWORD, nonce: nonce() })).rejects.toThrow(/desativada/);
    expect(await db.auditLog.count({ where: { action: "settings.wallet" } })).toBeGreaterThan(0);

    // religa: tudo volta
    await setWalletEnabled(await admin(), true);
    expect(await isWalletOn()).toBe(true);
    await acceptChallenge(opponent.user, open.id, { teamId: opponent.team.id, lineupUserIds: [opponent.user.id] });
  });

  it("desligar NÃO prende dinheiro que já estava em andamento (Pix já gerado, saque já pedido)", async () => {
    const l = await makeLeader();
    const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    const { winner } = await leaderWithWinnings(200_000, 50_000);
    const { withdrawalId } = await requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() });
    expect(await confirmWithdrawal(winner.user, withdrawalId, lastOtp(await emailOf(winner.user)))).toBe("under_review");

    await setWalletEnabled(await admin(), false);

    // o Pix que o jogador já pagou continua sendo creditado
    const { rawBody, headers } = await mockPayCharge(dep.providerChargeId!, l.cpf);
    await handlePixWebhook(headers, rawBody);
    expect((await balances(l.walletId)).available).toBe(10_000);
    // e o admin ainda consegue analisar o saque que já estava na fila
    await reviewWithdrawal(await admin(), withdrawalId, "approve", "Saque pedido antes de a carteira ser desligada");
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } })).status).toBe("APPROVED");
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("só admin liga e desliga", async () => {
    const organizer = await makeUser({ role: "ORGANIZER" });
    const player = await makeUser();
    await expect(setWalletEnabled(player, false)).rejects.toThrow(/administradores/);
    await expect(setWalletEnabled(organizer, false)).rejects.toThrow(/administradores/);
    await expect(setWithdrawalsNeedAdminApproval(organizer, false)).rejects.toThrow(/administradores/);
    expect((await walletState()).switchOn).toBe(true);
  });

  it("só liga quando a configuração necessária está pronta; sem ela a aba fica oculta mesmo com a chave ligada", async () => {
    const env = process.env as Record<string, string>;
    env.NODE_ENV = "production";
    env.PIX_PROVIDER = "mock";
    delete env.ALLOW_MOCK_PIX;
    delete env.DATA_ENCRYPTION_KEY;
    delete env.CRON_SECRET;
    env.APP_URL = "http://localhost:3000";

    const bad = walletReadiness();
    expect(bad.ready).toBe(false);
    expect(bad.items.filter((i) => !i.ok).map((i) => i.key).sort()).toEqual(["cron", "encryption", "pix", "url"]);
    // a chave está ligada (padrão), mas a carteira não aparece para os usuários
    expect(await isWalletOn()).toBe(false);
    await expect(assertWalletOn()).rejects.toThrow(/incompleta/);
    await setWalletEnabled(await admin(), false); // desligar sempre pode
    await expect(setWalletEnabled(await admin(), true)).rejects.toThrow(/Termine as configurações antes de ativar.*Provedor de Pix/);
    expect((await walletState()).switchOn).toBe(false);

    // termina as configurações → agora liga
    env.PIX_PROVIDER = "asaas";
    env.ASAAS_API_KEY = "k";
    env.ASAAS_WEBHOOK_TOKEN = "w".repeat(40);
    env.ASAAS_TRANSFER_AUTH_TOKEN = "t".repeat(40);
    env.DATA_ENCRYPTION_KEY = "a".repeat(44);
    env.CRON_SECRET = "c".repeat(32);
    env.APP_URL = "https://arena.example.com";
    expect(walletReadiness().ready).toBe(true);
    await setWalletEnabled(await admin(), true);
    expect(await isWalletOn()).toBe(true);
  });

  it("WALLET_ENABLED=false no servidor não pode ser religado pela interface", async () => {
    process.env.WALLET_ENABLED = "false";
    const s = await walletState();
    expect(s).toMatchObject({ envBlocked: true, effective: false });
    await expect(setWalletEnabled(await admin(), true)).rejects.toThrow(/variável de ambiente/);
    await expect(assertWalletOn()).rejects.toThrow(/desativada/);
  });

  it("exigir o admin em todo saque: ligado por padrão, só o admin altera, tudo auditado", async () => {
    expect(await withdrawalsNeedAdminApproval()).toBe(true);
    await setWithdrawalsNeedAdminApproval(await admin(), false);
    expect(await withdrawalsNeedAdminApproval()).toBe(false);
    await setWithdrawalsNeedAdminApproval(await admin(), true);
    expect(await withdrawalsNeedAdminApproval()).toBe(true);
    expect(await db.auditLog.count({ where: { action: "settings.withdraw_admin_approval" } })).toBeGreaterThanOrEqual(2);
  });

  it("saque que ficou sem o código volta ao saldo pelo agendador, mesmo com a carteira desativada", async () => {
    const { winner } = await leaderWithWinnings(200_000, 50_000);
    const before = await balances(winner.walletId);
    const { withdrawalId } = await requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() });
    expect((await balances(winner.walletId)).locked).toBe(before.locked + 5_000);

    await setWalletEnabled(await admin(), false); // some a tela de confirmar: o usuário não tem como voltar lá
    expect(await expireStaleWithdrawalConfirmations()).toBe(0); // o código ainda vale
    await db.withdrawal.update({ where: { id: withdrawalId }, data: { otpExpiresAt: new Date(Date.now() - 60_000) } });
    expect(await expireStaleWithdrawalConfirmations()).toBe(1);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } })).status).toBe("CANCELED");
    expect(await balances(winner.walletId)).toEqual(before); // o valor voltou inteiro
    expect(await expireStaleWithdrawalConfirmations()).toBe(0); // idempotente
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("a chave de criptografia só passa na verificação se rende 32 bytes (a mesma regra de quem cifra o CPF)", async () => {
    const env = process.env as Record<string, string>;
    env.NODE_ENV = "production";
    env.PIX_PROVIDER = "asaas";
    env.ASAAS_API_KEY = "k";
    env.ASAAS_WEBHOOK_TOKEN = "w".repeat(40);
    env.ASAAS_TRANSFER_AUTH_TOKEN = "t".repeat(40);
    env.CRON_SECRET = "c".repeat(32);
    env.APP_URL = "https://arena.example.com";
    env.DATA_ENCRYPTION_KEY = "a".repeat(32); // `openssl rand -hex 16`: 32 caracteres, só 24 bytes em base64
    expect(walletReadiness().items.find((i) => i.key === "encryption")!.ok).toBe(false);
    expect(walletReadiness().ready).toBe(false);
    env.DATA_ENCRYPTION_KEY = "a".repeat(64); // 32 bytes em hex
    expect(walletReadiness().items.find((i) => i.key === "encryption")!.ok).toBe(true);
    env.DATA_ENCRYPTION_KEY = "a".repeat(44); // base64 de 33 bytes
    expect(walletReadiness().ready).toBe(true);
  });
});
