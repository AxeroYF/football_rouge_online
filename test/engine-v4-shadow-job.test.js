import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runShadowJob,recoverShadowProducerLock} from '../versus/v4-host/shadow-job.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {openSandboxJournal} from '../versus/v4-rollout/sandbox-journal.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {createMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';

test('shadow job binds producer, archive and player report; interrupted replay is exact and isolated',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-shadow-job-'));
  const m=createMatch({...demoInput({duration:120,format:'full',seed:'shadow-job'}),fixtureId:'job-proof'}),input=m.state.input,engineVersion=m.state.version;
  const fingerprint=createHash('sha256').update(JSON.stringify({engineVersion,input})).digest('hex');
  const envelope={schema:'yffm-v4-match-input-1',engineVersion,input,fingerprint,coverage:{blockers:[]}};
  const bundleDirectory=path.join(root,'engine'),bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion,files:dependencyHashes(['versus/v4/engine.js'])});
  const options={bundleDirectory,sourceDigest:bundle.sourceDigest,envelope};
  const baseline=await runShadowJob({...options,directory:path.join(root,'baseline')});
  assert.deepEqual((await runShadowJob({...options,directory:path.join(root,'unpublished-retry'),resume:true})).result,baseline.result);
  const directory=path.join(root,'interrupted');
  await assert.rejects(runShadowJob({...options,directory,onCommitted:async()=>{
    await assert.rejects(runShadowJob({...options,directory,resume:true}),/已有生产者/);
    await assert.rejects(recoverShadowProducerLock(directory),/仍在运行/);
    throw new Error('test interruption');
  }}),/test interruption/);
  const store=await openSandboxJournal(path.join(directory,'journal'));assert.equal((await store.read()).fixtures['job-proof'].result,null);
  await assert.rejects(runShadowJob({...options,directory,envelope:{...envelope,fingerprint:'b'.repeat(64)},resume:true}),/指纹/);
  const recovered=await runShadowJob({...options,directory,resume:true});
  assert.deepEqual(recovered.result,baseline.result);assert.deepEqual(recovered.highWater,baseline.highWater);assert.ok(recovered.highWater.frames<100);
  assert.equal(await fs.readFile(path.join(directory,'archive/manifest.json'),'utf8'),await fs.readFile(path.join(root,'baseline/archive/manifest.json'),'utf8'));
  const repeated=await runShadowJob({...options,directory,resume:true});assert.deepEqual(repeated.result,recovered.result);
  assert.equal(repeated.result.settlementAllowed,false);assert.equal(repeated.result.report.settlementAllowed,false);
  assert.deepEqual((await store.read()).receipts,{});assert.deepEqual((await store.read()).state,{scope:'shadow-only'});
  await fs.appendFile(path.join(directory,'archive/000000-public.json.gz'),'corrupt');
  await assert.rejects(runShadowJob({...options,directory,resume:true}),/已提交归档内容/);

  const killedDirectory=path.join(root,'killed'),moduleUrl=new URL('../versus/v4-host/shadow-job.js',import.meta.url).href;
  const script=`import {runShadowJob} from ${JSON.stringify(moduleUrl)};await runShadowJob({...JSON.parse(process.env.V4_JOB_OPTIONS),onCommitted:()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_JOB_OPTIONS:JSON.stringify({...options,directory:killedDirectory})},stdio:['ignore','ignore','pipe','ipc']});
  const exited=once(child,'exit');let stderr='';child.stderr.on('data',b=>stderr+=b);
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('job child timeout '+stderr)),10000);
      child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('job child exited '+stderr));});});
    child.kill();await exited;await recoverShadowProducerLock(killedDirectory);
    const afterKill=await runShadowJob({...options,directory:killedDirectory,resume:true});assert.deepEqual(afterKill.result,baseline.result);
    assert.equal(await fs.readFile(path.join(killedDirectory,'archive/manifest.json'),'utf8'),await fs.readFile(path.join(root,'baseline/archive/manifest.json'),'utf8'));
  }finally{if(child.exitCode===null)child.kill();await exited;}
});
