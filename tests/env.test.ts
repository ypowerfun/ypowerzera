import { afterEach, describe, expect, it } from "vitest";
import { assertProductionConfig } from "@/lib/env";

const KEYS = ["NODE_ENV", "VITEST", "APP_URL", "SMTP_URL", "MAIL_FROM", "ADMIN_EMAILS", "APP_SECRET", "TRUST_PROXY", "PAYMENTS_PROVIDER", "PIX_PROVIDER", "DATA_ENCRYPTION_KEY", "CRON_SECRET", "ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN", "ASAAS_TRANSFER_AUTH_TOKEN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "WALLET_ENABLED", "STRIPE_ALLOW_TEST_KEY"];
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

  it("PIX_PROVIDER=stripe: aceita com as duas chaves, sem nada do Asaas", () => {
    prod({ PIX_PROVIDER: "stripe", PAYMENTS_PROVIDER: "none", ASAAS_API_KEY: "", ASAAS_WEBHOOK_TOKEN: "", ASAAS_TRANSFER_AUTH_TOKEN: "", STRIPE_SECRET_KEY: "sk_live_abcdefghijklmnop", STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnop" });
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("PIX_PROVIDER=stripe: exige STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET, mesmo sem usar o Stripe nas inscrições", () => {
    for (const missing of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
      prod({ PIX_PROVIDER: "stripe", PAYMENTS_PROVIDER: "none", STRIPE_SECRET_KEY: "sk_live_abcdefghijklmnop", STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnop", [missing]: "" });
      expect(() => assertProductionConfig(), missing).toThrow(/STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET são obrigatórios com PAYMENTS_PROVIDER=stripe ou PIX_PROVIDER=stripe/);
    }
  });

  it("STRIPE_ALLOW_TEST_KEY=true deixa ensaiar o fluxo do Stripe no site de verdade com chave de teste (e só então)", () => {
    prod({ PIX_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_abcdefghijklmnop", STRIPE_WEBHOOK_SECRET: "whsec_x" });
    expect(() => assertProductionConfig()).toThrow(/STRIPE_ALLOW_TEST_KEY/);
    prod({ PIX_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_abcdefghijklmnop", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_ALLOW_TEST_KEY: "true" });
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("PIX_PROVIDER=stripe: recusa chave de TESTE (sk_test_ e rk_test_) e a menciona uma vez só quando as inscrições também usam o Stripe", () => {
    for (const key of ["sk_test_abcdefghijklmnop", "rk_test_abcdefghijklmnop"]) {
      prod({ PIX_PROVIDER: "stripe", PAYMENTS_PROVIDER: "none", STRIPE_SECRET_KEY: key });
      expect(() => assertProductionConfig(), key).toThrow(/chave de TESTE/);
    }
    prod({ PIX_PROVIDER: "stripe", PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_abcdefghijklmnop" });
    let msg = "";
    try { assertProductionConfig(); } catch (e) { msg = (e as Error).message; }
    expect(msg.match(/chave de TESTE/g)).toHaveLength(1);
  });

  it("PIX_PROVIDER=stripe sem carteira (WALLET_ENABLED=false) não exige as chaves; asaas continua exigindo as suas", () => {
    prod({ PIX_PROVIDER: "stripe", PAYMENTS_PROVIDER: "none", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", WALLET_ENABLED: "false" });
    expect(() => assertProductionConfig()).not.toThrow();
    prod({ PIX_PROVIDER: "asaas", ASAAS_API_KEY: "", WALLET_ENABLED: "true" });
    expect(() => assertProductionConfig()).toThrow(/ASAAS_API_KEY/);
  });

  it("PIX_PROVIDER=mock é recusado e a mensagem aponta asaas ou stripe", () => {
    prod({ PIX_PROVIDER: "mock" });
    expect(() => assertProductionConfig()).toThrow(/use asaas ou stripe/);
    prod({ PIX_PROVIDER: "strip" });
    expect(() => assertProductionConfig()).toThrow(/PIX_PROVIDER="strip" não existe: use asaas ou stripe/);
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

  it("MAIL_FROM: domínios legítimos que contêm 'test' ou 'local' no meio são aceitos; só o final do endereço conta", () => {
    prod();
    for (const ok of ["Prime Arena <nao-responda@app.test-arena.com.br>", "Prime Arena <a@loja.local.com.br>", "a@meusite.com.br", "Prime <a@testando.dev>"]) {
      process.env.MAIL_FROM = ok;
      expect(() => assertProductionConfig(), ok).not.toThrow();
    }
    for (const bad of ["Prime <a@meusite.local>", "Prime <a@x.invalid>", "a@servidor.test", "Prime <a@primearena.local>"]) {
      process.env.MAIL_FROM = bad;
      expect(() => assertProductionConfig(), bad).toThrow(/MAIL_FROM/);
    }
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
