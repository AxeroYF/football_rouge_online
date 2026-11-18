// Read-only scouting model. These weights are analysis choices, not match rules.
import { V2_MATCH_PARAMETERS } from '../versus/v2/match-parameters-v2.js';
import { positionFitScore, normalizePosition } from '../shared/football/schema.js';
import { applyS4Enhancement } from '../versus/s4-balance.js';

export const TIERS=['毕业级','顶级','一般','不可用'];
export const TIER_RULES={costCap:1.5,thresholds:[[2,1],[5,3.5],[9,7.5]]};
export const ROLE_LABELS={GK:'门将',CB:'中卫',LB:'左后卫',RB:'右后卫',DM:'后腰',AM:'前腰',LM:'左中场',RM:'右中场',LW:'左边锋',RW:'右边锋',ST:'中锋'};
export const METRIC_LABELS={buildUp:'组织',progression:'推进',pressResistance:'抗压持球',defensiveDuel:'防守对抗',chanceCreation:'创造机会',movement:'跑位',finishing:'终结配套',aerialFinishing:'争顶进攻',longShot:'远射配套',shotPrevention:'防线保护',goalkeeping:'门将综合',pressing:'压迫',discipline:'纪律',save:'扑救',shot:'射门执行',aerialShot:'头球终结',aerialDefense:'制空防守',freeKick:'任意球',cross:'边路传中',stamina:'续航'};
export const METRICS={...V2_MATCH_PARAMETERS.metrics,
 save:{goalkeeping:.52,reflexes:.32,positioning:.16},
 shot:{finishing:.5,composure:.3,offBall:.2},
 aerialShot:{heading:.42,jumping:.2,composure:.2,finishing:.18},
 aerialDefense:{heading:.38,jumping:.26,strength:.2,marking:.16},
 freeKick:{setPieces:.46,longShots:.28,composure:.16,finishing:.1},
 // Cross is an explicitly authored scouting component; other components above
 // come from the spatial parameters or shot/set-piece resolution formulas.
 cross:{crossing:.55,passing:.25,vision:.2},stamina:{stamina:1}};
