import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';
import {openLocalCompetitionController} from '../versus/v4-host/local-competition-controller.js';

test('disabled local host does not open a root or candidate',async()=>{
  const host=await openLocalCompetitionController({root:'missing',candidates:null});assert.deepEqual(await host.advance(null),{handled:false,engine:'legacy',reason:'disabled'});
});

for(const competition of ['league','cup'])test(`${competition}: host rollback blocks new events while committed V4 work finishes its original pin and publication clock`,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-local-control-')),bundleDirectory=path.join(root,'engine');await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])}),candidate={accepted:true,bundleDirectory,engineVersion:VERSION,sourceDigest:bundle.sourceDigest};
  const createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};let time=1794934800000;const now=()=>time,options={statePath:path.join(root,'league.json'),backupDir:null,now,rng:()=>.5};
  let service=createService(options);if(competition==='cup')service.startCup();service.save({skipDailyBackup:true});
  const event={competition,seasonId:service.state.season.id,...(competition==='league'?{roundNumber:1}:{eventId:service.state.cup.events[0].id})},open=()=>openLocalCompetitionController({enabled:true,root,service,createService,sourceCatalog,candidates:[candidate],now});let host=await open();
  const before=JSON.stringify(service.state);assert.equal((await host.advance(event)).handled,false);assert.equal(JSON.stringify(service.state),before);assert.equal((await host.read()).policy.mode,'off');
  const selected={mode:'v4',engineVersion:VERSION,sourceDigest:bundle.sourceDigest,events:[event]};await host.setPolicy(selected,{expectedRevision:0});await assert.rejects(host.setPolicy({mode:'off'},{expectedRevision:0}),/版本冲突/);
  let changed=false;const produced=await host.advance({...event,duration:60,releaseRate:1},{onStarted:async()=>{await host.setPolicy({mode:'off'},{expectedRevision:1});changed=true;}});
  assert.equal(changed,true);assert.equal(produced.handled,true);assert.equal(produced.complete,false);assert.equal(produced.computed,8);assert.equal(service.state.matches.length,0);
  const other=competition==='league'?{...event,roundNumber:2}:{...event,eventId:'cup-roundOf16-leg2'};await assert.rejects(host.advance(other),/先完成/);
  service=createService(options);host=await open();await host.recover();time+=3600000;
  const completed=await host.advance({...event,duration:5400,releaseRate:64});assert.equal(completed.complete,true);assert.equal(completed.computed,0);assert.equal(completed.settled,8);assert.equal(service.state.matches.length,8);
  assert.equal((await host.advance(event)).duplicate,true);assert.equal((await host.advance(other)).handled,false);assert.equal((await host.read()).policy.mode,'off');
});
