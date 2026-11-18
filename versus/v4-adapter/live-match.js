import {createVersusMatch,publicMatch,updatePausedTactics} from '../match-engine.js';
import {tacticalDimensionsForPlan} from '../v2/match-engine-v2.js';
import {resolveV2TacticalDimensions} from '../v2/spatial-model-v2.js';
import {VERSUS_TRAIT_BY_ID} from '../trait-pool.js';
import {createMatch,advanceMatch} from '../v4/engine.js';
import {clockSnapshot,STEP,VERSION} from '../v4/world.js';
import {compileInput} from '../v4/fixtures.js';
import {createPlayerReportLedger} from '../v4-host/player-report.js';
import {trackedRawReference} from '../league-shard-store.js';
import {compileTeam} from './compile-match.js';
import {resolveBoardDuty} from '../public/v2-player-duty-options.js';
import {dutyFor} from '../v4/execution.js';
import {roleGroup} from '../../shared/football/schema.js';
import {createMatchMetrics,METRIC_DEFINITIONS} from '../v4-host/match-metrics.js';


// League, training and draft rooms already select their own starting elevens.
// Compile those selections directly, including bans and competition presets.
export function compileLiveSeat(seat,side){
  const starters=seat.players.filter(p=>p.active!==false).slice(0,11);
  const ids=new Set(starters.map(p=>p.id));
  const player=p=>({...p,state:{...p.state,fitness:p.state?.fitness??100},traitDefinitions:p.traitDefinitions??
    (p.traits??[]).map(id=>typeof id==='string'?VERSUS_TRAIT_BY_ID[id]:id).filter(Boolean)});
  const plans={};
  for(const key of ['opening','leading','trailing']){
    const plan={tactic:seat.tactic??'balanced',style:seat.style??'balanced',...(seat.tacticalPlans?.[key]??seat.tacticalPlans?.opening)};
    plans[key]={...plan,tacticalDimensions:resolveV2TacticalDimensions(plan.tactic,plan.style,tacticalDimensionsForPlan(plan))};
  }
  const coverage={blockers:[],warnings:[],excludedBench:[]};
  const positions={position1:seat.positions,position2:seat.positions,position3:seat.positions,...seat.positionPresets};
  const team=compileTeam({...seat,id:seat.id??String(side),players:starters.map(player),
    substitutes:seat.players.filter(p=>!ids.has(p.id)).map(player),tacticalPlans:plans,positionPresets:positions},coverage);
  return {...team,sourceBondCatalog:seat.bondCatalog??[],unsupportedEffects:[...new Set(coverage.blockers)]};
}

export function createLiveV4Match(seats,options={}){
  const compiled=seats.map(compileLiveSeat);
  const spatial=createMatch({seed:String(options.seed),duration:options.duration??5400,format:'full',teams:compiled,
    passiveSubstitutions:true,playerEffects:true,competition:{resolution:options.regulationOnly?'draw':'extraTimeAndPenalties',
      aggregate:options.aggregateBaseScore??[0,0]}},{recording:false});
  // Existing panels and pause controls consume this presentation structure.
  const match=createVersusMatch(seats.map(seat=>({...seat,players:seat.players.filter(p=>p.active!==false).slice(0,11)})),
    {...options,weather:'sunny',referee:'standard'});
  Object.assign(match,{version:4,engineVersion:VERSION,startedAt:match.segmentStartedAt,nextChainIndex:0,spatial,ledger:null,interactive:options.interactive===true,recordKeyPlays:options.recordEvents!==false});
  const ledger=createPlayerReportLedger(spatial.state.input,VERSION);
  ledger.consume(spatial.events.splice(0));
  match.ledger=ledger.checkpoint();
  for(const p of spatial.state.players.filter(p=>p.active)){
    const team=match.teams[p.side];
    syncBoardPlayer(spatial.state,team,team.players.find(row=>row.id===p.id),p);
  }
  return match;
}

function syncBoardPlayer(state,team,row,p){
  row.assignedRole=p.sourceRole??p.role;
  row.tacticalDuty=dutyFor(state,p);
  team.positions[p.id]={x:p.anchor.y/68*100,y:(1-p.anchor.x/105)*100};
}

