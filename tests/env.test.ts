import { afterEach, describe, expect, it } from "vitest";
import { assertProductionConfig } from "@/lib/env";

const KEYS = ["NODE_ENV", "VITEST", "APP_URL", "SMTP_URL", "MAIL_FROM", "ADMIN_EMAILS", "APP_SECRET", "TRUST_PROXY", "PAYMENTS_PROVIDER", "PIX_PROVIDER", "DATA_ENCRYPTION_KEY", "CRON_SECRET", "ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN", "ASAAS_TRANSFER_AUTH_TOKEN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
});

function prod(over: Record<string, string> = {}) {
  const env = process.env as Record<string, string>;
  env.NODE_ENV = "production";
  Object.assign(env, {
    APP_URL: "https://arena.example.com",
    SMTP_URL: "smtps://user:pass@smtp.example.com:465",
    MAIL_FROM: "Prime Arena <nao-responda@arena.example.com>",
    ADMIN_EMAILS: "dono@example.com",
    APP_SECRET: "x".repeat(40),
    TRUST_PROXY: "true",
    PAYMENTS_PROVIDER: "stripe",
    STRIPE_SECRET_KEY: "placeholder-secret-key",
    STRIPE_WEBHOOK_SECRET: "placeholder-webhook-secret",
    PIX_PROVIDER: "asaas",
    ASAAS_API_KEY: "k",
    ASAAS_WEBHOOK_TOKEN: "w",
    ASAAS_TRANSFER_AUTH_TOKEN: "t",
    DATA_ENCRYPTION_KEY: "a".repeat(44),
    CRON_SECRET: "c".repeat(32),
    ...over,
  });
}

describe("configuração de produção", () => {
  it("aceita uma configuração completa", () => {
    prod();
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("recusa chave de TESTE da Stripe em um site público", () => {
    prod({ STRIPE_SECRET_KEY: "sk_test_abcdefghijklmnop" });
    expect(() => assertProductionConfig()).toThrow(/chave de TESTE/);
    prod({ STRIPE_SECRET_KEY: "sk_live_abcdefghijklmnop" });
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("exige MAIL_FROM de verdade (o padrão @primearena.local é recusado pelos provedores de e-mail)", () => {
    prod();
    delete process.env.MAIL_FROM;
    expect(() => assertProductionConfig()).toThrow(/MAIL_FROM/);
    process.env.MAIL_FROM = "Prime Arena <no-reply@primearena.local>";
    expect(() => assertProductionConfig()).toThrow(/MAIL_FROM/);
    process.env.MAIL_FROM = "Prime Arena <nao-responda@arena.example.com>";
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("exige escolha explícita de TRUST_PROXY (evita IP forjado burlando limites)", () => {
    prod();
    delete process.env.TRUST_PROXY;
    expect(() => assertProductionConfig()).toThrow(/TRUST_PROXY/);
    process.env.TRUST_PROXY = "false";
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("recusa provedores simulados, segredos fracos e ausência de chave de criptografia", () => {
    prod({ PAYMENTS_PROVIDER: "mock", PIX_PROVIDER: "mock", APP_SECRET: "troque-esta-chave-em-producao", DATA_ENCRYPTION_KEY: "", CRON_SECRET: "curto" });
    let msg = "";
    try { assertProductionConfig(); } catch (e) { msg = (e as Error).message; }
    for (const part of ["APP_SECRET", "PAYMENTS_PROVIDER=mock", "PIX_PROVIDER=mock", "DATA_ENCRYPTION_KEY", "CRON_SECRET"]) expect(msg).toContain(part);
  });

  it("aceita campeonatos só gratuitos (PAYMENTS_PROVIDER=none) e recusa valores que não existem", () => {
    prod({ PAYMENTS_PROVIDER: "none", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" });
    expect(() => assertProductionConfig()).not.toThrow();
    prod({ PAYMENTS_PROVIDER: "strype" });
    expect(() => assertProductionConfig()).toThrow(/PAYMENTS_PROVIDER="strype" não existe/);
    prod({ PIX_PROVIDER: "asas" });
    expect(() => assertProductionConfig()).toThrow(/PIX_PROVIDER="asas" não existe/);
  });

  it("exige o endereço público https, o SMTP e o e-mail do administrador", () => {
    prod({ APP_URL: "http://meusite.com.br" });
    expect(() => assertProductionConfig()).toThrow(/APP_URL/);
    prod({ APP_URL: "http://localhost:3000" }); // ensaio local da versão de produção
    expect(() => assertProductionConfig()).not.toThrow();
    prod({ SMTP_URL: "" });
    expect(() => assertProductionConfig()).toThrow(/SMTP_URL/);
    prod({ ADMIN_EMAILS: "" });
    expect(() => assertProductionConfig()).toThrow(/ADMIN_EMAILS/);
  });

  it("não valida nada fora de produção", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    delete process.env.APP_SECRET;
    expect(() => assertProductionConfig()).not.toThrow();
  });
});
