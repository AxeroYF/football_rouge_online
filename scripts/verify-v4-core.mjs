import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {simulateMatch,advanceMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {distance} from '../versus/v4/world.js';
import {createScenario,SCENARIOS} from '../versus/v4/scenarios.js';

const output=path.resolve(process.env.V4_VERIFY_OUTPUT??'outputs/v4-real-teams-20261117');fs.mkdirSync(output,{recursive:true});
const sourceHashes=Object.fromEntries(fs.readdirSync('versus/v4').filter(f=>f.endsWith('.js')).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join('versus/v4',f))).digest('hex')]));
const matches=[];
for(const home of ['balanced','left','press','counter'])for(const away of ['balanced','left','press','counter'])for(let seed=0;seed<3;seed++){
  const start=performance.now();
  const m=simulateMatch(demoInput({home,away,seed:`matrix-${seed}`,duration:180}),{recording:false});
  assert.equal(m.state.phase,'finished');
  for(let i=1;i<m.events.length;i++)assert.ok(m.events[i].time>=m.events[i-1].time);
  for(const e of m.events)if(e.contact)assert.ok(distance(e.contact.point,e.contact.playerPoint)<=e.contact.radius+1e-6);
  matches.push({home,away,seed,score:m.state.score,events:m.events.length,ms:performance.now()-start,stats:m.state.stats,
    eventTypes:m.events.reduce((all,e)=>(all[e.type]=(all[e.type]??0)+1,all),{})});
}
const start=performance.now(),long=simulateMatch(demoInput({duration:600}));
for(let i=1;i<long.frames.length;i++)assert.ok(long.frames[i].time>=long.frames[i-1].time);
const longRun={duration:600,frames:long.frames.length,events:long.events.length,score:long.state.score,
  jsonBytes:Buffer.byteLength(JSON.stringify(long)),ms:performance.now()-start};
const report={passed:true,sourceHashes,matches:matches.length,footballSecondsPerMatch:180,environment:'local unrestricted Node.js, synthetic isolated state; not cloud or capacity acceptance',longRun,results:matches};
const fullStart=performance.now(),full=simulateMatch(demoInput({duration:5400,seed:'period-recording'}));
const half=full.events.find(e=>e.type==='halfTime'),ends=full.events.find(e=>e.type==='endsChanged');
assert.equal(ends.time-half.time,900);assert.equal(full.state.clock.completed.length,2);
assert.ok(full.frames.at(-1).time>6300);assert.equal(full.frames.at(-1).phase,'finished');
for(let i=1;i<full.frames.length;i++)assert.ok(full.frames[i].time>=full.frames[i-1].time);
report.fullRun={duration:5400,simulationSeconds:full.state.time,frames:full.frames.length,events:full.events.length,
  jsonBytes:Buffer.byteLength(JSON.stringify(full)),ms:performance.now()-fullStart,periods:full.state.clock.completed};
const scenarios={};
for(const id of Object.keys(SCENARIOS)){
  const m=createScenario(id,{seed:id==='firstTouch'?'v4-scene-2':id==='penalty'?'v4-scene-0':id==='foul'?'v4-foul-10':'v4-scene-1',duration:90});advanceMatch(m,4);
  const resumed=restoreCheckpoint(exportCheckpoint(m));while(m.state.phase!=='finished')advanceMatch(m,250);while(resumed.state.phase!=='finished')advanceMatch(resumed,250);assert.deepEqual(m,resumed);
  scenarios[id]={passed:true,score:m.state.score,stats:m.state.stats,events:m.events};
}
assert.ok(scenarios.firstTouch.events.some(e=>e.type==='miscontrol'));
assert.ok(scenarios.parry.events.some(e=>e.type==='parry'));
assert.ok(scenarios.secondBall.events.some(e=>e.type==='secondBall'));
assert.ok(scenarios.offside.events.some(e=>e.type==='offside'));
assert.ok(scenarios.foul.events.some(e=>e.type==='foul'));
for(const [id,type] of [['freeKick','directFreeKick'],['corner','corner'],['penalty','penalty']])assert.ok(scenarios[id].events.some(e=>e.type==='restart'&&e.restartType===type));
assert.ok(scenarios.periods.events.some(e=>e.type==='endsChanged'));
assert.equal(scenarios.shootingLane.events.find(e=>e.decision)?.type,'shot');
assert.equal(scenarios.blockedFinish.events.find(e=>e.decision)?.intent,'layoff');
assert.ok(scenarios.pressEscape.events.some(e=>e.type==='pressBeaten'));
assert.ok(scenarios.weakSide.events.some(e=>e.decision?.considered?.weakSide));
assert.ok(scenarios.cutback.events.some(e=>e.intent==='cutback'));
assert.ok(scenarios.aerialCross.events.some(e=>e.bodyPart==='head'));
assert.ok(scenarios.postRebound.events.some(e=>e.type==='woodwork'));
assert.ok(scenarios.highMiss.events.some(e=>e.type==='out'&&e.position.z>2.44));
assert.ok(scenarios.injuryExit.events.some(e=>e.type==='substitution'&&e.cause==='injury'));
assert.ok(scenarios.keeperDismissal.events.some(e=>e.type==='substitution'&&e.cause==='red'));
const knockoutInput=demoInput({duration:60,format:'full',seed:'competition-proof'});knockoutInput.competition={resolution:'extraTimeAndPenalties'};
const knockout=simulateMatch(knockoutInput);assert.equal(knockout.state.clock.completed.length,4);assert.equal(knockout.state.result.method,'penalties');
report.knockout={periods:knockout.state.clock.completed,score:knockout.state.score,result:knockout.state.result,kicks:knockout.state.shootout.kicks.length,simulationSeconds:knockout.state.time};
// Exercise real 45/45/15/15 minute lengths, not only the fast browser fixture.
// Find a natural regulation draw; no score or probability changes are allowed.
for(let seed=0;seed<16&&!report.fullExtraTime;seed++){
  const input=demoInput({duration:5400,home:'balanced',away:'counter',seed:`capability-train-${seed}`});input.competition={resolution:'extraTimeAndPenalties'};
  const m=simulateMatch(input,{recording:false});if(m.state.clock.completed.length!==4)continue;
  assert.deepEqual(m.state.clock.periodLengths,[2700,2700,900,900]);
  for(const p of m.state.clock.completed)assert.ok(p.elapsed>=m.state.clock.periodLengths[p.period-1]+p.announced);
  report.fullExtraTime={seed:input.seed,periods:m.state.clock.completed,score:m.state.score,result:m.state.result,simulationSeconds:m.state.time};
}
assert.ok(report.fullExtraTime,'real-duration extra-time fixture must execute');
fs.writeFileSync(path.join(output,'scenarios.json'),JSON.stringify(scenarios,null,2));
fs.writeFileSync(path.join(output,'core-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,matches:matches.length,longRun,output}));
