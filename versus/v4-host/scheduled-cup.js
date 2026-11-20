import {cupConditions} from '../match-conditions.js';
import {createHash} from 'node:crypto';
import {createSourceSnapshot} from '../v4-adapter/source-snapshot.js';
import {compileRealMatch} from '../v4-adapter/compile-match.js';
import {VERSION} from '../v4/world.js';

export const scheduledCupField='v4LocalCupEvents';
const format='yffm-v4-local-cup-events-1',copy=value=>structuredClone(value),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eventKey=(seasonId,eventId)=>hash({seasonId,eventId,competition:'cup'});
const descriptor=event=>({id:event.id,stage:event.stage,round:event.round,leg:event.leg});
function instant(at){if(!Number.isSafeInteger(at)||at<0)throw new Error('杯赛时钟无效');}
function metadata(league){const meta=league[scheduledCupField];if(meta&&(meta.format!==format||!meta.events||!Number.isSafeInteger(meta.revision)))throw new Error('隔离杯赛元数据无效');return meta;}
function noOverlap(league){
  if(league.v4LocalLeagueRounds?.active||league.liveRound||league.liveCupRound||league.liveSeasonFinalRound||league.liveWorldCupRound||(league.liveFriendlies??[]).some(live=>!live.completed)||league.rounds.some(round=>round.status==='running'))throw new Error('存在其他直播赛事，禁止重叠操作杯赛');
}
function fixturesFor(league,event){
  if(event.stage==='league')return league.cup.leagueRounds.find(round=>round.number===event.round)?.fixtures??[];
  if(event.stage==='swiss')return league.cup.swissRounds.find(round=>round.number===event.round)?.fixtures??[];
  return (league.cup.knockout[event.stage]??[]).flatMap(tie=>tie.legs.filter(leg=>leg.number===event.leg));
}
function aggregateFor(league,event,fixture){
  if(event.leg!==2)return [0,0];
  const tie=league.cup.knockout[event.stage]?.find(tie=>tie.legs.includes(fixture)),first=tie?.legs.find(leg=>leg.number===1);
  if(!first||first.status!=='complete'||!first.matchId||first.homeId!==fixture.awayId||first.awayId!==fixture.homeId||!Array.isArray(first.score)||first.score.length!==2||first.score.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('杯赛第二回合缺少完整且对应的首回合赛果');
  const matches=league.matches.filter(match=>match.id===first.matchId);
  if(matches.length!==1||matches[0].competition!=='cup'||matches[0].cupStage!==event.stage||matches[0].cupRound!==event.round||matches[0].legNumber!==1||matches[0].homeId!==first.homeId||matches[0].awayId!==first.awayId||JSON.stringify(matches[0].score)!==JSON.stringify(first.score))throw new Error('杯赛首回合赛程与战报记录不一致');
  return [first.score[1],first.score[0]];
}
function scheduleIdentity(league,event){return {event:{...descriptor(event),fixtureIds:event.fixtureIds},fixtures:fixturesFor(league,event).map(f=>({id:f.id,homeId:f.homeId,awayId:f.awayId,aggregate:aggregateFor(league,event,f)}))};}
function memoryService(createService,league,at,key){
  let value=parseInt(key.slice(0,8),16);const service=createService({statePath:null,backupDir:null,pagedInbox:false,now:()=>at,rng:()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;}});
  if(!service||service.then||service.statePath!==null||service.shardStore||service.pagedInbox)throw new Error('杯赛服务必须完全使用内存状态');
  service.state=league;const refuse=()=>{throw new Error('杯赛事务禁止外部持久化');};service.save=refuse;service.scheduleLiveSettlementSave=refuse;service.backupFile=refuse;return service;
}

