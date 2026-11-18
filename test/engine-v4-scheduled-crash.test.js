import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {openLocalLeagueScheduler} from '../versus/v4-host/local-league-scheduler.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {scheduledLeagueField} from '../versus/v4-host/scheduled-league.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';

test('actual death around whole-round JSON/shard commit preserves rewards and old/new availability exactly once',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-round-kill-')),template=path.join(root,'template'),bundleDirectory=path.join(root,'engine');
  await fs.mkdir(template);await fs.writeFile(path.join(template,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])});
  const createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};
  let time=1794934800000;const now=()=>time;
  const templateOptions={statePath:path.join(template,'league.json'),backupDir:null,now,rng:()=>.5};
  let service=createService(templateOptions);const team=service.state.teams[0];
  team.ownerId='crash-round-owner';team.ownerName='轮末崩溃测试';
  for(const id of [...team.rosterIds])service.grantS4Card(team,id,{grantOwnership:true,acquisitionSource:'round-crash-test'});
  service.save({skipDailyBackup:true});service=createService(templateOptions);service.save({skipDailyBackup:true});
  const scheduler=await openLocalLeagueScheduler({root:template,service,createService,sourceCatalog,candidate:{accepted:true,bundleDirectory,engineVersion:VERSION,sourceDigest:bundle.sourceDigest},enabled:true,now});
  const request={seasonId:service.state.season.id,roundNumber:1,duration:60},produced=await scheduler.advance(request);assert.equal(produced.complete,false);
  time+=120000;const round=Object.values(service.state[scheduledLeagueField].rounds)[0];
  for(const task of round.tasks)await scheduler.settlement.settleJob(path.join(produced.queueDirectory,'jobs',task.fixture.id),task.context);
  // Explicit round-edge fixtures: one pre-existing suspension must decrement;
  // a newly recorded injury must survive the same round's availability step.
  const prepared=structuredClone(unwrapTracked(service.state)),oldId=team.rosterIds[0],newId=team.rosterIds[1];
  prepared.teams[0].playerState[oldId].suspension=2;prepared.teams[0].playerState[newId].injuryRounds=3;
  prepared[scheduledLeagueField].rounds[round.key].newUnavailable.push(`${team.id}:${newId}:injury`);
  const serviceUrl=new URL('../versus/league-service.js',import.meta.url).href,bridgeUrl=new URL('../versus/v4-host/canonical-storage-settlement.js',import.meta.url).href;
  for(const storage of ['json','shards'])for(const point of ['before','after']){
    const directory=path.join(root,storage+'-'+point);await fs.mkdir(directory);await fs.writeFile(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
    const options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,now,rng:()=>.5};
    const copy=createService(options);copy.adoptState(structuredClone(prepared));copy.save({forceFull:true,skipDailyBackup:true});
    const script=`import {YellowDogsLeagueService} from ${JSON.stringify(serviceUrl)};import {openCanonicalLocalStorageSettlement} from ${JSON.stringify(bridgeUrl)};
      const createService=o=>new YellowDogsLeagueService(o),now=()=>${time};const service=createService({statePath:process.env.V4_ROUND_FILE,backupDir:null,now});
      const bridge=await openCanonicalLocalStorageSettlement({root:process.env.V4_ROUND_ROOT,service,createService,now});
      const save=service.save.bind(service),stop=()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      service.save=o=>{if(service.state.season.currentRound===1){if(process.env.V4_ROUND_POINT==='before')stop();save(o);stop();}return save(o);};
      await bridge.finishRound(JSON.parse(process.env.V4_ROUND_REQUEST));`;
    const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_ROUND_ROOT:directory,V4_ROUND_FILE:options.statePath,V4_ROUND_POINT:point,V4_ROUND_REQUEST:JSON.stringify(request)},stdio:['ignore','ignore','pipe','ipc']});
    const exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
    try{
      await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('round crash timeout '+stderr)),20000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(new Error('round child exited '+stderr));});});
      child.kill();await exited;
      const recoveredService=createService(options),bridge=await openCanonicalLocalStorageSettlement({root:directory,service:recoveredService,createService,now});await bridge.recoverAbandonedLock();
      assert.equal(recoveredService.state.season.currentRound,point==='after'?1:0);
      await bridge.finishRound(request);const after=structuredClone(unwrapTracked(recoveredService.state));
      assert.equal(after.teams[0].playerState[oldId].suspension,1);assert.equal(after.teams[0].playerState[newId].injuryRounds,3);
      assert.equal(after.ledger.filter(row=>row.type==='league-match-reward'&&row.accountId===team.ownerId&&row.round===1).length,1);
      assert.equal((await bridge.finishRound(request)).duplicate,true);assert.deepEqual(unwrapTracked(recoveredService.state),after);
    }finally{if(child.exitCode===null)child.kill();await exited;}
  }
});
