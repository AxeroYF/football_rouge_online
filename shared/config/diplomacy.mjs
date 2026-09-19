export const INTERACTION_RULES = Object.freeze({ requestLifetimeMs: 24 * 60 * 60 * 1000, maxTradeCards: 10, maxTradeGold: 1000000000, maxTradeOil: 1000000 });
export const INTERACTION_LABELS = Object.freeze({ "conquest-access":"申请借地征服", "revoke-conquest-access":"撤销借地授权", location: "开放俱乐部位置", friendship: "宣布友谊", condemn: "谴责", trade: "交易", friendly: "友谊赛", war: "宣战", peace: "求和", alliance: "建立同盟", "leave-alliance": "退出同盟" });
export const relationKey = (a, b) => JSON.stringify([String(a), String(b)].sort());
export const playerRelationship = (world, a, b) => world?.diplomacy?.relationships?.[relationKey(a,b)] ?? null;
export const playersAtWar = (world, a, b) => Boolean(a && b && a !== b && playerRelationship(world,a,b)?.state === "war");
export function sharedHeadquarters(world, viewerId) {
  const result=[];
  for(const relation of Object.values(world?.diplomacy?.relationships ?? {})) {
    if(!relation.players.includes(viewerId) || relation.state === "war") continue;
    for(const ownerId of relation.players) if(ownerId !== viewerId && relation.locations?.[ownerId]) {
      const territoryId=world.players?.[ownerId]?.capitalTerritoryId;
      if(territoryId && world.territories?.[territoryId]?.ownerId === ownerId) result.push(territoryId);
    }
  }
  return [...new Set(result)].sort();
}

export function allianceMembers(world, playerId) {
 if(!playerId)return [];
 if(world?.viewerId===playerId&&Array.isArray(world.alliedPlayerIds))return [playerId,...world.alliedPlayerIds];
 const members=new Set([playerId]);let changed=true;
 while(changed){changed=false;for(const r of Object.values(world?.diplomacy?.relationships??{})){
  if(r.state!=='alliance'||!r.players?.some(id=>members.has(id)))continue;
  for(const id of r.players)if(!members.has(id)){members.add(id);changed=true;}
 }}
 return [...members].sort();
}
export const playersAllied=(world,a,b)=>Boolean(a&&b&&a!==b&&allianceMembers(world,a).includes(b));
export function canUseTerritory(world,playerId,territoryId){
 const t=world?.territories?.[territoryId];
 return Boolean(t&&t.ownerType==='player'&&(t.ownerId===playerId||playersAllied(world,playerId,t.ownerId)));
}
export function alliedTerritoryIds(world,playerId){
 const allies=new Set(allianceMembers(world,playerId).filter(id=>id!==playerId));
 return Object.keys(world?.territories??{}).filter(id=>world.territories[id].ownerType==='player'&&allies.has(world.territories[id].ownerId));
}

export function canConquerFromTerritory(world,playerId,territoryId){
 const ownerId=world?.territories?.[territoryId]?.ownerId;
 if(ownerId===playerId)return true;
 if(!playersAllied(world,playerId,ownerId))return false;
 return world.viewerId===playerId?Boolean(world.conquestHostIds?.includes(ownerId)):Boolean(playerRelationship(world,playerId,ownerId)?.conquestPermissions?.[ownerId]);
}
