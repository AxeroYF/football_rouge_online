import {effectivePrematchFitness,prematchUnavailableReason} from './fitness-rules.js';

export const COMPETITION_LABELS=Object.freeze({league:'联赛',cup:'杯赛',friendly:'友谊赛'});
export function assignedLineupScheme(team,competition){
  return team?.lineupSchemes?.find(s=>s.id===team.lineupSchemeAssignments?.[competition])??null;
}
export function competitionAvailability(player,competition='league'){
  const fitness=effectivePrematchFitness({fitness:player.effectiveFitness??player.state?.fitness??player.fitness??100},competition,
    player.fixedFitness??null);
  const state={...player.state,fitness};
  const reason=prematchUnavailableReason({...player,state},competition);
  if(reason==='停赛'){
    const rounds=competition==='cup'?state.cupSuspension:state.suspension;
    return {fitness,unavailable:true,label:`${COMPETITION_LABELS[competition]}停赛 ${rounds}场`};
  }
  return {fitness,unavailable:Boolean(reason),label:reason==='伤缺'?`伤缺 ${state.injuryRounds}轮`:reason??`体能 ${Math.round(fitness)}`};
}
export function nextMatchLineupScheme(team,next){
  if(!next)return null;
  return next.status==='live'?next.lineupScheme:assignedLineupScheme(team,next.competition);
}
