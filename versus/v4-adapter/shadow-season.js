import {createHash} from 'node:crypto';
import {buildDivisionRounds,divisionStandings,divisionMovement} from '../league-format.js';

const copy=value=>structuredClone(value);
export function refreshShadowFingerprint(snapshot){
  const {fingerprint,...payload}=snapshot;snapshot.fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');return snapshot;
}
export function createShadowSeason(source){
  const snapshot=copy(source);snapshot.shadow={version:1,round:0,originFingerprint:source.fingerprint};
  for(const team of snapshot.teams){team.table={played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,points:0};team.playerState??={};}
  return refreshShadowFingerprint(snapshot);
}
function roundRobin(ids){
  const rotation=[...ids],first=[];
  for(let round=0;round<ids.length-1;round++){
    const fixtures=[];for(let i=0;i<ids.length/2;i++){const left=rotation[i],right=rotation[ids.length-1-i];fixtures.push({homeId:round%2?right:left,awayId:round%2?left:right});}
    first.push(fixtures);rotation.splice(1,0,rotation.pop());
  }
  return [...first,...first.map(fixtures=>fixtures.map(f=>({homeId:f.awayId,awayId:f.homeId})))].map((fixtures,i)=>({number:i+1,fixtures}));
}
export const shadowSchedule=snapshot=>buildDivisionRounds(snapshot.teams,roundRobin);

// Mirrors the existing league's match-drain factors, unused-player recovery,
// one-match default injury and red-card suspension. No economy, reward,
// chemistry growth, promotion mutation or wall-clock fitness recovery writes.
export function applyShadowRound(snapshot,round,results){
  if(round!==snapshot.shadow.round+1||results.length!==snapshot.teams.length/2)throw new Error('影子轮次不连续或比赛缺失');
  const next=copy(snapshot),seen=new Set();
  for(const {envelope,state} of results){
    if(state.phase!=='finished'||envelope.sourceFingerprint!==snapshot.fingerprint||state.version!==envelope.engineVersion||state.input.fixtureId!==envelope.input.fixtureId)throw new Error('影子结果与本轮输入不匹配');
    if(createHash('sha256').update(JSON.stringify({engineVersion:state.version,input:state.input})).digest('hex')!==envelope.fingerprint)throw new Error('影子结果输入指纹不一致');
    for(const side of [0,1]){
      const id=envelope.input.teams[side].id,team=next.teams.find(t=>t.id===id);if(!team||seen.has(id))throw new Error('影子轮次球队重复');seen.add(id);
      const own=state.score[side],against=state.score[1-side],table=team.table;table.played++;table.goalsFor+=own;table.goalsAgainst+=against;
      if(own>against){table.won++;table.points+=3;}else if(own===against){table.drawn++;table.points++;}else table.lost++;
      const played=state.players.filter(p=>p.side===side&&p.status!=='bench'),byId=new Map(played.map(p=>[p.id,p]));
      for(const id of team.rosterIds){
        const previous=team.playerState[id]??{fitness:100,suspension:0,injuryRounds:0},player=byId.get(id),before=Number(previous.fitness??100);
        const fitness=player?Math.max(35,Math.min(100,Number((before-Math.max(0,before-player.fitness)*.36*(player.role==='GK'?.5:1)).toFixed(1)))):Math.min(100,before+18);
        team.playerState[id]={...previous,fitness,suspension:player?.status==='sentOff'?Math.max(1,previous.suspension??0):Math.max(0,(previous.suspension??0)-1),
          injuryRounds:player?.injury?Math.max(1,previous.injuryRounds??0):Math.max(0,(previous.injuryRounds??0)-1)};
      }
    }
  }
  next.shadow.round=round;return refreshShadowFingerprint(next);
}
export function shadowSummary(snapshot){
  return {round:snapshot.shadow.round,standings:divisionStandings(snapshot.teams),proposedMovement:divisionMovement(snapshot.teams,`shadow:${snapshot.season.id}`),
    teams:snapshot.teams.map(t=>({id:t.id,division:t.division,table:t.table,fitness:t.rosterIds.map(id=>t.playerState[id]?.fitness??100),
      injured:t.rosterIds.filter(id=>t.playerState[id]?.injuryRounds>0),suspended:t.rosterIds.filter(id=>t.playerState[id]?.suspension>0)}))};
}