export function beginScheduledCupEvent({league:original,seasonId,eventId,at,createService,catalog,traitCatalog,bondCatalog=[],duration=5400,releaseRate=1,enginePin=null}){
  instant(at);
  if(typeof seasonId!=='string'||!seasonId||typeof eventId!=='string'||!eventId||eventId.length>200||!Number.isFinite(releaseRate)||releaseRate<.25||releaseRate>64)throw new Error('隔离杯赛请求无效');
  if(enginePin&&(enginePin.engineVersion!==VERSION||!/^[a-f0-9]{64}$/.test(enginePin.sourceDigest)))throw new Error('杯赛内核锁定与适配器不兼容');
  const league=copy(original),key=eventKey(seasonId,eventId),prior=metadata(league)?.events[key],event=league.cup?.events.find(entry=>entry.id===eventId);
  if(league.season.id!==seasonId||!event)throw new Error('杯赛赛季或赛事不存在');
  if(prior){
    if(prior.duration!==duration||prior.releaseRate!==releaseRate||JSON.stringify(prior.enginePin??null)!==JSON.stringify(enginePin))throw new Error('杯赛已锁定到不同播放、比赛或内核配置');
    if(hash(scheduleIdentity(league,event))!==prior.scheduleDigest||event.status!==prior.status)throw new Error('已锁定杯赛的赛程或状态已改变');
    return {league,event:copy(prior),duplicate:true};
  }
  noOverlap(league);if(metadata(league)?.active)throw new Error('已有未完成的V4杯赛');
  if(league.cup.status!=='active'||event.status!=='pending'||event!==league.cup.events.find(entry=>entry.status!=='complete')||event.transitionedAt)throw new Error('只能启动当前待赛杯赛');
  if(!['league','swiss','roundOf16','quarterfinals','semifinals','final'].includes(event.stage)||!Number.isSafeInteger(event.round)||event.round<1||![1,2].includes(event.leg)||['league','swiss','final'].includes(event.stage)&&event.leg!==1)throw new Error('杯赛阶段配置无效');
  const fixtures=fixturesFor(league,event),teams=fixtures.flatMap(f=>[f.homeId,f.awayId]);
  if(!fixtures.length||fixtures.length>64||fixtures.some(f=>typeof f.id!=='string'||!f.id||f.status!=='pending'||f.matchId)||new Set(fixtures.map(f=>f.id)).size!==fixtures.length||JSON.stringify(event.fixtureIds)!==JSON.stringify(fixtures.map(f=>f.id)))throw new Error('杯赛赛程无效或已结算');
  if(teams.some(id=>!league.teams.some(t=>t.id===id))||new Set(teams).size!==teams.length)throw new Error('杯赛参赛球队缺失或重复');
  const snapshot=createSourceSnapshot({league,catalog,traitCatalog,bondCatalog}),scheduleDigest=hash(scheduleIdentity(league,event));
  const tasks=fixtures.map((fixture,fixtureIndex)=>{
    const id=`v4-cup-${key.slice(0,32)}-${fixtureIndex}`,resolution=event.stage==='league'||!['swiss','final'].includes(event.stage)&&event.leg===1?'draw':'extraTimeAndPenalties';
    const {weather,referee}=cupConditions(seasonId,fixture,event);
    return {fixture:{id,competition:'cup'},context:{competition:'cup',round:event.round,event:descriptor(event),binding:{seasonId,roundKey:key,fixtureIndex,scheduleDigest}},envelope:compileRealMatch(snapshot,{environment:{weather:weather.key,referee:referee.key},homeId:fixture.homeId,awayId:fixture.awayId,fixtureId:id,seed:`${seasonId}:${event.id}:${fixture.id}`,competition:'cup',resolution,aggregate:aggregateFor(league,event,fixture),duration})};
  });
  event.status='running';event.startedAt=at;if(event.stage==='final')league.cup.finalStartedAt=at;
  const meta=league[scheduledCupField]??={format,revision:0,active:null,events:{}};
  const record={key,competition:'cup',seasonId,eventId,event:descriptor(event),number:event.round,scheduleDigest,startedAt:at,duration,releaseRate,enginePin:copy(enginePin),sourceFingerprint:snapshot.fingerprint,status:'running',newUnavailable:[],tasks,settled:{}};
  meta.events[key]=record;meta.active=key;meta.revision++;
  return {league,event:copy(record),duplicate:false};
}

