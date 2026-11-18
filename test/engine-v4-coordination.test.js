import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,exportCheckpoint,restoreCheckpoint,simulateMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {createScenario} from '../versus/v4/scenarios.js';
import {planCoordination,changePossession} from '../versus/v4/coordination.js';
import {planTasks,commitTasks} from '../versus/v4/tasks.js';
import {controlProfile} from '../versus/v4/ball-control.js';
import {playerByKey,distance,worldPoint,assertWorld} from '../versus/v4/world.js';
import {sampleReplay,eventsAt,playbackRate} from '../versus/v4/replay.js';

function setHolder(s,key,x,y) {
  const p=playerByKey(s,key);Object.assign(p,{x,y,vx:0,vy:0,nextDecision:100});
  s.ball={mode:'held',holder:key,x,y,z:0,vx:0,vy:0,flight:null};s.lastOwner=p.side;
}
function until(match,predicate,limit=200){for(let i=0;i<limit&&!predicate(match);i++)advanceMatch(match);assert.ok(predicate(match),'expected event/state reached');return match;}

test('support players form distinct angles, reserve overlap cover and retain assignments under small movement',()=>{
  const m=createMatch(demoInput()),s=m.state;setHolder(s,'0:p9',62,16);
  const before=JSON.stringify(s),groups=planCoordination(s);assert.equal(JSON.stringify(s),before,'group planner is pure');
  const tasks=planTasks(s,groups),support=groups[0].support;
  assert.equal(support.length,2);assert.equal(new Set(support).size,2);
  assert.ok(!support.includes(groups[0].overlap.cover));
  const [a,b]=support.map(key=>tasks.get(key).target),ball=s.ball;
  assert.ok(Math.abs((a.x-ball.x)*(b.y-ball.y)-(b.x-ball.x)*(a.y-ball.y))>50);
  s.coordination=groups;playerByKey(s,support[0]).x+=.1;
  assert.deepEqual(planCoordination(s)[0].support,support);
});

test('screening targets the real carrier-to-outlet line and has separate pressure/cover actors',()=>{
  const m=createScenario('support',{duration:10}),s=m.state,groups=planCoordination(s),press=groups[1].press;
  assert.ok(press);assert.equal(new Set([press.presser,press.screen,press.cover]).size,3);
  const outlet=playerByKey(s,press.outlet);assert.ok(outlet);
  const dx=outlet.x-s.ball.x,dy=outlet.y-s.ball.y;
  assert.ok(Math.abs((press.lane.x-s.ball.x)*dy-(press.lane.y-s.ball.y)*dx)<1e-8);
  const task=planTasks(s,groups).get(press.screen);
  assert.equal(task.type,'screen');assert.equal(task.targetPlayer,outlet.key);assert.deepEqual(task.target,press.lane);
});

test('live handoffs keep at most one presser and one screen per team',()=>{
  const m=createMatch(demoInput({duration:40}));
  while(m.state.phase!=='finished') {
    advanceMatch(m);
    for(const side of [0,1]){
      const tasks=m.state.players.filter(p=>p.side===side).map(p=>p.task?.type);
      assert.ok(tasks.filter(t=>['press','counterPress'].includes(t)).length<=1);
      assert.ok(tasks.filter(t=>t==='screen').length<=1);
      assert.ok(!m.state.players.some(p=>p.side===side&&p.role==='CB'&&['screen','pressCover'].includes(p.task?.type)),'the press group preserves centre-back marking responsibilities');
    }
  }
});

test('overlap cover persists through turnover and is released only when the runner physically returns',()=>{
  const m=createScenario('overlapLoss',{duration:10}),s=m.state;
  let groups=planCoordination(s),tasks=planTasks(s,groups);
  assert.equal(groups[0].overlap.phase,'returning');assert.equal(tasks.get('0:p2').type,'recoverOverlap');
  assert.equal(tasks.get('0:p6').type,'coverOverlap');assert.deepEqual(tasks.get('0:p6').partners,['0:p2']);
  commitTasks(s,tasks);advanceMatch(m,2);
  assert.ok(playerByKey(s,'0:p2').x>70);assert.ok(s.coordination[0].overlap,'no instant return or cover release');
  const runner=playerByKey(s,'0:p2');Object.assign(runner,worldPoint(runner.anchor,0));
  groups=planCoordination(s);assert.equal(groups[0].overlap,null);
});

