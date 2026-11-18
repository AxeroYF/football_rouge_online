import {createHash} from 'node:crypto';
import {createSourceSnapshot} from '../v4-adapter/source-snapshot.js';
import {compileRealMatch} from '../v4-adapter/compile-match.js';
import {VERSION} from '../v4/world.js';

export const scheduledLeagueField='v4LocalLeagueRounds';
const format='yffm-v4-local-league-rounds-1',copy=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const roundKey=(seasonId,round)=>hash({seasonId,round});
const scheduleIdentity=round=>round.fixtures.map(f=>({id:f.id??null,homeId:f.homeId,awayId:f.awayId}));
function instant(at){if(!Number.isSafeInteger(at)||at<0)throw new Error('轮次时钟无效');}
function memoryService(createService,league,at,seed){
  let value=parseInt(hash(seed).slice(0,8),16);
  const service=createService({statePath:null,backupDir:null,pagedInbox:false,now:()=>at,rng:()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;}});
  if(!service||service.then||service.statePath!==null||service.shardStore||service.pagedInbox)throw new Error('轮次服务必须完全使用内存状态');
  service.state=league;
  const refuse=()=>{throw new Error('轮次事务禁止外部持久化');};
  service.save=refuse;service.scheduleLiveSettlementSave=refuse;service.backupFile=refuse;
  return service;
}
function metadata(league){
  const value=league[scheduledLeagueField];
  if(value&&(value.format!==format||!value.rounds||!Number.isSafeInteger(value.revision)))throw new Error('隔离轮次元数据无效');
  return value;
}
function noLegacyLive(league){
  if(league.v4LocalCupEvents?.active||league.cup?.events?.some(event=>event.status==='running')||league.liveRound||league.liveCupRound||league.liveSeasonFinalRound||league.liveWorldCupRound||(league.liveFriendlies??[]).some(live=>!live.completed))throw new Error('存在其他直播赛事，禁止重叠启动或结算轮次');
}

// Pure transitions for a marked local storage adapter. No singleton, scheduler,
// queue writer or storage backend is imported here. A caller commits the entire
// returned league and receipt atomically before publishing/enqueuing its tasks.
export function beginScheduledLeagueRound({league:original,seasonId,roundNumber,at,createService,catalog,traitCatalog,bondCatalog=[],duration=5400,releaseRate=1,enginePin=null}){
  instant(at);
  if(typeof seasonId!=='string'||!seasonId||!Number.isSafeInteger(roundNumber)||roundNumber<1||!Number.isFinite(releaseRate)||releaseRate<.25||releaseRate>64)throw new Error('隔离轮次请求无效');
  if(enginePin&&(enginePin.engineVersion!==VERSION||!/^[a-f0-9]{64}$/.test(enginePin.sourceDigest)))throw new Error('轮次内核锁定与适配器不兼容');
  const league=copy(original),key=roundKey(seasonId,roundNumber),prior=metadata(league)?.rounds[key];
  if(league.season.id!==seasonId)throw new Error('轮次赛季已改变');
  if(prior){
    if(prior.duration!==duration||prior.releaseRate!==releaseRate||JSON.stringify(prior.enginePin??null)!==JSON.stringify(enginePin))throw new Error('轮次已锁定到不同播放、比赛或内核配置');
    const current=league.rounds.find(r=>r.number===roundNumber);
    if(!current||hash(scheduleIdentity(current))!==prior.scheduleDigest||current.status!==prior.status)throw new Error('已锁定轮次的赛程或状态已改变');
    return {league,round:copy(prior),duplicate:true};
  }
  noLegacyLive(league);
  if(metadata(league)?.active)throw new Error('已有未完成的V4轮次');
  const round=league.rounds[league.season.currentRound];
  if(league.season.status!=='active'||round?.number!==roundNumber||round.status!=='pending'||round.number!==league.season.currentRound+1)throw new Error('只能启动当前待赛轮次');
  if(!Array.isArray(round.fixtures)||!round.fixtures.length||round.fixtures.length>64||round.fixtures.some(f=>f.matchId))throw new Error('轮次赛程无效或已经结算');
  const teams=round.fixtures.flatMap(f=>[f.homeId,f.awayId]);
  if(teams.some(id=>!league.teams.some(t=>t.id===id))||new Set(teams).size!==teams.length)throw new Error('同轮参赛球队缺失或重复');
  const service=memoryService(createService,league,at,key);
  if(round.number===1)service.settleMirrorMarketplace('9999-12-31');
  const snapshot=createSourceSnapshot({league,catalog,traitCatalog,bondCatalog}),scheduleDigest=hash(scheduleIdentity(round));
  const tasks=round.fixtures.map((fixture,fixtureIndex)=>{
    const id=`v4-${key.slice(0,32)}-${fixtureIndex}`;
    return {fixture:{id,competition:'league'},context:{competition:'league',round:roundNumber,binding:{seasonId,roundKey:key,fixtureIndex,scheduleDigest}},
      envelope:compileRealMatch(snapshot,{homeId:fixture.homeId,awayId:fixture.awayId,fixtureId:id,seed:`${seasonId}:R${roundNumber}:${fixtureIndex}`,duration})};
  });
  // Compilation and coverage checks finish before changing the round status.
  round.status='running';
  const meta=league[scheduledLeagueField]??={format,revision:0,active:null,rounds:{}};
  const record={key,seasonId,number:roundNumber,scheduleDigest,startedAt:at,duration,releaseRate,enginePin:copy(enginePin),sourceFingerprint:snapshot.fingerprint,status:'running',newUnavailable:[],tasks,settled:{}};
  meta.rounds[key]=record;meta.active=key;meta.revision++;
  return {league,round:copy(record),duplicate:false};
}

