import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';

for(const storage of ['json','shards'])test(`${storage}: cup start distinguishes a failed write from a committed write that threw`,async()=>{
  for(const point of ['before','after']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-cup-start-fault-'));await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
    const now=()=>1794934800000,createService=options=>new YellowDogsLeagueService(options),options={statePath:path.join(root,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
    let service=createService(options);service.startCup();service.save({skipDailyBackup:true});service=createService(options);service.save({skipDailyBackup:true});
    const bridge=await openCanonicalLocalStorageSettlement({root,service,createService,now,sourceCatalog:{catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG}}),request={seasonId:service.state.season.id,eventId:service.state.cup.events[0].id,duration:60},save=service.save.bind(service);
    service.save=options=>{if(service.state.v4LocalCupEvents?.active){if(point==='after')save(options);throw new Error('cup-start-'+point);}return save(options);};
    if(point==='before'){await assert.rejects(bridge.beginCupEvent(request),/cup-start-before/);assert.equal(service.state.cup.events[0].status,'pending');assert.equal(service.state.v4LocalCupEvents,undefined);}
    else assert.equal((await bridge.beginCupEvent(request)).recoveredCommit,true);
    service.save=save;const started=await bridge.beginCupEvent(request);assert.equal(started.status,'running');if(point==='after')assert.equal(started.duplicate,true);
    const disk=createService(options);assert.equal(disk.state.cup.events[0].status,'running');assert.equal(Object.keys(disk.state.v4LocalCupEvents.events).length,1);assert.equal(disk.state.v4LocalCupEvents.events[started.key].tasks.length,8);
  }
});
