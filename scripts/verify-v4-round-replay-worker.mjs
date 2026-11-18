import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {resolveSourceCatalog} from '../versus/v4-adapter/read-source.js';
import {createS4BondCatalog} from '../versus/public/bond-rules.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';

const root=fs.realpathSync(process.env.V4_REPLAY_ROOT??''),marker=JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8'));assert.equal(marker.format,'v4-round-replay-proof-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){const relative=path.relative(root,path.resolve(process.env[key]??''));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));}
const resolved=resolveSourceCatalog({content:JSON.parse(fs.readFileSync(process.env.YDL_CONTENT_OVERRIDES_PATH,'utf8')),studio:JSON.parse(fs.readFileSync(process.env.YDL_PLAYER_CARD_STUDIO_PATH,'utf8'))}),sourceCatalog={catalog:resolved.players,traitCatalog:resolved.traits,bondCatalog:createS4BondCatalog(resolved.players)};
await import('../versus/ydl-content-store.js');const {YellowDogsLeagueService,yellowDogsLeague}=await import('../versus/league-service.js');
const createService=options=>new YellowDogsLeagueService(options),initial=structuredClone(unwrapTracked(yellowDogsLeague.state)),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),initialHash=hash(initial);
const expected=JSON.parse(fs.readFileSync(path.join(marker.acceptedRoot,'json/league.json'),'utf8')),rounds=Object.values(expected.v4LocalLeagueRounds.rounds).sort((a,b)=>a.number-b.number),storages=[];assert.equal(rounds.length,2);
for(const storage of ['json','shards']){
  const directory=path.join(root,storage);fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  let time=rounds[0].startedAt;const now=()=>time,options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
  let service=createService(options);service.adoptState(structuredClone(initial));service.save({forceFull:true,skipDailyBackup:true});service=createService(options);
  const bridge=await openCanonicalLocalStorageSettlement({root:directory,service,createService,sourceCatalog,now}),started=performance.now();
  for(const prior of rounds){
    time=prior.startedAt;const request={seasonId:prior.seasonId,roundNumber:prior.number,duration:prior.duration,releaseRate:prior.releaseRate,enginePin:prior.enginePin};
    const round=await bridge.beginRound(request);assert.deepEqual(round.tasks,prior.tasks);time=prior.receipt.completedAt;
    for(const task of prior.tasks)await bridge.settleJob(path.join(marker.acceptedRoot,'json','league-queue-'+prior.key,'jobs',task.fixture.id),task.context);
    await bridge.finishRound(request);assert.equal((await bridge.finishRound(request)).duplicate,true);
  }
  const actual=JSON.parse(JSON.stringify(unwrapTracked(service.state)));
  for(const key of ['matches','teams','playerStats','wallets','s4Assets','s4Packs','matchPredictions','season','rounds'])assert.deepEqual(actual[key],expected[key],key);
  const actualNew=actual.ledger.slice(initial.ledger.length),expectedNew=expected.ledger.slice(initial.ledger.length);
  assert.deepEqual(actualNew.map(({id,...row})=>row),expectedNew.map(({id,...row})=>row));
  assert.equal(new Set(actual.ledger.map(row=>row.id)).size,actual.ledger.length);
  // Original reward IDs use Date.now(). Compare only their proven one-to-one
  // references to equal ledger rows; message IDs and every other field stay exact.
  const references=new Map(actualNew.map((row,index)=>[row.id,expectedNew[index].id])),inbox=structuredClone(actual.inbox);
  for(const messages of Object.values(inbox))for(const message of messages)for(const reward of message.payload?.rewards??[]){
    if(references.has(reward.id))reward.id=references.get(reward.id);
  }
  assert.deepEqual(inbox,expected.inbox,'inbox with verified reward references');
  const reopenedService=createService(options),reopened=await openCanonicalLocalStorageSettlement({root:directory,service:reopenedService,createService,sourceCatalog,now});
  for(const round of rounds){assert.equal((await reopened.finishRound({seasonId:round.seasonId,roundNumber:round.number})).duplicate,true);
    for(const task of round.tasks)assert.equal((await reopened.settleJob(path.join(marker.acceptedRoot,'json','league-queue-'+round.key,'jobs',task.fixture.id),task.context)).duplicate,true);
  }
  assert.deepEqual(unwrapTracked(reopenedService.state).ledger,actual.ledger);
  assert.deepEqual(JSON.parse(JSON.stringify(unwrapTracked(reopenedService.state).inbox)),actual.inbox,'reopened inbox IDs');
  storages.push({storage,rounds:2,matches:16,businessMatchesAccepted48:true,inboxMatches:true,reopenExactlyOnce:true,elapsedMs:performance.now()-started});
}
assert.equal(hash(unwrapTracked(yellowDogsLeague.state)),initialHash);
const report={passed:true,scope:'Current storage/lifecycle consumes 16 full-match artifacts frozen by stage 48; both original storage backends compared with accepted business results, including inbox and reopen receipts. No resimulation or capacity claim.',acceptedRoot:marker.acceptedRoot,storages,canonicalSingletonUnchanged:true};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
