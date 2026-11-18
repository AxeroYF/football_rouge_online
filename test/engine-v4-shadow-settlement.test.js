import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createCanonicalShadowSettlement,openCanonicalShadowSettlement} from '../versus/v4-host/shadow-settlement.js';
import {runShadowJob} from '../versus/v4-host/shadow-job.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {createMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('reusable shadow settlement pins context, commits once under concurrent retry and refuses unsafe consumers or wrong-team report data',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-shadow-settlement-'));
  const m=createMatch({...demoInput({duration:60,format:'full',seed:'settlement-proof'}),fixtureId:'settlement-proof'}),input=m.state.input,engineVersion=m.state.version;
  const envelope={schema:'yffm-v4-match-input-1',input,engineVersion,fingerprint:hash({engineVersion,input}),coverage:{blockers:[]}};
  const bundleDirectory=path.join(root,'engine'),bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion,files:dependencyHashes(['versus/v4/engine.js'])});
  const directory=path.join(root,'job');await runShadowJob({directory,bundleDirectory,sourceDigest:bundle.sourceDigest,envelope});
  let calls=0;
  const createService=options=>({...options,statePath:null,finalizeFixture(f,round,match){calls++;this.state.played++;f.matchId=`record-${round}`;this.state.matches.push({id:f.matchId,score:match.report.score,lockedAt:this.now(),businessDraw:this.rng()});for(const team of match.report.teams)for(const p of team.players)this.state.playerStats[`${team.id}:${p.id}:ai`]={...p.stats,appearances:1,ratingTotal:p.rating};}});
  const initial={played:0,matches:[],teams:input.teams.map(t=>({id:t.id,ownerId:null})),playerStats:{}},context={competition:'league',round:1},storeDirectory=path.join(root,'settlement');
  const store=await createCanonicalShadowSettlement(storeDirectory,{initialState:initial,createService,now:()=>1000});
  const receipts=await Promise.all([store.settleJob(directory,context),store.settleJob(directory,context)]);assert.equal(receipts.filter(r=>r.duplicate).length,1);assert.equal(calls,1);assert.equal(initial.played,0);
  const reopened=await openCanonicalShadowSettlement(storeDirectory,{createService});assert.equal((await reopened.settleJob(directory,context)).duplicate,true);assert.equal(calls,1);
  await assert.rejects(reopened.settleJob(directory,{...context,round:2}),/不同结算上下文/);assert.equal((await reopened.read()).state.league.played,1);
  assert.equal((await reopened.read()).state.fixtures['settlement-proof'].matchId,'record-1');
  await assert.rejects(openCanonicalShadowSettlement(path.join(directory,'journal'),{createService}),/隔离结算状态/);
  const unsafe=await createCanonicalShadowSettlement(path.join(root,'unsafe'),{initialState:initial,createService:()=>({statePath:'data/league.json'})});
  await assert.rejects(unsafe.settleJob(directory,context),/完全使用内存状态/);assert.deepEqual((await unsafe.read()).receipts,{});
  const persistence=await createCanonicalShadowSettlement(path.join(root,'persistence'),{initialState:initial,createService:options=>({...options,finalizeFixture(){this.state.played++;this.save();}})});
  await assert.rejects(persistence.settleJob(directory,context),/事务外持久化/);assert.equal((await persistence.read()).state.league.played,0);
  const incompatible=await createCanonicalShadowSettlement(path.join(root,'incompatible'),{initialState:initial,createService:options=>{const service=createService(options),original=service.finalizeFixture;service.finalizeFixture=function(...args){original.apply(this,args);Object.values(this.state.playerStats)[0].penaltiesWon++;};return service;}});
  await assert.rejects(incompatible.settleJob(directory,context),/消费与V4个人战报不一致/);assert.equal((await incompatible.read()).state.league.played,0);assert.deepEqual((await incompatible.read()).receipts,{});

  for(const point of ['before','after']){
    const crashDirectory=path.join(root,`crash-${point}`);await createCanonicalShadowSettlement(crashDirectory,{initialState:initial,createService});
    const moduleUrl=new URL('../versus/v4-host/shadow-settlement.js',import.meta.url).href;
    const script=`import {openCanonicalShadowSettlement} from ${JSON.stringify(moduleUrl)};let calls=0;const make=${createService.toString()};
      const stop=()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      const createService=options=>{const service=make(options),original=service.finalizeFixture;service.finalizeFixture=function(...args){original.apply(this,args);if(process.env.V4_CRASH_POINT==='before')stop();};return service;};
      const store=await openCanonicalShadowSettlement(process.env.V4_CRASH_STORE,{createService,now:()=>1000});await store.settleJob(process.env.V4_CRASH_JOB,{competition:'league',round:1});stop();`;
    const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_CRASH_POINT:point,V4_CRASH_STORE:crashDirectory,V4_CRASH_JOB:directory},stdio:['ignore','ignore','pipe','ipc']});
    const exited=once(child,'exit');let stderr='';child.stderr.on('data',b=>stderr+=b);
    try{
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('settlement crash timeout '+stderr)),10000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('settlement child exited '+stderr));});});
      child.kill();await exited;const recovered=await openCanonicalShadowSettlement(crashDirectory,{createService});
      if(point==='before')await recovered.recoverAbandonedLock();assert.equal((await recovered.read()).state.league.played,point==='before'?0:1);
      await recovered.settleJob(directory,context);assert.deepEqual((await recovered.read()).state,(await reopened.read()).state);
      assert.equal((await recovered.settleJob(directory,context)).duplicate,true);
    }finally{if(child.exitCode===null)child.kill();await exited;}
  }

  const file=path.join(directory,'journal/journal.json'),original=await fs.readFile(file,'utf8');
  const corrupt=JSON.parse(original),value=corrupt.fixtures['settlement-proof'].result;
  value.value.report.teams[0].players[0].stats.saves=-1;value.digest=hash(value.value);await fs.writeFile(file,JSON.stringify(corrupt));
  await assert.rejects(reopened.settleJob(directory,context),/统计无效/);
  const ambiguous=JSON.parse(original),result=ambiguous.fixtures['settlement-proof'].result;
  result.value.report.teams[0].players[0].stats.penaltiesWon=1;result.value.report.importantEvents.push({type:'penaltyAwarded',opponentId:input.teams[0].players[0].id,teamIndex:0});result.digest=hash(result.value);
  await fs.writeFile(file,JSON.stringify(ambiguous));await assert.rejects(reopened.settleJob(directory,context),/所属球队不一致/);
  assert.equal((await reopened.read()).state.league.played,1);
});
