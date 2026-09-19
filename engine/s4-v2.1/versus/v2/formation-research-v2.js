// Values come from the campaign's confirmed formation and completed levels.
export function formationResearchMultiplier(levels,metric,role){
 if(role==='GK')return 1;
 const level=levels?.[metric];return 1+(Number.isInteger(level)?Math.max(0,Math.min(5,level)):0)/100;
}
export function researchedShotMetric(base,levels,type,role){
 const metric=type==='longShot'?'longShot':['cross','setPiece'].includes(type)?'aerialFinishing':['penalty','freeKick'].includes(type)?null:'finishing';
 return base*formationResearchMultiplier(levels,metric,role);
}
