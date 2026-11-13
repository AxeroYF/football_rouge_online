import {isV32} from './model-config.js';
export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const rounded=(value,digits=3)=>Number(value.toFixed(digits));
export const FLOW_PERIODS=Object.freeze([
  {start:0,end:45,seconds:2700,wallStart:0,wallEnd:60000},
  {start:45,end:90,seconds:2700,wallStart:60000,wallEnd:120000},
  {start:90,end:105,seconds:900,wallStart:120000,wallEnd:140000},
  {start:105,end:120,seconds:900,wallStart:140000,wallEnd:160000},
]);
export function initializeFlowState(match) {
  if(!isV32(match.parameters))return;
  match.flowState={version:1,period:0,periodElapsed:0,addedSeconds:0,elapsedSeconds:0,
    activeSeconds:0,deadBallSeconds:0,owner:null,zone:'defensiveThird:center',carrierId:null,phase:'buildUp',
    transition:null,shapes:match.teams.map(team=>Object.fromEntries(team.players.filter(p=>p.active).map(p=>[p.id,{...(team.positions[p.id]??p.boardPosition??{x:50,y:70})}]))),
    periods:[],counterPressAttempts:[0,0],counterPressRecoveries:[0,0],loadByPlayer:{}};
}
export function assertFlowState(match) {
  if(!isV32(match.parameters))return;
  const f=match.flowState;
  if(!f||f.version!==1||!Number.isInteger(f.period)||f.period<0||f.period>3||![null,0,1].includes(f.owner)
    ||['periodElapsed','elapsedSeconds','activeSeconds','deadBallSeconds','addedSeconds'].some(k=>!Number.isFinite(f[k])||f[k]<0)
    ||!Array.isArray(f.shapes)||f.shapes.length!==2)throw new Error('V3.2 连续比赛状态缺失或损坏');
  if(f.addedSeconds>match.parameters.v32.maximumAddedSeconds||f.periodElapsed>FLOW_PERIODS[f.period].seconds+f.addedSeconds+.001)throw new Error('V3.2 比赛时钟超出边界');
  for(const shape of f.shapes)for(const point of Object.values(shape))if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>100||point.y<0||point.y>100)throw new Error('V3.2 球员实际位置损坏');
}
export function flowMinute(flow) {
  const period=FLOW_PERIODS[flow.period];
  return rounded(period.start+Math.min(period.seconds,flow.periodElapsed)/60,2);
}
export function flowClock(match) {
  if(!match.flowState)return null;
  const f=match.flowState,p=FLOW_PERIODS[f.period];
  const added=Math.max(0,f.periodElapsed-p.seconds);
  return {version:1,period:f.period+1,footballSeconds:rounded(f.elapsedSeconds),activeSeconds:rounded(f.activeSeconds),
    deadBallSeconds:rounded(f.deadBallSeconds),addedSeconds:rounded(f.addedSeconds),playedAddedSeconds:rounded(added),
    display:added>0?`${p.end}+${Math.max(1,Math.ceil(added/60))}`:String(Math.ceil(flowMinute(f))),
    completedPeriods:f.periods.map(value=>({...value}))};
}
export function periodRemaining(flow) {return Math.max(0,FLOW_PERIODS[flow.period].seconds+flow.addedSeconds-flow.periodElapsed);}
export function flipFlowZone(zone) {
  const [band,lane]=String(zone).split(':');
  return `${({defensiveThird:'box',buildUp:'finalThird',finalThird:'buildUp',box:'defensiveThird'})[band]??'buildUp'}:${({farLeft:'farRight',leftHalfSpace:'rightHalfSpace',rightHalfSpace:'leftHalfSpace',farRight:'farLeft'})[lane]??'center'}`;
}
export function zonePoint(zone) {
  const [band,lane]=String(zone).split(':');
  return {x:({farLeft:10,leftHalfSpace:30,center:50,rightHalfSpace:70,farRight:90})[lane]??50,
    y:({defensiveThird:84,buildUp:64,finalThird:31,box:10})[band]??50};
}
export function resetFlowRestart(match,owner=null) {
  const f=match.flowState;
  f.owner=owner;f.zone='defensiveThird:center';f.carrierId=null;f.phase='buildUp';f.transition=null;
  if(f.defenseAssignments){delete f.defenseAssignments;delete f.previousAction;}
  f.shapes=match.teams.map(team=>Object.fromEntries(team.players.filter(p=>p.active).map(p=>[p.id,{...(team.positions[p.id]??{x:50,y:70})}])));
}
export function commitFlowClock(match,chain,{goals=0,injuries=0,substitutions=0}={}) {
  const f=match.flowState;
  const active=Math.min(chain.activeDurationSeconds??0,periodRemaining(f));
  const final=chain.stages.at(-1);
  const dead=goals*15+injuries*12+substitutions*6+(chain.terminalOutcome==='periodEnded'?0:final?.foul?.occurred?8:final?.stage==='shot'?5:0);
  f.addedSeconds=rounded(Math.min(match.parameters.v32.maximumAddedSeconds,f.addedSeconds+goals*6+injuries*8+substitutions*3+(final?.foul?.occurred?2:0)));
  const deadSeconds=Math.min(dead,Math.max(0,periodRemaining(f)-active));
  chain.deadBallSeconds=rounded(deadSeconds);chain.durationSeconds=rounded(active+deadSeconds);
  f.periodElapsed=rounded(f.periodElapsed+active+deadSeconds);f.elapsedSeconds=rounded(f.elapsedSeconds+active+deadSeconds);
  f.activeSeconds=rounded(f.activeSeconds+active);f.deadBallSeconds=rounded(f.deadBallSeconds+deadSeconds);
  const team=match.teams[chain.attackingTeamIndex],type=chain.possessionType==='transition'?'transitionPossessionSeconds':'normalPossessionSeconds';
  const prefix=Math.min(active,chain.previousOwnerSeconds??0);
  team.stats[type]=rounded((team.stats[type]??0)+active-prefix);team.stats.possessionSeconds=rounded((team.stats.possessionSeconds??0)+active-prefix);
  if(prefix>0) {
    const previous=match.teams[1-chain.attackingTeamIndex];
    previous.stats.transitionPossessionSeconds=rounded((previous.stats.transitionPossessionSeconds??0)+prefix);
    previous.stats.possessionSeconds=rounded((previous.stats.possessionSeconds??0)+prefix);
  }
  match.minute=flowMinute(f);
}
export function finishFlowPossession(match,chain,cornerRestart=false) {
  const f=match.flowState,last=chain.stages.at(-1),attack=chain.attackingTeamIndex;
  if(chain.setPieceRestart) {
    const restart=chain.setPieceRestart;
    f.owner=restart.owner;f.zone=restart.zone;f.phase=restart.phase;f.carrierId=null;
    f.transition={lostTeam:restart.lostTeam,wonTeam:f.owner,wonZone:f.zone,expiresAt:f.elapsedSeconds+match.parameters.v32.counterPressWindow,
      attempted:false,lossStrategy:match.teams[restart.lostTeam].lossTransition??'balanced'};
  } else if(last?.turnover) {
    f.owner=last.turnover.teamIndex;f.zone=flipFlowZone(last.turnover.zone);f.carrierId=last.turnover.playerId;
    f.phase=({defensiveThird:'buildUp',buildUp:'progression',finalThird:'finalThird',box:'chance'})[f.zone.split(':')[0]];
    f.transition={lostTeam:attack,wonTeam:f.owner,wonZone:f.zone,expiresAt:f.elapsedSeconds+match.parameters.v32.counterPressWindow,
      attempted:false,lossStrategy:match.teams[attack].lossTransition??'balanced'};
  } else if(last?.stage==='shot'||last?.foul?.occurred||last?.outcome==='offside'||cornerRestart) {
    f.owner=1-attack;f.zone='defensiveThird:center';f.carrierId=match.teams[f.owner].players.find(p=>p.active&&p.assignedRole==='GK')?.id??null;
    f.phase='buildUp';f.transition=null;
  } else {f.owner=attack;f.zone=chain.endZone;f.carrierId=last?.actor?.id??f.carrierId;}
  match.transition=f.transition?{attackingTeamIndex:f.owner,wonZone:f.zone,counterOpportunity:true}:null;
}
