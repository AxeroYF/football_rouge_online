import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,simulateMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {STEP,sweptContact,distance,assertWorld} from '../versus/v4/world.js';
import {planTasks} from '../versus/v4/tasks.js';
import {sampleReplay,eventsAt,playbackRate} from '../versus/v4/replay.js';
import {startV4Lab} from '../scripts/serve-v4-lab.mjs';
import {createScenario} from '../versus/v4/scenarios.js';

test('V4 produces a 22-player spatial sequence with physical contacts, shots and explanations',()=>{
  const m=simulateMatch(demoInput());
  assert.equal(m.state.phase,'finished');assert.equal(m.state.time,180);
  for(const type of ['pass','receive','interception'])assert.ok(m.events.some(e=>e.type===type),type);
  const chance=createScenario('penalty',{seed:'v4-scene-0',duration:60});advanceMatch(chance,300);
  assert.ok(chance.events.some(e=>e.type==='shot'));
  assert.ok(chance.events.some(e=>['goal','save','parry','out'].includes(e.type)),'shot resolves through a real flight/contact');
  assert.equal(new Set(m.state.players.map(p=>p.key)).size,22);
  assert.equal(new Set(m.state.players.map(p=>p.id)).size,11,'same player ID on opposing teams is allowed');
  for(const event of m.events) {
    if(event.contact)assert.ok(distance(event.contact.point,event.contact.playerPoint)<=event.contact.radius+1e-6);
    if(event.decision){assert.ok(event.reason);assert.ok(event.source);assert.ok(event.decision.candidates.length);}
    if(event.type==='goal'){assert.ok([0,105].includes(event.position.x));assert.ok(Math.abs(event.position.y-34)<=3.66);}
  }
  for(let i=1;i<m.frames.length;i++)assert.ok(m.frames[i].time>=m.frames[i-1].time,'chronological frame protocol');
  for(let i=1;i<m.events.length;i++)assert.ok(m.events[i].time>=m.events[i-1].time,'chronological event protocol');
});

test('same seed/input, different step batches and recording switch preserve exact state and events',()=>{
  const input=demoInput({duration:40});
  const a=simulateMatch(input),b=createMatch(input),c=simulateMatch(input,{recording:false});
  while(b.state.phase!=='finished')advanceMatch(b,7);
  assert.deepEqual(a,b);assert.deepEqual(a.state,c.state);assert.deepEqual(a.events,c.events);assert.equal(c.frames.length,0);
});

test('checkpoint during a flying ball resumes exactly including tasks, RNG, frames and events',()=>{
  const a=createMatch(demoInput({duration:40}));
  while(a.state.ball.mode!=='flight')advanceMatch(a);
  const b=restoreCheckpoint(exportCheckpoint(a));
  advanceMatch(a,1000);advanceMatch(b,1000);assert.deepEqual(a,b);
  assert.equal(Object.isFrozen(b.state.input.teams[0].tactics),true);
});

test('checkpoint rejects changed config, malformed ownership and random state',()=>{
  const m=createMatch(demoInput({duration:10}));
  const config=JSON.parse(exportCheckpoint(m));config.state.input.teams[0].preset='counter';
  assert.throws(()=>restoreCheckpoint(config),/配置/);
  const ball=JSON.parse(exportCheckpoint(m));ball.state.ball.holder='missing';assert.throws(()=>restoreCheckpoint(ball),/归属/);
  const rng=JSON.parse(exportCheckpoint(m));rng.state.random.execution.value=-1;assert.throws(()=>restoreCheckpoint(rng),/随机/);
});

test('input validation and immutable configuration do not mutate caller input',()=>{
  const input=demoInput(),before=structuredClone(input);const m=createMatch(input);assert.deepEqual(input,before);
  assert.throws(()=>{m.state.input.teams[0].tactics.press=0;},TypeError);
  const invalid=demoInput();invalid.teams[0].players[0].attributes.pace=Infinity;assert.throws(()=>createMatch(invalid),/属性/);
  assert.throws(()=>createMatch(demoInput({duration:5401})),/时长/);
  assert.throws(()=>advanceMatch(m,1.5),/步数/);
});

test('swept contact detects fast crossings and excludes defenders who arrive too late',()=>{
  assert.equal(sweptContact({x:0,y:0},{x:10,y:0},{x:5,y:0},{x:5,y:0},1),.4);
  assert.equal(sweptContact({x:0,y:0},{x:10,y:0},{x:5,y:10},{x:5,y:5},1),null);
  assert.equal(sweptContact({x:0,y:0},{x:10,y:0},{x:5,y:4},{x:5,y:-4},1)!==null,true);
});

test('an unclaimed pass ends at its target then rolls into a new loose-ball contest',()=>{
  const m=createMatch(demoInput({duration:10})),s=m.state;
  for(const p of s.players){p.x=20;p.y=50;p.nextDecision=100;}
  const receiver=s.players.find(p=>p.side===1&&p.role==='CB');receiver.x=52;receiver.y=20;
  s.ball={mode:'flight',holder:null,x:50,y:20,z:0,vx:30,vy:0,flight:{kind:'pass',side:0,from:'0:p6',to:'0:p7',target:{x:50.3,y:20},endsAt:.01,startedAt:0,decisionId:0}};
  advanceMatch(m);
  const loose=m.events.find(e=>e.type==='loose');assert.equal(loose.time,.01);
  assert.equal(loose.position.x,50.3);assert.ok(!m.events.some(e=>e.type==='interception'));
  assert.ok(s.ball.x>50.3);assert.ok(m.events.filter(e=>e.type==='secondBall').every(e=>e.time>.01));
});

