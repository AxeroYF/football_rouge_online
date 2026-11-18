import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {selectMatchEngine} from '../v4-rollout/policy.js';
import {loadEngineBundle} from '../v4-rollout/bundle.js';
import {openSandboxJournal} from '../v4-rollout/sandbox-journal.js';
import {recoverShadowProducerLock} from './shadow-job.js';
import {createDispatchStore,openDispatchStore,acquireDispatchLock,recoverDispatchLock} from './dispatch-store.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>structuredClone(value);
const active=job=>job.selection.primary==='v4'||job.selection.shadow;
const pending=job=>active(job)&&job.status!=='settled';
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
function validatePolicy(value){
  if(!value||!['off','shadow','canary'].includes(value.mode)||Object.keys(value).some(key=>!['mode','fixtureAllowlist','competitions'].includes(key)))throw new Error('服务端调度策略无效');
  if(value.mode==='canary'&&(!Array.isArray(value.fixtureAllowlist)||value.fixtureAllowlist.length>128||value.fixtureAllowlist.some(id=>!validId(id))||!Array.isArray(value.competitions)||value.competitions.some(c=>!['league','cup'].includes(c))))throw new Error('灰度策略需要有限的比赛与赛事名单');
  return copy(value);
}
function runWorker(options,signal){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('调度已暂停'));return;}
    const child=fork(new URL('./dispatch-worker.js',import.meta.url),[],{windowsHide:true,execArgv:['--max-old-space-size=256'],stdio:['ignore','ignore','pipe','ipc']});
    let response,stderr='',stopped=false,processError=null;
    const stop=()=>{stopped=true;child.kill();};
    const timeout=setTimeout(stop,180000);signal?.addEventListener('abort',stop,{once:true});
    child.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-2000);});
    child.on('message',message=>{response=message;});
    const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',stop);};
    child.once('error',error=>{processError=error;});
    child.once('close',code=>{cleanup();if(code===0&&response?.ok&&!processError)resolve(response);else reject(new Error(stopped?'调度已暂停或工作进程超时':processError?.message||response?.error||stderr||`比赛工作进程退出 ${code}`));});
    child.send(options,error=>{if(error){processError=error;child.kill();}});
  });
}

export async function createLocalDispatcher(directory,options={}){
  await validateSettlement(options.settlement);
  const store=await createDispatchStore(directory,options);return dispatcher(store,options);
}
export async function openLocalDispatcher(directory,options={}){
  await validateSettlement(options.settlement);
  return dispatcher(await openDispatchStore(directory),options);
}

async function validateSettlement(settlement){
  if(typeof settlement?.read!=='function'||typeof settlement.settleJob!=='function'||!['canonical-shadow-only','canonical-local-storage-only','canonical-scheduled'].includes((await settlement.read()).state?.scope))throw new Error('调度需要已注册的业务结算协调层');
}

