import {applyD1Schema} from './helpers/d1-schema.mjs';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
import {commitFreeRegistration} from './src/server/d1/free-registration';
import {changeD1CheckIn,withdrawD1FreeRegistration} from './src/server/d1/registration-lifecycle';
export default {async fetch(request,env){try{const input=await request.json();const path=new URL(request.url).pathname;
if(path==='/checkin'){await changeD1CheckIn(env.DB,input);return Response.json({ok:true});}
if(path==='/withdraw'){await withdrawD1FreeRegistration(env.DB,input);return Response.json({ok:true});}
return Response.json(await commitFreeRegistration(env.DB,input));}catch(e){return Response.json({error:e.message},{status:409});}}}`},bundle:true,write:false,format:'esm',platform:'browser',external:['node:*']});
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],script:bundle.outputFiles[0].text});
try{
 const db=await mf.getD1Database('DB');
 await applyD1Schema(db);
 await db.prepare('INSERT INTO Organization(id,slug,name) VALUES (?,?,?)').bind('org','org','Prime').run();
 for(let i=0;i<21;i++){
  const id='u'+i;
  await db.prepare('INSERT INTO User(id,email,username,displayName,passwordHash,emailVerifiedAt,updatedAt) VALUES (?,?,?,?,?,?,?)').bind(id,id+'@example.com',id,id,'hash',1,1).run();
  await db.prepare('INSERT INTO GameAccount(id,userId,gameId,handle,data,updatedAt) VALUES (?,?,?,?,?,?)').bind('g'+i,id,'game',id,'{}',1).run();
 }
 const tournament=async(id,max=3,teamSize=1)=>db.prepare('INSERT INTO Tournament(id,orgId,slug,name,gameId,modeId,status,startsAt,maxParticipants,seedSalt,updatedAt,teamSize) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'org',id,id,'game','mode','REGISTRATION',100,max,'salt',1,teamSize).run();
 const input=(t,user,extra={})=>({tournamentId:t,tournamentUpdatedAt:1,actorId:user,teamId:null,name:user,tag:null,roster:[{userId:user,role:'starter',handle:user}],customAnswers:{},now:10,...extra});
 const commit=async(data,path='')=>{const r=await mf.dispatchFetch('https://runtime.invalid'+path,{method:'POST',body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
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
 const participant=results.find(x=>x.data.status==='REGISTERED').data;
 const owner=(await db.prepare('SELECT userId FROM Participant WHERE id=?').bind(participant.id).first()).userId;
 const life={participantId:participant.id,actorId:owner,actorIsAdmin:false,now:20};
 assert.equal((await commit(life,'/checkin')).status,409);
 await db.prepare("UPDATE Tournament SET status='CHECK_IN' WHERE id='solo'").run();
 assert.equal((await commit({...life,actorId:'u20'},'/checkin')).status,409);
 assert.equal((await commit(life,'/checkin')).status,200);
 assert.equal((await commit({...life,undo:true},'/checkin')).status,200);
 await db.prepare("CREATE TRIGGER fail_withdraw BEFORE INSERT ON AuditLog WHEN NEW.action='participant.withdraw' BEGIN SELECT RAISE(ABORT,'injected failure'); END").run();
 assert.equal((await commit(life,'/withdraw')).status,409);assert.equal(await count('Participant','solo'),20);
 await db.prepare('DROP TRIGGER fail_withdraw').run();
 assert.equal((await commit(life,'/withdraw')).status,200);assert.equal(await count('Participant','solo'),19);
 assert.equal((await db.prepare("SELECT count(*) n FROM Participant WHERE tournamentId='solo' AND status='REGISTERED'").first()).n,3);
 assert.equal((await db.prepare("SELECT count(*) n FROM Notification WHERE kind='waitlist.promoted'").first()).n,1);
 assert.equal((await commit(life,'/withdraw')).status,200);
 assert.equal((await db.prepare("SELECT count(*) n FROM Notification WHERE kind='waitlist.promoted'").first()).n,1);
 console.log('PASS: capacity 3/20 concurrent; idempotency; cross-team roster conflict; rollback including audit; stale and banned authorization; check-in; atomic withdrawal/waitlist promotion and rollback.');
}finally{await mf.dispose();}
