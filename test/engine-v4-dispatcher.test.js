import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createLocalDispatcher,openLocalDispatcher} from '../versus/v4-host/dispatcher.js';
import {createCanonicalShadowSettlement,openCanonicalShadowSettlement} from '../versus/v4-host/shadow-settlement.js';
import {createMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';

const bundleRoot=await fs.mkdtemp(path.join(os.tmpdir(),'v4-dispatch-bundle-')),bundleDirectory=path.join(bundleRoot,'engine');
const manifest=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:createMatch(demoInput()).state.version,files:dependencyHashes(['versus/v4/engine.js'])});
const candidate={accepted:true,bundleDirectory,engineVersion:manifest.engineVersion,sourceDigest:manifest.sourceDigest};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function request(id,round=1){
  const match=createMatch({...demoInput({duration:60,format:'full',seed:'dispatch-order'}),fixtureId:id});
  const envelope={schema:'yffm-v4-match-input-1',input:match.state.input,engineVersion:match.state.version,coverage:{blockers:[]}};
  envelope.fingerprint=hash({engineVersion:envelope.engineVersion,input:envelope.input});
  return {fixture:{id,competition:'league'},envelope,context:{competition:'league',round}};
}
function createService(options){return {...options,finalizeFixture(f,round,match){
  f.matchId=`match-${round}`;this.state.matches.push({id:f.matchId,at:this.now(),draw:this.rng(),score:match.report.score});
  for(const team of match.report.teams)for(const p of team.players){
    const key=`${team.id}:${p.id}:ai`,prior=this.state.playerStats[key]??{},next={};
    for(const [name,value] of Object.entries(p.stats))next[name]=(prior[name]??0)+value;
    next.appearances=(prior.appearances??0)+1;next.ratingTotal=(prior.ratingTotal??0)+p.rating;this.state.playerStats[key]=next;
  }
}};}
async function setup({maxPending=32}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-dispatch-')),input=request('initial').envelope.input;
  const initialState={matches:[],teams:input.teams.map(t=>({id:t.id,ownerId:null})),playerStats:{}};
  const settlement=await createCanonicalShadowSettlement(path.join(root,'settlement'),{initialState,createService,now:()=>1000});
  const queue=await createLocalDispatcher(path.join(root,'queue'),{candidate,settlement,maxPending});return {root,queue,settlement};
}

test('a pending publication cannot hide a later producer failure in the same batch',async()=>{
  const {queue,settlement}=await setup();await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
  await queue.enqueue(request('waiting'));await queue.enqueue(request('broken',2));
  settlement.settleJob=async()=>{throw Object.assign(new Error('not yet released'),{code:'V4_PUBLICATION_PENDING',releaseAt:9999999999999});};
  await assert.rejects(queue.drain({onProduced:job=>{if(job.fixture.id==='broken')throw new Error('later production failed');}}),/later production failed/);
  assert.deepEqual((await queue.read()).jobs.map(job=>job.status),['produced','failed']);
});

