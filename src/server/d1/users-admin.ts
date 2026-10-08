import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";

// The allowlist is deployment configuration, never request/form data.
const permission = `EXISTS (SELECT 1 FROM User a WHERE a.id=? AND a.bannedAt IS NULL
  AND (a.role='ADMIN' OR EXISTS (SELECT 1 FROM ChatGPTIdentity i WHERE i.userId=a.id AND i.subject IN (SELECT value FROM json_each(?)))))
  AND u.id!=? AND u.role!='ADMIN' AND NOT EXISTS (SELECT 1 FROM ChatGPTIdentity i WHERE i.userId=u.id AND i.subject IN (SELECT value FROM json_each(?)))`;
type AdminRequest = {actorId:string;userId:string;adminSubjects:string[]};
function bindings(input: AdminRequest) {const ids=JSON.stringify(input.adminSubjects);return [input.actorId,ids,input.actorId,ids];}

export async function changeD1UserRole(db:D1Database,input:AdminRequest & {from:'USER'|'ORGANIZER';to:'USER'|'ORGANIZER'}) {
  const now=Date.now();
  const results=await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM User u WHERE u.id=? AND u.role=? AND ${permission})
      THEN 1 ELSE json('user-role-conflict') END`).bind(input.userId,input.from,...bindings(input)),
    db.prepare('UPDATE User SET role=?,updatedAt=MAX(updatedAt+1,?) WHERE id=?').bind(input.to,now,input.userId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,'user.role','User',?,?,?)`)
      .bind(randomUUID(),input.actorId,input.userId,JSON.stringify({from:input.from,to:input.to}),now),
    db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt) VALUES (?,?,'user.role',?,?,?,?)`)
      .bind(randomUUID(),input.userId,input.to==='ORGANIZER'?'Você agora é organizador':'Seu acesso de organizador foi removido',
        input.to==='ORGANIZER'?'Você já pode criar organizações e campeonatos na área Organizar.':'Você voltou a ser jogador. Seus times e sua conta continuam como estavam.',input.to==='ORGANIZER'?'/organizar':'/conta',now),
    db.prepare(`SELECT (SELECT COUNT(*) FROM OrgMember m JOIN Organization o ON o.id=m.orgId WHERE m.userId=? AND m.role IN ('OWNER','ADMIN') AND o.deletedAt IS NULL) orgs,
      (SELECT COUNT(*) FROM Tournament t WHERE t.status IN ('REGISTRATION','CHECK_IN','LIVE') AND t.orgId IN
        (SELECT m.orgId FROM OrgMember m JOIN Organization o ON o.id=m.orgId WHERE m.userId=? AND m.role IN ('OWNER','ADMIN') AND o.deletedAt IS NULL)) activeTournaments`)
      .bind(input.userId,input.userId),
  ]);
  return input.to==='USER' ? results.at(-1)!.results[0] as {orgs:number;activeTournaments:number} : undefined;
}

export async function changeD1UserBan(db:D1Database,input:AdminRequest & {ban:boolean;reason:string}) {
  const now=Date.now();
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM User u WHERE u.id=? AND u.bannedAt IS ${input.ban?'NULL':'NOT NULL'} AND ${permission})
      THEN 1 ELSE json('user-ban-conflict') END`).bind(input.userId,...bindings(input)),
    db.prepare('UPDATE User SET bannedAt=?,banReason=?,updatedAt=MAX(updatedAt+1,?) WHERE id=?').bind(input.ban?now:null,input.ban?input.reason:null,now,input.userId),
    ...(input.ban?[db.prepare('DELETE FROM Session WHERE userId=?').bind(input.userId)]:[]),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,?,'User',?,?,?)`)
      .bind(randomUUID(),input.actorId,input.ban?'user.ban':'user.unban',input.userId,JSON.stringify({reason:input.reason||null}),now),
  ]);
}
