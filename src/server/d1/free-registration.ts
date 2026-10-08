import { randomUUID } from "node:crypto";

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ results?: Record<string, unknown>[] }>>;
}
export interface ValidatedRegistration {
  tournamentId: string;
  tournamentUpdatedAt: number | string;
  actorId: string;
  actorIsAdmin?: boolean;
  teamId: string | null;
  name: string;
  tag: string | null;
  roster: Array<{ userId: string; role: string; handle: string }>;
  customAnswers: Record<string, string>;
  now: number;
}

/**
 * Prepared commit for phase one. The caller still validates forms, custom fields,
 * platform, and roster structure. Database-dependent authorization is rechecked
 * inside the INSERT. Capacity selection, roster uniqueness, and audit are one
 * D1 batch; a roster conflict rolls back the reservation and audit together.
 * Called by the Worker registration service; native SQLite retains its original transaction.
 */
export async function commitFreeRegistration(db: Database, input: ValidatedRegistration) {
  const existing = await db.prepare('SELECT "id", "status" FROM "Participant" WHERE "tournamentId"=? AND "userId"=?')
    .bind(input.tournamentId, input.actorId).first<{ id: string; status: string }>();
  if (existing) {
    if (existing.status === "REGISTERED" || existing.status === "WAITLIST" || existing.status === "CHECKED_IN") return existing;
    throw new Error("A inscrição anterior precisa ser resolvida antes de uma nova tentativa.");
  }
  const id = randomUUID();
  const rosterJson = JSON.stringify(input.roster);
  const reserve = db.prepare(`
    INSERT INTO "Participant" ("id","tournamentId","userId","teamId","name","tag","status","roster","customAnswers","registeredAt")
    SELECT ?,t."id",u."id",?,?,?,
      CASE WHEN (SELECT COUNT(*) FROM "Participant" p WHERE p."tournamentId"=t."id"
        AND (p."status" IN ('REGISTERED','CHECKED_IN') OR (p."status"='PENDING_PAYMENT' AND p."reservedUntil">?)))
        <t."maxParticipants" THEN 'REGISTERED' ELSE 'WAITLIST' END,?,?,?
    FROM "Tournament" t JOIN "User" u ON u."id"=?
    WHERE t."id"=? AND t."updatedAt"=? AND t."entryFeeCents"=0
      AND t."status" IN ('REGISTRATION','CHECK_IN')
      AND (t."registrationOpensAt" IS NULL OR t."registrationOpensAt"<=?)
      AND (t."registrationClosesAt" IS NULL OR t."registrationClosesAt">=?)
      AND u."emailVerifiedAt" IS NOT NULL AND u."bannedAt" IS NULL
      AND (
        (t."teamSize"=1 AND ? IS NULL AND json_array_length(?)=1
          AND json_extract(?,'$[0].userId')=u."id" AND json_extract(?,'$[0].role')='starter')
        OR
        (t."teamSize">1 AND EXISTS (SELECT 1 FROM "Team" tm JOIN "TeamMember" captain ON captain."teamId"=tm."id"
          WHERE tm."id"=? AND tm."deletedAt" IS NULL AND captain."userId"=u."id"
          AND (captain."role"='CAPTAIN' OR u."role"='ADMIN' OR ?=1))
          AND (SELECT COUNT(*) FROM json_each(?) WHERE json_extract(value,'$.role')='starter')=t."teamSize"
          AND (SELECT COUNT(*) FROM json_each(?) WHERE json_extract(value,'$.role')='sub')<=t."maxSubs"
          AND EXISTS (SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.userId')=u."id")
          AND NOT EXISTS (SELECT 1 FROM json_each(?) r WHERE NOT EXISTS (
            SELECT 1 FROM "TeamMember" m WHERE m."teamId"=? AND m."userId"=json_extract(r.value,'$.userId'))))
      )
      AND NOT EXISTS (SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$.role') NOT IN ('starter','sub')
        OR NOT EXISTS (SELECT 1 FROM "User" player JOIN "GameAccount" ga ON ga."userId"=player."id"
          WHERE player."id"=json_extract(r.value,'$.userId') AND player."bannedAt" IS NULL
          AND ga."gameId"=t."gameId" AND ga."handle"=json_extract(r.value,'$.handle')
          AND (t."platform" IS NULL OR t."platform"='Todas' OR json_extract(ga."data",'$.platform') IS NULL
            OR json_extract(ga."data",'$.platform')=t."platform")))
  `).bind(id, input.teamId, input.name, input.tag, input.now, rosterJson, JSON.stringify(input.customAnswers), input.now,
    input.actorId, input.tournamentId, input.tournamentUpdatedAt, input.now, input.now,
    input.teamId, rosterJson, rosterJson, rosterJson, input.teamId, input.actorIsAdmin ? 1 : 0, rosterJson, rosterJson, rosterJson, rosterJson, input.teamId, rosterJson);
  const statements = [reserve];
  for (const member of input.roster) statements.push(db.prepare(`
    INSERT INTO "RosterEntry" ("id","participantId","tournamentId","userId","role")
    SELECT ?,"id","tournamentId",?,? FROM "Participant" WHERE "id"=?
  `).bind(randomUUID(), member.userId, member.role, id));
  statements.push(db.prepare(`
    INSERT INTO "AuditLog" ("id","actorId","action","entity","entityId","meta","createdAt")
    SELECT ?,?, 'participant.register','Tournament',"tournamentId",
      json_object('participantId',"id",'status',"status"),? FROM "Participant" WHERE "id"=?
  `).bind(randomUUID(), input.actorId, input.now, id));
  statements.push(db.prepare('SELECT "id","status" FROM "Participant" WHERE "id"=?').bind(id));
  try {
    const result = await db.batch(statements);
    const participant = result[result.length - 1]?.results?.[0];
    if (!participant) throw new Error("As condições da inscrição mudaram. Atualize a página e tente novamente.");
    return participant as { id: string; status: string };
  } catch (error) {
    // A concurrent retry for this same user can be answered from the committed row.
    // A conflicting roster for another user has no row here and remains an error.
    const committed = await db.prepare('SELECT "id","status" FROM "Participant" WHERE "tournamentId"=? AND "userId"=?')
      .bind(input.tournamentId, input.actorId).first<{ id: string; status: string }>();
    if (committed && ['REGISTERED','CHECKED_IN','WAITLIST'].includes(committed.status)) return committed;
    throw error;
  }
}
