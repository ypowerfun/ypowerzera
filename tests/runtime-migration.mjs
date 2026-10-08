import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {applyD1Schema} from './helpers/d1-schema.mjs';
const legacy=['0000_known_joseph.sql','0001_gigantic_human_torch.sql','0002_viradao.sql'];
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
try {
 const db=await mf.getD1Database('DB');await applyD1Schema(db,legacy);
 await db.prepare('INSERT INTO tournaments(id,data,version,created_at) VALUES (?,?,?,?)').bind('legacy','{"participants":[{"nick":"Legacy"}]}',7,'2026-10-01').run();
 await db.prepare('INSERT INTO viradao_events(id,title,starts_at,created_at) VALUES (?,?,?,?)').bind('event','Viradão preservado','2026-10-09','2026-10-01').run();
 for(let i=0;i<9;i++)await db.prepare('INSERT INTO viradao_participants(id,event_id,name,nick,payment,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?)').bind('p'+i,'event','Player '+i,'nick'+i,i%2?'paid':'unpaid','2026-10-01','2026-10-01',1).run();
 const tables=['tournaments','recovery_challenges','recovery_limits','viradao_events','viradao_participants'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.prepare('SELECT * FROM "'+table+'" ORDER BY id').all()).results])));
 const before=await snapshot();
 const sql=readFileSync('drizzle/0003_prime_arena_sites.sql','utf8');assert(!/\b(DROP|ALTER|DELETE|UPDATE|INSERT)\b/i.test(sql.replace(/ON (?:DELETE|UPDATE) (?:no action|set null|cascade|restrict|set default)/gi,'')),'migration must only add schema');
 await applyD1Schema(db,['0003_prime_arena_sites.sql']);assert.deepEqual(await snapshot(),before);
 assert.equal((await db.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name IN ('User','Tournament','ChatGPTIdentity','Wallet')").first()).n,4);
 assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
 console.log('PASS: additive D1 migration preserves all five legacy tables, tournament content and nine Viradão entries; foreign keys valid.');
}finally{await mf.dispose();}
