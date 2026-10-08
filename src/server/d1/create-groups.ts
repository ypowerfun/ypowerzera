import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";

export async function createD1Team(db: D1Database, input: {
  actorId: string; name: string; tag: string; gameId: string | null; description: string | null; slug: string;
}) {
  const id = randomUUID(), now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO Team(id,name,tag,gameId,description,slug,ownerId,createdAt)
      SELECT ?,?,?,?,?,?,?,? FROM User WHERE id=? AND bannedAt IS NULL AND emailVerifiedAt IS NOT NULL`)
      .bind(id,input.name,input.tag,input.gameId,input.description,input.slug,input.actorId,now,input.actorId),
    db.prepare(`INSERT INTO TeamMember(id,teamId,userId,role,joinedAt) VALUES (?,?,?,'CAPTAIN',?)`)
      .bind(randomUUID(),id,input.actorId,now),
  ]);
  return id;
}

export async function createD1Organization(db: D1Database, input: {
  actorId: string; isAdmin: boolean; name: string; description: string | null; slug: string;
}) {
  const id = randomUUID(), now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO Organization(id,name,description,slug,createdAt)
      SELECT ?,?,?,?,? FROM User WHERE id=? AND bannedAt IS NULL AND emailVerifiedAt IS NOT NULL
        AND (role IN ('ADMIN','ORGANIZER') OR ?=1)`)
      .bind(id,input.name,input.description,input.slug,now,input.actorId,input.isAdmin?1:0),
    db.prepare(`INSERT INTO OrgMember(id,orgId,userId,role) VALUES (?,?,?,'OWNER')`).bind(randomUUID(),id,input.actorId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt)
      VALUES (?,?,'org.create','Organization',?,?,?)`).bind(randomUUID(),input.actorId,id,JSON.stringify({name:input.name}),now),
  ]);
  return id;
}
