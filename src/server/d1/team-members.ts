import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";

/** All guards execute inside the same D1 batch as the writes. */
export async function respondD1TeamInvite(db: D1Database, input: { actorId: string; inviteId: string; accept: boolean; now?: number }) {
  const now = input.now ?? Date.now();
  const statements = [db.prepare(`SELECT CASE WHEN EXISTS (
    SELECT 1 FROM TeamInvite i JOIN Team t ON t.id=i.teamId JOIN User u ON u.id=i.userId
    WHERE i.id=? AND i.userId=? AND i.status='PENDING' AND i.expiresAt>=? AND t.deletedAt IS NULL AND u.bannedAt IS NULL
      AND (?=0 OR EXISTS (SELECT 1 FROM TeamMember WHERE teamId=i.teamId AND userId=i.userId)
        OR (SELECT count(*) FROM TeamMember WHERE teamId=i.teamId)<15)
  ) THEN 1 ELSE json('team-invite-conflict') END`).bind(input.inviteId,input.actorId,now,input.accept?1:0)];
  if (input.accept) statements.push(db.prepare(`INSERT INTO TeamMember(id,teamId,userId,role,joinedAt)
    SELECT ?,teamId,userId,role,? FROM TeamInvite WHERE id=? ON CONFLICT(teamId,userId) DO NOTHING`)
    .bind(randomUUID(),now,input.inviteId));
  statements.push(db.prepare(`UPDATE TeamInvite SET status=? WHERE id=?`).bind(input.accept?'ACCEPTED':'DECLINED',input.inviteId));
  if (input.accept) statements.push(db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
    SELECT ?,t.ownerId,'team.joined','Novo integrante',u.displayName || ' entrou no time ' || t.name || '.',
      '/times/' || t.slug,? FROM TeamInvite i JOIN Team t ON t.id=i.teamId JOIN User u ON u.id=i.userId WHERE i.id=?`)
    .bind(randomUUID(),now,input.inviteId));
  await db.batch(statements);
}

export async function changeD1TeamRole(db: D1Database, input: {
  actorId: string; actorIsAdmin: boolean; teamId: string; userId: string; role: 'CAPTAIN' | 'PLAYER' | 'SUB';
}) {
  const {actorId,teamId,userId,role}=input;
  const statements=[db.prepare(`SELECT CASE WHEN EXISTS (
    SELECT 1 FROM Team t JOIN User a ON a.id=? JOIN TeamMember target ON target.teamId=t.id AND target.userId=?
    WHERE t.id=? AND t.deletedAt IS NULL AND a.bannedAt IS NULL AND ? IN ('CAPTAIN','PLAYER','SUB')
      AND (?=1 OR EXISTS (SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=a.id AND role='CAPTAIN'))
      AND (?='CAPTAIN' OR target.role<>'CAPTAIN')
      AND NOT (?='CAPTAIN' AND ?=1 AND target.userId=a.id AND NOT EXISTS (
        SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=a.id AND role='CAPTAIN'))
  ) THEN 1 ELSE json('team-role-conflict') END`).bind(actorId,userId,teamId,role,input.actorIsAdmin?1:0,role,role,input.actorIsAdmin?1:0)];
  if(role==='CAPTAIN') {
    statements.push(db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt)
      SELECT ?,?,'team.captain','Team',?,json_object('to',?,'byAdmin',json(CASE WHEN ?=1 AND NOT EXISTS (
        SELECT 1 FROM TeamMember WHERE teamId=? AND userId=? AND role='CAPTAIN') THEN 'true' ELSE 'false' END)),?
      FROM TeamMember WHERE teamId=? AND userId=? AND role<>'CAPTAIN'`)
      .bind(randomUUID(),actorId,teamId,userId,input.actorIsAdmin?1:0,teamId,actorId,Date.now(),teamId,userId));
    statements.push(db.prepare(`UPDATE TeamMember SET role='PLAYER' WHERE teamId=? AND userId<>? AND role='CAPTAIN'`).bind(teamId,userId));
    statements.push(db.prepare(`UPDATE Team SET ownerId=? WHERE id=?`).bind(userId,teamId));
    statements.push(db.prepare(`WITH candidates AS MATERIALIZED (
      SELECT p.id,ROW_NUMBER() OVER (PARTITION BY p.tournamentId ORDER BY p.registeredAt,p.id) AS priority
      FROM Participant p JOIN Tournament t ON t.id=p.tournamentId
      WHERE p.teamId=? AND p.userId<>? AND p.status IN ('REGISTERED','CHECKED_IN','WAITLIST')
        AND t.status IN ('DRAFT','REGISTRATION','CHECK_IN','LIVE')
        AND NOT EXISTS (SELECT 1 FROM Participant other WHERE other.tournamentId=p.tournamentId AND other.userId=?)
    ) UPDATE Participant SET userId=? WHERE id IN (SELECT id FROM candidates WHERE priority=1)`)
      .bind(teamId,userId,userId,userId));
  }
  statements.push(db.prepare(`UPDATE TeamMember SET role=? WHERE teamId=? AND userId=?`).bind(role,teamId,userId));
  await db.batch(statements);
}

export async function removeD1TeamMember(db: D1Database, input: { actorId: string; actorIsAdmin: boolean; teamId: string; userId: string }) {
  const {actorId,teamId,userId}=input;
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM Team t JOIN User a ON a.id=? JOIN TeamMember target ON target.teamId=t.id AND target.userId=?
      WHERE t.id=? AND t.deletedAt IS NULL AND a.bannedAt IS NULL
        AND (a.id=target.userId OR ?=1 OR EXISTS (SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=a.id AND role='CAPTAIN'))
        AND (target.role<>'CAPTAIN' OR (SELECT count(*) FROM TeamMember WHERE teamId=t.id AND role='CAPTAIN')>1)
    ) THEN 1 ELSE json('team-member-conflict') END`).bind(actorId,userId,teamId,input.actorIsAdmin?1:0),
    db.prepare(`DELETE FROM TeamMember WHERE teamId=? AND userId=?`).bind(teamId,userId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,?,'Team',?,?,?)`)
      .bind(randomUUID(),actorId,actorId===userId?'team.leave':'team.kick',teamId,JSON.stringify({userId}),Date.now()),
  ]);
}

