import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createViradaoHandlers} from '../src/server/viradao-service.ts';
function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const f of fs.readdirSync(new URL('../migration/legacy/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(new URL('../migration/legacy/'+f,import.meta.url),'utf8'));
 const db={prepare(q){let args=[];return{bind(...v){args=v;return this;},async first(){return sql.prepare(q).get(...args)??null;},async all(){return{results:sql.prepare(q).all(...args)};},async run(){return{meta:{changes:sql.prepare(q).run(...args).changes}};}};}};
 const files=new Map();let who={admin:true,signedIn:true};
 const api=createViradaoHandlers({database:()=>db,identity:async()=>who,bucket:()=>({async put(k,b){files.set(k,b);},async get(k){return files.has(k)?{body:files.get(k)}:null;},async delete(k){files.delete(k);}})});
 const post=(body,origin='https://arena.test')=>api.post(new Request('https://arena.test/api/viradao',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const get=(id,extra='')=>api.get(new Request('https://arena.test/api/viradao?event='+id+extra));
 const receipt=(id,body,version=1,origin='https://arena.test')=>api.receipt(new Request('https://arena.test/api/viradao/comprovante?id='+id,body?{method:'POST',headers:{origin,'X-Record-Version':String(version)},body}:{}));
 return{sql,files,post,get,receipt,as:x=>who=x,async seed(){const e=await(await post({action:'createEvent',title:'Viradão',startsAt:'2026-10-10T22:00:00.000Z'})).json();const p=await(await post({action:'add',eventId:e.id,name:'Ana',nick:'Player',payment:'at_door'})).json();return{event:e.id,id:p.id};}};
}
test('público e usuário comum só recebem nome e nick; escrita e comprovantes são restritos',async()=>{
 const f=setup(),{event,id}=await f.seed();
 for(const who of [{admin:false,signedIn:false},{admin:false,signedIn:true}]){f.as(who);const r=await f.get(event),data=await r.json();assert.deepEqual(data.participants,[{name:'Ana',nick:'Player'}]);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await f.post({action:'remove',id,version:1})).status,403);assert.equal((await f.receipt(id)).status,403);assert.equal((await f.receipt(id,new Uint8Array([1]))).status,403);}
 f.as({admin:true,signedIn:true});assert.deepEqual((await(await f.get(event,'&public=1')).json()).participants,[{name:'Ana',nick:'Player'}]);
});
test('edição usa versão e remove sem apagar; restauração preserva pagamento',async()=>{
 const f=setup(),{event,id}=await f.seed();assert.equal((await f.post({action:'edit',id,version:1,name:'Ana',nick:'Novo',payment:'paid'})).status,200);
 assert.equal((await f.post({action:'edit',id,version:1,name:'Ana',nick:'Antigo',payment:'unpaid'})).status,409);
 assert.equal((await f.post({action:'remove',id,version:2})).status,200);assert.deepEqual((await(await f.get(event,'&public=1')).json()).participants,[]);
 assert.equal((await f.post({action:'restore',id,version:3})).status,200);const p=(await(await f.get(event)).json()).participants[0];assert.equal(p.payment,'paid');assert.equal(p.nick,'Novo');assert.equal(p.version,4);
});
test('comprovante privado, download seguro, tamanho e conteúdo validados',async()=>{
 const f=setup(),{event,id}=await f.seed();const pdf=new TextEncoder().encode('%PDF-1.4\n test');
 assert.equal((await f.receipt(id,pdf,1,'https://evil.test')).status,403);assert.equal((await f.receipt(id,new TextEncoder().encode('<svg/>'))).status,400);
 assert.equal((await f.receipt(id,new Uint8Array(5*1024*1024+1))).status,413);assert.equal(f.files.size,0);
 assert.equal((await f.receipt(id,pdf)).status,200);const p=(await(await f.get(event)).json()).participants[0];assert.equal(p.hasReceipt,true);assert.equal(p.payment,'at_door');assert.equal('receipt_key' in p,false);
 const download=await f.receipt(id);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await download.arrayBuffer()),pdf);
 assert.equal((await f.receipt(id,pdf,1)).status,409);assert.equal(f.files.size,1);
});
test('eventos separados, entrada inválida e origem externa rejeitadas',async()=>{
 const f=setup(),a=await f.seed(),b=await f.seed();assert.notEqual(a.event,b.event);assert.equal((await(await f.get(a.event)).json()).participants.length,1);
 assert.equal((await f.post({action:'add',eventId:a.event,name:'A',nick:'N',payment:'invalid'})).status,400);
 assert.equal((await f.post({action:'remove',id:a.id,version:1},'https://evil.test')).status,403);
 assert.equal((await f.get(crypto.randomUUID())).status,404);
});