test('a nearby second ball does not cancel overlap recovery or pull its cover out of position',()=>{
  const m=createScenario('overlapLoss',{duration:10}),s=m.state;
  const cover=playerByKey(s,'0:p6');
  s.ball={mode:'loose',holder:null,flight:null,x:cover.x+1,y:cover.y,z:0,vx:2,vy:0};
  const groups=planCoordination(s),tasks=planTasks(s,groups);
  assert.equal(tasks.get('0:p6').type,'coverOverlap');
  assert.equal(tasks.get('0:p2').type,'recoverOverlap');
  assert.ok(!['0:p2','0:p6'].includes(groups[0].secondBall.primary));
  assert.ok(!['0:p2','0:p6'].includes(groups[0].secondBall.backup));
  assert.ok(groups.every(g=>g.secondBall.primary),'both teams still assign a contesting player');
});

test('possession is not assigned on a parry; counterpress expires into regroup and same-owner control is idempotent',()=>{
  const m=createMatch(demoInput({home:'press',away:'balanced',duration:10})),s=m.state;
  setHolder(s,'1:p7',60,34);s.lastOwner=0;
  Object.assign(playerByKey(s,'0:p7'),{x:59,y:31});Object.assign(playerByKey(s,'0:p8'),{x:57,y:36});
  const tr=changePossession(s,1,0,'test');assert.equal(tr.lossMode,'counterPress');assert.equal(tr.until,5);
  let groups=planCoordination(s);assert.equal(groups[0].transition,'counterPress');
  assert.equal(changePossession(s,1,.2,'same'),null);assert.equal(s.transitionSerial,1);
  s.time=3.2;s.tick=16;groups=planCoordination(s);assert.equal(groups[0].transition,'regroup');assert.equal(groups[0].press,null);
  s.time=5;s.tick=25;assert.equal(planCoordination(s)[0].transition,null);
});

test('loss of possession immediately cancels attacking tasks even inside their previous commitment window',()=>{
  const m=createScenario('support',{duration:10}),s=m.state;
  for(const p of s.players.filter(p=>p.side===0))p.task={type:'run',target:{x:100,y:34},since:0,until:100};
  setHolder(s,'1:p8',52,28);s.lastOwner=0;changePossession(s,1,0,'test');
  const groups=planCoordination(s);commitTasks(s,planTasks(s,groups));
  assert.ok(!s.players.some(p=>p.side===0&&p.task.type==='run'));
  assert.ok(s.players.some(p=>p.side===1&&p.task.type==='outlet'));
});

test('control quality responds to first touch, ball speed, facing, pressure and keeper skill',()=>{
  const m=createScenario('firstTouch',{duration:10}),s=m.state,p=structuredClone(playerByKey(s,'0:p10'));
  const ball={mode:'flight',vx:29,vy:0,flight:{kind:'pass'}};p.facing=Math.PI;
  const base=controlProfile(s,p,ball);
  const skilled=structuredClone(p);skilled.attributes.firstTouch=95;
  assert.ok(controlProfile(s,skilled,ball).probability>base.probability);
  assert.ok(controlProfile(s,p,{...ball,vx:10}).probability>base.probability);
  assert.ok(controlProfile(s,{...p,facing:0},ball).probability<base.probability);
  const pressed=structuredClone(s);Object.assign(pressed.players.find(q=>q.side!==p.side),{x:p.x+.8,y:p.y});
  assert.ok(controlProfile(pressed,p,ball).probability<base.probability);
});

test('a pressured fast pass can miscontrol into a moving loose ball without completing the pass',()=>{
  const m=createScenario('firstTouch',{seed:'v4-scene-2',duration:10});
  until(m,m=>m.events.some(e=>e.type==='miscontrol'),10);
  const e=m.events.find(e=>e.type==='miscontrol');assert.equal(e.actor,'0:p10');assert.ok(e.contact);assert.equal(e.outcome,'loose');
  assert.equal(m.state.ball.mode,'loose');assert.equal(m.state.ball.holder,null);assert.ok(Math.hypot(m.state.ball.vx,m.state.ball.vy)>0);
  assert.equal(m.state.stats[0].completed,0);
  const touched=m.events.filter(x=>x.actor===e.actor&&x.contact&&x.time<e.time+.45);assert.equal(touched.length,1,'failed receiver cannot instantly recover');
});

