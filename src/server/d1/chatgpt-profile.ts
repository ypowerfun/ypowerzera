import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";

export async function createD1ChatGPTProfile(db: D1Database, input: {
  subject: string; email: string; username: string; displayName: string; passwordHash: string; now: number;
}) {
  const id = randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO User(id,email,username,displayName,passwordHash,emailVerifiedAt,role,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,'USER',?,?)`).bind(id,input.email,input.username,input.displayName,input.passwordHash,input.now,input.now,input.now),
    db.prepare('INSERT INTO ChatGPTIdentity(subject,userId,createdAt) VALUES (?,?,?)').bind(input.subject,id,input.now),
  ]);
  return id;
}
