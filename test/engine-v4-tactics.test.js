import test from 'node:test';
import assert from 'node:assert/strict';
import {demoInput} from '../versus/v4/fixtures.js';
import {createMatch,advanceMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {effectiveTactics,tacticalMode} from '../versus/v4/tactical-plan.js';
import {planCoordination} from '../versus/v4/coordination.js';
import {planTasks,actionCandidates} from '../versus/v4/tasks.js';
import {playerByKey,coordinates} from '../versus/v4/world.js';
import {sampleReplay,eventsAt} from '../versus/v4/replay.js';
import {updateProgress,progressUrgency,controlPlan} from '../versus/v4/tempo.js';
import {explainEvent} from '../versus/v4/explanation.js';

const input=()=>demoInput({duration:60,home:'balanced',away:'balanced'});
test('score plans require both score gap and time, and new formation targets do not teleport players',()=>{
  const config=demoInput({duration:5400});config.teams[0].scorePlans={leading:{press:.2}};
  config.teams[0].scoreTriggers={leading:{goalDifference:2,afterMinute:60}};
  config.teams[0].players[1].anchorPlans={leading:{x:15,y:12}};
  const m=createMatch(config),s=m.state;s.score=[2,0];assert.equal(tacticalMode(s,0),'normal');
  s.clock.period=2;s.clock.elapsed=900;s.score=[1,0];assert.equal(tacticalMode(s,0),'normal');s.score=[2,0];assert.equal(tacticalMode(s,0),'leading');
  const before={x:s.players[1].x,y:s.players[1].y};advanceMatch(m);
  const p=playerByKey(s,'0:p2');assert.deepEqual(p.anchor,{x:15,y:12});assert.ok(Math.hypot(p.x-before.x,p.y-before.y)<2);
  s.score=[0,0];advanceMatch(m);assert.deepEqual(playerByKey(s,'0:p2').anchor,config.teams[0].players[1].anchor);
  assert.deepEqual(restoreCheckpoint(exportCheckpoint(m)),m);
});

test('valid formations without a defensive midfielder can kick off',()=>{
  const config=input();for(const team of config.teams)team.players.find(p=>p.role==='DM').role='CM';
  assert.ok(createMatch(config).events.some(e=>e.type==='kickoff'));
});
function held(s,key,x=65,y=34){const p=playerByKey(s,key);Object.assign(p,{x,y,vx:0,vy:0,nextDecision:100});s.ball={mode:'held',holder:key,x,y,z:0,vx:0,vy:0,flight:null};s.lastOwner=p.side;s.rules={offside:null,restartTouch:null};return p;}

test('right overlap keeps its own flank covered until physical recovery',()=>{
  const a=input();a.teams[0].instructions={route:'right',overlap:true};const s=createMatch(a).state;held(s,'0:p11',65,56);
  let g=planCoordination(s);assert.equal(g[0].overlap.runner,'0:p5');assert.equal(g[0].overlap.flank,'right');
  assert.equal(planTasks(s,g).get('0:p5').target.y,63);assert.equal(planTasks(s,g).get(g[0].overlap.cover).target.y,50);
  playerByKey(s,'0:p5').x=80;s.coordination=g;held(s,'1:p7',60,50);g=planCoordination(s);
  assert.equal(g[0].overlap.phase,'returning');assert.equal(planTasks(s,g).get(g[0].overlap.cover).type,'coverOverlap');
  s.coordination=g;Object.assign(playerByKey(s,'0:p5'),{x:27,y:59});assert.equal(planCoordination(s)[0].overlap,null);
});

test('a deep wide carrier has distinct onside central and far-post run targets',()=>{
  const s=createMatch(input()).state;held(s,'0:p9',90,12);
  const tasks=planTasks(s),striker=tasks.get('0:p10');
  assert.equal(striker.type,'run');assert.ok(striker.target.x<90);assert.ok(Math.abs(striker.target.y-34)<6);
  const far=tasks.get('0:p11');assert.ok(far.target.x<90);assert.ok(far.target.y>striker.target.y);
});

test('progress memory resets on real advance, turnover and restart; clock plan changes observation',()=>{
  const s=createMatch(input()).state,p=held(s,'0:p7',40,34);updateProgress(s);s.time=15;
  assert.ok(progressUrgency(s,0)>0);p.x=45;updateProgress(s);assert.equal(progressUrgency(s,0),0);
  s.time=30;held(s,'1:p7',60,34);updateProgress(s);assert.equal(s.progress.side,1);assert.equal(progressUrgency(s,1),0);
  s.time=45;s.restartSerial++;updateProgress(s);assert.equal(s.progress.at,45);
  const quick=input(),slow=input();quick.teams[0].instructions={clockManagement:'quick'};slow.teams[0].instructions={clockManagement:'slow'};
  const q=createMatch(quick).state,l=createMatch(slow).state;
  assert.ok(controlPlan(l,l.players[6],0).duration>controlPlan(q,q.players[6],0).duration);
});

test('explanations link physical outcomes to the original choice without future leakage or mutation',()=>{
  const sequence={possession:2,restart:0},events=[
    {id:1,time:1,type:'pressCoordination',sequence,text:'封线'},
    {id:2,time:2,type:'pass',sequence,decision:{candidates:[{utility:1}],comparison:'回做'},text:'传球'},
    {id:3,time:3,type:'miscontrol',decisionId:2,sequence,text:'未停稳'},
    {id:4,time:4,type:'goal',sequence,text:'进球'}];
  assert.equal(explainEvent(events,3,2),null);const chain=explainEvent(events,3,3);
  assert.equal(chain.decision.id,2);assert.equal(chain.context[0].relation,'context');assert.equal(chain.outcome.relation,'physicalOutcome');
  chain.decision.candidates[0].utility=99;assert.equal(events[1].decision.candidates[0].utility,1);
  assert.equal(JSON.stringify(chain).includes('进球'),false);
});

test('individual instruction overrides are locked and preserve all unrelated preset fields',()=>{
  const a=input(),b=structuredClone(a);b.teams[0].instructions={width:1.1};
  const first=createMatch(a),second=createMatch(b),t1=effectiveTactics(first.state,0),t2=effectiveTactics(second.state,0);
  assert.equal(t2.width,1.1);for(const key of Object.keys(t1).filter(k=>k!=='width'))assert.equal(t2[key],t1[key]);
  assert.equal(Object.isFrozen(second.state.input.teams[0].instructions),true);
  for(const patch of [{press:2},{directness:NaN},{route:'up'},{unknown:1},{overlap:1}]){const bad=input();bad.teams[0].instructions=patch;assert.throws(()=>createMatch(bad),/战术|套上/);}
});

test('score plans inherit default instructions, switch only after actual score changes, and recover exactly',()=>{
  const config=input();config.teams[0].instructions={width:1,press:.5};config.teams[0].scorePlans={leading:{press:.2,clockManagement:'slow'},trailing:{directness:.9}};
  const m=createMatch(config),s=m.state;assert.equal(tacticalMode(s,0),'normal');assert.equal(effectiveTactics(s,0).press,.5);
  advanceMatch(m,5);s.score=[1,0];const changeAt=s.time;advanceMatch(m);
  assert.equal(s.activePlans[0],'leading');assert.equal(effectiveTactics(s,0).width,1);assert.equal(effectiveTactics(s,0).press,.2);
  assert.ok(!eventsAt(m.events,changeAt-.001).some(e=>e.type==='tacticalPlanChanged'));
  assert.equal(sampleReplay(m.frames,changeAt-.001).activePlans[0],'normal');
  const b=restoreCheckpoint(exportCheckpoint(m));advanceMatch(m,8);advanceMatch(b,8);assert.deepEqual(m,b);
  s.score=[1,2];advanceMatch(m);assert.equal(s.activePlans[0],'trailing');assert.equal(effectiveTactics(s,0).press,.5);assert.equal(effectiveTactics(s,0).directness,.9);
  s.score=[2,2];advanceMatch(m);assert.equal(s.activePlans[0],'normal');
});

test('width and defensive line produce observable targets before any result is known',()=>{
  const a=input(),b=input();a.teams[0].instructions={width:.5};b.teams[0].instructions={width:1.1};
  const low=createMatch(a).state,wide=createMatch(b).state;held(low,'0:p7');held(wide,'0:p7');
  assert.ok(Math.abs(planTasks(wide).get('0:p9').target.y-34)>Math.abs(planTasks(low).get('0:p9').target.y-34));
  a.teams[1].instructions={lineHeight:.2};b.teams[1].instructions={lineHeight:.8};
  const deep=createMatch(a).state,high=createMatch(b).state;held(deep,'0:p7',40,34);held(high,'0:p7',40,34);
  for(const s of [deep,high])for(const p of s.players.filter(p=>p.side===0&&p.key!=='0:p7'))p.x=30;
  const local=(s,t)=>coordinates(s).localPoint(t,1).x;
  assert.ok(local(high,planTasks(high).get('1:p3').target)>local(deep,planTasks(deep).get('1:p3').target));
});

test('rest defense allocates distinct players and excludes them from the support triangle',()=>{
  for(const [mode,count] of [['adventurous',2],['balanced',3],['conservative',4]]){
    const a=input();a.teams[0].instructions={restDefense:mode};const s=createMatch(a).state;held(s,'0:p10');
    const group=planCoordination(s)[0];assert.equal(group.restDefense.length,count);assert.equal(new Set(group.restDefense).size,count);
    assert.ok(group.support.every(key=>!group.restDefense.includes(key)));
    const tasks=planTasks(s);for(const key of group.restDefense)assert.equal(tasks.get(key).type,'hold');
  }
});

test('a beaten presser must recover on the goal side before rejoining the press',()=>{
  const a=input();a.teams[1].instructions={press:.95};const s=createMatch(a).state;held(s,'0:p7',65,34);
  const p=playerByKey(s,'1:p7');Object.assign(p,{x:60,y:34});
  s.coordination[1]={press:{presser:p.key,until:10},recoverers:[]};
  const groups=planCoordination(s);assert.ok(groups[1].recoverers.includes(p.key));assert.notEqual(groups[1].press?.presser,p.key);
  assert.equal(planTasks(s,groups).get(p.key).type,'recover');
  s.coordination=groups;p.x=70;assert.ok(!planCoordination(s)[1].recoverers.includes(p.key));
});

test('a crowded flank can reveal a real weak-side pass and a central cutback option',()=>{
  const s=createMatch(input()).state,carrier=held(s,'0:p9',80,12);
  for(const p of s.players.filter(p=>p.side===1))Object.assign(p,{x:45,y:34});
  Object.assign(playerByKey(s,'1:p2'),{x:80,y:14});Object.assign(playerByKey(s,'1:p3'),{x:78,y:17});Object.assign(playerByKey(s,'1:p4'),{x:76,y:10});
  Object.assign(playerByKey(s,'0:p11'),{x:80,y:58});Object.assign(playerByKey(s,'0:p10'),{x:84,y:34});
  const options=actionCandidates(s,carrier);assert.ok(options.some(c=>c.to==='0:p11'&&c.intent==='switch'));
  // A safe ground cutback is evaluated when the local passing line is actually open.
  Object.assign(playerByKey(s,'1:p2'),{x:65,y:5});Object.assign(playerByKey(s,'1:p3'),{x:63,y:6});Object.assign(playerByKey(s,'1:p4'),{x:61,y:7});
  assert.ok(actionCandidates(s,carrier).some(c=>c.to==='0:p10'&&c.intent==='cutback'));
});
