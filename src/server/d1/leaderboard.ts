import { randomUUID } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import type { LeaderboardSettings } from '@/engine';
import { AppError } from '@/lib/errors';
import { TournamentPlan } from './tournament-plan';
import { json, syncPlannedStage } from './stage-plan';
type Actor={id:string;role:string};
type Result={participantId:string;placement:number;kills:number};
async function load(db:D1Database,id:string){
  const found=await db.prepare('SELECT s.tournamentId FROM BrGame g JOIN Stage s ON s.id=g.stageId WHERE g.id=?').bind(id).first<{tournamentId:string}>();
  if(!found)throw new AppError('Partida não encontrada.','NOT_FOUND');
  const plan=await TournamentPlan.load(db,found.tournamentId);return {plan,game:plan.row('BrGame',id)};
}
export async function submitD1BrResults(db:D1Database,actor:Actor,id:string,rows:Result[],opts:{fillMissing?:boolean;code?:string}={}){
  const {plan,game}=await load(db,id),stage=plan.row('Stage',String(game.stageId));
  if(plan.tournament.status!=='LIVE')throw new AppError('O campeonato não está em andamento.');
  if(!['LIVE','COMPLETED'].includes(String(stage.status)))throw new AppError('Esta fase não está em andamento.');
  const settings=json<LeaderboardSettings>(stage.settings,{} as LeaderboardSettings),lobby=json<string[]>(game.participantIds,[]);
  const later=plan.state.BrGame.filter(g=>g.stageId===game.stageId&&Number(g.round)>Number(game.round));
  if(later.some(g=>plan.state.BrResult.some(r=>r.gameId===g.id)))throw new AppError('As rodadas seguintes já têm resultados. Corrija-as primeiro.');
  const next=plan.state.Stage.find(s=>s.order===Number(stage.order)+1);
  if(next&&next.status!=='PENDING')throw new AppError('A próxima fase já começou; este resultado não pode mais ser alterado.');
  const seen=new Set<string>(),placements=new Set<number>();
  for(const r of rows){
    if(!lobby.includes(r.participantId))throw new AppError('Há participante que não pertence a este lobby.');
    if(seen.has(r.participantId))throw new AppError('Participante repetido na lista.');seen.add(r.participantId);
    if(!Number.isInteger(r.placement)||r.placement<1||r.placement>Math.max(settings.lobbySize,lobby.length))throw new AppError('Colocação inválida.');
    if(placements.has(r.placement))throw new AppError(`A colocação ${r.placement} foi usada mais de uma vez.`);placements.add(r.placement);
    if(!Number.isInteger(r.kills)||r.kills<0||r.kills>99)throw new AppError('Abates devem ser inteiros entre 0 e 99.');
  }
  const final=[...rows],missing=lobby.filter(id=>!seen.has(id));
  if(missing.length){
    if(!opts.fillMissing)throw new AppError(`Faltam ${missing.length} participante(s) no lançamento.`);
    let position=lobby.length;for(const id of missing){while(placements.has(position)&&position>0)position--;final.push({participantId:id,placement:position,kills:0});placements.add(position--);}
  }
  plan.state.BrResult=plan.state.BrResult.filter(r=>r.gameId!==id);
  for(const r of final)plan.state.BrResult.push({id:randomUUID(),gameId:id,...r});
  game.completedAt=plan.now;if(opts.code!==undefined)game.code=opts.code;
  const deleted=new Set(later.map(g=>g.id));plan.state.BrGame=plan.state.BrGame.filter(g=>!deleted.has(g.id));
  syncPlannedStage(plan,String(stage.id));plan.audit(actor.id,'br.results','BrGame',id,{rows:final.length});
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'staff');
}
export async function codeD1BrGame(db:D1Database,actor:Actor,id:string,code:string){
  const {plan,game}=await load(db,id);game.code=code.trim().slice(0,80)||null;
  await plan.commit({id:actor.id,isAdmin:actor.role==='ADMIN'},'staff');
}
