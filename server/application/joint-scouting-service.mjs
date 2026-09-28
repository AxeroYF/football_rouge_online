import crypto from 'node:crypto';
import {JOINT_SCOUTING_RULES as RULES,scoutingLevel,SCOUTING_RULES} from '../../shared/config/scouting.mjs';
import {CORE_COUNTRY_CODES} from '../../shared/config/countries.mjs';
import {playersAtWar} from '../../shared/config/diplomacy.mjs';
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
// Invitations contain a price/quality snapshot, never candidates. The diplomacy transaction
// owns both debits and both account-local result queues, including save failure rollback.
export class JointScoutingService {
 constructor(campaign){this.c=campaign;if(campaign.world)campaign.world.jointScoutingSeed??=crypto.randomUUID();this.sites();}
 sites(){
  const c=this.c;if(!c.world)return {rotationId:null,expiresAt:0,territories:[]};
  const rotationId=Math.floor(c.now()/RULES.rotationMs);
  if(this.cachedSites?.rotationId!==rotationId){
   const pool=(c.territoryIndex?.territories??[]).filter(t=>t.playable!==false&&Array.isArray(t.centroid)&&c.world.territories[t.territoryId]);
   const ranked=pool.map(t=>({t,key:crypto.createHash('sha256').update(c.world.jointScoutingSeed+':'+rotationId+':'+t.territoryId).digest('hex')})).sort((a,b)=>a.key.localeCompare(b.key));
   this.cachedSites={rotationId,expiresAt:(rotationId+1)*RULES.rotationMs,territories:ranked.slice(0,RULES.siteCount).map(({t})=>({id:t.territoryId,label:c.scouting.label(t.territoryId)}))};
  }
  c.world.jointScoutSites=this.cachedSites;return this.cachedSites;
 }
 quote(a,b,territoryId,rounds){
  const c=this.c,s=c.scouting;
  if(!Number.isInteger(rounds)||rounds<1||rounds>RULES.maxQueueRounds)fail('联合考察为 1～30 轮',400);
  if(playersAtWar(c.world,a.id,b.id))fail('战争期间不能联合考察');
  const sites=this.sites();if(!sites.territories.some(t=>t.id===territoryId))fail('该联合考察点已轮换，请重新选择',409);
  const levels=[a,b].map(x=>s.levelRules(x,c.world));if(levels.some(r=>!r.available))fail('双方都需要已建成的球探中心');
  const level=Math.min(...levels.map(r=>r.level));
  const perPlayerRoundGold=Math.ceil(Math.max(...levels.map(r=>r.costGold))*RULES.costMultiplier/2);
  const legendaryChance=scoutingLevel(level).legendaryChance*RULES.legendaryMultiplier;
  return {rotationId:sites.rotationId,expiresAt:sites.expiresAt,territoryId,territoryLabel:s.label(territoryId),rounds,level,perPlayerRoundGold,perPlayerGold:perPlayerRoundGold*rounds,totalGold:perPlayerRoundGold*rounds*2,legendaryChance,enhancementWeights:{...RULES.enhancementWeights}};
 }
 idle(a,id,territoryId){
  const s=this.c.scouting,u=s.unit(a,id);s.requireIdle(a,u);
  if(u.territoryId!==territoryId)fail('双方球探需先移动到选定地块集合');
  const rules=s.levelRules(a,this.c.world);
  if(s.tasks(a).filter(t=>t.scoutId&&t.claimedAt==null&&t.completesAt>this.c.now()).length>=rules.scoutCapacity)fail('球探中心并行容量已满');
  return u;
 }
 options(a,b){
  const s=this.c.scouting,sites=this.sites(),territories=sites.territories;
  const scouts=s.units(a).filter(u=>!u.movement&&!s.tasks(a).some(t=>t.scoutId===u.id&&t.claimedAt==null)).map(u=>({id:u.id,name:u.name,territoryId:u.territoryId}));
  return {rules:RULES,scouts,territories,expiresAt:sites.expiresAt,quote:territories.length?this.quote(a,b,territories[0].id,1):null};
 }
 propose(a,b,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('联合考察参数无效',400);
  const quote=this.quote(a,b,input.territoryId,input.rounds);const unit=this.idle(a,input.scoutId,input.territoryId);
  if(a.gold<quote.perPlayerGold||b.gold<quote.perPlayerGold)fail('一方金币不足');
  return {...quote,scoutId:unit.id,scoutName:unit.name};
 }
 accept(request,receiverScoutId){
  const c=this.c,s=c.scouting,a=c.accounts.get(request.from),b=c.accounts.get(request.to),p=request.payload;
  const quote=this.quote(a,b,p.territoryId,p.rounds);
  if(JSON.stringify(quote)!==JSON.stringify(Object.fromEntries(Object.keys(quote).map(k=>[k,p[k]]))))fail('考察费用或规则已变化，请重新发起邀请');
  const units=[this.idle(a,p.scoutId,p.territoryId),this.idle(b,receiverScoutId,p.territoryId)];
  if([a,b].some(x=>x.gold<quote.perPlayerGold))fail('一方金币不足');
  const duration=Math.max(...[a,b].map(x=>s.timing(x,c.world,p.territoryId).durationMs)),startedAt=c.now(),countryCode=s.metadataById.get(p.territoryId).countryCode;
  const database=s.playerDatabase.filter(p=>p?.id&&!p.isX&&['C','B','A','S'].includes(p.grade)),weights=scoutingLevel(p.level).gradeWeights;
  const prepared={database,normal:database.filter(p=>weights[p.grade]>0),grades:Object.fromEntries(['C','B','A','S'].map(g=>[g,database.filter(p=>p.grade===g)]))};
  for(const [i,owner]of [a,b].entries()){
   const partner=i===0?b:a,unit=units[i];
   const rounds=Array.from({length:p.rounds},()=>({candidates:s.draw(p.level,countryCode,s.wonders?.modifiers(owner).scoutChoices??SCOUTING_RULES.choiceCount,prepared,{legendaryChance:p.legendaryChance,enhancementWeights:p.enhancementWeights})}));
   const id='scouting:'+crypto.randomUUID();
   const task={id,requestId:'joint:'+request.id,scoutId:unit.id,scoutName:unit.name,buildingId:unit.originBuildingId,territoryId:p.territoryId,territoryLabel:p.territoryLabel,countryCode,coreCountry:CORE_COUNTRY_CODES.includes(countryCode),level:p.level,costGold:p.perPlayerGold,roundCount:p.rounds,roundDurationMs:duration,startedAt,completesAt:startedAt+duration*p.rounds,rounds,candidates:rounds[0].candidates,claimedAt:null,joint:{proposalId:request.id,partnerId:partner.id,partnerName:partner.draft?.teamName??partner.nickname,legendaryChance:p.legendaryChance,enhancementWeights:p.enhancementWeights}};
   c.economy.spend(owner,p.perPlayerGold,'joint-scouting');(owner.scouting.tasks??={})[id]=task;
  }
  return {jointStarted:true};
 }
}
