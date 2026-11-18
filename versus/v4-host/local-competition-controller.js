import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireDispatchLock,recoverDispatchLock} from './dispatch-store.js';
import {replaceCommittedFile} from '../v4-stream/atomic-file.js';
import {loadEngineBundle} from '../v4-rollout/bundle.js';
import {openCanonicalLocalStorageSettlement} from './canonical-storage-settlement.js';
import {openLocalLeagueScheduler} from './local-league-scheduler.js';
import {openLocalCupScheduler} from './local-cup-scheduler.js';
import {openLocalDispatcher} from './dispatcher.js';

const format='yffm-v4-local-host-control-1',copy=value=>structuredClone(value),hex=/^[a-f0-9]{64}$/;
function descriptor(value){
  if(!['league','cup'].includes(value?.competition)||typeof value.seasonId!=='string'||!value.seasonId||value.seasonId.length>200)throw new Error('本地宿主赛事请求无效');
  if(value.competition==='league'){
    if(!Number.isSafeInteger(value.roundNumber)||value.roundNumber<1||value.roundNumber>14)throw new Error('本地宿主轮次无效');
    return {competition:'league',seasonId:value.seasonId,roundNumber:value.roundNumber};
  }
  if(typeof value.eventId!=='string'||!/^cup-[a-zA-Z0-9_-]{1,90}$/.test(value.eventId))throw new Error('本地宿主杯赛事件无效');
  return {competition:'cup',seasonId:value.seasonId,eventId:value.eventId};
}
function policy(value){
  if(value?.mode==='off'&&Object.keys(value).length===1)return {mode:'off'};
  if(value?.mode!=='v4'||Object.keys(value).some(key=>!['mode','engineVersion','sourceDigest','events'].includes(key))||typeof value.engineVersion!=='string'||!hex.test(value.sourceDigest)||!Array.isArray(value.events)||!value.events.length||value.events.length>128)throw new Error('本地宿主切换策略无效');
  const events=value.events.map(descriptor);if(new Set(events.map(event=>JSON.stringify(event))).size!==events.length)throw new Error('本地宿主赛事名单重复');
  return {mode:'v4',engineVersion:value.engineVersion,sourceDigest:value.sourceDigest,events};
}
function activeRecord(state){
  const found=[state.v4LocalLeagueRounds?.rounds?.[state.v4LocalLeagueRounds?.active],state.v4LocalCupEvents?.events?.[state.v4LocalCupEvents?.active]].filter(Boolean);
  if(found.length>1)throw new Error('多个V4赛事同时占用宿主');return found[0]??null;
}
const eventOf=record=>record.competition==='cup'?{competition:'cup',seasonId:record.seasonId,eventId:record.eventId}:{competition:'league',seasonId:record.seasonId,roundNumber:record.number};

