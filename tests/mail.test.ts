import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeUser, uid } from "./factories";

// O envio real é trocado por um que dá para fazer falhar; o resto do módulo de e-mail é o de verdade.
vi.mock("@/server/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/server/mailer")>("@/server/mailer");
  return { ...actual, sendMail: vi.fn(actual.sendMail) };
});

import { hintForMailError, lastMailTo, safeMailError, sendMail, smtpTransportOptions } from "@/server/mailer";
import { registerUser, requestPasswordReset, resendVerification, verifyEmail } from "@/server/auth";

const mailMock = vi.mocked(sendMail);
const PASSWORD = "Senha#Forte-2026";
const ENV_KEYS = ["SMTP_URL"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(async () => {
  await db.rateLimit.deleteMany();
  mailMock.mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
});

function newAccount() {
  const id = uid();
  return { email: `novo${id}@teste.dev`, username: `novo${id}`.slice(0, 20), displayName: "Pessoa Nova", password: PASSWORD };
}

describe("e-mail de confirmação de conta", () => {
  it("o cadastro funciona mesmo com o SMTP fora do ar: a conta é criada e a pessoa pode pedir o reenvio", async () => {
    const input = newAccount();
    mailMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:587"));
    const user = await registerUser(input, { ip: `ip-${uid()}` });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await db.user.count({ where: { email: input.email } })).toBe(1); // a conta existe, sem ficar presa em "já existe uma conta"
    // o SMTP volta: o reenvio entrega o link
    await resendVerification(user.id);
    expect(lastMailTo(input.email)?.text).toMatch(/\/verificar-email\//);
  });

  it("o reenvio com o SMTP fora do ar dá uma mensagem clara (não 'erro inesperado')", async () => {
    const u = await registerUser(newAccount(), { ip: `ip-${uid()}` });
    mailMock.mockRejectedValueOnce(new Error("Connection timeout"));
    await expect(resendVerification(u.id)).rejects.toThrow(/Não foi possível enviar o e-mail agora/);
  });

  it("recuperar senha responde igual com o SMTP fora do ar (não revela quem tem conta)", async () => {
    const real = await makeUser();
    const email = (await db.user.findUniqueOrThrow({ where: { id: real.id } })).email;
    mailMock.mockRejectedValueOnce(new Error("Invalid login: 535"));
    await expect(requestPasswordReset(email, { ip: `ip-${uid()}` })).resolves.toBeUndefined(); // conta existe + SMTP falhou
    await expect(requestPasswordReset(`naoexiste${uid()}@teste.dev`, { ip: `ip-${uid()}` })).resolves.toBeUndefined(); // conta não existe
  });

  it("o link de confirmação abre duas vezes sem erro (o Outlook/Hotmail abre o link antes da pessoa)", async () => {
    const input = newAccount();
    await registerUser(input, { ip: `ip-${uid()}` });
    const token = lastMailTo(input.email)!.text.match(/\/verificar-email\/([A-Za-z0-9_-]+)/)![1];
    await verifyEmail(token); // o leitor de e-mail abriu primeiro
    expect((await db.user.findUniqueOrThrow({ where: { email: input.email } })).emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(token)).resolves.toEqual({}); // a pessoa clica depois: também vê "confirmado"
    await expect(verifyEmail("token-que-nao-existe")).rejects.toThrow(/inválido ou expirado/);
  });
});

describe("envio por SMTP", () => {
  it("usa tempos limite curtos e, em produção, exige TLS (menos servidor da própria máquina)", () => {
    const prod = smtpTransportOptions("smtp://u:p@smtp.provedor.com:587", true);
    expect(prod).toMatchObject({ url: "smtp://u:p@smtp.provedor.com:587", connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, requireTLS: true });
    expect(smtpTransportOptions("smtp://u:p@smtp.provedor.com:587", false)).not.toHaveProperty("requireTLS"); // desenvolvimento
    expect(smtpTransportOptions("smtp://localhost:1025", true)).not.toHaveProperty("requireTLS"); // postfix local, sem TLS
    expect(smtpTransportOptions("smtp://127.0.0.1:25", true)).not.toHaveProperty("requireTLS");
    expect(() => smtpTransportOptions("isto não é uma url", true)).not.toThrow();
  });

  it("o texto de erro nunca carrega a senha do SMTP", () => {
    process.env.SMTP_URL = "smtp://meu.usuario:S3nh4%2FSecreta@smtp.provedor.com:587";
    const msg = safeMailError(new Error("Invalid login for meu.usuario with password S3nh4/Secreta (535)"));
    expect(msg).not.toContain("S3nh4/Secreta");
    expect(msg).not.toContain("meu.usuario");
    expect(msg).toContain("***");
  });

  it("traduz os erros mais comuns em um conselho prático", () => {
    expect(hintForMailError("Invalid login: 535 Authentication failed")).toMatch(/senha do SMTP/);
    expect(hintForMailError("connect ECONNREFUSED 1.2.3.4:587")).toMatch(/endereço e a porta/);
    expect(hintForMailError("Connection timeout")).toMatch(/porta pode estar bloqueada/);
    expect(hintForMailError("Greeting never received")).toBe("Greeting never received"); // sem palpite quando não sabe
    expect(hintForMailError("550 5.7.1 Sender address rejected")).toMatch(/MAIL_FROM/);
  });
});
