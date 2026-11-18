import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {replaceCommittedFile,publishPreparedDirectory} from '../v4-stream/atomic-file.js';

const format='yffm-v4-local-dispatch-1';
const copy=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const localIO=new Map();
async function serializeIO(file,operation){
  const previous=localIO.get(file)??Promise.resolve();let release;
  const turn=new Promise(resolve=>{release=resolve;});localIO.set(file,turn);
  await previous;
  try{return await operation();}finally{release();if(localIO.get(file)===turn)localIO.delete(file);}
}

export async function acquireDispatchLock(file,{wait=false}={}){
  const deadline=Date.now()+5000;
  for(;;){
    let handle;
    try{handle=await fs.open(file,'wx');}
    catch(error){
      if(error.code!=='EEXIST'&&!(wait&&['EPERM','EACCES','EBUSY'].includes(error.code)))throw error;
      if(!wait||Date.now()>=deadline)throw new Error('调度锁已占用，禁止并发或自动抢锁');
      await new Promise(resolve=>setTimeout(resolve,10));continue;
    }
    try{await handle.writeFile(JSON.stringify({format,pid:process.pid,nonce:randomUUID()}));await handle.sync();}
    catch(error){await handle.close();throw error;}
    return async()=>{await handle.close();await fs.unlink(file);};
  }
}

export async function recoverDispatchLock(file){
  let owner;try{owner=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(owner.format!==format||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw new Error('调度锁属主无效');
  try{process.kill(owner.pid,0);throw new Error('原调度进程仍在运行');}catch(error){if(error.code!=='ESRCH')throw error;}
  await fs.unlink(file);return true;
}

export async function createDispatchStore(directory,{maxWorkers=2,maxPending=32,matchesPerWorker=4}={}){
  if(!Number.isSafeInteger(maxWorkers)||maxWorkers<1||maxWorkers>2||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>128||!Number.isSafeInteger(matchesPerWorker)||matchesPerWorker<1||matchesPerWorker>4)throw new Error('调度容量参数无效');
  const root=path.resolve(directory),staging=path.join(path.dirname(root),`.${path.basename(root)}.initializing-${randomUUID()}`);
  try{await fs.lstat(root);throw new Error('调度目录已存在');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(staging);
  const handle=await fs.open(path.join(staging,'dispatch.json'),'wx');
  try{await handle.writeFile(JSON.stringify({format,scope:'local-rehearsal-only',revision:0,policyRevision:0,policy:{mode:'off'},policyHistory:[],limits:{maxWorkers,maxPending,matchesPerWorker,maxEntries:256},jobs:[]}));await handle.sync();}finally{await handle.close();}
  await fs.mkdir(path.join(staging,'jobs'));await publishPreparedDirectory(staging,root);
  return openDispatchStore(root);
}

export async function openDispatchStore(directory){
  const root=path.resolve(directory),file=path.join(root,'dispatch.json');
  async function read(){
    // Share this gate across reopened handles. On Windows, frequent readers
    // otherwise keep the destination open throughout the bounded rename retry.
    const value=JSON.parse(await serializeIO(file,()=>fs.readFile(file,'utf8')));
    if(value.format!==format||value.scope!=='local-rehearsal-only'||!Number.isSafeInteger(value.revision)||!Array.isArray(value.jobs)||value.jobs.length>256||!Number.isSafeInteger(value.limits?.maxWorkers)||value.limits.maxWorkers<1||value.limits.maxWorkers>2)throw new Error('只能打开本地隔离调度记录');
    if(!Number.isSafeInteger(value.policyRevision)||value.policyRevision<0||!Array.isArray(value.policyHistory)||value.policyHistory.length!==value.policyRevision||value.limits.maxEntries!==256||!Number.isSafeInteger(value.limits.maxPending)||value.limits.maxPending<1||value.limits.maxPending>128)throw new Error('调度容量或策略记录损坏');
    if(value.limits.matchesPerWorker!==undefined&&(!Number.isSafeInteger(value.limits.matchesPerWorker)||value.limits.matchesPerWorker<1||value.limits.matchesPerWorker>4))throw new Error('每个生产者的比赛上限无效');
    const ids=new Set();
    value.jobs.forEach((job,index)=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(job.fixture?.id??'')||ids.has(job.fixture.id)||job.sequence!==index||!['legacy','queued','running','produced','failed','settled'].includes(job.status)||job.requestDigest!==hash({fixture:job.fixture,envelope:job.envelope,context:job.context})||job.envelope?.fingerprint!==hash({engineVersion:job.envelope.engineVersion,input:job.envelope.input})||job.selection?.fixtureId!==job.fixture.id||!['legacy','v4'].includes(job.selection.primary))throw new Error('调度比赛锁定记录损坏');
      ids.add(job.fixture.id);
      const active=job.selection.primary==='v4'||job.selection.shadow;
      if(active&&(!job.bundle||job.bundle.engineVersion!==job.envelope.engineVersion||!/^[a-f0-9]{64}$/.test(job.bundle.sourceDigest??''))||!active&&job.status!=='legacy')throw new Error('调度锁定引擎或状态无效');
    });
    return value;
  }
  await read();
  return {
    root,read:async()=>copy(await read()),
    async change(apply){
      const release=await acquireDispatchLock(path.join(root,'writer.lock'),{wait:true});
      try{
        const document=await read(),result=apply(document);
        if(result?.then)throw new Error('调度记录变更必须同步');
        document.revision++;
        const pending=path.join(root,`dispatch.pending-${randomUUID()}`),handle=await fs.open(pending,'wx');
        try{await handle.writeFile(JSON.stringify(document));await handle.sync();}finally{await handle.close();}
        await serializeIO(file,()=>replaceCommittedFile(pending,file));return copy(result);
      }finally{await release();}
    },
  };
}
