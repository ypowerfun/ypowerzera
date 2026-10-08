import {applyD1Schema} from './helpers/d1-schema.mjs';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const entry=process.env.WORKER_BUNDLE_PATH??'.sites-runtime/worker/worker.js';
const root=path.dirname(entry);
const modules=[{type:'ESModule',path:entry},...readdirSync(root).filter(n=>n.endsWith('.wasm')).map(n=>({type:'CompiledWasm',path:path.join(root,n)}))];
const mf=new Miniflare({routes:["primearena1.com.br/*"],modules,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{APP_URL:'https://primearena1.com.br',APP_SECRET:'local-runtime-probe-only-000000000000000000000000000000',ADMIN_EMAILS:'admin@example.com',AUTH_PROVIDER:'chatgpt',CHATGPT_ADMIN_USER_IDS:'runtime-admin',MAIL_FROM:'Prime <test@primearena1.com.br>',RESEND_API_KEY:'local-probe-no-email',TRUST_PROXY:'false',WALLET_ENABLED:'false',PAYMENTS_PROVIDER:'none'}});
try {
 const db=await mf.getD1Database('DB');
 await applyD1Schema(db);
 for(const route of ['/entrar','/cadastro','/viradao','/api/viradao']){
  const r=await (await mf.getWorker()).fetch('https://primearena1.com.br'+route);assert.equal(r.status,200,route);await r.text();
 }
 const r=await (await mf.getWorker()).fetch('https://primearena1.com.br/cadastro',{headers:{'oai-authenticated-user-id':'runtime-user','oai-authenticated-user-email':'runtime@example.com'}});
 assert.equal(r.status,200,'authenticated profile lookup');const html=await r.text();assert.match(html,/usuário|perfil/i);
 const decode=s=>s.replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
 const fd=new FormData();
 for(const tag of html.match(/<input[^>]*>/g)??[]){const name=/name="([^"]+)"/.exec(tag)?.[1],value=/value="([^"]*)"/.exec(tag)?.[1];if(name?.startsWith('$ACTION'))fd.append(decode(name),decode(value??''));}
 assert([...fd.keys()].some(k=>k.startsWith('$ACTION')),'server action metadata');
 fd.set('username','runtimeplayer');fd.set('displayName','Runtime Player');fd.set('terms','on');fd.set('next','/conta');
 const encoded=new Request('https://primearena1.com.br/cadastro',{method:'POST',body:fd});
 const submit=await (await mf.getWorker()).fetch('https://primearena1.com.br/cadastro',{method:'POST',headers:{host:'primearena1.com.br','x-forwarded-host':'primearena1.com.br','content-type':encoded.headers.get('content-type'),origin:'https://primearena1.com.br','oai-authenticated-user-id':'runtime-user','oai-authenticated-user-email':'runtime@example.com'},body:await encoded.arrayBuffer()});
 const submittedHtml=await submit.text();if(submit.status!==303)writeFileSync('../smoke-response.html',submittedHtml);assert.equal(submit.status,303,'profile server action');
 assert.equal((await db.prepare('SELECT count(*) n FROM ChatGPTIdentity').first()).n,1);
 const account=await (await mf.getWorker()).fetch('https://primearena1.com.br/conta',{headers:{'oai-authenticated-user-id':'runtime-user','oai-authenticated-user-email':'runtime@example.com'}});
 assert.equal(account.status,200,'authenticated account');assert.match(await account.text(),/Runtime Player/);
 console.log('PASS: packaged Next Worker, anonymous login/profile/Viradão/API and authenticated profile creation through a real Server Action and account lookup on D1.');
} finally {await mf.dispose();}
