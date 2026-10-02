import {receipt} from './receipt-retention.mjs';
import {bondQuote,holdBond,prepareOrphanBondRefunds} from './pvp-attack-bond.mjs';
import {createPlayerCardViewModel} from '../../shared/player-card/player-card-contract.js';
import {attackCurfewState} from '../../shared/config/conquest.mjs';
import {applyMovementOilChoice,movementOilRequired} from '../../shared/config/movement-oil.mjs';
import {representativePlayers} from '../../shared/config/representative-players.mjs';
import crypto from 'node:crypto';
import {COALITION_RULES as RULES,coalitionPlayerId,coalitionContributors,coalitionOilShares} from '../../shared/config/coalition.mjs';
import {allianceMembers,canUseTerritory,canConquerFromTerritory} from '../../shared/config/diplomacy.mjs';
import {canAttackFromTerritory} from '../../territory-model.js';
import {isEliteTerritory} from '../../shared/config/elite-clubs.mjs';
import {territoryTravelEstimate,estimateUnitMove,createUnitMovement,settleUnitMovement,cancelUnitMovement} from '../domain/expedition-piece.mjs';
import {unitTravelEstimate} from './unit-travel.mjs';
import {buildAccountMatchSeat,defaultStartingEleven,defaultPositions} from '../../shared/football/account-match-seat.mjs';
import {campaignBondCatalog} from '../../shared/football/campaign-bonds.mjs';
import {biologyReduction} from '../../shared/config/advanced-research.mjs';
import {sanitizeCoalitionTactics} from './coalition-tactics.mjs';
import {applyLegConsequences} from './match-consequences.mjs';
import {restoreCampaignLiveLeg} from '../../engine/campaign-match-engine.mjs';
import {campaignTacticalPreview} from './tactical-preview.mjs';
import {publishWorldNews} from './world-news.mjs';
import {enhancementFamily} from '../../shared/config/enhancement.mjs';
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
const name=a=>a?.draft?.teamName??a?.nickname??'未知球队';
const restore=(a,b)=>{for(const k of Object.keys(a))delete a[k];Object.assign(a,b);};
export class CoalitionService {
 constructor(c){this.c=c;}
 isManagementAction(action){return ['cancel-move','lend','withdraw','kick','request-loan','accept-loan','reject-loan','transfer-command','request-command','accept-command','reject-command'].includes(action);}
 all(){return Object.values(this.c.world?.coalitions??{});}
 members(army){return allianceMembers(this.c.world,army.commanderId);}
 find(account){const members=allianceMembers(this.c.world,account.id);return this.all().find(a=>!a.disbandedAt&&members.includes(a.commanderId))??null;}
 active(army){return Object.values(this.c.world.activeChallenges??{}).find(c=>c.coalitionId===army.id||c.defenderCoalitionId===army.id);}
 busy(army){return Boolean(army.movement||army.order||this.active(army));}
 require(account,id){const army=this.c.world.coalitions?.[id];if(!army||army.disbandedAt||!this.members(army).includes(account.id))fail('联军不存在或你已不在该同盟',403);return army;}
 command(account,army){if(account.id!==army.commanderId)fail('只有联军指挥官可以下达命令',403);}
 idle(army){if(this.busy(army))fail('联军正在行动，结束后才能调整');}
 card(loan){return this.c.accounts.get(loan.ownerId)?.draft?.roster?.find(p=>p.id===loan.playerId);}
 roster(army){return army.loans.map(l=>{const p=this.card(l);if(!p||p.coalitionLoan?.armyId!==army.id)fail('借调球员状态不一致，请刷新');const copy=structuredClone(p);delete copy.coalitionLoan;return {...copy,id:coalitionPlayerId(l.ownerId,l.playerId),playerId:coalitionPlayerId(l.ownerId,l.playerId),coalitionOwnerId:l.ownerId,coalitionBiologyReduction:biologyReduction(this.c.accounts.get(l.ownerId))};});}
 projection(army){const owner=this.c.accounts.get(army.commanderId),roster=this.roster(army);return {id:army.id,setupComplete:true,nickname:army.name,draft:{teamName:army.name,roster},formationResearch:structuredClone(owner?.formationResearch),playerSquads:{schemaVersion:2,assignments:Object.fromEntries(roster.map(p=>[p.id,'expedition']))},tactics:{schemaVersion:2,activeSquadId:'expedition',squads:{expedition:structuredClone(army.tactics??{})}}};}
 assertLineup(army,tactics=army.tactics){
  const ids=tactics?.planSnapshots?.__s4V2?.starters??tactics?.starters??[];
  if(ids.length!==11||new Set(ids).size!==11)fail('联军需要 11 名首发');
  const roster=this.roster(army),players=ids.map(id=>roster.find(p=>p.id===id));if(players.some(p=>!p))fail('首发球员已变化，请重新安排');
  if(players.filter(p=>p.pool==='GK').length!==1)fail('首发需要且只能有一名门将');
  if(coalitionContributors(army).length<2)fail('联军需要至少两位盟友共同出人，首发或替补均可');
 }
 seat(army,{defending=false}={}){this.assertLineup(army);return buildAccountMatchSeat(this.projection(army),'expedition',this.c.now(),{fitness:true,fullFitness:defending,allowShortHanded:true,bondCatalog:campaignBondCatalog(this.c.playerDatabase)});}
 matchAccount(challenge){const army=this.c.world.coalitions?.[challenge.coalitionId];return army?this.projection(army):this.c.accounts.get(challenge.attackerId);}
 defenderFor(account){
  if(account?.defencePreference==='garrison')return null;
  const army=account?this.find(account):null;
  if(!army||this.busy(army)||army.cooldownUntil>this.c.now()||!army.territoryId||this.members(army).length<2)return null;
  try{const seat=this.seat(army,{defending:true});return seat.players.filter(p=>p.active!==false).length>=7?{army,seat}:null;}catch{return null;}
 }
 applyLeg(challenge,leg,at){
  if(!leg)return;
  const ids=[challenge.coalitionId,challenge.defenderCoalitionId].filter(Boolean);
  const armies=ids.map(id=>this.c.world.coalitions[id]),proxies=armies.map(army=>this.projection(army)),accounts=new Map(this.c.accounts);
  proxies.forEach(p=>accounts.set(p.id,p));
  if(!leg.fitnessApplied){
   const attacker=accounts.get(challenge.coalitionId??challenge.attackerId);
   if(attacker)this.c.fitness?.applyLeg(attacker,challenge,{...leg,fitnessApplied:false},at);
   leg.fitnessApplied=true;
  }
  applyLegConsequences(accounts,challenge,leg);
  armies.forEach((army,i)=>{for(const l of army.loans){const p=this.card(l),copy=proxies[i].draft.roster.find(p=>p.id===coalitionPlayerId(l.ownerId,l.playerId));if(p&&copy){p.state=structuredClone(copy.state);if(Object.hasOwn(copy,'fitness'))p.fitness=copy.fitness;}}});
 }
 release(army,loan){const p=this.card(loan);if(p?.coalitionLoan?.armyId===army.id){delete p.coalitionLoan;}army.loans=army.loans.filter(l=>l!==loan);army.tactics=null;army.proposal=null;army.votes=null;army.revision++;}
 prepare(at){
  if(!this.c.world)return {rollback(){}};
  const snapshot=structuredClone(this.c.world.coalitions),marks=[...this.c.accounts.values()].flatMap(a=>(a.draft?.roster??[]).map(p=>[p,structuredClone(p.coalitionLoan),a,a.playerSquads?.assignments?.[p.id]]));
  for(const army of this.all()){
   if(army.disbandedAt)continue;
   if(Object.hasOwn(army,'readyAt')){delete army.readyAt;army.revision++;}
   if(!this.active(army)){
    const commander=this.c.accounts.get(army.commanderId),owned=this.c.world.players[army.commanderId]?.territoryIds??[];
    const fallback=owned.includes(commander?.homeTerritoryId)?commander.homeTerritoryId:owned[0]??null;
    const movement=settleUnitMovement({piece:army,world:this.c.world,ownerId:army.commanderId,now:at,fallbackTerritoryId:fallback,attackDeployment:Boolean(army.order)});
    if(movement.arrived&&army.order)army.order.arrived=true;
    else if(movement.changed&&army.order&&!army.movement){army.order=null;army.lastActionError='出发地失效，出征已取消';}
    if(movement.changed)army.revision++;
   }
   for(const r of army.loanRequests??[])if(r.status==='pending'&&(r.requesterId!==army.commanderId||!this.members(army).includes(r.ownerId)||this.c.now()-r.createdAt>86400000)){r.status='cancelled';r.resolvedAt=at;army.revision++;}
   for(const r of army.commandRequests??[])if(r.status==='pending'&&(r.commanderId!==army.commanderId||!this.members(army).includes(r.requesterId)||at-r.createdAt>=86400000)){r.status='cancelled';r.resolvedAt=at;army.revision++;}
   if(this.busy(army))continue;
   const members=this.members(army);
   for(const l of [...army.loans])if(l.withdrawRequested||!members.includes(l.ownerId)||this.card(l)?.coalitionLoan?.armyId!==army.id)this.release(army,l);
  }
  return {rollback:()=>{if(snapshot===undefined)delete this.c.world.coalitions;else this.c.world.coalitions=snapshot;for(const [p,m,a,squad]of marks){if(a.playerSquads?.assignments&&squad!==undefined)a.playerSquads.assignments[p.id]=squad;if(m===undefined)delete p.coalitionLoan;else p.coalitionLoan=m;}}};
 }
 assertAllianceMerge(members){if(this.all().filter(a=>!a.disbandedAt&&members.includes(a.commanderId)).length>1)fail('两个同盟都有联军，请先解散其中一支再结盟');}
 assertLeave(account){const army=this.find(account);if(army?.commanderId===account.id)fail('请先移交联军指挥权或解散联军，再退出同盟');}
 autoTactics(army){
  const roster=this.roster(army);if(roster.length<11)return;
  const players=defaultStartingEleven(roster);
  const source={starters:players.map(p=>p.id),positions:defaultPositions(players)};
  this.assertLineup(army,source);army.tactics=sanitizeCoalitionTactics(this.projection(army),roster,source);
 }
 lend(army,account,playerId){
     this.idle(army);const player=account.draft.roster.find(p=>p.id===playerId);if(!player)fail('球员不存在');
     const reason=this.c.cardManagement.blocked(account,player);if(reason)fail(reason);
     if(this.c.diplomacy?.active(account))fail('友谊赛结束后才能借调');
     if(army.loans.length>=RULES.maxRoster)fail('联军最多 18 人');
     if(this.roster(army).some(p=>enhancementFamily(p)===enhancementFamily(player)))fail('联军不能重复借调同一球员');
     const defenders=representativePlayers(account.draft.roster).filter(p=>!p.coalitionLoan&&p.id!==player.id&&(account.playerSquads?.assignments?.[p.id]??'garrison')==='garrison');
     if(defenders.length<11||!['GK','DEF','MID','ATT'].every(pool=>defenders.some(p=>p.pool===pool)))fail('借调后留守队需保留至少 11 人及四类位置，请先补充留守球员');
     player.coalitionLoan={armyId:army.id,at:this.c.now()};army.loans.push({ownerId:account.id,playerId:player.id});army.tactics=null;army.proposal=null;army.votes=null;
 }
 loanCards(account,ownerId){
  const army=this.find(account);if(!army)fail('联军不存在');this.command(account,army);
  if(ownerId===account.id||!this.members(army).includes(ownerId))fail('只能查看当前盟友的球员',403);
  const owner=this.c.accounts.get(ownerId);if(!owner?.setupComplete)fail('盟友尚未建队');
  return {ownerId,name:name(owner),cards:owner.draft.roster.map(p=>({...createPlayerCardViewModel(p),id:p.id,loan:p.coalitionLoan??null,blocked:this.c.cardManagement.blocked(owner,p)}))};
 }
 loanNotices(account){return this.all().filter(a=>!a.disbandedAt&&this.members(a).includes(account.id)).flatMap(a=>(a.loanRequests??[]).filter(r=>r.status==='pending'&&r.ownerId===account.id).map(r=>({...r,armyId:a.id,armyName:a.name,revision:a.revision,requesterName:name(this.c.accounts.get(r.requesterId))})));}
 targetNotices(account){const army=this.find(account),p=army?.proposal;return p&&!p.confirmed&&p.beneficiaryId===account.id?[{...p,armyId:army.id,armyName:army.name,revision:army.revision}]:[];}
 commandNotices(account){const army=this.find(account);return army&&army.commanderId===account.id?(army.commandRequests??[]).filter(r=>r.status==='pending'&&r.commanderId===army.commanderId&&this.members(army).includes(r.requesterId)&&this.c.now()-r.createdAt<86400000).map(r=>({...r,armyId:army.id,requesterName:name(this.c.accounts.get(r.requesterId))})):[];}
 transferCommand(army,targetId){
  this.idle(army);const target=this.c.accounts.get(targetId);
  if(targetId===army.commanderId||!target?.setupComplete||!target.homeTerritoryId||!this.members(army).includes(targetId))fail('新指挥官必须是已建队的其他盟友');
  army.commanderId=targetId;army.proposal=null;army.votes=null;
  for(const r of [...(army.commandRequests??[]),...(army.loanRequests??[])])if(r.status==='pending'){r.status='cancelled';r.resolvedAt=this.c.now();}
 }
 readiness(army){try{if(this.members(army).length<2)fail('至少需要两位同盟成员');if(army.cooldownUntil>this.c.now())fail('联军战败休整中');if(!army.territoryId)fail('请选择同盟领土重新部署');this.seat(army);return null;}catch(e){return e.message;}}
 permission(army,targetId,beneficiaryId,route,{arrived=false}={}){
  const beneficiary=this.c.accounts.get(beneficiaryId);if(!beneficiary||!this.members(army).includes(beneficiaryId)||!coalitionContributors(army).includes(beneficiaryId))fail('占领受益人必须是当前出人盟友');
  if(!arrived||!route)this.c.assertTerritoryVisible(beneficiary,targetId);
  const metadata=this.c.territoryIndex.territories.find(t=>t.territoryId===targetId);if(!metadata||isEliteTerritory(metadata))fail('该地块不能征服');
  this.c.challenges.assertAttackAvailable(beneficiary,targetId);
  if(this.c.world.activeChallenges?.[targetId])fail('目标已有比赛进行中');
  if(this.c.world.territories[targetId]?.ownerType==='neutral'&&!canConquerFromTerritory(this.c.world,beneficiaryId,army.territoryId))fail('受益人需要取得出发地盟友的借地征服授权');
  let permission=canAttackFromTerritory(this.c.territoryIndex,this.c.world,beneficiaryId,army.territoryId,targetId,this.c.now());
  if(!permission.allowed&&permission.reason==='not-adjacent'&&route){
   const result=this.routes(army,beneficiaryId,route.sourcePoint);if(result.routes.some(r=>r.targetTerritoryId===targetId))permission={allowed:true};
  }
  if(!permission.allowed)fail('目标不满足宣战、保护期、相邻或港口航程条件');
  return beneficiary;
 }
 routes(army,beneficiaryId,sourcePoint){
  if(!this.members(army).includes(beneficiaryId)||!coalitionContributors(army).includes(beneficiaryId))fail('请选择出人盟友',403);
  if(!this.c.maritimePlanner)fail('海上航线尚未初始化');
  if(!Array.isArray(sourcePoint)||sourcePoint.length!==2||!sourcePoint.every(Number.isFinite))fail('请点击出发地海岸');
  return this.c.maritimePlanner.routesFrom(this.c.world,beneficiaryId,army.territoryId,sourcePoint);
 }
 estimate(army,body){
  if(!army.territoryId)fail('联军尚未部署');
  const territoryId=String(body.territoryId??'');
  if(body.kind==='attack')this.permission(army,territoryId,body.beneficiaryId,body.maritimeRoute);
  const travel=body.kind==='attack'?territoryTravelEstimate(this.c.territoryIndex,army.territoryId,territoryId):estimateUnitMove({piece:army,ownerId:army.commanderId,world:this.c.world,territoryIndex:this.c.territoryIndex,targetTerritoryId:territoryId});
  const oilExempt=body.kind==='attack'&&this.c.world.territories[territoryId]?.ownerType==='neutral';
  const base=unitTravelEstimate(this.c,this.c.accounts.get(army.commanderId),travel),total=oilExempt?0:movementOilRequired(base.distanceKm);
  const shares=oilExempt?[]:coalitionOilShares(this.members(army),total,army.oilCursor).map(s=>({...s,name:name(this.c.accounts.get(s.ownerId)),balance:this.c.oil.initialize(this.c.accounts.get(s.ownerId)).balance}));
  const shortage=shares.some(s=>s.balance<s.amount);
  const estimate={...base,kind:body.kind==='attack'?'attack':'move',beneficiaryId:body.beneficiaryId??null,maritimeRoute:body.maritimeRoute??null,shares,oilRequired:total,oilShortage:shortage};
  const quote=oilExempt?{...estimate,oilExempt:true,useOil:false,oilSpent:0,oilMultiplier:1,normalDurationMs:base.durationMs}:applyMovementOilChoice(estimate,body.useOil);
  if(quote.kind==='attack'&&this.c.world.territories[territoryId]?.ownerType==='player')quote.attackBond=bondQuote(this.c.accounts,this.members(army),territoryId,this.c.world.territories[territoryId].ownerId);
  const quoteIdentity=quote.attackBond?{...quote,attackBond:{...quote.attackBond,shares:quote.attackBond.shares.map(({balance,...share})=>share)}}:quote;
  quote.quoteId=crypto.createHash('sha256').update(JSON.stringify([army.id,army.revision,quoteIdentity])).digest('hex');return quote;
 }
 debit(army,quote){
  if(quote.oilSpent>0){for(const s of quote.shares){const a=this.c.accounts.get(s.ownerId),oil=this.c.oil.initialize(a);if(oil.balance<s.amount)fail('盟友库存已变化，请重新预览');}
   for(const s of quote.shares)this.c.oil.initialize(this.c.accounts.get(s.ownerId)).balance-=s.amount;
   army.oilCursor=(army.oilCursor??0)+quote.oilRequired%quote.shares.length;
  }
  army.ledger??=[];army.ledger.push({at:this.c.now(),kind:quote.kind,target:quote.toTerritoryId,total:quote.oilSpent,oilExempt:Boolean(quote.oilExempt),useOil:quote.useOil,shortage:quote.oilShortage,shares:quote.shares.map(s=>({ownerId:s.ownerId,name:s.name,amount:quote.oilSpent>0?s.amount:0}))});army.ledger=army.ledger.slice(-100);
 }
 proposal(army,body){return {territoryId:String(body.territoryId??''),beneficiaryId:String(body.beneficiaryId??''),sourceTerritoryId:army.territoryId,maritimeRoute:body.maritimeRoute??null};}
 vote(army,account,kind,targetId){
  if(!['commander','disband'].includes(kind))fail('表决类型无效',400);
  this.idle(army);const voters=coalitionContributors(army);if(!voters.length)voters.push(army.commanderId);
  if(!voters.includes(account.id))fail('只有出人者可以表决',403);
  if(kind==='commander'&&!voters.includes(targetId))fail('新指挥官必须是出人者');
  const key=JSON.stringify([kind,targetId,voters]);if(army.votes?.key!==key)army.votes={key,kind,targetId,voters,yes:[]};
  if(!army.votes.yes.includes(account.id))army.votes.yes.push(account.id);
  if(army.votes.yes.length>voters.length/2){if(kind==='disband'){for(const l of [...army.loans])this.release(army,l);army.disbandedAt=this.c.now();}else{army.commanderId=targetId;army.tactics=null;army.proposal=null;army.votes=null;}}
 }
 mutate(account,body){
  if(!account.setupComplete)fail('请先完成建队',403);
  if(!/^[\w:.-]{8,128}$/.test(String(body.requestId??'')))fail('请求编号无效',400);
  const signature=JSON.stringify(body),prior=receipt(account,'coalitionRequests',body.requestId,this.c.now());if(prior){if(prior.signature!==signature)fail('请求编号已用于其他操作');return prior.result;}
  const fast=this.isManagementAction(body.action),targetArmy=this.c.world.coalitions?.[body.armyId];
  if(!fast||this.c.economyDue(this.c.now())||targetArmy?.movement?.arrivesAt<=this.c.now())this.c.save();
  const before=fast?{army:targetArmy?structuredClone(targetArmy):null,revision:this.c.world.revision}:JSON.parse(JSON.stringify(this.c.world));
  const touched=fast?[...new Set([account,body.action==='kick'?this.c.accounts.get(body.ownerId):null].filter(Boolean))]:[...this.c.accounts.values()];
  const accounts=touched.map(a=>[a,structuredClone(a)]);
  let refundRollback=null;
  try{
   let army,result={};
   if(body.action==='defence-preference'){
    if(!['coalition','garrison'].includes(body.preference))fail('防守选项无效',400);
    account.defencePreference=body.preference;result={defencePreference:body.preference};
   }else if(body.action==='create'){
    if(!account.homeTerritoryId||!canUseTerritory(this.c.world,account.id,account.homeTerritoryId))fail('请先建立主场');
    if(allianceMembers(this.c.world,account.id).length<2)fail('请先与其他玩家建立同盟');if(this.find(account))fail('该同盟已有联军');
    const title=String(body.name??'联军').trim();if(!title||title.length>20)fail('名称需要 1～20 个字');
    army={id:'coalition:'+crypto.randomUUID(),name:title,commanderId:account.id,loans:[],territoryId:account.homeTerritoryId,movement:null,revision:1,oilCursor:0};
    this.c.world.coalitions??={};this.c.world.coalitions[army.id]=army;result={armyId:army.id};
    publishWorldNews(this.c.world,{key:army.id,type:'coalition',text:name(account)+' 发起组建 '+title,createdAt:this.c.now()});
   }else{
    army=this.require(account,body.armyId);if(body.revision!==army.revision)fail('联军状态已变化，请刷新后重试');
    const action=body.action;
    if(action==='lend'){
     this.lend(army,account,body.playerId);
    }else if(action==='request-loan'){
     this.command(account,army);const owner=this.c.accounts.get(body.ownerId);
     if(!owner||owner.id===account.id||!this.members(army).includes(owner.id))fail('只能向当前盟友申请借调',403);
     const p=owner.draft?.roster?.find(p=>p.id===body.playerId);if(!p)fail('球员不存在');
     const blocked=this.c.cardManagement.blocked(owner,p);if(blocked)fail(blocked);
     army.loanRequests??=[];if(army.loanRequests.some(r=>r.status==='pending'&&r.ownerId===owner.id&&r.playerId===p.id))fail('已申请该球员，请等待主人回复');
     if(army.loanRequests.filter(r=>r.status==='pending').length>=50)fail('待处理申请过多，请先等待回复');
     army.loanRequests=army.loanRequests.filter(r=>r.status==='pending').concat(army.loanRequests.filter(r=>r.status!=='pending').slice(-50));
     const r={id:crypto.randomUUID(),ownerId:owner.id,playerId:p.id,playerName:p.name,requesterId:account.id,status:'pending',createdAt:this.c.now()};army.loanRequests.push(r);result={loanRequestId:r.id};
    }else if(action==='accept-loan'||action==='reject-loan'){
     const r=army.loanRequests?.find(r=>r.id===body.loanRequestId);if(!r||r.status!=='pending'||r.ownerId!==account.id)fail('只能处理自己的待确认借调申请',403);
     if(this.c.now()-r.createdAt>=86400000||r.requesterId!==army.commanderId||!this.members(army).includes(r.requesterId))fail('申请人已不再管理联军');
     if(action==='accept-loan')this.lend(army,account,r.playerId);
     r.status=action==='accept-loan'?'accepted':'rejected';r.resolvedAt=this.c.now();
    }else if(action==='withdraw'||action==='kick'){
     if(action==='kick')this.command(account,army);
     const ownerId=action==='kick'?body.ownerId:account.id;
     const loan=army.loans.find(l=>l.ownerId===ownerId&&l.playerId===body.playerId);if(!loan)fail(action==='kick'?'借调球员不存在':'只能撤回自己派出的球员');
     if(this.busy(army))loan.withdrawRequested=true;else this.release(army,loan);
    }else if(action==='transfer-command'){
     this.command(account,army);this.transferCommand(army,String(body.targetId??''));
    }else if(action==='request-command'){
     if(account.id===army.commanderId)fail('你已经是指挥官');
     if(!account.homeTerritoryId)fail('请先建立主场');
     army.commandRequests??=[];
     if(army.commandRequests.some(r=>r.requesterId===account.id&&r.status==='pending'&&this.c.now()-r.createdAt<86400000))fail('已提交接任申请，请等待指挥官处理');
     army.commandRequests=army.commandRequests.filter(r=>r.status==='pending'&&this.c.now()-r.createdAt<86400000).slice(-49);
     const r={id:crypto.randomUUID(),requesterId:account.id,commanderId:army.commanderId,createdAt:this.c.now(),status:'pending'};army.commandRequests.push(r);result={commandRequestId:r.id};
    }else if(action==='accept-command'||action==='reject-command'){
     this.command(account,army);const r=army.commandRequests?.find(r=>r.id===body.commandRequestId);
     if(!r||r.status!=='pending'||r.commanderId!==army.commanderId||this.c.now()-r.createdAt>=86400000||!this.members(army).includes(r.requesterId))fail('接任申请已失效');
     if(action==='accept-command')this.transferCommand(army,r.requesterId);
     r.status=action==='accept-command'?'accepted':'rejected';r.resolvedAt=this.c.now();
    }else if(action==='cancel-move'){this.command(account,army);if(this.active(army))fail('比赛进行中，不能取消移动');result={canceledMovement:cancelUnitMovement(army,this.c.now())};army.order=null;army.proposal=null;refundRollback=prepareOrphanBondRefunds(this.c.world,this.c.accounts,this.c.now()).rollback;
    }else if(action==='vote')this.vote(army,account,body.kind,body.targetId);
    else if(action==='confirm-target'){
     if(army.proposal?.beneficiaryId!==account.id||army.proposal.id!==body.proposalId)fail('只有本次受益人可以确认该目标',403);
     this.permission(army,army.proposal.territoryId,account.id,army.proposal.maritimeRoute);army.proposal.confirmed=true;
    }else{
     this.command(account,army);this.idle(army);
     if(action==='tactics'){const projection=this.projection(army),source=body.tactics?.squads?.expedition??body.tactics;this.assertLineup(army,source);army.tactics=sanitizeCoalitionTactics(projection,projection.draft.roster,source);}
     else if(action==='auto-lineup')this.autoTactics(army);
     else if(action==='deploy'){if(army.territoryId)fail('联军已有驻地，请使用移动');if(!canUseTerritory(this.c.world,account.id,body.territoryId))fail('只能部署于同盟领土');army.territoryId=body.territoryId;}
     else if(action==='propose-target'){this.permission(army,body.territoryId,body.beneficiaryId,body.maritimeRoute);army.proposal={...this.proposal(army,body),id:crypto.randomUUID(),confirmed:body.beneficiaryId===account.id};}
     else if(action==='move'||action==='attack'){
      if(action==='attack'){const blocked=this.readiness(army);if(blocked)fail(blocked);}
      const args=action==='attack'?{...army.proposal,kind:'attack',useOil:body.useOil}:{...body,kind:'move'};
      if(action==='attack'&&(!army.proposal?.confirmed||army.proposal.sourceTerritoryId!==army.territoryId))fail('请先由占领受益人确认目标');
      const quote=this.estimate(army,args);if(quote.quoteId!==body.quoteId)fail('行程或分摊已变化，请重新预览');
      if(quote.attackBond&&!body.pvpConfirmed)fail('请确认联军进攻的30000金币保证金分摊');
      const attackBondId=quote.attackBond?holdBond(this.c.world,this.c.accounts,quote.attackBond,this.c.now()):null;
      this.debit(army,quote);army.movement=createUnitMovement(quote,this.c.now());
      if(action==='attack')army.order={...army.proposal,attackBondId,arrived:false,contributors:coalitionContributors(army)};
      army.proposal=null;result={estimate:quote};
     }else fail('未知联军操作',400);
    }
    army.revision++;
   }
   account.coalitionRequests??={};account.coalitionRequests[body.requestId]={signature,result,recordedAt:this.c.now()};this.c.world.revision++;if(fast)this.c.persist();else this.c.save();return result;
  }catch(e){refundRollback?.();if(fast){if(targetArmy&&before.army)restore(targetArmy,before.army);this.c.world.revision=before.revision;for(const [a,b]of accounts)restore(a,b);throw e;}restore(this.c.world,before);for(const c of Object.values(this.c.world.activeChallenges??{}))for(const l of [c.live?.firstLeg,c.live?.secondLeg])if(l)restoreCampaignLiveLeg(l);for(const m of Object.values(this.c.world.diplomacy?.matches??{}))if(!m.battle)restoreCampaignLiveLeg(m.leg);for(const c of Object.values(this.c.world.eliteChallenges??{}))if(c.leg)restoreCampaignLiveLeg(c.leg);for(const [a,b]of accounts)restore(a,b);throw e;}
 }
 advance(){
  let changed=false;
  for(const army of this.all())if(army.order&&(army.order.arrived||army.movement?.arrivesAt<=this.c.now())){
   if(this.active(army)){army.order=null;army.movement=null;army.revision++;this.c.save();changed=true;continue;}
   // A march may arrive after midnight; keep its order until attacks reopen.
   if(attackCurfewState(this.c.now()).active)continue;
   const order=army.order;
   try{
    this.c.save();
    if(coalitionContributors(army).some(id=>!this.members(army).includes(id)))fail('出人成员已退盟，本次出征取消');
    const beneficiary=this.permission(army,order.territoryId,order.beneficiaryId,order.maritimeRoute,{arrived:true});
    const seat=this.seat(army);
    const result=this.c.challenges.begin(beneficiary,order.territoryId,{attackBondId:order.attackBondId,coalition:{id:army.id,sourceTerritoryId:army.territoryId,seat,contributors:coalitionContributors(army)},maritimeRoute:order.maritimeRoute});
    army.lastChallengeId=result.challengeId;army.lastActionError=null;
   }catch(e){if(e.campaignPersistenceFailure)throw e;army.lastActionError=e.message;}
   army.order=null;army.movement=null;army.revision++;this.c.save();changed=true;
  }
  return changed;
 }
 view(account,{detail=true,includeTactics=true}={}){
  const army=this.find(account),members=allianceMembers(this.c.world,account.id).map(id=>({id,name:name(this.c.accounts.get(id)),oil:this.c.oil.view(this.c.accounts.get(id)).balance}));
  const defencePreference=account.defencePreference??'coalition';
  if(!army)return {army:null,members,rules:RULES,defencePreference};
  if(!detail)return {defencePreference,members,army:{id:army.id,name:army.name,revision:army.revision,commanderId:army.commanderId,territoryId:army.territoryId,movement:army.movement,activeChallengeId:this.active(army)?.id??null,lastChallengeId:army.lastChallengeId}};
  const projection=this.projection(army),active=this.active(army),curfew=attackCurfewState(this.c.now());
  return {defencePreference,rules:RULES,members,army:{...structuredClone(army),roster:projection.draft.roster.map(p=>({...p,ownerName:name(this.c.accounts.get(p.coalitionOwnerId))})),activeChallengeId:active?.id??null,blocked:this.readiness(army),busy:this.busy(army),attackBlocked:curfew.active?curfew.message:null,waitingForCurfewUntil:army.order?.arrived&&curfew.active?curfew.endsAt:null,canCommand:account.id===army.commanderId,commanderName:name(this.c.accounts.get(army.commanderId)),contributors:coalitionContributors(army)},...(includeTactics?{tacticsState:{...projection,bondCatalog:campaignBondCatalog(this.c.playerDatabase),formationResearch:this.c.formationResearch?.publicState(this.c.accounts.get(army.commanderId))}}:{}),myCards:account.draft.roster.map(p=>({...createPlayerCardViewModel(p),id:p.id,loan:p.coalitionLoan??null,blocked:this.c.cardManagement.blocked(account,p)})),serverNow:this.c.now()};
 }
 preview(account,body){const army=this.require(account,body.armyId);this.command(account,army);return campaignTacticalPreview(this.projection(army),body);}
}
