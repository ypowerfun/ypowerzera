"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';

type Event={id:string;title:string;startsAt:string;count:number};
type Participant={id?:string;name:string;nick:string;payment?:string;hasReceipt?:boolean;removedAt?:string|null;version?:number};
type Data={events:Event[];event?:Event;participants?:Participant[];admin:boolean;signedIn:boolean;error?:string};
const paymentText:Record<string,string>={paid:'Pago',unpaid:'Não pago',at_door:'Pagamento na hora'};
const date=(value:string)=>new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Manaus'});
export default function ViradaoApp(){
 const dialogRef=useRef<HTMLDialogElement>(null);
 const [notice,setNotice]=useState('');
 const toast={success:setNotice,error:setNotice,info:setNotice};
 const [data,setData]=useState<Data>({events:[],admin:false,signedIn:false}),[eventId,setEventId]=useState<string|null>(null),[publicView,setPublicView]=useState(false),[ready,setReady]=useState(false);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[formError,setFormError]=useState('');
 const [modal,setModal]=useState<'event'|'participant'|'receipt'|'remove'|null>(null),[editing,setEditing]=useState<Participant|null>(null),[payment,setPayment]=useState('unpaid'),[showRemoved,setShowRemoved]=useState(false);
 useEffect(()=>{const dialog=dialogRef.current;if(!dialog)return;if(modal&&!dialog.open)dialog.showModal();else if(!modal&&dialog.open)dialog.close();},[modal]);
 const [shareUrl,setShareUrl]=useState('');
 useEffect(()=>{const p=new URLSearchParams(location.search);setEventId(p.get('evento'));setPublicView(p.get('visao')==='publica');setReady(true);},[]);
 const load=useCallback(async()=>{
  if(!ready)return;
  try{const query=new URLSearchParams();if(eventId)query.set('event',eventId);if(publicView)query.set('public','1');const r=await fetch('/api/viradao?'+query,{cache:'no-store'});const result=await r.json() as Data;if(!r.ok)throw new Error(result.error);setData(result);setError('');}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível carregar a lista.');}finally{setLoading(false);}
 },[ready,eventId,publicView]);
 useEffect(()=>{load();if(!ready)return;const timer=setInterval(load,20000);return()=>clearInterval(timer);},[load,ready]);
 function select(id:string|null){setEventId(id);setShareUrl('');setLoading(true);setData(d=>({...d,event:undefined,participants:[]}));const url=new URL('/viradao',location.origin);if(id)url.searchParams.set('evento',id);if(publicView)url.searchParams.set('visao','publica');history.replaceState(null,'',url);}
 function open(kind:typeof modal,p:Participant|null=null){setEditing(p);setPayment(p?.payment??'unpaid');setFormError('');setModal(kind);}
 async function mutate(body:Record<string,unknown>){
  const r=await fetch('/api/viradao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json() as {error?:string;id?:string};if(!r.ok)throw new Error(result.error);return result;
 }
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setFormError('');const f=new FormData(e.currentTarget);
  try{
   if(modal==='event'){const result=await mutate({action:'createEvent',title:f.get('title'),startsAt:new Date(String(f.get('startsAt'))).toISOString()});setModal(null);if(result.id)select(result.id);}
   else {await mutate({action:editing?'edit':'add',eventId,id:editing?.id,version:editing?.version,name:f.get('name'),nick:f.get('nick'),payment});setModal(null);await load();}
   toast.success('Salvo.');
  }catch(e){setFormError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}
 }
 async function changePresence(p:Participant,action:'remove'|'restore'){
  setBusy(true);setFormError('');try{await mutate({action,id:p.id,version:p.version});setModal(null);await load();toast.success(action==='remove'?'Participante removido da lista pública.':'Participante restaurado.');}catch(e){const message=e instanceof Error?e.message:'Não foi possível atualizar.';setFormError(message);toast.error(message);}finally{setBusy(false);}
 }
 async function upload(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const file=new FormData(e.currentTarget).get('file');if(!(file instanceof File)||!file.size)return;setBusy(true);setFormError('');
  try{if(file.size>5*1024*1024)throw new Error('O arquivo deve ter até 5 MB.');const r=await fetch('/api/viradao/comprovante?id='+encodeURIComponent(editing!.id!),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-Record-Version':String(editing!.version)},body:file});const result=await r.json() as {error?:string};if(!r.ok)throw new Error(result.error);setModal(null);await load();toast.success('Comprovante salvo em área privada.');}catch(e){setFormError(e instanceof Error?e.message:'Não foi possível anexar.');}finally{setBusy(false);}
 }
 async function share(){const url=new URL('/viradao',location.origin);if(eventId)url.searchParams.set('evento',eventId);url.searchParams.set('visao','publica');setShareUrl(url.href);try{await navigator.clipboard.writeText(url.href);toast.success('Link público copiado. Envie no grupo do WhatsApp.');}catch{toast.info('Selecione e copie o link abaixo.');}}
 const participants=data.participants??[],active=participants.filter(p=>!p.removedAt),visible=showRemoved?participants:active;
 return <div className="app-shell viradao-shell">

 <main>
 {error&&<div className="error-banner" role="alert">{error}<button onClick={load}><span aria-hidden="true">↻</span> Tentar novamente</button></div>}
 {eventId&&<button className="text-link viradao-back" onClick={()=>select(null)}>Todos os viradões</button>}
 <div className="page-heading"><div><p className="eyebrow">PRIME ARENA / VIRADÃO</p><h1>{data.event?.title??'Viradão'}<span className="accent">.</span></h1><p className="muted">{data.event?date(data.event.startsAt)+' · Horário de Manaus':'Veja quem vai passar a noite jogando com a gente.'}</p></div><div className="heading-actions">{data.event&&<button className="button secondary" onClick={share}><span aria-hidden="true">↗</span> Copiar link público</button>}{data.admin&&<button className="button primary" disabled={busy||loading} onClick={()=>open(data.event?'participant':'event')}><span aria-hidden="true">+</span>{data.event?'Adicionar participante':'Criar viradão'}</button>}</div></div>
 {shareUrl&&<label className="field share-field"><span>Link para enviar no WhatsApp</span><input readOnly value={shareUrl} onFocus={e=>e.target.select()}/></label>}
 {loading?<div className="empty"><span aria-hidden="true">↻</span><p>Carregando…</p></div>:data.event?<>
 <div className="viradao-summary"><span><span aria-hidden="true">♟</span><strong>{active.length}</strong> participante{active.length!==1?'s':''}</span>{data.admin&&<><span className="payment-paid">{active.filter(p=>p.payment==='paid').length} pagos</span><span>{active.filter(p=>p.payment==='unpaid').length} não pagos</span><span>{active.filter(p=>p.payment==='at_door').length} pagamentos na hora</span></>}</div>
 {data.admin?<p className="muted viradao-privacy">Pagamentos e comprovantes aparecem somente para a organização. No link público são exibidos apenas nome e nick.</p>:<p className="muted viradao-privacy">Para entrar na lista ou alterar seus dados, fale com a organização da Prime Arena.</p>}
 {data.admin&&participants.some(p=>p.removedAt)&&<button className="text-link viradao-back" onClick={()=>setShowRemoved(!showRemoved)}>{showRemoved?'Ocultar removidos':'Mostrar participantes removidos'}</button>}
 <section className="panel viradao-table"><table><thead><tr><th>Nome</th><th>Nick</th>{data.admin&&<><th>Pagamento</th><th>Comprovante privado</th><th>Ações</th></>}</tr></thead><tbody>{visible.map((p,i)=><tr key={p.id??i} className={p.removedAt?'removed-participant':''}><td><strong>{p.name}</strong>{p.removedAt&&<small className="removed-label">Removido da lista pública</small>}</td><td>{p.nick}</td>{data.admin&&<><td><span className={'payment-status payment-'+p.payment}>{paymentText[p.payment!]}</span></td><td><div className="viradao-actions">{p.hasReceipt?<a className="text-link" href={'/api/viradao/comprovante?id='+p.id}>Baixar comprovante</a>:<span className="muted">Sem comprovante</span>}{!p.removedAt&&<button className="text-link" disabled={busy} onClick={()=>open('receipt',p)}>{p.hasReceipt?'Substituir':'Anexar'}</button>}</div></td><td><div className="viradao-actions">{p.removedAt?<button className="button secondary" disabled={busy} onClick={()=>changePresence(p,'restore')}>Restaurar</button>:<><button className="button secondary" disabled={busy} onClick={()=>open('participant',p)}>Editar</button><button className="text-link" disabled={busy} onClick={()=>open('remove',p)}>Remover</button></>}</div></td></>}</tr>)}</tbody></table>{!visible.length&&<div className="empty"><span aria-hidden="true">☾</span><h2>A lista está começando</h2><p>{data.admin?'Adicione o nome e o nick do primeiro participante.':'Os participantes aparecerão aqui após o cadastro pela organização.'}</p></div>}</section>
 </>:!error?<div className="viradao-events">{data.events.map(event=><button className="panel viradao-event" key={event.id} onClick={()=>select(event.id)}><span aria-hidden="true">☾</span><h2>{event.title}</h2><p>{date(event.startsAt)} · Manaus</p><span><span aria-hidden="true">♟</span>{event.count} participante{event.count!==1?'s':''}</span></button>)}{!data.events.length&&<div className="panel empty"><span aria-hidden="true">☾</span><h2>Nenhum viradão cadastrado</h2><p>{data.admin?'Crie uma edição para começar a lista.':'A próxima edição será publicada aqui.'}</p></div>}</div>:null}
 </main>
 <dialog ref={dialogRef} className="arena-dialog" aria-labelledby="viradao-dialog-title" aria-describedby="viradao-dialog-description" onCancel={e=>{e.preventDefault();if(!busy)setModal(null);}}>
 <button type="button" className="dialog-close" disabled={busy} onClick={()=>setModal(null)} aria-label="Fechar">×</button><h2 id="viradao-dialog-title">{modal==='event'?'Criar viradão':modal==='receipt'?'Comprovante privado':modal==='remove'?'Remover da lista?':editing?'Editar participante':'Adicionar participante'}</h2><p id="viradao-dialog-description">{modal==='event'?'Cada edição tem sua própria lista e seu link público.':modal==='receipt'?'O arquivo fica restrito à organização. Anexar um comprovante não altera automaticamente a situação do pagamento.':modal==='remove'?'O participante sai da lista pública. O cadastro e o comprovante continuam disponíveis para a organização.':'Nome e nick aparecem na lista pública. O pagamento fica visível somente para a organização.'}</p>
 {formError&&<p className="form-error" role="alert">{formError}</p>}
 {modal==='event'&&<form className="arena-form" onSubmit={save}><label className="field"><span>Nome da edição</span><input name="title" required maxLength={120} defaultValue="Viradão Prime Arena"/></label><label className="field"><span>Data e hora</span><input name="startsAt" type="datetime-local" required/><small>Informe o horário local do seu dispositivo. A lista mostra o horário de Manaus.</small></label><button className="button primary" disabled={busy}>{busy?'Salvando…':'Criar viradão'}</button></form>}
 {modal==='participant'&&<form className="arena-form" onSubmit={save}><label className="field"><span>Nome</span><input name="name" required maxLength={120} defaultValue={editing?.name}/></label><label className="field"><span>Nick</span><input name="nick" required maxLength={120} defaultValue={editing?.nick}/></label><div className="field"><span>Pagamento</span><select value={payment} onChange={e=>setPayment(e.target.value)} aria-label="Pagamento">{Object.entries(paymentText).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><p className="small muted">Depois de salvar, use Anexar na coluna de comprovantes.</p><button className="button primary" disabled={busy}>{busy?'Salvando…':'Salvar participante'}</button></form>}
 {modal==='receipt'&&<form className="arena-form" onSubmit={upload}><p><strong>{editing?.name}</strong> · {editing?.nick}</p><label className="field"><span>Arquivo do comprovante</span><input name="file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf"/><small>JPG, PNG, WebP ou PDF, até 5 MB.</small></label><button className="button primary" disabled={busy}>{busy?'Enviando…':'Salvar comprovante privado'}</button></form>}
 {modal==='remove'&&editing&&<div className="arena-form"><p>{editing.name} · {editing.nick}</p><button className="button danger-outline" disabled={busy} onClick={()=>changePresence(editing,'remove')}>{busy?'Removendo…':'Remover da lista pública'}</button></div>}
 </dialog>{notice&&<p role="status" className="notice">{notice}</p>}
 </div>;
}
