import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,advanceMatch,awardRestart,penalizeFoul,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {createScenario} from '../versus/v4/scenarios.js';
import {offsideSnapshot,offsideInvolvement,opponentDeliberatePlay,outRestart,inPenaltyArea,foulProfile,foulSanction,challengeIntent,arrangeRestart,activePlayers,freeKickSpot} from '../versus/v4/rules.js';
import {worldPoint,playerByKey,distance,assertWorld} from '../versus/v4/world.js';
import {planCoordination} from '../versus/v4/coordination.js';
import {planTasks} from '../versus/v4/tasks.js';
import {sampleReplay,eventsAt} from '../versus/v4/replay.js';

const until=(m,p,n=100)=>{for(let i=0;i<n&&!p(m);i++)advanceMatch(m);assert.ok(p(m));return m;};
test('box challenges account for approach risk before attempting a tackle, without rewriting foul severity',()=>{
  const defender={attributes:{tackling:75}},front={penalty:true,behind:false,speed:3};
  assert.ok(challengeIntent(defender,front)>challengeIntent(defender,{...front,behind:true}));
  assert.ok(challengeIntent(defender,front)>challengeIntent(defender,{...front,speed:10}));
  assert.ok(challengeIntent({attributes:{tackling:90}},front)>challengeIntent(defender,front));
  assert.equal(challengeIntent(defender,{...front,penalty:false}),1);
  assert.equal(foulSanction({...front,dogso:true},.5).card,'yellow');
});
function offsideWorld(side=0){
  const m=createMatch(demoInput({duration:20})),s=m.state;
  for(const p of s.players)Object.assign(p,worldPoint({x:p.side===side?40:65,y:10+p.number*3},side));
  const kicker=playerByKey(s,`${side}:p7`),receiver=playerByKey(s,`${side}:p10`);
  Object.assign(kicker,worldPoint({x:70,y:34},side));Object.assign(receiver,worldPoint({x:85,y:34},side));
  Object.assign(playerByKey(s,`${1-side}:p1`),worldPoint({x:100,y:34},side));
  Object.assign(playerByKey(s,`${1-side}:p3`),worldPoint({x:80,y:20},side));
  s.ball={mode:'held',holder:kicker.key,...worldPoint({x:70,y:34},side),z:0,vx:0,vy:0,flight:null};
  return {m,s,kicker,receiver};
}
test('offside captures the kick-time ball and second-last opponent symmetrically; equal, own-half and behind-ball are legal',()=>{
  for(const side of [0,1]){
    const {s,kicker,receiver}=offsideWorld(side);let snap=offsideSnapshot(s,kicker);
    assert.equal(snap.line,80);assert.ok(snap.candidates.includes(receiver.key));
    Object.assign(receiver,worldPoint({x:80,y:34},side));assert.ok(!offsideSnapshot(s,kicker).candidates.includes(receiver.key));
    Object.assign(receiver,worldPoint({x:50,y:34},side));assert.ok(!offsideSnapshot(s,kicker).candidates.includes(receiver.key));
    Object.assign(s.ball,worldPoint({x:90,y:34},side));Object.assign(receiver,worldPoint({x:85,y:34},side));assert.ok(!offsideSnapshot(s,kicker).candidates.includes(receiver.key));
  }
});
test('offside position is not whistled until involvement and is not recalculated using receiving positions',()=>{
  const {s,kicker,receiver}=offsideWorld();s.rules.offside=offsideSnapshot(s,kicker);
  receiver.x=74;assert.equal(offsideInvolvement(s,receiver,receiver).kind,'touch');
  const innocent=playerByKey(s,'0:p8');assert.equal(offsideInvolvement(s,innocent,innocent),null);
  const defender=playerByKey(s,'1:p3');Object.assign(defender,{x:74.5,y:34});assert.equal(offsideInvolvement(s,defender,receiver).kind,'challenge');
});
test('throw-in, goal kick and corner exempt the direct receiver; free kick does not',()=>{
  const {s,kicker}=offsideWorld();
  for(const type of ['throwIn','goalKick','corner'])assert.equal(offsideSnapshot(s,kicker,0,type),null);
  for(const type of ['directFreeKick','indirectFreeKick','kickoff'])assert.ok(offsideSnapshot(s,kicker,0,type).candidates.length);
});
test('actual offside contact stops play before reception/goal and awards an indirect kick at involvement',()=>{
  const m=createScenario('offside',{seed:'v4-scene-0',duration:20});
  advanceMatch(m);assert.ok(!m.events.some(e=>e.type==='offside'));
  until(m,m=>m.events.some(e=>e.type==='offside'));
  const e=m.events.find(e=>e.type==='offside');assert.equal(e.actor,'0:p10');assert.equal(m.state.restart.type,'indirectFreeKick');assert.equal(m.state.restart.side,1);
  assert.deepEqual(m.state.score,[0,0]);assert.ok(!m.events.some(e=>e.type==='receive'&&e.actor==='0:p10'));
  assert.ok(distance(m.state.restart.spot,e.position)<1e-6);
});
test('a parry retains kick-time offside candidates and a later offending rebound touch is penalized',()=>{
  const m=createScenario('parry',{seed:'v4-scene-1',duration:20});
  m.state.rules.offside={side:0,kicker:'0:p10',at:0,line:90,ballX:87,secondLastX:90,candidates:['0:p8']};
  until(m,m=>m.events.some(e=>e.type==='parry'));
  assert.ok(m.state.rules.offside.candidates.includes('0:p8'));
  const p=playerByKey(m.state,'0:p8');Object.assign(p,{x:m.state.ball.x,y:m.state.ball.y,vx:0,vy:0});
  advanceMatch(m);assert.ok(m.events.some(e=>e.type==='offside'&&e.actor===p.key));
});
test('opponent controlled interception clears the old offside phase',()=>{
  const m=createScenario('firstTouch',{seed:'control',duration:20}),s=m.state;
  s.rules.offside={side:0,kicker:'0:p7',at:0,line:70,ballX:65,secondLastX:70,candidates:['0:p10']};
  Object.assign(playerByKey(s,'1:p8'),{x:68,y:34,vx:0,vy:0,facing:Math.PI});
  until(m,m=>m.events.some(e=>e.type==='interception'));
  assert.equal(s.rules.offside,null);
});
test('a failed deliberate play can reset offside, while a fast deflection or deliberate save cannot',()=>{
  const profile={shot:false,relativeSpeed:15,alignment:.9,pressureDistance:5};
  assert.equal(opponentDeliberatePlay(profile,false),true);
  assert.equal(opponentDeliberatePlay({...profile,relativeSpeed:30},false),false);
  assert.equal(opponentDeliberatePlay({...profile,shot:true},true),false);
});
test('touchline/end-line exits choose ownership and corner or goal kick using last touch, in either direction',()=>{
  for(const x of [0,105]){
    const defender=x===0?0:1;
    assert.equal(outRestart({x,y:20},defender).type,'corner');
    assert.equal(outRestart({x,y:20},1-defender).type,'goalKick');
    assert.equal(outRestart({x,y:20},defender).side,1-defender);
  }
  for(const y of [0,68])assert.deepEqual(outRestart({x:48,y},0),{type:'throwIn',side:1,spot:{x:48,y}});
});
test('penalty area includes its boundary and uses both width and depth',()=>{
  for(const side of [0,1]){
    assert.equal(inPenaltyArea(worldPoint({x:16.5,y:13.84},side),side),true);
    assert.equal(inPenaltyArea(worldPoint({x:16.6,y:34},side),side),false);
    assert.equal(inPenaltyArea(worldPoint({x:10,y:13},side),side),false);
  }
  assert.deepEqual(freeKickSpot({x:103,y:34},0,'indirectFreeKick'),{x:99.5,y:34});
});
test('restart placement enforces kickoff halves, opponent clearance and legal penalty positions',()=>{
  for(const side of [0,1])for(const type of ['kickoff','throwIn','goalKick','corner','directFreeKick','indirectFreeKick','penalty']){
    const m=createMatch(demoInput()),s=m.state;
    const local=type==='penalty'?{x:94,y:34}:type==='kickoff'?{x:52.5,y:34}:type==='goalKick'?{x:5.5,y:34}:type==='corner'?{x:104.9,y:.1}:type==='throwIn'?{x:60,y:0}:{x:80,y:28};
    const r={type,side,spot:worldPoint(local,side)},taker=arrangeRestart(s,r);
    assert.deepEqual({x:taker.x,y:taker.y},r.spot);
    for(const p of activePlayers(s).filter(p=>p.key!==taker.key)){
      if(type==='penalty'){
        if(p.side!==side&&p.role==='GK'){assert.equal(p.x,side===0?105:0);continue;}
        assert.ok(!inPenaltyArea(p,1-side));assert.ok(distance(p,r.spot)>=9.15);
      }else if(p.side!==side)assert.ok(distance(p,r.spot)>=(type==='throwIn'?2:9.15)-1e-7);
      if(type==='kickoff')assert.ok((p.side===0?p.x:105-p.x)<=52.5);
    }
  }
});
test('all seven restarts put a real pass/shot into play and persist their type in events',()=>{
  for(const type of ['kickoff','throwIn','goalKick','corner','directFreeKick','indirectFreeKick','penalty']){
    const m=createMatch(demoInput({duration:60})),before=m.state.nextEventId;awardRestart(m,type,0,type==='penalty'?{x:94,y:34}:{x:65,y:15},'test');
    until(m,m=>m.events.some(e=>e.type==='restart'&&e.id>=before),300);
    const kick=m.events.find(e=>['pass','shot'].includes(e.type)&&e.id>=before);assert.equal(kick.restartType,type);
    assert.equal(m.state.restartSerial,2);assertWorld(m.state);
    if(['throwIn','goalKick','corner'].includes(type))assert.equal(kick.offside,null);
    if(type==='indirectFreeKick')assert.equal(kick.type,'pass');
  }
});
test('the opening kickoff uses legal halves and clearance and starts with a kick, not a dribble',()=>{
  const m=createMatch(demoInput()),s=m.state;
  assert.equal(s.ball.mode,'flight');assert.equal(s.rules.restartTouch.type,'kickoff');
  const taker=s.ball.flight.from;
  for(const p of s.players){if(p.key===taker)continue;assert.ok((p.side===0?p.x:105-p.x)<=52.5);if(p.side===1)assert.ok(distance(p,{x:52.5,y:34})>=9.15);}
  assert.equal(m.events.filter(e=>e.type==='pass').length,1);
});
function directFlight(type,ownGoal=false){
  const m=createMatch(demoInput({duration:10})),s=m.state;
  for(const p of s.players)Object.assign(p,{x:50,y:10,vx:0,vy:0});
  const x=ownGoal?.5:104.5,target={x:ownGoal?0:105,y:34};
  s.rules.restartTouch={type,kicker:'0:p7',side:0};
  s.ball={mode:'flight',holder:null,x,y:34,z:0,vx:ownGoal?-20:20,vy:0,flight:{kind:'shot',side:0,from:'0:p7',to:null,start:{x,y:34},target,startedAt:0,endsAt:.025,decisionId:1}};
  advanceMatch(m);return m;
}
test('indirect kick/throw-in direct goals and any direct own goal are disallowed with correct restart',()=>{
  for(const type of ['indirectFreeKick','throwIn']){const m=directFlight(type);assert.deepEqual(m.state.score,[0,0]);assert.equal(m.state.restart.type,'goalKick');}
  for(const type of ['directFreeKick','corner','goalKick','kickoff','throwIn','indirectFreeKick']){const m=directFlight(type,true);assert.deepEqual(m.state.score,[0,0]);assert.equal(m.state.restart.type,'corner');}
  assert.deepEqual(directFlight('directFreeKick').state.score,[1,0]);
});
test('restart kicker touching a loose ball again before anyone else yields indirect free kick',()=>{
  const m=createMatch(demoInput({duration:10})),s=m.state,p=playerByKey(s,'0:p7');
  s.rules.restartTouch={type:'indirectFreeKick',kicker:p.key,side:0};
  s.ball={mode:'loose',holder:null,flight:null,x:p.x,y:p.y,z:0,vx:0,vy:0};
  advanceMatch(m);assert.ok(m.events.some(e=>e.type==='doubleTouch'));assert.equal(s.restart.type,'indirectFreeKick');assert.equal(s.restart.side,1);
});
test('foul severity, DOGSO penalty mitigation and field location select the proper sanction/restart',()=>{
  assert.deepEqual(foulSanction({speed:2,dogso:false},.9),{severity:'careless',card:null});
  assert.equal(foulSanction({speed:2,dogso:false},.1).card,'yellow');
  assert.equal(foulSanction({speed:12,dogso:false},.005).card,'red');
  assert.equal(foulSanction({speed:2,dogso:true,penalty:true},.9).card,'yellow');
  assert.equal(foulSanction({speed:2,dogso:true,penalty:false},.9).card,'red');
  for(const x of [80,94]){
    const m=createMatch(demoInput()),s=m.state,d=playerByKey(s,'1:p3'),c=playerByKey(s,'0:p10');Object.assign(c,{x,y:34});Object.assign(d,{x:x-.5,y:34});
    const profile=foulProfile(s,d,c);penalizeFoul(m,d,c,profile,{severity:'careless',card:null});
    assert.equal(s.restart.type,x===94?'penalty':'directFreeKick');assert.equal(s.restart.side,0);
  }
});
test('two cautions dismiss a player; dismissed players cannot plan, move or regain the ball',()=>{
  const m=createMatch(demoInput()),s=m.state,d=playerByKey(s,'1:p3'),c=playerByKey(s,'0:p10');
  for(let i=0;i<2;i++)penalizeFoul(m,d,c,{penalty:false,dogso:false,behind:false},{severity:'reckless',card:'yellow'});
  assert.equal(d.active,false);assert.equal(d.yellowCards,2);assert.equal(s.stats[1].redCards,1);
  assert.ok(!planTasks(s,planCoordination(s)).has(d.key));
  const pos={x:d.x,y:d.y};advanceMatch(m,30);assert.deepEqual({x:d.x,y:d.y},pos);
  assert.ok(!m.events.some(e=>['receive','interception','secondBall','shot','pass'].includes(e.type)&&e.actor===d.key));
});
test('keeper dismissal appoints a field emergency keeper; fewer than seven ends the isolated match',()=>{
  const m=createMatch(demoInput()),s=m.state,c=playerByKey(s,'0:p10'),g=playerByKey(s,'1:p1');
  penalizeFoul(m,g,c,{penalty:false,dogso:true},{severity:'careless',card:'red'});
  assert.equal(activePlayers(s).filter(p=>p.side===1&&p.role==='GK').length,1);assert.ok(m.events.some(e=>e.type==='emergencyKeeper'));
  for(const p of activePlayers(s).filter(p=>p.side===1).slice(0,4))penalizeFoul(m,p,c,{penalty:false,dogso:false},{severity:'excessive',card:'red'});
  assert.equal(s.phase,'finished');assert.equal(s.abandoned,true);
});
test('rule states survive exact checkpoint resume during offside flight and penalty waiting',()=>{
  for(const id of ['offside','penalty','corner','foul']){
    const a=createScenario(id,{seed:'v4-scene-1',duration:20});advanceMatch(a);
    const b=restoreCheckpoint(exportCheckpoint(a));advanceMatch(a,100);advanceMatch(b,100);assert.deepEqual(a,b);
  }
});
test('checkpoint rejects corrupt rule state and older prototype versions',()=>{
  const m=createScenario('penalty',{duration:20}),saved=JSON.parse(exportCheckpoint(m));
  saved.state.restart.type='unknown';assert.throws(()=>restoreCheckpoint(saved),/定位球/);
  const old=JSON.parse(exportCheckpoint(m));old.state.version='4.0.0-prototype.2';assert.throws(()=>restoreCheckpoint(old),/版本/);
});
test('rule replay shows no future whistle and never interpolates the set-piece arrangement',()=>{
  const m=createScenario('offside',{seed:'v4-scene-0',duration:40});advanceMatch(m,200);
  const e=m.events.find(e=>e.type==='offside');assert.ok(!eventsAt(m.events,e.time-.001).some(v=>v.id===e.id));
  assert.equal(sampleReplay(m.frames,e.time).phase,'restart');
  const arranged=m.frames.find(f=>f.restartSerial===1),before=m.frames[m.frames.indexOf(arranged)-1];
  if(arranged.time>before.time)assert.equal(sampleReplay(m.frames,(before.time+arranged.time)/2).players[0].x,before.players[0].x);
});
