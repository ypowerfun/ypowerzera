import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./factories";
import { admin } from "./wallet-helpers";
import { lastMailTo } from "@/server/mailer";
import { runWalletCron } from "@/server/cron";
import { markCronRun, sendTestMailToAdmin, siteHealth } from "@/server/settings";

const ENV_KEYS = ["APP_URL", "SMTP_URL", "NODE_ENV", "PAYMENTS_PROVIDER", "TRUST_PROXY", "STRIPE_SECRET_KEY", "STRIPE_ALLOW_TEST_KEY", "PIX_PROVIDER", "WALLET_ENABLED"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const get = async (key: string) => (await siteHealth()).find((i) => i.key === key)!;

beforeEach(async () => {
  await db.siteSetting.deleteMany({ where: { key: "cron.lastRunAt" } });
  await db.rateLimit.deleteMany();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
});

describe("verificação do site (Admin → Configurações)", () => {
  it("endereço público: só vale com https e fora de localhost", async () => {
    process.env.APP_URL = "http://localhost:3000";
    expect((await get("url")).ok).toBe(false);
    process.env.APP_URL = "http://meusite.com.br";
    expect((await get("url")).ok).toBe(false);
    process.env.APP_URL = "https://arena.meusite.com.br";
    const url = await get("url");
    expect(url.ok).toBe(true);
    expect(url.hint).toContain("https://arena.meusite.com.br");
  });

  it("e-mail: acusa a falta do SMTP_URL", async () => {
    delete process.env.SMTP_URL;
    expect((await get("smtp")).ok).toBe(false);
    process.env.SMTP_URL = "smtps://u:p@smtp.provedor.com:465";
    expect((await get("smtp")).ok).toBe(true);
  });

  it("agendador: só 'ok' se rodou nos últimos 15 minutos; a rodada do cron deixa o sinal de vida", async () => {
    expect((await get("cron")).ok).toBe(false);
    expect((await get("cron")).hint).toMatch(/Ainda não rodou/);

    await runWalletCron();
    const alive = await get("cron");
    expect(alive.ok).toBe(true);
    expect(alive.hint).toMatch(/Rodou/);

    await markCronRun(new Date(Date.now() - 40 * 60_000));
    const stale = await get("cron");
    expect(stale.ok).toBe(false);
    expect(stale.hint).toMatch(/Parado.*há 40 min/);
  });

  it("pagamento de inscrição: simulado em produção é problema; sem Stripe (none) está certo", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.PAYMENTS_PROVIDER = "mock";
    expect((await get("payments")).ok).toBe(false);
    process.env.PAYMENTS_PROVIDER = "none";
    expect((await get("payments")).ok).toBe(true);
  });

  it("chave de TESTE do Stripe liberada em produção vira item vermelho; sem ela o item nem aparece", async () => {
    const list = async () => (await siteHealth()).find((i) => i.key === "stripe-test");
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.PIX_PROVIDER = "stripe";
    process.env.WALLET_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_test_abcdefghijklmnop";
    delete process.env.STRIPE_ALLOW_TEST_KEY;
    expect(await list()).toBeUndefined();
    process.env.STRIPE_ALLOW_TEST_KEY = "true";
    const item = await list();
    expect(item?.ok).toBe(false);
    expect(item?.hint).toMatch(/na carteira/);
    // Stripe só nas inscrições (carteira desligada): o aviso muda de texto, em vez de falar de créditos da carteira
    process.env.WALLET_ENABLED = "false";
    process.env.PAYMENTS_PROVIDER = "stripe";
    expect((await list())?.hint).toMatch(/inscrição/);
    // sem Stripe em uso nenhum, o item não faz sentido
    process.env.PAYMENTS_PROVIDER = "none";
    expect(await list()).toBeUndefined();
    process.env.WALLET_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_live_abcdefghijklmnop";
    expect(await list()).toBeUndefined();
  });

  it("proxy: em produção exige escolher o TRUST_PROXY", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.TRUST_PROXY;
    expect((await get("proxy")).ok).toBe(false);
    process.env.TRUST_PROXY = "true";
    expect((await get("proxy")).ok).toBe(true);
  });
});

describe("e-mail de teste do admin", () => {
  it("só admin; chega para o e-mail do próprio admin; limite de 5 por hora", async () => {
    const player = await makeUser();
    await expect(sendTestMailToAdmin(player)).rejects.toThrow(/administradores/);
    const a = await admin();
    await sendTestMailToAdmin(a);
    expect(lastMailTo(a.email!)?.subject).toMatch(/Teste de e-mail/);
    expect(await db.auditLog.count({ where: { action: "settings.mail_test", actorId: a.id } })).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 4; i++) await sendTestMailToAdmin(a);
    await expect(sendTestMailToAdmin(a)).rejects.toThrow(/Muitos testes/);
  });
});
