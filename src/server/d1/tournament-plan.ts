import { randomUUID } from 'node:crypto';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { AppError } from '@/lib/errors';

/** Raw SQLite values, never Prisma transaction emulation. Calculations happen on a
 * consistent read snapshot; a single guarded batch compares the complete read set
 * before writing the plan. A concurrent change aborts every write. */
export type Row = Record<string, string | number | null>;
const scopes = {
  Tournament: 'id=?',
  Stage: 'tournamentId=?',
  Participant: 'tournamentId=?',
  Match: 'stageId IN (SELECT id FROM Stage WHERE tournamentId=?)',
  MatchDispute: 'matchId IN (SELECT id FROM Match WHERE stageId IN (SELECT id FROM Stage WHERE tournamentId=?))',
  OrgMember: 'orgId IN (SELECT orgId FROM Tournament WHERE id=?)',
  BrGame: 'stageId IN (SELECT id FROM Stage WHERE tournamentId=?)',
  BrResult: 'gameId IN (SELECT id FROM BrGame WHERE stageId IN (SELECT id FROM Stage WHERE tournamentId=?))',
  PrizeAward: 'tournamentId=?',
} as const;
export type Table = keyof typeof scopes;
export type State = Record<Table, Row[]>;
const tables = Object.keys(scopes) as Table[];
const quote = (s:string) => {if(!/^[A-Za-z][A-Za-z0-9]*$/.test(s))throw new Error('Invalid SQL identifier');return '"'+s+'"';};
const equal = (a:Row,b:Row) => JSON.stringify(a)===JSON.stringify(b);

export class TournamentPlan {
  readonly before:State;
  readonly state:State;
  readonly notifications:Row[]=[];
  readonly audits:Row[]=[];
  readonly dropped:string[]=[];
  readonly now=Date.now();
  private constructor(readonly db:D1Database,readonly id:string,state:State){this.before=state;this.state=structuredClone(state);}
  static async load(db:D1Database,id:string){
    const result=await db.batch<Row>(tables.map(t=>db.prepare(`SELECT * FROM ${quote(t)} WHERE ${scopes[t]} ORDER BY id`).bind(id)));
    const state=Object.fromEntries(tables.map((t,i)=>[t,result[i].results])) as State;
    if(state.Tournament.length!==1)throw new AppError('Campeonato não encontrado.','NOT_FOUND');
    return new TournamentPlan(db,id,state);
  }
  get tournament(){return this.state.Tournament[0];}
  row(table:Table,id:string):Row {const r=this.state[table].find(r=>r.id===id);if(!r)throw new AppError('Registro não encontrado.','NOT_FOUND');return r;}
  notify(users:string[],kind:string,title:string,body:string,href:string){
    for(const userId of new Set(users))this.notifications.push({id:randomUUID(),userId,kind,title,body,href,createdAt:this.now});
  }
  audit(actorId:string,action:string,entity:string,entityId:string,meta:unknown={}){
    this.audits.push({id:randomUUID(),actorId,action,entity,entityId,meta:JSON.stringify(meta),createdAt:this.now});
  }
  async commit(actor:{id:string;isAdmin:boolean},level:'admin'|'staff'|'participant',participantId?:string){
    const membership=level==='admin'?"u.role='ORGANIZER' AND m.role IN ('OWNER','ADMIN')":"(u.role='ORGANIZER' OR m.role='STAFF')";
    const authorization=level==='participant'?
      `EXISTS (SELECT 1 FROM Participant p WHERE p.id=? AND p.tournamentId=t.id AND p.userId=u.id)`:
      `(?=1 OR (o.deletedAt IS NULL AND EXISTS (SELECT 1 FROM OrgMember m WHERE m.orgId=o.id AND m.userId=u.id AND ${membership})))`;
    const statements:D1PreparedStatement[]=[this.db.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM Tournament t JOIN Organization o ON o.id=t.orgId JOIN User u ON u.id=?
      WHERE t.id=? AND t.entryFeeCents=0 AND u.bannedAt IS NULL AND ${authorization}
        AND NOT EXISTS (SELECT 1 FROM "Order" WHERE tournamentId=t.id)
      ) THEN 1 ELSE json('tournament-plan-permission-conflict') END`).bind(actor.id,this.id,level==='participant'?participantId??'':actor.isAdmin?1:0)];
    // Check before *any* mutation, including additions/deletions (phantoms).
    for(const table of tables){
      const rows=this.before[table];
      if(!rows.length){statements.push(this.db.prepare(`SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ${quote(table)} WHERE ${scopes[table]}) THEN 1 ELSE json('tournament-plan-conflict') END`).bind(this.id));continue;}
      const columns=Object.keys(rows[0]);
      const object=columns.map(c=>`'${c}',${quote(c)}`).join(',');
      statements.push(this.db.prepare(`SELECT CASE WHEN (SELECT json_group_array(json_object(${object})) FROM
        (SELECT * FROM ${quote(table)} WHERE ${scopes[table]} ORDER BY id))=? THEN 1 ELSE json('tournament-plan-conflict') END`)
        .bind(this.id,JSON.stringify(rows)));
    }
    this.tournament.updatedAt=Math.max(Number(this.tournament.updatedAt)+1,this.now);
    // Child removals precede parent removals; inserts use the inverse FK order.
    for(const table of [...tables].reverse()){
      const current=new Set(this.state[table].map(r=>r.id));const removed=this.before[table].filter(r=>!current.has(r.id)).map(r=>r.id);
      if(removed.length)statements.push(this.db.prepare(`DELETE FROM ${quote(table)} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(removed)));
    }
    for(const table of tables){
      const old=new Map(this.before[table].map(r=>[r.id,r]));
      const added=this.state[table].filter(r=>!old.has(r.id));
      statements.push(...this.inserts(table,added));
      const changed=this.state[table].filter(r=>old.has(r.id)&&!equal(old.get(r.id)!,r));
      // One statement per column shape, not one query per match/participant.
      for(const group of this.groups(changed)){
        const cols=Object.keys(group[0]).filter(c=>c!=='id');
        statements.push(this.db.prepare(`WITH changes AS MATERIALIZED (SELECT value FROM json_each(?)) UPDATE ${quote(table)} SET
          ${cols.map(c=>`${quote(c)}=(SELECT json_extract(value,'$.${c}') FROM changes WHERE json_extract(value,'$.id')=${quote(table)}.id)`).join(',')}
          WHERE id IN (SELECT json_extract(value,'$.id') FROM changes)`).bind(JSON.stringify(group)));
      }
    }
    if(this.dropped.length)statements.push(this.db.prepare(`DELETE FROM RosterEntry WHERE participantId IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(this.dropped)));
    statements.push(...this.inserts('Notification',this.notifications),...this.inserts('AuditLog',this.audits));
    await this.db.batch(statements);
  }
  private groups(rows:Row[]):Row[][] {
    const groups=new Map<string,Row[]>();
    for(const row of rows){const key=Object.keys(row).sort().join(',');const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
    return [...groups.values()];
  }
  private inserts(table:string,rows:Row[]):D1PreparedStatement[]{
    return this.groups(rows).map(group=>{
      const cols=Object.keys(group[0]);
      return this.db.prepare(`INSERT INTO ${quote(table)} (${cols.map(quote).join(',')})
        SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(group));
    });
  }
}
