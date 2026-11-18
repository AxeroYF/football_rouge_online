import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {resolveSourceCatalog} from '../versus/v4-adapter/read-source.js';
import {createS4BondCatalog} from '../versus/public/bond-rules.js';
import {openLocalLeagueScheduler} from '../versus/v4-host/local-league-scheduler.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {scheduledLeagueField} from '../versus/v4-host/scheduled-league.js';

const root=fs.realpathSync(process.env.V4_ROUND_SANDBOX??'');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-scheduled-league-proof-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){
  assert.ok(process.env[key]);const relative=path.relative(root,path.resolve(process.env[key]));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
}
const resolved=resolveSourceCatalog({content:JSON.parse(fs.readFileSync(process.env.YDL_CONTENT_OVERRIDES_PATH,'utf8')),studio:JSON.parse(fs.readFileSync(process.env.YDL_PLAYER_CARD_STUDIO_PATH,'utf8'))});
const sourceCatalog={catalog:resolved.players,traitCatalog:resolved.traits,bondCatalog:createS4BondCatalog(resolved.players)};
await import('../versus/ydl-content-store.js');
const {YellowDogsLeagueService,yellowDogsLeague}=await import('../versus/league-service.js');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),initial=structuredClone(unwrapTracked(yellowDogsLeague.state)),before=hash(initial);
const createService=options=>new YellowDogsLeagueService(options),bundleDirectory=path.resolve('outputs/v4-accepted-local-20261118/engine'),bundle=JSON.parse(fs.readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8'));
const candidate={accepted:true,bundleDirectory,engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest};
const artifacts=[],storages=[],baseAt=1794934800000;let expected;
for(const storage of ['json','shards']){
  const directory=path.join(root,storage);fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  let time=baseAt;const now=()=>time,options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
  let service=createService(options);service.adoptState(structuredClone(initial));service.save({skipDailyBackup:true,forceFull:true});service=createService(options);
  const started=performance.now(),summaries=[];
  const scheduler=await openLocalLeagueScheduler({root:directory,service,createService,sourceCatalog,candidate,enabled:true,now}),bridge=scheduler.settlement;
  for(let step=0;step<2;step++){
    time=baseAt+step*4*3600000;const roundNumber=initial.season.currentRound+step+1,request={seasonId:initial.season.id,roundNumber};
    const count=service.state.matches.length;let round,jobDirectories;
    if(storage==='json'){
      const produced=await scheduler.advance(request);assert.equal(produced.complete,false);assert.equal(produced.computed,8);assert.equal(service.state.matches.length,count);
      round=Object.values(service.state[scheduledLeagueField].rounds).find(r=>r.number===roundNumber);
      jobDirectories=round.tasks.map(task=>path.join(produced.queueDirectory,'jobs',task.fixture.id));
      artifacts.push({round:structuredClone(round),jobDirectories});time+=2*3600000;
      const complete=await scheduler.advance(request);assert.equal(complete.complete,true);assert.equal(complete.computed,0);assert.equal(complete.settled,8);
    }else{
      round=await bridge.beginRound({...request,enginePin:{engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest}});const prior=artifacts[step];jobDirectories=prior.jobDirectories;
      assert.deepEqual(round.tasks,prior.round.tasks);time+=2*3600000;
      for(const [index,task] of round.tasks.entries())await bridge.settleJob(jobDirectories[index],task.context);
      await bridge.finishRound(request);
    }
    const state=unwrapTracked(service.state),record=state[scheduledLeagueField].rounds[round.key];
    assert.equal(state.season.currentRound,roundNumber);assert.equal(state.rounds[roundNumber-1].status,'complete');assert.equal(state.matches.length,count+8);
    for(const team of state.teams.filter(t=>t.ownerId))assert.equal(state.ledger.filter(row=>row.type==='league-match-reward'&&row.accountId===team.ownerId&&row.round===roundNumber&&row.seasonId===state.season.id).length,1);
    for(const key of record.newUnavailable){const [teamId,playerId,kind]=key.split(':');const player=state.teams.find(t=>t.id===teamId).playerState[playerId];assert.ok(Number(player[kind==='injury'?'injuryRounds':'suspension'])>0);}
    assert.equal((await bridge.finishRound(request)).duplicate,true);
    summaries.push({roundNumber,matches:8,newUnavailable:record.newUnavailable.length,sourceFingerprint:round.sourceFingerprint,scores:state.matches.slice(count).map(m=>m.score)});
  }
  assert.notEqual(summaries[0].sourceFingerprint,summaries[1].sourceFingerprint);
  const state=structuredClone(unwrapTracked(service.state));
  if(!expected)expected=state;
  else{
    for(const key of ['matches','teams','playerStats','wallets','s4Assets','s4Packs','matchPredictions','season','rounds'])assert.deepEqual(state[key],expected[key],key);
    assert.deepEqual(state.ledger.slice(initial.ledger.length).map(({id,...row})=>row),expected.ledger.slice(initial.ledger.length).map(({id,...row})=>row));
  }
  const reopenedService=createService(options),reopened=await openCanonicalLocalStorageSettlement({root:directory,service:reopenedService,createService,sourceCatalog,now});
  for(const artifact of artifacts){
    assert.equal((await reopened.finishRound({seasonId:initial.season.id,roundNumber:artifact.round.number})).duplicate,true);
    for(const [i,task] of artifact.round.tasks.entries())assert.equal((await reopened.settleJob(artifact.jobDirectories[i],task.context)).duplicate,true);
  }
  assert.deepEqual(unwrapTracked(reopenedService.state).ledger,state.ledger);assert.deepEqual(unwrapTracked(reopenedService.state).matches,state.matches);
  storages.push({storage,rounds:2,matches:16,summaries,reopenExactlyOnce:true,elapsedMs:performance.now()-started});
}
assert.equal(hash(unwrapTracked(yellowDogsLeague.state)),before);
const report={passed:true,scope:'Two sequential full real-team league rounds in marked copies. JSON executes actual scheduler; shards replay the same 16 pinned jobs. Original round reward/availability methods, publication gate, cross-round input and reopen receipts checked. Not resource-limited or production.',storages,canonicalSingletonUnchanged:true};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
