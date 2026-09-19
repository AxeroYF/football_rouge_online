import {scoutingLevel,scoutingGradeProbabilities} from './scouting.mjs';
export const facilityLevel = value => Math.max(1,Math.min(5,Math.trunc(Number(value)||1)));
const row = (values, level) => values[facilityLevel(level)-1];
export const HEADQUARTERS_FANS = Object.freeze([0,6500,9000,14000,22000]);
export const STADIUM_CAPACITIES = Object.freeze([30000,40000,50000,65000,80000]);
export const FACILITY_UPGRADES = Object.freeze({
 "airport":{gold:[18000],production:[1200]},
 "oil-well":{gold:[5000],production:[500]},
 "factory":{gold:[8000,16000,40000,90000,200000],production:[600,1000,2400,5200,11000]},
 "university":{gold:[8000,16000,40000,90000,200000],production:[600,1000,2400,5200,11000]},
 "club-headquarters":{gold:[0,20000,50000,120000,280000],production:[0,1000,2500,6000,14000]},
 "main-stadium":{gold:[5000,15000,35000,80000,180000],production:[800,1200,2500,5500,12000]},
 "scout-center":{gold:[5000,15000,35000,80000,180000],production:[400,800,1800,4000,9000]},
 "training-center":{gold:[5000,15000,35000,80000,180000],production:[400,800,1800,4000,9000]},
 "medical-center":{gold:[5000,10000,24000,56000,128000],production:[350,600,1400,3200,7200]},
 "recovery-center":{gold:[5000,10000,24000,56000,128000],production:[300,600,1400,3200,7200]},
 "port":{gold:[5000,15000,35000,80000,180000],production:[500,1000,2200,5000,11000]},
 "club-shop":{gold:[5000,8000,16000,32000,64000],production:[250,500,1000,2000,4000]},
});
export function facilityEffects(type,level=1){
 const L=facilityLevel(level);
 switch(type){
 case 'airport':return {flightDurationMs:60000};
 case 'oil-well':return {oilPerHour:3};
 case 'factory':return {yieldMultiplier:L,resource:'production'};
 case 'university':return {yieldMultiplier:L,resource:'science'};
 case 'club-headquarters':return {facilityLevelLimit:L,fanGrowth:row([100,120,140,170,200],L)};
 case 'main-stadium':return {seatingCapacity:row(STADIUM_CAPACITIES,L)};
 case 'training-center':return {capacityPerPool:L,totalCapacity:L*4,coreBias:row([0,.1,.2,.3,.4],L),durationMs:600000,attributePoints:5};
 case 'scout-center':return {scoutCapacity:row([2,2,3,3,4],L),costGold:700};
 case 'medical-center':return {capacity:L,durationMs:row([20,16,12,10,8],L)*60000,costGold:row([800,700,600,500,400],L),injuryRoundsReduced:1};
 case 'recovery-center':return {recoveryPerMinute:row([1,1.25,1.5,1.75,2],L),recoveryRadiusKm:row([150,225,300,375,450],L)};
 case 'port':return {rangeKm:row([1200,1500,1800,2200,2600],L),timeMultiplier:row([.9,.85,.8,.75,.7],L)};
 case 'club-shop':return {goldPerHour:row([60,120,220,360,540],L)};
 default:return {};
 }
}
export function headquartersLevel(account,world){
 const t=world?.territories?.[account?.homeTerritoryId??world?.players?.[account?.id]?.capitalTerritoryId];
 const b=t?.ownerId===account?.id?t.buildings?.find(b=>b.type==='club-headquarters'&&b.status==='active'):null;
 return b?facilityLevel(b.level):1;
}
export function facilityEffectText(type,level){
 const e=facilityEffects(type,level);
 return ({'airport':'己方及盟友机场间运输 · 1 分钟抵达 · 只消耗金币','oil-well':'每小时开采 3 单位石油，库存可累积；仅能建在含油地块，不可升级','factory':`生产力 = 选址基础产出 × ${e.yieldMultiplier}；基础 4 + 地形加成 + 邻接加成，按球迷覆盖率折算`,'university':`科技值 = 选址基础产出 × ${e.yieldMultiplier}；基础 4 + 地形加成 + 邻接加成，按球迷覆盖率折算`,'club-headquarters':`设施等级上限 LV${e.facilityLevelLimit} · 球迷每小时 +${e.fanGrowth}`,'main-stadium':`球场容量 ${Number(e.seatingCapacity).toLocaleString('zh-CN')} 席`,'training-center':`每组 ${e.capacityPerPool} 席，共 ${e.totalCapacity} 席 · 核心倾向 ${Math.round((e.coreBias??0)*100)}%`,'scout-center':`球探上限 ${e.scoutCapacity} 人 · 发掘 ${e.costGold} 金币`,'medical-center':`${e.capacity} 个床位 · ${e.durationMs/60000} 分钟 · ${e.costGold} 金币/人 · 伤停减少 1 回合`,'recovery-center':`本地块及半径 ${e.recoveryRadiusKm} 公里内己方及盟友远征队每分钟恢复 ${e.recoveryPerMinute} 体力（重叠取最高）`,'port':`航程 ${e.rangeKm} 公里 · 海运时间减少 ${Math.round((1-(e.timeMultiplier??1))*100)}%`,'club-shop':`满球迷覆盖时 +${e.goldPerHour} 金币/小时`})[type]??'';
}

