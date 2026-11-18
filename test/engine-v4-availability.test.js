import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,awardRestart,injurePlayer,penalizeFoul,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {applyPassiveExit} from '../versus/v4/availability.js';
import {playerByKey} from '../versus/v4/world.js';

function fixture(benchRoles=['GK','CM','CB']){
  const input=demoInput({duration:30});for(const team of input.teams)team.bench=benchRoles.map((role,index)=>{
    const p=structuredClone(team.players.find(p=>p.role===role));return {...p,id:`b${index}`,number:12+index,name:`替补${index}`,fitness:90};});
  return createMatch(input);
}
const count=(s,side)=>s.players.filter(p=>p.side===side&&p.active).length;
function stop(m){awardRestart(m,'directFreeKick',0,{x:60,y:34},'专项死球');}
function dismiss(m,player){const carrier=playerByKey(m.state,`${1-player.side}:p10`);penalizeFoul(m,player,carrier,{penalty:false,dogso:true,speed:0,behind:false},{card:'red',severity:'careless'});}

test('injury replaces the same position with an eligible bench player, inherits the slot and is idempotent',()=>{
  const m=fixture(),s=m.state,out=playerByKey(s,'0:p7');stop(m);const result=injurePlayer(m,out);
  assert.equal(result.status,'substituted');assert.equal(result.incoming,'0:b1');assert.equal(count(s,0),11);
  assert.deepEqual(playerByKey(s,'0:b1').anchor,out.anchor);assert.equal(out.status,'injured');assert.equal(s.stats[0].substitutions,1);
  assert.equal(injurePlayer(m,out).status,'ignored');assert.equal(s.stats[0].substitutions,1);assert.equal(count(s,1),11);
  const resumed=restoreCheckpoint(exportCheckpoint(m));advanceMatch(m,100);advanceMatch(resumed,100);assert.deepEqual(m,resumed);
});

test('keeper red sacrifices an outfielder for a bench keeper and leaves ten players; outfield red cannot be replaced',()=>{
  const m=fixture(),s=m.state;dismiss(m,playerByKey(s,'0:p1'));
  assert.equal(count(s,0),10);assert.equal(count(s,1),11);assert.equal(s.stats[0].substitutions,1);assert.equal(playerByKey(s,'0:b0').active,true);
  assert.equal(s.players.filter(p=>p.side===0&&p.role==='CB'&&p.active).length,2);
  const red=fixture();dismiss(red,playerByKey(red.state,'0:p3'));assert.equal(count(red.state,0),10);assert.equal(red.state.stats[0].substitutions,0);
});

test('unavailable bench keeper uses an on-field emergency keeper without adding a player or consuming a slot',()=>{
  const m=fixture(['CM']),s=m.state;dismiss(m,playerByKey(s,'0:p1'));
  assert.equal(count(s,0),10);assert.equal(s.stats[0].substitutions,0);
  const emergency=s.players.find(p=>p.side===0&&p.active&&p.role==='GK');assert.ok(emergency);assert.deepEqual(emergency.anchor,s.input.teams[0].players[0].anchor);
  assert.ok(m.events.some(e=>e.type==='emergencyKeeper'));
});

test('low fitness, exhausted allowance and position mismatch leave injury exits short-handed',()=>{
  for(const mode of ['lowFitness','limit','noPositionMatch']){
    const m=fixture(mode==='noPositionMatch'?['GK']:['CM']),s=m.state;stop(m);
    if(mode==='lowFitness')playerByKey(s,'0:b0').fitness=44;
    if(mode==='limit')s.stats[0].substitutions=5;
    const result=injurePlayer(m,playerByKey(s,'0:p7'));assert.equal(result.status,'shortHanded');assert.equal(result.failure,mode);assert.equal(count(s,0),10);
  }
});

test('healthy tired or booked players cannot trigger the passive exit path; bench identities cannot duplicate starters',()=>{
  const m=fixture(),p=playerByKey(m.state,'0:p7');p.fitness=10;p.yellowCards=1;
  assert.equal(applyPassiveExit(m.state,p,'fatigue').status,'ignored');assert.equal(applyPassiveExit(m.state,p,'injury').status,'ignored');assert.equal(m.state.stats[0].substitutions,0);
  assert.throws(()=>injurePlayer(m,p),/死球/);
  const input=demoInput();input.teams[0].bench=[structuredClone(input.teams[0].players[0])];assert.throws(()=>createMatch(input),/替补/);
});
