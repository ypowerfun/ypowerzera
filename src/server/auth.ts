import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dummyPasswordHash, hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { moneyConfig } from "./money-config";
import { sendMail } from "./mailer";
import { isRateLimited, rateLimit, resetRateLimit } from "./rate-limit";
import type { Role, User } from "@prisma/client";

export const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;
const RESET_HOURS = 1;

const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "senha123", "senha1234", "qwertyuiop",
  "11111111", "00000000", "abc12345", "iloveyou", "admin123", "letmein123", "brasil123", "futebol123",
  "corinthians", "flamengo123", "123123123", "qwerty123", "mudar123", "trocar123",
]);

export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter pelo menos 8 caracteres.")
  .max(128, "A senha deve ter no máximo 128 caracteres.");

export function checkPasswordStrength(password: string, context: { email?: string; username?: string } = {}): string | null {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return parsed.error.issues[0].message;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "Essa senha é muito comum. Escolha outra.";
  if (/^(.)\1+$/.test(password)) return "A senha não pode ter um único caractere repetido.";
  if (context.username && lower.includes(context.username.toLowerCase()) && context.username.length >= 4) return "A senha não pode conter o seu nome de usuário.";
  if (context.email && lower === context.email.toLowerCase()) return "A senha não pode ser igual ao e-mail.";
  return null;
}

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, "Nome de usuário: 3 a 20 caracteres (letras, números e _)."),
  displayName: z.string().trim().min(2, "Informe seu nome de exibição.").max(40),
  password: z.string(),
});

export type SafeUser = Omit<User, "passwordHash">;

export function toSafeUser(u: User): SafeUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = u;
  return rest;
}

/** Papel efetivo: e-mails em ADMIN_EMAILS viram administradores, mas só depois de verificados. */
export function effectiveRole(u: Pick<User, "email" | "role" | "emailVerifiedAt">): Role {
  if (u.role === "ADMIN") return "ADMIN";
  if (u.emailVerifiedAt && getEnv().adminEmails.includes(u.email.toLowerCase())) return "ADMIN";
  return u.role;
}

export async function registerUser(input: unknown, meta: { ip?: string } = {}): Promise<SafeUser> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const { email, username, displayName, password } = parsed.data;
  const weak = checkPasswordStrength(password, { email, username });
  if (weak) throw new AppError(weak);
  await rateLimit(`register:ip:${meta.ip ?? "unknown"}`, 10, 3600, "Muitos cadastros a partir deste endereço. Tente novamente mais tarde.");

  const existing = await db.user.findFirst({ where: { OR: [{ email }, { username }] }, select: { id: true } });
  if (existing) throw new AppError("Já existe uma conta com este e-mail ou nome de usuário.", "CONFLICT");

  const user = await db.user.create({
    data: { email, username, displayName, passwordHash: await hashPassword(password) },
  });
  await sendVerificationEmail(user);
  return toSafeUser(user);
}

async function issueToken(userId: string, type: "VERIFY_EMAIL" | "RESET_PASSWORD", hours: number): Promise<string> {
  const token = randomToken(32);
  await db.authToken.deleteMany({ where: { userId, type, usedAt: null } });
  await db.authToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) },
  });
  return token;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "displayName">): Promise<void> {
  const token = await issueToken(user.id, "VERIFY_EMAIL", VERIFY_HOURS);
  await sendMail({
    to: user.email,
    subject: "Confirme seu e-mail — PRiME ARENA MANAGER",
    text: `Olá, ${user.displayName}!\n\nConfirme seu e-mail para poder se inscrever em campeonatos:\n${getEnv().appUrl}/verificar-email/${token}\n\nO link vale por ${VERIFY_HOURS} horas. Se você não criou esta conta, ignore este e-mail.`,
  });
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  if (user.emailVerifiedAt) throw new AppError("Seu e-mail já está verificado.");
  await rateLimit(`verify-resend:${userId}`, 3, 3600, "Você já pediu vários e-mails. Aguarde um pouco.");
  await sendVerificationEmail(user);
}

