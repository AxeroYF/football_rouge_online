import test from 'node:test';
import assert from 'node:assert/strict';
import { featuredLeagueSchedule } from '../shared/config/league-featured.mjs';
import { createLeagueLiveLeg, advanceLeagueLiveLeg, publicLeagueLiveLeg, leagueBroadcastDelta } from '../engine/league-match-engine.mjs';
import { createV22DemoInput } from '../engine/v2.2/demo-fixture.mjs';
import { leagueFixture } from './daily-league-fixture.mjs';
import { leaguePanelMarkup } from '../client/league/daily-league-controller.js';
import { applyV2SpatialFoul, advanceV2PlayerConditions } from '../engine/s4-v2.1/versus/v2/match-engine-v2.js';

const teams=Array.from({length:10},(_,i)=>({id:`t${i}`,name:`球队 ${i}`,kind:i<6?'player':'elite'}));
const make=seed=>{const input=createV22DemoInput(seed);return createLeagueLiveLeg({home:input.teams[0],away:input.teams[1],seed,startedAt:0,legNumber:1,knockout:false},{engine:'v2.2',liveDurationMs:360000});};
const until=(leg,now)=>{for(let i=0;i<200&&!leg.match.finished&&leg.dynamic.state.time<(now-leg.startedAt)/1000;i++)advanceLeagueLiveLeg(leg,now,{maximumChains:1000});};

test('featured schedule: 18 human matches; exactly six and three home/away each, mirrored opponents, daily rotation',()=>{
  const signatures=new Set();
  for(let day=1;day<=30;day++){
    const date=`2026-09-${String(day).padStart(2,'0')}`,fixtures=featuredLeagueSchedule(teams,date),picked=fixtures.filter(f=>f.featured);
    assert.equal(fixtures.length,90);assert.equal(picked.length,18);
    for(let r=1;r<=18;r++)assert.equal(picked.filter(f=>f.round===r).length,1);
    for(const t of teams.slice(0,6)){
      const own=picked.filter(f=>[f.homeId,f.awayId].includes(t.id));assert.equal(own.length,6);assert.equal(own.filter(f=>f.homeId===t.id).length,3);
      assert.equal(new Set(own.map(f=>f.homeId===t.id?f.awayId:f.homeId)).size,3);
    }
    for(const f of picked){assert.ok(teams.slice(0,6).some(t=>t.id===f.homeId));assert.ok(teams.slice(0,6).some(t=>t.id===f.awayId));assert.ok(picked.some(q=>q.homeId===f.awayId&&q.awayId===f.homeId));}
    assert.deepEqual(fixtures,featuredLeagueSchedule([...teams].reverse(),date));
    signatures.add(picked.map(f=>f.homeId+f.awayId).join(','));
  }
  assert.ok(signatures.size>10);
});

test('dynamic authority resumes byte-equivalent after JSON persistence; no future seed or tactics sent to viewers',()=>{
  const leg=make('league-resume');until(leg,83100);
  const copy=JSON.parse(JSON.stringify(leg));
  until(leg,360000);until(copy,360000);
  assert.equal(leg.match.finished,true);assert.equal(leg.match.minute,90);
  assert.deepEqual(copy.dynamic,leg.dynamic);assert.deepEqual(copy.match.events,leg.match.events);assert.deepEqual(copy.match.score,leg.match.score);
  assert.deepEqual(copy.match.teams,leg.match.teams);
  const broadcast=publicLeagueLiveLeg(leg),encoded=JSON.stringify(broadcast);
  assert.equal(broadcast.engine,'v2.2');assert.ok(broadcast.dynamic.frames.length<=61);
  assert.ok(!encoded.includes('simulationSeed'));assert.ok(!encoded.includes('rngState'));assert.ok(!encoded.includes('positionPresets'));
  for(let t=0;t<2;t++)assert.equal(leg.match.teams[t].players.reduce((n,p)=>n+p.matchStats.goals,0),leg.match.score[t]);
  assert.ok(leg.match.teams.some(t=>t.players.some(p=>p.state.fitness<95)));
  assert.equal(publicLeagueLiveLeg(leg),broadcast,'same revision reuses public projection');
});

test('bounded catch-up and 6-minute clock apply to both league engines, old legs retain duration',()=>{
  const leg=make('budget');advanceLeagueLiveLeg(leg,86400000,{maximumChains:1000});assert.ok(leg.dynamic.state.time<=4);
  const input=createV22DemoInput('clock');
  const options={home:input.teams[0],away:input.teams[1],seed:'clock',startedAt:0,knockout:false};
  const regular=createLeagueLiveLeg(options,{engine:'v2.1',liveDurationMs:360000});
  advanceLeagueLiveLeg(regular,120000,{maximumChains:1000});assert.equal(regular.match.finished,false);assert.equal(regular.match.nextChainIndex,60);
});

