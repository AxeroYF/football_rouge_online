import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {VERSION} from '../versus/v4/world.js';
import {encodeFrames,decodeFrames,publicFrame,publicEvent} from '../versus/v4-stream/codec.js';
import {createPublisher,createViewer} from '../versus/v4-stream/publisher.js';

const recording=simulateMatch(demoInput({duration:60,seed:'stream-contract'}));
const identity={matchId:'isolated-test',engineVersion:VERSION};
test('publication does not jump over an unreleased event with a floating-point boundary inversion',()=>{
  const source={frames:recording.frames,events:[{id:1,time:9,type:'foul',side:0},{id:2,time:10+Number.EPSILON*10,type:'injury',side:0},{id:3,time:10,type:'substitution',side:0}]};
  const publisher=createPublisher(source,{...identity,ownerSide:0}),viewer=createViewer({...identity,ownerSide:0});publisher.publishUntil(10);
  viewer.accept(publisher.read(viewer.cursor));assert.deepEqual(viewer.events.map(e=>e.id),[1]);assert.equal(viewer.cursor.event,1);
  publisher.publishUntil(11);viewer.accept(publisher.read(viewer.cursor));assert.deepEqual(viewer.events.map(e=>e.id),[1,2,3]);
});

test('independent keyframe/delta packets round-trip presentation frames without mutating simulation',()=>{
  const before=JSON.stringify(recording),frames=recording.frames.map(f=>publicFrame(f,0));
  const encoded=encodeFrames(frames),decoded=decodeFrames(JSON.parse(JSON.stringify(encoded)));
  assert.deepEqual(decoded,frames);assert.equal(JSON.stringify(recording),before);
  for(let i=0;i<frames.length;i++)for(let j=0;j<22;j++){
    assert.ok(Math.abs(frames[i].players[j].x-recording.frames[i].players[j].x)<=.005001);
    assert.ok(Math.abs(frames[i].players[j].y-recording.frames[i].players[j].y)<=.005001);
  }
});

test('viewer speeds and request cursors cannot publish future scores, events or frames',()=>{
  const publisher=createPublisher(recording,identity);publisher.publishUntil(10);
  const viewer=createViewer(identity);let previous='';
  while(JSON.stringify(viewer.cursor)!==previous){previous=JSON.stringify(viewer.cursor);viewer.accept(publisher.read(viewer.cursor,{maxFrames:8,maxEvents:12}));}
  assert.ok(viewer.frames.every(f=>f.time<=10));assert.ok(viewer.events.every(e=>e.time<=10));assert.equal(viewer.complete,false);
  assert.throws(()=>publisher.read({frame:recording.frames.length-1,event:0}),/尚未发布/);
  assert.throws(()=>publisher.publishUntil(9),/倒退/);assert.throws(()=>publisher.publishUntil(61),/超前/);
  // Caller playback knobs are not interpreted by this server-owned publication API.
  const packet=publisher.read(viewer.cursor,{speed:64,until:60});assert.equal(packet.publishedThrough,10);
});

test('reconnect and retry reconstruct all released frames with no duplicates and reject wrong version/gaps',()=>{
  const publisher=createPublisher(recording,identity),viewer=createViewer(identity);publisher.publishUntil(60);
  const first=publisher.read(viewer.cursor,{maxFrames:13,maxEvents:20});viewer.accept(first);assert.equal(viewer.accept(first),false);
  const second=publisher.read(viewer.cursor,{maxFrames:13,maxEvents:20});
  const wrong=structuredClone(second);wrong.engineVersion='other';assert.throws(()=>viewer.accept(wrong),/版本/);
  const gap=structuredClone(second);gap.from.frame++;assert.throws(()=>viewer.accept(gap),/缺口/);
  let calls=0;while(!viewer.complete){viewer.accept(publisher.read(viewer.cursor,{maxFrames:13,maxEvents:20}));assert.ok(++calls<200);}
  assert.deepEqual(viewer.frames,recording.frames.map(f=>publicFrame(f)));
  assert.deepEqual(viewer.events,recording.events.map(e=>publicEvent(e)).filter(Boolean));
});

test('spectators and opposing owners cannot retrieve private tasks, plan choices or RNG state',()=>{
  for(const ownerSide of [null,0,1]){
    const publisher=createPublisher(recording,{...identity,ownerSide});publisher.publishUntil(60);const packet=publisher.read(undefined,{maxFrames:2048,maxEvents:2048});
    const decoded=decodeFrames(packet.frames);
    for(const f of decoded)for(const p of f.players)assert.equal(Object.hasOwn(p,'task'),p.side===ownerSide);
    for(const e of packet.events)if(ownerSide===null||e.side!==ownerSide){assert.equal(Object.hasOwn(e,'decision'),false);assert.equal(Object.hasOwn(e,'plan'),false);assert.notEqual(e.type,'tacticalPlanChanged');}
    assert.equal(JSON.stringify(packet).includes('random'),false);assert.equal(JSON.stringify(packet).includes('scorePlans'),false);
  }
});

test('decoder rejects hostile paths and corrupt keyframe/delta sequences',()=>{
  assert.throws(()=>decodeFrames({first:{},paths:[['__proto__','polluted']],deltas:[[0,true]]}),/路径/);
  assert.throws(()=>decodeFrames({first:{},paths:[['missing','x']],deltas:[[0,true]]}),/父节点/);
  assert.throws(()=>decodeFrames({first:{},paths:[],deltas:[[2,true]]}),/索引/);
  assert.equal({}.polluted,undefined);
});
