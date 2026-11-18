import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {LeagueShardStore,unwrapTracked} from '../league-shard-store.js';
import {readCompletedShadowJob,applyCanonicalShadowResult} from './shadow-settlement.js';
import {acquireDispatchLock,recoverDispatchLock} from './dispatch-store.js';
import {openArchive} from '../v4-stream/archive.js';
import {beginScheduledLeagueRound,finishScheduledLeagueRound,scheduledFixtureBinding,scheduledLeagueField} from './scheduled-league.js';
import {beginScheduledCupEvent,finishScheduledCupEvent,scheduledCupFixtureBinding,scheduledCupField} from './scheduled-cup.js';
import {applySeasonBoundary,seasonBoundaryField} from './season-boundary.js';

const field='v4LocalSettlements',format='yffm-v4-canonical-local-settlement-1';
const copy=value=>structuredClone(value);
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])]));
  return value;
}
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function inside(root,file){const relative=path.relative(root,file);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
function descriptorFor(context){
  if(!['league','cup'].includes(context?.competition)||!Number.isSafeInteger(context.round)||context.round<1||context.round>10000)throw new Error('原存储结算上下文无效');
  if(context.competition==='cup'&&(typeof context.event?.id!=='string'||!context.event.id||context.event.id.length>200||context.event.round!==context.round||![1,2].includes(context.event.leg)||!['league','swiss','roundOf16','quarterfinals','semifinals','final'].includes(context.event.stage)))throw new Error('原存储杯赛上下文无效');
  if(context.binding&&(typeof context.binding.seasonId!=='string'||!Number.isSafeInteger(context.binding.fixtureIndex)||context.binding.fixtureIndex<0||!['roundKey','scheduleDigest'].every(key=>/^[a-f0-9]{64}$/.test(context.binding[key]))))throw new Error('原存储赛程绑定无效');
  return {competition:context.competition,round:context.round,event:context.competition==='cup'?copy(context.event):null,...(context.binding?{binding:copy(context.binding)}:{})};
}
const fixtureBinding=(state,context,pinned)=>context.competition==='cup'?scheduledCupFixtureBinding(state,context,pinned):scheduledFixtureBinding(state,context,pinned);

// Both modes use the existing JSON/shard writer. Local rehearsals must
// supply a marked copy. The formal host binds to the service's own path.
// The caller supplies a service; importing this module never creates a singleton.
export function openCanonicalLocalStorageSettlement(options){
  return openStorageSettlement(options,false);
}

export function openScheduledStorageSettlement(options){
  return openStorageSettlement(options,true);
}

async function openStorageSettlement({root,service,createService,now=Date.now,sourceCatalog=null},scheduled){
  sourceCatalog=sourceCatalog?copy(sourceCatalog):null;
  const directory=fs.realpathSync.native(root);
  if(!scheduled&&JSON.parse(fs.readFileSync(path.join(directory,'v4-local-storage.json'),'utf8')).format!==format)throw new Error('缺少原存储隔离标记');
  if(!service?.statePath||typeof service.adoptState!=='function'||typeof service.save!=='function'||typeof createService!=='function')throw new Error('原存储结算服务配置无效');
  if(!scheduled&&service.backupDir!==null)throw new Error('隔离副本必须禁用自动备份');
  const statePath=fs.realpathSync.native(service.statePath);
  if(scheduled?path.relative(directory,statePath+'.v4-schedule')!=='':!inside(directory,statePath))throw new Error(scheduled?'原存储路径与赛程目录不匹配':'原存储路径必须位于标记副本内');
  if(service.shardStore&&path.relative(fs.realpathSync.native(service.shardStore.root),statePath)!=='')throw new Error('分片存储路径不匹配');
  const lock=path.join(directory,'settlement.lock'),sharded=Boolean(service.shardStore);
  function load(){
    const backend=sharded?new LeagueShardStore(statePath,{backupDir:scheduled?service.backupDir:null}):null;
    const state=backend?unwrapTracked(backend.load()):JSON.parse(fs.readFileSync(statePath,'utf8'));
    if(!state||!Array.isArray(state.teams)||!Array.isArray(state.matches))throw new Error('原存储状态无效');
    if(state[field]&&(state[field].format!==format||!state[field].pins||!state[field].receipts||!Number.isSafeInteger(state[field].revision)))throw new Error('原存储V4回执格式无效');
    return {state,backend};
  }
  function adopt({state,backend}){
    if(backend)service.shardStore=backend;
    service.adoptState(state,false);service.dirtyScopes=new Set();service.playerDirectoryCache=null;
  }
  function pendingReadsOnly(disk,memory,memoryDigest){
    if(!service.inboxReadPersistStartedAt||!service.inboxReadPersistTimer||!Number.isSafeInteger(memory.updatedAt)||memory.updatedAt<Number(disk.updatedAt??0))return false;
    const expected=copy(disk);let changed=0;
    for(const [teamId,messages] of Object.entries(memory.inbox??{})){
      const saved=disk.inbox?.[teamId];if(!Array.isArray(messages)||!Array.isArray(saved)||messages.length!==saved.length)return false;
      for(const [index,message] of messages.entries()){
        const prior=saved[index];if(message.id!==prior.id)return false;
        if(message.readAt!==prior.readAt){
          if(!Number.isSafeInteger(message.readAt)||message.readAt<=0||message.readAt<Number(prior.readAt??0))return false;
          expected.inbox[teamId][index].readAt=message.readAt;changed++;
        }
      }
    }
    expected.updatedAt=memory.updatedAt;
    return changed>0&&digest(expected)===memoryDigest;
  }
  function assertCurrent({flushReads=true}={}){
    const current=load(),memory=unwrapTracked(service.state);
    // The existing shard loader materializes a missing World Cup live slot as
    // null. Compare that exact storage meaning; all business fields stay strict.
    if(sharded&&memory.liveWorldCupRound===undefined)memory.liveWorldCupRound=null;
    const memoryDigest=digest(memory);
    if(digest(current.state)!==memoryDigest){
      // The existing inbox API deliberately batches readAt writes. Reconcile
      // only this proven delta before replacing the service state. A wallet,
      // roster, message-content or external disk change still fails closed.
      if(flushReads&&pendingReadsOnly(current.state,memory,memoryDigest)){
        try{
          const saved=service.save({skipDailyBackup:true,skipLiveBackupCopy:true,compact:true});
          if(saved?.then)throw new Error('已读协调必须同步提交');
        }catch(error){service.scheduleInboxReadPersist?.();throw error;}
        return assertCurrent({flushReads:false});
      }
      const changed=[...new Set([...Object.keys(current.state),...Object.keys(memory)])].filter(key=>JSON.stringify(stable(current.state[key]))!==JSON.stringify(stable(memory[key])));
      throw new Error('原存储与内存状态不同，需先保存或重新载入，不能覆盖并发变更：'+changed.join(', '));
    }
    return current;
  }
  assertCurrent();
  function commit(next,identity,phase){
    const before=assertCurrent();
    for(let attempt=0;;attempt++){
      service.adoptState(next,true);
      try{
        const result=service.save({forceFull:true,skipDailyBackup:true,skipLiveBackupCopy:true,compact:true});
        if(result?.then)throw new Error('原存储提交必须同步');
        // The original shard writer stores a finished season as a cold archive
        // and reloads only its index. Adopt that committed representation so the
        // next strict comparison does not mistake full-vs-index for a conflict.
        if(sharded&&phase==='season-boundary'&&next[seasonBoundaryField]?.receipts?.[identity.fixtureId]?.phase==='reset')adopt(load());
        return {recoveredCommit:false};
      }catch(error){
        // A writer may fail after its atomic rename (e.g. shard GC). Read the
        // committed state before deciding whether to retry the business effect.
        const disk=load();adopt(disk);
        const committed=phase==='season-boundary'?disk.state[seasonBoundaryField]?.receipts?.[identity.fixtureId]:phase==='cup-start'?disk.state[scheduledCupField]?.events?.[identity.fixtureId]:phase==='cup-finish'?disk.state[scheduledCupField]?.events?.[identity.fixtureId]?.receipt:phase==='round-start'?disk.state[scheduledLeagueField]?.rounds?.[identity.fixtureId]:phase==='round-finish'?disk.state[scheduledLeagueField]?.rounds?.[identity.fixtureId]?.receipt:phase==='pin'?disk.state[field]?.pins?.[identity.fixtureId]:disk.state[field]?.receipts?.[identity.fixtureId];
        if(committed?.identityDigest===identity.identityDigest)return {recoveredCommit:true};
        if(digest(disk.state)!==digest(before.state))throw new Error('原存储提交状态不确定，已重新载入磁盘，禁止继续结算',{cause:error});
        if(attempt<4&&['EPERM','EACCES','EBUSY'].includes(error.code)){
          // Retry only after proving the previous durable state is unchanged.
          // This synchronous critical section cannot interleave business writes.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*(attempt+1));continue;
        }
        throw error;
      }
    }
  }
  function noTransientWork(){
    if(service.liveSettlementJobs?.length||service.liveSettlementJobKeys?.size||(!scheduled&&service.liveAiTrainings?.size))throw new Error('存在待结算赛事或AI训练，禁止重叠操作轮次');
  }
  return {
    async read(){const {state}=load();return {state:{scope:scheduled?'canonical-scheduled':'canonical-local-storage-only',league:state},receipts:copy(state[field]?.receipts??{})};},
    async recoverAbandonedLock(){return recoverDispatchLock(lock);},
    async reload(){const release=await acquireDispatchLock(lock,{wait:true});try{adopt(load());}finally{await release();}},
    async finishSeasonBoundary({seasonId,phase}){
      const release=await acquireDispatchLock(lock,{wait:true});
      try{
        noTransientWork();const original=assertCurrent().state,applied=applySeasonBoundary({league:original,seasonId,phase,at:now(),createService});
        if(applied.duplicate)return {...applied.receipt,duplicate:true};
        const identity={fixtureId:applied.receipt.key,identityDigest:digest({receipt:applied.receipt,sourceFingerprint:digest(original)})};
        applied.league[seasonBoundaryField].receipts[identity.fixtureId].identityDigest=identity.identityDigest;
        const outcome=commit(applied.league,identity,'season-boundary');return {...copy(applied.league[seasonBoundaryField].receipts[identity.fixtureId]),...outcome};
      }finally{await release();}
    },
    async beginCupEvent({seasonId,eventId,duration=5400,releaseRate=1,enginePin=null}){
      if(!sourceCatalog)throw new Error('启动杯赛需要已解析的球员目录');
      const release=await acquireDispatchLock(lock,{wait:true});
      try{
        noTransientWork();const applied=beginScheduledCupEvent({league:assertCurrent().state,seasonId,eventId,duration,releaseRate,enginePin,at:now(),createService,catalog:sourceCatalog.catalog,traitCatalog:sourceCatalog.traitCatalog,bondCatalog:sourceCatalog.bondCatalog});
        if(applied.duplicate)return {...applied.event,duplicate:true};
        const identity={fixtureId:applied.event.key,identityDigest:digest({competition:'cup',seasonId,eventId,duration,releaseRate,enginePin,sourceFingerprint:applied.event.sourceFingerprint})};
        applied.league[scheduledCupField].events[applied.event.key].identityDigest=identity.identityDigest;
        const outcome=commit(applied.league,identity,'cup-start');return {...copy(applied.league[scheduledCupField].events[applied.event.key]),...outcome};
      }finally{await release();}
    },
    async finishCupEvent({seasonId,eventId}){
      const release=await acquireDispatchLock(lock,{wait:true});
      try{
        noTransientWork();const applied=finishScheduledCupEvent({league:assertCurrent().state,seasonId,eventId,at:now(),createService});
        if(applied.duplicate)return {...applied.receipt,duplicate:true};
        const record=Object.values(applied.league[scheduledCupField].events).find(event=>event.seasonId===seasonId&&event.eventId===eventId);record.receipt.identityDigest=record.identityDigest;
        record.receipt.localOnly=!scheduled;
        const outcome=commit(applied.league,{fixtureId:record.key,identityDigest:record.identityDigest},'cup-finish');return {...copy(record.receipt),...outcome};
      }finally{await release();}
    },
    async beginRound({seasonId,roundNumber,duration=5400,releaseRate=1,enginePin=null}){
      if(!sourceCatalog)throw new Error('启动整轮需要已解析的球员目录');
      const release=await acquireDispatchLock(lock,{wait:true});
      try{
        noTransientWork();const original=assertCurrent().state;
        const applied=beginScheduledLeagueRound({league:original,seasonId,roundNumber,duration,releaseRate,enginePin,at:now(),createService,catalog:sourceCatalog.catalog,traitCatalog:sourceCatalog.traitCatalog,bondCatalog:sourceCatalog.bondCatalog});
        if(applied.duplicate)return {...applied.round,duplicate:true};
        const identity={fixtureId:applied.round.key,identityDigest:digest({seasonId,roundNumber,duration,releaseRate,enginePin,sourceFingerprint:applied.round.sourceFingerprint})};
        applied.league[scheduledLeagueField].rounds[applied.round.key].identityDigest=identity.identityDigest;
        const outcome=commit(applied.league,identity,'round-start');return {...copy(applied.league[scheduledLeagueField].rounds[applied.round.key]),...outcome};
      }finally{await release();}
    },
    async finishRound({seasonId,roundNumber}){
      const release=await acquireDispatchLock(lock,{wait:true});
      try{
        noTransientWork();const applied=finishScheduledLeagueRound({league:assertCurrent().state,seasonId,roundNumber,at:now(),createService});
        if(applied.duplicate)return {...applied.receipt,duplicate:true};
        const record=Object.values(applied.league[scheduledLeagueField].rounds).find(r=>r.seasonId===seasonId&&r.number===roundNumber);
        record.receipt.identityDigest=record.identityDigest;
        record.receipt.localOnly=!scheduled;
        const outcome=commit(applied.league,{fixtureId:record.key,identityDigest:record.identityDigest},'round-finish');return {...copy(record.receipt),...outcome};
      }finally{await release();}
    },
    async settleJob(jobDirectory,context){
      const {pinned,result}=await readCompletedShadowJob(jobDirectory),descriptor=descriptorFor(context);
      let completedThrough=null;
      if(descriptor.binding){
        const archive=await openArchive(path.join(jobDirectory,'archive')),manifest=archive.manifest;
        if(!manifest.complete||!manifest.segments.at(-1)?.complete||manifest.matchId!==pinned.fixtureId||manifest.engineVersion!==pinned.engineVersion||manifest.sourceDigest!==pinned.sourceDigest||manifest.inputFingerprint!==pinned.inputFingerprint)throw new Error('赛程录像未完整或锁定身份不一致');
        completedThrough=archive.producedThrough;
      }
      const release=await acquireDispatchLock(lock,{wait:true});
      try{
        let state=copy(assertCurrent().state);
        const at=now();if(!Number.isSafeInteger(at)||at<0)throw new Error('原存储结算时钟无效');
        const identity={fixtureId:pinned.fixtureId,engineVersion:pinned.engineVersion,sourceDigest:pinned.sourceDigest,inputFingerprint:pinned.inputFingerprint,resultDigest:digest(result),seasonId:state.season.id,context:descriptor};
        identity.identityDigest=digest(identity);
        const journal=state[field]??={format,revision:0,pins:{},receipts:{}};
        if((state[scheduledLeagueField]?.active||state[scheduledCupField]?.active)&&!descriptor.binding)throw new Error('运行中的V4轮次只接受已绑定赛程结果');
        // Reject early consumption before even creating a settlement pin. Once
        // committed, retries resolve the durable receipt before rebinding.
        if(descriptor.binding&&!journal.receipts[pinned.fixtureId]){
          noTransientWork();const binding=fixtureBinding(state,descriptor,pinned);
          const releaseAt=binding.record.startedAt+Math.ceil(completedThrough*1000/binding.record.releaseRate);
          if(at<releaseAt)throw Object.assign(new Error('完整赛果尚未到公开发布时间'),{code:'V4_PUBLICATION_PENDING',releaseAt});
        }
        let pin=Object.hasOwn(journal.pins,pinned.fixtureId)?journal.pins[pinned.fixtureId]:null;
        if(pin&&pin.identityDigest!==identity.identityDigest)throw new Error('原存储比赛已锁定到不同输入、赛季或上下文');
        if(!pin){
          if(Object.keys(journal.pins).length>=4096)throw new Error('原存储回执容量已满，需要归档');
          pin={...identity,settledAt:at};Object.defineProperty(journal.pins,pinned.fixtureId,{value:pin,enumerable:true,writable:true,configurable:true});journal.revision++;
          commit(state,identity,'pin');state=copy(assertCurrent().state);
        }
        const prior=Object.hasOwn(state[field].receipts,pinned.fixtureId)?state[field].receipts[pinned.fixtureId]:null;
        if(prior){if(prior.identityDigest!==identity.identityDigest)throw new Error('原存储结算回执冲突');return {...copy(prior),duplicate:true};}
        const scheduledBinding=descriptor.binding?fixtureBinding(state,descriptor,pinned):null;
        const applied=applyCanonicalShadowResult({state:{league:state,fixtures:{}},pinned,result,descriptor,settledAt:pin.settledAt,createService,scheduledBinding});
        const receipt={...identity,settledAt:pin.settledAt,matchId:applied.fixtures[pinned.fixtureId].matchId,localOnly:!scheduled};
        if(scheduledBinding){
          receipt.releaseAt=scheduledBinding.record.startedAt+Math.ceil(completedThrough*1000/scheduledBinding.record.releaseRate);
          scheduledBinding.record.settled[pinned.fixtureId]=copy(receipt);applied.league[descriptor.competition==='cup'?scheduledCupField:scheduledLeagueField].revision++;
        }
        Object.defineProperty(applied.league[field].receipts,pinned.fixtureId,{value:receipt,enumerable:true,writable:true,configurable:true});applied.league[field].revision++;
        const outcome=commit(applied.league,identity,'settlement');return {...receipt,...outcome};
      }finally{await release();}
    },
  };
}
