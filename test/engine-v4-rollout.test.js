import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {selectMatchEngine} from '../versus/v4-rollout/policy.js';
import {createSandboxJournal,openSandboxJournal} from '../versus/v4-rollout/sandbox-journal.js';
const fixture={id:'fixture-1',competition:'friendly'},input={seed:'locked'},engineVersion='test-v4';
const selection={fixtureId:fixture.id,primary:'v4',shadow:false};
const pin={fixtureId:fixture.id,engineVersion,sourceDigest:'a'.repeat(64),inputFingerprint:createHash('sha256').update(JSON.stringify({engineVersion,input})).digest('hex'),input,selection};
const result={fixtureId:fixture.id,engineVersion,inputFingerprint:pin.inputFingerprint,score:[2,1],settlementAllowed:false};

test('sandbox lock retries transient exclusive-open denials but bounds permanent failures without changing state',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-lock-denial-')),directory=path.join(root,'store'),store=await createSandboxJournal(directory,{played:0}),lock=path.join(directory,'writer.lock'),open=fs.open.bind(fs);
  let attempts=0,permanent=false;t.mock.method(fs,'open',async(file,...args)=>{if(file===lock&&(permanent||++attempts<=2))throw Object.assign(new Error('sharing denial'),{code:'EPERM'});return open(file,...args);});
  await store.pin(pin);assert.equal(attempts,3);const before=await store.read();permanent=true;
  let clock=0;t.mock.method(Date,'now',()=>clock+=6000);await assert.rejects(store.complete(fixture.id,result),/锁超时/);assert.deepEqual(await store.read(),before);await assert.rejects(fs.stat(lock),{code:'ENOENT'});
});

test('a lock owner-record write failure leaves recovery evidence and never enters the settlement transaction',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-lock-owner-')),directory=path.join(root,'store'),store=await createSandboxJournal(directory,{played:0}),lock=path.join(directory,'writer.lock'),open=fs.open.bind(fs);
  t.mock.method(fs,'open',async(file,...args)=>{const handle=await open(file,...args);if(file===lock)handle.writeFile=async()=>{throw new Error('owner-write-failed');};return handle;});
  await assert.rejects(store.pin(pin),/owner-write-failed/);assert.equal((await store.read()).revision,0);assert.deepEqual((await store.read()).fixtures,{});assert.equal((await fs.stat(lock)).size,0);
});

test('default, unsupported and unaccepted fixtures stay legacy; rollback affects new fixtures, not pinned games',()=>{
  assert.equal(selectMatchEngine({fixture}).primary,'legacy');
  const policy={mode:'canary',fixtureAllowlist:[fixture.id],competitions:['friendly']};
  assert.equal(selectMatchEngine({fixture,policy}).primary,'legacy');
  assert.equal(selectMatchEngine({fixture,policy,accepted:true,coverage:{blockers:['weather']}}).primary,'legacy');
  assert.equal(selectMatchEngine({fixture,policy,accepted:true}).primary,'v4');
  assert.equal(selectMatchEngine({fixture,policy:{mode:'shadow'},accepted:true}).shadow,true);
  assert.equal(selectMatchEngine({fixture,policy:{mode:'off'},pinned:selection}).primary,'v4');
});

test('atomic isolated state and receipt prevent duplicate settlement across reopen and concurrent writers',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-rollout-')),directory=path.join(root,'store');
  const store=await createSandboxJournal(directory,{played:0,goals:0});await store.pin(pin);
  await store.checkpoint(fixture.id,{format:'yffm-v4-checkpoint-1',state:{version:engineVersion,input,tick:10}});
  await assert.rejects(store.checkpoint(fixture.id,{format:'yffm-v4-checkpoint-1',state:{version:engineVersion,input,tick:9}}),/检查点/);
  await assert.rejects(store.pin({...pin,sourceDigest:'b'.repeat(64)}),/已锁定/);await store.complete(fixture.id,result);
  await assert.rejects(store.complete(fixture.id,{...result,score:[3,1]}),/冲突/);
  const reopened=await openSandboxJournal(directory),apply=(state,r)=>({...state,played:state.played+1,goals:state.goals+r.score[0]});
  const receipts=await Promise.all([store.settle(fixture.id,apply),reopened.settle(fixture.id,apply)]);
  assert.equal(receipts.filter(r=>r.duplicate).length,1);assert.deepEqual((await reopened.read()).state,{played:1,goals:2});
  const retry=await (await openSandboxJournal(directory)).settle(fixture.id,()=>{throw new Error('must not run');});assert.equal(retry.duplicate,true);assert.equal(retry.sandboxOnly,true);
});

test('failed settlement leaves no changes or receipt, and a live lock cannot be stolen',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-rollout-')),directory=path.join(root,'store');
  const store=await createSandboxJournal(directory,{played:0});await store.pin(pin);await store.complete(fixture.id,result);
  await assert.rejects(store.settle(fixture.id,state=>{state.played++;throw new Error('interrupted');}),/interrupted/);
  assert.equal((await store.read()).state.played,0);assert.deepEqual((await store.read()).receipts,{});
  await fs.writeFile(path.join(directory,'writer.lock'),JSON.stringify({pid:process.pid}));await assert.rejects(store.recoverAbandonedLock(),/仍在运行/);
});

test('killing a writer before commit or after commit recovers without partial or duplicate settlement',async()=>{
  for(const point of ['before','after']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-crash-')),directory=path.join(root,'store');
    const store=await createSandboxJournal(directory,{played:0});await store.pin(pin);await store.complete(fixture.id,result);
    const moduleUrl=new URL('../versus/v4-rollout/sandbox-journal.js',import.meta.url).href;
    const script=`import {openSandboxJournal} from ${JSON.stringify(moduleUrl)};
      const store=await openSandboxJournal(process.env.V4_CRASH_STORE);
      const stop=()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      await store.settle('fixture-1',state=>{state.played++;if(process.env.V4_CRASH_POINT==='before')stop();return state;});stop();`;
    const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_CRASH_STORE:directory,V4_CRASH_POINT:point},stdio:['ignore','ignore','pipe','ipc']});
    const exited=once(child,'exit');let stderr='';child.stderr.on('data',b=>stderr+=b);
    try{
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('crash worker timeout '+stderr)),10000);
        child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',()=>{clearTimeout(timer);reject(new Error('crash worker exited '+stderr));});
      });
      child.kill();await exited;
      const reopened=await openSandboxJournal(directory);
      if(point==='before')await reopened.recoverAbandonedLock();
      const document=await reopened.read();assert.equal(document.state.played,point==='before'?0:1);
      assert.equal(Object.hasOwn(document.receipts,fixture.id),point==='after');
      await reopened.settle(fixture.id,state=>({...state,played:state.played+1}));
      const retry=await reopened.settle(fixture.id,()=>{throw new Error('duplicate apply');});
      assert.equal(retry.duplicate,true);assert.equal((await reopened.read()).state.played,1);
    }finally{if(child.exitCode===null)child.kill();await exited;}
  }
});