export function scheduledFixtureBinding(league,context,pinned){
  const binding=context?.binding,meta=metadata(league),record=binding&&meta?.rounds[binding.roundKey];
  if(context?.competition!=='league'||!record||record.seasonId!==league.season.id||binding.seasonId!==league.season.id||record.number!==context.round||record.status!=='running'||meta.active!==record.key||league.season.currentRound!==record.number-1)throw new Error('轮次绑定不存在或不处于运行状态');
  noLegacyLive(league);
  const round=league.rounds.find(r=>r.number===record.number),index=binding.fixtureIndex,task=record.tasks[index];
  if(!Number.isSafeInteger(index)||!task||round?.status!=='running'||hash(scheduleIdentity(round))!==record.scheduleDigest||binding.scheduleDigest!==record.scheduleDigest||JSON.stringify(task.context.binding)!==JSON.stringify(binding))throw new Error('赛程绑定已改变');
  if(task.fixture.id!==pinned.fixtureId||task.envelope.fingerprint!==pinned.inputFingerprint||task.envelope.engineVersion!==pinned.engineVersion)throw new Error('赛程输入与生产任务不一致');
  if(record.enginePin&&(record.enginePin.engineVersion!==pinned.engineVersion||record.enginePin.sourceDigest!==pinned.sourceDigest))throw new Error('生产任务与整轮内核锁定不一致');
  const fixture=round.fixtures[index];
  if(fixture.matchId||record.settled[pinned.fixtureId])throw new Error('赛程已经消费，必须使用持久化回执重试');
  return {record,round,fixture};
}

export function finishScheduledLeagueRound({league:original,seasonId,roundNumber,at,createService}){
  instant(at);const league=copy(original),meta=metadata(league),key=roundKey(seasonId,roundNumber),record=meta?.rounds[key];
  if(!record||league.season.id!==seasonId)throw new Error('隔离轮次不存在');
  if(record.status==='complete')return {league,receipt:copy(record.receipt),duplicate:true};
  noLegacyLive(league);
  const round=league.rounds.find(r=>r.number===roundNumber);
  if(meta.active!==key||record.status!=='running'||round?.status!=='running'||league.season.currentRound!==roundNumber-1||hash(scheduleIdentity(round))!==record.scheduleDigest)throw new Error('轮次状态或赛程已改变');
  for(const [index,task] of record.tasks.entries()){
    const receipt=record.settled[task.fixture.id],fixture=round.fixtures[index];
    if(!receipt||receipt.matchId!==fixture.matchId||!league.matches.some(m=>m.id===fixture.matchId&&m.round===roundNumber&&m.homeId===fixture.homeId&&m.awayId===fixture.awayId)||!Number.isFinite(receipt.releaseAt)||at<receipt.releaseAt)throw new Error('整轮比赛尚未全部发布并结算');
  }
  const service=memoryService(createService,league,at,key);
  service.roundNewUnavailable=new Set(record.newUnavailable);
  // The original method requests one final save. It is captured here and the
  // caller performs the sole durable commit containing all round effects.
  let saves=0;service.save=()=>{saves++;};service.finishRound(round);
  if(saves!==1||round.status!=='complete'||league.season.currentRound!==roundNumber)throw new Error('原轮次推进未完整结束');
  record.status='complete';record.receipt={seasonId,roundNumber,completedAt:at,matches:record.tasks.length,localOnly:true};
  meta.active=null;meta.revision++;
  return {league:service.state,receipt:copy(record.receipt),duplicate:false};
}
