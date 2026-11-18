import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {resolveSourceCatalog} from '../versus/v4-adapter/read-source.js';
import {createS4BondCatalog} from '../versus/public/bond-rules.js';
import {openLocalCupScheduler} from '../versus/v4-host/local-cup-scheduler.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';

const root=fs.realpathSync(process.env.V4_CUP_SANDBOX??'');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-cup-lifecycle-proof-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){const relative=path.relative(root,path.resolve(process.env[key]??''));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));}
const resolved=resolveSourceCatalog({content:JSON.parse(fs.readFileSync(process.env.YDL_CONTENT_OVERRIDES_PATH,'utf8')),studio:JSON.parse(fs.readFileSync(process.env.YDL_PLAYER_CARD_STUDIO_PATH,'utf8'))}),sourceCatalog={catalog:resolved.players,traitCatalog:resolved.traits,bondCatalog:createS4BondCatalog(resolved.players)};
await import('../versus/ydl-content-store.js');const {YellowDogsLeagueService,yellowDogsLeague}=await import('../versus/league-service.js');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])])):value;
const createService=options=>new YellowDogsLeagueService(options),hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'),initial=structuredClone(unwrapTracked(yellowDogsLeague.state)),initialHash=hash(initial),baseAt=1794934800000;
const bundleDirectory=path.resolve('outputs/v4-accepted-local-20261118/engine'),bundle=JSON.parse(fs.readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8')),enginePin={engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest},candidate={accepted:true,bundleDirectory,...enginePin};
const artifacts=[],storages=[];let expected;
for(const storage of ['json','shards']){
  let directory=path.join(root,storage);if(storage==='shards'&&fs.existsSync(directory))directory=fs.mkdtempSync(path.join(root,'shards-replay-'));
  const resuming=storage==='json'&&fs.existsSync(directory);if(!resuming){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));}
  let time=baseAt;const now=()=>time,options={statePath:path.join(directory,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
  let service=createService(options);if(!resuming){service.adoptState(structuredClone(initial));if(service.state.cup.status==='waiting')service.startCup();service.save({forceFull:true,skipDailyBackup:true});service=createService(options);}
  assert.ok(['active','completed'].includes(service.state.cup.status));assert.equal(service.state.cup.events[0].stage,'roundOf16');assert.equal(service.state.cup.events[0].leg,1);
  const scheduler=await openLocalCupScheduler({root:directory,service,createService,sourceCatalog,candidate,enabled:true,now}),bridge=scheduler.settlement,started=performance.now(),summaries=[];
  for(let index=0;index<7;index++){
    time=baseAt+index*4*3600000;const next=service.state.cup.events[index];assert.ok(next);const request={seasonId:initial.season.id,eventId:next.id};
    let event,jobs,replayingCompleted=false;
    if(storage==='json'){
      const completed=next.status==='complete',count=service.state.matches.length,produced=await scheduler.advance(request);replayingCompleted=completed;assert.equal(produced.complete,completed);assert.equal(service.state.matches.length,count);
      event=Object.values(service.state.v4LocalCupEvents.events).find(event=>event.eventId===next.id);jobs=event.tasks.map(task=>path.join(directory,'cup-queue-'+event.key,'jobs',task.fixture.id));
      if(completed){assert.equal(produced.duplicate,true);time=event.receipt.completedAt;}
      else{
        // Extra time plus stoppage/shootouts may exceed two hours. Use the
        // actual pinned archive release boundary, retaining earlier test times.
        const through=Math.max(...jobs.map(job=>JSON.parse(fs.readFileSync(path.join(job,'archive/manifest.json'),'utf8')).segments.at(-1).through));
        time=Math.max(time+2*3600000,event.startedAt+Math.ceil(through*1000/event.releaseRate)+1);
        const complete=await scheduler.advance(request);assert.equal(complete.complete,true);assert.equal(complete.computed,0);assert.equal(complete.settled,event.tasks.length);
      }
      artifacts.push({event:structuredClone(event),jobs,completedAt:time});
    }else{
      event=await bridge.beginCupEvent({...request,enginePin});jobs=artifacts[index].jobs;assert.equal(hash(event.tasks),hash(artifacts[index].event.tasks),'cross-storage inputs');time=artifacts[index].completedAt;
      for(const [i,task] of event.tasks.entries())await bridge.settleJob(jobs[i],task.context);await bridge.finishCupEvent(request);
    }
    const state=unwrapTracked(service.state),record=state.v4LocalCupEvents.events[event.key];assert.equal(state.cup.events.find(entry=>entry.id===next.id).status,'complete');
    const matches=record.tasks.map(task=>state.matches.find(match=>match.id===record.settled[task.fixture.id].matchId));assert.ok(matches.every(Boolean));
    // A resumed historical event's absences may already have expired in later
    // rounds. The fresh shard replay checks every event at its original edge.
    if(!replayingCompleted)for(const key of record.newUnavailable){const [teamId,playerId,kind]=key.split(':'),player=state.teams.find(team=>team.id===teamId).playerState[playerId];assert.ok(Number(player[kind==='injury'?'injuryRounds':'cupSuspension'])>0);}
    assert.equal((await bridge.finishCupEvent(request)).duplicate,true);
    summaries.push({eventId:event.eventId,matches:event.tasks.length,newUnavailable:record.newUnavailable.length,sourceFingerprint:event.sourceFingerprint,scores:matches.map(match=>({score:match.score,penalties:match.penalties}))});
    fs.writeFileSync(path.join(root,'progress.json'),JSON.stringify({storage,events:summaries.length,matches:state.matches.length-initial.matches.length,stage:state.cup.stage,elapsedMs:performance.now()-started},null,2));
  }
  assert.equal(summaries.length,7);assert.equal(service.state.matches.length-initial.matches.length,29);assert.ok(service.state.cup.championId);assert.equal(service.state.cup.nextRoundAt,null);
  const state=JSON.parse(JSON.stringify(unwrapTracked(service.state)));
  if(!expected)expected=state;else{
    for(const key of ['matches','cup','playerStats','wallets','s4Assets','s4Packs','matchPredictions','season','rounds'])assert.equal(hash(state[key]),hash(expected[key]),key);
    const teams=structuredClone(state.teams);
    for(const [index,team] of teams.entries()){
      const offers=team.clubManagement?.sponsorship?.offers??[],priorOffers=expected.teams[index].clubManagement?.sponsorship?.offers??[],originalIds=new Set(initial.teams[index].clubManagement?.sponsorship?.offers?.map(offer=>offer.id)??[]);
      assert.equal(offers.length,priorOffers.length);assert.equal(new Set(offers.map(offer=>offer.id)).size,offers.length);
      for(const [i,offer] of offers.entries())if(offer.id!==priorOffers[i].id){
        assert.ok(!originalIds.has(offer.id)&&!originalIds.has(priorOffers[i].id));assert.match(offer.id,/^sponsor-offer-/);assert.match(priorOffers[i].id,/^sponsor-offer-/);
        const {id,...actualOffer}=offer,{id:expectedId,...expectedOffer}=priorOffers[i];assert.deepEqual(actualOffer,expectedOffer);offer.id=expectedId;
      }
    }
    assert.deepEqual(teams,expected.teams,'teams with content-verified new sponsor IDs');
    const actualNew=state.ledger.slice(initial.ledger.length),expectedNew=expected.ledger.slice(initial.ledger.length);assert.deepEqual(actualNew.map(({id,...row})=>row),expectedNew.map(({id,...row})=>row));
    const refs=new Map(actualNew.map((row,index)=>[row.id,expectedNew[index].id])),inbox=structuredClone(state.inbox);
    for(const messages of Object.values(inbox))for(const message of messages)for(const reward of message.payload?.rewards??[])if(refs.has(reward.id))reward.id=refs.get(reward.id);
    assert.equal(hash(inbox),hash(expected.inbox),'inbox with verified ledger references');
  }
  const reopenedService=createService(options),reopened=await openCanonicalLocalStorageSettlement({root:directory,service:reopenedService,createService,sourceCatalog,now});
  for(const artifact of artifacts){assert.equal((await reopened.finishCupEvent({seasonId:initial.season.id,eventId:artifact.event.eventId})).duplicate,true);for(const [i,task] of artifact.event.tasks.entries())assert.equal((await reopened.settleJob(artifact.jobs[i],task.context)).duplicate,true);}
  for(const key of ['ledger','matches','teams','cup','inbox'])assert.equal(hash(unwrapTracked(reopenedService.state)[key]),hash(state[key]),'reopen '+key);
  storages.push({storage,directory,events:7,matches:29,championId:state.cup.championId,summaries,reopenExactlyOnce:true,elapsedMs:performance.now()-started});
}
assert.equal(hash(unwrapTracked(yellowDogsLeague.state)),initialHash);
const resultName=process.env.V4_CUP_RESULT_NAME??'result.json';assert.match(resultName,/^result(?:-\d+)?\.json$/);
const report={passed:true,scope:'Full real-team knockout cup in marked copies: seven events and 29 full regulation matches, extra time/shootouts when needed. JSON uses/resumes the actual scheduler; shards freshly consume the same locked artifacts. Original cup bracket/reward/availability/inbox methods. Not capacity or production.',storages,canonicalSingletonUnchanged:true};fs.writeFileSync(path.join(root,resultName),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
