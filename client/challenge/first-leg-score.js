// Keep first-leg team order explicit: legacy second legs can reverse home/away.
export function firstLegScoreText(snapshot) {
  const leg=snapshot?.challenge?.firstLeg??snapshot?.battle?.broadcasts?.find(leg=>leg.legNumber===1);
  if(!leg?.score||!leg?.teams?.length)return '';
  return `首回合：${leg.teams[0]?.name??'进攻方'} ${leg.score[0]} : ${leg.score[1]} ${leg.teams[1]?.name??'防守方'}`;
}
