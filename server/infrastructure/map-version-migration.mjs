export function remapTerritoryReferences(value,aliases){
 if(!value||typeof value!=='object')return false;
 let changed=false;
 for(const [key,entry]of Object.entries(value)){
  if((key==='territoryId'||/TerritoryId$/.test(key))&&typeof entry==='string'&&aliases[entry]){value[key]=aliases[entry];changed=true;}
  else if((key==='territoryIds'||/TerritoryIds$/.test(key))&&Array.isArray(entry)){const mapped=[...new Set(entry.map(id=>aliases[id]??id))];if(JSON.stringify(entry)!==JSON.stringify(mapped)){value[key]=mapped;changed=true;}}
  else if(entry&&typeof entry==='object')changed=remapTerritoryReferences(entry,aliases)||changed;
 }
 return changed;
}
export function assertSafeMapMerge(saved,index){
 if(!saved?.world||!index?.mapVersion||saved.world.mapVersion===index.mapVersion)return;
 const owners=new Map(),capitals=new Map();
 for(const [id,state]of Object.entries(saved.world.territories??{})){
  const canonical=index.territoryIdAliases?.[id]??id;
  if(state.ownerType==='player'&&state.ownerId){if(!owners.has(canonical))owners.set(canonical,new Set());owners.get(canonical).add(state.ownerId);}
  if(state.capitalOf){if(!capitals.has(canonical))capitals.set(canonical,new Set());capitals.get(canonical).add(state.capitalOf);}
 }
 const conflicts=[...new Set([...owners,...capitals].filter(([,ids])=>ids.size>1).map(([id])=>id))];
 if(conflicts.length)throw Error('地图合并存在 '+conflicts.length+' 处多玩家归属冲突，已停止迁移并保留原存档：'+conflicts.join('、'));
}
