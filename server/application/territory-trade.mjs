import {BUILDING_DEFINITIONS} from '../../shared/config/buildings.mjs';
const fail=message=>{throw Object.assign(Error(message),{statusCode:409});};
export function territoryTradeIds(value=[]){if(!Array.isArray(value)||value.length>3||value.some(x=>typeof x!=='string')||new Set(value).size!==value.length)fail('每方最多交易3块不同地块');return [...value].sort();}
export function territoryTradeContext(c){
 const busy=new Set(),wars=new Set(),buildingTerritories=new Map(Object.entries(c.world.territories).flatMap(([id,t])=>(t.buildings??[]).map(b=>[b.id,id])));
 const add=id=>{if(typeof id==='string'&&c.world.territories[id])busy.add(id);};
 // Only current locations and live routes reserve land. Receipts, origins and
 // battle history can contain old territory IDs indefinitely.
 const location=value=>{if(!value)return;for(const key of ['territoryId','fromTerritoryId','toTerritoryId','sourceTerritoryId','targetTerritoryId'])add(value[key]);for(const key of ['path','fromTerritoryIds'])for(const id of value[key]??[])add(id);};
 const unit=value=>{if(!value)return;add(value.territoryId);location(value.movement);};
 for(const a of c.accounts.values()){
  unit(a.expeditionPiece);for(const scout of Object.values(a.scouting?.units??{}))unit(scout);
  for(const tasks of [a.scouting?.tasks,a.training?.tasks,a.medicalTasks])for(const task of Object.values(tasks??{}))if(task.claimedAt==null&&task.completedAt==null&&task.cancelledAt==null&&task.closedAt==null){location(task);add(buildingTerritories.get(task.buildingId));}
 }
 for(const challenge of Object.values(c.world.activeChallenges??{})){location(challenge);location(challenge.maritimeRoute);}
 for(const army of Object.values(c.world.coalitions??{}))if(!army.disbandedAt){unit(army);location(army.order);location(army.order?.maritimeRoute);}
 const raids=c.world.eliteRaids;
 for(const match of Object.values(raids?.matches??{}))location(match);
 for(const day of Object.values(raids?.days??{}))for(const raid of day.raids??[]){
  if(!['moving','waiting','battle'].includes(raid.status))continue;
  if(day.endsAt<=c.now()&&raid.status!=='battle')continue;
  location(raid.movement);location(raid.route?.[raid.index??0]);
 }
 for(const r of Object.values(c.world.diplomacy?.relationships??{}))if(r.state==='war')for(const id of r.players)wars.add(id);
 return {busy,wars};
}
export function territoryTradeBlock(c,a,id,context){
 const t=c.world.territories[id];
 if(!t||t.ownerType!=='player'||t.ownerId!==a.id)return '地块不属于该玩家';
 if(context.wars.has(a.id))return '交战玩家暂不能交易地块';
 if(t.capitalOf||a.homeTerritoryId===id)return '首都不可交易';
 for(const b of t.buildings??[]){const rule=BUILDING_DEFINITIONS[b.type];if(b.wonderId||!rule||rule.maxPerPlayer===1||rule.capitalOnly)return '含奇观或唯一建筑，暂不可交易';if(b.status!=='active'||b.upgradeTo||b.raidSuppressed)return '建筑施工、升级或压制中';}
 if(t.pendingLiberation||t.raidSuppression||t.raidSuppressed||t.suppressedUntil>c.now())return '地块存在未完成事件或压制';
 if(context.busy.has(id))return '地块涉及单位、行军或战斗任务';
 if((c.world.players[a.id]?.territoryIds??[]).filter(x=>c.world.territories[x]?.ownerId===a.id).length<=1)return '不能交易最后一块领地';
 return null;
}
export function territoryTradeSelection(c,a,ids,context=territoryTradeContext(c)){
 return territoryTradeIds(ids).map(id=>{const blocked=territoryTradeBlock(c,a,id,context);if(blocked)fail(blocked);const t=c.world.territories[id],meta=c.territoryIndex.territories.find(x=>x.territoryId===id);return {id,label:meta?[meta.country,meta.name].filter(Boolean).join(' · '):id,version:t.version,protectedUntil:t.protectedUntil??null,buildings:(t.buildings??[]).map(b=>({id:b.id,type:b.type,level:b.level,label:BUILDING_DEFINITIONS[b.type]?.label,name:b.name??null}))};});
}
export function territoryTradeChoices(c,a,b){const context=territoryTradeContext(c);return Object.fromEntries([['give',a],['take',b]].map(([side,owner])=>[side,(c.world.players[owner.id]?.territoryIds??[]).filter(id=>!territoryTradeBlock(c,owner,id,context)).map(id=>territoryTradeSelection(c,owner,[id],context)[0])]));}
export function transferTradedTerritory(c,from,to,id){
 const t=c.world.territories[id];c.world.players[from.id].territoryIds=c.world.players[from.id].territoryIds.filter(x=>x!==id);
 c.world.players[to.id].territoryIds=[...new Set([...c.world.players[to.id].territoryIds,id])];
 t.ownerId=to.id;t.originalOwnerId=to.id;delete t.liberationDecision;
 t.lastTrade={from:from.id,to:to.id,at:c.now()};t.version++;c.world.revision++;
}
