import { db, type Tx } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * Ids de quem é administrador de fato, na mesma regra de `effectiveRole`: cargo ADMIN no banco OU e-mail verificado
 * listado em ADMIN_EMAILS (esse cargo nunca é gravado no banco). Use para avisar a fila do admin.
 */
export async function adminUserIds(client: Tx = db): Promise<string[]> {
  const emails = getEnv().adminEmails;
  const rows = await client.user.findMany({
    where: { OR: [{ role: "ADMIN" }, ...(emails.length ? [{ email: { in: emails }, emailVerifiedAt: { not: null } }] : [])] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
