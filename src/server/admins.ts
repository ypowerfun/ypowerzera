import { db, type Tx } from "@/lib/db";
import { getEnv } from "@/lib/env";

/** Administradores do banco, subjects autorizados no Sites ou e-mails verificados no modo local. */
export async function adminUserIds(client: Tx = db): Promise<string[]> {
  const env = getEnv();
  const emails = env.authProvider === "local" ? env.adminEmails : [];
  const rows = await client.user.findMany({
    where: { OR: [{ role: "ADMIN" }, ...(env.authProvider === "chatgpt" && env.chatgptAdminUserIds.length ? [{ chatgptIdentity: { subject: { in: env.chatgptAdminUserIds } } }] : []), ...(emails.length ? [{ email: { in: emails }, emailVerifiedAt: { not: null } }] : [])] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
