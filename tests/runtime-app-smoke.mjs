import {applyD1Schema} from './helpers/d1-schema.mjs';
import {Miniflare} from 'miniflare';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const entry=process.env.WORKER_BUNDLE_PATH??'.sites-runtime/worker/worker.js';
const root=path.dirname(entry);
const modules=[{type:'ESModule',path:entry},...readdirSync(root).filter(n=>n.endsWith('.wasm')).map(n=>({type:'CompiledWasm',path:path.join(root,n)}))];
const mf=new Miniflare({routes:["primearena1.com.br/*"],modules,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{APP_URL:'https://primearena1.com.br',APP_SECRET:'local-runtime-probe-only-000000000000000000000000000000',ADMIN_EMAILS:'admin@example.com',AUTH_PROVIDER:'chatgpt',CHATGPT_ADMIN_USER_IDS:'runtime-admin',MAIL_FROM:'Prime <test@primearena1.com.br>',RESEND_API_KEY:'local-probe-no-email',TRUST_PROXY:'false',WALLET_ENABLED:'false',PAYMENTS_PROVIDER:'none'}});
try {
 const base=(await mf.ready).origin;
 const db=await mf.getD1Database('DB');
 await applyD1Schema(db);
 for(const route of ['/entrar','/cadastro','/viradao','/api/viradao']){
  const r=await mf.dispatchFetch(base+route);assert.equal(r.status,200,route);await r.text();
 }
 const r=await mf.dispatchFetch(base+'/cadastro',{headers:{'oai-authenticated-user-id':'runtime-user','oai-authenticated-user-email':'runtime@example.com'}});
 assert.equal(r.status,200,'authenticated profile lookup');const html=await r.text();assert.match(html,/usuário|perfil/i);
 const decode=s=>s.replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
 const fd=new FormData();
 for(const tag of html.match(/<input[^>]*>/g)??[]){const name=/name="([^"]+)"/.exec(tag)?.[1],value=/value="([^"]*)"/.exec(tag)?.[1];if(name?.startsWith('$ACTION'))fd.append(decode(name),decode(value??''));}
 assert([...fd.keys()].some(k=>k.startsWith('$ACTION')),'server action metadata');
 fd.set('username','runtimeplayer');fd.set('displayName','Runtime Player');fd.set('terms','on');fd.set('next','/conta');
 const encoded=new Request(base+'/cadastro',{method:'POST',body:fd});
 const submit=await mf.dispatchFetch(base+'/cadastro',{method:'POST',redirect:'manual',headers:{'content-type':encoded.headers.get('content-type'),origin:base,'oai-authenticated-user-id':'runtime-user','oai-authenticated-user-email':'runtime@example.com'},body:await encoded.arrayBuffer()});
await submit.text();assert.equal(submit.status,303,'profile server action');
 assert.equal((await db.prepare('SELECT count(*) n FROM ChatGPTIdentity').first()).n,1);
 const account=await mf.dispatchFetch(base+'/conta',{headers:{'oai-authenticated-user-id':'runtime-user','oai-authenticated-user-email':'runtime@example.com'}});
 assert.equal(account.status,200,'authenticated account');assert.match(await account.text(),/Runtime Player/);
 // A trusted Site subject, not its e-mail, bootstraps the administrator.
 await db.prepare("INSERT INTO User(id,email,username,displayName,passwordHash,emailVerifiedAt,createdAt,updatedAt) VALUES ('admin','admin@example.com','runtimeadmin','Runtime Admin','chatgpt-only:test',1,1,1)").run();
 await db.prepare("INSERT INTO ChatGPTIdentity(subject,userId,createdAt) VALUES ('runtime-admin','admin',1)").run();
 const adminHeaders={'oai-authenticated-user-id':'runtime-admin','oai-authenticated-user-email':'admin@example.com'};
 const adminPage=await mf.dispatchFetch(base+'/admin/usuarios',{headers:adminHeaders});assert.equal(adminPage.status,200);
 const adminHtml=await adminPage.text();
 const roleForm=(adminHtml.match(/<form[\s\S]*?<\/form>/g)??[]).find(form=>form.includes('name="role" value="ORGANIZER"'));
 assert(roleForm,'organizer promotion form');
 const promote=new FormData();
 for(const tag of roleForm.match(/<input[^>]*>/g)??[]){const name=/name="([^"]+)"/.exec(tag)?.[1],value=/value="([^"]*)"/.exec(tag)?.[1];if(name)promote.append(decode(name),decode(value??''));}
 const promoteRequest=new Request(base+'/admin/usuarios',{method:'POST',body:promote});
 const promotionBody=await promoteRequest.arrayBuffer();
 const postHeaders={...adminHeaders,origin:base,'content-type':promoteRequest.headers.get('content-type')};
 const rejected=await mf.dispatchFetch(base+'/admin/usuarios',{method:'POST',redirect:'manual',headers:{...postHeaders,'oai-authenticated-user-id':'runtime-user','oai-authenticated-user-email':'runtime@example.com'},body:promotionBody});
 assert(rejected.status>=400,'regular user cannot promote through the admin action');await rejected.text();
 assert.equal((await db.prepare("SELECT role FROM User WHERE username='runtimeplayer'").first()).role,'USER');
 const promoted=await mf.dispatchFetch(base+'/admin/usuarios',{method:'POST',redirect:'manual',headers:postHeaders,body:promotionBody});
 assert.equal(promoted.status,303,'admin role server action');await promoted.text();
 assert.equal((await db.prepare("SELECT role FROM User WHERE username='runtimeplayer'").first()).role,'ORGANIZER');
 assert.equal((await db.prepare("SELECT count(*) n FROM AuditLog WHERE action='user.role'").first()).n,1);
 const config=await mf.dispatchFetch(base+'/admin/configuracoes',{headers:adminHeaders});assert.equal(config.status,200);
 const configHtml=await config.text();
 const configForm=(configHtml.match(/<form[\s\S]*?<\/form>/g)??[]).find(f=>f.includes('name="required" value="off"'));assert(configForm,'withdraw approval setting');
 const configData=new FormData();for(const tag of configForm.match(/<input[^>]*>/g)??[]){const name=/name="([^"]+)"/.exec(tag)?.[1],value=/value="([^"]*)"/.exec(tag)?.[1];if(name)configData.append(decode(name),decode(value??''));}
 const configRequest=new Request(base+'/admin/configuracoes',{method:'POST',body:configData});
 const configResponse=await mf.dispatchFetch(base+'/admin/configuracoes',{method:'POST',redirect:'manual',headers:{...adminHeaders,origin:base,'content-type':configRequest.headers.get('content-type')},body:await configRequest.arrayBuffer()});
 await configResponse.text();assert.equal(configResponse.status,303,'settings server action');
 assert.equal((await db.prepare("SELECT value FROM SiteSetting WHERE key='withdraw.requireAdminApproval'").first()).value,'false');
 assert.equal((await db.prepare("SELECT count(*) n FROM AuditLog WHERE action='settings.withdraw_admin_approval'").first()).n,1);
 await db.prepare("INSERT INTO Organization(id,slug,name) VALUES ('real-org','real-org','Real Org')").run();
 await db.prepare("INSERT INTO Tournament(id,orgId,slug,name,gameId,modeId,status,startsAt,maxParticipants,seedSalt,updatedAt,requireCheckIn) VALUES ('real-t','real-org','real-t','Real Tournament','sf6','1v1','REGISTRATION',1900000000000,8,'seed',1,0)").run();
 await db.prepare('INSERT INTO Stage(id,tournamentId,"order",name,type,settings) VALUES (?,?,?,?,?,?)').bind('real-stage','real-t',1,'Final','SINGLE_ELIMINATION',JSON.stringify({type:'SINGLE_ELIMINATION',bestOf:{default:3},thirdPlaceMatch:false})).run();
 const playerId=(await db.prepare("SELECT id FROM User WHERE username='runtimeplayer'").first()).id;
 for(const [id,userId] of [['real-a','admin'],['real-b',playerId]])await db.prepare('INSERT INTO Participant(id,tournamentId,userId,name,status,roster) VALUES (?,?,?,?,?,?)').bind(id,'real-t',userId,id,'REGISTERED','[]').run();
 const manage=await mf.dispatchFetch(base+'/organizar/real-t',{headers:adminHeaders});assert.equal(manage.status,200);const manageHtml=await manage.text();
 const startForm=(manageHtml.match(/<form[\s\S]*?<\/form>/g)??[]).find(f=>f.includes('Iniciar campeonato e gerar chaves'));assert(startForm,'start tournament form');
 const startData=new FormData();for(const tag of startForm.match(/<input[^>]*>/g)??[]){const name=/name="([^"]+)"/.exec(tag)?.[1],value=/value="([^"]*)"/.exec(tag)?.[1];if(name)startData.append(decode(name),decode(value??''));}
 const startRequest=new Request(base+'/organizar/real-t',{method:'POST',body:startData});
 const started=await mf.dispatchFetch(base+'/organizar/real-t',{method:'POST',redirect:'manual',headers:{...adminHeaders,origin:base,'content-type':startRequest.headers.get('content-type')},body:await startRequest.arrayBuffer()});
 await started.text();assert(started.status<400,'start action response');
 assert.equal((await db.prepare("SELECT status FROM Tournament WHERE id='real-t'").first()).status,'LIVE');
 assert.equal((await db.prepare("SELECT count(*) n FROM Match WHERE stageId='real-stage' AND status='READY'").first()).n,1);
 console.log('PASS: packaged Next Worker, anonymous login/profile/Viradão/API and authenticated profile creation through a real Server Action and account lookup on D1; admin page and actual role action; forged admin action denied; actual settings and tournament-start actions, bracket on D1.');
} finally {await mf.dispose();}
