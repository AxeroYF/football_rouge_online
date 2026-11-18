import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {coordinates,playerByKey} from '../versus/v4/world.js';
import {shotOpportunity,decisionTrace} from '../versus/v4/opportunity.js';
import {actionCandidates} from '../versus/v4/tasks.js';
import {shotDiagnostics,mergeShotDiagnostics} from '../versus/v4/diagnostics.js';

function chance(period=1,side=0){
  const m=createMatch(demoInput({duration:30})),s=m.state;s.clock.period=period;
  const {worldPoint}=coordinates(s);for(const p of s.players)Object.assign(p,worldPoint({x:35,y:4+p.number},side),{vx:0,vy:0});
  const carrier=playerByKey(s,`${side}:p10`);Object.assign(carrier,worldPoint({x:87,y:34},side));
  Object.assign(playerByKey(s,`${1-side}:p1`),worldPoint({x:100,y:34},side));
  s.ball={mode:'held',holder:carrier.key,...worldPoint({x:87,y:34},side),z:0,vx:0,vy:0,flight:null};s.rules={offside:null,restartTouch:null};
  return {m,s,carrier,worldPoint};
}
test('shot evidence mirrors with teams and ends without changing geometric value',()=>{
  const first=chance(),expected=shotOpportunity(first.s,first.carrier);
  for(const period of [1,2])for(const side of [0,1]){
    const {s,carrier}=chance(period,side),shot=shotOpportunity(s,carrier);
    assert.ok(Math.abs(shot.utility-expected.utility)<1e-9);assert.equal(shot.evidence.angleDegrees,expected.evidence.angleDegrees);
    assert.deepEqual(coordinates(s).localPoint(shot.target,side),coordinates(first.s).localPoint(expected.target,0));
  }
});
test('narrow angle, longer range, pressure and blocked lanes each reduce shot value',()=>{
  const {s,carrier,worldPoint}=chance(),open=shotOpportunity(s,carrier);
  carrier.y=52;assert.ok(shotOpportunity(s,carrier).utility<open.utility);carrier.y=34;carrier.x=75;
  assert.ok(shotOpportunity(s,carrier).utility<open.utility);carrier.x=87;
  Object.assign(playerByKey(s,'1:p2'),worldPoint({x:86,y:34},0));assert.ok(shotOpportunity(s,carrier).utility<open.utility);
  playerByKey(s,'1:p2').x=35;
  for(const [key,y] of [['1:p3',32.8],['1:p4',34],['1:p5',35.2]])Object.assign(playerByKey(s,key),{x:94,y});
  const blocked=shotOpportunity(s,carrier);assert.ok(blocked.evidence.blockers.length);assert.ok(blocked.utility<open.utility);
  for(const p of s.players.filter(p=>['1:p3','1:p4','1:p5'].includes(p.key)))p.active=false;
  assert.equal(shotOpportunity(s,carrier).evidence.blockers.length,0);
});
test('goalkeeper position changes the chosen aiming lane, not a precomputed goal',()=>{
  const {s,carrier}=chance(),keeper=playerByKey(s,'1:p1');keeper.x=104;keeper.y=31;
  const lower=shotOpportunity(s,carrier);keeper.y=37;const upper=shotOpportunity(s,carrier);
  assert.ok(lower.target.y>upper.target.y);assert.equal(lower.evidence.keeper,keeper.key);
  assert.ok(!Object.hasOwn(lower,'goal'));assert.ok(!Object.hasOwn(lower,'xG'));
  keeper.x=100;keeper.y=34;assert.ok(shotOpportunity(s,carrier).evidence.keeperCoverage>0,'coverage is measured along the flight before the goal line');
});
test('a blocked finish can lose to a real supporting pass; explanation preserves the rejected shot',()=>{
  const {s,carrier}=chance();
  Object.assign(playerByKey(s,'0:p8'),{x:78,y:44});
  for(const [key,y] of [['1:p3',32.8],['1:p4',34],['1:p5',35.2]])Object.assign(playerByKey(s,key),{x:94,y});
  Object.assign(playerByKey(s,'1:p2'),{x:87.9,y:34});
  const candidates=actionCandidates(s,carrier);assert.equal(candidates[0].type,'pass');
  const trace=decisionTrace(candidates[0],candidates);assert.equal(trace.selected,'pass');assert.ok(trace.candidates.some(c=>c.type==='shot'&&c.opportunity.blockers.length));
  assert.ok(trace.comparison);assert.ok(candidates.some(c=>c.intent==='layoff'));
});
test('shot classification follows first physical flight resolution and separates blocked shots from saves',()=>{
  const shot=(id,y=34)=>({id,type:'shot',side:0,target:{x:105,y},position:{x:90,y:34},execution:{distance:15,pressureDistance:4},clock:{period:1}});
  const rows=[shot(1),{type:'deflection',decisionId:1}, {type:'goal',decisionId:1},shot(2),{type:'save',decisionId:2},shot(3,40),{type:'out',decisionId:3},shot(4),{type:'goal',decisionId:4},shot(5,40),{type:'save',decisionId:5}];
  const d=shotDiagnostics(rows);assert.equal(d.total.shots,5);assert.equal(d.total.onTarget,2);assert.equal(d.total.blocked,1);assert.equal(d.total.goals,1);
  assert.equal(d.total.aimInsideMouth,3);assert.equal(mergeShotDiagnostics([d,d]).total.shots,10);
});
test('opportunity evaluation and diagnostics consume no RNG and mutate no world or events',()=>{
  const {m,s,carrier}=chance(),before=exportCheckpoint(m);
  for(let i=0;i<5;i++){shotOpportunity(s,carrier);actionCandidates(s,carrier);shotDiagnostics(m.events);}
  assert.equal(exportCheckpoint(m),before);
});
test('chosen shot stores geometry and alternatives and survives checkpoint continuation',()=>{
  const {m,s,carrier}=chance();carrier.x=98;carrier.nextDecision=0;s.ball.x=98;
  playerByKey(s,'1:p1').y=45;advanceMatch(m);
  const e=m.events.findLast(e=>e.type==='shot');assert.ok(e?.opportunity);assert.ok(e.decision.alternative);
  assert.ok(e.execution.errorRange>0);assert.equal(e.actorRole,'ST');
  const b=restoreCheckpoint(exportCheckpoint(m));advanceMatch(m,200);advanceMatch(b,200);assert.deepEqual(m,b);
});
