import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unwrapTracked} from '../versus/league-shard-store.js';
import {resolveSourceCatalog} from '../versus/v4-adapter/read-source.js';
import {createS4BondCatalog} from '../versus/public/bond-rules.js';
import {openLocalLeagueScheduler} from '../versus/v4-host/local-league-scheduler.js';
import {openLocalCupScheduler} from '../versus/v4-host/local-cup-scheduler.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {openLocalDispatcher} from '../versus/v4-host/dispatcher.js';

const root=fs.realpathSync(process.env.V4_SEASON_SANDBOX??'');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-full-season-proof-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){const relative=path.relative(root,path.resolve(process.env[key]??''));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));}
const resolved=resolveSourceCatalog({content:JSON.parse(fs.readFileSync(process.env.YDL_CONTENT_OVERRIDES_PATH,'utf8')),studio:JSON.parse(fs.readFileSync(process.env.YDL_PLAYER_CARD_STUDIO_PATH,'utf8'))}),sourceCatalog={catalog:resolved.players,traitCatalog:resolved.traits,bondCatalog:createS4BondCatalog(resolved.players)};
await import('../versus/ydl-content-store.js');const {YellowDogsLeagueService,yellowDogsLeague}=await import('../versus/league-service.js');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'),snapshot=service=>JSON.parse(JSON.stringify(unwrapTracked(service.state))),initial=snapshot(yellowDogsLeague),initialHash=hash(initial),createService=options=>new YellowDogsLeagueService(options);
assert.equal(initial.season.currentRound,0);assert.equal(initial.matches.length,0);const seasonId=initial.season.id,baseAt=initial.season.firstRoundAt;assert.ok(Number.isSafeInteger(baseAt));
const bundleDirectory=path.resolve('outputs/v4-accepted-local-20261118/engine'),bundle=JSON.parse(fs.readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8')),enginePin={engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest},candidate={accepted:true,bundleDirectory,...enginePin};
const artifacts=[],storages=[];let expectedBefore,expectedAfter;
function compareBusiness(actual,expected,label){
  for(const key of ['matches','cup','season','rounds','playerStats','wallets','s4Assets','s4Packs','matchPredictions','ballonDor','honorRoom','competitionFormat'])assert.equal(hash(actual[key]),hash(expected[key]),label+' '+key);
  const teams=structuredClone(actual.teams);
  for(const [index,team] of teams.entries()){
    const offers=team.clubManagement?.sponsorship?.offers??[],other=expected.teams[index].clubManagement?.sponsorship?.offers??[],oldIds=new Set(initial.teams[index].clubManagement?.sponsorship?.offers?.map(offer=>offer.id)??[]);
    assert.equal(offers.length,other.length);assert.equal(new Set(offers.map(offer=>offer.id)).size,offers.length);
    for(const [i,offer] of offers.entries())if(offer.id!==other[i].id){assert.ok(!oldIds.has(offer.id)&&!oldIds.has(other[i].id));assert.match(offer.id,/^sponsor-offer-/);const {id,...left}=offer,{id:otherId,...right}=other[i];assert.deepEqual(left,right);offer.id=otherId;}
  }
  assert.deepEqual(teams,expected.teams,label+' teams');
  const left=actual.ledger.slice(initial.ledger.length),right=expected.ledger.slice(initial.ledger.length);assert.deepEqual(left.map(({id,...row})=>row),right.map(({id,...row})=>row),label+' ledger');
  const refs=new Map(left.map((row,index)=>[row.id,right[index].id])),inbox=structuredClone(actual.inbox);
  for(const messages of Object.values(inbox))for(const message of messages)for(const reward of message.payload?.rewards??[])if(refs.has(reward.id))reward.id=refs.get(reward.id);
  assert.equal(hash(inbox),hash(expected.inbox),label+' inbox');
}
for(const storage of ['shards','json']){
  const directory=storage==='shards'?path.join(root,'live'):fs.mkdtempSync(path.join(root,'json-replay-')),resuming=storage==='shards'&&fs.existsSync(directory);
  fs.mkdirSync(directory,{recursive:true});if(!resuming)fs.writeFileSync(path.join(directory,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  let time=baseAt;const now=()=>time,options={statePath:path.join(directory,storage==='shards'?'league-shards':'league.json'),backupDir:null,pagedInbox:true,now,rng:()=>.5};
  let service=createService(options);if(!resuming){service.adoptState(structuredClone(initial));if(service.state.cup.status==='waiting')service.startCup();service.save({forceFull:true,skipDailyBackup:true});service=createService(options);}
  const leagueScheduler=await openLocalLeagueScheduler({root:directory,service,createService,sourceCatalog,candidate,enabled:true,now}),cupScheduler=await openLocalCupScheduler({root:directory,service,createService,sourceCatalog,candidate,enabled:true,now}),bridge=leagueScheduler.settlement;
  if(resuming){await leagueScheduler.recover();await cupScheduler.recover();}
  if(resuming&&process.env.V4_SEASON_RETRY_FIXTURE){
    const fixtureId=process.env.V4_SEASON_RETRY_FIXTURE;let retried=false;
    for(const [kind,scheduler,field] of [['league',leagueScheduler,'v4LocalLeagueRounds'],['cup',cupScheduler,'v4LocalCupEvents']]){
      const active=service.state[field]?.active;if(!active)continue;
      const queue=await openLocalDispatcher(path.join(directory,kind+'-queue-'+active),{settlement:scheduler.settlement,candidate,now}),saved=await queue.read();
      if(saved.jobs.some(job=>job.fixture.id===fixtureId)){await queue.retry(fixtureId);retried=true;}
    }
    assert.equal(retried,true,'explicit failed fixture retry');
  }
  const started=performance.now(),summaries=[];let producedMatches=0;
  async function run(kind,number){
    const scheduler=kind==='league'?leagueScheduler:cupScheduler,metaField=kind==='league'?'v4LocalLeagueRounds':'v4LocalCupEvents',records=()=>Object.values(service.state[metaField]?.[kind==='league'?'rounds':'events']??{});
    const prior=records().find(record=>record.seasonId===seasonId&&(kind==='league'?record.number===number:record.eventId===number)),request=kind==='league'?{seasonId,roundNumber:number,releaseRate:64}:{seasonId,eventId:number,releaseRate:64};
    let record,jobs,finishedAt,wasComplete=false;
    if(storage==='shards'){
      wasComplete=prior?.status==='complete';
      if(wasComplete)record=prior;else{const result=await scheduler.advance(request);assert.equal(result.complete,false);record=records().find(record=>record.seasonId===seasonId&&(kind==='league'?record.number===number:record.eventId===number));producedMatches+=result.computed;}
      jobs=record.tasks.map(task=>path.join(directory,kind+'-queue-'+record.key,'jobs',task.fixture.id));
      if(wasComplete)finishedAt=record.receipt.completedAt;else{
        const through=Math.max(...jobs.map(job=>JSON.parse(fs.readFileSync(path.join(job,'archive/manifest.json'),'utf8')).segments.at(-1).through));finishedAt=Math.max(time+180000,record.startedAt+Math.ceil(through*1000/record.releaseRate)+1);time=finishedAt;
        const result=await scheduler.advance(request);assert.equal(result.complete,true);assert.equal(result.computed,0);assert.equal(result.settled,record.tasks.length);record=records().find(entry=>entry.key===record.key);
      }
      artifacts.push({kind,record:structuredClone(unwrapTracked(record)),jobs,finishedAt});
    }else{
      const priorArtifact=artifacts[summaries.length];assert.equal(priorArtifact.kind,kind);
      record=kind==='league'?await bridge.beginRound({...request,enginePin}):await bridge.beginCupEvent({...request,enginePin});assert.equal(hash(record.tasks),hash(priorArtifact.record.tasks),'cross-storage pinned inputs');jobs=priorArtifact.jobs;finishedAt=priorArtifact.finishedAt;time=finishedAt;
      for(const [index,task] of record.tasks.entries())await bridge.settleJob(jobs[index],task.context);
      if(kind==='league')await bridge.finishRound(request);else await bridge.finishCupEvent(request);record=records().find(entry=>entry.key===record.key);
    }
    if(!wasComplete)for(const key of record.newUnavailable){const [teamId,playerId,reason]=key.split(':'),player=service.state.teams.find(team=>team.id===teamId).playerState[playerId];assert.ok(Number(player[reason==='injury'?'injuryRounds':kind==='cup'?'cupSuspension':'suspension'])>0);}
    summaries.push({kind,number,matches:record.tasks.length,sourceFingerprint:record.sourceFingerprint,newUnavailable:record.newUnavailable.length,startedAt:record.startedAt,finishedAt});
    fs.writeFileSync(path.join(root,'progress.json'),JSON.stringify({storage,events:summaries.length,matches:summaries.reduce((sum,entry)=>sum+entry.matches,0),leagueRound:kind==='league'?number:service.state.season.currentRound,cupStage:service.state.cup.stage,elapsedMs:performance.now()-started,rss:process.memoryUsage().rss},null,2));
  }
  const cupOrder=['cup-roundOf16-leg1','cup-roundOf16-leg2','cup-quarterfinals-leg1','cup-quarterfinals-leg2','cup-semifinals-leg1','cup-semifinals-leg2','cup-final-leg1'];
  for(let round=1;round<=14;round++){time=baseAt+(round-1)*20*60000;await run('league',round);if(round<=7){time=baseAt+(round-1)*20*60000+10*60000;await run('cup',cupOrder[round-1]);}}
  const beforeFile=path.join(directory,'before-boundary.json');if(!fs.existsSync(beforeFile))fs.writeFileSync(beforeFile,JSON.stringify(snapshot(service)));
  const before=JSON.parse(fs.readFileSync(beforeFile,'utf8'));assert.equal(before.season.currentRound,14);assert.equal(before.season.status,'completed');assert.equal(before.cup.status,'completed');assert.equal(before.matches.length,141);assert.equal(before.matches.filter(match=>match.competition==='league').length,112);assert.equal(before.matches.filter(match=>match.competition==='cup').length,29);assert.equal(before.seasonFinalTournament,null);
  assert.ok(before.teams.every(team=>team.table.played===14));assert.equal(before.teams.reduce((n,team)=>n+team.table.goalsFor,0),before.matches.filter(match=>match.competition==='league').reduce((n,match)=>n+match.score[0]+match.score[1],0));
  for(const team of before.teams)assert.deepEqual(team.rosterIds,initial.teams.find(prior=>prior.id===team.id).rosterIds);
  if(storage==='shards')expectedBefore=before;else compareBusiness(before,expectedBefore,'before boundary');
  // Reopen and retry all match consumption before reset removes current records.
  if(service.state.season.id===seasonId){
    service=createService(options);const reopened=await openCanonicalLocalStorageSettlement({root:directory,service,createService,sourceCatalog,now});
    const prior=snapshot(service);for(const artifact of artifacts)for(const [index,task] of artifact.record.tasks.entries())assert.equal((await reopened.settleJob(artifact.jobs[index],task.context)).duplicate,true);assert.equal(hash(snapshot(service)),hash(prior));
  }
  const boundary=await openCanonicalLocalStorageSettlement({root:directory,service,createService,now});time=Math.max(baseAt+13*20*60000+5*60000,summaries.at(-1).finishedAt+1000);
  await boundary.finishSeasonBoundary({seasonId,phase:'rewards'});assert.equal((await boundary.finishSeasonBoundary({seasonId,phase:'rewards'})).duplicate,true);
  time=baseAt+86400000-10*60000;await boundary.finishSeasonBoundary({seasonId,phase:'reset'});assert.equal((await boundary.finishSeasonBoundary({seasonId,phase:'reset'})).duplicate,true);
  const after=snapshot(service),archiveSummary=after.archives.find(archive=>archive.season.id===seasonId),archive=service.shardStore?service.shardStore.readFullArchive(archiveSummary):archiveSummary;
  assert.equal(archive.matches.length,141);assert.equal(after.matches.length,0);assert.equal(after.season.currentRound,0);assert.equal(after.rounds.length,14);assert.equal(after.cup.status,'waiting');assert.equal(after.seasonFinalTournament,null);
  assert.equal(after.competitionFormat.movements.filter(movement=>movement.seasonId===seasonId).length,1);assert.equal(after.honorRoom.processedSeasonIds.filter(id=>id===seasonId).length,1);assert.equal(after.ledger.filter(row=>row.type==='daily-season-settlement'&&row.seasonId===seasonId).length,initial.teams.filter(team=>team.ownerId).length);
  if(storage==='shards')expectedAfter={state:after,archive:JSON.parse(JSON.stringify(archive))};else{compareBusiness(after,expectedAfter.state,'after boundary');assert.equal(hash(archive),hash(expectedAfter.archive),'full archived season');}
  const last=createService(options),lastBridge=await openCanonicalLocalStorageSettlement({root:directory,service:last,createService,now});
  for(const phase of ['rewards','reset'])assert.equal((await lastBridge.finishSeasonBoundary({seasonId,phase})).duplicate,true);
  for(const key of ['teams','wallets','ledger','s4Packs','inbox','honorRoom','competitionFormat','season'])assert.equal(hash(last.state[key]),hash(after[key]),'final reopen '+key);
  storages.push({storage,directory,rounds:14,cupEvents:7,matches:141,producedMatches,summaries,reset:true,reopenExactlyOnce:true,elapsedMs:performance.now()-started});
}
assert.equal(hash(snapshot(yellowDogsLeague)),initialHash);const resultName=process.env.V4_SEASON_RESULT_NAME;assert.match(resultName,/^result-\d+\.json$/);
fs.writeFileSync(path.join(root,resultName),JSON.stringify({passed:true,scope:'Original business lifecycle for 112 league and 29 cup full real matches interleaved, original daily rewards/honors/archive/promotion/reset, isolated shard scheduler and fresh JSON replay. No production or capacity claim.',storages,canonicalSingletonUnchanged:true},null,2));
