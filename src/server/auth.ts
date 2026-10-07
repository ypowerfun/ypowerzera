import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dummyPasswordHash, hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { moneyConfig } from "./money-config";
import { safeMailError, sendMail } from "./mailer";
import { refundRateLimit, rateLimit, resetRateLimit } from "./rate-limit";
import type { Role, User } from "@prisma/client";

export const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;
const RESET_HOURS = 1;

const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "senha123", "senha1234", "qwertyuiop",
  "11111111", "00000000", "abc12345", "iloveyou", "admin123", "letmein123", "brasil123", "futebol123",
  "corinthians", "flamengo123", "123123123", "qwerty123", "mudar123", "trocar123",
]);

/**
 * Só as letras da senha (sem números e símbolos): "Senha@2026", "senha123" e "SENHA!!" têm a mesma base, "senha".
 * Se a base é uma palavra comum, trocar o final por um ano ou símbolo não torna a senha segura.
 */
const COMMON_STEMS = new Set([
  "password", "passwd", "senha", "senhas", "qwerty", "qwertyuiop", "qwertyuio", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm", "qazwsx", "abc", "abcdef", "abcdefgh",
  "brasil", "brazil", "flamengo", "corinthians", "palmeiras", "saopaulo", "santos", "gremio", "cruzeiro", "vasco", "botafogo", "futebol", "football", "soccer",
  "admin", "administrador", "administrator", "root", "letmein", "welcome", "bemvindo", "iloveyou", "teamo", "tequiero", "amor", "deus", "jesus", "familia",
  "mudar", "trocar", "mude", "troque", "teste", "test", "testing", "usuario", "user", "login", "master", "dragon", "monkey", "shadow", "sunshine", "princess",
  "superman", "batman", "naruto", "pokemon", "minecraft", "fortnite", "valorant", "freefire", "csgo", "counterstrike", "leagueoflegends", "league", "gamer", "gamers",
  "jogador", "jogo", "campeao", "campeonato", "primearena", "prime", "arena", "primearenaone", "esports", "playstation", "xbox", "nintendo", "samsung", "iphone",
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
  if (/^\d+$/.test(password) && password.length < 12) return "A senha não pode ser só números. Misture letras.";
  const stem = lower.normalize("NFKD").replace(/[^a-z]/g, "");
  if (stem.length >= 3 && COMMON_STEMS.has(stem) && password.length < 16) return "Essa senha é muito comum (uma palavra conhecida com números ou símbolos). Escolha outra.";
  if (context.username && lower.includes(context.username.toLowerCase()) && context.username.length >= 4) return "A senha não pode conter o seu nome de usuário.";
  if (context.email && lower === context.email.toLowerCase()) return "A senha não pode ser igual ao e-mail.";
  return null;
}

/** Nomes que fingiriam ser a equipe do site (o nome de usuário é único; o de exibição é livre, por isso só vale para este). */
const RESERVED_USERNAMES = new Set([
  "admin", "administrador", "administrator", "root", "suporte", "support", "staff", "moderador", "moderator", "sistema", "system",
  "oficial", "official", "equipe", "prime", "primearena", "prime_arena", "prime_arena_oficial", "contato", "ajuda", "help", "financeiro", "seguranca",
]);

/**
 * Nome de exibição sem caracteres invisíveis ou de controle (quebra de linha, largura zero, inversão de texto): ele aparece em
 * e-mails, escalações e chaves, e esses caracteres servem para falsificar o texto ao redor.
 */
export function cleanDisplayName(input: string): string {
  return input.normalize("NFKC").replace(/\s+/g, " ").replace(/\p{C}/gu, "").replace(/ {2,}/g, " ").trim();
}

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, "Nome de usuário: 3 a 20 caracteres (letras, números e _)."),
  displayName: z.string().transform(cleanDisplayName).pipe(z.string().min(2, "Informe seu nome de exibição.").max(40)),
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
  if (RESERVED_USERNAMES.has(username)) throw new AppError("Este nome de usuário não está disponível. Escolha outro.");
  await rateLimit(`register:ip:${meta.ip ?? "unknown"}`, 10, 3600, "Muitos cadastros a partir deste endereço. Tente novamente mais tarde.");

  const existing = await db.user.findFirst({ where: { OR: [{ email }, { username }] }, select: { id: true } });
  if (existing) throw new AppError("Já existe uma conta com este e-mail ou nome de usuário.", "CONFLICT");

  const user = await db.user.create({
    data: { email, username, displayName, passwordHash: await hashPassword(password) },
  });
  // Se o SMTP estiver fora do ar, a conta já existe: o cadastro não pode falhar (quem tentasse de novo ouviria "já existe uma
  // conta" e ficaria sem como confirmar). O aviso vai para o log e a pessoa pede o reenvio em "Minha conta".
  try {
    await sendVerificationEmail(user);
  } catch (e) {
    console.error(`[mail] Não consegui enviar a confirmação de conta para o usuário ${user.id}: ${safeMailError(e)}`);
  }
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
    subject: "Confirme seu e-mail — Prime Arena",
    text: `Olá, ${user.displayName}!\n\nConfirme seu e-mail para poder se inscrever em campeonatos:\n${getEnv().appUrl}/verificar-email/${token}\n\nO link vale por ${VERIFY_HOURS} horas. Se você não criou esta conta, ignore este e-mail.`,
  });
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  if (user.emailVerifiedAt) throw new AppError("Seu e-mail já está verificado.");
  await rateLimit(`verify-resend:${userId}`, 3, 3600, "Você já pediu vários e-mails. Aguarde um pouco.");
  try {
    await sendVerificationEmail(user);
  } catch (e) {
    console.error(`[mail] Não consegui reenviar a confirmação de conta para o usuário ${user.id}: ${safeMailError(e)}`);
    throw new AppError("Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.");
  }
}

