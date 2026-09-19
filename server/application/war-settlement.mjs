import {allianceMembers,relationKey,playersAtWar} from '../../shared/config/diplomacy.mjs';
import {publishWorldNews} from './world-news.mjs';

// Settle the two participating alliances only; unrelated wars remain in force.
export function endHeadquartersWar({world,accounts,winnerId,loserId,territoryId,at,key}) {
 if(!playersAtWar(world,winnerId,loserId))return null;
 const winners=allianceMembers(world,winnerId),losers=allianceMembers(world,loserId),ended=new Set();
 for(const a of winners)for(const b of losers){
  const pair=relationKey(a,b),r=world.diplomacy.relationships[pair];
  if(r?.state!=='war')continue;
  r.state='neutral';r.locations={};r.conquestPermissions={};r.updatedAt=at;
  r.warResult={winnerId,loserId,territoryId,endedAt:at,reason:'headquarters-captured'};
  ended.add(pair);
 }
 for(const request of Object.values(world.diplomacy.requests??{}))if(request.status==='pending'&&ended.has(relationKey(request.from,request.to))){request.status='cancelled';request.resolvedAt=at;}
 // Keep live match objects and RNG intact. Even a later declaration cannot revive these captures.
 for(const challenge of Object.values(world.activeChallenges??{}))if(ended.has(relationKey(challenge.attackerId,challenge.defenderId)))challenge.warEndedAt=at;
 const label=id=>accounts.get(id)?.draft?.teamName??accounts.get(id)?.nickname??id;
 publishWorldNews(world,{key:'headquarters-war:'+key,type:'war-ended',text:label(winnerId)+' 攻下了 '+label(loserId)+' 的总部，双方同盟战争结束',createdAt:at});
 world.revision=Number(world.revision??0)+1;
 return {winnerId,loserId,territoryId,winners,losers,endedAt:at};
}

export function repairHeadquartersWars(world,accounts,now) {
 if(!world?.diplomacy||world.diplomacy.headquartersSettlementVersion>=1)return false;
 for(const loser of accounts.values()){
  const territoryId=loser.homeTerritoryId,owner=world.territories?.[territoryId];
  if(owner?.ownerType!=='player'||owner.ownerId===loser.id||!playersAtWar(world,owner.ownerId,loser.id))continue;
  const relation=world.diplomacy.relationships[relationKey(owner.ownerId,loser.id)];
  const declarationAt=Math.max(0,...(world.diplomacy.events??[]).filter(e=>['war','alliance-war'].includes(e.type)&&relationKey(e.from,e.to)===relationKey(owner.ownerId,loser.id)).map(e=>Number(e.createdAt)||0));
  const warStartedAt=Number((relation.warStartedAt??(declarationAt||relation.updatedAt))||0);
  const battle=(accounts.get(owner.ownerId)?.battleHistory??[]).find(b=>b.captured&&b.territoryId===territoryId&&b.defender?.type==='player'&&b.defender.id===loser.id&&Number(b.settledAt)>0&&b.settledAt>=warStartedAt);
  if(battle)endHeadquartersWar({world,accounts,winnerId:owner.ownerId,loserId:loser.id,territoryId,at:now,key:battle.challengeId??battle.id??territoryId});
 }
 world.diplomacy.headquartersSettlementVersion=1;
 return true;
}
