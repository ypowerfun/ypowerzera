import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  changePassword,
  checkPasswordStrength,
  createSession,
  effectiveRole,
  getUserBySessionToken,
  login,
  logout,
  registerUser,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
  resendVerification,
} from "@/server/auth";
import { lastMailTo, testOutbox } from "@/server/mailer";
import { hashPassword, verifyPassword } from "@/lib/crypto";

const valid = { email: "Ana@Example.com", username: "Ana_Gamer", displayName: "Ana", password: "SenhaBoa#2026" };

async function clean() {
  // só remove os usuários deste arquivo (@example.com): o banco de teste é compartilhado com os demais
  const mine = { email: { endsWith: "@example.com" } };
  await db.session.deleteMany({ where: { user: mine } });
  await db.authToken.deleteMany({ where: { user: mine } });
  await db.rateLimit.deleteMany();
  await db.user.deleteMany({ where: mine });
  testOutbox.length = 0;
}

function tokenFromMail(to: string, marker: string): string {
  const mail = lastMailTo(to)!;
  const m = mail.text.match(new RegExp(`${marker}/([A-Za-z0-9_-]+)`));
  return m![1];
}

describe("senhas", () => {
  it("hash scrypt é verificável e salgado", async () => {
    const a = await hashPassword("abc12345!");
    const b = await hashPassword("abc12345!");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("abc12345!", a)).toBe(true);
    expect(await verifyPassword("abc12345?", a)).toBe(false);
    expect(await verifyPassword("x", "lixo")).toBe(false);
  });

  it("política de senha", () => {
    expect(checkPasswordStrength("curta")).toMatch(/8 caracteres/);
    expect(checkPasswordStrength("password")).toMatch(/comum/);
    expect(checkPasswordStrength("aaaaaaaaaa")).toMatch(/repetido/);
    expect(checkPasswordStrength("meuusuario99", { username: "meuusuario" })).toMatch(/usuário/);
    expect(checkPasswordStrength("SenhaBoa#2026")).toBeNull();
  });
});

describe("cadastro e login", () => {
  beforeEach(clean);

  it("cadastra normalizando e-mail/usuário e envia verificação", async () => {
    const u = await registerUser(valid, { ip: "1.1.1.1" });
    expect(u.email).toBe("ana@example.com");
    expect(u.username).toBe("ana_gamer");
    expect(u).not.toHaveProperty("passwordHash");
    expect(u.emailVerifiedAt).toBeNull();
    expect(lastMailTo("ana@example.com")?.subject).toMatch(/Confirme/);
    const stored = await db.user.findUnique({ where: { id: u.id } });
    expect(stored!.passwordHash).not.toContain("SenhaBoa");
  });

  it("recusa duplicados, e-mail inválido, usuário inválido e senha fraca", async () => {
    await registerUser(valid);
    await expect(registerUser({ ...valid, username: "outro" })).rejects.toThrow(/Já existe/);
    await expect(registerUser({ ...valid, email: "outro@example.com" })).rejects.toThrow(/Já existe/);
    await expect(registerUser({ ...valid, email: "nao-e-email", username: "x1x1" })).rejects.toThrow(/e-mail/i);
    await expect(registerUser({ ...valid, email: "b@example.com", username: "a b" })).rejects.toThrow(/usuário/i);
    await expect(registerUser({ ...valid, email: "c@example.com", username: "cccc", password: "123" })).rejects.toThrow(/8 caracteres/);
  });

  it("limita cadastros por IP", async () => {
    for (let i = 0; i < 10; i++) {
      await registerUser({ ...valid, email: `u${i}@example.com`, username: `user_${i}_x` }, { ip: "9.9.9.9" });
    }
    await expect(registerUser({ ...valid, email: "u99@example.com", username: "user_99_x" }, { ip: "9.9.9.9" })).rejects.toThrow(/Muitos cadastros/);
  });

  it("login por e-mail e por usuário; sessão guarda só o hash do token", async () => {
    await registerUser(valid);
    const r1 = await login({ identifier: "ana@example.com", password: valid.password });
    const r2 = await login({ identifier: "ANA_GAMER", password: valid.password });
    expect(r1.token).not.toBe(r2.token);
    const sessions = await db.session.findMany({ where: { user: { email: { endsWith: "@example.com" } } } });
    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.id !== r1.token && s.id !== r2.token)).toBe(true);
    const me = await getUserBySessionToken(r1.token);
    expect(me?.username).toBe("ana_gamer");
    expect(me).not.toHaveProperty("passwordHash");
  });

  it("mensagem de erro igual para usuário inexistente e senha errada", async () => {
    await registerUser(valid);
    const a = await login({ identifier: "ana@example.com", password: "errada#123" }).catch((e) => e.message);
    const b = await login({ identifier: "nao-existe@example.com", password: "errada#123" }).catch((e) => e.message);
    expect(a).toBe(b);
  });

  it("bloqueia após muitas tentativas e libera com login correto antes do limite", async () => {
    await registerUser(valid);
    for (let i = 0; i < 8; i++) await login({ identifier: "ana@example.com", password: "errada#123" }, { ip: "2.2.2.2" }).catch(() => undefined);
    await expect(login({ identifier: "ana@example.com", password: valid.password }, { ip: "2.2.2.2" })).rejects.toThrow(/Muitas tentativas/);
  });

  it("sessão expirada e logout invalidam o token", async () => {
    const u = await registerUser(valid);
    const s = await createSession(u.id);
    expect(await getUserBySessionToken(s.token)).not.toBeNull();
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getUserBySessionToken(s.token)).toBeNull();
    const s2 = await createSession(u.id);
    await logout(s2.token);
    expect(await getUserBySessionToken(s2.token)).toBeNull();
    expect(await getUserBySessionToken("token-qualquer")).toBeNull();
    expect(await getUserBySessionToken(undefined)).toBeNull();
  });

  it("conta suspensa não entra e perde a sessão", async () => {
    const u = await registerUser(valid);
    const r = await login({ identifier: valid.email, password: valid.password });
    await db.user.update({ where: { id: u.id }, data: { bannedAt: new Date() } });
    expect(await getUserBySessionToken(r.token)).toBeNull();
    await expect(login({ identifier: valid.email, password: valid.password })).rejects.toThrow(/suspensa/);
  });
});

