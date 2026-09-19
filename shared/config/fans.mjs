import { RESOURCE_HOUR_MS, YIELD_BUDGET_WEIGHTS } from './resources.mjs';

export const INITIAL_FANS = 8000;
export const FANS_PER_TERRITORY = 1000;
export const FANS_PER_HOUR = 100;
export const FAN_PREFERENCES = Object.freeze({ balanced:'综合收益', gold:'金币优先', production:'生产力优先', science:'科技值优先' });
export const validFanPreference = value => Object.hasOwn(FAN_PREFERENCES, value);
const budget = yields => Object.entries(YIELD_BUDGET_WEIGHTS).reduce((sum,[id,weight])=>sum+(yields[id]??0)/weight,0);

// One supporter serves every resource on their assigned plot. Sort by the
// chosen linear objective, then total value and ID so ties never reshuffle.
export function rankFanTerritories(territories, preference = 'balanced') {
  if (!validFanPreference(preference)) throw new Error('球迷分配偏好无效');
  const score = t => (preference === 'balanced' ? budget(t.yields) : t.yields[preference] ?? 0) * FANS_PER_TERRITORY / (t.fanRequirement ?? FANS_PER_TERRITORY);
  return [...territories].sort((a,b)=>score(b)-score(a)||budget(b.yields)-budget(a.yields)||a.territoryId.localeCompare(b.territoryId));
}
export function allocateFans(ranked, fans) {
  if (!Number.isSafeInteger(fans) || fans < 0) throw new Error('球迷数值无效');
  let remaining=fans;
  const units={gold:0,production:0,science:0};
  const sources=ranked.map(t=>{
    const requirement=t.fanRequirement??FANS_PER_TERRITORY;
    const allocated=Math.min(remaining,requirement); remaining-=allocated;
    const yields={};
    for(const id of Object.keys(units)){const value=(t.yields[id]??0)*allocated*FANS_PER_TERRITORY/requirement;units[id]+=Math.round(value);yields[id]=Math.round(value)/FANS_PER_TERRITORY;}
    return {...t,shopGold:(t.shopGoldFull??0)*allocated/requirement,baseYields:{...t.yields},yields,fans:allocated,fanRequirement:requirement};
  });
  return {sources,units,rates:{...Object.fromEntries(Object.entries(units).map(([id,n])=>[id,n/FANS_PER_TERRITORY])),territoryCount:ranked.filter(t=>!t.virtual).length},assigned:sources.filter(t=>!t.virtual).reduce((sum,t)=>sum+t.fans,0),available:remaining+sources.filter(t=>t.virtual).reduce((sum,t)=>sum+t.fans,0)};
}

// Growth is awarded every full hour. Iterate only until all owned plots are
// supported, so even a long offline interval has bounded work.
export function fanGrowthForTicks(plan,ticks){return ticks<=0?0:(plan?.firstGrowth??plan?.hourlyGrowth??FANS_PER_HOUR)+Math.max(0,ticks-1)*(plan?.hourlyGrowth??FANS_PER_HOUR);}
export function fanIncomeIntervals(plan, from, to) {
  if (!plan || to<=from) return [];
  let time=from;
  const phases=[];
  while(time<to){
    const ticks=plan.growthAt==null?0:Math.max(0,Math.floor((time-plan.growthAt)/RESOURCE_HOUR_MS));
    const fans=plan.fans+fanGrowthForTicks(plan,ticks);
    const allocation=allocateFans(plan.territories,fans);
    const next=plan.growthAt==null||fans>=plan.territories.reduce((sum,t)=>sum+(t.fanRequirement??FANS_PER_TERRITORY),0)?to:Math.min(to,plan.growthAt+(ticks+1)*RESOURCE_HOUR_MS);
    phases.push({from:time,to:next,units:allocation.units,capacity:allocation.rates.production});
    time=next;
  }
  return phases;
}
