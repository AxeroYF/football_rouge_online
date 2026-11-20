import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {createMatch,advanceMatch,restoreCheckpoint,exportCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {cupConditions,fixtureConditions,matchIncidentRules,matchEnvironment} from '../versus/match-conditions.js';
import {controlProfile} from '../versus/v4/ball-control.js';
import {publicLiveV4Match} from '../versus/v4-adapter/live-match.js';
import {publicEvent} from '../versus/v4-stream/codec.js';
import {createMatchMetrics} from '../versus/v4-host/match-metrics.js';

test('weather changes execution, first touch and the cost of the same run',()=>{
  function sample(weather){
    const input=demoInput({seed:'weather-effects',duration:120,format:'full'});
    input.environment=matchEnvironment(weather);
    const match=createMatch(input),s=match.state;
    const player=s.players.find(p=>p.role==='CB');
    const openingSkill=match.events.find(e=>e.type==='pass').execution.skill;
    const control=controlProfile(s,player,{...s.ball,vx:15,vy:0});
    const before=s.players.map(p=>p.fitness);
    advanceMatch(match);
    return {openingSkill,control:control.probability,drain:s.players.reduce((sum,p,i)=>sum+before[i]-p.fitness,0)};
  }
  const sunny=sample('sunny'),rain=sample('rain');
  assert.ok(rain.openingSkill<sunny.openingSkill);
  assert.ok(rain.control<sunny.control);
  assert.ok(sunny.drain>0&&rain.drain>sunny.drain);
});

test('cup knockout fixtures exclude superstorms on both legs using the same forecast seed',()=>{
  const fixture={homeId:'home',awayId:'away'};
  let sampled=false;
  for(let i=0;i<500;i++){
    const season='cup-weather-'+i;
    if(fixtureConditions(season,fixture,1).weather.key!=='superStorm')continue;
    for(const leg of [1,2]){
      assert.notEqual(cupConditions(season,fixture,{stage:'roundOf16',leg,round:1}).weather.key,'superStorm');
    }
    sampled=true;
    break;
  }
  assert.ok(sampled);
});

test('scheduled friendly keeps its forecast through lightning, early full time and saved history',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'v4-friendly-weather-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let clock=Date.parse('2026-11-19T12:00:00+08:00');
  const options={statePath:path.join(dir,'league.json'),backupDir:null,now:()=>clock,rng:()=>.5};
  const service=new YellowDogsLeagueService(options);
  service.actualMatchEngine='v4';
  service.state.season.id='v4-qa';
  const [home,away]=service.state.teams;
  const fixture={id:'friendly-131',homeId:home.id,awayId:away.id,startsAt:clock,status:'scheduled'};
  service.state.friendlyFixtures.push(fixture);
  const forecast=service.teamSchedule(home.id).find(f=>f.competition==='friendly').weather;
  assert.equal(forecast.key,'superStorm');
  assert.equal(service.startScheduledFriendlies(clock),true);
  const live=service.state.liveFriendlies[0];
  assert.deepEqual(publicLiveV4Match(live.match,clock,null,false).weather,forecast);
  clock+=600000;
  service.advanceLiveFriendlies(clock,{persist:false});
  await service.flushLiveSettlementJobs();
  assert.equal(service.state.matches.at(-1)?.competition,'friendly');
  await t.waitFor(()=>assert.equal(service.pendingLiveCheckpointCleanup.size,0),{timeout:10000});
  const saved=new YellowDogsLeagueService(options);
  const record=saved.state.matches.find(m=>m.competition==='friendly');
  assert.deepEqual(record.report.weather,forecast);
  const events=record.report.importantEvents;
  assert.equal(events.filter(e=>e.type==='lightning').length,1);
  assert.equal(events.filter(e=>e.type==='abandoned').length,1);
  assert.ok(record.report.teams.some(team=>team.players.some(p=>p.injury?.injuryRounds===2)));
  assert.equal(record.report.stoppedAtMinute,88);
  assert.deepEqual(record.score,record.report.regulationScore);
});

