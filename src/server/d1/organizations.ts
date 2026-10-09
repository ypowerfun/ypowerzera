import { randomUUID } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';

type Input={actorId:string;actorIsAdmin:boolean;orgId:string};
const access=`EXISTS (SELECT 1 FROM Organization o JOIN User a ON a.id=? WHERE o.id=? AND o.deletedAt IS NULL
  AND a.bannedAt IS NULL AND (?=1 OR (a.role='ORGANIZER' AND EXISTS (
    SELECT 1 FROM OrgMember WHERE orgId=o.id AND userId=a.id AND role IN ('OWNER','ADMIN')))))`;
const owner=`(?=1 OR EXISTS (SELECT 1 FROM OrgMember WHERE orgId=? AND userId=? AND role='OWNER'))`;

export async function addD1OrgMember(db:D1Database,input:Input & {userId:string;role:'ADMIN'|'STAFF'}) {
  await db.batch([
    db.prepare(`SELECT CASE WHEN ${access} AND ? IN ('ADMIN','STAFF') AND (?<>'ADMIN' OR ${owner})
      THEN 1 ELSE json('org-member-permission') END`).bind(input.actorId,input.orgId,input.actorIsAdmin?1:0,input.role,input.role,input.actorIsAdmin?1:0,input.orgId,input.actorId),
    db.prepare(`INSERT INTO OrgMember(id,orgId,userId,role) VALUES (?,?,?,?)`).bind(randomUUID(),input.orgId,input.userId,input.role),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,'org.member.add','Organization',?,?,?)`)
      .bind(randomUUID(),input.actorId,input.orgId,JSON.stringify({userId:input.userId,role:input.role}),Date.now()),
  ]);
}
export async function removeD1OrgMember(db:D1Database,input:Input & {userId:string}) {
  await db.batch([
    db.prepare(`SELECT CASE WHEN ${access} AND EXISTS (SELECT 1 FROM OrgMember WHERE orgId=? AND userId=?
      AND role<>'OWNER' AND (role<>'ADMIN' OR ${owner})) THEN 1 ELSE json('org-member-permission') END`)
      .bind(input.actorId,input.orgId,input.actorIsAdmin?1:0,input.orgId,input.userId,input.actorIsAdmin?1:0,input.orgId,input.actorId),
    db.prepare(`DELETE FROM OrgMember WHERE orgId=? AND userId=?`).bind(input.orgId,input.userId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,'org.member.remove','Organization',?,?,?)`)
      .bind(randomUUID(),input.actorId,input.orgId,JSON.stringify({userId:input.userId}),Date.now()),
  ]);
}
export async function updateD1Organization(db:D1Database,input:Input & {name:string;description:string|null}) {
  await db.batch([
    db.prepare(`SELECT CASE WHEN ${access} AND EXISTS (SELECT 1 FROM User WHERE id=? AND (emailVerifiedAt IS NOT NULL OR ?=1))
      THEN 1 ELSE json('org-update-permission') END`).bind(input.actorId,input.orgId,input.actorIsAdmin?1:0,input.actorId,input.actorIsAdmin?1:0),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt)
      SELECT ?,?,'org.update','Organization',id,json_object('from',name,'to',?),? FROM Organization WHERE id=?`)
      .bind(randomUUID(),input.actorId,input.name,Date.now(),input.orgId),
    db.prepare(`UPDATE Organization SET name=?,description=? WHERE id=?`).bind(input.name,input.description,input.orgId),
  ]);
}
export async function deleteD1Organization(db:D1Database,input:Input & {confirmName:string}) {
  const now=Date.now();
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Organization o JOIN User a ON a.id=? WHERE o.id=? AND o.deletedAt IS NULL
      AND o.name=? AND a.bannedAt IS NULL AND (a.emailVerifiedAt IS NOT NULL OR ?=1)
      AND (?=1 OR (a.role='ORGANIZER' AND EXISTS (SELECT 1 FROM OrgMember WHERE orgId=o.id AND userId=a.id AND role='OWNER')))
      AND NOT EXISTS (SELECT 1 FROM Tournament WHERE orgId=o.id AND status IN ('REGISTRATION','CHECK_IN','LIVE'))
      AND NOT EXISTS (SELECT 1 FROM PrizeAward p JOIN Tournament t ON t.id=p.tournamentId WHERE t.orgId=o.id AND p.status='PENDING')
      ) THEN 1 ELSE json('org-delete-conflict') END`).bind(input.actorId,input.orgId,input.confirmName,input.actorIsAdmin?1:0,input.actorIsAdmin?1:0),
    db.prepare(`UPDATE Organization SET deletedAt=? WHERE id=?`).bind(now,input.orgId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt)
      SELECT ?,?,'org.delete','Organization',o.id,json_object('name',o.name,'byAdmin',json(CASE WHEN EXISTS (
        SELECT 1 FROM OrgMember WHERE orgId=o.id AND userId=? AND role='OWNER') THEN 'false' ELSE 'true' END),
        'drafts',(SELECT count(*) FROM Tournament WHERE orgId=o.id AND status='DRAFT')),? FROM Organization o WHERE o.id=?`)
      .bind(randomUUID(),input.actorId,input.actorId,now,input.orgId),
    db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
      SELECT ?||m.id,m.userId,'org.deleted','A organização '||o.name||' foi excluída',
      CASE WHEN EXISTS (SELECT 1 FROM OrgMember WHERE orgId=o.id AND userId=? AND role='OWNER')
        THEN 'O dono excluiu a organização.' ELSE 'Um administrador da plataforma excluiu a organização.' END,
      '/organizar',? FROM OrgMember m JOIN Organization o ON o.id=m.orgId WHERE o.id=? AND m.userId<>?`)
      .bind(randomUUID()+':',input.actorId,now,input.orgId,input.actorId),
  ]);
}
