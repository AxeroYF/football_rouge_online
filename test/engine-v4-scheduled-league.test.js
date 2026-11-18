import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {beginScheduledLeagueRound,finishScheduledLeagueRound,scheduledFixtureBinding,scheduledLeagueField} from '../versus/v4-host/scheduled-league.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {runShadowJob} from '../versus/v4-host/shadow-job.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';
import {openLocalLeagueScheduler} from '../versus/v4-host/local-league-scheduler.js';
import {createLocalDispatcher,openLocalDispatcher} from '../versus/v4-host/dispatcher.js';

const at=1794934800000,createService=options=>new YellowDogsLeagueService(options);
const initial=()=>structuredClone(createService({statePath:null,backupDir:null,now:()=>at,rng:()=>.5}).state);
const options=league=>({league,seasonId:league.season.id,roundNumber:1,at,createService,catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG,duration:60});

test('scheduled league preparation pins the current whole round without modifying its source; unsafe overlaps and changed fixtures fail closed',()=>{
  const league=initial(),before=structuredClone(league),started=beginScheduledLeagueRound(options(league));
  assert.deepEqual(league,before);assert.equal(started.league.rounds[0].status,'running');assert.equal(started.round.tasks.length,league.rounds[0].fixtures.length);
  const duplicate=beginScheduledLeagueRound(options(started.league));assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.round,started.round);
  assert.throws(()=>beginScheduledLeagueRound({...options(started.league),releaseRate:64}),/锁定/);
  assert.throws(()=>beginScheduledLeagueRound({...options(started.league),roundNumber:2}),/未完成/);
  for(const slot of ['liveRound','liveCupRound','liveSeasonFinalRound','liveWorldCupRound']){
    const overlap=structuredClone(league);overlap[slot]={matches:[]};assert.throws(()=>beginScheduledLeagueRound(options(overlap)),/重叠/);
  }
  const friendly=structuredClone(league);friendly.liveFriendlies=[{completed:false}];assert.throws(()=>beginScheduledLeagueRound(options(friendly)),/重叠/);
  const repeat=structuredClone(league);repeat.rounds[0].fixtures[1].homeId=repeat.rounds[0].fixtures[0].homeId;assert.throws(()=>beginScheduledLeagueRound(options(repeat)),/重复/);
  const task=started.round.tasks[0],pinned={fixtureId:task.fixture.id,inputFingerprint:task.envelope.fingerprint,engineVersion:task.envelope.engineVersion};
  assert.equal(scheduledFixtureBinding(started.league,task.context,pinned).fixture,started.league.rounds[0].fixtures[0]);
  const changed=structuredClone(started.league);changed.rounds[0].fixtures.reverse();assert.throws(()=>scheduledFixtureBinding(changed,task.context,pinned),/赛程/);
  assert.throws(()=>beginScheduledLeagueRound(options(changed)),/赛程/);
  const advanced=structuredClone(started.league);advanced.season.currentRound=1;assert.throws(()=>scheduledFixtureBinding(advanced,task.context,pinned),/运行状态/);
  const pinnedStart=beginScheduledLeagueRound({...options(league),enginePin:{engineVersion:VERSION,sourceDigest:'a'.repeat(64)}});
  assert.throws(()=>beginScheduledLeagueRound({...options(pinnedStart.league),enginePin:{engineVersion:VERSION,sourceDigest:'b'.repeat(64)}}),/内核配置/);
  assert.throws(()=>scheduledFixtureBinding(pinnedStart.league,task.context,{...pinned,sourceDigest:'b'.repeat(64)}),/内核锁定/);
  assert.throws(()=>scheduledFixtureBinding(started.league,task.context,{...pinned,inputFingerprint:'wrong'}),/输入/);
  assert.throws(()=>finishScheduledLeagueRound({...options(started.league)}),/尚未全部/);
  assert.equal(started.league[scheduledLeagueField].active,started.round.key);
});

test('local round scheduler is default-off, resumes a partial enqueue, waits for public completion and never recomputes finished jobs',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-round-scheduler-')),bundleDirectory=path.join(root,'engine');
  await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])});
  const candidate={accepted:true,bundleDirectory,engineVersion:VERSION,sourceDigest:bundle.sourceDigest},sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};
  let time=at;const now=()=>time,serviceOptions={statePath:path.join(root,'league.json'),backupDir:null,now,rng:()=>.5};
  let service=createService(serviceOptions);service.save({skipDailyBackup:true});
  const request={seasonId:service.state.season.id,roundNumber:1,duration:60};
  const open=enabled=>openLocalLeagueScheduler({root,service,createService,sourceCatalog,candidate,enabled,now});
  assert.deepEqual(await (await open(false)).advance(request),{enabled:false,productionEnabled:false});
  assert.equal(service.state[scheduledLeagueField],undefined);
  let scheduler=await open(true);const round=await scheduler.settlement.beginRound({...request,enginePin:{engineVersion:VERSION,sourceDigest:bundle.sourceDigest}}),queueDirectory=path.join(root,'league-queue-'+round.key);
  const partial=await createLocalDispatcher(queueDirectory,{settlement:scheduler.settlement,candidate,maxPending:64});
  await partial.setPolicy({mode:'shadow'},{expectedRevision:0});await partial.enqueue(round.tasks[0]);
  const produced=await scheduler.advance(request);assert.equal(produced.complete,false);assert.equal(produced.computed,round.tasks.length);assert.ok(produced.pendingReleaseAt>time);
  assert.equal(service.state.matches.length,0);assert.equal(service.state.season.currentRound,0);
  const queue=await openLocalDispatcher(queueDirectory,{settlement:scheduler.settlement,candidate});
  assert.ok((await queue.read()).jobs.every(job=>job.status==='produced'&&job.attempts===1));
  // Host rollback does not reinterpret tasks already pinned in this round.
  await queue.setPolicy({mode:'off'},{expectedRevision:1});time+=120000;
  service=createService(serviceOptions);scheduler=await open(true);await scheduler.recover();
  const finished=await scheduler.advance(request);assert.equal(finished.complete,true);assert.equal(finished.computed,0);assert.equal(finished.settled,round.tasks.length);
  assert.equal(service.state.matches.length,round.tasks.length);assert.equal(service.state.season.currentRound,1);
  assert.equal((await scheduler.advance(request)).duplicate,true);
  assert.ok((await queue.read()).jobs.every(job=>job.status==='settled'&&job.attempts===1));
});

