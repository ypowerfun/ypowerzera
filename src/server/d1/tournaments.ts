import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";

const columns = ['orgId','slug','name','gameId','modeId','presetId','visibility','summary','description','rules','region','platform',
  'streamUrl','discordUrl','startsAt','registrationOpensAt','registrationClosesAt','checkInOpensAt','checkInClosesAt',
  'minParticipants','maxParticipants','teamSize','maxSubs','entryFeeCents','prizePoolCents','prizeSplit','allowPlayerReporting',
  'requireCheckIn','seedingMethod','seedSalt','customFields','mapPool'] as const;
function value(input: unknown): string | number | null {
  if(input == null) return null;
  if(input instanceof Date) return input.getTime();
  if(typeof input === 'boolean') return input?1:0;
  if(typeof input === 'object') return JSON.stringify(input);
  if(typeof input === 'string' || typeof input === 'number') return input;
  throw new Error('Valor inválido no campeonato.');
}
const access = (level: 'admin'|'staff') => `(?=1 OR (o.deletedAt IS NULL AND EXISTS (SELECT 1 FROM OrgMember m WHERE m.orgId=o.id
  AND m.userId=u.id AND ${level === 'admin' ? "u.role='ORGANIZER' AND m.role IN ('OWNER','ADMIN')" : "(u.role='ORGANIZER' OR m.role='STAFF')"})))`;

export async function createD1Tournament(db: D1Database, actor: {id:string;role:string}, data: Prisma.TournamentUncheckedCreateInput,
  stages: Array<{name:string;settings:{type:string}}>) {
  if(data.entryFeeCents !== 0) throw new AppError('Nesta fase, os campeonatos devem ser gratuitos.');
  const id=randomUUID(),now=Date.now();
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Organization o JOIN User u ON u.id=?
      WHERE o.id=? AND o.deletedAt IS NULL AND u.bannedAt IS NULL AND ${access('admin')})
      THEN 1 ELSE json('tournament-permission-conflict') END`).bind(actor.id,data.orgId,actor.role==='ADMIN'?1:0),
    db.prepare(`INSERT INTO Tournament(id,${columns.map(c=>'"'+c+'"').join(',')},createdAt,updatedAt)
      VALUES (${Array(columns.length+3).fill('?').join(',')})`).bind(id,...columns.map(c=>value(data[c])),now,now),
    ...stages.map((s,i)=>db.prepare('INSERT INTO Stage(id,tournamentId,"order",name,type,settings) VALUES (?,?,?,?,?,?)')
      .bind(randomUUID(),id,i+1,s.name,s.settings.type,JSON.stringify(s.settings))),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,'tournament.create','Tournament',?,?,?)`)
      .bind(randomUUID(),actor.id,id,JSON.stringify({name:data.name}),now),
  ]);
  return id;
}

