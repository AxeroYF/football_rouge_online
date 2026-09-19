import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import {publishWorldNews,publicWorldNews} from './world-news.mjs';
import { normalizeExpeditionPiece } from '../domain/expedition-piece.mjs';
import { settleScoutUnits } from '../../shared/scouting/scout-units.mjs';
import {setAbsence} from "../../shared/football/match-availability.mjs";
import crypto from "node:crypto";
import { INTERACTION_RULES as RULES, INTERACTION_LABELS, relationKey, playerRelationship, allianceMembers, playersAllied } from "../../shared/config/diplomacy.mjs";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";
import { buildAccountMatchSeat } from "../../shared/football/account-match-seat.mjs";
import { campaignBondCatalog } from "../../shared/football/campaign-bonds.mjs";
import { createCampaignLiveLeg, advanceCampaignLiveLeg, restoreCampaignLiveLeg, publicCampaignLiveLeg } from "../../engine/campaign-match-engine.mjs";
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
const clone=value=>JSON.parse(JSON.stringify(value));
const restore=(target,value)=>{for(const key of Object.keys(target))delete target[key];Object.assign(target,value);};
const cardId=p=>String(p.id ?? p.playerId);
const name=a=>a.draft?.teamName ?? a.nickname;
const cardSignature=p=>crypto.createHash('sha256').update(JSON.stringify([cardId(p),p.name,p.grade,p.role,p.upgradeLevel,p.attributes,p.effectiveAttributes,p.traits,p.trainingBonuses])).digest('hex');