for(const storage of ['json','shards'])test(`scheduled ${storage}: real fixture binding, publication gate, original round rewards and cross-round preparation commit exactly once`,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-round-'+storage+'-')),bundleDirectory=path.join(root,'engine');
  await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])});
  let time=at;const now=()=>time,serviceOptions={statePath:path.join(root,storage==='json'?'league.json':'league-shards'),backupDir:null,now,rng:()=>.5};
  let service=createService(serviceOptions);
  service.state.teams[0].ownerId='scheduled-owner';service.state.teams[0].ownerName='隔离轮次测试';
  for(const playerId of [...service.state.teams[0].rosterIds])service.grantS4Card(service.state.teams[0],playerId,{grantOwnership:true,acquisitionSource:'round-test'});
  const unavailableId=service.state.teams[0].rosterIds.at(-1);
  service.state.teams[0].playerState[unavailableId]={fitness:100,suspension:2,injuryRounds:2};
  service.save({skipDailyBackup:true});service=createService(serviceOptions);service.save({skipDailyBackup:true});
  const sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};
  let bridge=await openCanonicalLocalStorageSettlement({root,service,createService,sourceCatalog,now});
  const request={seasonId:service.state.season.id,roundNumber:1,duration:60},round=await bridge.beginRound(request);
  assert.equal((await bridge.beginRound(request)).duplicate,true);
  const beforeMatchCount=service.state.matches.length,jobs=[];
  for(const task of round.tasks){
    const directory=path.join(root,task.fixture.id);await runShadowJob({directory,bundleDirectory,sourceDigest:bundle.sourceDigest,envelope:task.envelope});jobs.push(directory);
  }
  await assert.rejects(bridge.settleJob(jobs[0],round.tasks[0].context),/公开发布时间/);
  assert.equal(service.state.matches.length,beforeMatchCount);assert.equal(service.state.v4LocalSettlements,undefined);
  time+=120000;
  for(const [i,task] of round.tasks.entries()){
    const receipt=await bridge.settleJob(jobs[i],task.context);
    assert.equal(service.state.rounds[0].fixtures[i].matchId,receipt.matchId);
    assert.equal((await bridge.settleJob(jobs[i],task.context)).duplicate,true);
    if(i===0)await assert.rejects(bridge.finishRound(request),/尚未全部/);
  }
  const save=service.save.bind(service);
  service.save=options=>{if(service.state[scheduledLeagueField].rounds[round.key].status==='complete')throw new Error('before-round-write');return save(options);};
  await assert.rejects(bridge.finishRound(request),/before-round-write/);
  assert.equal(service.state.season.currentRound,0);assert.equal(service.state.rounds[0].status,'running');
  service.save=options=>{const value=save(options);if(service.state[scheduledLeagueField].rounds[round.key].status==='complete')throw new Error('after-round-write');return value;};
  assert.equal((await bridge.finishRound(request)).recoveredCommit,true);service.save=save;
  assert.equal(service.state.season.currentRound,1);assert.equal(service.state.rounds[0].status,'complete');
  assert.equal(service.state.teams[0].playerState[unavailableId].suspension,1);assert.equal(service.state.teams[0].playerState[unavailableId].injuryRounds,1);
  assert.equal(service.state.ledger.filter(row=>row.type==='league-match-reward'&&row.accountId==='scheduled-owner'&&row.round===1).length,1);
  const committed=structuredClone(unwrapTracked(service.state.matches)),ledger=structuredClone(unwrapTracked(service.state.ledger));
  service=createService(serviceOptions);bridge=await openCanonicalLocalStorageSettlement({root,service,createService,sourceCatalog,now});
  assert.equal((await bridge.finishRound(request)).duplicate,true);assert.equal((await bridge.beginRound(request)).duplicate,true);
  assert.equal((await bridge.settleJob(jobs[0],round.tasks[0].context)).duplicate,true);
  assert.deepEqual(service.state.matches,committed);assert.deepEqual(service.state.ledger,ledger);
  const next=await bridge.beginRound({...request,roundNumber:2});
  assert.notEqual(next.sourceFingerprint,round.sourceFingerprint);assert.notEqual(next.tasks[0].envelope.fingerprint,round.tasks[0].envelope.fingerprint);
  assert.equal(next.tasks[0].context.round,2);assert.equal(service.state.season.currentRound,1);
});