// Compare the same quantities, with units once per pair, so upgrade gains are explicit.
export function facilityUpgradeText(type,level){
 if(type==='oil-well'||type==='airport')return '单等级设施，不可升级';
 if(facilityLevel(level)>=5)return '已满级';
 const a=facilityEffects(type,level),b=facilityEffects(type,facilityLevel(level)+1);
 const pair=(label,key,unit='',convert=v=>v)=>`${label} ${convert(a[key])} → ${convert(b[key])}${unit}`;
 const minutes=v=>v/60000,percent=v=>Math.round(v*100),number=v=>Number(v).toLocaleString('zh-CN');
 return ({
  'factory':()=>[pair('生产力倍率','yieldMultiplier',' 倍')],
  'university':()=>[pair('科技值倍率','yieldMultiplier',' 倍')],
  'club-headquarters':()=>[pair('设施等级上限','facilityLevelLimit',' 级'),pair('球迷增长','fanGrowth',' 人/小时')],
  'main-stadium':()=>[pair('容量','seatingCapacity',' 席',number)],
  'training-center':()=>[pair('每组席位','capacityPerPool',' 席'),pair('总席位','totalCapacity',' 席'),pair('核心倾向','coreBias','%',percent)],
   'scout-center':()=>{
   const probabilities=L=>Object.fromEntries(scoutingGradeProbabilities(scoutingLevel(L)).map(e=>[e.grade,e.percent]));
   const from=probabilities(level),to=probabilities(facilityLevel(level)+1),format=n=>Number((n??0).toFixed(2));
   return [pair('球探上限','scoutCapacity',' 人'),pair('发掘费用','costGold',' 金币/轮'),...['C','B','A','S'].map(g=>`${g}级概率 ${format(from[g])} → ${format(to[g])}%`)];
  },
  'medical-center':()=>[pair('床位','capacity',' 个'),pair('治疗时间','durationMs',' 分钟',minutes),pair('治疗费用','costGold',' 金币/人')],
  'recovery-center':()=>[pair('范围','recoveryRadiusKm',' 公里'),pair('恢复','recoveryPerMinute',' 体力/分钟')],
  'port':()=>[pair('航程','rangeKm',' 公里'),pair('海运时间减免','timeMultiplier','%',v=>Math.round((1-v)*100))],
  'club-shop':()=>[pair('满覆盖收益','goldPerHour',' 金币/小时')],
 })[type]?.().join(' · ')??'';
}
