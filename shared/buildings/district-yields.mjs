import {factoryOilSupply} from '../config/oil-economy.mjs';
import {oilDeposit} from '../config/oil-deposits.mjs';
import {TERRAIN_LABELS} from '../config/resources.mjs';
import {BUILDING_DEFINITIONS} from '../config/buildings.mjs';
import {facilityLevel} from '../config/facility-levels.mjs';
export const DISTRICT_RULES=Object.freeze({
 factory:{name:'工厂',resource:'production',resourceName:'生产力',base:4,terrain:{hills:3,forest:2,mountain:1,coastal:1},neighbors:{port:2,'club-shop':2}},
 university:{name:'大学',resource:'science',resourceName:'科技值',base:4,terrain:{mountain:3,forest:2,plains:1,coastal:1},neighbors:{'club-headquarters':2,'training-center':2,'medical-center':2}},
});
export const DISTRICT_TYPES=Object.freeze(Object.keys(DISTRICT_RULES));
export function districtSiteYield({type,level=1,world,territoryId,ownerId,metadata,resources,buildingId=null,account=null}){
 const rule=DISTRICT_RULES[type];if(!rule)return null;
 const terrain=[...new Set(resources?.territories?.[territoryId]?.terrain??[])].filter(t=>rule.terrain[t]).map(t=>({id:t,label:TERRAIN_LABELS[t],value:rule.terrain[t]}));
 // Land adjacency is undirected. Naval connections never grant adjacency yields.
 const ids=new Set([territoryId,...(metadata.get(territoryId)?.landNeighbors??[])]);
 for(const t of metadata.values())if(t.landNeighbors?.includes(territoryId))ids.add(t.territoryId);
 const neighbors=[];
 for(const id of [...ids].sort()){
  const t=world?.territories?.[id];if(t?.ownerType!=='player'||t.ownerId!==ownerId)continue;
  if(type==='factory'&&oilDeposit(id))neighbors.push({territoryId:id,type:'oil-deposit',label:'石油资源',value:1});
  for(const b of t.buildings??[])if(b.id!==buildingId&&b.status==='active')neighbors.push({territoryId:id,buildingId:b.id,type:b.type,label:BUILDING_DEFINITIONS[b.type]?.label??'奇观',value:rule.neighbors[b.type]??1});
 }
 const terrainBonus=Math.min(6,terrain.reduce((n,t)=>n+t.value,0)),adjacencyBonus=Math.min(6,neighbors.reduce((n,b)=>n+b.value,0)),baseYield=rule.base+terrainBonus+adjacencyBonus,multiplier=facilityLevel(level);
 const oilSupply=type==='factory'?factoryOilSupply(account):null,unboostedYield=baseYield*multiplier,fullYield=unboostedYield*(100+(oilSupply?.bonusPercent??0))/100;
 return {...(oilSupply?{oilSupply,unboostedYield,oilBonus:fullYield-unboostedYield}:{}),type,name:rule.name,resource:rule.resource,resourceName:rule.resourceName,buildingId,territoryId,level:multiplier,base:rule.base,terrain,neighbors,terrainBonus,adjacencyBonus,terrainCap:6,adjacencyCap:6,baseYield,multiplier,fullYield};
}
export function districtYieldsForOwner(account,world,metadata,resources){
 const sites=[];
 for(const [territoryId,t]of Object.entries(world?.territories??{}))if(t.ownerType==='player'&&t.ownerId===account.id)
  for(const b of t.buildings??[])if(DISTRICT_RULES[b.type]&&b.status==='active')sites.push(districtSiteYield({type:b.type,level:b.level,buildingId:b.id,territoryId,ownerId:account.id,world,metadata,resources,account}));
 const chosen=new Map();for(const site of sites.sort((a,b)=>b.fullYield-a.fullYield||a.buildingId.localeCompare(b.buildingId)))if(!chosen.has(site.type))chosen.set(site.type,site.buildingId);
 return sites.map(s=>({...s,operating:chosen.get(s.type)===s.buildingId}));
}
