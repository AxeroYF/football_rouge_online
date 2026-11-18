import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerReportLedger,legacyScaleRating} from '../versus/v4-host/player-report.js';
import {createMatch,advanceMatch,awardRestart,injurePlayer} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';

function run(input,chunk=50,setup=()=>{}){
  const m=createMatch(input,{recording:false});setup(m);let ledger=createPlayerReportLedger(m.state.input,m.state.version),restored=false;
  while(m.state.phase!=='finished'){
    ledger.consume(m.events);m.events=[];advanceMatch(m,chunk);
    if(!restored&&m.state.time>20){ledger=createPlayerReportLedger(m.state.input,m.state.version,JSON.parse(JSON.stringify(ledger.checkpoint())));restored=true;}
  }
  ledger.consume(m.events);return {report:ledger.finish(m.state),state:m.state};
}

test('bounded player ledger is identical across chunk boundaries and checkpoint restoration',()=>{
  const input=demoInput({duration:600,format:'full',seed:'player-ledger-boundaries'});
  const a=run(input,1),b=run(input,50);assert.deepEqual(a.report,b.report);assert.deepEqual(a.state,b.state);
  assert.equal(a.report.settlementAllowed,false);assert.equal(a.report.teams[0].players.length,11);
  for(const [side,team] of a.report.teams.entries())assert.equal(team.stats.passes,a.state.stats[side].passes);
  assert.equal(a.report.teams.reduce((n,t)=>n+t.stats.possession,0),100);
  assert.ok(a.report.teams.every(t=>Number.isFinite(t.stats.xg)&&t.stats.possessionSeconds>0));
});

test('departed starters and passive replacements appear once; unused substitutes do not gain appearances',()=>{
  const input=demoInput({duration:120,format:'full',seed:'player-ledger-exit'});
  input.teams[0].bench=[{...structuredClone(input.teams[0].players[2]),id:'replacement'},{...structuredClone(input.teams[0].players[0]),id:'unused-keeper'}];
  const {report}=run(input,20,m=>{const p=m.state.players.find(p=>p.key==='0:p3');awardRestart(m,'goalKick',0,{x:5,y:34},'test');injurePlayer(m,p);});
  const players=report.teams[0].players;assert.equal(players.length,12);assert.ok(!players.some(p=>p.id==='unused-keeper'));
  assert.equal(players.find(p=>p.id==='p3').substitutedOut,true);assert.equal(players.find(p=>p.id==='replacement').enteredAsSubstitute,true);
  assert.equal(players.find(p=>p.id==='replacement').substitutedForId,'p3');
});

test('direct assists and own goals are attributed separately and penalty shootouts never inflate regular statistics',()=>{
  const m=createMatch(demoInput({duration:60,format:'full'}),{recording:false}),ledger=createPlayerReportLedger(m.state.input,m.state.version);
  const e=(id,type,actor,extra={})=>({id,type,actor,side:Number(actor?.split(':')[0]??0),time:id,clock:{period:1,baseSeconds:0,elapsed:id},...extra});
  ledger.consume([
    e(1,'pass','0:p7',{target:{x:80,y:34}}),e(2,'receive','0:p10',{decisionId:1}),e(3,'shot','0:p10',{target:{x:105,y:34}}),e(4,'goal','0:p10',{decisionId:3,scoringSide:0,ownGoal:false}),
    e(5,'goal','1:p3',{scoringSide:0,ownGoal:true}),e(6,'shootoutStart',null),e(7,'save','1:p1',{decisionId:3}),e(8,'shootoutGoal','0:p10')
  ]);
  const s=ledger.checkpoint().players;assert.equal(s['0:p7'].assists,1);assert.equal(s['0:p10'].goals,1);assert.equal(s['0:p10'].shotsOnTarget,1);assert.equal(s['1:p3'].ownGoals,1);assert.equal(s['1:p1'].saves,0);
  assert.equal(legacyScaleRating({...s['0:p10'],goals:1,assists:1,saves:0}),7.8);
});