export async function transitionD1Tournament(db: D1Database, input: {
  actorId:string;actorIsAdmin:boolean;tournamentId:string;updatedAt:number;checkIn:boolean;now?:number;
}) {
  const now=input.now??Date.now(),from=input.checkIn?'REGISTRATION':'DRAFT',to=input.checkIn?'CHECK_IN':'REGISTRATION';
  const condition=input.checkIn?'1':`t.startsAt>? AND EXISTS (SELECT 1 FROM Stage s WHERE s.tournamentId=t.id)`;
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Tournament t JOIN Organization o ON o.id=t.orgId
      JOIN User u ON u.id=? WHERE t.id=? AND t.updatedAt=? AND t.status=? AND t.entryFeeCents=0 AND u.bannedAt IS NULL
      AND ${access(input.checkIn?'staff':'admin')} AND ${condition}) THEN 1 ELSE json('tournament-transition-conflict') END`)
      .bind(input.actorId,input.tournamentId,input.updatedAt,from,input.actorIsAdmin?1:0,...(input.checkIn?[]:[now])),
    db.prepare(`UPDATE Tournament SET status=?,updatedAt=MAX(updatedAt+1,?),publishedAt=CASE WHEN ?='REGISTRATION' THEN ? ELSE publishedAt END WHERE id=?`)
      .bind(to,now,to,now,input.tournamentId),
    ...(input.checkIn?[db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
      SELECT ?||p.id,p.userId,'checkin.open','Check-in aberto','Faça o check-in em '||t.name||' para garantir sua vaga.',
      '/torneios/'||t.slug,? FROM Participant p JOIN Tournament t ON t.id=p.tournamentId WHERE t.id=? AND p.status='REGISTERED'`)
      .bind(randomUUID()+':',now,input.tournamentId)]:[]),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,?,'Tournament',?,'{}',?)`)
      .bind(randomUUID(),input.actorId,input.checkIn?'tournament.checkin_open':'tournament.publish',input.tournamentId,now),
  ]);
}

export async function updateD1Tournament(db:D1Database,input:{actorId:string;actorIsAdmin:boolean;tournamentId:string;updatedAt:number;
  data:Prisma.TournamentUpdateInput;fields:string[];stages?:Array<{name:string;settings:{type:string}}>;prizeChanged:boolean}) {
  const entries=Object.entries(input.data).filter(([,v])=>v!==undefined);
  for(const [k] of entries)if(!(columns as readonly string[]).includes(k))throw new AppError('Campo de campeonato inválido.');
  if(input.data.entryFeeCents!==undefined && input.data.entryFeeCents!==0)throw new AppError('Nesta fase, os campeonatos devem ser gratuitos.');
  const structural=['stages','entryFeeCents','maxParticipants','minParticipants','seedingMethod','requireCheckIn'];
  const max=input.data.maxParticipants, pool=input.data.prizePoolCents;
  const now=Date.now();
  const statements=[db.prepare(`SELECT CASE WHEN EXISTS (
    SELECT 1 FROM Tournament t JOIN Organization o ON o.id=t.orgId JOIN User u ON u.id=?
    WHERE t.id=? AND t.updatedAt=? AND t.status IN ('DRAFT','REGISTRATION','CHECK_IN','LIVE') AND t.entryFeeCents=0
      AND u.bannedAt IS NULL AND ${access('admin')} AND (?=0 OR t.status<>'LIVE')
      AND (SELECT count(*) FROM Participant WHERE tournamentId=t.id AND status IN ('REGISTERED','CHECKED_IN','PENDING_PAYMENT'))<=COALESCE(?,t.maxParticipants)
      AND ((?=0 AND COALESCE(?,t.prizePoolCents)>=t.prizePoolCents) OR NOT EXISTS (
        SELECT 1 FROM Participant WHERE tournamentId=t.id AND status IN ('REGISTERED','CHECKED_IN','PENDING_PAYMENT','WAITLIST')))
  ) THEN 1 ELSE json('tournament-update-conflict') END`).bind(input.actorId,input.tournamentId,input.updatedAt,input.actorIsAdmin?1:0,
    input.fields.some(f=>structural.includes(f))?1:0,value(max),input.prizeChanged?1:0,value(pool))];
  statements.push(db.prepare(`UPDATE Tournament SET ${entries.map(([k])=>'"'+k+'"=?').concat('updatedAt=MAX(updatedAt+1,?)').join(',')} WHERE id=?`)
    .bind(...entries.map(([,v])=>value(v)),now,input.tournamentId));
  if(input.stages){
    statements.push(db.prepare(`DELETE FROM Stage WHERE tournamentId=?`).bind(input.tournamentId));
    statements.push(...input.stages.map((s,i)=>db.prepare(`INSERT INTO Stage(id,tournamentId,"order",name,type,settings) VALUES (?,?,?,?,?,?)`)
      .bind(randomUUID(),input.tournamentId,i+1,s.name,s.settings.type,JSON.stringify(s.settings))));
  }
  statements.push(db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,'tournament.update','Tournament',?,?,?)`)
    .bind(randomUUID(),input.actorId,input.tournamentId,JSON.stringify({fields:input.fields}),now));
  await db.batch(statements);
}

