import crypto from 'node:crypto';
import {RAID_RULES as RULES,raidDay,raidWindow,raidPackType,raidActiveAccount,raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import {ELITE_CLUB_BY_ID} from '../../shared/config/elite-clubs.mjs';
import {territoryTravelEstimate} from '../domain/expedition-piece.mjs';
import {buildAccountMatchSeat} from '../../shared/football/account-match-seat.mjs';
import {campaignBondCatalog} from '../../shared/football/campaign-bonds.mjs';
import {createCampaignLiveLeg,advanceCampaignLiveLeg,restoreCampaignLiveLeg,publicCampaignLiveLeg} from '../../engine/campaign-match-engine.mjs';
import {applyLegConsequences} from './match-consequences.mjs';
import {CoalitionService} from './coalition-service.mjs';
import {sanitizeCoalitionTactics} from './coalition-tactics.mjs';
import {campaignTacticalPreview} from './tactical-preview.mjs';
import {coalitionContributors} from '../../shared/config/coalition.mjs';
import {representativePlayers} from '../../shared/config/representative-players.mjs';
import {enhancementFamily} from '../../shared/config/enhancement.mjs';
import {suppressTerritory,releaseSuppression} from './raid-suppression.mjs';
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode});};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const name=a=>a?.draft?.teamName??a?.nickname??'球队';
const restore=(v,old)=>{for(const k of Object.keys(v))delete v[k];Object.assign(v,old);};
export class EliteRaidService{
 constructor(c){this.c=c;this.cursor=0;this.lastTick=0;this.helper=new CoalitionService(c);this.metadata=new Map((c.territoryIndex?.territories??[]).map(t=>[t.territoryId,t]));
  if(c.world)c.world.eliteRaids??={version:1,queue:[],activeIds:[],days:{},matches:{},history:[]};this.restore();
 }
 get data(){return this.c.world?.eliteRaids;}
 restore(){for(const m of Object.values(this.data?.matches??{}))restoreCampaignLiveLeg(m.leg);}
 transaction(fn){
  const before=JSON.parse(JSON.stringify(this.c.world)),accounts=[...this.c.accounts.values()].map(a=>[a,structuredClone(a)]);
  try{const result=fn();this.c.world.revision++;this.c.save();return result;}
  catch(e){restore(this.c.world,before);for(const [a,b]of accounts)restore(a,b);this.restore();this.c.challenges?.restoreActiveChallenges();for(const ch of Object.values(this.c.world.eliteChallenges??{}))restoreCampaignLiveLeg(ch.leg);for(const m of Object.values(this.c.world.diplomacy?.matches??{}))if(!m.battle)restoreCampaignLiveLeg(m.leg);throw e;}
 }
 touch(a,{foreground=false}={}){if(!a?.setupComplete)return;const at=this.c.now();a.raidActivity={...a.raidActivity,activeAt:at,...(foreground?{foregroundAt:at}:{})};}
 day(at=this.c.now()){return this.data?.days?.[raidDay(at)]??null;}
 ensureDay(at=this.c.now()){
  if(!this.data)return null;const window=raidWindow(at);if(this.data.days[window.day])return this.data.days[window.day];
  const available=this.c.eliteChallenges.availableClubs();if(available.length<2)return null;
  const seed=this.c.world.seasonId??'world';const clubs=[...available].sort((a,b)=>hash(seed+window.day+a.id).localeCompare(hash(seed+window.day+b.id))).slice(0,2);
  const day={...window,id:window.day,createdAt:at,raids:clubs.map(club=>({clubId:club.id,sourceTerritoryId:this.c.eliteChallenges.team(club.id).territories[0].territoryId,status:'scheduled',route:null,index:0,results:[]})),army:{id:'raid-army:'+window.day,name:'全服活动联军',commanderId:null,loans:[],tactics:null,revision:1},candidateId:null,offerUntil:null,attempted:[]};
  this.data.days[window.day]=day;
  for(const [id,d]of Object.entries(this.data.days))if(id<window.day&&at-d.endsAt>7*86400000&&!Object.values(this.data.matches).some(m=>m.day===id))delete this.data.days[id];
  return day;
 }
 rotation(day,at){
  const active=[...this.c.accounts.values()].filter(a=>raidActiveAccount(a,at)).map(a=>a.id),old=new Set(this.data.activeIds),valid=new Set(active);
  const existing=this.data.queue.filter(id=>valid.has(id)&&old.has(id)),fresh=active.filter(id=>!existing.includes(id)).sort((a,b)=>hash(day.id+a).localeCompare(hash(day.id+b)));
  this.data.queue=[...existing,...fresh];this.data.activeIds=active;
  const army=day.army,live=this.armyMatch(army);
  if(army.commanderId){const a=this.c.accounts.get(army.commanderId);if(!live&&at>=day.startsAt&&at-(a?.raidActivity?.foregroundAt??0)>=RULES.offlineMs){day.previousCommanderId=army.commanderId;day.attempted.push(army.commanderId);army.commanderId=null;army.revision++;day.candidateId=null;}else return;}
  if(at>=day.endsAt)return;
  if(day.candidateId&&valid.has(day.candidateId)&&(!day.offerUntil||at<day.offerUntil))return;
  if(day.candidateId){day.attempted.push(day.candidateId);day.candidateId=null;}
  let next=this.data.queue.find(id=>!day.attempted.includes(id));
  if(!next)next=this.data.queue.find(id=>at-(this.c.accounts.get(id)?.raidActivity?.foregroundAt??0)<60000);
  if(next){day.candidateId=next;day.offerUntil=Math.max(at,day.startsAt)+(day.attempted.length?RULES.standbyMs:RULES.claimMs);}
 }
 targets(raid,day){
  const targets=[];
  for(const a of this.c.accounts.values())if(raidActiveAccount(a,this.c.now())){const cells=Object.entries(this.c.world.territories).filter(([id,t])=>t.ownerType==='player'&&t.ownerId===a.id&&id!==a.homeTerritoryId&&!t.capitalOf&&!(t.protectedUntil>this.c.now()));if(!cells.length)continue;
   cells.sort(([a],[b])=>hash(day.id+raid.clubId+a).localeCompare(hash(day.id+raid.clubId+b)));targets.push({ownerId:a.id,territoryId:cells[0][0]});}
  // Rotate the first player daily so distant regions are not permanently last.
  targets.sort((a,b)=>hash(day.id+raid.clubId+a.ownerId).localeCompare(hash(day.id+raid.clubId+b.ownerId)));
  const route=[];let source=raid.sourceTerritoryId;
  while(targets.length){if(route.length)targets.sort((a,b)=>territoryTravelEstimate(this.c.territoryIndex,source,a.territoryId).distanceKm-territoryTravelEstimate(this.c.territoryIndex,source,b.territoryId).distanceKm);const target=targets.shift(),travel=territoryTravelEstimate(this.c.territoryIndex,source,target.territoryId);route.push({...target,...travel,fuelMode:'supplied'});source=target.territoryId;}
  return route;
 }
 depart(raid,at){
  // Recheck before every leg, including routes restored from an older release.
  // Keep completed stops; rebuild travel from the last real stop when inactive targets are removed.
  const pending=raid.route?.slice(raid.index)??[];
  const active=pending.filter(stop=>raidActiveAccount(this.c.accounts.get(stop.ownerId),at));
  if(active.length!==pending.length){
   let source=pending[0]?.fromTerritoryId??raid.sourceTerritoryId;
   raid.route=[...(raid.route?.slice(0,raid.index)??[]),...active.map(stop=>{
    const travel=territoryTravelEstimate(this.c.territoryIndex,source,stop.territoryId);
    source=stop.territoryId;return {...stop,...travel,fuelMode:'supplied'};
   })];
  }
  const stop=raid.route?.[raid.index];if(!stop){raid.status='finished';raid.movement=null;return;}
  raid.status='moving';raid.movement={...stop,startedAt:at,arrivesAt:at+stop.durationMs};
 }
 accountBusy(id){return Boolean(raidMatchForAccount(this.c.world,id)||this.c.world.eliteChallenges?.[id]||this.c.diplomacy?.active(this.c.accounts.get(id))||Object.values(this.c.world.activeChallenges??{}).some(m=>m.attackerId===id||m.defenderId===id));}
 startDefence(day,raid,at){
  const stop=raid.route[raid.index],t=this.c.world.territories[stop.territoryId],a=this.c.accounts.get(stop.ownerId);
  if(!raidActiveAccount(a,at)||t?.ownerType!=='player'||t.ownerId!==a.id||t.protectedUntil>at){raid.results.push({...stop,outcome:'skipped'});raid.index++;this.depart(raid,at);return;}
  if(this.accountBusy(a.id)){raid.status='waiting';return;}
  const seat=buildAccountMatchSeat(a,'garrison',at,{fitness:true,allowShortHanded:true,bondCatalog:campaignBondCatalog(this.c.playerDatabase)});
  if(seat.players.filter(p=>p.active!==false).length<7){suppressTerritory(this.c,t.territoryId??stop.territoryId,raid.clubId,at);raid.results.push({...stop,outcome:'loss',reason:'留守队可用球员不足 7 人',settledAt:at});raid.index++;this.depart(raid,at);return;}
  const id='raid-match:'+crypto.randomUUID(),leg=createCampaignLiveLeg({home:seat,away:this.c.eliteChallenges.team(raid.clubId).seat,seed:id,legNumber:1,startedAt:at,knockout:true,weather:this.c.territoryWeather?.(stop.territoryId,at)??null});
  this.data.matches[id]={id,day:day.id,clubId:raid.clubId,kind:'defence',defenderId:a.id,territoryId:stop.territoryId,startedAt:at,leg};raid.status='battle';raid.matchId=id;raid.movement=null;
 }
 award(a,m,kind){
  a.raidRewards??={};const key=[m.day,m.clubId,kind].join(':');if(a.raidRewards[key])return null;
  const reward=this.c.playerPacks.addPacks(a,raidPackType(m.clubId),1);a.raidRewards[key]={matchId:m.id,at:this.c.now()};return reward;
 }
 armyMatch(army){return Object.values(this.data.matches).find(m=>m.armyId===army.id);}
 projection(army){return this.helper.projection(army);}
 assertArmy(army){this.helper.assertLineup(army);}
 finish(m,at){
  const day=this.data.days[m.day],raid=day.raids.find(r=>r.clubId===m.clubId);advanceCampaignLiveLeg(m.leg,at,{maximumChains:0});const won=m.leg.winnerIndex===0;
  const leg=m.leg,battle={id:m.id,day:m.day,clubId:m.clubId,kind:m.kind,territoryId:m.territoryId,defenderId:m.defenderId,contributors:m.contributors??[],outcome:won?'win':'loss',score:leg.match.score,settledAt:at,broadcast:publicCampaignLiveLeg(leg),rewards:[]};
  if(m.kind==='defence'){
   const a=this.c.accounts.get(m.defenderId);this.c.fitness?.applyLeg(a,m,leg,at);applyLegConsequences(this.c.accounts,{id:m.id,live:{attacker:leg.away,defender:leg.home}},leg);
   if(won){const reward=this.award(a,m,'defence');if(reward)battle.rewards.push({ownerId:a.id,...reward});}
   else if(this.c.world.territories[m.territoryId]?.ownerId===a.id&&!raid.interceptedAt)suppressTerritory(this.c,m.territoryId,m.clubId,at);
   raid.results.push({ownerId:a.id,territoryId:m.territoryId,outcome:battle.outcome,settledAt:at,matchId:m.id});raid.index++;delete raid.matchId;
   if(at>=day.endsAt||raid.interceptedAt){raid.status='withdrawn';raid.movement=null;}else this.depart(raid,at);
  }else{
   const army=day.army,proxy=this.projection(army),accounts=new Map(this.c.accounts);accounts.set(army.id,proxy);this.c.fitness?.applyLeg(proxy,m,leg,at);applyLegConsequences(accounts,{id:m.id,live:{attacker:leg.away,defender:leg.home}},leg);
   for(const l of army.loans){const original=this.helper.card(l),copy=proxy.draft.roster.find(p=>p.id===JSON.stringify([l.ownerId,l.playerId]));if(original&&copy){original.state=structuredClone(copy.state);if(Object.hasOwn(copy,'fitness'))original.fitness=copy.fitness;}}
   if(won){const team=leg.match.teams.find(t=>t.id===army.id),played=new Set((team?.players??[]).filter(p=>p.active!==false||p.substitutedOut||p.substitutedForId||p.sentOff).map(p=>p.id));for(const ownerId of m.contributors){if(!m.loans.some(l=>l.ownerId===ownerId&&played.has(JSON.stringify([l.ownerId,l.playerId]))))continue;const a=this.c.accounts.get(ownerId),reward=this.award(a,m,'interception');if(reward)battle.rewards.push({ownerId,...reward});}
    raid.interceptedAt=at;if(!raid.matchId){raid.status='withdrawn';raid.movement=null;}for(const [id,t]of Object.entries(this.c.world.territories))if(t.raidSuppression?.clubId===m.clubId)releaseSuppression(this.c,id,at);
   }
   army.lastMatchId=m.id;army.revision++;
  }
  delete this.data.matches[m.id];this.data.history.push(battle);this.data.history=this.data.history.slice(-200);
 }
 releaseArmy(day){for(const l of [...day.army.loans])this.helper.release(day.army,l);day.army.closed=true;day.army.commanderId=null;day.army.revision++;}
 advance(at=this.c.now(),{maximumChainsPerMatch=1}={}){
  if(!this.data)return false;
  const matches=Object.values(this.data.matches);let changed=false;
  if(matches.length){const m=matches[this.cursor++%matches.length];advanceCampaignLiveLeg(m.leg,at,{maximumChains:maximumChainsPerMatch});changed=true;if(m.leg.match.finished){this.c.save();this.transaction(()=>this.finish(m,at));}}
  if(at-this.lastTick<1000)return changed;this.lastTick=at;
  const before=JSON.stringify([this.data.queue,this.data.activeIds,Object.values(this.data.days).map(d=>[d.candidateId,d.offerUntil,d.army.commanderId,d.army.closed,d.raids.map(r=>[r.status,r.index])])]);
  // No replay of missed days after downtime; existing matches still finish above.
  const day=this.ensureDay(at);if(!day)return changed;this.rotation(day,at);
  for(const d of Object.values(this.data.days)){
   if(at>=d.endsAt){for(const r of d.raids)if(r.status!=='battle'){r.status='withdrawn';r.movement=null;}if(!this.armyMatch(d.army)&&!d.army.closed)this.releaseArmy(d);continue;}
   if(at<d.startsAt)continue;
   for(const r of d.raids){if(r.status==='scheduled'){r.route=this.targets(r,d);r.index=0;this.depart(r,at);changed=true;}
    if((r.status==='moving'&&r.movement.arrivesAt<=at)||r.status==='waiting'){this.c.save();this.transaction(()=>this.startDefence(d,r,at));changed=true;}}
   if(!this.armyMatch(d.army))for(const l of [...d.army.loans])if(l.withdrawRequested)this.helper.release(d.army,l);
  }
  const after=JSON.stringify([this.data.queue,this.data.activeIds,Object.values(this.data.days).map(d=>[d.candidateId,d.offerUntil,d.army.commanderId,d.army.closed,d.raids.map(r=>[r.status,r.index])])]);
  return changed||before!==after;
 }
 armyView(a,day=this.day()){
  if(!day)return {army:null,members:[]};const army=day.army,projection=this.projection(army),live=this.armyMatch(army),open=raidWindow(this.c.now()).open;
  return {army:{...structuredClone(army),roster:projection.draft.roster.map(p=>({...p,ownerName:name(this.c.accounts.get(p.coalitionOwnerId))})),canCommand:open&&army.commanderId===a.id,busy:Boolean(live)||!open,contributors:coalitionContributors(army),activeChallengeId:live?.id??null},tacticsState:{...projection,bondCatalog:campaignBondCatalog(this.c.playerDatabase),formationResearch:army.commanderId?this.c.formationResearch?.publicState(this.c.accounts.get(army.commanderId)):null},myCards:(a.draft?.roster??[]).map(p=>({id:p.id,name:p.name,role:p.role,overall:p.overall,blocked:this.c.cardManagement.blocked(a,p),loan:p.coalitionLoan??null})),members:[...this.c.accounts.values()].filter(a=>a.setupComplete).map(a=>({id:a.id,name:name(a)}))};
 }
 mutate(a,body){
  if(!a.setupComplete)fail('请先完成建队',403);if(!/^[\w:.-]{8,128}$/.test(String(body.requestId??'')))fail('请求编号无效',400);
  const prior=a.raidRequests?.[body.requestId],signature=JSON.stringify(body);if(prior){if(prior.signature!==signature)fail('请求编号已使用');return prior.result;}
  this.c.save();return this.transaction(()=>{
   const day=this.ensureDay();if(!day)fail("当前地图没有足够的出征豪门");const army=day.army,at=this.c.now();if(!raidWindow(at).open)fail('活动联军仅在每天 20:00—24:00 开放');
   if(body.armyId&&army.id!==body.armyId)fail('活动日期已变化，请刷新');
   if(body.revision!=null&&body.revision!==army.revision)fail('联军已变化，请刷新');
   let result={};const live=this.armyMatch(army),action=body.action;
   if(action==='accept-command'){this.rotation(day,at);if(day.candidateId!==a.id||army.commanderId)fail('尚未轮到你接任',403);army.commanderId=a.id;day.candidateId=null;this.data.queue=this.data.queue.filter(id=>id!==a.id);this.data.queue.push(a.id);this.touch(a,{foreground:true});}
   else if(action==='decline-command'){if(day.candidateId!==a.id&&army.commanderId!==a.id)fail('不是当前候选或指挥官',403);if(live)fail('比赛结束后才能移交');day.attempted.push(a.id);day.candidateId=null;army.commanderId=null;this.rotation(day,at);}
   else if(action==='withdraw'){const loan=army.loans.find(l=>l.ownerId===a.id&&l.playerId===body.playerId);if(!loan)fail('只能撤回自己的球员');if(live)loan.withdrawRequested=true;else this.helper.release(army,loan);}
   else if(action==='lend'){
    if(live)fail('比赛结束后才能借调');const p=a.draft.roster.find(p=>p.id===body.playerId);if(!p)fail('球员不存在');const reason=this.c.cardManagement.blocked(a,p);if(reason)fail(reason);if(this.accountBusy(a.id))fail('球队正在比赛');if(army.loans.length>=18)fail('活动联军最多 18 人');
    if(this.helper.roster(army).some(x=>enhancementFamily(x)===enhancementFamily(p)))fail('不能重复借调同一球员');
    const defenders=representativePlayers(a.draft.roster).filter(x=>!x.coalitionLoan&&x.id!==p.id&&(a.playerSquads?.assignments?.[x.id]??'garrison')==='garrison');if(defenders.length<11||!['GK','DEF','MID','ATT'].every(pool=>defenders.some(x=>x.pool===pool)))fail('借调后留守队需保留 11 人及四类位置');
    p.coalitionLoan={armyId:army.id,activity:true,at};army.loans.push({ownerId:a.id,playerId:p.id});army.tactics=null;
   }else{
    if(army.commanderId!==a.id)fail('只有当日指挥官可操作',403);if(live)fail('联军正在比赛');
    if(action==='auto-lineup')this.helper.autoTactics(army);
    else if(action==='tactics'){const source=body.tactics?.squads?.expedition??body.tactics;this.helper.assertLineup(army,source);const projection=this.projection(army);army.tactics=sanitizeCoalitionTactics(projection,projection.draft.roster,source);}
    else if(action==='challenge'){
     const raid=day.raids.find(r=>r.clubId===body.clubId);if(!raid||raid.interceptedAt)fail('只能阻击当日尚未被击退的豪门');this.assertArmy(army);
     const id='raid-match:'+crypto.randomUUID(),seat=this.helper.seat(army);if(seat.players.filter(p=>p.active!==false).length<7)fail('可用球员不足 7 人');
     const leg=createCampaignLiveLeg({home:seat,away:this.c.eliteChallenges.team(raid.clubId).seat,seed:id,legNumber:1,startedAt:at,knockout:true});
     this.data.matches[id]={id,day:day.id,clubId:raid.clubId,kind:'interception',armyId:army.id,contributors:coalitionContributors(army),loans:structuredClone(army.loans),startedAt:at,leg};result={challengeId:id};
    }else fail('未知活动操作',400);
   }
   army.revision++;a.raidRequests??={};a.raidRequests[body.requestId]={signature,result};return result;
  });
 }
 preview(a,body){const army=this.day()?.army;if(!army||army.id!==body.armyId||army.commanderId!==a.id||!raidWindow(this.c.now()).open)fail('无权调整活动联军',403);return campaignTacticalPreview(this.projection(army),body);}
 snapshot(a,id){const m=this.data.matches[id];if(m)return {completed:false,challenge:{id,format:'raid',phase:'first-leg'},live:{key:id,legNumber:1,phase:'first-leg',broadcast:publicCampaignLiveLeg(m.leg)},battle:null};const b=this.data.history.find(b=>b.id===id);if(!b)fail('战报不存在',404);return {completed:true,challenge:null,live:null,battle:{...b,broadcasts:[b.broadcast]}};}
 view(a,{detail=false}={}){
  const day=this.day();if(!day)return null;const at=this.c.now(),open=at>=day.startsAt&&at<day.endsAt;
  const raids=day.raids.map(r=>({...r,name:ELITE_CLUB_BY_ID[r.clubId].name,badge:'./assets/club-badges/'+r.clubId+'.webp',route:r.route?.map(s=>({...s,ownerName:name(this.c.accounts.get(s.ownerId)),territoryName:this.metadata.get(s.territoryId)?.name??s.territoryId})),myTarget:r.route?.find(s=>s.ownerId===a.id)??null,rewards:{defence:Boolean(a.raidRewards?.[[day.id,r.clubId,'defence'].join(':')]),interception:Boolean(a.raidRewards?.[[day.id,r.clubId,'interception'].join(':')])}}));
  return {day:day.id,startsAt:day.startsAt,endsAt:day.endsAt,open,serverNow:at,raids,candidateId:day.candidateId,candidateName:day.candidateId?name(this.c.accounts.get(day.candidateId)):'暂无候选',offerUntil:day.offerUntil,queue:this.data.queue.map(id=>({id,name:name(this.c.accounts.get(id))})),army:detail?this.armyView(a,day).army:{id:day.army.id,commanderId:day.army.commanderId,revision:day.army.revision,closed:day.army.closed},commanderName:day.army.commanderId?name(this.c.accounts.get(day.army.commanderId)):null,noticeDismissed:a.raidNoticeDay===day.id,matches:Object.values(this.data.matches).map(m=>({id:m.id,day:m.day,clubId:m.clubId,kind:m.kind,defenderId:m.defenderId,minute:m.leg.match.minute,score:m.leg.match.score})),history:this.data.history.filter(b=>b.day===day.id&&(b.kind==='interception'||b.defenderId===a.id)).map(({broadcast,...b})=>b),...(detail?{coalition:this.armyView(a,day)}:{})};
 }
}
