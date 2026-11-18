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
import {openLocalCupScheduler} from '../versus/v4-host/local-cup-scheduler.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';

test('actual death before/after cup final JSON/shard commit preserves champion rewards and availability exactly once',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-cup-kill-')),template=path.join(root,'template'),bundleDirectory=path.join(root,'engine');
  await fs.mkdir(template);await fs.writeFile(path.join(template,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])}),createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};
  let time=1794934800000;const now=()=>time,templateOptions={statePath:path.join(template,'league.json'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
  let service=createService(templateOptions);service.startCup();service.state.cup.events=[];service.state.cup.knockout={};
  for(const [index,team] of service.state.teams.slice(0,2).entries()){
    team.ownerId='cup-final-owner-'+index;team.ownerName='杯赛决赛测试'+index;
    for(const id of [...team.rosterIds])service.grantS4Card(team,id,{grantOwnership:true,acquisitionSource:'cup-crash-test'});
  }
  service.createKnockoutStage('final',service.state.teams.slice(0,2).map(team=>team.id));service.state.cup.stage='final';service.save({skipDailyBackup:true});service=createService(templateOptions);service.save({skipDailyBackup:true});
  const scheduler=await openLocalCupScheduler({root:template,service,createService,sourceCatalog,candidate:{accepted:true,bundleDirectory,engineVersion:VERSION,sourceDigest:bundle.sourceDigest},enabled:true,now});
  const request={seasonId:service.state.season.id,eventId:'cup-final-leg1',duration:60},produced=await scheduler.advance(request);assert.equal(produced.complete,false);time+=3600000;
  const event=Object.values(service.state.v4LocalCupEvents.events)[0],task=event.tasks[0];await scheduler.settlement.settleJob(path.join(produced.queueDirectory,'jobs',task.fixture.id),task.context);
  const prepared=structuredClone(unwrapTracked(service.state)),team=prepared.teams[0],oldId=team.rosterIds[0],newId=team.rosterIds[1];
  team.playerState[oldId].cupSuspension=2;team.playerState[newId].injuryRounds=3;prepared.v4LocalCupEvents.events[event.key].newUnavailable.push(`${team.id}:${newId}:injury`);
  // This explicit round-edge fixture distinguishes old from newly caused absence.
  prepared.v4LocalCupEvents.events[event.key].newUnavailable=prepared.v4LocalCupEvents.events[event.key].newUnavailable.filter(key=>key!==`${team.id}:${oldId}:suspension`);
  const serviceUrl=new URL('../versus/league-service.js',import.meta.url).href,bridgeUrl=new URL('../versus/v4-host/canonical-storage-settlement.js',import.meta.url).href;
  for(const storage of ['json','shards'])for(const point of ['before','after']){
    const directory=path.join(root,storage+'-'+point);await fs.mkdir(directory);await fs.writeFile(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
    const options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
    let copy=createService(options);copy.adoptState(structuredClone(prepared));copy.save({forceFull:true,skipDailyBackup:true});copy=createService(options);copy.save({skipDailyBackup:true});
    const script=`import {YellowDogsLeagueService} from ${JSON.stringify(serviceUrl)};import {openCanonicalLocalStorageSettlement} from ${JSON.stringify(bridgeUrl)};
      const createService=o=>new YellowDogsLeagueService(o),now=()=>${time};const service=createService({statePath:process.env.V4_CUP_FILE,backupDir:null,pagedInbox:true,now});
      const bridge=await openCanonicalLocalStorageSettlement({root:process.env.V4_CUP_ROOT,service,createService,now});
      const save=service.save.bind(service),stop=()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      service.save=o=>{if(service.state.cup.status==='completed'){if(process.env.V4_CUP_POINT==='before')stop();save(o);stop();}return save(o);};
      await bridge.finishCupEvent(JSON.parse(process.env.V4_CUP_REQUEST));`;
    const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_CUP_ROOT:directory,V4_CUP_FILE:options.statePath,V4_CUP_POINT:point,V4_CUP_REQUEST:JSON.stringify(request)},stdio:['ignore','ignore','pipe','ipc']});
    const exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
    try{
      await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('cup crash timeout '+stderr)),20000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(new Error('cup child exited '+stderr));});});
      child.kill();await exited;
      const recovered=createService(options),bridge=await openCanonicalLocalStorageSettlement({root:directory,service:recovered,createService,now});await bridge.recoverAbandonedLock();
      assert.equal(recovered.state.cup.status,point==='after'?'completed':'active');await bridge.finishCupEvent(request);
      const after=JSON.parse(JSON.stringify(unwrapTracked(recovered.state)));assert.equal(after.teams[0].playerState[oldId].cupSuspension,1);assert.equal(after.teams[0].playerState[newId].injuryRounds,3);
      const rewards=after.ledger.filter(row=>row.type==='cup-pack-reward');assert.equal(rewards.length,2);assert.deepEqual(rewards.map(row=>row.award).sort(),['champion','runnerUp']);
      for(const reward of rewards){const target=after.teams.find(team=>team.ownerId===reward.accountId),notice=after.inbox[target.id].find(message=>message.matchId===after.matches[0].id);assert.ok(notice.payload.rewards.some(item=>item.id===reward.id));}
      assert.equal((await bridge.finishCupEvent(request)).duplicate,true);assert.deepEqual(JSON.parse(JSON.stringify(unwrapTracked(recovered.state))),after);
    }finally{if(child.exitCode===null)child.kill();await exited;}
  }
});
