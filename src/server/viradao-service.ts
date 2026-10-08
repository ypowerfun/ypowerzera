import { z } from 'zod';

export interface ViradaoStatement {
 bind(...values: unknown[]): ViradaoStatement;
 first<T = Record<string, unknown>>(): Promise<T | null>;
 all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
 run(): Promise<{ meta: { changes: number } }>;
}
export interface ViradaoDatabase { prepare(query: string): ViradaoStatement }
export interface ViradaoBucket {
 get(key: string): Promise<{ body: BodyInit } | null>;
 put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
 delete(key: string): Promise<unknown>;
}
type Identity = { admin: boolean; signedIn: boolean };
type Dependencies = { database:()=>ViradaoDatabase; bucket:()=>ViradaoBucket; identity:()=>Promise<Identity> };
type Participant = {id:string;event_id:string;name:string;nick:string;payment:string;receipt_key:string|null;receipt_type:string|null;removed_at:string|null;version:number;created_at:string;updated_at:string};
const text=z.string().trim().min(1).max(120), id=z.string().uuid();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('createEvent'),title:text,startsAt:z.string().datetime()}),
 z.object({action:z.literal('add'),eventId:id,name:text,nick:text,payment:z.enum(['paid','unpaid','at_door'])}),
 z.object({action:z.literal('edit'),id,version:z.number().int().positive(),name:text,nick:text,payment:z.enum(['paid','unpaid','at_door'])}),
 z.object({action:z.literal('remove'),id,version:z.number().int().positive()}),
 z.object({action:z.literal('restore'),id,version:z.number().int().positive()}),
]);
class ApiError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
const headers={'Cache-Control':'private, no-store','Vary':'Cookie, oai-authenticated-user-id, oai-authenticated-user-email','X-Content-Type-Options':'nosniff'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
function fail(e:unknown){if(e instanceof ApiError)return reply({error:e.message},e.status);if(e instanceof z.ZodError||e instanceof SyntaxError)return reply({error:'Confira os campos informados.'},400);console.error('Viradao operation failed');return reply({error:'Não foi possível salvar ou carregar agora. Seus campos foram mantidos; tente novamente.'},503);}
const adminParticipant=(p:Participant)=>({id:p.id,name:p.name,nick:p.nick,payment:p.payment,hasReceipt:!!p.receipt_key,removedAt:p.removed_at,version:p.version});
function origin(request:Request){if(request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError('Origem inválida.',403);}
async function requireAdmin(d:Dependencies){if(!(await d.identity()).admin)throw new ApiError('Acesso restrito à organização.',403);}
async function limitedBody(request:Request,limit:number){
 if(Number(request.headers.get('content-length')??0)>limit)throw new ApiError('Arquivo ou formulário muito grande.',413);
 if(!request.body)return new Uint8Array();const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new ApiError('Arquivo ou formulário muito grande.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export function receiptType(bytes:Uint8Array){
 const starts=(a:number[])=>a.every((n,i)=>bytes[i]===n);
 if(starts([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))return 'image/png';
 if(starts([0xff,0xd8,0xff]))return 'image/jpeg';
 if(starts([0x25,0x50,0x44,0x46,0x2d]))return 'application/pdf';
 if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';
 throw new ApiError('Envie um comprovante em JPG, PNG, WebP ou PDF.');
}
export function createViradaoHandlers(d:Dependencies){
 return {
  async get(request:Request){try{
   const who=await d.identity(),url=new URL(request.url),db=d.database();
   // Explicit public projection: payment and receipt metadata never enter public JSON.
   const admin=who.admin&&url.searchParams.get('public')!=='1';
   const {results:events}=await db.prepare(`SELECT e.id,e.title,e.starts_at AS startsAt,
    (SELECT count(*) FROM viradao_participants p WHERE p.event_id=e.id AND p.removed_at IS NULL) AS count
    FROM viradao_events e ORDER BY e.starts_at DESC`).all();
   const eventId=url.searchParams.get('event');
   if(!eventId)return reply({events,admin,signedIn:who.signedIn});
   if(!id.safeParse(eventId).success)throw new ApiError('Viradão inválido.');
   const event=events.find(e=>e.id===eventId);if(!event)throw new ApiError('Viradão não encontrado.',404);
   if(admin){const {results}=await db.prepare('SELECT * FROM viradao_participants WHERE event_id=? ORDER BY created_at,id').bind(eventId).all<Participant>();return reply({events,event,participants:results.map(adminParticipant),admin,signedIn:who.signedIn});}
   const {results}=await db.prepare('SELECT name,nick FROM viradao_participants WHERE event_id=? AND removed_at IS NULL ORDER BY created_at,id').bind(eventId).all();
   return reply({events,event,participants:results,admin:false,signedIn:who.signedIn});
  }catch(e){return fail(e);}},
  async post(request:Request){try{
   origin(request);await requireAdmin(d);
   if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError('Formato inválido.',415);
   const b=schema.parse(JSON.parse(new TextDecoder().decode(await limitedBody(request,4096)))),db=d.database(),now=new Date().toISOString();
   if(b.action==='createEvent'){const eventId=crypto.randomUUID();await db.prepare('INSERT INTO viradao_events (id,title,starts_at,created_at) VALUES (?,?,?,?)').bind(eventId,b.title,b.startsAt,now).run();return reply({id:eventId},201);}
   if(b.action==='add'){
    if(!await db.prepare('SELECT id FROM viradao_events WHERE id=?').bind(b.eventId).first())throw new ApiError('Viradão não encontrado.',404);
    const participantId=crypto.randomUUID();await db.prepare('INSERT INTO viradao_participants (id,event_id,name,nick,payment,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(participantId,b.eventId,b.name,b.nick,b.payment,now,now).run();return reply({id:participantId},201);
   }
   const result=b.action==='edit'
    ?await db.prepare('UPDATE viradao_participants SET name=?,nick=?,payment=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND removed_at IS NULL').bind(b.name,b.nick,b.payment,now,b.id,b.version).run()
    :await db.prepare('UPDATE viradao_participants SET removed_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?').bind(b.action==='remove'?now:null,now,b.id,b.version).run();
   if(!result.meta.changes)throw new ApiError('Esta inscrição mudou. Atualize a lista antes de tentar novamente.',409);
   return reply({ok:true});
  }catch(e){return fail(e);}},
  async receipt(request:Request){try{
   await requireAdmin(d);if(request.method==='POST')origin(request);
   const participantId=new URL(request.url).searchParams.get('id');if(!id.safeParse(participantId).success)throw new ApiError('Inscrição inválida.');
   const db=d.database(),p=await db.prepare('SELECT * FROM viradao_participants WHERE id=?').bind(participantId).first<Participant>();if(!p)throw new ApiError('Inscrição não encontrada.',404);
   const bucket=d.bucket();
   if(request.method==='GET'){
    if(!p.receipt_key)throw new ApiError('Nenhum comprovante anexado.',404);
    const object=await bucket.get(p.receipt_key);if(!object)throw new ApiError('Comprovante indisponível. Contate a organização.',404);
    const type=p.receipt_type??'application/octet-stream',ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'} as Record<string,string>)[type]??'bin';
    return new Response(object.body,{headers:{...headers,'Content-Type':type,'Content-Disposition':`attachment; filename="comprovante.${ext}"`,'Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}});
   }
   if(p.removed_at)throw new ApiError('Restaure a inscrição antes de anexar um comprovante.');
   const version=Number(request.headers.get('x-record-version'));if(!Number.isSafeInteger(version)||version!==p.version)throw new ApiError('Esta inscrição mudou. Atualize a lista antes de anexar.',409);
   const bytes=await limitedBody(request,5*1024*1024);if(!bytes.length)throw new ApiError('Selecione um arquivo.');
   const type=receiptType(bytes),key=`viradao/${p.event_id}/${p.id}/${crypto.randomUUID()}`;
   await bucket.put(key,bytes,{httpMetadata:{contentType:type}});
   try{
    const saved=await db.prepare('UPDATE viradao_participants SET receipt_key=?,receipt_type=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND removed_at IS NULL').bind(key,type,new Date().toISOString(),p.id,version).run();
    if(!saved.meta.changes)throw new ApiError('Esta inscrição mudou. Atualize a lista e tente novamente.',409);
   }catch(e){await bucket.delete(key);throw e;}
   // The old receipt remains privately stored; replacing it never destroys a prior proof.
   return reply({ok:true});
  }catch(e){return fail(e);}},
 };
}
