export function conditionalPlanName(match,team,candidate) {
  if(candidate!=='opening'&&match.minute<Number(team.tacticalPlans?.[candidate]?.planAfter??0))candidate='opening';
  if(team.lastPlanChangedAt!=null&&match.flowState.elapsedSeconds-team.lastPlanChangedAt<120)return team.activePlan;
  return candidate;
}
