import crypto from 'node:crypto';
import { SPONSORS, SPONSOR_CONTRACT_TYPES, SPONSORSHIP_VERSION, SPONSOR_HOUR_MS, SPONSOR_DAY_MS,
 NEUTRAL_SPONSOR_REWARD, sponsorById, activeSponsorContracts, sponsoredTeamName } from '../../shared/config/sponsorship.mjs';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const restore=(object,before)=>{for(const k of Object.keys(object))delete object[k];Object.assign(object,before);};
const integer=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw Error(label+'无效');return value;};
const elapsedHours=(c,now)=>Math.floor(Math.max(0,Math.min(now,c.expiresAt)-c.signedAt-(c.pausedMs??0))/SPONSOR_HOUR_MS);
const clock=value=>integer(value,'赞助时间');

export class SponsorshipService {
 constructor({economy,now=Date.now,save=()=>{}}){this.economy=economy;this.now=now;this.save=save;}
 migrateAccount(account){
  if(account.sponsorship===undefined){account.sponsorship={schemaVersion:1,offers:[],contracts:[],payments:[]};return true;}
  const state=account.sponsorship;
  if(state?.schemaVersion!==1||!Array.isArray(state.offers)||!Array.isArray(state.contracts)||!Array.isArray(state.payments))throw Error('赞助合同存档无效');
  for(const c of state.contracts){
   if(!sponsorById(c.sponsorId)||!SPONSOR_CONTRACT_TYPES[c.type]||!['active','expired'].includes(c.status))throw Error('赞助合同类型无效');
   integer(c.signedAt,'签约时间');integer(c.expiresAt,'到期时间');integer(c.hourlyGold,'赞助金额');integer(c.paidHours,'已付小时');integer(c.pausedMs??0,'暂停时长');
   if(c.expiresAt<=c.signedAt+(c.pausedMs??0)||(c.expiresAt-c.signedAt-(c.pausedMs??0))%SPONSOR_HOUR_MS||c.hourlyGold<=0||c.paidHours>(c.expiresAt-c.signedAt-(c.pausedMs??0))/SPONSOR_HOUR_MS)throw Error('赞助合同期限或付款记录无效');
  }
  return false;
 }
 // The challenge ID is server-generated. A retry always gets the same roll, brand and tier.
 rewardForChallenge(account,challenge){
  if(challenge?.previousOwner?.type!=='neutral'||!challenge.id||!challenge.territoryId)return null;
  const digest=crypto.createHash('sha256').update(SPONSORSHIP_VERSION+':'+account.id+':'+challenge.id).digest();
  if(digest.readUInt32BE(0)/0x100000000>=NEUTRAL_SPONSOR_REWARD.chance)return null;
  const roll=digest.readUInt32BE(4)/0x100000000*100;
  let cumulative=0;const type=Object.entries(NEUTRAL_SPONSOR_REWARD.weights).find(([,weight])=>roll<(cumulative+=weight))?.[0] ?? 'team';
  const sponsor=SPONSORS[digest.readUInt32BE(8)%SPONSORS.length];
  return {sponsorId:sponsor.id,type,...SPONSOR_CONTRACT_TYPES[type],
   id:'sponsor-offer:'+digest.toString('hex').slice(0,24),sourceChallengeId:challenge.id,sourceTerritoryId:challenge.territoryId};
 }
 grantNeutralReward(account,challenge,plannedReward=null){
  const reward=plannedReward??this.rewardForChallenge(account,challenge);if(!reward)return null;
  this.migrateAccount(account);
  let offer=account.sponsorship.offers.find(o=>o.sourceChallengeId===challenge.id);
  if(!offer){const {name,limit,benefit,...terms}=reward;offer={...terms,status:'pending',createdAt:clock(this.now())};account.sponsorship.offers.push(offer);}
  return this.offerView(account,offer,this.now());
 }
 due(accounts,timestamp=this.now()){
  const now=clock(timestamp);
  return [...accounts.values()].some(a=>(a.sponsorship?.contracts??[]).some(c=>c.status==='active'&&(elapsedHours(c,now)>c.paidHours||now>=c.expiresAt)));
 }
 // Payments follow signing time plus server pauses; player absence still accrues normally.
 prepare(accounts,timestamp=this.now()){
  const now=clock(timestamp),snapshots=[];
  const rollback=()=>{for(const [account,before] of snapshots){account.gold=before.gold;account.goldLedger=before.goldLedger;account.sponsorship=before.sponsorship;}};
  try{
   for(const account of accounts.values()){
    if(!(account.sponsorship?.contracts??[]).some(c=>c.status==='active'&&(elapsedHours(c,now)>c.paidHours||now>=c.expiresAt)))continue;
    snapshots.push([account,{gold:account.gold,goldLedger:[...(account.goldLedger??[])],sponsorship:account.sponsorship}]);
    account.sponsorship=structuredClone(account.sponsorship);
    for(const c of account.sponsorship.contracts){
     if(c.status!=='active')continue;
     const hours=elapsedHours(c,now),count=Math.max(0,hours-c.paidHours);
     if(count){
      const amount=integer(count*c.hourlyGold,'赞助收益');
      this.economy.adjust(account,amount,'sponsor-income:'+c.sponsorId);
      account.sponsorship.payments.push({contractId:c.id,sponsorId:c.sponsorId,fromHour:c.paidHours,toHour:hours,amount,paidAt:now});
      c.paidHours=hours;
     }
     if(now>=c.expiresAt){c.status='expired';c.expiredAt=c.expiresAt;}
    }
    account.sponsorship.payments=account.sponsorship.payments.slice(-100);
   }
   return {rollback};
  }catch(error){rollback();throw error;}
 }
 signatureBlock(account,offer,now){
  const active=activeSponsorContracts(account,now),type=SPONSOR_CONTRACT_TYPES[offer.type];
  if(active.some(c=>c.sponsorId===offer.sponsorId))return '该品牌已有生效合同';
  if(active.filter(c=>c.type===offer.type).length>=type.limit)return type.name+'名额已满';
  return null;
 }
 offerView(account,offer,now=this.now()){
  const type=SPONSOR_CONTRACT_TYPES[offer.type],sponsor=sponsorById(offer.sponsorId);
  if(!type||!sponsor)throw Error('赞助报价存档无效');
  const blockedReason=offer.status==='pending'?this.signatureBlock(account,offer,now):null;
  const durationDays=offer.durationDays*(this.wonders?.modifiers(account).sponsorDurationMultiplier??1);
  return {...offer,durationDays,typeName:type.name,sponsor,totalGold:offer.hourlyGold*durationDays*24,canSign:offer.status==='pending'&&!blockedReason,blockedReason};
 }
 respond(account,offerIdValue,action){
  if(!account?.setupComplete)fail('请先完成初始建队');
  if(!['accept','reject'].includes(action))fail('请选择签约或放弃');
  this.migrateAccount(account);
  if(this.due(new Map([[account.id,account]])))this.save();
  const offer=account.sponsorship.offers.find(o=>o.id===String(offerIdValue??''));
  if(!offer)fail('赞助合同不存在',404);
  if(offer.status===(action==='accept'?'accepted':'rejected'))return this.publicState(account);
  if(offer.status!=='pending')fail('该合同已经处理',409);
  const now=clock(this.now());
  if(action==='accept'){
   const blocked=this.signatureBlock(account,offer,now);if(blocked)fail(blocked,409);
   if(!Number.isSafeInteger(offer.durationDays)||offer.durationDays<=0||!Number.isSafeInteger(offer.hourlyGold)||offer.hourlyGold<=0)throw Error('赞助报价金额或期限无效');
  }
  const before=structuredClone(account);
  try{
   offer.status=action==='accept'?'accepted':'rejected';offer.resolvedAt=now;
   if(action==='accept')account.sponsorship.contracts.push({id:'sponsor-contract:'+offer.id.slice('sponsor-offer:'.length),offerId:offer.id,
    sponsorId:offer.sponsorId,type:offer.type,durationDays:offer.durationDays*(this.wonders?.modifiers(account).sponsorDurationMultiplier??1),hourlyGold:offer.hourlyGold,
    sourceTerritoryId:offer.sourceTerritoryId,signedAt:now,expiresAt:now+offer.durationDays*SPONSOR_DAY_MS*(this.wonders?.modifiers(account).sponsorDurationMultiplier??1),status:'active',paidHours:0});
   this.save();return this.publicState(account);
  }catch(error){restore(account,before);throw error;}
 }
 publicState(account,now=this.now()){
  const state=account.sponsorship??{offers:[],contracts:[],payments:[]},active=activeSponsorContracts(account,now);
  return {version:SPONSORSHIP_VERSION,brands:SPONSORS,types:Object.values(SPONSOR_CONTRACT_TYPES),
   offers:state.offers.filter(o=>o.status==='pending').map(o=>this.offerView(account,o,now)),
   contracts:state.contracts.filter(c=>c.status==='active'||c.expiresAt>now-7*SPONSOR_DAY_MS).map(c=>({...c,
    status:now>=c.expiresAt?'expired':c.status,sponsor:sponsorById(c.sponsorId),typeName:SPONSOR_CONTRACT_TYPES[c.type].name,
    totalGold:c.hourlyGold*c.durationDays*24,earnedGold:c.paidHours*c.hourlyGold,
    remainingMs:Math.max(0,c.expiresAt-now),nextPaymentAt:now<c.expiresAt?c.signedAt+(c.pausedMs??0)+(c.paidHours+1)*SPONSOR_HOUR_MS:null})),
   slots:Object.fromEntries(Object.values(SPONSOR_CONTRACT_TYPES).map(t=>[t.id,{used:active.filter(c=>c.type===t.id).length,limit:t.limit}])),
   hourlyGold:active.reduce((sum,c)=>sum+c.hourlyGold,0),teamDisplayName:sponsoredTeamName(account,now),reward:NEUTRAL_SPONSOR_REWARD,
   payments:state.payments.slice(-20).reverse()};
 }
 resourceSources(account,now=this.now()){
  return activeSponsorContracts(account,now).map(c=>({id:'sponsorship:'+c.id,type:'sponsorship',
   label:sponsorById(c.sponsorId).name+' · '+SPONSOR_CONTRACT_TYPES[c.type].name,
   yields:{gold:c.hourlyGold,production:0,science:0}}));
 }
}
