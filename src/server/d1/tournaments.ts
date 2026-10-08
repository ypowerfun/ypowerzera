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