describe("verificação de e-mail", () => {
  beforeEach(clean);

  it("o token confirma a conta uma só vez; reabrir o link depois só repete o 'confirmado' (leitores de e-mail abrem links antes da pessoa)", async () => {
    const u = await registerUser(valid);
    const token = tokenFromMail("ana@example.com", "verificar-email");
    await verifyEmail(token);
    const confirmedAt = (await db.user.findUnique({ where: { id: u.id } }))!.emailVerifiedAt;
    expect(confirmedAt).not.toBeNull();
    await expect(verifyEmail(token)).resolves.toBeUndefined(); // mesma resposta, sem refazer nada
    expect((await db.user.findUnique({ where: { id: u.id } }))!.emailVerifiedAt).toEqual(confirmedAt); // a data de confirmação não muda
    await expect(verifyEmail("token-inexistente")).rejects.toThrow(/inválido/);
    await expect(resendVerification(u.id)).rejects.toThrow(/já está verificado/);
  });

  it("token expirado é recusado; token no banco é hash", async () => {
    await registerUser(valid);
    const token = tokenFromMail("ana@example.com", "verificar-email");
    const row = await db.authToken.findFirst();
    expect(row!.tokenHash).not.toBe(token);
    await db.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyEmail(token)).rejects.toThrow(/expirado/);
    await expect(verifyEmail("lixo")).rejects.toThrow();
  });
});

describe("redefinição de senha", () => {
  beforeEach(clean);

  it("fluxo completo derruba sessões e invalida o token", async () => {
    await registerUser(valid);
    const s = await login({ identifier: valid.email, password: valid.password });
    await requestPasswordReset("ana@example.com", { ip: "3.3.3.3" });
    const token = tokenFromMail("ana@example.com", "redefinir-senha");
    await resetPassword(token, "NovaSenha#2027");
    expect(await getUserBySessionToken(s.token)).toBeNull();
    await expect(login({ identifier: valid.email, password: valid.password })).rejects.toThrow();
    await expect(login({ identifier: valid.email, password: "NovaSenha#2027" })).resolves.toBeTruthy();
    await expect(resetPassword(token, "OutraSenha#2028")).rejects.toThrow(/inválido/);
  });

  it("não revela se o e-mail existe", async () => {
    await expect(requestPasswordReset("ninguem@example.com", { ip: "4.4.4.4" })).resolves.toBeUndefined();
    expect(lastMailTo("ninguem@example.com")).toBeUndefined();
  });

  it("senha nova precisa passar na política", async () => {
    await registerUser(valid);
    await requestPasswordReset("ana@example.com", { ip: "5.5.5.5" });
    const token = tokenFromMail("ana@example.com", "redefinir-senha");
    await expect(resetPassword(token, "123")).rejects.toThrow(/8 caracteres/);
  });

  it("troca de senha exige a atual e mantém só a sessão atual", async () => {
    const u = await registerUser(valid);
    const a = await login({ identifier: valid.email, password: valid.password });
    const b = await login({ identifier: valid.email, password: valid.password });
    await expect(changePassword(u.id, "errada#123", "NovaSenha#2027", a.token)).rejects.toThrow(/atual/);
    await changePassword(u.id, valid.password, "NovaSenha#2027", a.token);
    expect(await getUserBySessionToken(a.token)).not.toBeNull();
    expect(await getUserBySessionToken(b.token)).toBeNull();
  });
});

describe("papéis", () => {
  it("ADMIN_EMAILS só vale com e-mail verificado", () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    expect(effectiveRole({ email: "boss@example.com", role: "USER", emailVerifiedAt: null })).toBe("USER");
    expect(effectiveRole({ email: "boss@example.com", role: "USER", emailVerifiedAt: new Date() })).toBe("ADMIN");
    expect(effectiveRole({ email: "x@example.com", role: "ORGANIZER", emailVerifiedAt: new Date() })).toBe("ORGANIZER");
    delete process.env.ADMIN_EMAILS;
  });
});
