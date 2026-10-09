import { randomUUID } from "node:crypto";
import { sitesDatabase } from "@/lib/sites-d1";
import { db, type Tx } from "@/lib/db";

export async function audit(actorId: string | null, action: string, entity: string, entityId: string, meta?: Record<string, unknown>, tx: Tx = db): Promise<void> {
  const d1 = tx === db ? sitesDatabase() : null;
  if (d1) {
    await d1.prepare('INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,?,?,?,?,?)')
      .bind(randomUUID(),actorId,action,entity,entityId,JSON.stringify(meta ?? {}),Date.now()).run();
    return;
  }
  await tx.auditLog.create({ data: { actorId, action, entity, entityId, meta: (meta ?? {}) as object } });
}
