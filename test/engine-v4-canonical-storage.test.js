import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {createSourceSnapshot} from '../versus/v4-adapter/source-snapshot.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {runShadowJob} from '../versus/v4-host/shadow-job.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {createLocalDispatcher,openLocalDispatcher} from '../versus/v4-host/dispatcher.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-canonical-storage-')),bundleDirectory=path.join(root,'engine');
const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])});
const instant=1794934800000,now=()=>instant,createService=options=>new YellowDogsLeagueService(options),field='v4LocalSettlements';
const context={competition:'league',round:999};
async function setup(storage,label){
  const directory=path.join(root,storage+'-'+label);await fs.mkdir(directory);
  await fs.writeFile(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:label==='once'||label==='dispatcher',now,rng:()=>.5};
  const service=createService(options);service.save({skipDailyBackup:true});
  const initial=unwrapTracked(service.state),snapshot=createSourceSnapshot({league:initial,catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG});
  const envelope=compileRealMatch(snapshot,{homeId:initial.teams[0].id,awayId:initial.teams[1].id,fixtureId:'storage-proof',seed:'storage-proof',duration:60});
  const job=path.join(directory,'job');await runShadowJob({directory:job,bundleDirectory,sourceDigest:bundle.sourceDigest,envelope});
  const bridge=await openCanonicalLocalStorageSettlement({root:directory,service,createService,now});
  return {directory,service,options,initial,job,bridge,envelope};
}

