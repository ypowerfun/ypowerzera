import { randomUUID } from 'node:crypto';
import { buildStage, firstTo, isStageComplete, leaderboardState, nextSwissRound, planLobbies, resolveStage, selectAdvancing, stageStandings,
  type BracketKind, type MatchResult, type MatchSpec, type ResolvedMatch, type SlotSource, type StageInput, type StageSettings } from '@/engine';
import { AppError } from '@/lib/errors';
import { TournamentPlan, type Row } from './tournament-plan';

export function json<T>(value:Row[string],fallback:T):T {return value===null||value===undefined?fallback:JSON.parse(String(value)) as T;}
const idOf=(e:ResolvedMatch['entrantA'])=>e.kind==='participant'?e.id:null;
export const d1ForfeitScore=(bestOf:number,winner:'a'|'b')=>{
  const win=bestOf===1?3:firstTo(bestOf);return winner==='a'?{scoreA:win,scoreB:0}:{scoreA:0,scoreB:win};
};
export function plannedStage(plan:TournamentPlan,stageId:string){
  const stage=plan.row('Stage',stageId),settings=json<StageSettings>(stage.settings,{} as StageSettings);
  const matches=plan.state.Match.filter(m=>m.stageId===stageId).sort((a,b)=>Number(a.round)-Number(b.round)||Number(a.position)-Number(b.position));
  const games=plan.state.BrGame.filter(g=>g.stageId===stageId).sort((a,b)=>Number(a.round)-Number(b.round)||Number(a.lobby)-Number(b.lobby));
  const results=new Map<string,MatchResult>();
  for(const m of matches)if(m.status==='COMPLETED'&&m.winnerSide&&m.scoreA!==null&&m.scoreB!==null)
    results.set(String(m.key),{scoreA:Number(m.scoreA),scoreB:Number(m.scoreB),winner:m.winnerSide==='draw'?null:m.winnerSide as 'a'|'b',forfeit:m.forfeit as 'a'|'b'|null});
  const specs:MatchSpec[]=matches.map(m=>({key:String(m.key),bracket:m.bracket as BracketKind,round:Number(m.round),position:Number(m.position),group:m.group as number|null,
    bestOf:Number(m.bestOf),a:json<SlotSource>(m.slotA,{kind:'seed',index:0} as unknown as SlotSource),b:json<SlotSource>(m.slotB,{kind:'seed',index:0} as unknown as SlotSource),
    onlyIfWinner:json<MatchSpec['onlyIfWinner']>(m.onlyIfWinner,undefined)}));
  const input:StageInput={settings,participants:json<string[]>(stage.seedOrder,[]),specs,results,groups:json<string[][]|null>(stage.groups,null),
    br:games.flatMap(g=>plan.state.BrResult.filter(r=>r.gameId===g.id).map(r=>({round:Number(g.round),lobby:Number(g.lobby),participantId:String(r.participantId),placement:Number(r.placement),kills:Number(r.kills)})))};
  return {stage,settings,matches,games,input};
}
function addSpecs(plan:TournamentPlan,stageId:string,specs:MatchSpec[]){
  for(const s of specs)plan.state.Match.push({id:randomUUID(),stageId,key:s.key,bracket:s.bracket,round:s.round,position:s.position,group:s.group,bestOf:s.bestOf,
    slotA:JSON.stringify(s.a),slotB:JSON.stringify(s.b),onlyIfWinner:s.onlyIfWinner?JSON.stringify(s.onlyIfWinner):null,
    participantAId:null,participantBId:null,status:'PENDING',scoreA:null,scoreB:null,winnerSide:null,forfeit:null,reportA:null,reportB:null,
    completedAt:null,notes:null,scheduledAt:null,vetoState:null,games:null});
}
export function startPlannedStage(plan:TournamentPlan,stageId:string,seeds:string[]){
  const stage=plan.row('Stage',stageId),settings=json<StageSettings>(stage.settings,{} as StageSettings);
  const built=buildStage(settings,seeds,`${plan.tournament.seedSalt}:${stage.order}`);
  addSpecs(plan,stageId,built.specs);
  Object.assign(stage,{status:'LIVE',startedAt:plan.now,seedOrder:JSON.stringify(seeds),...(built.groups?{groups:JSON.stringify(built.groups)}:{})});
  syncPlannedStage(plan,stageId);
}
function outIds(plan:TournamentPlan){return new Set(plan.state.Participant.filter(p=>p.status==='DISQUALIFIED'||p.status==='WITHDRAWN').map(p=>String(p.id)));}
function brDone(plan:TournamentPlan,g:Row){return g.completedAt!==null&&plan.state.BrResult.some(r=>r.gameId===g.id);}
function nextBr(plan:TournamentPlan,ctx:ReturnType<typeof plannedStage>):boolean {
  if(ctx.settings.type!=='LEADERBOARD')return false;
  const settings=ctx.settings,state=leaderboardState(ctx.input)!,planned=Math.max(0,...ctx.games.map(g=>Number(g.round)));
  const allDone=ctx.games.filter(g=>g.round===planned).every(g=>brDone(plan,g));
  if(state.finished&&planned>0&&allDone)return false;
  if(planned>0&&(!allDone||planned>=settings.games))return false;
  const round=planned+1,out=outIds(plan),seeds=ctx.input.participants.filter(id=>!out.has(id));
  if(!seeds.length)return false;
  const order=settings.lobbyAssignment==='swiss'&&round>1?state.rows.map(r=>r.participantId).filter(id=>!out.has(id)):seeds;
  const lobbies=planLobbies(order,settings.lobbySize,settings.lobbyAssignment,round,String(ctx.stage.id));
  for(let i=0;i<lobbies.length;i++)plan.state.BrGame.push({id:randomUUID(),stageId:ctx.stage.id,round,lobby:i+1,participantIds:JSON.stringify(lobbies[i]),code:null,scheduledAt:null,completedAt:null});
  return true;
}
export function syncPlannedStage(plan:TournamentPlan,stageId:string):{complete:boolean}{
  let exhausted=true;
  for(let loop=0;loop<400;loop++){
    const ctx=plannedStage(plan,stageId);
    if(ctx.stage.status==='PENDING')return {complete:false};
    if(ctx.settings.type==='LEADERBOARD'){if(nextBr(plan,ctx))continue;exhausted=false;break;}
    const resolved=resolveStage(ctx.input),out=outIds(plan),seedIndex=new Map(ctx.input.participants.map((id,i)=>[id,i]));
    let forfeits=0;
    for(const m of resolved.values()){
      if(m.status!=='ready')continue;
      const a=idOf(m.entrantA)!,b=idOf(m.entrantB)!,aOut=out.has(a),bOut=out.has(b);
      if(!aOut&&!bOut)continue;
      const winner=aOut&&bOut?((seedIndex.get(a)??0)<(seedIndex.get(b)??0)?'a':'b'):aOut?'b':'a';
      const row=ctx.matches.find(r=>r.key===m.key)!;
      Object.assign(row,d1ForfeitScore(Number(row.bestOf),winner),{winnerSide:winner,forfeit:winner==='a'?'b':'a',status:'COMPLETED',completedAt:plan.now,
        participantAId:a,participantBId:b,notes:row.notes??'W.O. automático (adversário desclassificado ou desistente).'});forfeits++;
    }
    if(forfeits)continue;
    for(const row of ctx.matches){
      const r=resolved.get(String(row.key));if(!r)continue;
      const a=idOf(r.entrantA),b=idOf(r.entrantB),changed=row.participantAId!==a||row.participantBId!==b;
      row.participantAId=a;row.participantBId=b;
      if(r.status==='pending'&&(row.status!=='PENDING'||changed))Object.assign(row,{status:'PENDING',scoreA:null,scoreB:null,winnerSide:null,forfeit:null,reportA:null,reportB:null,completedAt:null});
      if(r.status==='ready'){
        if(['COMPLETED','BYE','SKIPPED','PENDING'].includes(String(row.status))){
          if(row.status==='PENDING'){
            const pa=plan.state.Participant.find(p=>p.id===a),pb=plan.state.Participant.find(p=>p.id===b);
            if(pa&&pb)plan.notify([String(pa.userId),String(pb.userId)],'match.ready','Sua partida está liberada',`${plan.tournament.name}: ${pa.name} × ${pb.name}`,`/partidas/${row.id}`);
          }
          Object.assign(row,{status:'READY',scoreA:null,scoreB:null,winnerSide:null,forfeit:null,completedAt:null});
        }else if(changed)Object.assign(row,{status:'READY',reportA:null,reportB:null});
      }
      if(r.status==='completed')row.status='COMPLETED';
      if(r.status==='bye'&&(row.status!=='BYE'||row.winnerSide!==(a?'a':'b')))Object.assign(row,{status:'BYE',winnerSide:a?'a':'b',scoreA:null,scoreB:null,completedAt:row.completedAt??plan.now});
      if(r.status==='skipped'&&row.status!=='SKIPPED')Object.assign(row,{status:'SKIPPED',scoreA:null,scoreB:null,winnerSide:null});
    }
    if(ctx.settings.type==='SWISS'){
      const next=nextSwissRound(ctx.input);if(next){addSpecs(plan,stageId,next.specs);continue;}
    }
    exhausted=false;break;
  }
  if(exhausted)throw new AppError('A progressão da fase excedeu o limite de operações.');
  const ctx=plannedStage(plan,stageId);
  const complete=ctx.settings.type==='LEADERBOARD'?
    !!leaderboardState(ctx.input)?.finished&&ctx.games.length>0&&ctx.games.filter(g=>g.round===Math.max(...ctx.games.map(g=>Number(g.round)))).every(g=>brDone(plan,g)):
    ctx.input.specs.length>0&&isStageComplete(ctx.input);
  if(complete){
    if(ctx.stage.status!=='COMPLETED')Object.assign(ctx.stage,{status:'COMPLETED',completedAt:plan.now});
    const next=plan.state.Stage.find(s=>s.order===Number(ctx.stage.order)+1);
    if(next){if(next.status==='PENDING')next.seedOrder=JSON.stringify(selectAdvancing(stageStandings(ctx.input),ctx.settings.advancement));}
    else if(plan.tournament.status==='LIVE')finishPlannedTournament(plan);
  }else if(ctx.stage.status==='COMPLETED')Object.assign(ctx.stage,{status:'LIVE',completedAt:null});
  return {complete};
}
function finishPlannedTournament(plan:TournamentPlan){
  const placement=new Map<string,number>();let offset=0;
  for(const stage of [...plan.state.Stage].sort((a,b)=>Number(b.order)-Number(a.order))){
    if(stage.status!=='COMPLETED')continue;
    const rest=stageStandings(plannedStage(plan,String(stage.id)).input).filter(r=>!placement.has(r.participantId));
    for(const r of rest)placement.set(r.participantId,offset+rest.filter(x=>x.rank<r.rank).length+1);offset+=rest.length;
  }
  for(const [id,place] of placement)plan.row('Participant',id).finalPlacement=place;
  plan.state.PrizeAward=plan.state.PrizeAward.filter(p=>p.status!=='PENDING');
  const split=json<Array<{placement:number;label:string;percent:number}>>(plan.tournament.prizeSplit,[]),pool=Number(plan.tournament.prizePoolCents);
  if(pool>0&&split.length){
    const tied=new Map<number,string[]>();for(const [id,place] of placement)tied.set(place,[...(tied.get(place)??[]),id]);
    for(const [place,ids] of tied){
      const entries=Array.from({length:ids.length},(_,i)=>split.find(s=>s.placement===place+i)).filter((e):e is NonNullable<typeof e>=>!!e);
      if(!entries.length)continue;
      const each=Math.floor(entries.reduce((n,e)=>n+Math.floor(pool*e.percent/100),0)/ids.length);if(each<=0)continue;
      for(const id of ids){
        const existing=plan.state.PrizeAward.find(p=>p.participantId===id);
        if(existing)Object.assign(existing,{placement:place,label:entries[0].label,amountCents:each});
        else plan.state.PrizeAward.push({id:randomUUID(),tournamentId:plan.id,participantId:id,placement:place,label:entries[0].label,amountCents:each,status:'PENDING'});
      }
    }
  }
  Object.assign(plan.tournament,{status:'COMPLETED',completedAt:plan.now});
}
