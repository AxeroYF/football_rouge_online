import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,simulateMatch,awardRestart,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {coordinates,direction,scoringSideAt,snapshot,playerByKey} from '../versus/v4/world.js';
import {createClock,advanceClock,announceAllowance,periodDue,restartTiming,formatMatchClock} from '../versus/v4/period-clock.js';
import {inPenaltyArea,outRestart,freeKickSpot,offsideSnapshot,arrangeRestart} from '../versus/v4/rules.js';
import {controlPlan,readyToDecide} from '../versus/v4/tempo.js';
import {planTasks,actionCandidates} from '../versus/v4/tasks.js';
import {looseVelocity} from '../versus/v4/ball-control.js';
import {sampleReplay,eventsAt} from '../versus/v4/replay.js';

const full=(duration=20)=>createMatch(demoInput({duration,format:'full',seed:'period-test'}));
const until=(m,p,max=4000)=>{for(let i=0;i<max&&!p(m.state);i++)advanceMatch(m);assert.ok(p(m.state));return m;};
const finish=m=>until(m,s=>s.phase==='finished');
function emptyBall(s){s.rules={offside:null,restartTouch:null};s.ball={mode:'loose',holder:null,flight:null,x:50,y:3,z:0,vx:0,vy:0};for(const p of s.players){p.x=30;p.y=60;p.nextDecision=1e6;}}

test('full protocol has two halves and changes kickoff team while clips remain single periods',()=>{
  const m=finish(full());
  assert.equal(m.state.clock.completed.length,2);
  assert.deepEqual(m.events.filter(e=>e.type==='restart'&&e.restartType==='kickoff').map(e=>e.side).slice(0,2),[0,1]);
  const half=m.events.find(e=>e.type==='halfTime'),ends=m.events.find(e=>e.type==='endsChanged');
  assert.equal(ends.time-half.time,6);assert.equal(ends.clock.period,2);assert.equal(ends.clock.elapsed,0);
  assert.equal(m.events.filter(e=>e.type==='fulltime').length,1);
  const clip=simulateMatch(demoInput({duration:20}));assert.equal(clip.state.time,20);assert.equal(clip.state.clock.completed.length,0);
  assert.equal(createClock(demoInput({duration:5400})).intervalLength,900);
});

test('halftime freezes football state and RNG; restart preserves identities, discipline and score',()=>{
  const m=full(),s=m.state;s.players[3].yellowCards=1;s.players[4].active=false;s.players[4].yellowCards=2;s.score=[2,1];
  until(m,s=>s.phase==='halftime');const before=structuredClone(s),events=m.events.length;
  advanceMatch(m,20);assert.deepEqual(s.random,before.random);assert.deepEqual(s.players,before.players);assert.equal(m.events.length,events);
  assert.equal(s.clock.elapsed,before.clock.elapsed);assert.equal(s.clock.intervalRemaining,2);
  until(m,s=>s.clock.period===2);assert.deepEqual(s.score,[2,1]);assert.equal(s.players[3].yellowCards,1);assert.equal(s.players[4].active,false);
  assert.deepEqual(s.players.map(p=>[p.key,p.side,p.id]),before.players.map(p=>[p.key,p.side,p.id]));
  assert.ok(s.players.every((p,i)=>p.fitness<=before.players[i].fitness+2));
});

test('both second-half orientations apply to penalty area, restarts, offside and parry direction',()=>{
  for(const period of [1,2])for(const side of [0,1]){
    const s=full().state;s.clock.period=period;const {worldPoint}=coordinates(s);
    assert.equal(direction(side,s),(side===(period===1?0:1))?1:-1);
    const goal=worldPoint({x:105,y:34},side);assert.equal(scoringSideAt(s,goal.x),side);
    assert.ok(inPenaltyArea(goal,1-side,s));assert.ok(!inPenaltyArea(goal,side,s));
    assert.deepEqual(freeKickSpot(goal,side,'penalty',s),worldPoint({x:94,y:34},side));
    const miss={...goal,y:10};assert.equal(outRestart(miss,side,s).side,1-side);assert.equal(outRestart(miss,side,s).type,'goalKick');
    assert.equal(outRestart(miss,1-side,s).type,'corner');
    for(const p of s.players)Object.assign(p,worldPoint({x:p.side===side?40:65,y:10+p.number*3},side));
    const kicker=playerByKey(s,`${side}:p7`),receiver=playerByKey(s,`${side}:p10`);
    Object.assign(kicker,worldPoint({x:70,y:34},side));Object.assign(receiver,worldPoint({x:85,y:34},side));
    Object.assign(playerByKey(s,`${1-side}:p1`),worldPoint({x:100,y:34},side));Object.assign(playerByKey(s,`${1-side}:p3`),worldPoint({x:80,y:20},side));
    Object.assign(s.ball,worldPoint({x:70,y:34},side));
    const line=offsideSnapshot(s,kicker);assert.equal(line.line,80);assert.ok(line.candidates.includes(receiver.key));assert.equal(line.attackDirection,direction(side,s));
    const keeper=playerByKey(s,`${1-side}:p1`),rebound=looseVelocity(s.ball,keeper,{keeper:true,shot:true,speed:30},.5,s);
    assert.equal(Math.sign(rebound.vx),direction(keeper.side,s));
    const r={type:'penalty',side,spot:freeKickSpot(goal,side,'penalty',s)};const taker=arrangeRestart(s,r);
    assert.deepEqual({x:taker.x,y:taker.y},worldPoint({x:94,y:34},side));assert.equal(keeper.x,goal.x);
  }
});

