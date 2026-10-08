import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {Miniflare} from 'miniflare';
const source=ts.transpileModule(readFileSync('src/server/d1/free-registration.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],script:source+`\nexport default {async fetch(request,env){try{return Response.json(await commitFreeRegistration(env.DB,await request.json()));}catch(e){return Response.json({error:e.message},{status:409});}}}`});
try{
 const db=await mf.getD1Database('DB');
 for(const sql of readFileSync('migration/new-models.sql','utf8').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 await db.prepare('INSERT INTO Organization(id,slug,name) VALUES (?,?,?)').bind('org','org','Prime').run();
 for(let i=0;i<21;i++){
  const id='u'+i;
  await db.prepare('INSERT INTO User(id,email,username,displayName,passwordHash,emailVerifiedAt,updatedAt) VALUES (?,?,?,?,?,?,?)').bind(id,id+'@example.com',id,id,'hash',1,1).run();
  await db.prepare('INSERT INTO GameAccount(id,userId,gameId,handle,data,updatedAt) VALUES (?,?,?,?,?,?)').bind('g'+i,id,'game',id,'{}',1).run();
 }
 const tournament=async(id,max=3,teamSize=1)=>db.prepare('INSERT INTO Tournament(id,orgId,slug,name,gameId,modeId,status,startsAt,maxParticipants,seedSalt,updatedAt,teamSize) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'org',id,id,'game','mode','REGISTRATION',100,max,'salt',1,teamSize).run();
 const input=(t,user,extra={})=>({tournamentId:t,tournamentUpdatedAt:1,actorId:user,teamId:null,name:user,tag:null,roster:[{userId:user,role:'starter',handle:user}],customAnswers:{},now:10,...extra});
 const commit=async(data)=>{const r=await mf.dispatchFetch('https://runtime.invalid',{method:'POST',body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
 const count=async(table,t)=>Number((await db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "tournamentId"=?`).bind(t).first()).n);
 await tournament('solo');
 const results=await Promise.all(Array.from({length:20},(_,i)=>commit(input('solo','u'+i))));
 assert(results.every(x=>x.status===200));
 const states=await db.prepare('SELECT status,COUNT(*) n FROM Participant WHERE tournamentId=? GROUP BY status').bind('solo').all();
 assert.equal(states.results.find(x=>x.status==='REGISTERED').n,3);assert.equal(states.results.find(x=>x.status==='WAITLIST').n,17);
 assert.equal(await count('RosterEntry','solo'),20);
 const repeated=await Promise.all(Array.from({length:12},()=>commit(input('solo','u0'))));
 assert(repeated.every(x=>x.data.id===results[0].data.id));assert.equal(await count('Participant','solo'),20);
 await tournament('team',4,2);
 for(const [team,actor] of [['a','u0'],['b','u1']]){
  await db.prepare('INSERT INTO Team(id,slug,name,tag,ownerId) VALUES (?,?,?,?,?)').bind(team,team,team,team,actor).run();
  for(const [user,role] of [[actor,'CAPTAIN'],['u20','PLAYER']])await db.prepare('INSERT INTO TeamMember(id,teamId,userId,role) VALUES (?,?,?,?)').bind(team+user,team,user,role).run();
 }
 const teamInput=(team,actor)=>input('team',actor,{teamId:team,roster:[{userId:actor,role:'starter',handle:actor},{userId:'u20',role:'starter',handle:'u20'}]});
 assert.equal((await commit(teamInput('a','u0'))).status,200);
 assert.equal((await commit(teamInput('b','u1'))).status,409);
 assert.equal(await count('Participant','team'),1);assert.equal(await count('RosterEntry','team'),2);
 const teamAudit=await db.prepare('SELECT COUNT(*) n FROM AuditLog WHERE entityId=?').bind('team').first();assert.equal(teamAudit.n,1);
 await tournament('blocked');
 assert.equal((await commit(input('blocked','u2',{tournamentUpdatedAt:2}))).status,409);
 await db.prepare('UPDATE User SET bannedAt=1 WHERE id=?').bind('u2').run();
 assert.equal((await commit(input('blocked','u2'))).status,409);assert.equal(await count('Participant','blocked'),0);
 await tournament('failure');
 await db.prepare(`CREATE TRIGGER fail_audit BEFORE INSERT ON AuditLog WHEN NEW.entityId='failure' BEGIN SELECT RAISE(ABORT,'injected failure'); END`).run();
 assert.equal((await commit(input('failure','u3'))).status,409);assert.equal(await count('Participant','failure'),0);assert.equal(await count('RosterEntry','failure'),0);
 console.log('PASS: capacity 3/20 concurrent; idempotency; cross-team roster conflict; rollback including audit; stale and banned authorization.');
}finally{await mf.dispose();}
