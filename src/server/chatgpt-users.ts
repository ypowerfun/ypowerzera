import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/crypto";
import { cleanDisplayName, registerSchema, toSafeUser } from "./auth";
import type { ChatGPTUser } from "./chatgpt-auth";

export async function findChatGPTProfile(identity: ChatGPTUser) {
  const binding = await db.chatGPTIdentity.findUnique({ where: { subject: identity.userId }, include: { user: true } });
  if (!binding) return null;
  if (binding.user.bannedAt) throw new AppError("Sua conta está suspensa. Entre em contato com a organização.", "FORBIDDEN");
  const user = toSafeUser(binding.user);
  // Only an explicit stable subject allowlist can bootstrap an administrator.
  // A contact email from SIWC is never a privilege or account-linking proof.
  if (getEnv().chatgptAdminUserIds.includes(identity.userId)) user.role = "ADMIN";
  return user;
}

export async function createChatGPTProfile(identity: ChatGPTUser, input: { username: string; displayName: string; terms: boolean }) {
  if (!input.terms) throw new AppError("Você precisa aceitar os Termos de Uso.");
  const existing = await findChatGPTProfile(identity);
  if (existing) return existing;
  const username = registerSchema.shape.username.parse(input.username);
  const displayName = registerSchema.shape.displayName.parse(cleanDisplayName(input.displayName));
  if (/^(admin|administrador|administrator|root|suporte|support|staff|moderador|sistema|oficial|primearena|prime_arena)$/.test(username)) {
    throw new AppError("Este nome de usuário não está disponível. Escolha outro.");
  }
  if (await db.user.findUnique({ where: { email: identity.email.toLowerCase() } })) {
    throw new AppError("Já existe um perfil com este e-mail. Peça à organização para vincular as contas com segurança.", "CONFLICT");
  }
  try {
    const user = await db.user.create({ data: {
      email: identity.email.toLowerCase(), username, displayName,
      // Deliberately not a scrypt hash: local password verification always refuses it.
      passwordHash: `chatgpt-only:${randomToken()}`,
      // The tournament eligibility gate is satisfied by platform authentication.
      // This does not claim that SIWC attests control of the contact mailbox.
      emailVerifiedAt: new Date(),
      role: "USER",
      chatgptIdentity: { create: { subject: identity.userId } },
    } });
    const safe = toSafeUser(user);
    if (getEnv().chatgptAdminUserIds.includes(identity.userId)) safe.role = "ADMIN";
    return safe;
  } catch (error) {
    // Simultaneous onboarding for the same subject must return the same profile.
    const committed = await findChatGPTProfile(identity);
    if (committed) return committed;
    throw error;
  }
}
