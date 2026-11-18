export const MINIMUM_MATCH_FITNESS = 45;
export function normalizeFitnessThreshold(value, fallback=65){
  const n=String(value??'').trim()===''?NaN:Number(value);
  const safe=Number.isFinite(Number(fallback))?Number(fallback):65;
  return Math.max(MINIMUM_MATCH_FITNESS,Math.min(100,Math.round(Number.isFinite(n)?n:safe)));
}
export const belowFitnessThreshold=(fitness,threshold)=>Number(fitness)<normalizeFitnessThreshold(threshold);
export function effectivePrematchFitness(state={},competition='league',fixed=null){
  const value=Number(fixed??(competition==='friendly'?100:state.fitness??100));
  return Number.isFinite(value)?Math.max(0,Math.min(100,value)):0;
}
export function prematchUnavailableReason(player,competition='league'){
  if(player.blockedReason)return player.blockedReason;
  if(Number(player.state?.injuryRounds??0)>0)return '伤缺';
  const key=competition==='cup'?'cupSuspension':competition==='season-final'?'seasonFinalSuspension':'suspension';
  if(competition!=='friendly'&&Number(player.state?.[key]??0)>0)return '停赛';
  if(Number(player.state?.fitness??0)<MINIMUM_MATCH_FITNESS)return `体能不足${MINIMUM_MATCH_FITNESS}`;
  return null;
}