test('daily service persists selected engine, read-only spectators, independent fitness, settlement and rollback',()=>{
  const t=leagueFixture({ten:true}),{f}=t;t.start();const fixture=t.league.day.fixtures.find(g=>g.featured);
  const originals=JSON.stringify([...f.s.accounts.values()].map(a=>a.draft.roster));
  t.league.begin(fixture,f.now);let leg=t.league.day.live[fixture.id].leg;
  assert.equal(leg.engine,'v2.2');assert.ok(f.s.accounts.get(fixture.homeId).leagueNotices.some(n=>n.dynamic));
  const before=JSON.stringify(leg);for(let i=0;i<20;i++)t.league.watch(f.a,fixture.id,'viewer-12345');assert.equal(JSON.stringify(leg),before);
  f.tick(30000);until(leg,f.now);assert.equal(leg.match.finished,false);
  f.s.persist();f.reload();leg=t.league.day.live[fixture.id].leg;
  f.tick(360000);for(let i=0;i<120&&!leg.match.finished;i++)advanceLeagueLiveLeg(leg,f.now,{maximumChains:1000});
  assert.ok(leg.match.finished);f.fail(true);assert.throws(()=>t.league.settle(t.league.day.fixtures.find(g=>g.id===fixture.id),f.now),/disk failure/);f.fail(false);
  const current=t.league.day.fixtures.find(g=>g.id===fixture.id);t.league.settle(current,f.now);
  const gold=f.a.gold;assert.equal(t.league.settle(current,f.now),false);assert.equal(f.a.gold,gold);
  assert.equal(JSON.stringify([...f.s.accounts.values()].map(a=>a.draft.roster)),originals);
  assert.equal(t.league.snapshot(current.id).battle.broadcasts[0].engine,'v2.2');
});

test('both league schedule and personal TV schedule mark pre-kickoff dynamic fixtures',()=>{
  const view={day:'2026-09-29',ownId:'t0',standings:teams,fixtures:featuredLeagueSchedule(teams,'2026-09-29'),scorers:[],assists:[],rewards:[]};
  assert.equal((leaguePanelMarkup(view,'schedule').match(/title="V2.2 动态引擎比赛"/g)||[]).length,18);
  assert.equal((leaguePanelMarkup(view,'mine',true).match(/title="V2.2 动态引擎比赛"/g)||[]).length,6);
});

test('VAR confirmed and disallowed goals update the very same scorer and assist records used for settlement',()=>{
  for(const offside of [false,true]){
    const leg=make(`var-${offside}`),state=leg.dynamic.state,shooter=state.players.find(p=>p.team===0&&!p.gk),assist=state.players.find(p=>p.team===0&&!p.gk&&p!==shooter);
    state.phase='var';state.reviewAt=.05;
    state.review={team:0,actorId:shooter.sourceId,assistId:assist.sourceId,offence:offside?{team:0,spot:{x:90,y:34},snapshot:{line:90}}:null};
    advanceLeagueLiveLeg(leg,100,{maximumChains:1});
    assert.equal(leg.match.score[0],offside?0:1);
    assert.equal(leg.match.teams[0].players.find(p=>p.id===shooter.sourceId).matchStats.goals,offside?0:1);
    assert.equal(leg.match.teams[0].players.find(p=>p.id===assist.sourceId).matchStats.assists,offside?0:1);
  }
});

test('spatial fouls reuse red-card suspensions, injury substitution and minimum-player abandonment',()=>{
  const leg=make('discipline'),m=leg.match;
  const offender=m.teams[1].players.find(p=>p.assignedRole!=='GK'),actor=m.teams[0].players.find(p=>p.assignedRole!=='GK');
  offender.traits=[];
  applyV2SpatialFoul(m,{attackingTeamIndex:0,defendingTeamIndex:1,independentEvents:[],stages:[{actor,defender:offender,zone:'midfield:center',foul:{occurred:true,card:'red',penalty:false,referee:'standard'}}]});
  assert.equal(offender.active,false);assert.ok(m.postMatchConsequences.suspensions.some(p=>p.playerId===offender.id));
  m.parameters=structuredClone(m.parameters);m.parameters.events.injuryPerChain=1;
  // A full healthy bench makes an arbitrary deterministic injury substitutable.
  for(const team of m.teams){team.players.forEach(p=>p.traits=[]);team.players.push(...team.players.filter(p=>p.active).map(p=>({...structuredClone(p),id:p.id+'-reserve',active:false,startedMatch:false,enteredAsSubstitute:false})));}
  advanceV2PlayerConditions(m,1);assert.ok(m.postMatchConsequences.injuries.length>0);
  assert.ok(m.teams.some(t=>t.players.some(p=>p.enteredAsSubstitute)));
  m.teams[0].players.forEach((p,i)=>{p.active=i<6;});advanceV2PlayerConditions(m,2);
  assert.equal(m.abandoned,true);assert.equal(m.finished,true);
});

test('short-handed match is legal and delta payload omits redundant card faces without losing authoritative state',()=>{
  const input=createV22DemoInput('short');input.teams[0].players=input.teams[0].players.slice(0,8);
  const leg=createLeagueLiveLeg({home:input.teams[0],away:input.teams[1],seed:'short',startedAt:0,knockout:false},{engine:'v2.2'});
  until(leg,20000);assert.ok(!leg.match.finished);assert.equal(leg.dynamic.state.players.filter(p=>p.team===0).length,8);
  const full=publicLeagueLiveLeg(leg),delta=leagueBroadcastDelta(full,360);
  assert.equal(delta.playerPatch,true);assert.ok(delta.dynamic.frames.length<full.dynamic.frames.length);
  assert.equal(delta.teams[0].players[0].card,undefined);assert.ok(full.teams[0].players[0].card);
  assert.deepEqual(delta.score,full.score);assert.ok(JSON.stringify(delta).length<JSON.stringify(full).length*.8);
  assert.equal(leagueBroadcastDelta(full,999999),full,'invalid or ahead cursor gets a full resync');
});