function syncDisplay(match){
  const state=match.spatial.state;
  const clock=clockSnapshot(state);
  const metrics=createMatchMetrics(match.ledger.metrics).view(state.time);
  match.minute=Math.floor((clock.baseSeconds+clock.elapsed)/60);
  match.segment=state.shootout?'penalties':clock.period>2?'extra':'regular';
  if(state.shootout)match.penalties={score:[...state.shootout.score],kicks:[...state.shootout.kicks]};
  match.teams.forEach((team,side)=>{
    team.score=state.score[side];
    Object.assign(team.stats,state.stats[side]);
    Object.assign(team.stats,metrics.stats[side]);
    team.stats.completed=state.stats[side].completed;
    for(const name of ['shotsOnTarget','saves','blocks','clearances','pressuresWon'])team.stats[name]=Object.entries(match.ledger.players).filter(([key])=>key.startsWith(side+':')).reduce((n,[,s])=>n+(s[name]??0),0);
    for(const p of state.players.filter(p=>p.side===side)){
      let row=team.players.find(row=>row.id===p.id);
      if(!row){
        row={...p,assignedRole:p.sourceRole??p.role,state:{},matchStats:{},rating:6.5};
        team.players.push(row);
      }
      syncBoardPlayer(state,team,row,p);
      row.active=p.active;row.sentOff=p.status==='sentOff';row.injury=p.injury??null;row.state.fitness=p.fitness;
      row.matchStats=match.ledger.players[p.key];
    }
  });
  match.events=metrics.events.map(e=>({...e,...match.ledger.importantEvents.find(row=>row.id===e.id)}));
  match.metricDefinitions=METRIC_DEFINITIONS;
}

export function advanceLiveV4Match(tracked,now=Date.now(),options={}){
  const match=trackedRawReference(tracked);
  if(match.finished)return match;
  if(match.pause){
    if(now<match.pause.expiresAt)return match;
    match.segmentStartedAt+=match.pause.expiresAt-match.pause.startedAt;
    match.pause=null;
  }
  const spatial=match.spatial,state=spatial.state;
  const stepsDue=()=>Math.floor((now-match.segmentStartedAt)*.045/STEP)-state.tick;
  const limit=Number.isFinite(options.maximumChains)?Math.max(0,options.maximumChains)*200:100000;
  let steps=Math.min(stepsDue(),limit);
  if(steps<=0)return match;
  const initial=match.kickoffInput??state.input;
  const ledger=createPlayerReportLedger(initial,VERSION,match.ledger);
  while(steps>0&&state.phase!=='finished'){
    const chunk=Math.min(steps,match.recordKeyPlays!==false?5:match.interactive&&!match.halftimeTaken?10:200);
    advanceMatch(spatial,chunk);
    if(match.recordKeyPlays!==false){
    (match.replayFrames??=[]).push({time:state.time,ball:{x:state.ball.y/68*100,y:(1-state.ball.x/105)*100},players:state.players.filter(p=>p.active).map(p=>({id:p.id,teamIndex:p.side,name:p.name,x:p.y/68*100,y:(1-p.x/105)*100}))});
    match.replayFrames=match.replayFrames.filter(frame=>frame.time>=state.time-18);
    for(const clip of match.keyPlays??[])if(!clip.ready){
      if(clip.frames.at(-1)?.time<state.time)clip.frames.push(structuredClone(match.replayFrames.at(-1)));
      clip.ready=state.time>=clip.replayTime+2||state.phase==='finished';
    }
    for(const event of spatial.events.filter(e=>['goal','shot','save','redCard'].includes(e.type))){
      (match.keyPlays??=[]).push({eventId:`v4-${event.id}`,type:event.type,replayTime:event.time,ready:state.phase==='finished',frames:structuredClone(match.replayFrames.filter(frame=>frame.time>=event.time-13))});
      if(match.keyPlays.length>64){const expendable=match.keyPlays.findIndex(c=>c.type!=='goal');match.keyPlays.splice(expendable<0?0:expendable,1);}
    }
    }
    ledger.consume(spatial.events.splice(0));steps-=chunk;
    if(match.interactive&&!match.halftimeTaken&&state.phase==='halftime'&&state.clock.period===1){
      match.halftimeTaken=true;
      state.clock.intervalRemaining=0;
      const startedAt=match.segmentStartedAt+state.time/.045;
      const expiresAt=startedAt+30000;
      if(now<expiresAt){
        match.pause={kind:'halftime',ownerIndex:null,startedAt,expiresAt,submitted:[false,false]};
        break;
      }
      match.segmentStartedAt+=30000;
      steps=Math.min(steps,stepsDue());
    }
  }
  match.ledger=ledger.checkpoint();
  syncDisplay(match);
  if(state.phase==='finished'){
    match.report={...ledger.finish({...state,input:initial}),keyPlays:structuredClone(match.keyPlays??[]),weather:match.weather,referee:match.referee,
      unsupportedEffects:initial.teams.map(t=>t.unsupportedEffects),tacticalChanges:match.tacticalChanges??[],competitionMode:match.competitionMode,legNumber:match.legNumber};
    match.report.teams.forEach((row,side)=>{
      const team=match.teams[side];
      Object.assign(row,{tactic:team.tactic,style:team.style,attackFocus:team.attackFocus,defenseFocus:team.defenseFocus,
        importedLineup:team.importedLineup,activeCount:row.players.filter(p=>p.active).length});
    });
    match.winnerIndex=state.result.winner;match.penalties=state.shootout?{score:match.report.penalties,kicks:state.shootout.kicks??[]}:null;
    match.finished=true;match.phase='finished';
    delete match.spatial;delete match.ledger;delete match.kickoffInput;
  }
  tracked.nextChainIndex=state.tick;
  return match;
}

