import test from 'node:test';
import assert from 'node:assert/strict';
import {demoInput} from '../versus/v4/fixtures.js';
import {createMatch,advanceMatch,awardRestart} from '../versus/v4/engine.js';
import {planCoordination} from '../versus/v4/coordination.js';
import {planTasks,actionCandidates,movePlayers} from '../versus/v4/tasks.js';
import {foulProfile} from '../versus/v4/rules.js';
import {playerByKey,coordinates} from '../versus/v4/world.js';
import {captainModifiers} from '../versus/v4/captaincy.js';

function heldMatch(instructions={}){
  const input=demoInput({home:'balanced',away:'balanced',duration:180});input.teams[1].instructions=instructions;
  const m=createMatch(input),s=m.state,p=playerByKey(s,'0:p7');Object.assign(p,{x:45,y:34,vx:0,vy:0,nextDecision:1e6});
  s.ball={mode:'held',holder:p.key,x:p.x,y:p.y,z:0,vx:0,vy:0,flight:null};s.lastOwner=0;s.transition=null;s.lastPass=null;return m;
}
test('specific pressing triggers wait for the actual zone or a recent opponent back pass',()=>{
  const m=heldMatch({press:.95,pressTrigger:'ownHalf'}),s=m.state;
  assert.equal(planCoordination(s)[1].press,null);
  s.players.find(p=>p.key===s.ball.holder).x=70;s.ball.x=70;assert.ok(planCoordination(s)[1].press);
  const n=heldMatch({press:.95,pressTrigger:'backPass'});assert.equal(planCoordination(n.state)[1].press,null);
  n.state.lastPass={side:0,at:0,backward:true};assert.ok(planCoordination(n.state)[1].press);
  n.state.time=5;assert.equal(planCoordination(n.state)[1].press,null);
});
test('screen-first pressing maintains a goal-side gap instead of using the close-down target',()=>{
  const a=heldMatch({press:.95,pressAssignment:'closeDown'}),b=heldMatch({press:.95,pressAssignment:'screen'});
  for(const m of [a,b]){m.state.players.find(p=>p.key===m.state.ball.holder).x=70;m.state.ball.x=70;}
  const ga=planCoordination(a.state),gb=planCoordination(b.state),ka=ga[1].press.presser,kb=gb[1].press.presser;
  const ta=planTasks(a.state,ga).get(ka),tb=planTasks(b.state,gb).get(kb);
  assert.equal(ta.target.x,70);assert.equal(tb.target.x,73);
});
test('near/far corners produce different actual lofted targets, and crossing skill changes execution error',()=>{
  const kick=(routine,crossing)=>{
    const input=demoInput({duration:180});input.teams[0].instructions={setPieceRoutine:routine};for(const p of input.teams[0].players)p.attributes.crossing=crossing;
    const m=createMatch(input);awardRestart(m,'corner',0,{x:104.9,y:.1},'test');
    for(let i=0;i<300&&!m.events.some(e=>e.type==='pass'&&e.restartType==='corner');i++)advanceMatch(m);
    const e=m.events.find(e=>e.type==='pass'&&e.restartType==='corner');assert.equal(e.trajectory,'loft');assert.equal(e.intent,'cross');return e;
  };
  const near=kick('near',90),far=kick('far',90),poor=kick('far',40);
  assert.ok(near.target.y<far.target.y);assert.ok(poor.execution.errorRange>far.execution.errorRange);assert.ok(far.execution.skill>poor.execution.skill);
});
test('discipline affects contact-foul risk and agility affects a physical change of direction',()=>{
  const s=heldMatch().state,carrier=playerByKey(s,'0:p7'),defender=playerByKey(s,'1:p7');
  defender.attributes.discipline=40;const low=foulProfile(s,defender,carrier).probability;defender.attributes.discipline=90;assert.ok(foulProfile(s,defender,carrier).probability<low);
  const run=agility=>{const m=heldMatch(),s=m.state,p=playerByKey(s,'0:p7');p.attributes.agility=agility;const tasks=planTasks(s);tasks.set(p.key,{type:'run',target:{x:p.x+10,y:p.y},reason:'test',partners:[]});const x=p.x;movePlayers(s,tasks);return playerByKey(s,p.key).x-x;};
  assert.ok(run(90)>run(40));
});
test('vision can reveal a distant pass, while a departed captain loses the locked leadership effect',()=>{
  const m=heldMatch(),s=m.state,p=playerByKey(s,'0:p7'),receiver=playerByKey(s,'0:p10');Object.assign(p,{x:30,y:34});s.ball.x=30;Object.assign(receiver,{x:77.5,y:34});
  p.attributes.vision=40;assert.ok(!actionCandidates(s,p).some(c=>c.to===receiver.key));p.attributes.vision=95;assert.ok(actionCandidates(s,p).some(c=>c.to===receiver.key));
  const input=demoInput();input.teams[0].captainId='p7';input.teams[0].captainPlans={level:{stage:{},foulMultiplier:.9,cardMultiplier:.9,directRedMultiplier:.9}};
  const a=createMatch(input).state;assert.equal(captainModifiers(a,0).foulMultiplier,.9);playerByKey(a,'0:p7').active=false;assert.equal(captainModifiers(a,0).foulMultiplier,1);
});

