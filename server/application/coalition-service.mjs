import {attackCurfewState} from '../../shared/config/conquest.mjs';
import {applyMovementOilChoice} from '../../shared/config/movement-oil.mjs';
import {representativePlayers} from '../../shared/config/representative-players.mjs';
import crypto from 'node:crypto';
import {COALITION_RULES as RULES,coalitionPlayerId,coalitionContributors,coalitionOilShares} from '../../shared/config/coalition.mjs';
import {allianceMembers,canUseTerritory,canConquerFromTerritory} from '../../shared/config/diplomacy.mjs';
import {canAttackFromTerritory} from '../../territory-model.js';
import {isEliteTerritory} from '../../shared/config/elite-clubs.mjs';
import {territoryTravelEstimate} from '../domain/expedition-piece.mjs';
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
 all(){return Object.values(this.c.world?.coalitions??{});}
 members(army){return allianceMembers(this.c.world,army.commanderId);}
 find(account){const members=allianceMembers(this.c.world,account.id);return this.all().find(a=>!a.disbandedAt&&members.includes(a.commanderId))??null;}
 active(army){return Object.values(this.c.world.activeChallenges??{}).find(c=>c.coalitionId===army.id);}
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
 seat(army){this.assertLineup(army);return buildAccountMatchSeat(this.projection(army),'expedition',this.c.now(),{fitness:true,allowShortHanded:true,bondCatalog:campaignBondCatalog(this.c.playerDatabase)});}
 matchAccount(challenge){const army=this.c.world.coalitions?.[challenge.coalitionId];return army?this.projection(army):this.c.accounts.get(challenge.attackerId);}
 applyLeg(challenge,leg,at){
  if(!challenge.coalitionId){this.c.fitness?.applyLeg(this.c.accounts.get(challenge.attackerId),challenge,leg,at);applyLegConsequences(this.c.accounts,challenge,leg);return;}
  const army=this.c.world.coalitions[challenge.coalitionId],proxy=this.matchAccount(challenge),accounts=new Map(this.c.accounts);accounts.set(army.id,proxy);
  this.c.fitness?.applyLeg(proxy,challenge,leg,at);applyLegConsequences(accounts,challenge,leg);
  for(const l of army.loans){const p=this.card(l),copy=proxy.draft.roster.find(p=>p.id===coalitionPlayerId(l.ownerId,l.playerId));if(p&&copy){p.state=structuredClone(copy.state);if(Object.hasOwn(copy,'fitness'))p.fitness=copy.fitness;}}
 }
 release(army,loan){const p=this.card(loan);if(p?.coalitionLoan?.armyId===army.id){delete p.coalitionLoan;}army.loans=army.loans.filter(l=>l!==loan);army.tactics=null;army.votes=null;army.revision++;}
 prepare(at){
  if(!this.c.world)return {rollback(){}};
  const snapshot=structuredClone(this.c.world.coalitions),marks=[...this.c.accounts.values()].flatMap(a=>(a.draft?.roster??[]).map(p=>[p,structuredClone(p.coalitionLoan),a,a.playerSquads?.assignments?.[p.id]]));
  for(const army of this.all()){
   if(army.disbandedAt)continue;
   if(Object.hasOwn(army,'readyAt')){delete army.readyAt;army.revision++;}
   if(army.movement?.transport!=='airport'&&army.movement&&at>=army.movement.arrivesAt){if(army.order)army.order.arrived=true;else army.territoryId=army.movement.toTerritoryId;army.movement=null;army.revision++;}
   if(this.busy(army))continue;
   const members=this.members(army);
   for(const l of [...army.loans])if(l.withdrawRequested||!members.includes(l.ownerId)||this.card(l)?.coalitionLoan?.armyId!==army.id)this.release(army,l);
   if(!canUseTerritory(this.c.world,army.commanderId,army.territoryId)){army.territoryId=null;army.revision++;}
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
  else if(!canUseTerritory(this.c.world,army.commanderId,territoryId)||territoryId===army.territoryId)fail('请选择其他同盟领土');
  const base=territoryTravelEstimate(this.c.territoryIndex,army.territoryId,territoryId),total=Math.max(1,Math.ceil(base.distanceKm/250))*2;
  const shares=coalitionOilShares(this.members(army),total,army.oilCursor).map(s=>({...s,name:name(this.c.accounts.get(s.ownerId)),balance:this.c.oil.view(this.c.accounts.get(s.ownerId)).balance}));
  const shortage=shares.some(s=>s.balance<s.amount);
  const quote=applyMovementOilChoice({...base,kind:body.kind==='attack'?'attack':'move',beneficiaryId:body.beneficiaryId??null,maritimeRoute:body.maritimeRoute??null,shares,oilRequired:total,oilShortage:shortage},body.useOil);
  quote.quoteId=crypto.createHash('sha256').update(JSON.stringify([army.id,army.revision,quote])).digest('hex');return quote;
 }
 debit(army,quote){
  if(quote.oilSpent>0){for(const s of quote.shares){const a=this.c.accounts.get(s.ownerId),oil=this.c.oil.initialize(a);if(oil.balance<s.amount)fail('盟友库存已变化，请重新预览');}
   for(const s of quote.shares)this.c.oil.initialize(this.c.accounts.get(s.ownerId)).balance-=s.amount;
   army.oilCursor=(army.oilCursor??0)+quote.oilRequired%quote.shares.length;
  }
  army.ledger??=[];army.ledger.push({at:this.c.now(),kind:quote.kind,target:quote.toTerritoryId,total:quote.oilSpent,useOil:quote.useOil,shortage:quote.oilShortage,shares:quote.shares.map(s=>({ownerId:s.ownerId,name:s.name,amount:quote.oilSpent>0?s.amount:0}))});army.ledger=army.ledger.slice(-100);
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
  const signature=JSON.stringify(body),prior=account.coalitionRequests?.[body.requestId];if(prior){if(prior.signature!==signature)fail('请求编号已用于其他操作');return prior.result;}
  this.c.save();
  const before=JSON.parse(JSON.stringify(this.c.world)),accounts=[...this.c.accounts.values()].map(a=>[a,structuredClone(a)]);
  try{
   let army,result={};
   if(body.action==='create'){
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
     this.idle(army);const player=account.draft.roster.find(p=>p.id===body.playerId);if(!player)fail('球员不存在');
     const reason=this.c.cardManagement.blocked(account,player);if(reason)fail(reason);
     if(this.c.diplomacy?.active(account))fail('友谊赛结束后才能借调');
     if(army.loans.length>=RULES.maxRoster)fail('联军最多 18 人');
     if(this.roster(army).some(p=>enhancementFamily(p)===enhancementFamily(player)))fail('联军不能重复借调同一球员');
     const defenders=representativePlayers(account.draft.roster).filter(p=>!p.coalitionLoan&&p.id!==player.id&&(account.playerSquads?.assignments?.[p.id]??'garrison')==='garrison');
     if(defenders.length<11||!['GK','DEF','MID','ATT'].every(pool=>defenders.some(p=>p.pool===pool)))fail('借调后留守队需保留至少 11 人及四类位置，请先补充留守球员');
     player.coalitionLoan={armyId:army.id,at:this.c.now()};army.loans.push({ownerId:account.id,playerId:player.id});army.tactics=null;army.proposal=null;army.votes=null;
    }else if(action==='withdraw'){
     const loan=army.loans.find(l=>l.ownerId===account.id&&l.playerId===body.playerId);if(!loan)fail('只能撤回自己派出的球员');
     if(this.busy(army))loan.withdrawRequested=true;else this.release(army,loan);
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
      const blocked=this.readiness(army);if(blocked)fail(blocked);
      const args=action==='attack'?{...army.proposal,kind:'attack',useOil:body.useOil}:{...body,kind:'move'};
      if(action==='attack'&&(!army.proposal?.confirmed||army.proposal.sourceTerritoryId!==army.territoryId))fail('请先由占领受益人确认目标');
      const quote=this.estimate(army,args);if(quote.quoteId!==body.quoteId)fail('行程或分摊已变化，请重新预览');
      this.debit(army,quote);army.movement={fromTerritoryId:army.territoryId,toTerritoryId:quote.toTerritoryId,useOil:quote.useOil,oilSpent:quote.oilSpent,normalDurationMs:quote.normalDurationMs,durationMs:quote.durationMs,startedAt:this.c.now(),arrivesAt:this.c.now()+quote.durationMs};
      if(action==='attack')army.order={...army.proposal,arrived:false,contributors:coalitionContributors(army)};
      army.proposal=null;result={estimate:quote};
     }else fail('未知联军操作',400);
    }
    army.revision++;
   }
   account.coalitionRequests??={};account.coalitionRequests[body.requestId]={signature,result};this.c.world.revision++;this.c.save();return result;
  }catch(e){restore(this.c.world,before);for(const c of Object.values(this.c.world.activeChallenges??{}))for(const l of [c.live?.firstLeg,c.live?.secondLeg])if(l)restoreCampaignLiveLeg(l);for(const m of Object.values(this.c.world.diplomacy?.matches??{}))if(!m.battle)restoreCampaignLiveLeg(m.leg);for(const c of Object.values(this.c.world.eliteChallenges??{}))if(c.leg)restoreCampaignLiveLeg(c.leg);for(const [a,b]of accounts)restore(a,b);throw e;}
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
    const result=this.c.challenges.begin(beneficiary,order.territoryId,{coalition:{id:army.id,sourceTerritoryId:army.territoryId,seat,contributors:coalitionContributors(army)},maritimeRoute:order.maritimeRoute});
    army.lastChallengeId=result.challengeId;army.lastActionError=null;
   }catch(e){if(e.campaignPersistenceFailure)throw e;army.lastActionError=e.message;}
   army.order=null;army.movement=null;army.revision++;this.c.save();changed=true;
  }
  return changed;
 }
 view(account,{detail=true}={}){
  const army=this.find(account),members=allianceMembers(this.c.world,account.id).map(id=>({id,name:name(this.c.accounts.get(id)),oil:this.c.oil.view(this.c.accounts.get(id)).balance}));
  if(!army)return {army:null,members,rules:RULES};
  if(!detail)return {members,army:{id:army.id,name:army.name,revision:army.revision,commanderId:army.commanderId,territoryId:army.territoryId,movement:army.movement,activeChallengeId:this.active(army)?.id??null,lastChallengeId:army.lastChallengeId}};
  const projection=this.projection(army),active=this.active(army),curfew=attackCurfewState(this.c.now());
  return {rules:RULES,members,army:{...structuredClone(army),roster:projection.draft.roster.map(p=>({...p,ownerName:name(this.c.accounts.get(p.coalitionOwnerId))})),activeChallengeId:active?.id??null,blocked:this.readiness(army),busy:this.busy(army),attackBlocked:curfew.active?curfew.message:null,waitingForCurfewUntil:army.order?.arrived&&curfew.active?curfew.endsAt:null,canCommand:account.id===army.commanderId,commanderName:name(this.c.accounts.get(army.commanderId)),contributors:coalitionContributors(army)},tacticsState:{...projection,bondCatalog:campaignBondCatalog(this.c.playerDatabase),formationResearch:this.c.formationResearch?.publicState(this.c.accounts.get(army.commanderId))},myCards:account.draft.roster.map(p=>({id:p.id,name:p.name,role:p.role,overall:p.effectiveOverall??p.overall,loan:p.coalitionLoan??null,blocked:this.c.cardManagement.blocked(account,p)})),serverNow:this.c.now()};
 }
 preview(account,body){const army=this.require(account,body.armyId);this.command(account,army);return campaignTacticalPreview(this.projection(army),body);}
}
