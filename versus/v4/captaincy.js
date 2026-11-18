export function captainModifiers(state,side){
  const team=state.input.teams[side],captain=state.players.find(p=>p.side===side&&p.id===team.captainId&&p.active&&!p.injury);
  if(!captain)return {stage:{},foulMultiplier:1,cardMultiplier:1,directRedMultiplier:1};
  const mode=state.score[side]>state.score[1-side]?'leading':state.score[side]<state.score[1-side]?'trailing':'level';
  return team.captainPlans?.[mode]??{stage:{},foulMultiplier:1,cardMultiplier:1,directRedMultiplier:1};
}
