import {playersAllied} from '../../shared/config/diplomacy.mjs';
import {transferCapturedTerritory} from '../../territory-model.js';
import {publishWorldNews} from './world-news.mjs';

export function liberationBeneficiary(world, accounts, attackerId, territoryId) {
  const t=world?.territories?.[territoryId], id=t?.originalOwnerId;
  return t?.ownerType==='player' && id && t.ownerId!==id && t.ownerId!==attackerId
    && accounts.has(id) && playersAllied(world,attackerId,id) ? id : null;
}
export function pendingLiberations(world, accounts, account) {
  return Object.entries(world?.territories??{}).flatMap(([territoryId,t])=>{
    const p=t.pendingLiberation;
    if(!p || p.captorId!==account.id || t.ownerType!=='player' || t.ownerId!==account.id)return [];
    return [{territoryId,challengeId:p.challengeId,originalOwnerId:p.originalOwnerId,
      originalOwnerName:accounts.get(p.originalOwnerId)?.draft?.teamName??accounts.get(p.originalOwnerId)?.nickname??p.originalOwnerId,
      canLiberate:accounts.has(p.originalOwnerId)&&playersAllied(world,account.id,p.originalOwnerId)}];
  });
}
export function resolveLiberation({world,accounts,account,territoryId,challengeId,action,save,now}) {
  const fail=message=>{throw Object.assign(new Error(message),{statusCode:409});};
  if(!['keep','liberate'].includes(action))fail('请选择收下或解放');
  const t=world?.territories?.[territoryId];
  // An exact replay is harmless; another player or a conflicting decision is never accepted.
  const prior=t?.liberationDecision;
  if(prior?.challengeId===challengeId && prior.captorId===account.id && prior.action===action)return {territoryId,action,ownerId:prior.ownerId};
  const p=t?.pendingLiberation;
  if(!p || !challengeId || p.challengeId!==challengeId || p.captorId!==account.id || t.ownerType!=='player' || t.ownerId!==account.id)fail('该地块的收复选择已失效');
  if(world.activeChallenges?.[territoryId])fail('地块正在比赛中，请在比赛结束后处理');
  if(action==='liberate') {
    if(t.originalOwnerId!==p.originalOwnerId || !accounts.has(p.originalOwnerId) || !playersAllied(world,account.id,p.originalOwnerId))fail('原始所有者已不是你的盟友，不能解放');
    if(t.capitalOf===account.id || account.homeTerritoryId===territoryId)fail('请先迁出自己的总部，再解放地块');
  }
  const before=structuredClone(t),playersBefore=structuredClone(world.players),revision=world.revision,news=structuredClone(world.news);
  try {
    if(action==='liberate')transferCapturedTerritory(world,p.originalOwnerId,territoryId);
    else {delete t.pendingLiberation;t.version++;world.revision++;}
    t.liberationDecision={challengeId,captorId:account.id,action,ownerId:t.ownerId,decidedAt:now};
    if(action==='liberate')publishWorldNews(world,{key:'liberation:'+challengeId,type:'liberation',createdAt:now,
      text:(account.draft?.teamName??account.nickname??account.id)+' 解放了地块 '+territoryId+'，归还给 '+(accounts.get(p.originalOwnerId)?.draft?.teamName??p.originalOwnerId)});
    save();return {territoryId,action,ownerId:t.ownerId};
  } catch(error) {
    for(const key of Object.keys(t))delete t[key];Object.assign(t,before);
    world.players=playersBefore;world.revision=revision;if(news===undefined)delete world.news;else world.news=news;throw error;
  }
}

// Only backfill provenance supported by a neutral capture record or an untouched initial home.
export function migrateOriginalOwners({world,accounts}) {
  if(!world || world.originalOwnersVersion===1)return false;
  const records=[...accounts.values()].flatMap(a=>(a.battleHistory??[]).filter(b=>b.captured && b.defender?.type==='neutral').map(b=>({...b,playerId:b.attackerId??a.id})))
    .sort((a,b)=>Number(a.settledAt??a.playedAt??0)-Number(b.settledAt??b.playedAt??0));
  for(const b of records){const t=world.territories?.[b.territoryId];if(t && accounts.has(b.playerId))t.originalOwnerId??=b.playerId;}
  for(const a of accounts.values()) {const t=world.territories?.[a.homeTerritoryId];if(t?.ownerId===a.id && t.capitalOf===a.id && t.version===1)t.originalOwnerId??=a.id;}
  world.originalOwnersVersion=1;return true;
}
