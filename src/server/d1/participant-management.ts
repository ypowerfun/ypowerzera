import type { D1Database } from '@cloudflare/workers-types';
import { AppError } from '@/lib/errors';
import { TournamentPlan } from './tournament-plan';
import { syncPlannedStage } from './stage-plan';
type Actor={id:string;role:string};
async function load(db:D1Database,id:string){
  const found=await db.prepare('SELECT tournamentId FROM Participant WHERE id=?').bind(id).first<{tournamentId:string}>();
  if(!found)throw new AppError('Inscrição não encontrada.','NOT_FOUND');
  const plan=await TournamentPlan.load(db,found.tournamentId);return {plan,participant:plan.row('Participant',id)};
}
export async function seedD1Participant(db:D1Database,actor:Actor,id:string,seed:number|null,rating?:number|null){
  const {plan,participant:p}=await load(db,id);
  if(!['DRAFT','REGISTRATION','CHECK_IN'].includes(String(plan.tournament.status)))throw new AppError('O seed não pode mais ser alterado.');
  if(seed!==null&&(!Number.isInteger(seed)||seed<1||seed>1024))throw new AppError('Seed inválido.');
  if(rating!==undefined&&rating!==null&&!Number.isSafeInteger(rating))throw new AppError('Rating inválido.');
  p.seed=seed;if(rating!==undefined)p.rating=rating;
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'staff');
}
export async function disqualifyD1Participant(db:D1Database,actor:Actor,id:string,reason:string){
  const {plan,participant:p}=await load(db,id);
  if(p.status==='DISQUALIFIED')return;
  p.status='DISQUALIFIED';p.dqReason=reason.trim();
  if(plan.tournament.status==='LIVE')for(const stage of plan.state.Stage.filter(s=>s.status==='LIVE'))syncPlannedStage(plan,String(stage.id));
  plan.audit(actor.id,'participant.dq','Tournament',plan.id,{participantId:id,reason});
  plan.notify([String(p.userId)],'participant.dq','Inscrição desclassificada',`${plan.tournament.name}: ${reason.trim()}`,`/torneios/${plan.tournament.slug}`);
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'staff');
}