export function scheduledCupFixtureBinding(league,context,pinned){
  const binding=context?.binding,meta=metadata(league),record=binding&&meta?.events[binding.roundKey];
  if(context?.competition!=='cup'||!record||record.seasonId!==league.season.id||binding.seasonId!==league.season.id||record.number!==context.round||JSON.stringify(record.event)!==JSON.stringify(context.event)||record.status!=='running'||meta.active!==record.key||league.cup.status!=='active')throw new Error('杯赛绑定不存在或不处于运行状态');
  noOverlap(league);const event=league.cup.events.find(entry=>entry.id===record.eventId),index=binding.fixtureIndex,task=record.tasks[index];
  if(!Number.isSafeInteger(index)||!task||event?.status!=='running'||hash(scheduleIdentity(league,event))!==record.scheduleDigest||binding.scheduleDigest!==record.scheduleDigest||JSON.stringify(task.context.binding)!==JSON.stringify(binding))throw new Error('杯赛赛程绑定已改变');
  if(task.fixture.id!==pinned.fixtureId||task.envelope.fingerprint!==pinned.inputFingerprint||task.envelope.engineVersion!==pinned.engineVersion)throw new Error('杯赛输入与生产任务不一致');
  if(record.enginePin&&(record.enginePin.engineVersion!==pinned.engineVersion||record.enginePin.sourceDigest!==pinned.sourceDigest))throw new Error('生产任务与杯赛内核锁定不一致');
  const fixture=fixturesFor(league,event)[index];if(fixture.matchId||fixture.status!=='pending'||record.settled[pinned.fixtureId])throw new Error('杯赛赛程已经消费，必须使用持久化回执重试');
  return {record,event,fixture};
}

export function finishScheduledCupEvent({league:original,seasonId,eventId,at,createService}){
  instant(at);const league=copy(original),meta=metadata(league),key=eventKey(seasonId,eventId),record=meta?.events[key];
  if(!record||league.season.id!==seasonId)throw new Error('隔离杯赛不存在');
  if(record.status==='complete')return {league,receipt:copy(record.receipt),duplicate:true};
  noOverlap(league);const event=league.cup.events.find(entry=>entry.id===eventId);
  if(meta.active!==key||record.status!=='running'||event?.status!=='running'||league.cup.status!=='active'||hash(scheduleIdentity(league,event))!==record.scheduleDigest)throw new Error('杯赛状态或赛程已改变');
  const fixtures=fixturesFor(league,event);
  for(const [index,task] of record.tasks.entries()){
    const receipt=record.settled[task.fixture.id],fixture=fixtures[index];
    if(!receipt||fixture.status!=='complete'||receipt.matchId!==fixture.matchId||!league.matches.some(m=>m.id===fixture.matchId&&m.competition==='cup'&&m.cupStage===event.stage&&m.cupRound===event.round&&m.legNumber===event.leg&&m.homeId===fixture.homeId&&m.awayId===fixture.awayId)||!Number.isFinite(receipt.releaseAt)||at<receipt.releaseAt)throw new Error('整轮杯赛尚未全部发布并结算');
  }
  const service=memoryService(createService,league,at,key);service.cupNewUnavailable=new Set(record.newUnavailable);service.completeCupEvent(event);
  if(event.status!=='complete'||event.transitionedAt!==at)throw new Error('原杯赛推进未完整结束');
  record.status='complete';record.receipt={seasonId,eventId,completedAt:at,matches:record.tasks.length,localOnly:true};meta.active=null;meta.revision++;
  return {league:service.state,receipt:copy(record.receipt),duplicate:false};
}
