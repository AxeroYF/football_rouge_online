import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {verticalAt,launchVertical,sweptAerialContact,goalFrameContact,frameRebound,aerialReach} from '../versus/v4/aerial.js';
import {playerByKey} from '../versus/v4/world.js';
import {sampleReplay} from '../versus/v4/replay.js';

function clearMatch(){
  const m=createMatch(demoInput({duration:20})),s=m.state;s.rules={offside:null,restartTouch:null};s.coordination=[{},{}];s.pendingPenalty=null;
  for(const p of s.players)Object.assign(p,{x:20,y:5+p.number,vx:0,vy:0,nextDecision:100,nextTouch:100});
  m.events=[];m.frames=[];s.nextEventId=1;return m;
}
function fly(s,{x=100,y=34,z=0,vx=30,vy=0,vz=0,airborne=false,target={x:110,y}}={}){
  s.ball={mode:'flight',holder:null,x,y,z,vx,vy,vz,airborne,flight:{kind:'shot',side:0,from:'0:p10',to:null,start:{x,y},target,startedAt:0,endsAt:1,decisionId:99}};s.lastOwner=0;
}

test('a high ball crosses a planar defender without ground interception; descending contact uses the full interval',()=>{
  const start={x:0,y:0},end={x:10,y:0},p={x:5,y:0};
  assert.equal(sweptAerialContact(start,end,p,p,.72,{z:4},.2,2.4),null);
  const stay={x:0,y:0},ball={z:3,vz:-3,airborne:true};
  const at=sweptAerialContact(stay,stay,stay,stay,.72,ball,.2,2.4);
  assert.ok(at>0&&at<1);assert.ok(Math.abs(verticalAt(ball,at*.2).z-2.4)<1e-6);
});

test('height and jumping change physical reach without choosing the duel winner',()=>{
  const p={heightCm:180,attributes:{jumping:40,goalkeeping:80}};
  assert.ok(aerialReach({...p,heightCm:195})>aerialReach(p));
  assert.ok(aerialReach({...p,attributes:{...p.attributes,jumping:90}})>aerialReach(p));
  assert.ok(aerialReach(p,true)>aerialReach(p));
});

test('fast post and crossbar impacts occur before the goal plane and reflect the velocity',()=>{
  for(const ball of [{x:103,y:30.34,z:0,vx:40,vy:0},{x:103,y:34,z:2.44,vx:40,vy:0}]){
    const hit=goalFrameContact(ball,.2);assert.ok(hit&&hit.time<.05);assert.ok(hit.point.x<105);
    assert.ok(frameRebound(ball,hit).vx<0);
  }
  assert.equal(goalFrameContact({x:103,y:34,z:3,vx:40,vy:0},.2),null);
});

test('engine retains a live post rebound and does not award an over-crossbar goal',()=>{
  const post=clearMatch();fly(post.state,{y:30.34});advanceMatch(post);
  assert.ok(post.events.some(e=>e.type==='woodwork'));assert.equal(post.state.score[0],0);assert.ok(post.state.ball.vx<0);
  const high=clearMatch();fly(high.state,{z:3});advanceMatch(high);
  assert.ok(high.events.some(e=>e.type==='out'));assert.equal(high.state.score[0],0);
});

test('actual aerial contact produces a headed shot and the original delivery remains linked',()=>{
  const m=clearMatch(),s=m.state,p=playerByKey(s,'0:p10');Object.assign(p,{x:94,y:34,nextTouch:0});
  s.ball={mode:'flight',holder:null,x:92,y:34,z:2,vx:15,vy:0,vz:-1,airborne:true,
    flight:{kind:'pass',side:0,from:'0:p9',to:p.key,start:{x:80,y:12},target:{x:101,y:34},receivePoint:{x:94,y:34},startedAt:0,endsAt:.6,trajectory:'loft',decisionId:88}};
  advanceMatch(m);const header=m.events.find(e=>e.bodyPart==='head');assert.ok(header);assert.equal(header.type,'shot');assert.equal(header.decisionId,88);
  assert.ok(header.aerial.height>1.15&&header.aerial.height<=header.aerial.reach);assert.equal(s.stats[0].headers,1);
  assert.ok(m.frames.find(f=>f.contact&&f.eventCursor===header.id).ball.z>1.15);
});

test('airborne flight checkpoints reproduce, playback height interpolates, and old versions are rejected',()=>{
  const a=clearMatch();fly(a.state,{x:70,y:50,vx:20,...launchVertical(0,0,2),target:{x:110,y:50}});a.state.ball.flight.endsAt=2;
  advanceMatch(a,2);const b=restoreCheckpoint(exportCheckpoint(a));advanceMatch(a,20);advanceMatch(b,20);assert.deepEqual(a,b);
  const frames=[{time:0,restartSerial:0,players:[],ball:{x:0,y:0,z:0}},{time:1,restartSerial:0,players:[],ball:{x:1,y:0,z:2}}];
  assert.equal(sampleReplay(frames,.5).ball.z,1);
  const old=JSON.parse(exportCheckpoint(a));old.state.version='4.0.0-prototype.6';assert.throws(()=>restoreCheckpoint(old),/原版本/);
});
