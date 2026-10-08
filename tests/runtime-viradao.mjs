import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
const { outputFiles } = await build({ stdin: { contents: `import {createViradaoHandlers} from './src/server/viradao-service.ts';
export default {async fetch(request,env){
const who=request.headers.get('x-test-role');
const api=createViradaoHandlers({database:()=>env.DB,bucket:()=>env.BUCKET,identity:async()=>({signedIn:!!who,admin:who==='admin'})});
return new URL(request.url).pathname.endsWith('/comprovante')?api.receipt(request):request.method==='POST'?api.post(request):api.get(request);
}};`, resolveDir: process.cwd(), sourcefile: 'test-viradao-worker.ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', d1Databases: ['DB'], r2Buckets: ['BUCKET'], script: outputFiles[0].text });
try {
 const db=await mf.getD1Database('DB');
 for(const sql of readFileSync('migration/legacy/0002_viradao.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const post=async body=>mf.dispatchFetch('https://arena.test/api/viradao',{method:'POST',headers:{origin:'https://arena.test','content-type':'application/json','x-test-role':'admin'},body:JSON.stringify(body)});
 const event=await(await post({action:'createEvent',title:'Viradão original',startsAt:'2026-10-10T22:00:00.000Z'})).json();
 let participant;
 for(let i=0;i<9;i++)participant=await(await post({action:'add',eventId:event.id,name:`Pessoa ${i}`,nick:`Nick ${i}`,payment:'paid'})).json();
 const publicResponse=await mf.dispatchFetch(`https://arena.test/api/viradao?event=${event.id}`),pub=await publicResponse.json();
 assert.equal(pub.participants.length,9);assert.deepEqual(Object.keys(pub.participants[0]).sort(),['name','nick']);
 assert.equal((await mf.dispatchFetch('https://arena.test/api/viradao',{method:'POST',headers:{origin:'https://arena.test','content-type':'application/json'},body:JSON.stringify({action:'remove',id:participant.id,version:1})})).status,403);
 const edits=await Promise.all(Array.from({length:12},(_,i)=>post({action:'edit',id:participant.id,version:1,name:'Pessoa',nick:`Corrida ${i}`,payment:'at_door'})));
 assert.equal(edits.filter(r=>r.status===200).length,1);assert.equal(edits.filter(r=>r.status===409).length,11);
 const receiptUrl=`https://arena.test/api/viradao/comprovante?id=${participant.id}`;
 assert.equal((await mf.dispatchFetch(receiptUrl)).status,403);
 const headers={origin:'https://arena.test','x-test-role':'admin','x-record-version':'2'};
 assert.equal((await mf.dispatchFetch(receiptUrl,{method:'POST',headers,body:'<svg>bad</svg>'})).status,400);
 assert.equal((await mf.dispatchFetch(receiptUrl,{method:'POST',headers,body:'%PDF-1.4\nproof'})).status,200);
 const download=await mf.dispatchFetch(receiptUrl,{headers:{'x-test-role':'admin'}});
 assert.equal(download.status,200);assert.equal(await download.text(),'%PDF-1.4\nproof');assert.match(download.headers.get('content-disposition'),/^attachment/);
 assert.equal((await post({action:'remove',id:participant.id,version:3})).status,200);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM viradao_participants').first()).n,9);
 assert.equal((await post({action:'restore',id:participant.id,version:4})).status,200);
 const row=await db.prepare('SELECT payment,receipt_key FROM viradao_participants WHERE id=?').bind(participant.id).first();assert.equal(row.payment,'at_door');assert.ok(row.receipt_key);
 console.log('PASS Worker/D1/R2: 9 records preserved; public projection; authorization; 12 simultaneous edits; private receipt; remove/restore without deletion.');
} finally { await mf.dispose(); }
