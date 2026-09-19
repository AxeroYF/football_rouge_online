import crypto from 'node:crypto';
import { NEUTRAL_REWARD_VERSION, NEUTRAL_REWARD_WEIGHTS } from '../../shared/config/neutral-rewards.mjs';
import { SPONSORS, SPONSOR_CONTRACT_TYPES } from '../../shared/config/sponsorship.mjs';
import { BUILDING_RULES } from '../../shared/config/buildings.mjs';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const restore=(object,before)=>{for(const k of Object.keys(object))delete object[k];Object.assign(object,before);};
export function createNeutralReward(world,territoryId) {
 const hash=crypto.createHash('sha256').update([NEUTRAL_REWARD_VERSION,world.seasonId,world.aiGenerationSeed,territoryId].join(':')).digest();
 const roll=hash.readUInt32BE(0)%100;let cumulative=0;
 const kind=Object.entries(NEUTRAL_REWARD_WEIGHTS).find(([,weight])=>roll<(cumulative+=weight))[0];
 const n=hash.readUInt32BE(4),id='neutral-reward:'+hash.toString('hex').slice(0,24);
 const amount={gold:1500+(n%21)*100,pack:1+n%2,sponsorship:1,fans:100+(n%9)*50,production:100+(n%9)*25,research:80+(n%7)*20}[kind];
 const reward={id,kind,amount,sourceTerritoryId:territoryId};
 if(kind==='sponsorship') {
  const typeRoll=hash.readUInt32BE(8)%100,type=typeRoll<70?'normal':typeRoll<90?'stadium':'team';
  const terms=SPONSOR_CONTRACT_TYPES[type];
  reward.contract={sponsorId:SPONSORS[hash.readUInt32BE(12)%SPONSORS.length].id,type,durationDays:terms.durationDays,hourlyGold:terms.hourlyGold};
 }
 return reward;
}
export class NeutralRewardService {
 constructor({world,economy,playerPacks,sponsorship,buildings,now=Date.now,save=()=>{}}){Object.assign(this,{world,economy,playerPacks,sponsorship,buildings,now,save});}
 initialize(){
  if(!this.world||this.world.neutralRewards)return false;
  this.world.neutralRewards={version:NEUTRAL_REWARD_VERSION,offers:Object.fromEntries(Object.entries(this.world.territories).map(([id,t])=>[id,{
   ...createNeutralReward(this.world,id),...(t.ownerType==='player'?{claimedBy:t.ownerId,claimedAt:this.now(),migrated:true}:{})
  }]))};return true;
 }
 preview(id){const r=this.world?.neutralRewards?.offers?.[id];if(!r||r.claimedBy)return null;return structuredClone(r);}
 award(account,challenge){
  if(challenge.previousOwner?.type!=='neutral')return null;
  const offer=this.world.neutralRewards.offers[challenge.territoryId];
  if(!offer||offer.claimedBy)return null;
  const result={type:'neutral-territory-conquest',reward:structuredClone(offer)};
  if(offer.kind==='gold'){this.economy.adjust(account,offer.amount,'neutral-conquest:'+offer.id);result.gold=offer.amount;}
  if(offer.kind==='pack')result.packs=[this.playerPacks.addPacks(account,'exotic-player-pack',offer.amount)];
  if(offer.kind==='sponsorship')result.sponsorship=this.sponsorship.grantNeutralReward(account,challenge,{...offer.contract,id:'sponsor-offer:'+offer.id,sourceChallengeId:challenge.id,sourceTerritoryId:challenge.territoryId});
  if(offer.kind==='fans'){account.resources??={};account.resources.fans=(account.resources.fans??0)+offer.amount;result.fans=offer.amount;}
  if(['production','research'].includes(offer.kind)){account.pendingNeutralRewards??=[];account.pendingNeutralRewards.push({...structuredClone(offer),receivedAt:this.now(),status:'pending'});}
  offer.claimedBy=account.id;offer.claimedAt=this.now();offer.challengeId=challenge.id;
  return result;
 }
 publicState(account){return {pending:(account.pendingNeutralRewards??[]).filter(r=>r.status==='pending').map(r=>structuredClone(r))};}
 applyToBuilding(account,reward,territory,building){
  if((building.status!=='constructing'&&!building.upgradeTo)||!building.productionWork)fail('项目已完成或不能投入生产力，请重新选择',409);
  const work=building.productionWork,remaining=work.required-work.completed;
  const applied=Math.min(remaining,reward.amount*BUILDING_RULES.productionPeriodMs);
  work.completed+=applied;work.updatedAt=this.now();
  if(work.completed>=work.required){if(building.upgradeTo){building.level=building.upgradeTo;building.upgradeCompletedAt=this.now();delete building.upgradeTo;delete building.upgradeStartedAt;}else building.builtAt=this.now();building.status='active';building.completesAt=this.now();}
  building.updatedAt=this.now();territory.version=Number(territory.version??0)+1;
  if(['wonder-competition','launch'].includes(reward.source)){
   const amount=applied/BUILDING_RULES.productionPeriodMs;reward.amount=Math.max(0,reward.amount-amount);reward.status=reward.amount>1e-9?'pending':'applied';
   reward.appliedAt=this.now();reward.targetTerritoryId=territory.territoryId;reward.buildingId=building.id;reward.appliedProduction=Number(reward.appliedProduction??0)+amount;reward.overflowProduction=0;return;
  }
  reward.status='applied';reward.appliedAt=this.now();reward.targetTerritoryId=territory.territoryId;reward.buildingId=building.id;
  reward.appliedProduction=applied/BUILDING_RULES.productionPeriodMs;reward.overflowProduction=reward.amount-reward.appliedProduction;
 }
 assignProduction(account,{rewardId,territoryId,buildingId,type}={}){
  this.buildings.settleConstructions(this.world);
  const reward=(account.pendingNeutralRewards??[]).find(r=>r.id===rewardId&&r.kind==='production');
  if(!reward)fail('待处理生产力奖励不存在',404);
  if(reward.status==='applied'){
   if(reward.targetTerritoryId!==territoryId||(buildingId&&reward.buildingId!==buildingId))fail('该奖励已投入其他项目',409);
   return {reward:structuredClone(reward),alreadyApplied:true};
  }
  const territory=this.buildings.ownedTerritory(account,this.world,territoryId);
  const beforeAccount=structuredClone(account),beforeTerritory=structuredClone(territory),revision=this.world.revision;
  try{
   if(buildingId){
    const building=territory.buildings.find(b=>b.id===buildingId);if(!building)fail('项目不存在',404);
    this.applyToBuilding(account,reward,territory,building);this.world.revision++;this.save();
   }else{
    // Validate construction and apply the reward before the same atomic save.
    this.buildings.build(account,this.world,territoryId,type,'production',building=>this.applyToBuilding(account,reward,territory,building));
   }
   return {reward:structuredClone(reward)};
  }catch(error){restore(account,beforeAccount);restore(territory,beforeTerritory);this.world.revision=revision;throw error;}
 }
}
