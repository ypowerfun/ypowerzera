import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertProductionConfig, getEnv, mailProviderReady } from "@/lib/env";
import { hintForMailError, parseMailFrom, safeMailError, sendViaBrevo, sendViaResend } from "@/server/mailer";

/** Envio de e-mail por API HTTP (Resend/Brevo): o único que funciona no ChatGPT Sites (Cloudflare Workers não falam SMTP). */

const KEYS = ["MAIL_PROVIDER", "RESEND_API_KEY", "BREVO_API_KEY", "SMTP_URL", "MAIL_FROM", "PA_RUNTIME", "NODE_ENV", "VITEST", "APP_URL", "APP_SECRET", "ADMIN_EMAILS", "TRUST_PROXY", "PAYMENTS_PROVIDER", "WALLET_ENABLED", "PIX_PROVIDER"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const set = (o: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = v;
  }
};
beforeEach(() => {
  set({ MAIL_PROVIDER: undefined, RESEND_API_KEY: undefined, BREVO_API_KEY: undefined, SMTP_URL: undefined, PA_RUNTIME: undefined, MAIL_FROM: "Prime Arena <nao-responda@arena.exemplo.com.br>" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  set(saved);
});

describe("escolha do provedor de e-mail", () => {
  it("detecta sozinho: Resend, depois Brevo, depois SMTP, senão nenhum", () => {
    expect(getEnv().mailProvider).toBe("none");
    set({ SMTP_URL: "smtps://u:p@smtp.exemplo.com:465" });
    expect(getEnv().mailProvider).toBe("smtp");
    set({ BREVO_API_KEY: "xkeysib-123456789" });
    expect(getEnv().mailProvider).toBe("brevo");
    set({ RESEND_API_KEY: "re_123456789" });
    expect(getEnv().mailProvider).toBe("resend");
    set({ MAIL_PROVIDER: "smtp" });
    expect(getEnv().mailProvider).toBe("smtp");
  });

  it("só conta como pronto se a credencial do provedor escolhido existe", () => {
    set({ MAIL_PROVIDER: "resend" });
    expect(mailProviderReady(getEnv())).toBe(false);
    set({ RESEND_API_KEY: "re_123456789" });
    expect(mailProviderReady(getEnv())).toBe(true);
  });
});

describe("configuração de produção", () => {
  const prod = (extra: Record<string, string | undefined> = {}) =>
    set({ NODE_ENV: "production", VITEST: undefined, APP_URL: "https://arena.exemplo.com.br", APP_SECRET: "x".repeat(40), ADMIN_EMAILS: "dono@exemplo.com", TRUST_PROXY: "true", PAYMENTS_PROVIDER: "none", WALLET_ENABLED: "false", ...extra });

  it("Resend ou Brevo bastam em produção (sem SMTP)", () => {
    prod({ RESEND_API_KEY: "re_123456789" });
    expect(() => assertProductionConfig()).not.toThrow();
    prod({ RESEND_API_KEY: undefined, BREVO_API_KEY: "xkeysib-123456789" });
    expect(() => assertProductionConfig()).not.toThrow();
  });
  it("sem nenhum envio configurado, a produção se recusa a subir", () => {
    prod();
    expect(() => assertProductionConfig()).toThrow(/RESEND_API_KEY|SMTP_URL/);
  });
  it("no ChatGPT Sites o SMTP é recusado (a hospedagem não abre SMTP) e o erro diz o que usar", () => {
    prod({ PA_RUNTIME: "sites", SMTP_URL: "smtps://u:p@smtp.exemplo.com:465" });
    expect(() => assertProductionConfig()).toThrow(/Sites.*SMTP|SMTP.*Sites/);
    prod({ PA_RUNTIME: "sites", SMTP_URL: undefined });
    expect(() => assertProductionConfig()).toThrow(/RESEND_API_KEY/);
  });
});

describe("envio por API", () => {
  it("Resend: endereço, chave no Authorization e corpo corretos", async () => {
    set({ RESEND_API_KEY: "re_chave_secreta_123" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendViaResend({ to: "ana@exemplo.com", subject: "Oi", text: "Texto" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_chave_secreta_123");
    expect(JSON.parse(init.body as string)).toEqual({ from: "Prime Arena <nao-responda@arena.exemplo.com.br>", to: ["ana@exemplo.com"], subject: "Oi", text: "Texto" });
  });

  it("Brevo: remetente separado em nome/e-mail e chave no cabeçalho api-key", async () => {
    set({ BREVO_API_KEY: "xkeysib-segredo-123" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendViaBrevo({ to: "ana@exemplo.com", subject: "Oi", text: "Texto" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-segredo-123");
    expect(JSON.parse(init.body as string)).toEqual({ sender: { name: "Prime Arena", email: "nao-responda@arena.exemplo.com.br" }, to: [{ email: "ana@exemplo.com" }], subject: "Oi", textContent: "Texto" });
  });

  it("resposta de erro vira exceção com o motivo, sem a chave, e com conselho em português", async () => {
    set({ RESEND_API_KEY: "re_chave_secreta_123" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"The domain is not verified. re_chave_secreta_123"}', { status: 403 })));
    const err = await sendViaResend({ to: "a@b.co", subject: "s", text: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const safe = safeMailError(err);
    expect(safe).not.toContain("re_chave_secreta_123");
    expect(safe).toContain("403");
    expect(hintForMailError(safe)).toMatch(/chave da API|remetente/);
    expect(hintForMailError("Resend respondeu 422: sender domain not verified")).toMatch(/domínio/);
  });

  it("parseMailFrom entende com e sem nome", () => {
    expect(parseMailFrom('Prime Arena <a@b.co>')).toEqual({ name: "Prime Arena", email: "a@b.co" });
    expect(parseMailFrom('"Prime, Arena" <a@b.co>')).toEqual({ name: "Prime, Arena", email: "a@b.co" });
    expect(parseMailFrom("a@b.co")).toEqual({ name: "", email: "a@b.co" });
  });
});
