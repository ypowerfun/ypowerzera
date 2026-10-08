import { randomUUID } from "node:crypto";
import { sitesDatabase } from "@/lib/sites-d1";
import { db, type Tx } from "@/lib/db";

export async function notify(userId: string | string[], kind: string, title: string, body: string, href?: string, tx: Tx = db): Promise<void> {
  const ids = [...new Set(Array.isArray(userId) ? userId : [userId])];
  if (ids.length === 0) return;
  const d1 = sitesDatabase();
  // Transaction-owned notifications must stay in their caller's atomic batch.
  if (d1 && tx === db) {
    await d1.batch(ids.map(id => d1.prepare("INSERT INTO Notification(id,userId,kind,title,body,href,createdAt) VALUES (?,?,?,?,?,?,?)")
      .bind(randomUUID(),id,kind,title,body,href??null,Date.now())));
    return;
  }
  await tx.notification.createMany({ data: ids.map((id) => ({ userId: id, kind, title, body, href })) });
}

export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string): Promise<void> {
  const d1 = sitesDatabase();
  if (d1) { await d1.prepare("UPDATE Notification SET readAt=? WHERE userId=? AND readAt IS NULL").bind(Date.now(),userId).run(); return; }
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