export async function verifyEmail(token: string): Promise<void> {
  const row = await db.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== "VERIFY_EMAIL" || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError("Link de verificação inválido ou expirado.");
  }
  await db.$transaction([
    db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
}

export interface LoginResult {
  token: string;
  user: SafeUser;
  expiresAt: Date;
}

export async function login(
  input: { identifier: string; password: string },
  meta: { ip?: string; userAgent?: string } = {},
): Promise<LoginResult> {
  const identifier = input.identifier.trim().toLowerCase();
  const ip = meta.ip ?? "unknown";
  if (!identifier || !input.password) throw new AppError("Informe e-mail/usuário e senha.");
  if (input.password.length > 256) throw new AppError("E-mail/usuário ou senha incorretos.");

  const idKey = `login:id:${identifier}`;
  const ipKey = `login:ip:${ip}`;
  if ((await isRateLimited(idKey, 8)) || (await isRateLimited(ipKey, 40))) {
    throw new AppError("Muitas tentativas de login. Aguarde 15 minutos e tente novamente.", "RATE_LIMIT");
  }

  const user = await db.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } });
  // Sempre executa um scrypt, exista o usuário ou não, para não revelar contas pelo tempo de resposta.
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : (await verifyPassword(input.password, await dummyPasswordHash()), false);
  if (!user || !ok) {
    await rateLimit(idKey, 8, 900).catch(() => undefined);
    await rateLimit(ipKey, 40, 900).catch(() => undefined);
    throw new AppError("E-mail/usuário ou senha incorretos.", "UNAUTHENTICATED");
  }
  if (user.bannedAt) throw new AppError("Esta conta está suspensa. Entre em contato com o suporte.", "FORBIDDEN");

  await resetRateLimit(idKey);
  const session = await createSession(user.id, meta);
  return { token: session.token, user: toSafeUser(user), expiresAt: session.expiresAt };
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({
    data: { id: sha256(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
  });
  return { token, expiresAt };
}

/** Valida o token do cookie e devolve o usuário (ou null). Renova a sessão uma vez por dia. */
export async function getUserBySessionToken(token: string | undefined | null): Promise<SafeUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.user.bannedAt) return null;
  const sinceUse = Date.now() - session.lastUsedAt.getTime();
  if (sinceUse > 24 * 3600_000) {
    await db.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) } })
      .catch(() => undefined);
  }
  const safe = toSafeUser(session.user);
  return { ...safe, role: effectiveRole(session.user) };
}

export async function logout(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db.session.deleteMany({ where: { id: sha256(token) } });
}

export async function logoutEverywhere(userId: string, exceptToken?: string): Promise<void> {
  await db.session.deleteMany({ where: { userId, ...(exceptToken ? { NOT: { id: sha256(exceptToken) } } : {}) } });
}

export async function requestPasswordReset(emailInput: string, meta: { ip?: string } = {}): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  await rateLimit(`reset:ip:${meta.ip ?? "unknown"}`, 10, 3600, "Muitos pedidos de redefinição. Tente novamente mais tarde.");
  await rateLimit(`reset:email:${email}`, 3, 3600).catch(() => {
    throw new AppError("Você já pediu a redefinição várias vezes. Verifique sua caixa de entrada ou aguarde.", "RATE_LIMIT");
  });
  const user = await db.user.findUnique({ where: { email } });
  // Resposta idêntica exista a conta ou não (evita enumeração de e-mails).
  if (!user || user.bannedAt) return;
  const token = await issueToken(user.id, "RESET_PASSWORD", RESET_HOURS);
  await sendMail({
    to: user.email,
    subject: "Redefinição de senha — PRiME ARENA MANAGER",
    text: `Olá, ${user.displayName}!\n\nPara criar uma nova senha, acesse:\n${getEnv().appUrl}/redefinir-senha/${token}\n\nO link vale por ${RESET_HOURS} hora. Se não foi você, ignore este e-mail — sua senha atual continua valendo.`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const row = await db.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.type !== "RESET_PASSWORD" || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError("Link de redefinição inválido ou expirado.");
  }
  const weak = checkPasswordStrength(newPassword, { email: row.user.email, username: row.user.username });
  if (weak) throw new AppError(weak);
  await db.$transaction([
    db.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(newPassword), emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(), withdrawalLockedUntil: new Date(Date.now() + moneyConfig().securityLockHours * 3600_000) },
    }),
    db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.session.deleteMany({ where: { userId: row.userId } }),
  ]);
}

export async function changePassword(userId: string, current: string, next: string, keepToken?: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  await rateLimit(`chpw:${userId}`, 5, 900);
  if (!(await verifyPassword(current, user.passwordHash))) throw new AppError("A senha atual está incorreta.");
  const weak = checkPasswordStrength(next, { email: user.email, username: user.username });
  if (weak) throw new AppError(weak);
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), withdrawalLockedUntil: new Date(Date.now() + moneyConfig().securityLockHours * 3600_000) } });
  await logoutEverywhere(userId, keepToken);
}

export async function updateProfile(userId: string, input: { displayName: string; country?: string | null; bio?: string | null }) {
  const data = z
    .object({
      displayName: z.string().trim().min(2, "Informe seu nome de exibição.").max(40),
      country: z.string().trim().max(2).nullish(),
      bio: z.string().trim().max(300).nullish(),
    })
    .safeParse(input);
  if (!data.success) throw new AppError(data.error.issues[0].message);
  return toSafeUser(
    await db.user.update({
      where: { id: userId },
      data: { displayName: data.data.displayName, country: data.data.country || null, bio: data.data.bio || null },
    }),
  );
}
