import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';

const root=fs.realpathSync(process.env.V4_STORAGE_SANDBOX??'');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-canonical-storage-proof-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){
  assert.ok(process.env[key]);const relative=path.relative(root,path.resolve(process.env[key]));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
}
await import('../versus/ydl-content-store.js');
const {YellowDogsLeagueService,yellowDogsLeague}=await import('../versus/league-service.js');
const now=()=>1794934800000,createService=options=>new YellowDogsLeagueService(options),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const initial=unwrapTracked(yellowDogsLeague.state),beforeHash=hash(initial),prior=JSON.parse(fs.readFileSync(path.join(root,'accepted-round.json'),'utf8'));
const expected=JSON.parse(fs.readFileSync(path.join(prior.root,'settlement/journal.json'),'utf8')).state.league,storages=[];
for(const storage of ['json','shards']){
  const directory=path.join(root,storage);fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};let service=createService(options);
  service.adoptState(structuredClone(initial));service.save({skipDailyBackup:true,forceFull:true});
  // Enter through the normal loader after importing the clone. Shard archives
  // are immutable cold bodies represented by summaries in live memory.
  service=createService(options);
  const bridge=await openCanonicalLocalStorageSettlement({root:directory,service,createService,now}),started=performance.now();
  for(const match of prior.summaries){
    const receipt=await bridge.settleJob(path.join(prior.root,'queue/jobs',match.fixtureId),{competition:'league',round:999});
    assert.equal(receipt.inputFingerprint,match.inputFingerprint);assert.equal(receipt.matchId,match.matchId);assert.equal(receipt.localOnly,true);
  }
  const after=unwrapTracked(service.state),newMatches=after.matches.slice(initial.matches.length);
  assert.deepEqual(newMatches,expected.matches.slice(initial.matches.length));assert.deepEqual(after.playerStats,expected.playerStats);
  assert.deepEqual(after.teams,expected.teams);assert.deepEqual(after.inbox,expected.inbox);
  for(const team of service.state.teams.filter(t=>t.ownerId))assert.equal(service.inboxProjection(team).inboxMeta.total,(expected.inbox[team.id]??[]).length);
  assert.deepEqual(after.ledger.slice(0,initial.ledger.length),initial.ledger);
  // Legacy makeId uses wall-clock time even with an injected business clock.
  // Independent forks may have different new ledger IDs; compare every business
  // field and require unique IDs. Reopen below still preserves committed IDs.
  const businessRows=rows=>rows.slice(initial.ledger.length).map(({id,...business})=>business);
  assert.deepEqual(businessRows(after.ledger),businessRows(expected.ledger));
  assert.equal(new Set(after.ledger.map(entry=>entry.id)).size,after.ledger.length);
  assert.deepEqual(after.s4Assets,expected.s4Assets);assert.deepEqual(after.matchPredictions,expected.matchPredictions);
  if(storage==='shards')for(const [index,archive] of after.archives.entries())assert.deepEqual(service.shardStore.readFullArchive(archive),initial.archives[index]);
  else assert.deepEqual(after.archives,initial.archives);
  assert.equal(Object.keys(after.v4LocalSettlements.receipts).length,8);
  const reopenedService=createService(options),reopened=await openCanonicalLocalStorageSettlement({root:directory,service:reopenedService,createService,now});
  for(const match of prior.summaries)assert.equal((await reopened.settleJob(path.join(prior.root,'queue/jobs',match.fixtureId),{competition:'league',round:999})).duplicate,true);
  assert.deepEqual(unwrapTracked(reopenedService.state).matches,after.matches);assert.deepEqual(unwrapTracked(reopenedService.state).ledger,after.ledger);
  storages.push({storage,matches:8,receipts:8,canonicalBusinessIdentical:true,independentNewLedgerIdsMayDiffer:true,reopenExactlyOnce:true,elapsedMs:performance.now()-started});
}
assert.equal(hash(unwrapTracked(yellowDogsLeague.state)),beforeHash);
const report={passed:true,scope:'Original JSON and shard writers inside marked copies; reuses eight accepted full-game artifacts and compares against accepted canonical shadow consumption.',acceptedArtifacts:prior.root,storages,canonicalSingletonUnchanged:true};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
