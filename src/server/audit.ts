import { db, type Tx } from "@/lib/db";

export async function audit(actorId: string | null, action: string, entity: string, entityId: string, meta?: Record<string, unknown>, tx: Tx = db): Promise<void> {
  await tx.auditLog.create({ data: { actorId, action, entity, entityId, meta: (meta ?? {}) as object } });
}
