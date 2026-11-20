import test from 'node:test';
import assert from 'node:assert/strict';
import {createYdlLeagueV2Match,advanceYdlLeagueV2Match,publicYdlLeagueV2Match} from '../versus/v2/ydl-league-engine-adapter.js';
import {V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {makeAssessmentTeam} from '../scripts/engine-assessment-fixtures.mjs';
import {loadV4KeyClip} from '../versus/public/v4-key-clip.js';
import {recordKeyPlays} from '../versus/v3/key-plays.js';
import {sampleKeyPlay,fieldPoint,createKeyPlayQueue,keyPlayEntries,keyPlayShotOrigin,keyPlayDurationMs,prepareGoalPlayback,broadcastMinuteLabel} from '../versus/public/broadcast-key-plays.js';
const teams=()=>['A','B'].map(n=>makeAssessmentTeam(n,{boardLines:true,holdScorePlans:true}));
const create=enabled=>createYdlLeagueV2Match(teams(),{seed:'key-plays-1',parameters:V3_MATCH_PARAMETERS,now:1000,keyPlaysEnabled:enabled});
const finish=m=>advanceYdlLeagueV2Match(m,121001,{maximumChains:Infinity});

test('goal playback starts with recorded movement and ends at the goal line', () => {
  const frame=(time,ballX,playerX)=>({time,ball:{x:ballX,y:5},players:[{id:'p',teamIndex:0,x:playerX,y:5}]});
  const frames=[frame(90,3,7),frame(102,3,7),frame(102.5,3,8),frame(103,5,9),frame(103.5,7,10),frame(105,50,50)];
  const clip=prepareGoalPlayback({frames,replayTime:103.5});
  assert.deepEqual(clip.frames.map(f=>f.time),[0,.5,1,1.5]);
  assert.equal(sampleKeyPlay(clip,.2).players[0].x,7.6);
  assert.equal(sampleKeyPlay(clip,.5).ball.x,4);
  assert.equal(sampleKeyPlay(clip,1).ball.x,7);
  assert.equal(frames[0].time,90);
});

test('goal playback keeps a short internal pause and preserves action-only recordings', () => {
  const frame=(time,x)=>({time,ball:{x,y:0},players:[]});
  const frames=[frame(0,0),frame(1,5),frame(10,5),frame(11,10),frame(12,10)];
  assert.deepEqual(prepareGoalPlayback({frames}).frames.map(f=>f.time),[0,1,1.35,2.35]);
  const actionOnly={actions:[]};
  assert.equal(prepareGoalPlayback(actionOnly),actionOnly);
});

test('broadcast minute labels preserve stoppage minutes and omit fractional minutes', () => {
  for(const [value,label] of [[45.23,'45'],[44.94,'44'],[1.67,'1'],[0,'0'],['90+2','90+2'],['45+2:18','45+2'],[undefined,'—']])
    assert.equal(broadcastMinuteLabel(value),label);
});

test('replay timing follows recorded seconds, with a readable minimum for short clips and untimed actions', () => {
  assert.equal(keyPlayDurationMs({frames:[{time:3810},{time:3823.25}]}), 13250);
  assert.equal(keyPlayDurationMs({frames:[{time:4},{time:6}]}), 6000);
  assert.equal(keyPlayDurationMs({actions:Array(5)}), 9000);
  assert.equal(keyPlayDurationMs(null), 0);
});

test('a report opened before compaction replays the matching saved goal with the same credentials', async t => {
  const identity={playerId:'viewer', accountToken:'test-token'};
  const selected={eventId:'goal-b', replayTime:102};
  const clip={...selected, frames:[{time:101},{time:102}]};
  const requests=[];
  t.mock.method(globalThis,'fetch',async (url,init)=>{
    requests.push([url,JSON.parse(init.body)]);
    return requests.length===1 ? new Response(null,{status:410}) :
      Response.json({match:{keyPlays:[{...clip,eventId:'goal-a'},clip]}});
  });
  assert.deepEqual(await loadV4KeyClip({reportId:'match'},selected,identity),clip);
  assert.deepEqual(requests,[
    ['/api/versus/league/match/tactical-replay',{...identity,matchId:'match',segment:'head'}],
    ['/api/versus/league/match/detail',{...identity,matchId:'match'}],
  ]);
});

test('a denied replay request does not retry through the match report', async t => {
  const fetch=t.mock.method(globalThis,'fetch',async ()=>new Response(null,{status:403}));
  await assert.rejects(loadV4KeyClip({reportId:'match'},{eventId:'goal'},{}),{status:403});
  assert.equal(fetch.mock.callCount(),1);
});

test('recording is a pure observer; events, RNG, positions, scores and fatigue stay identical',()=>{
  const on=create(true),off=create(false);finish(on);finish(off);
  const omit=m=>{const {keyPlaysEnabled,keyPlays,...rest}=m;return rest;};
  assert.deepEqual(JSON.parse(JSON.stringify(omit(on))),JSON.parse(JSON.stringify(omit(off))));
  assert.ok(on.keyPlays.length>0);assert.equal(off.keyPlays.length,0);
  for(const clip of on.keyPlays){
    assert.equal(clip.type,'goal');
    const event=on.events.find(e=>e.id===clip.eventId);
    assert.equal(clip.xg,event.xg);assert.equal(clip.type,event.type);
    assert.equal(clip.zone,event.zone);assert.equal(clip.attackType,event.attackType);
    assert.ok(clip.actions.length<=5);assert.equal(clip.actions.at(-1).toPlayerId,clip.actorId);
    for(const action of clip.actions){
      assert.ok(action.before.some(p=>p.teamIndex===action.teamIndex&&p.id===action.fromPlayerId));
      assert.ok(action.after.some(p=>p.teamIndex===action.teamIndex&&p.id===action.toPlayerId));
      for(const p of [...action.before,...action.after])assert.ok(p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100);
    }
  }
});

test('checkpoint resume retains the same bounded, public-only archive',()=>{
  const match=create(true);advanceYdlLeagueV2Match(match,31000,{maximumChains:35});
  const resumed=JSON.parse(JSON.stringify(match));finish(match);finish(resumed);
  assert.deepEqual(match.keyPlays,resumed.keyPlays);
  const data=publicYdlLeagueV2Match(match).keyPlays;
  assert.ok(data.length>0&&data.length<=32);
  assert.doesNotMatch(JSON.stringify(data),/decisionTrace|pressure|reasons|defenseAssignments|randomState|simulationSeed/);
  data[0].actions[0].before[0].x=-100;
  assert.notEqual(match.keyPlays[0].actions[0].before[0].x,-100);
});

test('unsupported secondary shots or different shooters cannot reuse a misleading buildup',()=>{
  const m=create(true);finish(m);const actions=m.keyPlays[0].actions,last=actions.at(-1);
  const event={id:'test',type:'goal',actorId:last.toPlayerId,attackingTeamIndex:last.teamIndex,xg:.2};
  m.keyPlays=[];
  recordKeyPlays(m,actions,[{...event,attackType:'rebound'},{...event,actorId:'different'}]);
  assert.equal(m.keyPlays.length,0);
  for(let i=0;i<40;i++)recordKeyPlays(m,actions,[{...event,id:'test'+i}]);
  assert.equal(m.keyPlays.length,32);
});

test('sampling uses full-pitch positions and separates identical player IDs by side',()=>{
  const players=[{id:'same',teamIndex:0,x:20,y:70},{id:'same',teamIndex:1,x:30,y:80}];
  const clip={type:'goal',actorId:'same',actions:[{type:'carry',teamIndex:0,fromPlayerId:'same',toPlayerId:'same',before:players,after:players.map(p=>({...p,y:p.y-10}))}]};
  assert.deepEqual(fieldPoint(players[1]),{x:70,y:20});
  const middle=sampleKeyPlay(clip,.25);assert.equal(middle.players[0].y,65);assert.equal(middle.players[1].y,25);
  assert.deepEqual(middle.ball,{x:20,y:65});
  const finish=sampleKeyPlay(clip,1).ball;
  assert.ok(Math.hypot(finish.x-53.5,finish.y-.8)<1e-9);
});

test('zone-based shooting setup avoids end-line shots, distinguishes long shots and mirrors away attacks',()=>{
  for(const side of [0,1])for(const [zone,type] of [['box:farLeft','cutback'],['box:center','individual'],['finalThird:rightHalfSpace','longShot']]) {
    const players=[{id:'shooter',teamIndex:side,x:8,y:1},{id:'keeper',teamIndex:1-side,x:50,y:93}];
    const a={type:'create',teamIndex:side,fromPlayerId:'shooter',toPlayerId:'shooter',before:players,after:players};
    const clip={zone,attackType:type,type:'goal',actorId:'shooter',defenderId:'keeper',actions:[a,{...a,type:type==='longShot'?'longShot':'shoot'}]};
    const before=JSON.stringify(clip),origin=keyPlayShotOrigin(clip);
    assert.ok(origin.y>=10);if(type==='longShot')assert.ok(origin.y>=23);
    assert.ok(origin.x>=22&&origin.x<=78);
    const shot=sampleKeyPlay(clip,2/3);
    assert.deepEqual(shot.ball,fieldPoint({...origin,teamIndex:side}));
    const prev=sampleKeyPlay(clip,2/3-1e-7);
    assert.ok(Math.hypot(prev.ball.x-shot.ball.x,prev.ball.y-shot.ball.y)<.001,'no jump from setup into shot');
    const terminal=sampleKeyPlay(clip,1);
    assert.ok(side===0?terminal.ball.y<2:terminal.ball.y>98);
    assert.equal(JSON.stringify(clip),before,'presentation must not modify source frames');
  }
});

test('old stored clips inherit shot metadata from their matching event',()=>{
  const event={id:'old-goal',type:'goal',zone:'box:leftHalfSpace',attackType:'cutback'};
  const stored={id:'play-old-goal',eventId:event.id,actions:[{type:'shoot'}]};
  const [entry]=keyPlayEntries({events:[event],keyPlays:[stored]});
  assert.equal(entry.clip.zone,event.zone);assert.equal(entry.clip.attackType,event.attackType);
  assert.equal(stored.zone,undefined);
});

test('late V4 goal frames enter autoplay exactly once; old non-goal clips and missed penalties stay out',()=>{
  const queue=createKeyPlayQueue();
  const events=[{id:'s',type:'shot',goal:true},{id:'g',type:'goal'},{id:'r',type:'red'},{id:'p',type:'penaltyShootoutKick',shootoutGoal:true},{id:'m',type:'penaltyShootoutKick',shootoutGoal:false}];
  const poll=ids=>({code:'v4',live:true,match:{engineProfile:'v4-spatial',events,keyPlays:ids.map(eventId=>({eventId,frames:[{time:1},{time:2}]}))}});
  queue.update(poll(['s','m']));assert.equal(queue.next(),null);
  const ready=poll(['s','r','g','m','p']);
  assert.deepEqual(keyPlayEntries(ready.match).map(x=>x.event.id),['g','p']);
  queue.update(ready);assert.equal(queue.next().event.id,'g');assert.equal(queue.next().event.id,'p');
  queue.update(ready);assert.equal(queue.next(),null);
});

test('queue deduplicates polls, skips join history/background, prioritizes new goals and resets matches',()=>{
  const q=createKeyPlayQueue(),wrap=(events,live=true,code='a')=>({code,live,match:{events}});
  const goal=id=>({id,type:'goal'});
  q.update(wrap([goal('old')]));assert.equal(q.next(),null);
  q.update(wrap([goal('old'),goal('new')]));assert.equal(q.next().event.id,'new');
  q.update(wrap([goal('old'),goal('new')]));assert.equal(q.next(),null);
  q.update(wrap([goal('background')]),false);q.update(wrap([goal('background')]));assert.equal(q.next(),null);
  q.update(wrap([goal('joined')],true,'b'));assert.equal(q.next(),null);
  q.update(wrap([goal('ended')],false,'b'));assert.equal(q.next().event.id,'ended','final snapshot may include a new goal');
  q.update(wrap([goal('ended')],false,'b'));assert.equal(q.next(),null);
  assert.equal(keyPlayEntries({events:[{id:'own',type:'ownGoal'}]})[0].clip,null);
});
