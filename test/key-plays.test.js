import test from 'node:test';
import assert from 'node:assert/strict';
import {createYdlLeagueV2Match,advanceYdlLeagueV2Match,publicYdlLeagueV2Match} from '../versus/v2/ydl-league-engine-adapter.js';
import {V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {makeAssessmentTeam} from '../scripts/engine-assessment-fixtures.mjs';
import {recordKeyPlays} from '../versus/v3/key-plays.js';
import {sampleKeyPlay,fieldPoint,createKeyPlayQueue,keyPlayEntries,keyPlayShotOrigin} from '../versus/public/broadcast-key-plays.js';
const teams=()=>['A','B'].map(n=>makeAssessmentTeam(n,{boardLines:true,holdScorePlans:true}));
const create=enabled=>createYdlLeagueV2Match(teams(),{seed:'key-plays-1',parameters:V3_MATCH_PARAMETERS,now:1000,keyPlaysEnabled:enabled});
const finish=m=>advanceYdlLeagueV2Match(m,121001,{maximumChains:Infinity});

test('recording is a pure observer; events, RNG, positions, scores and fatigue stay identical',()=>{
  const on=create(true),off=create(false);finish(on);finish(off);
  const omit=m=>{const {keyPlaysEnabled,keyPlays,...rest}=m;return rest;};
  assert.deepEqual(JSON.parse(JSON.stringify(omit(on))),JSON.parse(JSON.stringify(omit(off))));
  assert.ok(on.keyPlays.length>0);assert.equal(off.keyPlays.length,0);
  for(const clip of on.keyPlays){
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
  const stored={id:'play-old-goal',eventId:event.id,actions:[]};
  const [entry]=keyPlayEntries({events:[event],keyPlays:[stored]});
  assert.equal(entry.clip.zone,event.zone);assert.equal(entry.clip.attackType,event.attackType);
  assert.equal(stored.zone,undefined);
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
