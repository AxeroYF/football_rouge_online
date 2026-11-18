import test from 'node:test';
import assert from 'node:assert/strict';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {createLiveV4Match,advanceLiveV4Match,publicLiveV4Match,adjustLiveV4Tactics} from '../versus/v4-adapter/live-match.js';
import {requestTacticalPause,resumeVersusMatch} from '../versus/match-engine.js';
import {runMirrorBatchWorkerMatch} from '../versus/mirror-batch-worker-protocol.js';
import {VersusRoomService} from '../versus/room-service.js';

function setup(){
  const service=new YellowDogsLeagueService({statePath:null,now:()=>1000});
  service.actualMatchEngine='v4';
  const fixture=service.state.rounds[0].fixtures[0];
  const prepared=service.prepareFixtureMatch(fixture,1,1000,{competitionMode:'friendly'});
  return {service,fixture,...prepared};
}

test('friendly and final fixture selection uses V4, betting sample still uses V1',async()=>{
  const {service,fixture}=setup();
  const friendly={...fixture,id:'friendly',startsAt:1000,status:'scheduled'};
  service.state.friendlyFixtures.push(friendly);
  service.startScheduledFriendlies(1000);
  const live=service.state.liveFriendlies[0];
  assert.equal(live.match.version,4);
  service.advanceLiveFriendlies(1000000,{persist:false});
  await service.flushLiveSettlementJobs();
  assert.equal(service.state.matches[0].report.schema,'v4-legacy-player-report-1');
  const final=service.createFixtureMatch(fixture,1,1000,{competitionMode:'cup',availabilityMode:'season-final',aggregateBaseScore:[1,2],regulationOnly:false});
  assert.equal(final.match.spatial.state.input.competition.resolution,'extraTimeAndPenalties');
  assert.deepEqual(final.match.aggregateBaseScore,[1,2]);
  assert.equal(service.createFixtureMatch(fixture,1,1000,{matchEngine:'v1',recordEvents:false}).match.version,1);
});

test('two drafted accounts play a V4 room to a recorded career result',()=>{
  let now=1000;
  const rooms=new VersusRoomService({rng:()=>.23,now:()=>now,accountsPath:null});
  rooms.actualMatchEngine='v4';
  const a=rooms.bindAccount('v4_host',null,'主队'),b=rooms.bindAccount('v4_guest',null,'客队');
  rooms.create('主队','V4ROOM','v4_host',a.accountToken);rooms.join('V4ROOM','客队','v4_guest',b.accountToken);
  const room=rooms.getRoom('V4ROOM');
  room.players.forEach(seat=>rooms.autoCompleteDraft(room,seat));
  rooms.beginTactics(room);rooms.beginMatch(room,now);
  assert.equal(room.match.version,4);
  assert.equal(rooms.broadcasts()[0].minute,0);
  now+=600000;
  for(let poll=0;poll<200&&room.phase==='match';poll++)rooms.getRoom('V4ROOM');
  assert.equal(room.phase,'report');
  assert.equal(room.match.report.schema,'v4-legacy-player-report-1');
  assert.equal(rooms.accounts.get('v4_host').summary.played,1);
});

test('AI training produces a V4 report from the account lineup',()=>{
  let time=1000;
  const service=new YellowDogsLeagueService({statePath:null,now:()=>time,rng:()=>.37});
  service.actualMatchEngine='v4';
  const owner={id:'v4-training',nickname:'教练'};
  service.beginDraft(owner,'训练队');service.autoDraft(owner);service.finishDraft(owner);
  const created=service.createAiTraining(owner,{formation:'4-3-3',averageOverall:82});
  const live=service.liveAiTrainings.get(created.broadcast.code);
  assert.equal(created.broadcast.match.version,4);
  time+=300000;
  service.advanceAiTrainings(time,{maximumChainsPerMatch:Infinity});
  assert.match(live.match.report.engineVersion,/^4\./);
});

test('interactive V4 match keeps score, next tick and report across JSON reload and tactical pause',()=>{
  const {seats,matchOptions}=setup();
  const match=createLiveV4Match(seats,{...matchOptions,duration:120});
  advanceLiveV4Match(match,1500);
  const before=match.nextChainIndex;
  requestTacticalPause(match,0,1500,advanceLiveV4Match);
  adjustLiveV4Tactics(match,0,{tactic:'positive',style:'wingPlay',positions:match.teams[0].positions});
  advanceLiveV4Match(match,2000);
  assert.equal(match.nextChainIndex,before);
  resumeVersusMatch(match,0,2200);resumeVersusMatch(match,1,2200);
  const reopened=JSON.parse(JSON.stringify(match));
  for(const m of [match,reopened])advanceLiveV4Match(m,100000);
  assert.deepEqual(reopened.report,match.report);
  assert.equal(match.report.tacticalChanges.length,1);
  assert.equal(publicLiveV4Match(match,100000,0,false).teams[1].style,null);
});

test('director worker plays its fixture on the advertised V4 kernel',()=>{
  const {seats}=setup();
  const row=runMirrorBatchWorkerMatch({callerSeat:seats[0],opponentSeat:seats[1]},{seed:'director-v4',number:1});
  assert.match(row.report.engineVersion,/^4\./);
  assert.ok(row.report.teams.every(t=>t.players.length>=11));
});

test('local mirror worker resumes its V4 fixture and matches the director result for the same seeds',()=>{
  const {service,seats}=setup();
  service.state.season.status='completed';
  const job={id:'mirror-v4',status:'queued',totalMatches:10,results:[],callerSeat:seats[0],opponentSeat:seats[1]};
  service.state.mirrorMarketplace.batchJobs.push(job);
  service.advanceMirrorBatchSimulations(1,{maximumChainsPerMatch:1});
  assert.equal(job.activeMatch.version,4);
  job.activeMatch=JSON.parse(JSON.stringify(job.activeMatch));
  service.advanceMirrorBatchSimulations(1,{maximumChainsPerMatch:Infinity});
  const fromDirector=runMirrorBatchWorkerMatch(job,{seed:service.mirrorBatchMatchSeed(job,1),number:1});
  assert.deepEqual(job.results[0],service.mirrorBatchMatchResult(fromDirector,1));
});
