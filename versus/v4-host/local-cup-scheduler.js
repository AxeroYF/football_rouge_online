import fs from 'node:fs/promises';
import path from 'node:path';
import {openCanonicalLocalStorageSettlement} from './canonical-storage-settlement.js';
import {createLocalDispatcher,openLocalDispatcher} from './dispatcher.js';
import {acquireDispatchLock,recoverDispatchLock} from './dispatch-store.js';
import {loadEngineBundle} from '../v4-rollout/bundle.js';
import {scheduledCupField} from './scheduled-cup.js';

// Explicit local-copy entry point. Production cup timers remain unchanged.
export async function openLocalCupScheduler({root,service,createService,sourceCatalog,candidate,enabled=false,now=Date.now,settlement:providedSettlement}){
  const directory=await fs.realpath(root),lock=path.join(directory,'cup-scheduler.lock');
  const settlement=providedSettlement??await openCanonicalLocalStorageSettlement({root:directory,service,createService,sourceCatalog,now});candidate=structuredClone(candidate);
  const queuePath=key=>path.join(directory,'cup-queue-'+key);
  return {
    settlement,
    async recover(){
      await recoverDispatchLock(lock);const release=await acquireDispatchLock(lock);
      try{
        await settlement.recoverAbandonedLock();await settlement.reload();const meta=(await settlement.read()).state.league[scheduledCupField];
        if(meta?.active){try{await fs.access(queuePath(meta.active));}catch(error){if(error.code==='ENOENT')return;throw error;}await (await openLocalDispatcher(queuePath(meta.active),{settlement,candidate,now})).recover();}
      }finally{await release();}
    },
    async advance(request,{signal,onRoundStarted=()=>{}}={}){
      if(!enabled)return {enabled:false,productionEnabled:false};
      const release=await acquireDispatchLock(lock);
      try{
        if(signal?.aborted)throw new Error('杯赛调度已暂停');
        if(candidate?.accepted!==true)throw new Error('本地杯赛调度需要已验收内核');await loadEngineBundle(candidate.bundleDirectory,candidate);
        const event=await settlement.beginCupEvent({...request,enginePin:{engineVersion:candidate.engineVersion,sourceDigest:candidate.sourceDigest}});
        if(event.status==='complete')return {enabled:true,complete:true,receipt:event.receipt,duplicate:true,productionEnabled:false};
        await onRoundStarted(structuredClone(event));
        let exists=true;try{await fs.access(queuePath(event.key));}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
        const queue=exists?await openLocalDispatcher(queuePath(event.key),{settlement,candidate,now}):await createLocalDispatcher(queuePath(event.key),{settlement,candidate,now,maxPending:64});
        const saved=await queue.read();if(saved.policyRevision===0)await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
        const known=new Set(saved.jobs.map(job=>job.fixture.id));
        if(saved.policyRevision>0&&saved.policy.mode==='off'&&event.tasks.some(task=>!known.has(task.fixture.id)))throw new Error('策略已回退，未锁定杯赛不能继续入队');
        for(const task of event.tasks){const job=await queue.enqueue(task);if(job.status==='legacy')throw new Error('本地杯赛不能把未执行的旧引擎任务标记为完成');}
        const drained=await queue.drain({signal});
        if(drained.pendingReleaseAt)return {enabled:true,complete:false,eventId:event.eventId,...drained,queueDirectory:queuePath(event.key),productionEnabled:false};
        const receipt=await settlement.finishCupEvent(request);return {enabled:true,complete:true,...drained,receipt,queueDirectory:queuePath(event.key),productionEnabled:false};
      }finally{await release();}
    },
  };
}
