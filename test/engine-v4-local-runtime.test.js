import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';
import {openLocalCompetitionRuntime} from '../versus/v4-host/local-competition-runtime.js';
import {retentionFixture} from './v4-replay-retention-fixture.js';

test('disabled composed runtime needs no files, account store or candidate',async()=>{
  const runtime=await openLocalCompetitionRuntime();assert.equal(await runtime.handle(null,null),false);assert.equal((await runtime.advance(null)).engine,'legacy');await runtime.close();
});

test('local runtime joins policy, pre-production preview, canonical settlement, historical viewing and retention through one lease owner',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-runtime-')),bundleDirectory=path.join(root,'engine');await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])}),candidate={accepted:true,bundleDirectory,engineVersion:VERSION,sourceDigest:bundle.sourceDigest};
  const createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};let time=1794934800000;const now=()=>time,options={statePath:path.join(root,'league.json'),backupDir:null,now,rng:()=>.5};
  let service=createService(options);service.save({skipDailyBackup:true});const rooms={account(id,token){if(token!=='token-'+id)throw Object.assign(new Error('unauthorized'),{statusCode:401});return {id};}};
  const open=()=>openLocalCompetitionRuntime({enabled:true,root,rooms,service,createService,sourceCatalog,candidates:[candidate],now,publicWatch:true,readerLimit:2,retentionPolicy:{maxBytes:0,minAgeMs:0,maxAgeMs:1,keepLatest:0}});let runtime=await open();
  const server=http.createServer(async(req,res)=>{if(!await runtime.handle(req,res)){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer token-viewer','X-Player-Id':'viewer'};
  const event={competition:'league',seasonId:service.state.season.id,roundNumber:1};let firstId;
  try{
    assert.equal((await runtime.advance(event)).handled,false);assert.equal(runtime.registeredMatches,0);
    await runtime.setPolicy({mode:'v4',engineVersion:VERSION,sourceDigest:bundle.sourceDigest,events:[event]},{expectedRevision:0});
    const produced=await runtime.advance({...event,duration:60},{onStarted:async round=>{firstId=round.tasks[0].fixture.id;const head=await (await fetch(base+`/v4/matches/${firstId}/head`,{headers})).json();assert.deepEqual(head.segments,[]);assert.equal(runtime.registeredMatches,8);}});
    assert.equal(produced.complete,false);assert.deepEqual((await runtime.sweep()).expired,[]);time+=3600000;assert.equal((await runtime.advance(event)).complete,true);
    const before=JSON.stringify(service.state);await runtime.close();service=createService(options);runtime=await open();assert.equal(runtime.registeredMatches,8);await runtime.recover();
    time+=3*86400000;const head=await (await fetch(base+`/v4/matches/${firstId}/head`,{headers})).json();assert.equal(head.complete,true);
    assert.equal((await runtime.sweep()).expired.length,7);assert.equal((await fetch(base+`/v4/matches/${firstId}/segments/0`,{headers})).status,200);
    time+=90001;assert.deepEqual((await runtime.sweep()).expired,[firstId]);assert.equal((await fetch(base+`/v4/matches/${firstId}/head`,{headers})).status,410);assert.equal((await runtime.advance(event)).duplicate,true);assert.equal(JSON.stringify(service.state),before);assert.ok(runtime.readerStats.entries<=2);
    const closing=runtime.close();assert.equal(runtime.close(),closing);await closing;assert.throws(()=>runtime.advance(event),/关闭/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await runtime.close();}
});

test('closing the runtime aborts pending production, drains its operation and releases the root for explicit recovery',async()=>{
  const f=await retentionFixture(),bundleDirectory=path.join(f.root,'engine'),manifest=JSON.parse(await fs.readFile(path.join(bundleDirectory,'manifest.json'),'utf8')),candidate={accepted:true,bundleDirectory,engineVersion:manifest.engineVersion,sourceDigest:manifest.sourceDigest};
  const createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG},options={statePath:path.join(f.root,'league.json'),backupDir:null,now:f.now,rng:()=>.5};let service=createService(options);
  // The retention fixture moved its calendar forward three days before reopen.
  service.save({skipDailyBackup:true});
  const open=()=>openLocalCompetitionRuntime({enabled:true,root:f.root,rooms:{account(id){return {id};}},service,createService,sourceCatalog,candidates:[candidate],now:f.now});let runtime=await open();
  const event={competition:'league',seasonId:service.state.season.id,roundNumber:2};await runtime.setPolicy({mode:'v4',engineVersion:VERSION,sourceDigest:manifest.sourceDigest,events:[event]},{expectedRevision:0});
  let ready,release;const started=new Promise(resolve=>{ready=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  const operation=runtime.advance({...event,duration:60},{onStarted:async()=>{ready();await blocked;}});operation.catch(()=>{});await started;
  const closing=runtime.close();release();await assert.rejects(operation,/暂停/);await closing;
  service=createService(options);runtime=await open();
  try{await runtime.recover();const produced=await runtime.advance(event);assert.equal(produced.computed,8);assert.equal(produced.complete,false);f.advance(3600000);assert.equal((await runtime.advance(event)).complete,true);assert.equal(service.state.season.currentRound,2);}finally{await runtime.close();}
});