function dispatcher(store,{candidate=null,settlement,now=Date.now}={}){
  // candidate and policy are trusted host configuration, never request fields.
  // Canary means the V4 branch of this local rehearsal, not production enablement.
  if(!settlement||typeof settlement.settleJob!=='function')throw new Error('调度需要隔离业务结算协调层');
  candidate=copy(candidate);
  const leader=path.join(store.root,'dispatcher.lock');
  const jobDirectory=job=>path.join(store.root,'jobs',job.fixture.id);
  const changeJob=(id,apply)=>store.change(doc=>{const job=doc.jobs.find(j=>j.fixture.id===id);if(!job)throw new Error('调度比赛不存在');return apply(job);});
  async function recoverJob(job){
    const directory=jobDirectory(job);
    try{await fs.access(path.join(directory,'producer.lock'));await recoverShadowProducerLock(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await fs.access(path.join(directory,'journal','writer.lock'));await (await openSandboxJournal(path.join(directory,'journal'))).recoverAbandonedLock();}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {
    read:store.read,
    async setPolicy(policy,{expectedRevision}={}){
      const next=validatePolicy(policy);
      return store.change(doc=>{
        if(expectedRevision!==doc.policyRevision)throw new Error('调度策略版本冲突');
        if(doc.policyHistory.length>=256)throw new Error('策略历史已满，需要归档');
        const at=now();if(!Number.isSafeInteger(at)||at<0)throw new Error('调度时钟无效');
        doc.policyRevision++;doc.policy=next;doc.policyHistory.push({revision:doc.policyRevision,policy:copy(next),at});
        return {revision:doc.policyRevision,policy:copy(next)};
      });
    },
    async enqueue({fixture,envelope,context}){
      if(!validId(fixture?.id)||!['league','cup'].includes(fixture.competition)||context?.competition!==fixture.competition||!Number.isSafeInteger(context.round)||context.round<1||context.round>10000)throw new Error('调度比赛上下文无效');
      if(context.competition==='cup'&&(typeof context.event?.id!=='string'||!context.event.id||context.event.id.length>200||!['league','swiss','roundOf16','quarterfinals','semifinals','final'].includes(context.event.stage)||context.event.round!==context.round||![1,2].includes(context.event.leg)))throw new Error('调度杯赛上下文无效');
      if(envelope?.schema!=='yffm-v4-match-input-1'||envelope.input?.fixtureId!==fixture.id||envelope.input.format!=='full'||hash({engineVersion:envelope.engineVersion,input:envelope.input})!==envelope.fingerprint||!Array.isArray(envelope.coverage?.blockers))throw new Error('调度输入或指纹无效');
      const descriptor={fixture:copy(fixture),envelope:copy(envelope),context:copy(context)},requestDigest=hash(descriptor);
      ({fixture,envelope,context}=descriptor);
      const before=await store.read(),existing=before.jobs.find(j=>j.fixture.id===fixture.id);
      if(existing){if(existing.requestDigest!==requestDigest)throw new Error('比赛已锁定，禁止改变输入或上下文');return existing;}
      const accepted=candidate?.accepted===true&&candidate.engineVersion===envelope.engineVersion;
      // Check the actual frozen files before trusting the server's accepted flag.
      const proposed=selectMatchEngine({policy:before.policy,fixture,coverage:envelope.coverage,accepted});
      let checked=false;
      if(active({selection:proposed})){await loadEngineBundle(candidate.bundleDirectory,candidate);checked=true;}
      return store.change(doc=>{
        const prior=doc.jobs.find(j=>j.fixture.id===fixture.id);
        if(prior){if(prior.requestDigest!==requestDigest)throw new Error('比赛已锁定，禁止改变输入或上下文');return prior;}
        const selection=selectMatchEngine({policy:doc.policy,fixture,coverage:envelope.coverage,accepted});
        if(active({selection})&&!checked)throw new Error('调度策略刚发生变化，请重试入队');
        if(doc.jobs.length>=doc.limits.maxEntries||(active({selection})&&doc.jobs.filter(pending).length>=doc.limits.maxPending))throw new Error('调度队列容量已满');
        const job={...descriptor,requestDigest,selection,policyRevision:doc.policyRevision,sequence:doc.jobs.length,status:active({selection})?'queued':'legacy',attempts:0,
          bundle:active({selection})?{bundleDirectory:path.resolve(candidate.bundleDirectory),engineVersion:candidate.engineVersion,sourceDigest:candidate.sourceDigest}:null};
        doc.jobs.push(job);return job;
      });
    },
    async recover(){
      await recoverDispatchLock(leader);
      const release=await acquireDispatchLock(leader);
      try{
        await recoverDispatchLock(path.join(store.root,'writer.lock'));
        try{await settlement.recoverAbandonedLock();}catch(error){if(error.code!=='ENOENT')throw error;}
        const document=await store.read();for(const job of document.jobs.filter(pending))await recoverJob(job);
        return await store.change(doc=>{for(const job of doc.jobs)if(job.status==='running')job.status='queued';return {recovered:true};});
      }finally{await release();}
    },
    async retry(fixtureId){
      const release=await acquireDispatchLock(leader);
      try{return await changeJob(fixtureId,job=>{if(job.status!=='failed')throw new Error('只有失败任务可显式重试');job.status='queued';job.error=null;return job;});}finally{await release();}
    },
    async drain({signal,onProduced=()=>{},onSettled=()=>{}}={}){
      const release=await acquireDispatchLock(leader);let computed=0,settled=0;
      try{
        for(;;){
          if(signal?.aborted)throw new Error('调度已暂停');
          const document=await store.read(),queue=document.jobs.filter(pending),perWorker=document.limits.matchesPerWorker??1,batch=queue.slice(0,document.limits.maxWorkers*perWorker);
          if(!batch.length)return {computed,settled};
          if(batch.some(job=>job.status==='failed'))throw new Error('队列中存在失败任务，需要显式重试');
          const groups=[];for(let i=0;i<batch.length;i+=perWorker)groups.push(batch.slice(i,i+perWorker));
          const outcomes=new Map();
          const grouped=await Promise.allSettled(groups.map(async(jobs,workerSlot)=>{
            const ready=[];
            try{
              for(const job of jobs){
                if(job.status==='produced'){outcomes.set(job.fixture.id,{status:'fulfilled'});continue;}
                if(job.status==='running')throw new Error('发现中断任务，需先恢复调度');
                await recoverJob(job);
                await changeJob(job.fixture.id,current=>{current.status='running';current.workerSlot=workerSlot;current.attempts++;});ready.push(job);
              }
              if(!ready.length)return;
              const response=await runWorker({jobs:ready.map(job=>({directory:jobDirectory(job),...job.bundle,envelope:job.envelope,resume:true,tacticalReview:Boolean(job.context?.binding)}))},signal);
              if(!Array.isArray(response.results)||response.results.length!==ready.length||response.results.some((row,index)=>row.fixtureId!==ready[index].fixture.id))throw new Error('生产者组返回身份不一致');
              for(const [index,job] of ready.entries()){
                try{
                  const result=response.results[index];if(!result.ok)throw new Error(result.error);
                  computed++;await changeJob(job.fixture.id,current=>{current.status='produced';current.error=null;});await onProduced(copy(job));
                  outcomes.set(job.fixture.id,{status:'fulfilled'});
                }catch(error){await changeJob(job.fixture.id,current=>{current.status='failed';current.error=String(error.message).slice(0,1000);});outcomes.set(job.fixture.id,{status:'rejected',reason:error});}
              }
            }catch(error){
              for(const job of ready){await changeJob(job.fixture.id,current=>{current.status='failed';current.error=String(error.message).slice(0,1000);});outcomes.set(job.fixture.id,{status:'rejected',reason:error});}
              throw error;
            }
          }));
          for(const [index,result] of grouped.entries())if(result.status==='rejected')for(const job of groups[index])if(!outcomes.has(job.fixture.id))outcomes.set(job.fixture.id,result);
          // Computation may finish out of order. Business effects always follow
          // the durable queue order, including after a crash or a retry.
          for(let i=0;i<batch.length;i++){
            if(signal?.aborted)throw new Error('调度已暂停');
            const job=batch[i],outcome=outcomes.get(job.fixture.id);
            if(!outcome||outcome.status==='rejected')throw outcome?.reason??new Error('比赛缺少生产者结果');
            let receipt;
            try{receipt=await settlement.settleJob(jobDirectory(job),job.context);}
            catch(error){
              if(error.code==='V4_PUBLICATION_PENDING'&&Number.isSafeInteger(error.releaseAt)){
                const failure=[...outcomes.values()].find(outcome=>outcome.status==='rejected');
                if(failure)throw failure.reason;
                return {computed,settled,pendingReleaseAt:error.releaseAt};
              }
              throw error;
            }
            await onSettled({job:copy(job),receipt});
            await changeJob(job.fixture.id,current=>{current.status='settled';current.receipt=receipt;});settled++;
          }
        }
      }finally{await release();}
    },
  };
}
