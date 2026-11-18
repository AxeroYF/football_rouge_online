import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {applySeasonBoundary,seasonBoundaryKey} from '../versus/v4-host/season-boundary.js';
import {at,createService,completedSeason} from './v4-season-boundary-fixture.js';

test('actual process death at season rewards/reset commits never duplicates rewards, honors, archive or movement',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-season-kill-')),initial=completedSeason(),seasonId=initial.season.id,time=at+86400000,now=()=>time;
  const serviceUrl=new URL('../versus/league-service.js',import.meta.url).href,bridgeUrl=new URL('../versus/v4-host/canonical-storage-settlement.js',import.meta.url).href;
  for(const storage of ['json','shards'])for(const phase of ['rewards','reset'])for(const point of ['before','after']){
    const directory=path.join(root,storage+'-'+phase+'-'+point);await fs.mkdir(directory);await fs.writeFile(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
    const prepared=phase==='reset'?applySeasonBoundary({league:initial,seasonId,phase:'rewards',at:time,createService}).league:structuredClone(initial),options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
    let service=createService(options);service.adoptState(prepared);service.save({forceFull:true,skipDailyBackup:true});service=createService(options);service.save({skipDailyBackup:true});
    const key=seasonBoundaryKey(seasonId,phase),script=`import {YellowDogsLeagueService} from ${JSON.stringify(serviceUrl)};import {openCanonicalLocalStorageSettlement} from ${JSON.stringify(bridgeUrl)};
      const createService=o=>new YellowDogsLeagueService(o),now=()=>${time},service=createService({statePath:process.env.V4_SEASON_FILE,backupDir:null,pagedInbox:true,now});
      const bridge=await openCanonicalLocalStorageSettlement({root:process.env.V4_SEASON_ROOT,service,createService,now}),save=service.save.bind(service),stop=()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      service.save=o=>{if(service.state.v4LocalSeasonBoundaries?.receipts[process.env.V4_SEASON_KEY]){if(process.env.V4_SEASON_POINT==='before')stop();save(o);stop();}return save(o);};
      await bridge.finishSeasonBoundary(JSON.parse(process.env.V4_SEASON_REQUEST));`;
    const request={seasonId,phase},child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_SEASON_ROOT:directory,V4_SEASON_FILE:options.statePath,V4_SEASON_POINT:point,V4_SEASON_KEY:key,V4_SEASON_REQUEST:JSON.stringify(request)},stdio:['ignore','ignore','pipe','ipc']});
    const exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
    try{
      await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('season crash timeout '+stderr)),20000);child.once('message',()=>{clearTimeout(timeout);resolve();});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(new Error('season child exited '+stderr));});});
      child.kill();await exited;const recovered=createService(options),bridge=await openCanonicalLocalStorageSettlement({root:directory,service:recovered,createService,now});await bridge.recoverAbandonedLock();
      assert.equal(Boolean(recovered.state.v4LocalSeasonBoundaries?.receipts[key]),point==='after');await bridge.finishSeasonBoundary(request);
      const state=JSON.parse(JSON.stringify(unwrapTracked(recovered.state)));assert.equal(state.ledger.filter(row=>row.type==='daily-season-settlement').length,2);
      if(phase==='reset'){assert.equal(state.competitionFormat.movements.filter(row=>row.seasonId===seasonId).length,1);assert.equal(state.honorRoom.processedSeasonIds.filter(id=>id===seasonId).length,1);assert.equal(state.archives.filter(row=>row.season.id===seasonId).length,1);assert.equal(state.season.currentRound,0);}
      assert.equal((await bridge.finishSeasonBoundary(request)).duplicate,true);assert.deepEqual(JSON.parse(JSON.stringify(unwrapTracked(recovered.state))),state);
    }finally{if(child.exitCode===null)child.kill();await exited;}
  }
});
