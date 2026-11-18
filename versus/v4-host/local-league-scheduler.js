import fs from 'node:fs/promises';
import path from 'node:path';
import {openCanonicalLocalStorageSettlement} from './canonical-storage-settlement.js';
import {createLocalDispatcher,openLocalDispatcher} from './dispatcher.js';
import {acquireDispatchLock,recoverDispatchLock} from './dispatch-store.js';
import {loadEngineBundle} from '../v4-rollout/bundle.js';
import {scheduledLeagueField} from './scheduled-league.js';

// Explicitly invoked local-copy scheduler; no timer or production registration.
// A crashed enqueue is resumed from tasks committed with the running round.
export async function openLocalLeagueScheduler({root,service,createService,sourceCatalog,candidate,enabled=false,now=Date.now,settlement:providedSettlement}){
  const directory=await fs.realpath(root),lock=path.join(directory,'league-scheduler.lock');
  const settlement=providedSettlement??await openCanonicalLocalStorageSettlement({root:directory,service,createService,sourceCatalog,now});
  candidate=structuredClone(candidate);
  const queuePath=key=>path.join(directory,'league-queue-'+key);
  return {
    settlement,
    async recover(){
      await recoverDispatchLock(lock);const release=await acquireDispatchLock(lock);
      try{
        await settlement.recoverAbandonedLock();await settlement.reload();
        const meta=(await settlement.read()).state.league[scheduledLeagueField];
        if(meta?.active){
          try{await fs.access(queuePath(meta.active));}catch(error){if(error.code==='ENOENT')return;throw error;}
          await (await openLocalDispatcher(queuePath(meta.active),{settlement,candidate,now})).recover();
        }
      }finally{await release();}
    },
    async advance(request,{signal,onRoundStarted=()=>{}}={}){
      if(!enabled)return {enabled:false,productionEnabled:false};
      const release=await acquireDispatchLock(lock);
      try{
        if(signal?.aborted)throw new Error('轮次调度已暂停');
        // Validate the accepted bundle before marking an untouched round running.
        if(candidate?.accepted!==true)throw new Error('本地轮次调度需要已验收内核');
        await loadEngineBundle(candidate.bundleDirectory,candidate);
        const round=await settlement.beginRound({...request,enginePin:{engineVersion:candidate.engineVersion,sourceDigest:candidate.sourceDigest}});
        if(round.status==='complete')return {enabled:true,complete:true,receipt:round.receipt,duplicate:true,productionEnabled:false};
        await onRoundStarted(structuredClone(round));
        let exists=true;try{await fs.access(queuePath(round.key));}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
        const queue=exists?await openLocalDispatcher(queuePath(round.key),{settlement,candidate,now}):await createLocalDispatcher(queuePath(round.key),{settlement,candidate,now,maxPending:64});
        const saved=await queue.read();
        if(saved.policyRevision===0)await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
        // Never silently undo a subsequent host policy change. Already pinned
        // tasks can continue; off blocks adding the remaining round tasks.
        const known=new Set(saved.jobs.map(job=>job.fixture.id));
        if(saved.policyRevision>0&&saved.policy.mode==='off'&&round.tasks.some(task=>!known.has(task.fixture.id)))throw new Error('策略已回退，未锁定赛程不能继续入队');
        for(const task of round.tasks){
          const job=await queue.enqueue(task);
          if(job.status==='legacy')throw new Error('本地整轮演练不能把未执行的旧引擎任务标记为完成');
        }
        const drained=await queue.drain({signal});
        if(drained.pendingReleaseAt)return {enabled:true,complete:false,roundNumber:round.number,...drained,queueDirectory:queuePath(round.key),productionEnabled:false};
        const receipt=await settlement.finishRound(request);
        return {enabled:true,complete:true,...drained,receipt,queueDirectory:queuePath(round.key),productionEnabled:false};
      }finally{await release();}
    },
  };
}
