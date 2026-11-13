import {automaticSubstitutionRank,compareAutomaticSubstitutes} from '../automatic-substitution.js';
export function conditionalPlanName(match,team,candidate) {
  if(candidate!=='opening'&&match.minute<Number(team.tacticalPlans?.[candidate]?.planAfter??0))candidate='opening';
  if(team.lastPlanChangedAt!=null&&match.flowState.elapsedSeconds-team.lastPlanChangedAt<120)return team.activePlan;
  return candidate;
}
export function conditionalReplacement(match,team) {
  if(!match.parameters.state.substitutionsEnabled||team.rotationPolicy==='off'||!team.rotationPolicy||team.stats.substitutions>=5
    ||match.minute<Number(team.rotationAfter??60)||match.flowState.elapsedSeconds-Number(team.lastConditionalRotationAt??-Infinity)<300)return null;
  const candidates=team.players.filter(player=>player.active&&!player.injury&&!player.sentOff&&(player.assignedRole??player.role)!=='GK').map(player=>{
    const booked=Number(player.matchStats?.yellowCards??0)>0;
    const tired=player.state.fitness<Number(team.rotationFitness??65);
    const caution=['booked','balanced'].includes(team.rotationPolicy)&&booked;
    const fatigue=['fatigue','balanced'].includes(team.rotationPolicy)&&tired;
    return {player,caution,fatigue};
  }).filter(entry=>entry.caution||entry.fatigue).sort((a,b)=>Number(b.caution)-Number(a.caution)||a.player.state.fitness-b.player.state.fitness||String(a.player.id).localeCompare(String(b.player.id)));
  for(const {player,caution} of candidates) {
    const targetRole=player.assignedRole??player.role;
    const substitute=team.players.filter(p=>!p.active&&!p.substitutedOut&&!p.injury&&!p.sentOff
      &&automaticSubstitutionRank(targetRole,p)>0&&(caution||p.state.fitness>=player.state.fitness+5))
      .sort((a,b)=>compareAutomaticSubstitutes(targetRole,a,b))[0];
    if(substitute)return {outgoing:player,incoming:substitute,condition:caution?'yellow-card':'fitness'};
  }
  return null;
}
