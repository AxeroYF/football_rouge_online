import {publishWorldNews} from './world-news.mjs';

// Called only after a successful, authorized capture, within the battle transaction.
export function settlePlayerDefeat({world,accounts,loserId,territoryId,territoryBefore,at}) {
 const account=accounts.get(loserId);if(!account?.setupComplete)return null;
 const remaining=(world.players[loserId]?.territoryIds??[]).filter(id=>world.territories[id]?.ownerId===loserId);
 if(remaining.length){
  if(account.homeTerritoryId!==territoryId&&territoryBefore.capitalOf!==loserId)return null;
  const destination=remaining[0],target=world.territories[destination];
  const headquarters=territoryBefore.buildings?.find(b=>b.type==='club-headquarters');
  if(headquarters){target.buildings??=[];target.buildings=target.buildings.filter(b=>b.type!=='club-headquarters');target.buildings.push(structuredClone(headquarters));}
  target.capitalOf=loserId;target.version=Number(target.version??0)+1;
  account.homeTerritoryId=destination;world.players[loserId].capitalTerritoryId=destination;world.players[loserId].exiled=false;
  publishWorldNews(world,{key:`relocate:${loserId}:${at}`,type:'headquarters-relocated',text:(account.draft?.teamName??account.nickname)+' 总部已迁移',createdAt:at});
  return {kind:'relocated',from:territoryId,to:destination,level:headquarters?.level??1};
 }
 const commandedIds=new Set(Object.values(world.coalitions??{}).filter(a=>a.commanderId===loserId).map(a=>a.id));
 const involved=m=>m.attackerId===loserId||m.defenderId===loserId||m.previousOwner?.id===loserId||m.from===loserId||m.to===loserId||m.coalitionContributors?.includes(loserId)||m.defenderCoalitionContributors?.includes(loserId)||commandedIds.has(m.coalitionId)||commandedIds.has(m.defenderCoalitionId);
 // A previous-life action must never settle against the next newly drafted team.
 for(const [id,m]of Object.entries(world.activeChallenges??{}))if(involved(m))delete world.activeChallenges[id];
 delete world.eliteChallenges?.[loserId];
 const diplomacy=world.diplomacy;
 if(diplomacy){
  for(const [key,r]of Object.entries(diplomacy.relationships??{}))if((r.players??JSON.parse(key)).includes(loserId))delete diplomacy.relationships[key];
  for(const r of Object.values(diplomacy.requests??{}))if(r.from===loserId||r.to===loserId){r.status='cancelled';r.resolvedAt=at;}
  for(const [id,m]of Object.entries(diplomacy.matches??{}))if(involved(m)||m.players?.includes(loserId)||m.a===loserId||m.b===loserId)delete diplomacy.matches[id];
 }
 const release=(army,loan)=>{const card=accounts.get(loan.ownerId)?.draft?.roster?.find(p=>p.id===loan.playerId);if(card?.coalitionLoan?.armyId===army.id)delete card.coalitionLoan;};
 for(const army of [...Object.values(world.coalitions??{}),...Object.values(world.eliteRaids?.days??{}).map(d=>d.army).filter(Boolean)]){
  const commanded=army.commanderId===loserId,removed=(army.loans??[]).filter(l=>commanded||l.ownerId===loserId);
  for(const loan of removed)release(army,loan);
  if(removed.length||commanded){army.loans=(army.loans??[]).filter(l=>!removed.includes(l));army.tactics=null;army.proposal=null;army.votes=null;army.revision++;}
  for(const r of [...(army.loanRequests??[]),...(army.commandRequests??[])])if(commanded||[r.ownerId,r.requesterId,r.commanderId].includes(loserId)){r.status='cancelled';r.resolvedAt=at;}
  if(commanded){army.commanderId=null;army.disbandedAt=at;army.closed=true;army.movement=null;army.order=null;}
 }
 const raids=world.eliteRaids;
 if(raids){
  raids.queue=(raids.queue??[]).filter(id=>id!==loserId);raids.activeIds=(raids.activeIds??[]).filter(id=>id!==loserId);
  for(const [id,m]of Object.entries(raids.matches??{}))if(involved(m)||m.contributors?.includes(loserId)){
   delete raids.matches[id];for(const d of Object.values(raids.days??{}))for(const raid of d.raids??[])if(raid.matchId===id){raid.matchId=null;raid.status='withdrawn';raid.movement=null;}
  }
  for(const d of Object.values(raids.days??{}))if(d.candidateId===loserId){d.candidateId=null;d.offerUntil=null;}
 }
 for(const t of Object.values(world.territories)){
  if(t.originalOwnerId===loserId)delete t.originalOwnerId;
  if(t.pendingLiberation?.originalOwnerId===loserId||t.pendingLiberation?.captorId===loserId)delete t.pendingLiberation;
 }
 const identity=Object.fromEntries(['id','nickname','passwordSalt','passwordHash','createdAt','lastSeenAt','mapColor'].filter(k=>Object.hasOwn(account,k)).map(k=>[k,account[k]]));
 const label=account.draft?.teamName??account.nickname;
 for(const k of Object.keys(account))delete account[k];
 Object.assign(account,identity,{token:null,setupComplete:false,homeTerritoryId:null,draft:null,expeditionPiece:null,eliminatedAt:at});
 delete world.players[loserId];
 publishWorldNews(world,{key:`eliminated:${loserId}:${at}`,type:'player-eliminated',text:label+' 已失去全部领土，本局结束',createdAt:at});
 return {kind:'eliminated',playerId:loserId};
}
