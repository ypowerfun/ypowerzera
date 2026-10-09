import {applyD1Schema} from './helpers/d1-schema.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
import {startD1Tournament,startD1NextStage} from './src/server/d1/tournament-start';
import {TournamentPlan} from './src/server/d1/tournament-plan';
import {submitD1BrResults} from './src/server/d1/leaderboard';
import {disqualifyD1Participant} from './src/server/d1/participant-management';
import {getPreset} from './src/games';
import {resultD1Match,reportD1Match,disputeD1Match} from './src/server/d1/matches';
import {syncPlannedStage} from './src/server/d1/stage-plan';
export default {async fetch(request,env){try{const input=await request.json();const path=new URL(request.url).pathname;
if(path==='/preset')return Response.json(getPreset(input.game,input.preset));
else if(path==='/br')await submitD1BrResults(env.DB,input.actor,input.gameId,input.rows,input.opts);
else if(path==='/dq')await disqualifyD1Participant(env.DB,input.actor,input.participantId,'No show');
else if(path==='/start')await startD1Tournament(env.DB,input.actor,input.id);
else if(path==='/next')await startD1NextStage(env.DB,input.actor,input.id);
else if(path==='/report')return Response.json(await reportD1Match(env.DB,input.actor,input.matchId,input.a,input.b));
else if(path==='/dispute')await disputeD1Match(env.DB,input.actor,input.matchId,input.reason);
else if(!input.stale)await resultD1Match(env.DB,input.actor,input.matchId,{scoreA:1,scoreB:0,reset:input.reset});
else {const p=await TournamentPlan.load(env.DB,input.id);const m=p.row('Match',input.matchId);
Object.assign(m,{status:'COMPLETED',scoreA:1,scoreB:0,winnerSide:'a',completedAt:p.now});syncPlannedStage(p,String(m.stageId));
if(input.stale)await env.DB.prepare('UPDATE Participant SET rating=42 WHERE id=?').bind(m.participantAId).run();
await p.commit({id:input.actor.id,isAdmin:false},'staff');}
return Response.json({ok:true});}catch(e){return Response.json({error:e.message},{status:409});}}}`},bundle:true,write:false,format:'esm',platform:'browser',external:['node:*']});
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],script:bundle.outputFiles[0].text});
try{
 const db=await mf.getD1Database('DB');await applyD1Schema(db);
 for(let i=0;i<6;i++)await db.prepare('INSERT INTO User(id,email,username,displayName,passwordHash,emailVerifiedAt,updatedAt,role) VALUES (?,?,?,?,?,?,?,?)').bind('u'+i,`u${i}@example.com`,'u'+i,'User '+i,'hash',1,1,i===0?'ORGANIZER':'USER').run();
 await db.prepare("INSERT INTO Organization(id,slug,name) VALUES ('o','org','Org')").run();
 await db.prepare("INSERT INTO OrgMember(id,orgId,userId,role) VALUES ('m','o','u0','OWNER')").run();
 const make=async(id,count=4)=>{
  await db.prepare('INSERT INTO Tournament(id,orgId,slug,name,gameId,modeId,status,startsAt,maxParticipants,seedSalt,updatedAt,requireCheckIn,prizePoolCents,prizeSplit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'o',id,id,'g','m','REGISTRATION',100,8,'s',1,0,10001,JSON.stringify([{placement:1,label:'Winner',percent:100}])).run();
  await db.prepare('INSERT INTO Stage(id,tournamentId,"order",name,type,settings) VALUES (?,?,?,?,?,?)').bind(id+'s',id,1,'Final','SINGLE_ELIMINATION',JSON.stringify({type:'SINGLE_ELIMINATION',bestOf:{default:1},thirdPlaceMatch:false})).run();
  for(let i=1;i<=count;i++)await db.prepare('INSERT INTO Participant(id,tournamentId,userId,name,status,roster) VALUES (?,?,?,?,?,?)').bind(id+'p'+i,id,'u'+i,'Player '+i,'REGISTERED','[]').run();
 };
 const call=async(path,input)=>{const r=await mf.dispatchFetch('https://runtime.invalid'+path,{method:'POST',body:JSON.stringify({actor:{id:'u0',role:'ORGANIZER'},...input})});return {status:r.status,data:await r.json()};};
 await make('t');
 await db.prepare("CREATE TRIGGER fail_start BEFORE INSERT ON AuditLog WHEN NEW.action='tournament.start' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 let r=await call('/start',{id:'t'});assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) n FROM Match").first()).n,0);
 assert.equal((await db.prepare("SELECT status FROM Tournament WHERE id='t'").first()).status,'REGISTRATION');
 await db.prepare('DROP TRIGGER fail_start').run();
 const starts=await Promise.all(Array.from({length:6},()=>call('/start',{id:'t'})));
 assert.equal(starts.filter(x=>x.status===200).length,1,JSON.stringify(starts));
 assert.equal((await db.prepare("SELECT count(*) n FROM Match").first()).n,3);
 let ready=(await db.prepare("SELECT * FROM Match WHERE status='READY' ORDER BY id").all()).results;
 r=await call('/score',{id:'t',matchId:ready[0].id,stale:true});assert.equal(r.status,409,JSON.stringify(r));
 assert.equal((await db.prepare('SELECT status FROM Match WHERE id=?').bind(ready[0].id).first()).status,'READY');
 for(const m of ready){r=await call('/score',{id:'t',matchId:m.id});assert.equal(r.status,200,JSON.stringify(r));}
 ready=(await db.prepare("SELECT * FROM Match WHERE status='READY'").all()).results;assert.equal(ready.length,1);
 r=await call('/score',{id:'t',matchId:ready[0].id});assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await db.prepare("SELECT status FROM Tournament WHERE id='t'").first()).status,'COMPLETED');
 assert.equal((await db.prepare("SELECT amountCents FROM PrizeAward WHERE tournamentId='t'").first()).amountCents,10001);
 assert.equal((await db.prepare("SELECT count(*) n FROM Participant WHERE tournamentId='t' AND finalPlacement IS NOT NULL").first()).n,4);
 await make('reports',4);r=await call('/start',{id:'reports'});assert.equal(r.status,200,JSON.stringify(r));
 const m=await db.prepare("SELECT m.*,a.userId actorA,b.userId actorB FROM Match m JOIN Participant a ON a.id=m.participantAId JOIN Participant b ON b.id=m.participantBId WHERE m.stageId='reportss' AND m.status='READY' LIMIT 1").first();
 assert.equal((await call('/report',{matchId:m.id,actor:{id:'u0',role:'ORGANIZER'},a:1,b:0})).status,409);
 r=await call('/report',{matchId:m.id,actor:{id:m.actorA,role:'USER'},a:1,b:0});assert.equal(r.data,'reported');
 r=await call('/report',{matchId:m.id,actor:{id:m.actorB,role:'USER'},a:0,b:1});assert.equal(r.data,'disputed');
 assert.equal((await db.prepare('SELECT count(*) n FROM MatchDispute WHERE matchId=?').bind(m.id).first()).n,1);
 r=await call('/dispute',{matchId:m.id,actor:{id:m.actorB,role:'USER'},reason:'Additional explanation'});assert.equal(r.status,200,JSON.stringify(r));
 await db.prepare("CREATE TRIGGER fail_result BEFORE INSERT ON AuditLog WHEN NEW.action='match.set_result' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await call('/score',{matchId:m.id})).status,409);
 assert.equal((await db.prepare('SELECT status FROM MatchDispute WHERE matchId=?').bind(m.id).first()).status,'OPEN');
 await db.prepare('DROP TRIGGER fail_result').run();
 r=await call('/score',{matchId:m.id});assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await db.prepare('SELECT status FROM MatchDispute WHERE matchId=?').bind(m.id).first()).status,'RESOLVED');
 r=await call('/score',{matchId:m.id,reset:true});assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await db.prepare('SELECT status FROM Match WHERE id=?').bind(m.id).first()).status,'READY');
 const configs=[
 ['double',{type:'DOUBLE_ELIMINATION',bestOf:{default:1},grandFinalReset:true}],
 ['robin',{type:'ROUND_ROBIN',groups:1,legs:1,bestOf:1,allowDraw:false,points:{win:3,draw:1,loss:0},tiebreakers:['points','seed'],groupAssignment:'snake'}],
 ['swiss',{type:'SWISS',mode:'rounds',rounds:2,bestOf:1,allowDraw:false,points:{win:1,draw:0,loss:0},tiebreakers:['points','buchholz','seed'],advancement:{count:2}}],
 ['gsl',{type:'GSL',bestOf:1,groupAssignment:'snake',advancement:{count:2}}],
 ];
 for(const [id,settings] of configs){
  await make(id);await db.prepare('UPDATE Stage SET type=?,settings=? WHERE tournamentId=?').bind(settings.type,JSON.stringify(settings),id).run();
  if(id==='swiss')await db.prepare('INSERT INTO Stage(id,tournamentId,"order",name,type,settings) VALUES (?,?,?,?,?,?)').bind('swiss-final',id,2,'Final','SINGLE_ELIMINATION',JSON.stringify({type:'SINGLE_ELIMINATION',bestOf:{default:1},thirdPlaceMatch:false})).run();
  r=await call('/start',{id});assert.equal(r.status,200,JSON.stringify(r));
  for(let step=0;step<30;step++){
   const pending=(await db.prepare("SELECT m.id FROM Match m JOIN Stage s ON s.id=m.stageId WHERE s.tournamentId=? AND m.status='READY'").bind(id).all()).results;
   if(!pending.length){
    const status=(await db.prepare('SELECT status FROM Tournament WHERE id=?').bind(id).first()).status;
    if(status==='COMPLETED')break;
    r=await call('/next',{id});assert.equal(r.status,200,JSON.stringify(r));continue;
   }
   for(const m of pending){r=await call('/score',{matchId:m.id});assert.equal(r.status,200,JSON.stringify(r));}
  }
  assert.equal((await db.prepare('SELECT status FROM Tournament WHERE id=?').bind(id).first()).status,'COMPLETED',id);
 }
 await make('br');const preset=await call('/preset',{game:'fortnite',preset:'fortnite.session'});
 const settings=preset.data.stages[0].settings;
 await db.prepare('UPDATE Stage SET type=?,settings=? WHERE tournamentId=?').bind('LEADERBOARD',JSON.stringify(settings),'br').run();
 r=await call('/start',{id:'br'});assert.equal(r.status,200,JSON.stringify(r));
 for(let round=1;round<=settings.games;round++){
  const games=(await db.prepare('SELECT * FROM BrGame WHERE stageId=? AND round=?').bind('brs',round).all()).results;assert(games.length>0);
  for(const g of games){
   const rows=JSON.parse(g.participantIds).map((id,i)=>({participantId:id,placement:i+1,kills:4-i}));
   if(round===1){assert.equal((await call('/br',{gameId:g.id,rows:rows.slice(1)})).status,409);assert.equal((await call('/br',{gameId:g.id,rows,actor:{id:'u1',role:'USER'}})).status,409);}
   r=await call('/br',{gameId:g.id,rows});assert.equal(r.status,200,JSON.stringify(r));
  }
 }
 assert.equal((await db.prepare("SELECT status FROM Tournament WHERE id='br'").first()).status,'COMPLETED');
 await make('dq');r=await call('/start',{id:'dq'});assert.equal(r.status,200,JSON.stringify(r));
 r=await call('/dq',{participantId:'dqp1'});assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await db.prepare("SELECT count(*) n FROM Match WHERE stageId='dqs' AND forfeit IS NOT NULL").first()).n,1);
 console.log('PASS: D1 stage planning; 6 concurrent starts/one winner; whole-start rollback; stale participant snapshot rejects result; report/dispute/result/reset rollback; single/double elimination, round robin, Swiss with playoffs, GSL, leaderboard, DQ; final placements and exact-cent prize.');
}finally{await mf.dispose();}