test('parry starts a physical rebound and second-ball race with no automatic keeper ownership',()=>{
  const m=createScenario('parry',{seed:'v4-scene-1',duration:20});
  until(m,m=>m.events.some(e=>e.type==='parry'),10);
  const e=m.events.find(e=>e.type==='parry');assert.equal(e.actor,'1:p1');assert.equal(m.state.lastOwner,0);
  assert.equal(m.state.ball.mode,'loose');assert.equal(m.state.ball.holder,null);assert.ok(e.rebound.vx<0);
  const group=planCoordination(m.state);assert.ok(group.every(g=>g.secondBall?.primary));
  until(m,m=>m.events.some(x=>x.type==='secondBall'&&x.contest.id===e.contest.id));
  const recovered=m.events.find(x=>x.type==='secondBall'&&x.contest.id===e.contest.id);
  assert.ok(recovered.time>e.time);assert.ok(recovered.contact);assert.equal(recovered.contest.originEventId,e.id);
});

function race(nearSide,seed='race') {
  const m=createMatch(demoInput({seed,duration:10})),s=m.state;
  for(const p of s.players)Object.assign(p,{x:15,y:60,vx:0,vy:0,nextDecision:100,nextTouch:0});
  Object.assign(playerByKey(s,'0:p10'),{x:nearSide===0?50.5:55,y:34});
  Object.assign(playerByKey(s,'1:p10'),{x:nearSide===1?50.5:55,y:34});
  s.ball={mode:'loose',holder:null,flight:null,x:50,y:34,z:0,vx:0,vy:0,lastTouch:'0:p7',contest:{id:++s.contestSerial,kind:'unclaimed',createdAt:0,originEventId:1,touches:0}};
  return m;
}
test('either team can win a second ball based on actual arrival, independent of prior possession',()=>{
  for(const side of [0,1]){const m=race(side);until(m,m=>m.events.some(e=>e.type==='secondBall'),20);const e=m.events.find(e=>e.type==='secondBall');assert.equal(e.side,side);assert.ok(e.contact);}
});

test('truly simultaneous contacts use a documented contest, not a home-team key tie-break',()=>{
  const sides=new Set();
  for(let n=0;n<20;n++){
    const m=race(0,`tie-${n}`);Object.assign(playerByKey(m.state,'1:p10'),{x:50.5,y:34});
    advanceMatch(m);const event=m.events.find(e=>e.duel);
    assert.ok(event);assert.equal(event.duel.candidates.length,2);sides.add(event.side);
  }
  assert.equal(sides.size,2);
});

test('checkpoint during rebound, persistent cover and conversion state resumes the same future',()=>{
  for(const scenario of ['parry','overlapLoss']){
    const a=createScenario(scenario,{seed:'v4-scene-1',duration:30});
    if(scenario==='parry')until(a,m=>m.state.ball.mode==='loose',10);else advanceMatch(a,2);
    const b=restoreCheckpoint(exportCheckpoint(a));advanceMatch(a,1000);advanceMatch(b,1000);
    assert.deepEqual(b,a);assertWorld(b.state);
  }
});

test('rebound replay uses recorded velocities/contact points and does not expose later control',()=>{
  const m=createScenario('parry',{seed:'v4-scene-1',duration:20});advanceMatch(m,100);
  const parry=m.events.find(e=>e.type==='parry'),recovery=m.events.find(e=>e.type==='secondBall'&&e.contest.id===parry.contest.id);
  const frame=sampleReplay(m.frames,parry.time);assert.equal(frame.ball.mode,'loose');assert.ok(frame.ball.vx<0);
  assert.equal(frame.ball.contest.originEventId,parry.id);
  assert.ok(!eventsAt(m.events,parry.time).some(e=>e.id===recovery.id));
  assert.equal(playbackRate(m.events,parry.time+.1,8,true),.6);
});

test('new coordination and ball contests remain deterministic when recording is disabled',()=>{
  // Longer dead-ball preparation can occupy much of the old 90-second fixture.
  const input=demoInput({seed:'stage2-repro',duration:180});
  const a=simulateMatch(input),b=simulateMatch(input,{recording:false});
  assert.deepEqual(a.state,b.state);assert.deepEqual(a.events,b.events);
  assert.ok(a.events.some(e=>e.type==='miscontrol'));assert.ok(a.events.some(e=>e.type==='transition'));
});
