import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatchMetrics,estimateShotXg} from '../versus/v4-host/match-metrics.js';
import {createBroadcastSummary} from '../versus/v4-host/broadcast-summary.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {publicEvent,publicFrame,encodeFrames} from '../versus/v4-stream/codec.js';
import {broadcastShotSeries,broadcastDataMarkup} from '../versus/public/broadcast-data.js';
import {sampleKeyPlay} from '../versus/public/broadcast-key-plays.js';
import {createStreamService} from '../versus/v4-stream/http-service.js';
const event=(id,time,type,side=0,extra={})=>({id,time,type,side,actor:`${side}:p1`,position:{x:90,y:34},clock:{baseSeconds:0,elapsed:time,attackDirections:[1,-1]},...extra});

test('possession excludes loose/dead/interval time and shootouts, resumes exactly',()=>{
  const all=[event(1,0,'kickoff'),event(2,10,'pass'),event(3,15,'loose'),event(4,20,'secondBall',1),
    event(5,25,'stoppage',1),event(6,40,'restart',1),event(7,50,'halfTime',null),event(8,100,'restart'),
    event(9,110,'shootoutStart',null),event(10,120,'shot'),event(11,130,'save',1)];
  const a=createMatchMetrics();a.consume(all);
  const b=createMatchMetrics();b.consume(all.slice(0,5));const resumed=createMatchMetrics(b.checkpoint());resumed.consume(all.slice(5));
  assert.deepEqual(resumed.view(140),a.view(140));assert.deepEqual(a.view().stats.map(s=>s.possession),[25,15]);
  assert.deepEqual(a.view().stats.map(s=>s.shots),[0,0]);
});
test('geometric xG is symmetric after changing ends and independent of outcome',()=>{
  const a=event(1,1,'shot'),b={...a,side:1,position:{x:15,y:34}};
  assert.equal(estimateShotXg(a),estimateShotXg(b));
  assert.equal(estimateShotXg({...a,position:{x:15,y:34},clock:{attackDirections:[-1,1]}}),estimateShotXg(a));
  assert.ok(estimateShotXg({...a,position:{x:75,y:34}})<estimateShotXg(a));
  assert.equal(estimateShotXg({...a,restartType:'penalty'}),.76);
  const metrics=createMatchMetrics();metrics.consume([a,event(2,2,'goal',0,{scoringSide:0}),event(3,3,'fulltime',null)]);
  const v=metrics.view(),match={teams:v.stats.map(stats=>({stats})),events:v.events};
  assert.equal(broadcastShotSeries(match).complete,true);assert.equal(broadcastShotSeries(match).shots[0].length,1);
});
test('archive summary consumes only published packets and agrees with event statistics on join/reconnect',async()=>{
  const m=createMatch(demoInput({seed:'broadcast-proof',duration:120,format:'full'}),{frameInterval:1});
  advanceMatch(m,250);
  const first={events:m.events.map(e=>publicEvent(e,null)).filter(Boolean),frames:encodeFrames(m.frames.map(f=>publicFrame(f,null)))};
  const firstTime=m.state.time,firstId=m.state.nextEventId-1;
  while(m.state.phase!=='finished')advanceMatch(m,100);
  const second={events:m.events.filter(e=>e.id>firstId).map(e=>publicEvent(e,null)).filter(Boolean),frames:encodeFrames(m.frames.filter(f=>f.time>firstTime).map(f=>publicFrame(f,null)))};
  const head={matchId:'sample',engineVersion:m.state.version,segments:[{index:0,through:firstTime}],complete:false};
  const reads=[],reader={read:async i=>{reads.push(i);return [first,second][i];}};
  const summary=createBroadcastSummary(m.state.input),early=await summary(reader,head);
  assert.deepEqual(reads,[0]);assert.ok(early.match.events.every(e=>e.time<=firstTime));assert.equal(early.live,true);
  head.segments.push({index:1,through:m.state.time});head.complete=true;
  const final=await summary(reader,head),again=await summary(reader,head);
  assert.deepEqual(final,again);assert.deepEqual(reads,[0,1]);assert.equal(final.live,false);
  const metrics=createMatchMetrics();metrics.consume(m.events);
  assert.deepEqual(final.match.teams.map(t=>t.stats),metrics.view(m.state.time).stats);
  assert.ok(!JSON.stringify(final).includes('decision'));
  assert.equal(broadcastShotSeries(final.match).complete,true);
  assert.ok(!broadcastDataMarkup(final.match,'details').includes('控球回合'));
});
test('V4 key animation interpolates recorded positions without mirrored synthetic shot movement',()=>{
  const p={id:'a',teamIndex:1,x:10,y:20},q={...p,x:30,y:40};
  const sample=sampleKeyPlay({frames:[{time:2,players:[p],ball:{x:5,y:6}},{time:4,players:[q],ball:{x:9,y:10}}]},.5);
  assert.deepEqual(sample.ball,{x:7,y:8});assert.equal(sample.players[0].x,20);assert.equal(sample.players[0].y,30);
});

test('broadcast summary endpoint requires authorization and rejects caller release-time overrides',async()=>{
  let called=0,refreshed=0;
  const service=createStreamService({authorize:async req=>req.headers.authorization==='Bearer valid'?{subject:'viewer',ownerSide:null}:null});
  service.register('sample',{manifest:{matchId:'sample'},refresh:async()=>{refreshed++;},broadcast:async()=>{called++;return {score:[0,0]};}});
  async function get(suffix,token='valid'){
    let status,body;
    await service.handle({url:'/v4/matches/sample/'+suffix,method:'GET',headers:{authorization:'Bearer '+token}},
      {writeHead:s=>{status=s;},end:b=>{body=JSON.parse(b);}});
    return {status,body};
  }
  assert.equal((await get('broadcast','invalid')).status,403);assert.equal(called,0);
  assert.equal((await get('broadcast?until=99999')).status,400);assert.equal(called,0);
  assert.deepEqual(await get('broadcast'),{status:200,body:{score:[0,0]}});assert.equal(refreshed,1);
});