export async function cancelD1FreeTournament(db:D1Database,input:{actorId:string;actorIsAdmin:boolean;tournamentId:string;updatedAt:number;reason:string}) {
  const now=Date.now();
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Tournament t JOIN Organization o ON o.id=t.orgId JOIN User u ON u.id=?
      WHERE t.id=? AND t.updatedAt=? AND t.status NOT IN ('COMPLETED','CANCELED') AND t.entryFeeCents=0 AND u.bannedAt IS NULL
      AND ${access('admin')} AND NOT EXISTS (SELECT 1 FROM "Order" WHERE tournamentId=t.id AND status IN ('PAID','PARTIALLY_REFUNDED')))
      THEN 1 ELSE json('tournament-cancel-conflict') END`).bind(input.actorId,input.tournamentId,input.updatedAt,input.actorIsAdmin?1:0),
    db.prepare(`UPDATE Tournament SET status='CANCELED',updatedAt=MAX(updatedAt+1,?) WHERE id=?`).bind(now,input.tournamentId),
    db.prepare(`UPDATE "Order" SET status='CANCELED',updatedAt=? WHERE tournamentId=? AND status='PENDING'`).bind(now,input.tournamentId),
    db.prepare(`INSERT INTO Notification(id,userId,kind,title,body,href,createdAt)
      SELECT ?||p.id,p.userId,'tournament.canceled','Campeonato cancelado',t.name||' foi cancelado: '||?,
      '/torneios/'||t.slug,? FROM Participant p JOIN Tournament t ON t.id=p.tournamentId WHERE t.id=?`)
      .bind(randomUUID()+':',input.reason.trim(),now,input.tournamentId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,meta,createdAt) VALUES (?,?,'tournament.cancel','Tournament',?,?,?)`)
      .bind(randomUUID(),input.actorId,input.tournamentId,JSON.stringify({reason:input.reason,refundFailures:[]}),now),
  ]);
  return {refundFailures:[] as string[]};
}

export async function deleteD1Draft(db:D1Database,input:{actorId:string;actorIsAdmin:boolean;tournamentId:string;updatedAt:number}) {
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Tournament t JOIN Organization o ON o.id=t.orgId JOIN User u ON u.id=?
      WHERE t.id=? AND t.updatedAt=? AND t.status='DRAFT' AND u.bannedAt IS NULL AND ${access('admin')}
      AND NOT EXISTS (SELECT 1 FROM Participant WHERE tournamentId=t.id) AND NOT EXISTS (SELECT 1 FROM "Order" WHERE tournamentId=t.id))
      THEN 1 ELSE json('tournament-delete-conflict') END`).bind(input.actorId,input.tournamentId,input.updatedAt,input.actorIsAdmin?1:0),
    db.prepare(`DELETE FROM Tournament WHERE id=?`).bind(input.tournamentId),
    db.prepare(`INSERT INTO AuditLog(id,actorId,action,entity,entityId,createdAt) VALUES (?,?,'tournament.delete','Tournament',?,?)`)
      .bind(randomUUID(),input.actorId,input.tournamentId,Date.now()),
  ]);
}

export async function seedD1Tournament(db:D1Database,input:{actorId:string;actorIsAdmin:boolean;tournamentId:string;updatedAt:number;
  participants:Array<{id:string;status:string;seed:number|null;rating:number|null}>;ordered:string[]}) {
  const snapshot=JSON.stringify([...input.participants].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(p=>[p.id,p.status,p.seed,p.rating]));
  await db.batch([
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Tournament t JOIN Organization o ON o.id=t.orgId JOIN User u ON u.id=?
      WHERE t.id=? AND t.updatedAt=? AND t.status IN ('DRAFT','REGISTRATION','CHECK_IN') AND u.bannedAt IS NULL AND ${access('staff')})
      AND (SELECT json_group_array(json_array(id,status,seed,rating)) FROM (SELECT id,status,seed,rating FROM Participant
        WHERE tournamentId=? AND status IN ('REGISTERED','CHECKED_IN') ORDER BY id))=?
      THEN 1 ELSE json('tournament-seeding-conflict') END`).bind(input.actorId,input.tournamentId,input.updatedAt,input.actorIsAdmin?1:0,input.tournamentId,snapshot),
    ...input.ordered.map((id,i)=>db.prepare('UPDATE Participant SET seed=? WHERE id=? AND tournamentId=?').bind(i+1,id,input.tournamentId)),
    db.prepare(`UPDATE Tournament SET updatedAt=MAX(updatedAt+1,?) WHERE id=?`).bind(Date.now(),input.tournamentId),
  ]);
}