test('eligible brawl and disputed penalty affect play once across a checkpoint',()=>{
  const input=demoInput({duration:180,format:'full',seed:'discipline'});
  input.environment=matchEnvironment('rain','strict');
  input.matchIncidents={...matchIncidentRules,blackWhistle:1,brawl:{...matchIncidentRules.brawl,
    minimumMinute:1,maximumMinute:1,basePerEligibleMatch:1,refereeMultiplier:{strict:1}}};
  input.teams[0].players[0].nationality='Argentina';
  const match=createMatch(input,{recording:false});
  advanceMatch(match,2);
  const resumed=restoreCheckpoint(exportCheckpoint(match));
  for(const m of [match,resumed])while(m.state.phase!=='finished')advanceMatch(m,200);
  assert.deepEqual(resumed.events,match.events);
  assert.deepEqual(resumed.state.result,match.state.result);
  for(const type of ['brawl','blackWhistle'])assert.equal(match.events.filter(e=>e.type===type).length,1);
  assert.ok(match.events.filter(e=>e.type==='redCard').length>=3);
  assert.ok(match.events.some(e=>e.type==='stoppage'&&e.restartType==='penalty'&&e.side===0));
});

// Isolate one scoring chance. Keep the real contact model and incident probabilities.
for(const [kind,seed,expected] of [
  ['butterFingers','case-18',[1,0]],
  ['superWorldie','case-35',[1,0]],
  ['backpass','case-0',[0,1]],
]){
  test(kind+' reaches the goal line and publishes exactly one replayable goal',()=>{
    const input=demoInput({duration:120,format:'full',seed});
    input.environment=matchEnvironment('rain');
    input.matchIncidents=matchIncidentRules;
    if(kind==='superWorldie')input.teams[0].instructions={chanceCreation:'shootOnSight',longShots:'increase'};
    const match=createMatch(input),state=match.state;
    const striker=state.players.find(p=>p.side===0&&p.role==='ST');
    const keeper=state.players.find(p=>p.side===1&&p.role==='GK');
    state.rules={offside:null,restartTouch:null};
    for(const p of state.players)Object.assign(p,{x:25+p.number,y:p.side===0?6:60,vx:0,vy:0});
    let actor=striker;
    if(kind==='butterFingers'){
      Object.assign(keeper,{x:103,y:34,fitness:35,facing:Math.PI});
      state.ball={mode:'flight',holder:null,x:99,y:34,z:0,vx:20,vy:0,flight:{kind:'shot',side:0,from:striker.key,
        to:null,start:{x:99,y:34},target:{x:105,y:34},startedAt:0,endsAt:.3,decisionId:1}};
    }else{
      if(kind==='backpass'){
        actor=state.players.find(p=>p.side===0&&p.role==='CB');
        state.incidents.backpass=true;
        actor.fitness=40;
        actor.attributes.composure=35;
      }else{
        Object.assign(state.players.find(p=>p.side===1&&p.role==='CB'),{x:80,y:34});
      }
      Object.assign(actor,{x:kind==='backpass'?9:82,y:34,nextDecision:0});
      actor.attributes.longShots=99;
      actor.attributes.finishing=99;
      state.ball={mode:'held',holder:actor.key,x:actor.x,y:actor.y,z:0,vx:0,vy:0,flight:null};
    }
    advanceMatch(match,25);
    assert.deepEqual(state.score,expected);
    const metrics=createMatchMetrics();
    metrics.consume(match.events.map(e=>publicEvent(e)).filter(Boolean));
    const goals=metrics.view().events.filter(e=>e.type==='goal');
    assert.equal(goals.length,1);
    assert.equal(goals[0].special,kind);
    assert.equal(goals[0].actorId,actor.id);
    assert.equal(goals[0].ownGoal,kind==='backpass');
    assert.ok(match.frames.some(f=>Math.abs(f.time-goals[0].replayTime)<.001));
  });
}