test('actual second-half crossings credit the attacking side, including own goals',()=>{
  for(const x of [0,105])for(const lastSide of [0,1]){
    const m=full(),s=m.state;s.clock.period=2;emptyBall(s);
    s.ball={mode:'loose',holder:null,flight:null,x:x===0?.5:104.5,y:34,z:0,vx:x===0?-10:10,vy:0,lastTouch:`${lastSide}:p7`};
    advanceMatch(m);const goal=m.events.find(e=>e.type==='goal');assert.ok(goal);
    const side=x===0?0:1;assert.equal(goal.scoringSide,side);assert.equal(goal.ownGoal,lastSide!==side);assert.equal(s.score[side],1);
  }
});

test('allowance uses actual exceptional loss per half, not all routine dead time',()=>{
  const s={phase:'restart',clock:createClock({duration:5400,format:'full'})};
  advanceClock(s,30,0);assert.equal(s.clock.lost[0],0);assert.equal(s.clock.dead[0],30);
  advanceClock(s,12,0,12,'discipline');s.clock.elapsed=2700;
  assert.deepEqual(announceAllowance(s.clock),{period:1,seconds:60,lostSeconds:12,causes:{discipline:12}});
  assert.equal(announceAllowance(s.clock),null);advanceClock(s,10,0,10,'celebration');assert.equal(s.clock.added[0],70);
  s.clock.elapsed=2760;assert.equal(periodDue(s.clock),false);s.clock.elapsed=2770;assert.equal(periodDue(s.clock),true);
  s.clock.period=2;s.clock.elapsed=2700;assert.equal(announceAllowance(s.clock).seconds,0);assert.equal(periodDue(s.clock),true);
  assert.equal(restartTiming('throwIn').exceptional,0);assert.equal(restartTiming('directFreeKick','yellow').exceptional,12);
});

test('restart waiting accrues only elapsed extraordinary delay; halftime cancels ordinary pending restart',()=>{
  const m=full(120),s=m.state;awardRestart(m,'directFreeKick',0,{x:40,y:30},'test',0,'yellow');
  const normal=restartTiming('directFreeKick','yellow').normal;
  advanceMatch(m,(normal+2)/.2);assert.equal(s.clock.lost[0],2);assert.equal(s.clock.dead[0],normal+2);assert.equal(s.restart.lossAccrued,2);
  const n=full();awardRestart(n,'throwIn',0,{x:40,y:0},'routine');until(n,s=>s.phase==='halftime');
  assert.equal(n.state.clock.completed[0].lost,0);assert.equal(n.state.clock.completed[0].elapsed,10);assert.equal(n.state.restart,null);
  assert.equal(n.events.filter(e=>e.type==='restart').length,1);
});

test('period deadline extends an awarded penalty until kick completion, then stops without kickoff',()=>{
  const m=full(),s=m.state;awardRestart(m,'penalty',0,{x:94,y:34},'test');until(m,s=>s.clock.extendingPenalty);
  assert.equal(s.phase,'restart');assert.ok(m.events.some(e=>e.type==='penaltyExtension'));
  until(m,s=>s.pendingPenalty?.kicked);assert.ok(m.events.some(e=>e.type==='shot'&&e.restartType==='penalty'));
  emptyBall(s);s.pendingPenalty={side:0,kicker:'0:p10',kicked:true};
  s.ball={mode:'loose',holder:null,flight:null,x:104.5,y:34,z:0,vx:10,vy:0,lastTouch:'0:p10'};
  advanceMatch(m);assert.equal(s.phase,'halftime');assert.equal(s.score[0],1);assert.equal(s.restart,null);
  assert.equal(s.clock.completed[0].announced,0);assert.equal(s.clock.completed[0].lost,0,'penalty-only extension does not recursively add preparation');
});

test('extended penalty ends on another player touch without allowing a rebound attack',()=>{
  const m=full(),s=m.state;emptyBall(s);s.clock.elapsed=10;s.clock.announced[0]=0;s.clock.extendingPenalty=true;
  s.pendingPenalty={side:0,kicker:'0:p10',kicked:true};const p=playerByKey(s,'0:p8');Object.assign(p,{x:50,y:3});
  advanceMatch(m);assert.equal(s.phase,'halftime');assert.equal(s.pendingPenalty,null);assert.ok(!m.events.some(e=>e.type==='secondBall'));
});