// Explicit local orchestration only. No timer, HTTP switch or production
// singleton is installed. The caller runs the legacy path when handled=false.
export async function openLocalCompetitionController({enabled=false,root,service,createService,sourceCatalog,candidates=[],now=Date.now}={}){
  if(!enabled)return {enabled:false,advance:async()=>({handled:false,engine:'legacy',reason:'disabled'})};
  if(!Array.isArray(candidates)||candidates.length>16)throw new Error('本地宿主候选版本目录无效');candidates=copy(candidates);
  const bridge=await openCanonicalLocalStorageSettlement({root,service,createService,sourceCatalog,now}),directory=await fs.realpath(root),file=path.join(directory,'host-control.json'),writer=path.join(directory,'host-control-writer.lock'),leader=path.join(directory,'host-control-advance.lock');
  function candidate(pin){const found=candidates.filter(entry=>entry.accepted===true&&entry.engineVersion===pin?.engineVersion&&entry.sourceDigest===pin?.sourceDigest);if(found.length!==1)throw new Error('缺少唯一的已验收锁定版本');return found[0];}
  async function read(){
    const document=JSON.parse(await fs.readFile(file,'utf8'));
    if(document.format!==format||!Number.isSafeInteger(document.revision)||document.revision<0||!Array.isArray(document.history)||document.history.length!==document.revision)throw new Error('本地宿主控制记录无效');
    document.policy=policy(document.policy);
    for(const [index,entry] of document.history.entries())if(entry.revision!==index+1||!Number.isSafeInteger(entry.at)||entry.at<0||JSON.stringify(policy(entry.policy))!==JSON.stringify(entry.policy))throw new Error('本地宿主策略历史无效');
    if(JSON.stringify(document.policy)!==JSON.stringify(document.history.at(-1)?.policy??{mode:'off'}))throw new Error('本地宿主策略与历史不一致');return document;
  }
  async function save(document){const pending=file+'.pending-'+randomUUID(),handle=await fs.open(pending,'wx');try{await handle.writeFile(JSON.stringify(document));await handle.sync();}finally{await handle.close();}await replaceCommittedFile(pending,file);}
  const release=await acquireDispatchLock(writer,{wait:true});
  try{try{await fs.access(file);}catch(error){if(error.code!=='ENOENT')throw error;await save({format,revision:0,policy:{mode:'off'},history:[]});}await read();}finally{await release();}
  const scheduler=(competition,pin)=> (competition==='league'?openLocalLeagueScheduler:openLocalCupScheduler)({root:directory,service,createService,sourceCatalog,candidate:candidate(pin),enabled:true,now});
  return {
    enabled:true,scope:'local-controlled-rehearsal-only',read,readLeague:async()=>(await bridge.read()).state.league,
    async setPolicy(value,{expectedRevision}={}){
      const next=policy(value);if(next.mode==='v4')await loadEngineBundle(candidate(next).bundleDirectory,next);
      const release=await acquireDispatchLock(writer,{wait:true});
      try{const document=await read();if(document.revision!==expectedRevision)throw new Error('本地宿主策略版本冲突');if(document.history.length>=256)throw new Error('本地宿主策略历史需要归档');
        const at=now();if(!Number.isSafeInteger(at)||at<0)throw new Error('本地宿主时钟无效');document.revision++;document.policy=next;document.history.push({revision:document.revision,policy:copy(next),at});await save(document);return copy(document);
      }finally{await release();}
    },
    async recover(){
      await recoverDispatchLock(leader);await recoverDispatchLock(writer);const release=await acquireDispatchLock(leader);
      try{await bridge.recoverAbandonedLock();await bridge.reload();const active=activeRecord((await bridge.read()).state.league);if(active)await (await scheduler(eventOf(active).competition,active.enginePin)).recover();return {recovered:true};}finally{await release();}
    },
    async retry(fixtureId){
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(fixtureId))throw new Error('本地宿主重试比赛标识无效');
      const release=await acquireDispatchLock(leader);
      try{
        const active=activeRecord((await bridge.read()).state.league);if(!active||!active.tasks.some(task=>task.fixture.id===fixtureId))throw new Error('只能重试当前锁定赛事中的失败任务');
        const queue=await openLocalDispatcher(path.join(directory,eventOf(active).competition+'-queue-'+active.key),{settlement:bridge,candidate:candidate(active.enginePin),now});return queue.retry(fixtureId);
      }finally{await release();}
    },
    async advance(value,{signal,onStarted=()=>{}}={}){
      const event=descriptor(value),release=await acquireDispatchLock(leader);let record;
      try{
        if(signal?.aborted)throw new Error('本地宿主已暂停');
        const unlock=await acquireDispatchLock(writer,{wait:true});
        try{
          const state=(await bridge.read()).state.league,active=activeRecord(state),document=await read();
          const known=Object.values(event.competition==='league'?state.v4LocalLeagueRounds?.rounds??{}:state.v4LocalCupEvents?.events??{}).find(record=>JSON.stringify(eventOf(record))===JSON.stringify(event));
          if(known?.status==='complete')return {handled:true,engine:'v4',complete:true,duplicate:true,receipt:copy(known.receipt)};
          if(active){if(JSON.stringify(eventOf(active))!==JSON.stringify(event))throw new Error('需先完成已锁定V4赛事');record=active;}
          else{
            if(document.policy.mode==='off'||!document.policy.events.some(item=>JSON.stringify(item)===JSON.stringify(event)))return {handled:false,engine:'legacy',reason:document.policy.mode==='off'?'off':'outside-allowlist'};
            const enginePin={engineVersion:document.policy.engineVersion,sourceDigest:document.policy.sourceDigest};await loadEngineBundle(candidate(enginePin).bundleDirectory,enginePin);
            const request={...event,duration:value.duration??5400,releaseRate:value.releaseRate??1,enginePin};
            record=event.competition==='league'?await bridge.beginRound(request):await bridge.beginCupEvent(request);
          }
        }finally{await unlock();}
        // A policy rollback can commit while workers run. The persisted record
        // already owns its exact version, duration and publication clock.
        const selected=await scheduler(event.competition,record.enginePin),request={...event,duration:record.duration,releaseRate:record.releaseRate};
        const result=await selected.advance(request,{signal,onRoundStarted:onStarted});
        return {handled:true,engine:'v4',...result};
      }finally{await release();}
    },
  };
}