test('maximum finishing retains physical execution variation and still improves accuracy over lower skill',()=>{
  const kick=finishing=>{
    const input=demoInput({duration:180,seed:'execution-floor'});
    for(const p of input.teams[0].players){p.attributes.finishing=finishing;p.attributes.longShots=finishing;}
    const m=createMatch(input);awardRestart(m,'penalty',0,{x:94,y:34},'test');
    for(let i=0;i<300&&!m.events.some(e=>e.type==='shot');i++)advanceMatch(m);
    return m.events.find(e=>e.type==='shot');
  };
  const elite=kick(100),ordinary=kick(70);
  assert.ok(elite.execution.errorRange>=.3);assert.notEqual(elite.execution.deviation,0);
  assert.ok(elite.execution.errorRange<ordinary.execution.errorRange);
});

test('goalkeeper possession recruits staggered midfield outlets from an advanced real-style formation',()=>{
  const input=demoInput();for(const p of input.teams[0].players)if(['CM','DM'].includes(p.role))p.anchor.x+=15;
  const s=createMatch(input).state,gk=playerByKey(s,'0:p1');Object.assign(gk,{x:5,y:34});
  s.ball={mode:'held',holder:gk.key,x:5,y:34,z:0,vx:0,vy:0,flight:null};s.lastOwner=0;s.transition=null;
  const groups=planCoordination(s),tasks=planTasks(s,groups),outlets=groups[0].support.map(key=>tasks.get(key));
  assert.equal(outlets.length,2);assert.ok(outlets.every(task=>task.type==='support'&&task.target.x>=15&&task.target.x<=45));
  assert.ok(Math.abs(outlets[0].target.x-outlets[1].target.x)>=8);assert.ok((outlets[0].target.y-34)*(outlets[1].target.y-34)<0);
});

test('a moving receiver is led according to flight time; stationary receivers keep their actual location',()=>{
  const s=heldMatch().state,p=playerByKey(s,'0:p7'),receiver=playerByKey(s,'0:p10');Object.assign(p,{x:30,y:34});s.ball.x=30;
  Object.assign(receiver,{x:55,y:34,vx:6,vy:0});
  const running=actionCandidates(s,p).find(c=>c.to===receiver.key&&c.trajectory!=='loft');assert.ok(running.target.x>59);assert.ok(running.leadSeconds>.9);
  receiver.vx=0;const stopped=actionCandidates(s,p).find(c=>c.to===receiver.key&&c.trajectory!=='loft');assert.equal(stopped.target.x,55);assert.equal(stopped.target.y,34);
  receiver.vx=-6;const approaching=actionCandidates(s,p).find(c=>c.to===receiver.key&&c.trajectory!=='loft');
  const flight=Math.hypot(approaching.target.x-p.x,approaching.target.y-p.y)/(22+p.attributes.passing*.035);
  assert.ok(Math.abs(flight-approaching.leadSeconds)<1e-9);assert.ok(approaching.leadSeconds<25/(22+p.attributes.passing*.035));
});

test('a receiver brakes into the arrival point without teleporting or oscillating through it at full speed',()=>{
  const s=heldMatch().state,p=playerByKey(s,'0:p7');Object.assign(p,{x:30,y:34,vx:7,vy:0});
  for(const q of s.players)if(q.key!==p.key){q.x=90;q.y=60;}
  const tasks=planTasks(s);tasks.set(p.key,{type:'receive',target:{x:36,y:34},reason:'test',partners:[]});
  for(let i=0;i<15;i++){const before=playerByKey(s,p.key).x;movePlayers(s,tasks);assert.ok(Math.abs(playerByKey(s,p.key).x-before)<1.6);}
  const arrived=playerByKey(s,p.key);assert.ok(Math.abs(arrived.x-36)<.5);assert.ok(Math.hypot(arrived.vx,arrived.vy)<1);
});

test('keeper tracks a released shot after the reflex delay, without anticipating its future destination',()=>{
  const s=heldMatch().state,keeper=playerByKey(s,'1:p1');s.time=10;keeper.attributes.reflexes=90;
  s.ball={mode:'flight',holder:null,x:85,y:30,z:0,vx:28,vy:4,flight:{kind:'shot',side:0,startedAt:10,from:'0:p10',to:null,target:{x:105,y:32.857},endsAt:11}};
  const before=planTasks(s).get(keeper.key),position={x:keeper.x,y:keeper.y};s.time=10.2;
  const after=planTasks(s).get(keeper.key);assert.notEqual(before.target.y,after.target.y);assert.match(after.reason,/反应时间/);
  assert.deepEqual({x:keeper.x,y:keeper.y},position);
});