test('left overlap yields an actual runner and covering midfielder; defensive tasks avoid all-player chasing',()=>{
  const m=createMatch(demoInput()),s=m.state,holder=s.players.find(p=>p.key==='0:p9');
  holder.x=65;holder.y=15;s.ball={mode:'held',holder:holder.key,x:65,y:15,z:0,vx:0,vy:0,flight:null};
  const tasks=planTasks(s);
  assert.equal(tasks.get('0:p2').type,'overlap');assert.equal(tasks.get('0:p6').type,'coverOverlap');
  assert.match(tasks.get('0:p6').reason,/保护左侧/);
  assert.equal([...tasks.entries()].filter(([key,t])=>key.startsWith('1:')&&t.type==='press').length,1);
  assert.equal([...tasks.entries()].filter(([key,t])=>key.startsWith('1:')&&t.type==='screen').length,1);
  const low=createMatch(demoInput({away:'counter'}));
  low.state.ball=structuredClone(s.ball);Object.assign(low.state.players.find(p=>p.key===holder.key),{x:65,y:15});
  // Put ball high in the defending team's local coordinate system: low block waits, high press engages.
  low.state.ball.x=30;s.ball.x=30;
  assert.ok([...planTasks(s)].some(([key,t])=>key.startsWith('1:')&&t.type==='press'));
  assert.ok(![...planTasks(low.state)].some(([key,t])=>key.startsWith('1:')&&t.type==='press'));
});

test('player motion is speed bounded between normal ticks; restarts are explicit',()=>{
  const m=createMatch(demoInput({duration:60}));
  while(m.state.phase!=='finished'){
    const before=structuredClone(m.state);advanceMatch(m);assertWorld(m.state);
    if(before.restartSerial!==m.state.restartSerial)continue;
    for(const p of m.state.players)assert.ok(distance(p,before.players.find(q=>q.key===p.key))<=8*STEP+1e-6);
  }
});

test('replay is read-only, hides future scores/events, and never interpolates across restarts',()=>{
  const m=createScenario('penalty',{seed:'v4-scene-0',duration:60});
  while(!m.events.some(e=>e.type==='shot'))advanceMatch(m);
  // Isolate score/replay timing from finishing calibration with a known unobstructed crossing.
  const shotEvent=m.events.find(e=>e.type==='shot'),s=m.state;
  for(const p of s.players){p.x=30;p.y=60;p.vx=0;p.vy=0;}
  s.rules={offside:null,restartTouch:null};
  s.ball={mode:'flight',holder:null,x:104,y:34,z:0,vx:10,vy:0,flight:{kind:'shot',side:0,from:shotEvent.actor,to:null,start:{x:104,y:34},target:{x:105,y:34},startedAt:s.time,endsAt:s.time+.1,decisionId:shotEvent.id}};
  advanceMatch(m,300);const before=exportCheckpoint(m);
  const goal=m.events.find(e=>e.type==='goal');assert.ok(goal);
  assert.deepEqual(sampleReplay(m.frames,goal.time-.001).score,[0,0]);
  assert.deepEqual(sampleReplay(m.frames,goal.time).score,goal.score);
  assert.ok(!eventsAt(m.events,goal.time-.001).some(e=>e.id===goal.id));
  const shot=m.events.find(e=>e.type==='shot');assert.equal(playbackRate(m.events,shot.time,4,true),.6);
  assert.equal(playbackRate(m.events,shot.time,4,false),4);
  for(const time of [0,10,80,179,500])sampleReplay(m.frames,time);
  assert.equal(exportCheckpoint(m),before);
  const a=structuredClone(m.frames[0]),b=structuredClone(a);a.time=0;b.time=1;b.restartSerial=1;b.players[0].x=70;
  assert.equal(sampleReplay([a,b],.5).players[0].x,a.players[0].x);
});

test('sampled contact frames preserve the actual contact point, not a reconstructed shot path',()=>{
  const m=simulateMatch(demoInput({duration:40}));
  for(const e of m.events.filter(e=>e.contact)){
    const frame=m.frames.find(f=>f.contact&&f.eventCursor===e.id);
    assert.ok(frame);assert.equal(frame.time,e.time);assert.deepEqual({x:frame.ball.x,y:frame.ball.y,z:frame.ball.z},e.contact.point);
  }
});

test('all tactical matchups terminate without broken ownership or non-finite positions',()=>{
  for(const home of ['balanced','left','press','counter'])for(const away of ['balanced','left','press','counter']){
    const m=simulateMatch(demoInput({home,away,duration:30,seed:`${home}:${away}`}));assertWorld(m.state);assert.equal(m.state.phase,'finished');
    assert.ok(m.events.some(e=>e.type==='pass'));
  }
});

test('lab server exposes only standalone source and static assets, with no league or write endpoints',async t=>{
  const lab=await startV4Lab({port:0});t.after(()=>lab.stop());
  const root=await fetch(lab.url);assert.equal(root.status,200);assert.match(await root.text(),/战术实验室/);
  assert.equal((await fetch(lab.url+'/engine.js')).status,200);
  for(const path of ['/data/yellowdogs-league.json','/.env','/api/versus/league','/..%2f..%2f.env'])assert.equal((await fetch(lab.url+path)).status,404);
  assert.equal((await fetch(lab.url,{method:'POST'})).status,405);
});
