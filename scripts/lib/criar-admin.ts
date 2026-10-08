import { db } from "../../src/lib/db";
import { hashPassword, randomToken } from "../../src/lib/crypto";
import { assertProductionConfig, getEnv } from "../../src/lib/env";
import { registerSchema, sendVerificationEmail } from "../../src/server/auth";

export async function criarAdmin(input: { email: string; username: string; displayName: string }, reenviar = false) {
  const env = getEnv();
  if (!env.isProd && !env.isTest) throw new Error("Execute em produção; este comando não cria contas de demonstração.");
  assertProductionConfig();
  const parsed = registerSchema.parse({ ...input, password: randomToken(48) });
  if (!env.adminEmails.includes(parsed.email)) throw new Error("O e-mail precisa estar em ADMIN_EMAILS antes de criar a conta.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL precisa apontar explicitamente para o banco do site.");

  const existing = await db.user.findFirst({
    where: { OR: [{ email: parsed.email }, { username: parsed.username }] },
  });
  if (existing) {
    if (!reenviar || existing.email !== parsed.email || existing.username !== parsed.username) {
      throw new Error("Conta ou usuário já existe. Para reenviar a confirmação, use os mesmos dados com --reenviar.");
    }
    if (existing.bannedAt || existing.emailVerifiedAt || existing.role !== "USER") {
      throw new Error("Reenvio recusado: conta suspensa, já confirmada ou com cargo atribuído. Use a recuperação de senha do site.");
    }
    await sendVerificationEmail(existing);
    return;
  }
  if (reenviar) throw new Error("Conta não encontrada. Execute sem --reenviar para criá-la.");

  // Nenhum cargo privilegiado, sessão, senha pública ou confirmação artificial.
  // A senha aleatória não é exibida. O dono define a senha pelo fluxo de confirmação.
  const user = await db.user.create({
    data: {
      email: parsed.email,
      username: parsed.username,
      displayName: parsed.displayName,
      passwordHash: await hashPassword(parsed.password),
      role: "USER",
    },
  });
  // Se o SMTP falhar, a conta permanece pendente e --reenviar permite tentar novamente.
  await sendVerificationEmail(user);
}
