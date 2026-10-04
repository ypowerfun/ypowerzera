import { db, type Tx } from "@/lib/db";

export async function notify(userId: string | string[], kind: string, title: string, body: string, href?: string, tx: Tx = db): Promise<void> {
  const ids = [...new Set(Array.isArray(userId) ? userId : [userId])];
  if (ids.length === 0) return;
  await tx.notification.createMany({ data: ids.map((id) => ({ userId: id, kind, title, body, href })) });
}

export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string): Promise<void> {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
