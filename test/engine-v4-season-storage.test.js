import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {applySeasonBoundary} from '../versus/v4-host/season-boundary.js';
import {at,createService,completedSeason} from './v4-season-boundary-fixture.js';

for(const storage of ['json','shards'])for(const phase of ['rewards','reset'])test(`${storage} ${phase}: season boundary recovers before/after save errors and deduplicates across restart`,async()=>{
  for(const point of ['before','after']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-season-storage-'));await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
    let initial=completedSeason();const seasonId=initial.season.id,now=()=>at+86400000,options={statePath:path.join(root,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
    if(phase==='reset')initial=applySeasonBoundary({league:initial,seasonId,phase:'rewards',at:now(),createService}).league;
    let service=createService(options);service.adoptState(initial);service.save({forceFull:true,skipDailyBackup:true});service=createService(options);service.save({skipDailyBackup:true});
    const bridge=await openCanonicalLocalStorageSettlement({root,service,createService,now}),save=service.save.bind(service),request={seasonId,phase};
    service.save=options=>{if(point==='after')save(options);throw new Error('season-'+point);};
    if(point==='before')await assert.rejects(bridge.finishSeasonBoundary(request),/season-before/);
    else assert.equal((await bridge.finishSeasonBoundary(request)).recoveredCommit,true);
    service.save=save;await bridge.finishSeasonBoundary(request);assert.equal((await bridge.finishSeasonBoundary(request)).duplicate,true);
    const expected=JSON.parse(JSON.stringify(unwrapTracked(service.state))),reopenedService=createService(options),reopened=await openCanonicalLocalStorageSettlement({root,service:reopenedService,createService,now});
    assert.equal((await reopened.finishSeasonBoundary(request)).duplicate,true);assert.deepEqual(JSON.parse(JSON.stringify(unwrapTracked(reopenedService.state))),expected);
    assert.equal(expected.ledger.filter(row=>row.type==='daily-season-settlement').length,2);
    if(phase==='reset'){
      assert.equal(expected.competitionFormat.movements.length,1);assert.equal(expected.archives.filter(archive=>archive.season.id===seasonId).length,1);assert.equal(expected.season.currentRound,0);
      const summary=expected.archives.find(archive=>archive.season.id===seasonId),archive=reopenedService.shardStore?reopenedService.shardStore.readFullArchive(summary):summary;
      assert.equal(archive.matches.length,141);assert.equal(archive.cup.status,'completed');assert.deepEqual(archive.matches,initial.matches);
      assert.equal((await reopened.finishSeasonBoundary({seasonId,phase:'rewards'})).duplicate,true);
    }
  }
});
