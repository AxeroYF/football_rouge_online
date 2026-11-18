import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';
import {openLocalCompetitionController} from '../versus/v4-host/local-competition-controller.js';

for(const competition of ['league','cup'])test(`${competition}: a dead host resumes its committed event after another controller rolls the policy back`,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-host-kill-')),bundleDirectory=path.join(root,'engine');await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])}),candidate={accepted:true,bundleDirectory,engineVersion:VERSION,sourceDigest:bundle.sourceDigest};
  const createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};let time=1794934800000;const now=()=>time,options={statePath:path.join(root,'league.json'),backupDir:null,now,rng:()=>.5};
  let service=createService(options);if(competition==='cup')service.startCup();service.save({skipDailyBackup:true});
  const event={competition,seasonId:service.state.season.id,...(competition==='league'?{roundNumber:1}:{eventId:service.state.cup.events[0].id})},open=()=>openLocalCompetitionController({enabled:true,root,service,createService,sourceCatalog,candidates:[candidate],now});let host=await open();
  await host.setPolicy({mode:'v4',engineVersion:VERSION,sourceDigest:bundle.sourceDigest,events:[event]},{expectedRevision:0});
  const moduleUrl=new URL('../versus/v4-host/local-competition-controller.js',import.meta.url).href,serviceUrl=new URL('../versus/league-service.js',import.meta.url).href,poolUrl=new URL('../versus/player-pool.js',import.meta.url).href;
  const script=`import {openLocalCompetitionController} from ${JSON.stringify(moduleUrl)};import {YellowDogsLeagueService,S4_BOND_CATALOG} from ${JSON.stringify(serviceUrl)};import {REAL_PLAYERS} from ${JSON.stringify(poolUrl)};const o=JSON.parse(process.env.V4_HOST_OPTIONS),createService=p=>new YellowDogsLeagueService(p),now=()=>o.at,service=createService({statePath:o.statePath,backupDir:null,now});const host=await openLocalCompetitionController({enabled:true,root:o.root,service,createService,now,sourceCatalog:{catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG},candidates:[o.candidate]});await host.advance({...o.event,duration:60,releaseRate:1},{onStarted:()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});`;
  const env={...process.env,V4_HOST_OPTIONS:JSON.stringify({root,statePath:options.statePath,at:time,candidate,event})};for(const [key,name] of Object.entries({VERSUS_ACCOUNTS_PATH:'singleton-accounts.json',YELLOWDOGS_LEAGUE_PATH:'singleton-league.json',YDL_CONTENT_OVERRIDES_PATH:'singleton-content.json',YDL_PLAYER_CARD_STUDIO_PATH:'singleton-studio.json',YDL_PLAYER_PROFILE_ROOT:'singleton-profiles'}))env[key]=path.join(root,name);
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env,stdio:['ignore','ignore','pipe','ipc']}),exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('host child timeout '+stderr)),15000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('host child exited '+stderr));});});
    await assert.rejects(host.advance(event),/锁已占用/);await assert.rejects(host.recover(),/仍在运行/);
    await host.setPolicy({mode:'off'},{expectedRevision:1});child.kill();await exited;
    service=createService(options);host=await open();await host.recover();const produced=await host.advance(event);assert.equal(produced.computed,8);assert.equal(produced.complete,false);
    await assert.rejects(host.retry('unrelated'),/当前锁定/);
    time+=3600000;const completed=await host.advance(event);assert.equal(completed.complete,true);assert.equal(completed.computed,0);assert.equal(service.state.matches.length,8);assert.equal((await host.advance(event)).duplicate,true);assert.equal((await host.read()).revision,2);
  }finally{if(child.exitCode===null)child.kill();await exited;}
});
