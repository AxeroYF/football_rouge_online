import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {runShadowJob} from '../versus/v4-host/shadow-job.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';

const createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};
for(const storage of ['json','shards'])test(`${storage}: all seven cup events bind real fixtures, advance the bracket and preserve reopen receipts`,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-cup-life-')),bundleDirectory=path.join(root,'engine');
  await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])}),enginePin={engineVersion:VERSION,sourceDigest:bundle.sourceDigest};
  let time=1794934800000;const now=()=>time,options={statePath:path.join(root,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
  let service=createService(options);if(service.state.cup.status==='waiting')service.startCup();
  service.save({skipDailyBackup:true});service=createService(options);service.save({skipDailyBackup:true});
  let bridge=await openCanonicalLocalStorageSettlement({root,service,createService,sourceCatalog,now}),matches=0,events=0;const history=[];
  while(service.state.cup.status==='active'){
    assert.ok(events<7);const next=service.state.cup.events.find(event=>event.status==='pending'),request={seasonId:service.state.season.id,eventId:next.id,duration:60,enginePin};
    const event=await bridge.beginCupEvent(request);assert.equal((await bridge.beginCupEvent(request)).duplicate,true);
    await assert.rejects(bridge.beginRound({seasonId:request.seasonId,roundNumber:1,duration:60}),/重叠/);
    const jobs=[];
    for(const task of event.tasks){const directory=path.join(root,task.fixture.id);await runShadowJob({directory,bundleDirectory,sourceDigest:bundle.sourceDigest,envelope:task.envelope});jobs.push(directory);}
    await assert.rejects(bridge.settleJob(jobs[0],event.tasks[0].context),/公开发布时间/);
    time+=3600000;
    for(const [index,task] of event.tasks.entries()){
      await bridge.settleJob(jobs[index],task.context);assert.equal((await bridge.settleJob(jobs[index],task.context)).duplicate,true);matches++;
    }
    assert.equal(service.state.matches.length,matches);
    const live=service.state.cup.events.find(entry=>entry.id===event.eventId);assert.equal(live.status,'running');
    await bridge.finishCupEvent(request);const completed=JSON.parse(JSON.stringify(unwrapTracked(service.state)));
    assert.equal((await bridge.finishCupEvent(request)).duplicate,true);assert.deepEqual(JSON.parse(JSON.stringify(unwrapTracked(service.state))),completed);
    assert.equal(service.state.cup.events.find(entry=>entry.id===event.eventId).transitionedAt,time);
    history.push({request,event,jobs});events++;
    service=createService(options);bridge=await openCanonicalLocalStorageSettlement({root,service,createService,sourceCatalog,now});
    assert.equal((await bridge.finishCupEvent(request)).duplicate,true);
  }
  assert.equal(events,7);assert.equal(matches,29);assert.equal(service.state.cup.status,'completed');assert.ok(service.state.cup.championId);assert.equal(service.state.cup.nextRoundAt,null);
  const final=service.state.cup.knockout.final[0];assert.equal(final.winnerId,service.state.cup.championId);
  assert.ok(final.legs[0].winnerId);assert.ok(Object.values(service.state.cup.playerStats).some(stat=>stat.appearances>1));
  const before=JSON.parse(JSON.stringify(unwrapTracked(service.state)));
  for(const {request,event,jobs} of history){assert.equal((await bridge.finishCupEvent(request)).duplicate,true);for(const [index,task] of event.tasks.entries())assert.equal((await bridge.settleJob(jobs[index],task.context)).duplicate,true);}
  assert.deepEqual(JSON.parse(JSON.stringify(unwrapTracked(service.state))),before);
});
