import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMovements} from '../versus/public/shape-movement.js';

const player=(id,points)=>({id,name:id,role:'CM',points});
const snapshot=(times,players)=>({scenario:'loss',scoreState:'level',minute:25,engineVersion:'4',opponent:'标准陪练队',times,players});

test('only shared clock samples count, including an out-and-back run with identical endpoints',()=>{
  const old=snapshot([0,1,2,3],[player('A',[[0,0],[0,0],[0,0],[100,100]])]);
  const now=snapshot([0,1,2],[player('A',[[0,0],[0,10],[0,0]])]);
  const {duration,players:[p]}=compareMovements(old,now);
  assert.equal(duration,2);
  assert.equal(p.start.distance,0);
  assert.equal(p.end.distance,0);
  assert.equal(p.peakGap,10.5);
  assert.equal(p.beforeLength,0);
  assert.equal(p.afterLength,21);
  assert.equal(p.previous.length,3);
});

test('displacement uses pitch metres and attack direction, even when players reorder or change',()=>{
  const old=snapshot([0],[player('A',[[40,60]]),player('B',[[50,50]])]);
  const now=snapshot([0],[player('C',[[12,12]]),player('A',[[50,40]])]);
  const {duration,players}=compareMovements(old,now);
  const a=players.find(p=>p.id==='A');
  assert.equal(duration,0);
  assert.ok(Math.abs(a.start.right-6.8)<1e-9);
  assert.equal(a.start.forward,21);
  assert.equal(a.start.distance,Math.hypot(a.start.right,21));
  assert.deepEqual(a.start,a.end);
  assert.equal(players.find(p=>p.id==='B').next,undefined);
  assert.equal(players.find(p=>p.id==='C').start,undefined);
  assert.throws(()=>compareMovements(old,{...now,scoreState:'leading'}),/条件不同/);
  assert.throws(()=>compareMovements(old,{...now,scenario:'attack'}),/条件不同/);
  assert.throws(()=>compareMovements(old,{...now,times:[1]}),/时点/);
});
