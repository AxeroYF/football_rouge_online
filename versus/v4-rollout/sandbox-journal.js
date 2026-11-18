import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {replaceCommittedFile} from '../v4-stream/atomic-file.js';
const kind='yffm-v4-rollout-sandbox-1';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=200;
const copy=value=>structuredClone(value);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Deliberately isolated settlement storage, never the formal league JSON.
// State and settlement receipt are committed in ONE atomic document, so a
// crash cannot acknowledge a result separately from its state changes.
export async function createSandboxJournal(directory,initialState={}){
  const root=path.resolve(directory);await fs.mkdir(root);
  await fs.writeFile(path.join(root,'journal.json'),JSON.stringify({kind,revision:0,state:copy(initialState),fixtures:{},receipts:{}}),{flag:'wx'});
  return openSandboxJournal(root);
}
export async function openSandboxJournal(directory){
  const root=path.resolve(directory),file=path.join(root,'journal.json'),lock=path.join(root,'writer.lock');
  async function read(){const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.kind!==kind||!Number.isSafeInteger(value.revision)||!value.fixtures||!value.receipts)throw new Error('仅可打开 V4 隔离结算日志');return value;}
  await read();
  async function transaction(change){
    const started=Date.now();let handle;
    while(!handle){try{handle=await fs.open(lock,'wx');}
      catch(error){if(!['EEXIST','EPERM','EACCES','EBUSY'].includes(error.code))throw error;if(Date.now()-started>5000)throw new Error('隔离日志写入锁超时，需检查进程状态');await sleep(10);}}
    // Windows may report a transient sharing denial instead of EEXIST. Every
    // retry still uses exclusive creation; never unlink or steal another lock.
    // An owner-record write failure must not enter the transaction body.
    try{await handle.writeFile(JSON.stringify({pid:process.pid,nonce:randomUUID()}));await handle.sync();}
    catch(error){await handle.close();throw error;}
    let temporary;
    try{
      const document=await read(),result=change(document);if(result?.then)throw new Error('结算变更必须为同步纯变更');document.revision++;
      temporary=path.join(root,`journal.pending-${randomUUID()}`);const target=await fs.open(temporary,'wx');
      try{await target.writeFile(JSON.stringify(document));await target.sync();}finally{await target.close();}
      await replaceCommittedFile(temporary,file);return copy(result);
    }finally{await handle.close();await fs.unlink(lock);}
  }
  return {
    read:async()=>copy(await read()),
    async recoverAbandonedLock(){
      const owner=JSON.parse(await fs.readFile(lock,'utf8'));if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw new Error('锁属主无效，需人工检查');
      try{process.kill(owner.pid,0);throw new Error('原写入进程仍在运行');}catch(error){if(error.code!=='ESRCH')throw error;}
      await fs.unlink(lock);
    },
    pin({fixtureId,engineVersion,sourceDigest,inputFingerprint,input,selection}){
      if(!validId(fixtureId)||!validId(engineVersion)||![sourceDigest,inputFingerprint].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||selection?.fixtureId!==fixtureId||!['v4','legacy'].includes(selection?.primary))throw new Error('比赛锁定信息无效');
      if(digest({engineVersion,input})!==inputFingerprint)throw new Error('锁定输入指纹无效');
      return transaction(doc=>{
        const existing=Object.hasOwn(doc.fixtures,fixtureId)?doc.fixtures[fixtureId]:null;if(existing){if(existing.inputFingerprint!==inputFingerprint||existing.engineVersion!==engineVersion||existing.sourceDigest!==sourceDigest)throw new Error('比赛已锁定，不能改版本或输入');return existing;}
        const pinned={fixtureId,engineVersion,sourceDigest,inputFingerprint,input:copy(input),selection:copy(selection),status:'pinned',checkpoint:null,result:null};
        Object.defineProperty(doc.fixtures,fixtureId,{value:pinned,enumerable:true,writable:true,configurable:true});return pinned;
      });
    },
    checkpoint(fixtureId,checkpoint){
      const value=typeof checkpoint==='string'?JSON.parse(checkpoint):copy(checkpoint);
      return transaction(doc=>{
        const fixture=Object.hasOwn(doc.fixtures,fixtureId)?doc.fixtures[fixtureId]:null;
        if(!fixture||fixture.status==='settled'||fixture.result)throw new Error('比赛不接受检查点');
        if(value.format!=='yffm-v4-checkpoint-1'||value.state?.version!==fixture.engineVersion||digest({engineVersion:value.state.version,input:value.state.input})!==fixture.inputFingerprint||!Number.isSafeInteger(value.state.tick)||value.state.tick<0||fixture.checkpoint&&value.state.tick<fixture.checkpoint.tick)throw new Error('检查点版本、输入或时间不匹配');
        fixture.checkpoint={tick:value.state.tick,digest:digest(value),value};fixture.status='running';return {tick:value.state.tick};
      });
    },
    complete(fixtureId,result){
      return transaction(doc=>{
        const fixture=Object.hasOwn(doc.fixtures,fixtureId)?doc.fixtures[fixtureId]:null;
        if(!fixture||result.fixtureId!==fixtureId||result.engineVersion!==fixture.engineVersion||result.inputFingerprint!==fixture.inputFingerprint||!Array.isArray(result.score)||result.score.length!==2||result.score.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('完赛结果与锁定比赛不匹配');
        const fingerprint=digest(result);if(fixture.result){if(fixture.result.digest!==fingerprint)throw new Error('同场比赛存在冲突赛果');return fixture.result;}
        fixture.result={digest:fingerprint,value:copy(result)};fixture.status='finished';return fixture.result;
      });
    },
    settle(fixtureId,apply){
      if(typeof apply!=='function')throw new Error('需要隔离结算函数');
      return transaction(doc=>{
        const fixture=Object.hasOwn(doc.fixtures,fixtureId)?doc.fixtures[fixtureId]:null;if(!fixture?.result)throw new Error('比赛尚未完赛');
        if(Object.hasOwn(doc.receipts,fixtureId))return {...doc.receipts[fixtureId],duplicate:true};
        const next=apply(copy(doc.state),copy(fixture.result.value));if(!next||typeof next!=='object'||next.then)throw new Error('隔离结算必须返回状态对象');
        doc.state=next;const receipt={fixtureId,resultDigest:fixture.result.digest,engineVersion:fixture.engineVersion,revision:doc.revision+1,sandboxOnly:true};
        Object.defineProperty(doc.receipts,fixtureId,{value:receipt,enumerable:true,writable:true,configurable:true});fixture.status='settled';return receipt;
      });
    }
  };
}
