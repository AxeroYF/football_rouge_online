import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {initializeShadowDirectory} from '../versus/v4-host/initialize-job.js';
import {openSandboxJournal} from '../versus/v4-rollout/sandbox-journal.js';

const input={teams:[{id:'a',name:'A'},{id:'b',name:'B'}]},engineVersion='initialization-test';
const pin={fixtureId:'initialize',engineVersion,sourceDigest:'a'.repeat(64),inputFingerprint:createHash('sha256').update(JSON.stringify({engineVersion,input})).digest('hex'),input,selection:{fixtureId:'initialize',primary:'legacy',shadow:true}};
const job={format:'yffm-v4-shadow-job-1',scope:'shadow-only',fixtureId:pin.fixtureId,engineVersion,sourceDigest:pin.sourceDigest,inputFingerprint:pin.inputFingerprint,stepsPerChunk:50};

test('transient directory publication denial retries the prepared job, but a conflicting owner is never replaced',async t=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'v4-init-denied-')),directory=path.join(parent,'job'),rename=fs.rename.bind(fs);let attempts=0;
  t.mock.method(fs,'rename',async(from,to)=>{if(to===directory&&attempts++<2)throw Object.assign(new Error('scanner holds directory'),{code:'EPERM'});return rename(from,to);});
  await initializeShadowDirectory(directory,{job,pin});assert.equal(attempts,3);assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'job.json'),'utf8')),job);
  const conflict=path.join(parent,'conflict');
  await assert.rejects(initializeShadowDirectory(conflict,{job,pin,onPrepared:async()=>{await fs.mkdir(conflict);await fs.writeFile(path.join(conflict,'owner'),'existing owner');}}),{code:'EEXIST'});
  assert.equal(await fs.readFile(path.join(conflict,'owner'),'utf8'),'existing owner');
});

test('initialization is invisible until all records are ready; exceptions retain evidence without publishing partial jobs',async()=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'v4-initialize-')),directory=path.join(parent,'job');let staging;
  await assert.rejects(initializeShadowDirectory(directory,{job,pin,onPrepared:async value=>{staging=value;await assert.rejects(fs.stat(directory),{code:'ENOENT'});throw new Error('interrupted initialization');}}),/interrupted/);
  await assert.rejects(fs.stat(directory),{code:'ENOENT'});assert.ok((await fs.stat(path.join(staging,'job.json'))).isFile());
  await initializeShadowDirectory(directory,{job,pin});assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'job.json'),'utf8')),job);
  assert.equal((await (await openSandboxJournal(path.join(directory,'journal'))).read()).fixtures.initialize.inputFingerprint,pin.inputFingerprint);
  await assert.rejects(initializeShadowDirectory(directory,{job,pin}),/已存在/);
});

test('only one initializer publishes a shared name; killing a prepared initializer leaves that name available',async()=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'v4-init-crash-')),directory=path.join(parent,'job');
  const moduleUrl=new URL('../versus/v4-host/initialize-job.js',import.meta.url).href;
  const script=`import {initializeShadowDirectory} from ${JSON.stringify(moduleUrl)};const p=JSON.parse(process.env.V4_INIT_OPTIONS);await initializeShadowDirectory(p.directory,{...p,onPrepared:()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_INIT_OPTIONS:JSON.stringify({directory,job,pin})},stdio:['ignore','ignore','pipe','ipc']});
  const exited=once(child,'exit');let stderr='';child.stderr.on('data',b=>stderr+=b);
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('initializer timeout '+stderr)),10000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('initializer exited '+stderr));});});
    child.kill();await exited;await assert.rejects(fs.stat(directory),{code:'ENOENT'});
    const outcomes=await Promise.allSettled([initializeShadowDirectory(directory,{job,pin}),initializeShadowDirectory(directory,{job,pin})]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const state=await (await openSandboxJournal(path.join(directory,'journal'))).read();assert.equal(Object.keys(state.fixtures).length,1);assert.deepEqual(state.receipts,{});
  }finally{if(child.exitCode===null)child.kill();await exited;}
});
