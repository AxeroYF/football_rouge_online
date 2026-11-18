import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,simulateMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {resolutionAfterPeriod,createShootout,recordShootoutKick} from '../versus/v4/competition.js';
import {coordinates} from '../versus/v4/world.js';

function input(resolution='penalties'){
  const value=demoInput({duration:60,format:'full',seed:'competition-proof'});value.competition={resolution};return value;
}
test('aggregate score and competition policy determine whether a tied leg continues',()=>{
  const config=input('extraTimeAndPenalties');config.competition.aggregate=[2,0];const s=createMatch(config).state;s.clock.period=2;s.score=[0,1];
  assert.deepEqual(resolutionAfterPeriod(s),{finish:true,winner:0,method:'regulation'});
  s.score=[0,2];assert.deepEqual(resolutionAfterPeriod(s),{nextPeriod:3});s.clock.period=4;assert.deepEqual(resolutionAfterPeriod(s),{shootout:true});
  const clip=demoInput();clip.competition={resolution:'penalties'};assert.throws(()=>createMatch(clip),/完整比赛/);
});

test('extra time uses two additional halves, preserves discipline and changes ends',()=>{
  const m=simulateMatch(input('extraTimeAndPenalties'));
  assert.equal(m.state.clock.completed.length,4);assert.equal(m.state.result.method,'penalties');
  const changes=m.events.filter(e=>e.type==='endsChanged');assert.equal(changes.length,3);assert.equal(changes[1].attackDirections[0],-changes[2].attackDirections[0]);
  for(const flip of [0,1]){const s=createMatch(input('extraTimeAndPenalties')).state;s.clock.extraEndsSwap=flip;s.clock.period=3;const third=coordinates(s).direction(0);s.clock.period=4;assert.equal(coordinates(s).direction(0),-third);}
});

test('shootout early victory, equal-number sudden death and cycling every eligible kicker are deterministic',()=>{
  const make=()=>({active:true,eligible:[['a','b'],['c','d']],score:[0,0],taken:[0,0],kicks:[],turn:0,current:null});
  const kick=(s,goal)=>recordShootoutKick(s,{side:s.turn,kicker:s.eligible[s.turn][s.taken[s.turn]%2],goal,time:s.kicks.length,reason:'fixture'});
  const early=make();for(let i=0;i<6;i++)kick(early,i%2===0);assert.equal(early.winner,0);assert.deepEqual(early.taken,[3,3]);
  const sudden=make();for(let i=0;i<10;i++)kick(sudden,true);assert.equal(sudden.active,true);kick(sudden,true);assert.equal(sudden.active,true);kick(sudden,false);assert.equal(sudden.winner,0);
  assert.deepEqual(sudden.kicks.filter(k=>k.side===0).slice(0,4).map(k=>k.kicker),['a','b','a','b']);
});

test('eligible numbers equalize after a red card and retain a goalkeeper on each side',()=>{
  const s=createMatch(input()).state;s.players.find(p=>p.key==='0:p3').active=false;const shootout=createShootout(s);
  assert.deepEqual(shootout.eligible.map(keys=>keys.length),[10,10]);
  for(const side of [0,1])assert.ok(shootout.eligible[side].includes(`${side}:p1`));
});

test('shootout shots use one physical goal, retain the regular score/stats, and resume during a kick exactly',()=>{
  const a=createMatch(input());while(!a.state.shootout?.current)advanceMatch(a);
  const b=restoreCheckpoint(exportCheckpoint(a)),score=[...a.state.score],stats=structuredClone(a.state.shootout.current.statsBefore);
  while(a.state.phase!=='finished')advanceMatch(a,100);while(b.state.phase!=='finished')advanceMatch(b,100);
  assert.deepEqual(a,b);assert.deepEqual(a.state.score,score);assert.deepEqual(a.state.stats,stats);
  assert.ok(a.events.filter(e=>e.type==='shootoutShot').every(e=>e.target.x===a.state.shootout.goalX));
  assert.ok([0,1].includes(a.state.result.winner));
  const start=a.events.find(e=>e.type==='shootoutStart');assert.ok(a.events.filter(e=>e.time>=start.time).every(e=>e.clock.elapsed===start.clock.elapsed));
});

test('checkpoint restore rejects corrupted shootout eligibility and counts',()=>{
  const m=createMatch(input());while(!m.state.shootout?.current)advanceMatch(m);
  for(const corrupt of [s=>s.shootout.eligible[0].push(s.shootout.eligible[0][0]),s=>s.shootout.score[0]=100,s=>s.shootout.current.keeper='0:missing']){
    const checkpoint=JSON.parse(exportCheckpoint(m));corrupt(checkpoint.state);assert.throws(()=>restoreCheckpoint(checkpoint),/点球/);
  }
});