export async function inviteD1TeamMember(db: D1Database, input: {
  actorId: string; actorIsAdmin: boolean; teamId: string; userId: string; role: 'PLAYER'|'SUB'; token: string;
}) {
  const id=randomUUID(),now=Date.now();
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Team t JOIN User a ON a.id=? JOIN User target ON target.id=?
      WHERE t.id=? AND t.deletedAt IS NULL AND a.bannedAt IS NULL AND target.bannedAt IS NULL AND ? IN ('PLAYER','SUB')
        AND (?=1 OR EXISTS (SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=a.id AND role='CAPTAIN'))
        AND a.id<>target.id AND (SELECT count(*) FROM TeamMember WHERE teamId=t.id)<15
        AND NOT EXISTS (SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=target.id)
        AND NOT EXISTS (SELECT 1 FROM TeamInvite WHERE teamId=t.id AND userId=target.id AND status='PENDING' AND expiresAt>?)
      ) THEN 1 ELSE json('team-invitation-conflict') END`).bind(input.actorId,input.userId,input.teamId,input.role,input.actorIsAdmin?1:0,now),
    db.prepare(`INSERT INTO TeamInvite(id,teamId,invitedById,userId,role,token,expiresAt,createdAt) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id,input.teamId,input.actorId,input.userId,input.role,input.token,now+7*86400_000,now),
    db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
      SELECT ?,?,'team.invite','Convite para o time '||t.name,a.displayName||' convidou você para entrar no time ['||t.tag||'] '||t.name||'.','/times',?
      FROM Team t JOIN User a ON a.id=? WHERE t.id=?`).bind(randomUUID(),input.userId,now,input.actorId,input.teamId),
  ]);
  return id;
}

export async function deleteD1Team(db: D1Database, input: { actorId:string; actorIsAdmin:boolean; teamId:string; reason:string }) {
  const {actorId,teamId}=input,now=Date.now();
  const results=await db.batch<{balanceCents?:number}>([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Team t JOIN User a ON a.id=?
      WHERE t.id=? AND t.deletedAt IS NULL AND a.bannedAt IS NULL AND (a.emailVerifiedAt IS NOT NULL OR ?=1)
        AND (EXISTS (SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=a.id AND role='CAPTAIN') OR (?=1 AND length(?)>=10))
        AND NOT EXISTS (SELECT 1 FROM Challenge WHERE (creatorTeamId=t.id OR opponentTeamId=t.id) AND status IN ('OPEN','ACCEPTED','REPORTED','DISPUTED'))
        AND NOT EXISTS (SELECT 1 FROM Withdrawal WHERE teamId=t.id AND status IN ('PENDING_CONFIRMATION','UNDER_REVIEW','APPROVED','PROCESSING'))
        AND NOT EXISTS (SELECT 1 FROM Deposit WHERE teamId=t.id AND status='PENDING' AND expiresAt>?)
        AND NOT EXISTS (SELECT 1 FROM Participant p JOIN Tournament tour ON tour.id=p.tournamentId WHERE p.teamId=t.id
          AND p.status IN ('PENDING_PAYMENT','REGISTERED','CHECKED_IN','WAITLIST') AND tour.status IN ('REGISTRATION','CHECK_IN','LIVE'))
      ) THEN 1 ELSE json('team-delete-conflict') END`).bind(actorId,teamId,input.actorIsAdmin?1:0,input.actorIsAdmin?1:0,input.reason,now),
    db.prepare(`UPDATE Team SET deletedAt=?,deletedById=? WHERE id=?`).bind(now,actorId,teamId),
    db.prepare(`UPDATE TeamInvite SET status='REVOKED' WHERE teamId=? AND status='PENDING'`).bind(teamId),
    db.prepare(`UPDATE Wallet SET frozenAt=?,frozenReason=? WHERE teamId=? AND frozenAt IS NULL`)
      .bind(now,'Equipe excluída: saldo bloqueado até a revisão do administrador.',teamId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt)
      SELECT ?,?,'team.delete','Team',t.id,json_object('balanceCents',COALESCE(w.balanceCents,0),'reason',NULLIF(?,''),
        'byAdmin',json(CASE WHEN EXISTS (SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=? AND role='CAPTAIN') THEN 'false' ELSE 'true' END)),?
      FROM Team t LEFT JOIN Wallet w ON w.teamId=t.id WHERE t.id=?`).bind(randomUUID(),actorId,input.reason,actorId,now,teamId),
    db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
      SELECT ?||m.id,m.userId,'team.deleted','O time '||t.name||' foi excluído',
      CASE WHEN EXISTS (SELECT 1 FROM TeamMember WHERE teamId=t.id AND userId=? AND role='CAPTAIN') THEN 'O líder excluiu o time.' ELSE 'Um administrador excluiu o time.' END,
      '/times',? FROM TeamMember m JOIN Team t ON t.id=m.teamId WHERE t.id=? AND m.userId<>?`).bind(randomUUID()+':',actorId,now,teamId,actorId),
    db.prepare(`SELECT COALESCE((SELECT balanceCents FROM Wallet WHERE teamId=?),0) AS balanceCents`).bind(teamId),
  ]);
  return {balanceCents:Number(results.at(-1)?.results[0]?.balanceCents??0)};
}