for(const storage of ['json','shards']){
  test(`canonical ${storage}: durable dispatcher commits through original storage and survives rollback/reopen`,async()=>{
    const {directory,service,options,initial,bridge,envelope}=await setup(storage,'dispatcher'),queuePath=path.join(directory,'queue');
    const candidate={accepted:true,bundleDirectory,engineVersion:VERSION,sourceDigest:bundle.sourceDigest};
    const queue=await createLocalDispatcher(queuePath,{candidate,settlement:bridge});
    await queue.setPolicy({mode:'canary',fixtureAllowlist:['storage-proof'],competitions:['league']},{expectedRevision:0});
    await queue.enqueue({fixture:{id:'storage-proof',competition:'league'},envelope,context});
    await queue.setPolicy({mode:'off'},{expectedRevision:1});assert.deepEqual(await queue.drain(),{computed:1,settled:1});
    assert.equal(service.state.matches.length,initial.matches.length+1);
    const reopenedService=createService(options),reopenedBridge=await openCanonicalLocalStorageSettlement({root:directory,service:reopenedService,createService,now});
    const reopened=await openLocalDispatcher(queuePath,{settlement:reopenedBridge});assert.deepEqual(await reopened.drain(),{computed:0,settled:0});
    assert.equal((await reopened.read()).jobs[0].receipt.localOnly,true);assert.equal(reopenedService.state.matches.length,initial.matches.length+1);
  });

  test(`canonical ${storage}: business and receipt survive reopen once, and stale memory cannot overwrite disk`,async()=>{
    const {directory,service,options,initial,job,bridge}=await setup(storage,'once');
    const receipts=await Promise.all([bridge.settleJob(job,context),bridge.settleJob(job,context)]);
    assert.equal(receipts.filter(r=>r.duplicate).length,1);assert.equal(service.state.matches.length,initial.matches.length+1);
    assert.equal(service.state.teams[0].table.played,initial.teams[0].table.played+1);
    const reopenedService=createService(options),reopened=await openCanonicalLocalStorageSettlement({root:directory,service:reopenedService,createService,now});
    assert.equal((await reopened.settleJob(job,context)).duplicate,true);
    await assert.rejects(reopened.settleJob(job,{...context,round:998}),/锁定/);
    reopenedService.state.teams[0].name='external-save';reopenedService.save({skipDailyBackup:true});
    await assert.rejects(bridge.settleJob(job,context),/内存状态不同/);
    await bridge.reload();assert.equal((await bridge.settleJob(job,context)).duplicate,true);assert.equal(service.state.teams[0].name,'external-save');
    await assert.rejects(openCanonicalLocalStorageSettlement({root:root,service,createService}),{code:'ENOENT'});
    assert.equal(service.inboxProjection(service.state.teams[0]).inboxMeta.paged,true);
    service.backupDir=path.join(directory,'backups');await assert.rejects(openCanonicalLocalStorageSettlement({root:directory,service,createService}),/禁用自动备份/);
  });

  test(`canonical ${storage}: write failure restores memory; exception after commit is resolved from durable receipt`,async()=>{
    for(const point of ['before','after']){
      const {service,initial,job,bridge}=await setup(storage,'failure-'+point),save=service.save.bind(service);
      service.save=options=>{if(service.state[field]?.receipts?.['storage-proof']){if(point==='before')throw new Error('injected-before-write');save(options);throw new Error('injected-after-write');}return save(options);};
      if(point==='before'){
        await assert.rejects(bridge.settleJob(job,context),/injected-before-write/);assert.equal(service.state.matches.length,initial.matches.length);assert.deepEqual(service.state[field].receipts,{});
        assert.equal(service.state[field].pins['storage-proof'].settledAt,instant);service.save=save;await bridge.settleJob(job,context);
      }else assert.equal((await bridge.settleJob(job,context)).recoveredCommit,true);
      service.save=save;assert.equal((await bridge.settleJob(job,context)).duplicate,true);assert.equal(service.state.matches.length,initial.matches.length+1);
    }
  });

  test(`canonical ${storage}: actual process death before and after storage commit preserves exactly-once settlement`,async()=>{
    for(const point of ['before','after']){
      const {directory,options,initial,job}=await setup(storage,'crash-'+point);
      const serviceUrl=new URL('../versus/league-service.js',import.meta.url).href,bridgeUrl=new URL('../versus/v4-host/canonical-storage-settlement.js',import.meta.url).href;
      const script=`import {YellowDogsLeagueService} from ${JSON.stringify(serviceUrl)};import {openCanonicalLocalStorageSettlement} from ${JSON.stringify(bridgeUrl)};
        const createService=options=>new YellowDogsLeagueService(options),now=()=>${instant};const service=createService({statePath:process.env.V4_STORAGE_FILE,backupDir:null,pagedInbox:false,now,rng:()=>.5});
        const bridge=await openCanonicalLocalStorageSettlement({root:process.env.V4_STORAGE_ROOT,service,createService,now});
        const save=service.save.bind(service),stop=()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
        service.save=options=>{if(service.state.v4LocalSettlements?.receipts?.['storage-proof']){if(process.env.V4_CRASH_POINT==='before')stop();save(options);stop();}return save(options);};
        await bridge.settleJob(process.env.V4_STORAGE_JOB,{competition:'league',round:999});`;
      const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_STORAGE_ROOT:directory,V4_STORAGE_FILE:options.statePath,V4_STORAGE_JOB:job,V4_CRASH_POINT:point},stdio:['ignore','ignore','pipe','ipc']});
      const exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
      try{
        await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('storage crash timeout '+stderr)),20000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(new Error('storage child exited '+stderr));});});
        child.kill();await exited;
        const recoveredService=createService(options),recovered=await openCanonicalLocalStorageSettlement({root:directory,service:recoveredService,createService,now});await recovered.recoverAbandonedLock();
        assert.equal(recoveredService.state.matches.length,initial.matches.length+(point==='after'?1:0));
        await recovered.settleJob(job,context);assert.equal((await recovered.settleJob(job,context)).duplicate,true);assert.equal(recoveredService.state.matches.length,initial.matches.length+1);
        assert.equal(recoveredService.state[field].pins['storage-proof'].settledAt,instant);
      }finally{if(child.exitCode===null)child.kill();await exited;}
    }
  });
}