test('durable dispatch locks selection, bounds queue and workers, rolls back only new games, and commits in queue order',async()=>{
  const {root,queue,settlement}=await setup({maxPending:2});
  assert.equal((await queue.enqueue(request('off'))).status,'legacy');
  await queue.setPolicy({mode:'canary',fixtureAllowlist:['first','second','third'],competitions:['league']},{expectedRevision:0});
  await assert.rejects(queue.setPolicy({mode:'off'},{expectedRevision:0}),/版本冲突/);
  const first=await queue.enqueue(request('first',2));assert.equal(first.selection.primary,'v4');
  const second=request('second',3),duplicates=await Promise.all([queue.enqueue(second),queue.enqueue(second)]);assert.deepEqual(duplicates[0],duplicates[1]);
  await assert.rejects(queue.enqueue(request('third',4)),/容量已满/);
  await assert.rejects(queue.enqueue(request('first',9)),/已锁定/);
  await queue.setPolicy({mode:'off'},{expectedRevision:1});
  const reopened=await openLocalDispatcher(path.join(root,'queue'),{settlement});
  assert.equal((await reopened.enqueue(request('first',2))).selection.primary,'v4');
  assert.equal((await reopened.enqueue(request('third',4))).status,'legacy');
  let peak=0;const poll=setInterval(async()=>{try{peak=Math.max(peak,(await queue.read()).jobs.filter(j=>j.status==='running').length);}catch{}},5);
  let enteredResolve,continueResolve;
  const entered=new Promise(resolve=>enteredResolve=resolve),proceed=new Promise(resolve=>continueResolve=resolve);
  const drain=reopened.drain({onProduced:async job=>{if(job.fixture.id==='first'){enteredResolve();await proceed;}}});
  try{
    await Promise.race([entered,drain.then(()=>{throw new Error('drain completed before hook');})]);
    await assert.rejects(queue.drain(),/锁已占用/);await assert.rejects(queue.recover(),/仍在运行/);continueResolve();
    assert.deepEqual(await drain,{computed:2,settled:2});
  }finally{continueResolve();clearInterval(poll);await drain.catch(()=>{});}
  assert.equal(peak,2);assert.deepEqual((await settlement.read()).state.league.matches.map(m=>m.id),['match-2','match-3']);
  assert.deepEqual(await reopened.drain(),{computed:0,settled:0});
  assert.equal((await reopened.read()).jobs.filter(j=>j.status==='settled').length,2);
  for(const id of ['off','third'])await assert.rejects(fs.access(path.join(root,'queue/jobs',id)),{code:'ENOENT'});
});

test('shadow and unsupported coverage stay legacy, failures block later settlement, and explicit retry preserves pins',async()=>{
  const {root,queue,settlement}=await setup();
  await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
  const unsupported=request('unsupported');unsupported.envelope.coverage.blockers=['weather'];
  assert.equal((await queue.enqueue(unsupported)).selection.shadow,false);
  const first=await queue.enqueue(request('failure',1)),second=await queue.enqueue(request('later',2));
  assert.equal(first.selection.primary,'legacy');assert.equal(first.selection.shadow,true);
  await assert.rejects(queue.drain({onProduced:job=>{if(job.fixture.id==='failure')throw new Error('injected-before-consume');}}),/injected/);
  assert.equal((await settlement.read()).state.league.matches.length,0);
  assert.equal((await queue.read()).jobs.find(j=>j.fixture.id==='later').status,'produced');
  await assert.rejects(queue.drain(),/显式重试/);
  await queue.retry('failure');await queue.setPolicy({mode:'off'},{expectedRevision:1});
  await (await openLocalDispatcher(path.join(root,'queue'),{settlement})).drain();
  const state=await queue.read();assert.deepEqual(state.jobs.find(j=>j.fixture.id==='failure').selection,first.selection);
  assert.deepEqual(state.jobs.find(j=>j.fixture.id==='later').selection,second.selection);
  assert.deepEqual((await settlement.read()).state.league.matches.map(m=>m.id),['match-1','match-2']);
});

test('aborted dispatch stops child workers, and restart replays pinned archives without duplicate effects',async()=>{
  const {root,queue,settlement}=await setup();await queue.setPolicy({mode:'shadow'},{expectedRevision:0});await queue.enqueue(request('pause'));
  const controller=new AbortController(),run=queue.drain({signal:controller.signal});
  for(let i=0;i<200;i++){if((await queue.read()).jobs[0].status==='running')break;await new Promise(resolve=>setTimeout(resolve,5));}
  controller.abort();await assert.rejects(run,/暂停/);
  assert.equal((await settlement.read()).state.league.matches.length,0);
  const reopened=await openLocalDispatcher(path.join(root,'queue'),{settlement});await reopened.recover();await reopened.retry('pause');await reopened.drain();
  assert.equal((await settlement.read()).state.league.matches.length,1);
});

