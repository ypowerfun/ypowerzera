import type { D1Database } from '@cloudflare/workers-types';
import { orderSeeds, validateStage, type SeedingMethod, type StageSettings } from '@/engine';
import { AppError } from '@/lib/errors';
import { TournamentPlan } from './tournament-plan';
import { json, startPlannedStage } from './stage-plan';

type Actor={id:string;role:string};
export async function startD1Tournament(db:D1Database,actor:Actor,id:string){
  const plan=await TournamentPlan.load(db,id),t=plan.tournament;
  if(!['REGISTRATION','CHECK_IN'].includes(String(t.status)))throw new AppError('O campeonato precisa estar com inscrições abertas ou em check-in para começar.');
  const first=[...plan.state.Stage].sort((a,b)=>Number(a.order)-Number(b.order))[0];
  if(!first)throw new AppError('Defina ao menos uma fase.');
  const eligible=plan.state.Participant.filter(p=>t.requireCheckIn?p.status==='CHECKED_IN':['REGISTERED','CHECKED_IN'].includes(String(p.status)));
  const errors=validateStage(json<StageSettings>(first.settings,{} as StageSettings),eligible.length);
  if(eligible.length<Number(t.minParticipants))errors.unshift(`São necessários pelo menos ${t.minParticipants} participantes confirmados (há ${eligible.length}).`);
  if(errors.length)throw new AppError(errors.join(' '));
  for(const p of plan.state.Participant){
    if(eligible.includes(p)||p.status==='DISQUALIFIED'||p.status==='WITHDRAWN')continue;
    const was=p.status;
    Object.assign(p,{status:'WITHDRAWN',dqReason:was==='REGISTERED'?'Sem check-in':was==='PENDING_PAYMENT'?'Pagamento não concluído':'Lista de espera',withdrawnAt:plan.now});
    plan.dropped.push(String(p.id));
    const why=was==='REGISTERED'?'você não fez o check-in a tempo':was==='PENDING_PAYMENT'?'o pagamento não foi concluído':'não abriu vaga para você';
    plan.notify([String(p.userId)],'participant.dropped','Você ficou de fora da chave',`${t.name} começou e ${why}.`,`/torneios/${t.slug}`);
  }
  const method=String(t.seedingMethod).toLowerCase() as SeedingMethod;
  const seeds=orderSeeds(eligible.map(p=>({id:String(p.id),seed:method==='manual'?p.seed as number|null:null,rating:p.rating as number|null})),method,String(t.seedSalt));
  seeds.forEach((id,i)=>{plan.row('Participant',id).seed=i+1;});
  Object.assign(t,{status:'LIVE',startedAt:plan.now});
  startPlannedStage(plan,String(first.id),seeds);
  plan.audit(actor.id,'tournament.start','Tournament',id,{participants:seeds.length});
  plan.notify(eligible.map(p=>String(p.userId)),'tournament.started','O campeonato começou!',`${t.name} foi iniciado. Veja suas partidas.`,`/torneios/${t.slug}`);
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'admin');
}
export async function startD1NextStage(db:D1Database,actor:Actor,id:string){
  const plan=await TournamentPlan.load(db,id);
  if(plan.tournament.status!=='LIVE')throw new AppError('O campeonato não está em andamento.');
  const stages=[...plan.state.Stage].sort((a,b)=>Number(a.order)-Number(b.order));
  if(stages.some(s=>s.status==='LIVE'))throw new AppError('A fase atual ainda está em andamento.');
  const next=stages.find(s=>s.status==='PENDING');if(!next)throw new AppError('Não há próxima fase.');
  const prev=stages.find(s=>s.order===Number(next.order)-1);
  if(prev?.status!=='COMPLETED')throw new AppError('A fase anterior ainda não terminou.');
  const seeds=json<string[]>(next.seedOrder,[]).filter(Boolean);
  const errors=validateStage(json<StageSettings>(next.settings,{} as StageSettings),seeds.length);
  if(errors.length)throw new AppError(errors.join(' '));
  startPlannedStage(plan,String(next.id),seeds);
  plan.audit(actor.id,'stage.start','Stage',String(next.id),{participants:seeds.length});
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'admin');
}