test('period scores use football periods, including added time, and exclude the shootout',()=>{
  const m=createMatch(demoInput({duration:600,format:'full'})),ledger=createPlayerReportLedger(m.state.input,m.state.version);
  const goal=(id,period,elapsed,scoringSide)=>({id,type:'goal',actor:`${scoringSide}:p10`,side:scoringSide,scoringSide,time:id,clock:{period,baseSeconds:(period-1)*2700,elapsed}});
  ledger.consume([goal(1,1,2800,0),goal(2,2,2900,1),goal(3,3,950,0),goal(4,4,960,1),{id:5,type:'shootoutStart'},goal(6,4,1000,0)]);
  assert.deepEqual(ledger.checkpoint().periodGoals,[[1,0],[0,1],[1,0],[0,1]]);
});

test('a deflection or rebound clears the original shot assist as well as the next-pass candidate',()=>{
  for(const type of ['block','deflection','parry','save','miscontrol','secondBall']){
    const m=createMatch(demoInput({duration:60,format:'full'})),ledger=createPlayerReportLedger(m.state.input,m.state.version);
    const e=(id,type,actor,extra={})=>({id,type,actor,side:Number(actor.split(':')[0]),time:id,clock:{period:1,baseSeconds:0,elapsed:id},...extra});
    ledger.consume([e(1,'pass','0:p7',{target:{x:80,y:34}}),e(2,'receive','0:p10',{decisionId:1}),e(3,'shot','0:p10',{target:{x:105,y:34}}),e(4,type,'1:p1',{decisionId:3}),e(5,'goal','0:p10',{decisionId:3,scoringSide:0})]);
    assert.equal(ledger.checkpoint().players['0:p7'].assists,0,type);
  }
});

test('incomplete, duplicate, corrupt and abandoned report inputs cannot be used for settlement',()=>{
  const m=createMatch(demoInput({duration:60,format:'full'}),{recording:false}),ledger=createPlayerReportLedger(m.state.input,m.state.version);
  ledger.consume(m.events);assert.throws(()=>ledger.consume(m.events),/重复或缺失/);assert.throws(()=>ledger.finish(m.state),/不可正常结算/);
  const bad=ledger.checkpoint();bad.players['0:p1'].assists=-1;assert.throws(()=>createPlayerReportLedger(m.state.input,m.state.version,bad),/内容无效/);
  const completed=run(demoInput({duration:60,format:'full'}));const other=createPlayerReportLedger(m.state.input,m.state.version);
  assert.throws(()=>other.finish({...completed.state,abandoned:true}),/不可正常结算/);
});

test('counterpress attribution preserves the frozen engine tackle clock at the three-second floating-point boundary',()=>{
  const m=createMatch(demoInput({duration:60,format:'full'}));
  for(const cause of ['tackle','interception']){
    const ledger=createPlayerReportLedger(m.state.input,m.state.version);
    ledger.consume([
      {id:1,type:'transition',side:1,actor:'1:p7',time:692.4,tick:3461,transition:{from:0,to:1,at:692.4,lossMode:'counterPress',cause:'interception'}},
      {id:2,type:'transition',side:0,actor:'0:p7',time:695.4,tick:3476,transition:{from:1,to:0,at:695.4,lossMode:'regroup',cause}},
    ]);
    assert.equal(ledger.checkpoint().players['0:p7'].pressuresWon,cause==='tackle'?0:1,cause);
  }
});

test('a second-ball header with the original pass decision is neither a completed pass nor an interception',()=>{
  const m=createMatch(demoInput({duration:60,format:'full'}));
  for(const side of [0,1])for(const direct of [false,true]){
    const ledger=createPlayerReportLedger(m.state.input,m.state.version);
    ledger.consume([
      {id:1,type:'pass',actor:'0:p7',side:0,time:1,target:{x:90,y:34}},
      {id:2,type:'shot',actor:`${side}:p10`,side,time:2,bodyPart:'head',decisionId:1,from:direct?'0:p7':null,target:{x:105,y:34}},
    ]);
    const stats=ledger.checkpoint().players;
    assert.equal(stats['0:p7'].completed,direct&&side===0?1:0);
    assert.equal(stats[`${side}:p10`].interceptions,direct&&side===1?1:0);
    assert.equal(stats[`${side}:p10`].headers,1);assert.equal(stats[`${side}:p10`].shots,1);
  }
});