export class DiplomacyService {
 constructor({campaign}) {
  this.c=campaign;this.cursor=0;
  if(!this.c.world)return;
  this.c.world.diplomacy ??= {relationships:{},requests:{},receipts:{},matches:{},events:[]};
  for(const [key,value]of Object.entries({relationships:{},requests:{},receipts:{},matches:{},events:[]}))this.c.world.diplomacy[key]??=value;
  for(const match of Object.values(this.data().matches))if(!match.battle)restoreCampaignLiveLeg(match.leg);
  // Preserve already running PvP battles when introducing the war requirement.
  for(const match of Object.values(this.c.world.activeChallenges ?? {}))if(match.previousOwner?.type==='player' && match.attackerId!==match.defenderId) {
   const key=relationKey(match.attackerId,match.defenderId);
   if(!this.data().relationships[key])this.data().relationships[key]={players:[match.attackerId,match.defenderId].sort(),state:'war',locations:{},condemnations:{},updatedAt:this.c.now()};
  }
 }
 data(){return this.c.world?.diplomacy ?? {relationships:{},requests:{},receipts:{},matches:{},events:[]};}
 relationship(a,b){return playerRelationship(this.c.world,a,b) ?? {players:[a,b].sort(),state:'neutral',locations:{},condemnations:{}};}
 pair(a,b){return this.data().relationships[relationKey(a,b)] ??= structuredClone(this.relationship(a,b));}
 other(account,id){const other=this.c.accounts.get(id);if(!this.c.world||!account.setupComplete||!account.homeTerritoryId)fail('请先完成建队并选择总部');if(!other||other.id===account.id||!other.setupComplete||!other.homeTerritoryId)fail('请选择已建立俱乐部的其他玩家',404);return other;}
 transaction(accounts,action) {
  const snapshots=accounts.map(a=>[a,structuredClone(a)]),before=clone(this.data()),newsBefore=structuredClone(this.c.world.news);
  try{const result=action();this.c.save();return result;}catch(error){for(const [a,s]of snapshots)restore(a,s);this.c.world.diplomacy=before;if(newsBefore===undefined)delete this.c.world.news;else this.c.world.news=newsBefore;for(const match of Object.values(before.matches))if(!match.battle)restoreCampaignLiveLeg(match.leg);throw error;}
 }
 event(a,b,type){const events=this.data().events;events.push({id:crypto.randomUUID(),from:a,to:b,type,createdAt:this.c.now()});if(events.length>1000)events.splice(0,events.length-1000);}
 status(request){return request.status==='pending'&&request.expiresAt<=this.c.now()?'expired':request.status;}
 pending(a,b,type){return Object.values(this.data().requests).find(r=>this.status(r)==='pending'&&r.type===type&&relationKey(r.from,r.to)===relationKey(a,b));}
 active(account){return Object.values(this.data().matches).find(m=>!m.battle&&[m.from,m.to].includes(account.id));}
 summary(account){
  const pending=Object.values(this.data().requests).filter(r=>this.status(r)==='pending'&&r.to===account.id);
  const readIds=new Set(account.interactionReadEventIds??[]);
  const events=this.data().events.filter(e=>e.to===account.id&&e.createdAt>(account.interactionRead?.[e.from]??0)&&!readIds.has(e.id)&&!['location','friendship','alliance','conquest-access','trade','friendly','peace'].includes(e.type));
  return {news:publicWorldNews(this.c.world,account),requests:pending.map(r=>this.publicRequest(r)).sort((a,b)=>b.createdAt-a.createdAt),events:[...events].reverse(),players:[...this.c.accounts.values()].filter(a=>a.setupComplete).map(a=>({id:a.id,nickname:a.nickname,teamName:name(a),color:a.mapColor,ready:Boolean(a.setupComplete&&a.homeTerritoryId),self:a.id===account.id,state:a.id===account.id?'self':playersAllied(this.c.world,account.id,a.id)?'alliance':this.relationship(account.id,a.id).state,pending:pending.filter(r=>r.from===a.id).length,unread:events.filter(e=>e.from===a.id).length})).sort((a,b)=>Number(b.self)-Number(a.self)||b.pending-a.pending||a.teamName.localeCompare(b.teamName,'zh-CN')),incomingCount:pending.length,activeMatchId:this.active(account)?.id??null};
 }
 publicRequest(r){const payload=r.payload?{...r.payload}:null;if(payload){delete payload.giveSignatures;delete payload.takeSignatures;}return {...r,payload,status:this.status(r)};}
 publicSquad(account){
  // Build a read-only projection; never repair or expose the stored account itself.
  try {
   const seat=buildAccountMatchSeat(structuredClone(account),'expedition',this.c.now());
   const players=seat.players.map(p=>({player:createPlayerCardViewModel(p),position:seat.positions[p.id]}));
   return {formation:seat.formation,style:seat.style,tactic:seat.tactic,players,average:Number((players.reduce((n,p)=>n+(p.player.overall??0),0)/players.length).toFixed(1)),unavailable:false};
  } catch {
   return {formation:null,players:[],average:null,unavailable:true};
  }
 }
 details(account,id){
  const other=this.other(account,id),relation=this.relationship(account.id,id);
  const location=relation.state!=='war'&&(relation.locations?.[id]||playersAllied(this.c.world,account.id,id))?this.c.world.players?.[id]?.capitalTerritoryId:null;
  const metadata=location?this.c.territoryIndex?.territories.find(t=>t.territoryId===location):null;
  const requests=Object.values(this.data().requests).filter(r=>relationKey(r.from,r.to)===relationKey(account.id,id)).sort((a,b)=>Number(this.status(b)==='pending')-Number(this.status(a)==='pending')||b.createdAt-a.createdAt).slice(0,50).map(r=>this.publicRequest(r));
  const cards=a=>(a.draft?.roster??[]).map(p=>({...createPlayerCardViewModel(p),blocked:this.c.cardManagement.blocked(a,p)}));
  return {player:{id:other.id,nickname:other.nickname,teamName:name(other),color:other.mapColor},selfId:account.id,gold:account.gold,oil:this.c.oil?.view(account).balance??account.oil?.balance??0,relationship:playersAllied(this.c.world,account.id,id)?'alliance':relation.state,allianceMembers:allianceMembers(this.c.world,account.id).map(id=>({id,teamName:name(this.c.accounts.get(id)??{id})})),targetAllianceMembers:allianceMembers(this.c.world,id).map(id=>({id,teamName:name(this.c.accounts.get(id)??{id})})),condemnedByMe:Boolean(relation.condemnations?.[account.id]),condemnedMe:Boolean(relation.condemnations?.[id]),location:metadata?{territoryId:location,label:`${metadata.country} · ${metadata.name}`}:null,canUseTheirConquestLand:Boolean(playersAllied(this.c.world,account.id,id)&&relation.conquestPermissions?.[id]),allowTheirConquest:Boolean(playersAllied(this.c.world,account.id,id)&&relation.conquestPermissions?.[account.id]),sharingLocation:Boolean(relation.locations?.[account.id]),requests,myCards:cards(account),theirCards:cards(other),squad:this.publicSquad(other),
   events:this.data().events.filter(e=>relationKey(e.from,e.to)===relationKey(account.id,id)).slice(-12).reverse(),
   matches:Object.values(this.data().matches).filter(m=>relationKey(m.from,m.to)===relationKey(account.id,id)).sort((a,b)=>b.startedAt-a.startedAt).slice(0,10).map(m=>({id:m.id,from:m.from,to:m.to,startedAt:m.startedAt,completed:Boolean(m.battle),score:m.battle?.score??m.leg.match.score,minute:m.leg?.match.minute??90})),serverNow:this.c.now(),rules:RULES};
 }
 tradeTerms(account,other,input={}) {
  const amount=v=>{if(!Number.isSafeInteger(v)||v<0||v>RULES.maxTradeGold)fail('交易金币必须是有效的非负整数',400);return v;};
  const oilAmount=v=>{if(!Number.isSafeInteger(v)||v<0||v>RULES.maxTradeOil)fail('交易石油必须是有效的非负整数',400);return v;};
  const ids=v=>{if(!Array.isArray(v)||v.length>RULES.maxTradeCards||v.some(id=>typeof id!=='string')||new Set(v).size!==v.length)fail('每方最多选择 10 张不同球员卡',400);return [...v].sort();};
  const terms={giveOil:oilAmount(input.giveOil??0),takeOil:oilAmount(input.takeOil??0),giveGold:amount(input.giveGold??0),takeGold:amount(input.takeGold??0),giveCardIds:ids(input.giveCardIds??[]),takeCardIds:ids(input.takeCardIds??[])};
  if(!terms.giveGold&&!terms.takeGold&&!terms.giveOil&&!terms.takeOil&&!terms.giveCardIds.length&&!terms.takeCardIds.length)fail('请填写交易内容',400);
  if(input.mode!=null&&!['trade','gift'].includes(input.mode))fail('交易模式无效',400);
  if(input.mode==='gift'&&(terms.takeGold||terms.takeOil||terms.takeCardIds.length))fail('赠送不能要求对方付出资源或球员',400);
  const kind=terms.takeGold||terms.takeOil||terms.takeCardIds.length?'trade':'gift';
  if((this.c.oil?.view(account).balance??account.oil?.balance??0)<terms.giveOil||(this.c.oil?.view(other).balance??other.oil?.balance??0)<terms.takeOil)fail('一方石油不足，无法发起交易');
  const give=this.selectCards(account,terms.giveCardIds),take=this.selectCards(other,terms.takeCardIds);
  if(account.gold<terms.giveGold||other.gold<terms.takeGold)fail('一方金币不足，无法发起交易');
  return {...terms,kind,giveCards:give.map(createPlayerCardViewModel),takeCards:take.map(createPlayerCardViewModel),giveSignatures:give.map(cardSignature),takeSignatures:take.map(cardSignature)};
 }
 selectCards(account,ids){return ids.length?this.c.cardManagement.select(account,ids):[];}
 executeTrade(request) {
  const from=this.c.accounts.get(request.from),to=this.c.accounts.get(request.to),p=request.payload;
  const give=this.selectCards(from,p.giveCardIds),take=this.selectCards(to,p.takeCardIds);
  if(JSON.stringify(give.map(cardSignature))!==JSON.stringify(p.giveSignatures)||JSON.stringify(take.map(cardSignature))!==JSON.stringify(p.takeSignatures))fail('交易球员已发生变化，请重新发起报价');
  if(from.gold<p.giveGold||to.gold<p.takeGold)fail('一方金币不足，交易尚未完成');
  const giveOil=p.giveOil??0,takeOil=p.takeOil??0;
  let fromOil,toOil;
  if(giveOil||takeOil){
   fromOil=this.c.oil.initialize(from);toOil=this.c.oil.initialize(to);
   if(fromOil.balance<giveOil||toOil.balance<takeOil)fail('一方石油不足，交易尚未完成');
   if(!Number.isSafeInteger(fromOil.balance-giveOil+takeOil)||!Number.isSafeInteger(toOil.balance-takeOil+giveOil))fail('石油库存超出安全范围');
  }
  const transferable=(cards,receiver)=>cards.map(card=>{const copy=this.c.cardManagement.transferable(card);if(receiver.draft.roster.some(p=>cardId(p)===copy.id)){copy.id='player-card:'+crypto.randomUUID();copy.playerId=copy.id;copy.cardInstanceId=copy.id;}return copy;});
  const giveCopies=transferable(give,to),takeCopies=transferable(take,from);
  if(p.giveGold)this.c.economy.spend(from,p.giveGold,'diplomacy-trade');
  if(p.takeGold)this.c.economy.spend(to,p.takeGold,'diplomacy-trade');
  if(p.giveGold)this.c.economy.adjust(to,p.giveGold,'diplomacy-trade');
  if(p.takeGold)this.c.economy.adjust(from,p.takeGold,'diplomacy-trade');
  if(fromOil){fromOil.balance+=takeOil-giveOil;toOil.balance+=giveOil-takeOil;}
  this.c.cardManagement.remove(from,new Set(p.giveCardIds));this.c.cardManagement.remove(to,new Set(p.takeCardIds));
  giveCopies.forEach(p=>this.c.cardManagement.receive(to,p));takeCopies.forEach(p=>this.c.cardManagement.receive(from,p));
 }
 beginFriendly(from,to) {
  if(raidMatchForAccount(this.c.world,from.id)||raidMatchForAccount(this.c.world,to.id))fail('豪门远征比赛进行中');
  if(this.active(from)||this.active(to))fail('一方已有友谊赛进行中');
  const makeSeat=account=>{
   const squad=structuredClone(account);
   for(const p of squad.draft.roster){p.state={...p.state,fitness:100};setAbsence(p,'injury',0);setAbsence(p,'suspension',0);if(Object.hasOwn(p,'fitness'))p.fitness=100;}
   return buildAccountMatchSeat(squad,'expedition',this.c.now(),{fitness:true,bondCatalog:campaignBondCatalog(this.c.playerDatabase)});
  };
  const home=makeSeat(from),away=makeSeat(to),id='friendly:'+crypto.randomUUID(),startedAt=this.c.now();
  const leg=createCampaignLiveLeg({home,away,seed:id,legNumber:1,startedAt,knockout:false,weather:null});
  this.data().matches[id]={id,from:from.id,to:to.id,startedAt,leg};return id;
 }
 allianceGroup(a,b){return [...new Set([...allianceMembers(this.c.world,a),...allianceMembers(this.c.world,b)])].sort();}
 allianceProposal(a,b){
  if(playersAllied(this.c.world,a,b))fail('双方已经处于同一同盟');
  if(this.relationship(a,b).state!=='friendship')fail('必须先宣布友谊并由对方接受，才能建立同盟');
  const members=this.allianceGroup(a,b);
  if(Object.values(this.data().relationships).some(r=>r.state==='war'&&r.players.every(id=>members.includes(id))))fail('拟加入同盟的成员之间正在交战，请先达成和平');
  const enemies=[...new Set(Object.values(this.data().relationships).filter(r=>r.state==='war'&&r.players.some(id=>members.includes(id))).flatMap(r=>r.players.filter(id=>!members.includes(id))))].sort();
  return {members,memberNames:members.map(id=>name(this.c.accounts.get(id))),enemies,enemyNames:enemies.map(id=>name(this.c.accounts.get(id)))};
 }
 mergeAlliance(a,b,payload){
  const current=this.allianceProposal(a,b);
  this.c.coalitions?.assertAllianceMerge(current.members);
  if(JSON.stringify(current.members)!==JSON.stringify(payload?.members))fail('同盟成员已变化，请重新发起申请');
  for(let i=0;i<current.members.length;i++)for(let j=i+1;j<current.members.length;j++){
   const x=current.members[i],y=current.members[j],r=this.pair(x,y);r.state='alliance';r.condemnations={};r.updatedAt=this.c.now();
   this.event(x,y,'alliance-formed');this.event(y,x,'alliance-formed');
  }
  for(const enemy of current.enemies)this.declareWar(a,enemy);
  publishWorldNews(this.c.world,{key:'alliance:'+crypto.randomUUID(),type:'alliance',text:current.memberNames.join('、')+' 结成同盟',createdAt:this.c.now()});
  for(const r of Object.values(this.data().requests))if(this.status(r)==='pending'&&((r.type==='alliance'&&(current.members.includes(r.from)||current.members.includes(r.to)))||(r.type==='friendship'&&current.members.includes(r.from)&&current.members.includes(r.to))))r.status='cancelled';
 }
 declareWar(a,b){
  if(playersAllied(this.c.world,a,b))fail('请先退出同盟，不能向盟友宣战');
  const attackers=allianceMembers(this.c.world,a),defenders=allianceMembers(this.c.world,b);
  if(attackers.every(x=>defenders.every(y=>this.relationship(x,y).state==='war')))return;
  publishWorldNews(this.c.world,{key:'war:'+crypto.randomUUID(),type:'war',text:attackers.map(id=>name(this.c.accounts.get(id))).join('、')+' 向 '+defenders.map(id=>name(this.c.accounts.get(id))).join('、')+' 宣战',createdAt:this.c.now()});
  for(const x of attackers)for(const y of defenders){
   const r=this.pair(x,y);if(r.state==='war')continue;
   r.state='war';r.locations={};r.conquestPermissions={};r.updatedAt=this.c.now();r.warStartedAt=r.updatedAt;delete r.warResult;
   for(const request of Object.values(this.data().requests))if(relationKey(request.from,request.to)===relationKey(x,y)&&this.status(request)==='pending')request.status='cancelled';
   this.event(x,y,x===a&&y===b?'war':'alliance-war');this.event(y,x,'alliance-war');
  }
 }
 leaveAlliance(account){
  this.c.coalitions?.assertLeave(account);
  const members=allianceMembers(this.c.world,account.id);
  if(members.length<2)fail('你当前没有同盟');
  for(const id of members)if(id!==account.id){const r=this.pair(account.id,id);r.state='friendship';r.conquestPermissions={};r.updatedAt=this.c.now();this.event(account.id,id,'leave-alliance');}
  for(const r of Object.values(this.data().requests))if(r.type==='alliance'&&this.status(r)==='pending'&&r.payload?.members?.includes(account.id))r.status='cancelled';
  for(const r of Object.values(this.data().requests))if(r.type==='conquest-access'&&this.status(r)==='pending'&&[r.from,r.to].includes(account.id))r.status='cancelled';
  // Already paid discoveries keep their original location, candidates and deadline.
  for(const a of this.c.accounts.values()){normalizeExpeditionPiece(a,this.c.world,this.c.now());settleScoutUnits(a,this.c.world,this.c.now());}
 }
 acknowledge(account,input={}) {
  const {action,targetId,eventId,requestId}=input;
  if(!['read','read-news'].includes(action))fail('已读操作无效',400);
  if(!/^[a-zA-Z0-9:_-]{8,128}$/.test(String(requestId??'')))fail('请求标识无效',400);
  if(!account.setupComplete)fail('请先完成建队');
  const signature=JSON.stringify([targetId,action,null,null,eventId??null]),key=JSON.stringify([account.id,requestId]),prior=this.data().receipts[key];
  if(prior){if(prior.signature!==signature)fail('请求标识已用于其他操作');return prior.result;}
  if(action==='read-news'){
   if(!(this.c.world.news??[]).some(e=>e.id===eventId))fail('动态不存在',404);
  }else {
   this.other(account,targetId);
   if(eventId&&!this.data().events.some(e=>e.id===eventId&&e.to===account.id&&e.from===targetId))fail('通知不存在或无权读取',404);
  }
  const fields=['worldNewsReadIds','interactionReadEventIds','interactionRead'],before=Object.fromEntries(fields.map(k=>[k,structuredClone(account[k])]));
  try{
   if(action==='read-news')account.worldNewsReadIds=[...new Set([...(account.worldNewsReadIds??[]),eventId])].slice(-200);
   else if(eventId)account.interactionReadEventIds=[...new Set([...(account.interactionReadEventIds??[]),eventId])].slice(-1000);
   else {account.interactionRead??={};account.interactionRead[targetId]=this.c.now();}
   const result={};this.data().receipts[key]={signature,result};
   if(this.c.persist)this.c.persist();else this.c.save();
   return result;
  }catch(error){for(const k of fields){if(before[k]===undefined)delete account[k];else account[k]=before[k];}delete this.data().receipts[key];throw error;}
 }
 mutate(account,input={}) {
  if(['read-news','read'].includes(input.action))return this.acknowledge(account,input);
  const {targetId,action,requestId}=input,other=this.other(account,targetId);
  if(!/^[a-zA-Z0-9:_-]{8,128}$/.test(String(requestId??'')))fail('请求标识无效',400);
  if(!['read-news','conquest-access','revoke-conquest-access','location','friendship','alliance','leave-alliance','condemn','withdraw-condemnation','trade','friendly','war','peace','revoke-location','accept','reject','cancel','read'].includes(action))fail('互动方式不存在',400);
  const signature=JSON.stringify([targetId,action,input.proposalId??null,input.trade??null,input.eventId??null]),key=JSON.stringify([account.id,requestId]),prior=this.data().receipts[key];
  if(prior){if(prior.signature!==signature)fail('请求标识已用于其他操作');return prior.result;}
  // Settle accrued income and factory fuel before ownership of the resources changes.
  if(action==='trade'||(action==='accept'&&this.data().requests[input.proposalId]?.type==='trade'))this.c.save();
  return this.transaction([...this.c.accounts.values()],()=>{
   const relation=this.pair(account.id,targetId);let result={};
   if(['accept','reject','cancel'].includes(action)) {
    const request=this.data().requests[input.proposalId];
    if(!request||relationKey(request.from,request.to)!==relationKey(account.id,targetId))fail('互动申请不存在',404);
    if((action==='cancel'?request.from:request.to)!==account.id)fail('无权处理该申请',403);
    if(this.status(request)!=='pending')fail('申请已处理或已过期');
    if(action==='accept') {
     if(request.type==='peace') {
      if(relation.state!=='war')fail('双方当前不处于战争状态');
      if(Object.values(this.c.world.activeChallenges??{}).some(m=>relationKey(m.attackerId,m.defenderId)===relationKey(account.id,targetId)))fail('双方领土比赛仍在进行，结束后才能接受求和');
      relation.state='neutral';
     }else {
      if(relation.state==='war')fail('战争期间请先达成和平');
      if(request.type==='location')relation.locations[request.to]=true;
      if(request.type==='friendship') {if(playersAllied(this.c.world,account.id,targetId))fail('双方已经是盟友');relation.state='friendship';relation.condemnations={};}
      if(request.type==='conquest-access'){if(!playersAllied(this.c.world,account.id,targetId))fail('只有盟友可以获得借地征服授权');relation.conquestPermissions??={};relation.conquestPermissions[account.id]=true;}
      if(request.type==='alliance')this.mergeAlliance(account.id,targetId,request.payload);
      if(request.type==='trade')this.executeTrade(request);
      if(request.type==='friendly')result.matchId=this.beginFriendly(this.c.accounts.get(request.from),this.c.accounts.get(request.to));
     }
     request.status='accepted';request.matchId=result.matchId??null;
    }else request.status=action==='cancel'?'cancelled':'rejected';
    request.resolvedAt=this.c.now();result.proposalId=request.id;
    this.event(account.id,targetId,`${action}:${request.type}`);
   } else if(action==='war') {
    if(relation.state==='war')fail('双方已经处于战争状态');
    this.declareWar(account.id,targetId);
   } else if(action==='leave-alliance'){
    this.leaveAlliance(account);
   } else if(action==='condemn'||action==='withdraw-condemnation') {
    if(action==='condemn'&&playersAllied(this.c.world,account.id,targetId))fail('请先退出同盟再谴责盟友');
    relation.condemnations[account.id]=action==='condemn';
    if(action==='condemn'&&relation.state==='friendship')relation.state='neutral';
    if(action==='condemn')for(const r of Object.values(this.data().requests))if(relationKey(r.from,r.to)===relationKey(account.id,targetId)&&['friendship','alliance'].includes(r.type)&&this.status(r)==='pending')r.status='cancelled';
    this.event(account.id,targetId,action);
   } else if(action==='revoke-conquest-access'){delete relation.conquestPermissions?.[account.id];this.event(account.id,targetId,action);
   } else if(action==='revoke-location') {delete relation.locations[account.id];this.event(account.id,targetId,action);}
   else {
    if(action==='peace' ? relation.state!=='war' : relation.state==='war')fail(action==='peace'?'双方当前不处于战争状态':'战争期间请先达成和平');
    if(action==='conquest-access'){if(!playersAllied(this.c.world,account.id,targetId))fail('只能向盟友申请借地征服');if(relation.conquestPermissions?.[targetId])fail('已经获得该盟友的借地授权');}
    if(action==='friendship'&&['friendship','alliance'].includes(relation.state))fail('双方已经是朋友');
    if(action==='location'&&relation.locations[targetId])fail('对方已向你公开位置');
    if(this.pending(account.id,targetId,action))fail('双方已有同类申请待处理');
    const payload=action==='trade'?this.tradeTerms(account,other,input.trade):action==='alliance'?this.allianceProposal(account.id,targetId):null;
    const id='interaction:'+crypto.randomUUID();this.data().requests[id]={id,from:account.id,to:targetId,type:action,status:'pending',payload,createdAt:this.c.now(),expiresAt:this.c.now()+RULES.requestLifetimeMs};
    result.proposalId=id;this.event(account.id,targetId,action);
   }
   relation.updatedAt=this.c.now();this.data().receipts[key]={signature,result};return result;
  });
 }
 advance(now=this.c.now(),{maximumMatches=1,maximumChainsPerMatch=1}={}) {
  const active=Object.values(this.data().matches).filter(m=>!m.battle);let changed=false;
  for(let i=0;i<Math.min(maximumMatches,active.length);i++) {
   const match=active[(this.cursor+i)%active.length],before=match.leg.match.nextChainIndex;
   advanceCampaignLiveLeg(match.leg,now,{maximumChains:maximumChainsPerMatch});changed=changed||before!==match.leg.match.nextChainIndex;
   if(match.leg.match.finished)this.transaction([],()=>{
    advanceCampaignLiveLeg(match.leg,now,{maximumChains:0});
    const broadcast=publicCampaignLiveLeg(match.leg);
    match.battle={id:match.id,challengeId:match.id,format:'friendly-single',outcome:match.leg.match.score[0]===match.leg.match.score[1]?'draw':match.leg.match.score[0]>match.leg.match.score[1]?'win':'loss',score:[...match.leg.match.score],captured:false,settledAt:now,teams:[{name:match.leg.home.name},{name:match.leg.away.name}],broadcasts:[broadcast]};
    this.event(match.from,match.to,'friendly-finished');changed=true;
   });
  }
  this.cursor=(this.cursor+maximumMatches)%Math.max(1,active.length);return changed;
 }
 snapshot(account,id) {
  const match=this.data().matches[id];if(!match||![match.from,match.to].includes(account.id))fail('友谊赛不存在或无权查看',404);
  return match.battle?{completed:true,challenge:null,live:null,battle:match.battle}:{completed:false,challenge:{id:match.id,phase:'first-leg',format:'friendly-single'},live:{key:match.id,legNumber:1,phase:'first-leg',broadcast:publicCampaignLiveLeg(match.leg)},battle:null};
 }
}
