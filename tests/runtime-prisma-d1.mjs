import {applyD1Schema} from './helpers/d1-schema.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
import {PrismaClient} from '@primearena/prisma-worker/wasm.js';
import {guardedAdapter} from './src/lib/d1-prisma-adapter';
import {createD1ChatGPTProfile} from './src/server/d1/chatgpt-profile';
import {createD1Team,createD1Organization} from './src/server/d1/create-groups';
import {saveD1GameAccount} from './src/server/d1/game-account';
import {createD1Tournament,transitionD1Tournament} from './src/server/d1/tournaments';
import {reserveD1RateLimit} from './src/server/d1/rate-limit';
export default {async fetch(request,env){try{
 const db=new PrismaClient({adapter:guardedAdapter(env.DB)});
 const path=new URL(request.url).pathname;
 if(path==='/profile')return Response.json(await createD1ChatGPTProfile(env.DB,await request.json()));
 if(path==='/game')return Response.json(await saveD1GameAccount(env.DB,await request.json()));
 if(path==='/tournament'){const i=await request.json();return Response.json(await createD1Tournament(env.DB,i.actor,i.data,i.stages));}
 if(path==='/publish'){await transitionD1Tournament(env.DB,await request.json());return Response.json({ok:true});}
 if(path==='/team')return Response.json(await createD1Team(env.DB,await request.json()));
 if(path==='/org')return Response.json(await createD1Organization(env.DB,await request.json()));
 if(path==='/limit'){const i=await request.json();return Response.json(await reserveD1RateLimit(env.DB,i.key,i.limit,i.seconds,i.now));}
 if(path==='/read')return Response.json(await db.user.findMany({include:{chatgptIdentity:true}}));
 if(path==='/date')return Response.json(await db.user.count({where:{createdAt:{lt:new Date(2000)}}}));
 if(path==='/transaction')return Response.json(await db.$transaction(async tx=>tx.siteSetting.create({data:{key:'must-not-exist',value:'test'}})));
 if(path==='/nested')return Response.json(await db.user.create({data:{email:'nested@example.com',username:'nested',displayName:'Nested',passwordHash:'invalid',chatgptIdentity:{create:{subject:'nested'}}}}));
 return new Response('not found',{status:404});
 }catch(error){return Response.json({error:error.message},{status:409});}}};`},bundle:true,write:false,format:'esm',platform:'browser',conditions:['workerd'],external:['node:*'],plugins:[{name:'wasm',setup(b){b.onResolve({filter:/\.wasm(?:\?module)?$/},()=>({path:'./compiler.wasm',external:true}));}}]});
const mf=new Miniflare({modules:[{type:'ESModule',path:'worker.js',contents:bundle.outputFiles[0].text},{type:'CompiledWasm',path:'compiler.wasm',contents:readFileSync('node_modules/@primearena/prisma-worker/query_compiler_bg.wasm')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']});
try{
 const db=await mf.getD1Database('DB');
 await applyD1Schema(db);
 const call=async(path,input)=>{const r=await mf.dispatchFetch('https://runtime.invalid'+path,input?{method:'POST',body:JSON.stringify(input)}:{});return{status:r.status,data:await r.json()};};
 const profile=(n,subject=n)=>({subject,email:n+'@example.com',username:n,displayName:n,passwordHash:'chatgpt-only:invalid',now:1000});
 const first=await call('/profile',profile('one'));assert.equal(first.status,200);
 const read=await call('/read');assert.equal(read.status,200);assert.equal(read.data[0].createdAt,'1970-01-01T00:00:01.000Z');assert.equal(read.data[0].chatgptIdentity.subject,'one');
 assert.equal((await call('/date')).data,1);
 assert.equal((await call('/profile',profile('duplicate','one'))).status,409);
 assert.equal((await db.prepare('SELECT count(*) n FROM User').first()).n,1);
 const concurrent=await Promise.all(Array.from({length:10},()=>call('/profile',profile('race'))));assert.equal(concurrent.filter(r=>r.status===200).length,1);
 for(const path of ['/transaction','/nested']){const r=await call(path);assert.equal(r.status,409);assert.match(r.data.error,/batch D1|does not support interactive transactions/);}
 assert.equal((await db.prepare("SELECT count(*) n FROM User WHERE username='nested'").first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM SiteSetting').first()).n,0);
 const org={actorId:first.data,isAdmin:false,name:'Prime',slug:'prime',description:null};
 assert.equal((await call('/org',org)).status,409);
 assert.equal((await db.prepare('SELECT count(*) n FROM Organization').first()).n,0);
 assert.equal((await call('/org',{...org,isAdmin:true})).status,200);
 assert.equal((await db.prepare('SELECT count(*) n FROM OrgMember').first()).n,1);
 assert.equal((await call('/team',{actorId:first.data,name:'Prime',tag:'PR',slug:'prime',description:null,gameId:null})).status,200);
 assert.equal((await db.prepare('SELECT count(*) n FROM TeamMember').first()).n,1);
 await db.prepare("CREATE TRIGGER fail_org_audit BEFORE INSERT ON AuditLog WHEN NEW.action='org.create' BEGIN SELECT RAISE(ABORT,'injected failure'); END").run();
 assert.equal((await call('/org',{...org,isAdmin:true,slug:'rollback'})).status,409);
 assert.equal((await db.prepare('SELECT count(*) n FROM Organization').first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM OrgMember').first()).n,1);
 const attempts=await Promise.all(Array.from({length:30},()=>call('/limit',{key:'test',limit:5,seconds:10,now:1000})));
 assert.equal(attempts.filter(r=>r.data===true).length,5);
 assert.equal((await call('/limit',{key:'test',limit:5,seconds:10,now:11000})).data,true);
 const claims=await Promise.all([first.data,(await db.prepare("SELECT id FROM User WHERE username='race'").first()).id].map(userId=>call('/game',{userId,gameId:'game',handle:'shared',data:{platform:'PC'}})));
 assert.equal(claims.filter(r=>r.status===200).length,1);
 const orgId=(await db.prepare('SELECT id FROM Organization').first()).id;
 const tournament={actor:{id:first.data,role:'ADMIN'},data:{orgId,slug:'arena',name:'Arena',gameId:'game',modeId:'solo',visibility:'PUBLIC',startsAt:100000,minParticipants:2,maxParticipants:3,teamSize:1,maxSubs:0,entryFeeCents:0,prizePoolCents:0,prizeSplit:[],allowPlayerReporting:true,requireCheckIn:true,seedingMethod:'RANDOM',seedSalt:'test',customFields:[]},stages:[{name:'Final',settings:{type:'SINGLE_ELIMINATION'}}]};
 assert.equal((await call('/tournament',{...tournament,actor:{id:first.data,role:'USER'}})).status,409);
 const created=await call('/tournament',tournament);assert.equal(created.status,200,JSON.stringify(created));
 const t=await db.prepare('SELECT * FROM Tournament WHERE id=?').bind(created.data).first();
 const transition={actorId:first.data,actorIsAdmin:true,tournamentId:t.id,updatedAt:t.updatedAt,checkIn:false,now:100};
 const publishing=await Promise.all(Array.from({length:10},()=>call('/publish',transition)));
 assert.equal(publishing.filter(r=>r.status===200).length,1);
 assert.equal((await db.prepare("SELECT count(*) n FROM AuditLog WHERE action='tournament.publish'").first()).n,1);
 await db.prepare("CREATE TRIGGER fail_tournament BEFORE INSERT ON AuditLog WHEN NEW.action='tournament.create' BEGIN SELECT RAISE(ABORT,'injected failure'); END").run();
 assert.equal((await call('/tournament',{...tournament,data:{...tournament.data,slug:'rollback'}})).status,409);
 assert.equal((await db.prepare('SELECT count(*) n FROM Tournament').first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM Stage').first()).n,1);
 console.log('PASS: Prisma WASM D1 reads/dates; atomic profile, team and organization; concurrent profile and rate limits; rollback; unique game identities; tournament creation/publication races and rollback; unsupported transactions fail before writes.');
}finally{await mf.dispose();}