/**
 * Confirma o e-mail. Devolve `resetToken` quando o e-mail é de administrador (ADMIN_EMAILS): quem se cadastra primeiro com o
 * e-mail do dono escolhe a senha e já fica logado ANTES de provar que a caixa de entrada é sua; ao confirmar, a sessão e a senha
 * dessa pessoa são apagadas e só quem tem o link do e-mail (o dono) consegue criar a senha, na tela de redefinição.
 */
export async function verifyEmail(token: string): Promise<{ resetToken?: string }> {
  const row = await db.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { emailVerifiedAt: true, email: true } } } });
  // Outlook/Hotmail, Gmail e antivírus costumam abrir o link antes da pessoa: se o link já foi usado e a conta está
  // confirmada, o clique da pessoa também mostra "confirmado" (um link usado não revela nada nem confirma outra conta).
  if (row && row.type === "VERIFY_EMAIL" && row.usedAt && row.user.emailVerifiedAt) return {};
  if (!row || row.type !== "VERIFY_EMAIL" || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError("Link de verificação inválido ou expirado.");
  }
  const isAdminAddress = getEnv().adminEmails.includes(row.user.email.toLowerCase());
  if (!isAdminAddress) {
    await db.$transaction([
      db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return {};
  }
  await db.$transaction([
    db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date(), passwordHash: await hashPassword(randomToken(32)) } }),
    db.session.deleteMany({ where: { userId: row.userId } }),
  ]);
  return { resetToken: await issueToken(row.userId, "RESET_PASSWORD", RESET_HOURS) };
}

export interface LoginResult {
  token: string;
  user: SafeUser;
  expiresAt: Date;
}

const LOGIN_WINDOW_S = 900;

export async function login(
  input: { identifier: string; password: string },
  meta: { ip?: string; userAgent?: string } = {},
): Promise<LoginResult> {
  const identifier = input.identifier.trim().toLowerCase();
  const ip = meta.ip ?? "unknown";
  if (!identifier || !input.password) throw new AppError("Informe e-mail/usuário e senha.");
  // Tamanhos máximos ANTES de qualquer consulta ou chave de limite (um identificador gigante não pode virar chave no banco).
  if (identifier.length > 254 || input.password.length > 256) throw new AppError("E-mail/usuário ou senha incorretos.", "UNAUTHENTICATED");

  // As tentativas são RESERVADAS antes do scrypt, de forma atômica: 500 pedidos em paralelo não passam todos pelo limite.
  //  - por IP (40): um só endereço não testa muitas contas;
  //  - por conta + IP (8): quem erra a senha trava só a si mesmo, e ninguém consegue bloquear a conta de outra pessoa de fora;
  //  - por conta, de todos os IPs (40): freio contra ataque distribuído.
  const keys: Array<[string, number]> = [
    [`login:ip:${ip}`, 40],
    [`login:pair:${identifier}:${ip}`, 8],
    [`login:id:${identifier}`, 40],
  ];
  const reserved: string[] = [];
  for (const [key, limit] of keys) {
    try {
      await rateLimit(key, limit, LOGIN_WINDOW_S);
      reserved.push(key);
    } catch (e) {
      for (const k of reserved) await refundRateLimit(k); // um pedido barrado não gasta o limite dos outros baldes
      throw e instanceof AppError && e.code === "RATE_LIMIT" ? new AppError("Muitas tentativas de login. Aguarde 15 minutos e tente novamente.", "RATE_LIMIT") : e;
    }
  }

  const user = await db.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } });
  // Sempre executa um scrypt, exista o usuário ou não, para não revelar contas pelo tempo de resposta.
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : (await verifyPassword(input.password, await dummyPasswordHash()), false);
  if (!user || !ok) throw new AppError("E-mail/usuário ou senha incorretos.", "UNAUTHENTICATED");
  if (user.bannedAt) throw new AppError("Esta conta está suspensa. Entre em contato com o suporte.", "FORBIDDEN");

  // Deu certo: devolve as tentativas (login legítimo não gasta o limite do IP nem da conta).
  await resetRateLimit(keys[1][0]);
  await refundRateLimit(keys[0][0]);
  await refundRateLimit(keys[2][0]);
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
  // Entrada fora do formato nunca vira chave no banco (e a resposta continua igual à de uma conta que não existe).
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return;
  await rateLimit(`reset:email:${email}`, 3, 3600).catch(() => {
    throw new AppError("Você já pediu a redefinição várias vezes. Verifique sua caixa de entrada ou aguarde.", "RATE_LIMIT");
  });
  const user = await db.user.findUnique({ where: { email } });
  // Resposta idêntica exista a conta ou não (evita enumeração de e-mails).
  if (!user || user.bannedAt) return;
  const token = await issueToken(user.id, "RESET_PASSWORD", RESET_HOURS);
  try {
    await sendMail({
      to: user.email,
      subject: "Redefinição de senha — Prime Arena",
      text: `Olá, ${user.displayName}!\n\nPara criar uma nova senha, acesse:\n${getEnv().appUrl}/redefinir-senha/${token}\n\nO link vale por ${RESET_HOURS} hora. Se não foi você, ignore este e-mail — sua senha atual continua valendo.`,
    });
  } catch (e) {
    // A resposta é a mesma exista a conta ou não: um erro só quando a conta existe revelaria quem tem cadastro.
    console.error(`[mail] Não consegui enviar a redefinição de senha para o usuário ${user.id}: ${safeMailError(e)}`);
  }
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
      displayName: z.string().transform(cleanDisplayName).pipe(z.string().min(2, "Informe seu nome de exibição.").max(40)),
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
