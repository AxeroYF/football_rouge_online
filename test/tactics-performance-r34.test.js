import test from 'node:test';import assert from 'node:assert/strict';import {coalitionFixture} from './coalition-fixture.mjs';
test('compact tactics save persists without full state; legacy supported',()=>{
 const {s,a}=coalitionFixture();let saves=0,states=0;s.save=()=>saves++;s.state=()=>{states++;return {legacy:true};};
 const result=s.saveTactics(a,a.tactics,{compact:true});assert.equal(saves,1);assert.equal(states,0);assert.deepEqual(Object.keys(result),['tactics','playerSquads']);assert.equal(result.tactics,a.tactics);
 assert.deepEqual(s.saveTactics(a,a.tactics),{legacy:true});assert.equal(states,1);
});
test('failed durable tactics save restores previous assignments and tactics',()=>{
 const {s,a}=coalitionFixture(),tactics=a.tactics,squads=a.playerSquads;s.save=()=>{throw Error('disk failure');};assert.throws(()=>s.saveTactics(a,a.tactics,{compact:true}),/disk failure/);assert.equal(a.tactics,tactics);assert.equal(a.playerSquads,squads);
});