export function publicLiveV4Match(match,now,viewerIndex,reveal){
  const view=publicMatch(match,now,viewerIndex,reveal,()=>{});
  for(const [side,team] of view.teams.entries()){
    const counts={GK:0,DEF:0,MID:0,ATT:0};
    const rows=match.teams[side].players;
    for(const row of team.players){
      if(row.active)counts[roleGroup(row.assignedRole)]++;
      if(reveal||side===viewerIndex)row.tacticalDuty=rows.find(p=>p.id===row.id)?.tacticalDuty??null;
    }
    team.formation=[counts.DEF,counts.MID,counts.ATT].join('-');
  }
  if(view.report&&!reveal)view.report.tacticalChanges=view.report.tacticalChanges.filter(change=>change.side===viewerIndex);
  return {...view,version:4,engineVersion:VERSION,engineProfile:'v4-spatial',metricDefinitions:METRIC_DEFINITIONS,
    keyPlays:structuredClone((match.keyPlays??[]).filter(clip=>clip.ready||match.finished))};
}

export function adjustLiveV4Tactics(match,side,payload){
  updatePausedTactics(match,side,payload);
  const state=match.spatial.state,team=match.teams[side];
  const adjusted=compileLiveSeat({...team,tacticalPlans:null,positionPresets:null},side);
  const input=structuredClone(state.input),source=input.teams[side];
  // Keep kickoff roster and ledger identity, including substitutions already made.
  source.instructions=adjusted.instructions;source.scorePlans=adjusted.scorePlans;
  source.sourcePlans=adjusted.sourcePlans;
  match.kickoffInput??=state.input;
  state.input=compileInput(input);
  for(const p of state.players.filter(p=>p.side===side&&p.active)){
    const mapped=adjusted.players.find(row=>row.id===p.id);
    if(mapped){
      Object.assign(p,{role:mapped.role,sourceRole:mapped.sourceRole,anchor:mapped.anchor,rolePlans:mapped.rolePlans,anchorPlans:mapped.anchorPlans,sourceRolePlans:mapped.sourceRolePlans});
      p.dutyPlans=Object.fromEntries(Object.entries(p.dutyPlans??{}).map(([mode,duty])=>[mode,resolveBoardDuty(p.sourceRolePlans[mode],duty)]));
      syncBoardPlayer(state,team,team.players.find(row=>row.id===p.id),p);
    }
  }
  (match.tacticalChanges??=[]).push({side,tick:state.tick,tactic:team.tactic,style:team.style,positions:structuredClone(team.positions)});
  return match;
}