const spec=(id,name,roles,weights)=>({id,name,roles,weights});
export const PROFILES=[
 spec('keeper','门线扑救',['GK'],{save:.92,goalkeeping:.05,buildUp:.03}),
 spec('keeperBuild','出球门将',['GK'],{save:.8,buildUp:.15,progression:.05}),
 spec('stopper','防守中卫',['CB'],{defensiveDuel:.46,shotPrevention:.32,aerialDefense:.12,buildUp:.05,stamina:.05}),
 spec('ballCB','出球中卫',['CB'],{defensiveDuel:.38,shotPrevention:.27,aerialDefense:.1,buildUp:.12,pressResistance:.08,stamina:.05}),
 spec('fullback','防守边卫',['LB','RB'],{defensiveDuel:.37,shotPrevention:.26,progression:.12,pressing:.1,buildUp:.08,stamina:.07}),
 spec('wingback','助攻边卫',['LB','RB'],{defensiveDuel:.26,shotPrevention:.16,cross:.23,progression:.15,buildUp:.08,stamina:.12}),
 spec('anchor','拦截后腰',['DM'],{defensiveDuel:.37,shotPrevention:.22,buildUp:.16,pressResistance:.1,pressing:.08,stamina:.07}),
 spec('regista','组织后腰',['DM'],{buildUp:.28,pressResistance:.19,progression:.18,defensiveDuel:.15,shotPrevention:.08,stamina:.07,freeKick:.05}),
 spec('creator','组织前腰',['AM'],{chanceCreation:.31,buildUp:.22,pressResistance:.16,movement:.11,shot:.06,stamina:.07,freeKick:.07}),
 spec('attackingAM','进攻前腰',['AM'],{shot:.25,movement:.22,pressResistance:.2,chanceCreation:.16,longShot:.1,stamina:.07}),
 spec('wideCreator','边路组织',['LM','RM'],{chanceCreation:.28,cross:.24,progression:.19,movement:.12,buildUp:.1,stamina:.07}),
 spec('wideWorker','往返边中场',['LM','RM'],{progression:.25,cross:.2,chanceCreation:.2,pressing:.16,defensiveDuel:.1,stamina:.09}),
 spec('wingScorer','内切边锋',['LW','RW'],{shot:.3,movement:.25,pressResistance:.22,progression:.16,stamina:.07}),
 spec('wingCreator','创造型边锋',['LW','RW'],{chanceCreation:.27,cross:.23,progression:.23,pressResistance:.12,movement:.08,stamina:.07}),
 spec('poacher','跑位终结',['ST'],{shot:.43,movement:.26,pressResistance:.14,finishing:.1,stamina:.07}),
 spec('target','支点抢点',['ST'],{aerialShot:.3,aerialFinishing:.2,shot:.25,pressResistance:.12,buildUp:.06,stamina:.07}),
 spec('linkForward','串联前锋',['ST'],{shot:.28,buildUp:.22,chanceCreation:.16,pressResistance:.18,movement:.09,stamina:.07}),
];
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const round=n=>Math.round(n*100)/100;
const weighted=(object,weights)=>Object.entries(weights).reduce((n,[k,w])=>n+object[k]*w,0);
export const isSpecial=p=>['古德温','梅老鼠'].includes(p.name);
export function eligibleRoles(player){return [...new Set([player.role,player.secondaryRole].filter(Boolean).map(r=>normalizePosition(r,player.preferredFoot)))].filter(r=>Object.hasOwn(ROLE_LABELS,r));}
export function scoreProfiles(player,level=0){
 const enhanced=applyS4Enhancement(player,level,{attributeSettings:{unlocked:false,baseMaximum:99,overflowRate:0}});
 const attributes=enhanced.attributes;
 const metrics=Object.fromEntries(Object.entries(METRICS).map(([k,w])=>[k,weighted(attributes,w)]));
 // Actual aerial selection/defence uses height. Limit its scouting contribution
 // so this proxy does not pretend a selection advantage is a goal probability.
 metrics.aerialFinishing+=clamp((Number(player.heightCm??180)-180)*.65,-8,8);
 metrics.aerialDefense+=clamp((Number(player.heightCm??180)-180)*.55,-8,8);
 return eligibleRoles(player).flatMap(role=>PROFILES.filter(p=>p.roles.includes(role)).map(profile=>{
  const fit=clamp(positionFitScore(player,role),.35,1.04), execution=(.72+100/357)*(.72+fit*.28);
  const attributeWeights={};
  for(const [metric,w] of Object.entries(profile.weights))for(const [key,v] of Object.entries(METRICS[metric]))attributeWeights[key]=(attributeWeights[key]??0)+w*v;
  return {role,profile:profile.id,profileName:profile.name,quality:weighted(metrics,profile.weights)*execution,fit,execution,
   attributeWeights,metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,round(v*execution)])),
   key:role+':'+profile.id};
 }));
}
export function classify(gap,adjustedGap){
 // Cost alone cannot erase a large real performance gap.
 for(let i=0;i<TIER_RULES.thresholds.length;i++)if(gap<=TIER_RULES.thresholds[i][0]&&adjustedGap<=TIER_RULES.thresholds[i][1])return TIERS[i];
 return TIERS[3];
}
export function evaluate(entries,lambda=.5){
 const leaders=new Map();
 for(const row of entries.filter(x=>!isSpecial(x.player)))for(const score of row.scores){const old=leaders.get(score.key);if(!old||score.quality>old.quality||(score.quality===old.quality&&row.player.overall<old.overall))leaders.set(score.key,{id:row.player.id,name:row.player.name,overall:row.player.overall,quality:score.quality});}
 return entries.map(({player,scores})=>({player,scores:scores.map(score=>{
  const leader=leaders.get(score.key);if(!leader)throw new Error('No normal benchmark: '+score.key);
  const gap=leader.quality-score.quality, bonus=clamp((leader.overall-player.overall)*lambda,-TIER_RULES.costCap,TIER_RULES.costCap),adjustedGap=gap-bonus;
  return {...score,leader,gap,bonus,adjustedGap,tier:classify(gap,adjustedGap),pureTier:classify(gap,gap),index:100-adjustedGap};
 })}));
}
export function best(scores,role=null){
 return scores.filter(s=>!role||s.role===role).slice().sort((a,b)=>TIERS.indexOf(a.tier)-TIERS.indexOf(b.tier)||b.index-a.index||b.quality-a.quality)[0]??null;
}