test('actual dispatcher death after business commit resumes queue receipt once and preserves rollback',async()=>{
  const {root,queue,settlement}=await setup();await queue.setPolicy({mode:'canary',fixtureAllowlist:['crash'],competitions:['league']},{expectedRevision:0});await queue.enqueue(request('crash'));
  const dispatcherUrl=new URL('../versus/v4-host/dispatcher.js',import.meta.url).href,settlementUrl=new URL('../versus/v4-host/shadow-settlement.js',import.meta.url).href;
  const script=`import {openLocalDispatcher} from ${JSON.stringify(dispatcherUrl)};import {openCanonicalShadowSettlement} from ${JSON.stringify(settlementUrl)};
    const createService=${createService.toString()};const settlement=await openCanonicalShadowSettlement(process.env.V4_DISPATCH_STORE,{createService,now:()=>1000});
    const queue=await openLocalDispatcher(process.env.V4_DISPATCH_QUEUE,{settlement});
    await queue.drain({onSettled:()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_DISPATCH_STORE:path.join(root,'settlement'),V4_DISPATCH_QUEUE:path.join(root,'queue')},stdio:['ignore','ignore','pipe','ipc']});
  const exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
  try{
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('dispatcher crash timeout '+stderr)),20000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(new Error('dispatcher exited '+stderr));});});
    child.kill();await exited;assert.equal((await settlement.read()).state.league.matches.length,1);
    const recovered=await openLocalDispatcher(path.join(root,'queue'),{settlement});await recovered.recover();
    await recovered.setPolicy({mode:'off'},{expectedRevision:1});assert.equal((await recovered.enqueue(request('after-rollback',2))).status,'legacy');
    await recovered.drain();const job=(await recovered.read()).jobs[0];assert.equal(job.status,'settled');assert.equal(job.receipt.duplicate,true);
    assert.equal(job.selection.primary,'v4');assert.equal((await settlement.read()).state.league.matches.length,1);
  }finally{if(child.exitCode===null)child.kill();await exited;}
});

test('default-off dispatch ignores an unavailable candidate and refuses a corrupted durable input',async()=>{
  const {root,queue,settlement}=await setup();
  const off=await openLocalDispatcher(path.join(root,'queue'),{candidate:{...candidate,bundleDirectory:path.join(root,'absent')},settlement});
  assert.equal((await off.enqueue(request('safe-off'))).status,'legacy');
  await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
  await assert.rejects(off.enqueue(request('missing-bundle')),{code:'ENOENT'});
  const unaccepted=await openLocalDispatcher(path.join(root,'queue'),{candidate:{...candidate,accepted:false},settlement});
  assert.equal((await unaccepted.enqueue(request('unaccepted'))).status,'legacy');
  const file=path.join(root,'queue','dispatch.json'),doc=JSON.parse(await fs.readFile(file,'utf8'));doc.jobs[0].context.round=99;
  await fs.writeFile(file,JSON.stringify(doc));await assert.rejects(openLocalDispatcher(path.join(root,'queue'),{settlement}),/记录损坏/);
});

test('two bounded worker slots publish early chunks for all eight games before any game finishes',async()=>{
  const {root,queue,settlement}=await setup();await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
  for(let index=0;index<8;index++){
    const item=request(`fair-${index}`,index+1);item.envelope.input=structuredClone(item.envelope.input);item.envelope.input.duration=600;
    item.envelope.fingerprint=hash({engineVersion:item.envelope.engineVersion,input:item.envelope.input});await queue.enqueue(item);
  }
  let firstChunkCount=0,finishedAtAllStarted=null,peakSlots=0,peakMatches=0,done=false;
  const run=queue.drain();run.then(()=>{done=true;},()=>{done=true;});
  while(!done&&firstChunkCount<8){
    const document=await queue.read(),running=document.jobs.filter(job=>job.status==='running');
    peakSlots=Math.max(peakSlots,new Set(running.map(job=>job.workerSlot)).size);peakMatches=Math.max(peakMatches,running.length);
    const snapshots=await Promise.all(document.jobs.map(async job=>{try{return JSON.parse(await fs.readFile(path.join(root,'queue/jobs',job.fixture.id,'archive/manifest.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}));
    firstChunkCount=snapshots.filter(m=>m?.segments.length>0).length;
    if(firstChunkCount===8)finishedAtAllStarted=snapshots.filter(m=>m.complete).length;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.deepEqual(await run,{computed:8,settled:8});assert.equal(firstChunkCount,8);assert.equal(finishedAtAllStarted,0);assert.equal(peakSlots,2);assert.equal(peakMatches,8);
  assert.deepEqual((await settlement.read()).state.league.matches.map(m=>m.id),Array.from({length:8},(_,i)=>`match-${i+1}`));
});

test('killing dispatcher during production leaves a recoverable pinned job and no orphan writer',async()=>{
  const {root,queue,settlement}=await setup();await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
  const value=request('during-produce');value.envelope.input=structuredClone(value.envelope.input);value.envelope.input.duration=5400;value.envelope.fingerprint=hash({engineVersion:value.envelope.engineVersion,input:value.envelope.input});await queue.enqueue(value);
  const dispatcherUrl=new URL('../versus/v4-host/dispatcher.js',import.meta.url).href,settlementUrl=new URL('../versus/v4-host/shadow-settlement.js',import.meta.url).href;
  const script=`import {openLocalDispatcher} from ${JSON.stringify(dispatcherUrl)};import {openCanonicalShadowSettlement} from ${JSON.stringify(settlementUrl)};
    const createService=${createService.toString()};const settlement=await openCanonicalShadowSettlement(process.env.V4_DISPATCH_STORE,{createService,now:()=>1000});
    const queue=await openLocalDispatcher(process.env.V4_DISPATCH_QUEUE,{settlement});await queue.drain();`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_DISPATCH_STORE:path.join(root,'settlement'),V4_DISPATCH_QUEUE:path.join(root,'queue')},stdio:['ignore','ignore','pipe']});
  const exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
  const archive=path.join(root,'queue/jobs/during-produce/archive/manifest.json');let producerPid;
  try{
    let committed=false;
    for(let i=0;i<2000;i++){
      if(child.exitCode!==null)throw new Error('producer exited early '+stderr);
      try{if(JSON.parse(await fs.readFile(archive,'utf8')).segments.length>=2){producerPid=JSON.parse(await fs.readFile(path.join(root,'queue/jobs/during-produce/producer.lock'),'utf8')).pid;committed=true;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(committed,true);const before=JSON.parse(await fs.readFile(archive,'utf8'));child.kill();await exited;
    const recovered=await openLocalDispatcher(path.join(root,'queue'),{settlement});let ready=false;
    for(let i=0;i<400;i++){try{await recovered.recover();ready=true;break;}catch(error){if(!/仍在运行/.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,5));}}
    assert.equal(ready,true,'orphan worker must exit when parent IPC disconnects');assert.equal((await settlement.read()).state.league.matches.length,0);
    await recovered.setPolicy({mode:'off'},{expectedRevision:1});await recovered.drain();
    const after=JSON.parse(await fs.readFile(archive,'utf8'));assert.deepEqual(after.segments.slice(0,before.segments.length),before.segments);
    assert.equal((await settlement.read()).state.league.matches.length,1);assert.equal((await recovered.read()).jobs[0].attempts,2);
  }finally{if(child.exitCode===null)child.kill();await exited;if(producerPid){try{process.kill(producerPid,0);process.kill(producerPid);}catch(error){if(error.code!=='ESRCH')throw error;}}}
});