test('normal shots are not granted an extra attack after the period deadline',()=>{
  const m=full(),s=m.state;s.clock.elapsed=9.8;emptyBall(s);
  s.ball={mode:'flight',holder:null,x:50,y:3,z:0,vx:10,vy:0,flight:{kind:'shot',side:0,from:'0:p10',to:null,target:{x:105,y:3},endsAt:5.5,startedAt:0,decisionId:1}};
  advanceMatch(m);assert.equal(s.phase,'halftime');assert.ok(!m.events.some(e=>e.type==='penaltyExtension'));
});

test('checkpoint resumes exactly during interval, allowance and penalty extension',()=>{
  for(const mode of ['interval','allowance','penalty']){
    const a=full();if(mode==='interval')until(a,s=>s.phase==='halftime');
    else if(mode==='allowance'){a.state.clock.lost[0]=10;until(a,s=>s.clock.announced[0]!==null);}
    else {awardRestart(a,'penalty',0,{x:94,y:34},'test');until(a,s=>s.clock.extendingPenalty);}
    const b=restoreCheckpoint(exportCheckpoint(a));finish(a);finish(b);assert.deepEqual(a,b);
  }
});

test('clock and recording corruption and previous prototype checkpoints are rejected',()=>{
  for(const mutate of [p=>p.state.clock.period=3,p=>p.state.clock.lost=null,p=>p.state.clock.announced=[-1,null],p=>p.frameInterval=0,p=>p.state.version='4.0.0-prototype.3']){
    const saved=JSON.parse(exportCheckpoint(full()));mutate(saved);assert.throws(()=>restoreCheckpoint(saved));
  }
});

test('replay hides the next period, allowance and positions until their actual timestamps',()=>{
  const m=finish(full()),half=m.events.find(e=>e.type==='halfTime'),ends=m.events.find(e=>e.type==='endsChanged');
  const resting=sampleReplay(m.frames,half.time+2),before=sampleReplay(m.frames,ends.time-.001),after=sampleReplay(m.frames,ends.time);
  assert.equal(resting.clock.elapsed,half.clock.elapsed);assert.equal(resting.clock.intervalRemaining,4);
  assert.equal(before.clock.period,1);assert.equal(after.clock.period,2);assert.equal(after.clock.elapsed,0);
  assert.equal(before.players[0].x,resting.players[0].x);assert.ok(!eventsAt(m.events,ends.time-.001).some(e=>e.type==='endsChanged'));
  const base=snapshot(full().state);base.clock.elapsed=2699;base.clock.halfLength=2700;base.clock.announcedSeconds=null;
  assert.equal(sampleReplay([base,{...structuredClone(base),time:1,clock:{...base.clock,announcedSeconds:180,elapsed:2700}}],.5).clock.announcedSeconds,null);
  assert.equal(formatMatchClock({mode:'full',period:2,halfLength:2700,elapsed:2715}),'90+00:15');
});

test('control has a real settling delay and a bounded pressure outlet; goalkeepers always choose a release',()=>{
  const s=full().state,p=playerByKey(s,'0:p7');for(const q of s.players.filter(q=>q.side===1)){q.x=100;q.y=60;}p.x=40;p.y=30;
  p.control=controlPlan(s,p,0);p.nextDecision=p.control.until;assert.ok(p.control.duration>=2);
  s.time=.6;assert.equal(readyToDecide(s,p),false);Object.assign(s.players.find(q=>q.side===1),{x:41,y:30});
  s.time=.8;assert.equal(readyToDecide(s,p),true);
  s.ball={mode:'held',holder:p.key,x:p.x,y:p.y,z:0,vx:0,vy:0,flight:null};assert.equal(planTasks(s).get(p.key).type,'secure');
  assert.ok(p.control.target.x-p.x<1);
  assert.notEqual(actionCandidates(s,playerByKey(s,'0:p1'))[0].type,'carry');
});

test('full-match recording intervals and batch sizes do not affect football outcomes or clocks',()=>{
  const input=demoInput({duration:120,format:'full'}),a=simulateMatch(input),b=createMatch(input,{frameInterval:.2}),c=simulateMatch(input,{recording:false});
  finish(b);assert.deepEqual(a.state,b.state);assert.deepEqual(a.events,b.events);assert.deepEqual(a.state,c.state);
  assert.ok(a.frames.length<b.frames.length);assert.equal(c.frames.length,0);
  const total=a.state.clock.completed.reduce((n,p)=>{assert.ok(Math.abs(p.inPlay+p.dead-p.elapsed)<1e-5);return n+p.elapsed;},0);
  assert.ok(Math.abs(a.state.time-total-6)<1e-5);
  for(let i=1;i<a.frames.length;i++)assert.ok(a.frames[i].time>=a.frames[i-1].time);
});
