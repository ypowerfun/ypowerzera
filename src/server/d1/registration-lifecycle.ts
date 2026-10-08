import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import { AppError } from "@/lib/errors";

type Request = { participantId: string; actorId: string; actorIsAdmin: boolean; now?: number };
// `u`, `p`, `t` aliases are shared by the prepared statements below. Platform
// admin status comes from the authenticated server identity, never form data.
const staff = `(?=1 OR (EXISTS (SELECT 1 FROM Organization o WHERE o.id=t.orgId AND o.deletedAt IS NULL)
  AND EXISTS (SELECT 1 FROM OrgMember m WHERE m.orgId=t.orgId AND m.userId=u.id
    AND (u.role='ORGANIZER' OR m.role='STAFF'))))`;

export async function changeD1CheckIn(db: D1Database, input: Request & { undo: boolean }) {
  const now = input.now ?? Date.now();
  const status = input.undo ? "REGISTERED" : "CHECKED_IN";
  const from = input.undo ? "CHECKED_IN" : "REGISTERED";
  const window = input.undo ? `t.status IN ('REGISTRATION','CHECK_IN')` :
    `((p.userId!=u.id AND ${staff}) OR t.status='CHECK_IN' OR (t.status='REGISTRATION' AND t.checkInOpensAt IS NOT NULL
      AND t.checkInOpensAt<=? AND (t.checkInClosesAt IS NULL OR t.checkInClosesAt>=?)))`;
  const changed = await db.prepare(`UPDATE Participant SET status=?,checkedInAt=? WHERE id IN (
    SELECT p.id FROM Participant p JOIN Tournament t ON t.id=p.tournamentId JOIN User u ON u.id=?
    WHERE p.id=? AND u.bannedAt IS NULL AND (p.userId=u.id OR ${staff}) AND ${window} AND p.status=?) RETURNING id`)
    .bind(status,input.undo?null:now,input.actorId,input.participantId,input.actorIsAdmin?1:0,
      ...(input.undo?[]:[input.actorIsAdmin?1:0,now,now]),from).first();
  if (changed) return;
  // Concurrent repeat is harmless, but an unauthorized repeat must not pass.
  const existing = await db.prepare(`SELECT p.status FROM Participant p JOIN Tournament t ON t.id=p.tournamentId
    JOIN User u ON u.id=? WHERE p.id=? AND u.bannedAt IS NULL AND (p.userId=u.id OR ${staff})`)
    .bind(input.actorId,input.participantId,input.actorIsAdmin?1:0).first<{status:string}>();
  if (existing?.status !== status) throw new AppError("As condições do check-in mudaram. Atualize a página.", "CONFLICT");
}

export async function withdrawD1FreeRegistration(db: D1Database, input: Request) {
  const now = input.now ?? Date.now(), operation = randomUUID();
  const p = await db.prepare('SELECT tournamentId FROM Participant WHERE id=?').bind(input.participantId).first<{tournamentId:string}>();
  if (!p) return;
  const queue = `SELECT q.id FROM Participant q JOIN Tournament t ON t.id=q.tournamentId
    WHERE q.tournamentId=? AND q.status='WAITLIST' AND t.status IN ('REGISTRATION','CHECK_IN') AND t.entryFeeCents=0
    ORDER BY q.registeredAt,q.id LIMIT (SELECT MAX(0,t.maxParticipants-(SELECT COUNT(*) FROM Participant active
      WHERE active.tournamentId=t.id AND (active.status IN ('REGISTERED','CHECKED_IN')
        OR (active.status='PENDING_PAYMENT' AND active.reservedUntil>?)))) FROM Tournament t WHERE t.id=?)`;
  await db.batch([
    // Malformed JSON raises an error and rolls back the whole batch if the
    // authorization, tournament phase or financial precondition changed.
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Participant p JOIN Tournament t ON t.id=p.tournamentId
      JOIN User u ON u.id=? WHERE p.id=? AND u.bannedAt IS NULL AND t.entryFeeCents=0
      AND t.status IN ('DRAFT','REGISTRATION','CHECK_IN') AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.participantId=p.id)
      AND ((p.userId=u.id AND p.status!='DISQUALIFIED') OR (p.userId!=u.id AND ${staff}))) THEN 1 ELSE json('registration-conflict') END`)
      .bind(input.actorId,input.participantId,input.actorIsAdmin?1:0),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt)
      SELECT ?,?,CASE WHEN userId=? THEN 'participant.withdraw' ELSE 'participant.remove' END,'Tournament',tournamentId,
        json_object('participantId',id),? FROM Participant WHERE id=?`)
      .bind(operation,input.actorId,input.actorId,now,input.participantId),
    db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
      SELECT ?,p.userId,'participant.removed','Inscrição removida','A organização removeu sua inscrição em '||t.name||'.',
        '/torneios/'||t.slug,? FROM Participant p JOIN Tournament t ON t.id=p.tournamentId WHERE p.id=? AND p.userId!=?`)
      .bind(randomUUID(),now,input.participantId,input.actorId),
    db.prepare('DELETE FROM RosterEntry WHERE participantId=?').bind(input.participantId),
    db.prepare('DELETE FROM Participant WHERE id=?').bind(input.participantId),
    db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
      SELECT ?||q.id,q.userId,'waitlist.promoted','Você entrou no campeonato!',
        'Abriu uma vaga em '||t.name||' e sua inscrição foi confirmada.','/torneios/'||t.slug,?
      FROM Participant q JOIN Tournament t ON t.id=q.tournamentId WHERE q.id IN (${queue})`)
      .bind(operation+':',now,p.tournamentId,now,p.tournamentId),
    db.prepare(`WITH queue AS MATERIALIZED (${queue}) UPDATE Participant SET status='REGISTERED' WHERE id IN (SELECT id FROM queue)`)
      .bind(p.tournamentId,now,p.tournamentId),
  ]);
}
