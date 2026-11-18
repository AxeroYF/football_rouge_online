import test from 'node:test';
import assert from 'node:assert/strict';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {VERSION} from '../versus/v4/world.js';
import {beginScheduledCupEvent,finishScheduledCupEvent,scheduledCupFixtureBinding,scheduledCupField} from '../versus/v4-host/scheduled-cup.js';

const at=1794934800000,createService=options=>new YellowDogsLeagueService(options),pin={engineVersion:VERSION,sourceDigest:'a'.repeat(64)};
function setup(){const service=createService({statePath:null,backupDir:null,now:()=>at,rng:()=>.5});if(service.state.cup.status==='waiting')service.startCup();return service;}
const options=league=>({league,seasonId:league.season.id,eventId:league.cup.events.find(event=>event.status==='pending')?.id,at,createService,catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG,duration:60,enginePin:pin});

test('cup event preparation is pure, locks the current first leg and rejects overlaps or changed schedules',()=>{
  const service=setup(),league=structuredClone(service.state),before=structuredClone(league),request=options(league),started=beginScheduledCupEvent(request);
  assert.deepEqual(league,before);assert.equal(started.event.competition,'cup');assert.equal(started.event.tasks.length,8);assert.equal(started.league[scheduledCupField].active,started.event.key);
  assert.ok(started.event.tasks.every(task=>task.envelope.input.competition.resolution==='draw'&&task.context.competition==='cup'));
  assert.equal(beginScheduledCupEvent({...request,league:started.league}).duplicate,true);
  assert.throws(()=>beginScheduledCupEvent({...request,league:started.league,enginePin:{...pin,sourceDigest:'b'.repeat(64)}}),/锁定/);
  for(const mutate of [state=>state.v4LocalLeagueRounds={active:'league'},state=>state.liveCupRound={},state=>state.liveFriendlies=[{completed:false}],state=>state.rounds[0].status='running']){
    const overlap=structuredClone(league);mutate(overlap);assert.throws(()=>beginScheduledCupEvent({...request,league:overlap}),/重叠/);
  }
  const task=started.event.tasks[0],pinned={fixtureId:task.fixture.id,inputFingerprint:task.envelope.fingerprint,engineVersion:VERSION,sourceDigest:pin.sourceDigest};
  assert.equal(scheduledCupFixtureBinding(started.league,task.context,pinned).fixture,started.league.cup.knockout.roundOf16[0].legs[0]);
  const changed=structuredClone(started.league);changed.cup.knockout.roundOf16.reverse();assert.throws(()=>scheduledCupFixtureBinding(changed,task.context,pinned),/赛程/);
  assert.throws(()=>scheduledCupFixtureBinding(started.league,task.context,{...pinned,sourceDigest:'b'.repeat(64)}),/内核锁定/);
  assert.throws(()=>finishScheduledCupEvent({...request,league:started.league}),/尚未全部/);
});

test('cup second-leg input reverses the first-leg aggregate and pins it against subsequent changes',()=>{
  const service=setup(),event=service.state.cup.events[0];
  for(const fixture of service.cupEventFixtures(event)){fixture.status='complete';fixture.matchId='first-'+fixture.id;fixture.score=[2,1];service.state.matches.push({id:fixture.matchId,competition:'cup',cupStage:event.stage,cupRound:event.round,legNumber:1,homeId:fixture.homeId,awayId:fixture.awayId,score:[2,1]});}
  service.completeCupEvent(event);const league=structuredClone(service.state),request=options(league),started=beginScheduledCupEvent(request);
  assert.equal(started.event.event.leg,2);
  for(const task of started.event.tasks){assert.deepEqual(task.envelope.input.competition,{resolution:'extraTimeAndPenalties',aggregate:[1,2]});}
  const task=started.event.tasks[0],pinned={fixtureId:task.fixture.id,inputFingerprint:task.envelope.fingerprint,engineVersion:VERSION,sourceDigest:pin.sourceDigest};
  started.league.cup.knockout.roundOf16[0].legs[0].score=[1,2];assert.throws(()=>scheduledCupFixtureBinding(started.league,task.context,pinned),/赛程/);
  league.cup.knockout.roundOf16[0].legs[0].status='pending';assert.throws(()=>beginScheduledCupEvent({...request,league}),/首回合/);
});

test('cup final input requires a winner and marks the original final start only after successful compilation',()=>{
  const service=setup();service.state.cup.events=[];service.state.cup.knockout={};service.createKnockoutStage('final',service.state.teams.slice(0,2).map(team=>team.id));service.state.cup.stage='final';
  const league=structuredClone(service.state),request=options(league),started=beginScheduledCupEvent(request);
  assert.equal(started.event.tasks.length,1);assert.equal(started.event.tasks[0].envelope.input.competition.resolution,'extraTimeAndPenalties');assert.equal(started.league.cup.finalStartedAt,at);assert.equal(league.cup.finalStartedAt,null);
  const invalid=structuredClone(league);invalid.cup.knockout.final[0].legs[0].awayId=invalid.cup.knockout.final[0].legs[0].homeId;
  assert.throws(()=>beginScheduledCupEvent({...request,league:invalid}),/重复/);assert.equal(invalid.cup.events[0].status,'pending');assert.equal(invalid.cup.finalStartedAt,null);
});
