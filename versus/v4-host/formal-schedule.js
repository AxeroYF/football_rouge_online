import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createEngineBundle,loadEngineBundle} from '../v4-rollout/bundle.js';
import {publishPreparedDirectory} from '../v4-stream/atomic-file.js';
import {openScheduledStorageSettlement} from './canonical-storage-settlement.js';
import {openLocalLeagueScheduler} from './local-league-scheduler.js';
import {openLocalCupScheduler} from './local-cup-scheduler.js';
import {openScheduledPreviewHost} from './scheduled-preview-host.js';
import {recoverDispatchLock} from './dispatch-store.js';

import {completedRounds,compactRound,expireSeasonReplays} from './goal-clips.js';

async function prepareKernel(root){
  const manifest=JSON.parse(await fs.readFile(new URL('../v4-rollout/scheduled-kernel.json',import.meta.url),'utf8'));
  const bundleDirectory=path.join(root,manifest.sourceDigest);
  try{await fs.access(bundleDirectory);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    const staging=path.join(root,'kernel-'+randomUUID());
    await createEngineBundle(staging,{...manifest,sourceRoot:fileURLToPath(new URL('../../',import.meta.url))});
    await publishPreparedDirectory(staging,bundleDirectory);
  }
  await loadEngineBundle(bundleDirectory,manifest);
  return {accepted:true,bundleDirectory,sourceDigest:manifest.sourceDigest,engineVersion:manifest.engineVersion};
}

// Called by the same timer and due-time checks that start the original league
// and cup. One pending advance spans worker computation and ordered commits.
export async function openFormalSchedule({service,createService,rooms,getCatalog,releaseRate=32,duration=5400,now=()=>service.now()}){
  if(!Number.isFinite(releaseRate)||releaseRate<.25||releaseRate>64)throw new Error('V4公开时钟倍率须在0.25至64之间');
  // Persist constructor migrations and initialize a new league before opening
  // the durable queue against the same canonical store.
  let statePath,initialized=false;
  try{statePath=await fs.realpath(service.statePath);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    service.save({forceFull:true,skipDailyBackup:true});
    initialized=true;
    statePath=await fs.realpath(service.statePath);
  }
  const root=statePath+'.v4-schedule';
  await fs.mkdir(root,{recursive:true});
  if(await fs.realpath(root)!==root)throw new Error('赛程目录不可重定向');
  // A crash can leave a lock even before the first round record is durable.
  for(const file of ['league-scheduler.lock','cup-scheduler.lock','settlement.lock']){
    await recoverDispatchLock(path.join(root,file));
  }
  const candidate=await prepareKernel(root);
  if(!initialized)service.save({forceFull:true,skipDailyBackup:true});
  const preview=await openScheduledPreviewHost({root,rooms,league:service,enabled:true,scheduled:true,now});
  const registered=new Map();
  function register(record){
    if(registered.has(record.key))return;
    const count=()=>Array.from(registered.values()).reduce((sum,n)=>sum+n,0);
    while(count()+record.tasks.length>16){
      const oldest=registered.keys().next().value;
      preview.unregisterRound(oldest);
      registered.delete(oldest);
    }
    preview.registerRound(record,{publicWatch:true});
    registered.set(record.key,record.tasks.length);
  }
  function active(){
    const state=service.state;
    if(state.v4LocalLeagueRounds?.active)return state.v4LocalLeagueRounds.rounds[state.v4LocalLeagueRounds.active];
    if(state.v4LocalCupEvents?.active)return state.v4LocalCupEvents.events[state.v4LocalCupEvents.active];
    return null;
  }
  async function scheduler(kind){
    const options={root,service,createService,now,sourceCatalog:getCatalog()};
    const settlement=await openScheduledStorageSettlement(options);
    const open=kind==='cup'?openLocalCupScheduler:openLocalLeagueScheduler;
    const pin=active()?.enginePin;
    let selected=candidate;
    if(pin&&pin.sourceDigest!==candidate.sourceDigest){
      if(!/^[a-f0-9]{64}$/.test(pin.sourceDigest))throw new Error('赛程内核签名无效');
      selected={...pin,accepted:true,bundleDirectory:path.join(root,pin.sourceDigest)};
      await loadEngineBundle(selected.bundleDirectory,selected);
    }
    return open({...options,settlement,candidate:selected,enabled:true});
  }
  const awaitingCleanup=new Map();
  for(const round of completedRounds(service.state)){
    if(round.seasonId===service.state.season.id)awaitingCleanup.set(round.key,round);
  }
  for(const season of new Set(completedRounds(service.state).map(r=>r.seasonId))){
    if(season!==service.state.season.id)expireSeasonReplays(service,season);
  }
  async function finishArchives(){
    for(const [key,round] of awaitingCleanup){
      await compactRound(root,service,round);
      awaitingCleanup.delete(key);
    }
  }
  await finishArchives();
  const interrupted=active();
  if(interrupted){
    await (await scheduler(interrupted.competition??'league')).recover();
    register(active());
  }
  let pending=null,pendingKind=null,waitingUntil=0;
  async function advance(kind,record){
    if(record&&now()<waitingUntil)return false;
    const seasonId=service.state.season.id;
    const request={seasonId,duration:record?.duration??duration,releaseRate:record?.releaseRate??releaseRate};
    if(kind==='cup'){
      request.eventId=record?.eventId??service.state.cup.events.find(event=>event.status==='pending')?.id;
      if(!request.eventId)return false;
    }else request.roundNumber=record?.number??service.state.season.currentRound+1;
    const selected=await scheduler(kind);
    await finishArchives();
    let started=record;
    const result=await selected.advance(request,{onRoundStarted:round=>{started=round;register(round);}});
    if(result.complete&&started){
      const completed=completedRounds(service.state).find(r=>r.key===started.key);
      if(completed){
        await preview.finishRound(completed,service.state.matches);
        awaitingCleanup.set(completed.key,completed);
        await finishArchives();
      }
    }
    waitingUntil=result.pendingReleaseAt??0;
    return {...result,productionEnabled:true};
  }
  function run(kind,record){
    if(pending&&kind!==pendingKind)throw Object.assign(new Error('另一项赛事正在开赛'),{statusCode:409});
    if(!pending){
      pendingKind=kind;
      pending=advance(kind,record).finally(()=>{pending=null;pendingKind=null;});
    }
    return pending;
  }
  return {
    engineVersion:candidate.engineVersion,handle:preview.handle,
    get busy(){return Boolean(pending);},
    start:kind=>run(kind,null),
    resume(){const record=active();return record?run(record.competition??'league',record):false;},
  };
}
