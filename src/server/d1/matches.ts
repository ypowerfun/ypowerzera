import { randomUUID } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import { applyVeto, createVeto, isVetoComplete, nextStep, resolveStage, validateScore, vetoResult, type VetoState } from '@/engine';
import { getGame } from '@/games';
import { AppError } from '@/lib/errors';
import { TournamentPlan, type Row } from './tournament-plan';
import { d1ForfeitScore, json, plannedStage, syncPlannedStage } from './stage-plan';
type Actor={id:string;role:string};
export async function matchPlan(db:D1Database,id:string){
  const found=await db.prepare('SELECT s.tournamentId FROM Match m JOIN Stage s ON s.id=m.stageId WHERE m.id=?').bind(id).first<{tournamentId:string}>();
  if(!found)throw new AppError('Partida não encontrada.','NOT_FOUND');
  const plan=await TournamentPlan.load(db,found.tournamentId);
  return {plan,match:plan.row('Match',id)};
}
function sides(plan:TournamentPlan,m:Row){return {a:plan.state.Participant.find(p=>p.id===m.participantAId),b:plan.state.Participant.find(p=>p.id===m.participantBId)};}
function live(plan:TournamentPlan){if(plan.tournament.status!=='LIVE')throw new AppError('O campeonato não está em andamento.');}
function score(plan:TournamentPlan,m:Row,a:number,b:number){
  const settings=plannedStage(plan,String(m.stageId)).settings;
  const result=validateScore(Number(m.bestOf),a,b,{allowDraw:(settings.type==='ROUND_ROBIN'||settings.type==='SWISS')&&settings.allowDraw});
  if(!result.ok)throw new AppError(result.error);return result.winner;
}
function editable(plan:TournamentPlan,m:Row){
  live(plan);const ctx=plannedStage(plan,String(m.stageId));
  if(ctx.stage.status==='PENDING')throw new AppError('Esta fase ainda não começou.');
  const next=plan.state.Stage.find(s=>s.order===Number(ctx.stage.order)+1);
  if(next&&next.status!=='PENDING')throw new AppError('A próxima fase já começou; não é possível alterar este resultado.');
  if(ctx.settings.type==='SWISS'){
    const later=ctx.matches.filter(r=>Number(r.round)>Number(m.round));
    if(later.some(r=>['COMPLETED','REPORTED','DISPUTED'].includes(String(r.status))))throw new AppError('As rodadas seguintes já têm resultados. Reverta-os primeiro.');
    const ids=new Set(later.map(r=>r.id));plan.state.Match=plan.state.Match.filter(r=>!ids.has(r.id));
    plan.state.MatchDispute=plan.state.MatchDispute.filter(d=>!ids.has(d.matchId));
  }else if(ctx.settings.type!=='ROUND_ROBIN'){
    const descendants=new Set<string>(),queue=[String(m.key)];
    while(queue.length){const key=queue.shift()!;for(const s of ctx.input.specs)if([s.a,s.b].some(slot=>'match' in slot&&slot.match===key)&&!descendants.has(s.key)){descendants.add(s.key);queue.push(s.key);}}
    const resolved=resolveStage(ctx.input);
    if([...descendants].some(key=>resolved.get(key)?.status==='completed'))throw new AppError('As partidas seguintes já foram jogadas. Reverta-as antes de alterar esta.');
  }
}
function resolveDisputes(plan:TournamentPlan,m:Row,note:string){
  for(const d of plan.state.MatchDispute)if(d.matchId===m.id&&d.status==='OPEN')Object.assign(d,{status:'RESOLVED',resolvedAt:plan.now,resolution:note});
}
function write(plan:TournamentPlan,m:Row,a:number,b:number,opts:{forfeit?:'a'|'b';note?:string}={}){
  const winner=score(plan,m,a,b);
  Object.assign(m,{scoreA:a,scoreB:b,winnerSide:winner??'draw',forfeit:opts.forfeit??null,status:'COMPLETED',completedAt:plan.now,...(opts.note!==undefined?{notes:opts.note}:{})});
  resolveDisputes(plan,m,opts.note??'Resolvida pelo resultado final.');syncPlannedStage(plan,String(m.stageId));
}
function open(plan:TournamentPlan,m:Row,actorId:string,reason:string){
  const existing=plan.state.MatchDispute.find(d=>d.matchId===m.id&&d.status==='OPEN');if(existing)return existing;
  const d={id:randomUUID(),matchId:m.id,openedById:actorId,reason,status:'OPEN',resolution:null,resolvedById:null,resolvedAt:null,createdAt:plan.now};
  plan.state.MatchDispute.push(d);
  const {a,b}=sides(plan,m);
  plan.notify(plan.state.OrgMember.map(s=>String(s.userId)),'match.disputed','Partida em disputa',`${plan.tournament.name}: ${a?.name} × ${b?.name}`,`/organizar/${plan.id}/partidas`);
  return null;
}
export async function reportD1Match(db:D1Database,actor:Actor,id:string,a:number,b:number):Promise<'reported'|'completed'|'disputed'>{
  const {plan,match:m}=await matchPlan(db,id);live(plan);
  if(!['READY','REPORTED','DISPUTED'].includes(String(m.status)))throw new AppError('Esta partida não está aberta para relato de placar.');
  if(!plan.tournament.allowPlayerReporting)throw new AppError('Neste campeonato apenas a organização lança resultados.','FORBIDDEN');
  const ps=sides(plan,m),side=ps.a?.userId===actor.id?'a':ps.b?.userId===actor.id?'b':null;
  if(!side)throw new AppError('Só os capitães dos dois lados podem relatar o placar.','FORBIDDEN');
  score(plan,m,a,b);
  const key=side==='a'?'reportA':'reportB',other=json<{scoreA:number;scoreB:number}|null>(m[side==='a'?'reportB':'reportA'],null),prev=json<{scoreA:number;scoreB:number}|null>(m[key],null);
  m[key]=JSON.stringify({scoreA:a,scoreB:b,byUserId:actor.id,at:new Date(plan.now).toISOString()});
  let result:'reported'|'completed'|'disputed';
  if(!other){
    m.status='REPORTED';result='reported';const opp=side==='a'?ps.b:ps.a;
    if(opp&&!(prev?.scoreA===a&&prev.scoreB===b))plan.notify([String(opp.userId)],'match.reported','Confirme o placar',`${side==='a'?ps.a?.name:ps.b?.name} reportou ${a} × ${b}. Confirme ou conteste.`,`/partidas/${id}`);
  }else if(other.scoreA===a&&other.scoreB===b){write(plan,m,a,b);result='completed';}
  else {m.status='DISPUTED';open(plan,m,actor.id,'Relatos de placar divergentes.');result='disputed';}
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'participant',String(side==='a'?ps.a!.id:ps.b!.id));return result;
}
export async function disputeD1Match(db:D1Database,actor:Actor,id:string,text:string){
  const {plan,match:m}=await matchPlan(db,id);live(plan);
  const ps=sides(plan,m),mine=[ps.a,ps.b].find(p=>p?.userId===actor.id);
  if(!mine)throw new AppError('Só os participantes da partida podem abrir disputa.','FORBIDDEN');
  if(!['READY','REPORTED','DISPUTED'].includes(String(m.status)))throw new AppError('Esta partida não permite disputa agora.');
  const existing=open(plan,m,actor.id,text);
  if(existing){const joined=existing.reason+'\n'+text;if(joined.length>4000)throw new AppError('Esta disputa já tem muitas mensagens. Aguarde a decisão da organização.');existing.reason=joined;}
  m.status='DISPUTED';await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'participant',String(mine.id));
}
export async function resultD1Match(db:D1Database,actor:Actor,id:string,input:{scoreA?:number;scoreB?:number;note?:string;loserSide?:'a'|'b';reset?:boolean}){
  const {plan,match:m}=await matchPlan(db,id);live(plan);
  if(input.reset){
    if(!['COMPLETED','REPORTED','DISPUTED'].includes(String(m.status)))throw new AppError('Esta partida não tem resultado para desfazer.');
    if(m.status==='COMPLETED')editable(plan,m);
    Object.assign(m,{status:'READY',scoreA:null,scoreB:null,winnerSide:null,forfeit:null,reportA:null,reportB:null,completedAt:null});
    resolveDisputes(plan,m,'Resultado desfeito pela organização.');syncPlannedStage(plan,String(m.stageId));
    plan.audit(actor.id,'match.reset','Match',id);
  }else{
    if(!m.participantAId||!m.participantBId)throw new AppError('A partida ainda não tem os dois participantes.');
    if(m.status==='COMPLETED')editable(plan,m);
    else if(!['READY','REPORTED','DISPUTED'].includes(String(m.status)))throw new AppError('Esta partida ainda não pode receber resultado.');
    const sc=input.loserSide?d1ForfeitScore(Number(m.bestOf),input.loserSide==='a'?'b':'a'):{scoreA:input.scoreA!,scoreB:input.scoreB!};
    write(plan,m,sc.scoreA,sc.scoreB,{forfeit:input.loserSide,note:input.note});
    plan.audit(actor.id,input.loserSide?'match.forfeit':'match.set_result','Match',id,{...sc,note:input.note,loserSide:input.loserSide});
  }
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'staff');
}
export async function scheduleD1Match(db:D1Database,actor:Actor,id:string,at:Date|null){
  const {plan,match:m}=await matchPlan(db,id);m.scheduledAt=at?.getTime()??null;
  const ps=sides(plan,m);if(at)plan.notify([ps.a,ps.b].filter((p):p is Row=>!!p).map(p=>String(p.userId)),'match.scheduled','Partida agendada',`${plan.tournament.name}: ${ps.a?.name} × ${ps.b?.name}`,`/partidas/${id}`);
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'staff');
}
export async function vetoD1Match(db:D1Database,actor:Actor,id:string,map:string):Promise<VetoState>{
  const {plan,match:m}=await matchPlan(db,id);live(plan);
  if(!['READY','REPORTED'].includes(String(m.status)))throw new AppError('O veto só pode ser feito em partidas liberadas.');
  const game=getGame(String(plan.tournament.gameId)),custom=json<string[]|null>(plan.tournament.mapPool,null),pool=custom?.length?custom:game?.mapPool?.maps??[];
  if(!game?.vetoSupported||pool.length<Number(m.bestOf)+2||![1,3,5].includes(Number(m.bestOf)))throw new AppError('Esta partida não usa veto de mapas.');
  const ps=sides(plan,m),side=ps.a?.userId===actor.id?'a':ps.b?.userId===actor.id?'b':null;
  if(!side)throw new AppError('Só os capitães da partida participam do veto.','FORBIDDEN');
  const state=json<VetoState|null>(m.vetoState,null)??createVeto(pool,Number(m.bestOf),'a');
  const next=applyVeto(state,side,map);m.vetoState=JSON.stringify(next);if(isVetoComplete(next))m.games=JSON.stringify(vetoResult(next));
  const upcoming=nextStep(next),other=side==='a'?ps.b:ps.a;
  if(upcoming&&other&&upcoming.team!==side)plan.notify([String(other.userId)],'match.veto','Sua vez no veto',`${plan.tournament.name}: escolha um mapa.`,`/partidas/${id}`);
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'participant',String(side==='a'?ps.a!.id:ps.b!.id));return next;
}
