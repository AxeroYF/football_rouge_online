import test from 'node:test';
import assert from 'node:assert/strict';
import {demoInput} from '../versus/v4/fixtures.js';
import {createMatch,advanceMatch,awardRestart,injurePlayer,penalizeFoul,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {YDL_TRAIT_BY_ID} from '../versus/trait-pool.js';
import {createMatchMetrics} from '../versus/v4-host/match-metrics.js';
import {refreshPlayerEffects} from '../versus/v4/player-effects.js';
import {playerByKey,assertWorld} from '../versus/v4/world.js';
import {positionExecution} from '../versus/v4/execution.js';
import {publicEvent} from '../versus/v4-stream/codec.js';

function config(options={}){
  const input=structuredClone(createMatch(demoInput({duration:180,...options})).state.input);input.playerEffects=true;
  for(const team of input.teams){team.sourcePlans={normal:{style:'possession',tactic:'balanced'},leading:{style:'possession',tactic:'balanced'},trailing:{style:'possession',tactic:'balanced'}};team.sourceBondCatalog=[];
    for(const p of team.players){p.baseAttributes={...p.attributes};p.baseHeightCm=p.heightCm;p.traitDefinitions=[];p.upgradeLevel=0;}}
  return input;
}
test('conditional attributes recompute from the base and active bonds disappear when the eleven is reduced',()=>{
  const input=config();input.teams[0].players[9].traitDefinitions=[{id:'late',rules:[{hook:'allAttributes',multiply:1.1,when:{minuteGte:60}}]}];
  input.teams[0].sourcePlans.normal.possessionStyle='balanced';
  const s=createMatch(input).state,p=playerByKey(s,'0:p10'),initial=p.attributes.finishing;
  s.clock.elapsed=3600;refreshPlayerEffects(s);const enhanced=p.attributes.finishing;assert.ok(enhanced>initial);
  assert.deepEqual(refreshPlayerEffects(s),[]);assert.equal(p.attributes.finishing,enhanced);
  assert.equal(p.attributes.workRate,Math.min(99,p.baseAttributes.workRate*1.1+5));
  playerByKey(s,'0:p2').active=false;refreshPlayerEffects(s);assert.equal(p.attributes.workRate,Math.min(99,p.baseAttributes.workRate*1.1));
  assert.equal(s.activeBonds[0].length,0);assert.equal(p.attributes.finishing,Math.min(99,p.baseAttributes.finishing*1.1));
});
test('fixed fitness, conditional position familiarity and injury transfer operate on actual current players',()=>{
  const input=config();input.teams[0].players[6].traitDefinitions=[{id:'fixed',rules:[{hook:'fixedFitness',value:94},{hook:'position',familiarRoles:['ST'],when:{scoreState:'leading'}}]}];
  input.teams[0].players[7].traitDefinitions=[{id:'protect',rules:[{hook:'teamInjuryTransfer',transferToSelf:true}]}];
  const m=createMatch(input),s=m.state,p=playerByKey(s,'0:p7');p.sourceRole='ST';p.positionFitByRole={ST:.66};refreshPlayerEffects(s);
  assert.equal(p.fitness,94);assert.ok(positionExecution(p)<1);s.score=[1,0];refreshPlayerEffects(s);assert.equal(positionExecution(p),1);
  awardRestart(m,'throwIn',0,{x:40,y:0},'fixture');injurePlayer(m,p);assert.equal(p.active,true);
  assert.equal(playerByKey(s,'0:p8').active,false);assert.equal(playerByKey(s,'0:p8').injury.cause,'traitTransfer');assert.equal(s.stats[0].injuries,1);
});
test('the explicit red-immunity game exception retains yellow counts and survives checkpoint validation',()=>{
  const input=config();input.teams[1].players[6].traitDefinitions=[{id:'immune',rules:[{hook:'redCardImmune',immune:true}]}];
  const m=createMatch(input),s=m.state,defender=playerByKey(s,'1:p7'),carrier=playerByKey(s,'0:p7');
  for(let i=0;i<3;i++)penalizeFoul(m,defender,carrier,{speed:2,penalty:false,behind:false,dogso:false},{severity:'excessive',card:'red'});
  assert.equal(defender.active,true);assert.equal(defender.yellowCards,3);assert.equal(s.stats[1].redCards,0);assert.equal(s.stats[1].yellowCards,3);
  assertWorld(s);assert.deepEqual(restoreCheckpoint(exportCheckpoint(m)),m);
});
test('effect detail is available only to the affected side in the publication projection',()=>{
  const event={id:1,time:1,type:'playerEffectsChanged',side:0,text:'更新',effects:{bonds:[{id:'private'}]}};
  assert.equal(publicEvent(event,null),null);assert.equal(publicEvent(event,1),null);assert.equal(publicEvent(event,0).effects.bonds[0].id,'private');
});

function until(match,condition){
  for(let i=0;i<2000&&!condition();i++)advanceMatch(match);
  assert.ok(condition(),'场景应在限定时间内完成');
}

test('一夫当关经实际点球射门和触球扑救，仅消耗一次，断点恢复后保持结果',()=>{
  const input=config(),keeperKey='1:p1';
  input.teams[1].players[0].traitDefinitions=[YDL_TRAIT_BY_ID['muddy-knees']];
  const m=createMatch(input);
  awardRestart(m,'penalty',0,{x:94,y:34},'测试点球');
  until(m,()=>m.state.ball.flight?.restartType==='penalty');
  assert.equal(m.state.ball.flight.guaranteedKeeper,keeperKey);
  const resumed=restoreCheckpoint(exportCheckpoint(m));
  for(const match of [m,resumed]){
    until(match,()=>match.events.some(e=>e.type==='save'));
    const save=match.events.find(e=>e.type==='save');
    assert.equal(save.actor,keeperKey);assert.match(save.text,/一夫当关/);assert.ok(save.contact);
    assert.equal(match.state.ball.holder,keeperKey);assert.deepEqual(match.state.score,[0,0]);
    const metrics=createMatchMetrics();metrics.consume(match.events);
    assert.equal(metrics.view().stats[1].saves,1);assert.equal(metrics.view().stats[0].shotsOnTarget,1);
    awardRestart(match,'penalty',0,{x:94,y:34},'第二粒点球');
    until(match,()=>match.state.ball.flight?.restartType==='penalty');
    assert.equal(match.state.ball.flight.guaranteedKeeper,undefined);
  }
  assert.deepEqual(m,resumed);
});

test('两队门将在点球大战各自触发一夫当关一次，大战扑救不计常规数据',()=>{
  const input=config({duration:60,format:'full',seed:'competition-proof'});
  input.competition={resolution:'penalties'};
  for(const team of input.teams)team.players[0].traitDefinitions=[YDL_TRAIT_BY_ID['muddy-knees']];
  const m=createMatch(input);until(m,()=>m.state.phase==='finished');
  const saves=m.events.filter(e=>e.type==='save'&&e.text.includes('一夫当关'));
  assert.deepEqual(saves.map(e=>e.side).sort(),[0,1]);
  const results=m.events.filter(e=>e.type==='shootoutResult');
  for(const side of [0,1]){
    const first=results.find(e=>e.side===side);
    assert.equal(first.goal,false);assert.match(first.text,/一夫当关/);
  }
  const metrics=createMatchMetrics();metrics.consume(m.events);
  assert.equal(metrics.view().events.filter(e=>e.type==='penaltyShootoutKick'&&e.text.includes('一夫当关')).length,2);
  assert.deepEqual(metrics.view().stats.map(s=>s.saves),[0,1].map(side=>m.events.filter(e=>e.id<m.events.find(e=>e.type==='shootoutStart').id&&e.side===side&&['save','parry'].includes(e.type)).length));
});

test('顺风战士随比分从平局到落后再领先，扳平后恢复原值',()=>{
  const input=config();input.teams[0].players[6].traitDefinitions=[YDL_TRAIT_BY_ID['custom-d98bfc9a-2168-4e80-982d-c1cebef18e80']];
  const s=createMatch(input).state,p=playerByKey(s,'0:p7');
  playerByKey(s,'0:p2').active=false;refreshPlayerEffects(s);const base=p.attributes.passing;
  for(const [score,multiplier] of [[[0,1],.85],[[2,1],1.1],[[2,2],1]]){
    s.score=score;refreshPlayerEffects(s);assert.equal(p.attributes.passing,base*multiplier);
  }
});

test('996的94点体力在中场恢复和下半场重新开球时同样固定',()=>{
  const input=config({duration:60,format:'full'});
  input.teams[0].players[6].traitDefinitions=[YDL_TRAIT_BY_ID['stoppage-time-expert']];
  // Watch a reserve as well: active players have their fitness reapplied when moving.
  const reserve=structuredClone(input.teams[0].players[6]);
  reserve.id='fixed-reserve';reserve.number=18;input.teams[0].bench=[reserve];
  const m=createMatch(input);until(m,()=>m.state.clock.period===2);
  for(const key of ['0:p7','0:fixed-reserve'])assert.equal(playerByKey(m.state,key).fitness,94);
});

test('跳水王子在真实禁区对抗中可吃黄，间接任意球、两黄离场及红牌免疫归属正确',()=>{
  function contact(traits,{yellowCards=0,x=94}={}){
    const input=config({seed:'dive-17'});
    input.teams[0].players[9].traitDefinitions=traits.map(id=>YDL_TRAIT_BY_ID[id]);
    const m=createMatch(input),s=m.state,carrier=playerByKey(s,'0:p10'),defender=playerByKey(s,'1:p3');
    Object.assign(carrier,{x,y:34,vx:0,vy:0,nextDecision:100,yellowCards});
    Object.assign(defender,{x:x+.2,y:34,vx:0,vy:0,nextTackle:0});
    s.stats[0].yellowCards=yellowCards;s.rules={offside:null,restartTouch:null};
    s.ball={mode:'held',holder:carrier.key,x,y:34,z:0,vx:0,vy:0,flight:null};advanceMatch(m);
    return m;
  }
  for(const [traits,prior,dismissed] of [[['big-stage'],0,false],[['big-stage'],1,true],[['big-stage','pace-budget'],1,false]]){
    const m=contact(traits,{yellowCards:prior}),s=m.state,card=m.events.find(e=>e.type==='yellowCard');
    assert.equal(card.actor,'0:p10');assert.match(card.text,/假摔/);
    assert.equal(s.restart.type,'indirectFreeKick');assert.equal(s.restart.side,1);
    assert.equal(s.stats[0].yellowCards,prior+1);assert.equal(s.stats[0].redCards,Number(dismissed));
    assert.equal(playerByKey(s,'0:p10').active,!dismissed);
    assert.equal(s.stats[1].fouls,0);assert.equal(s.stats[1].yellowCards,0);
  }
  for(const m of [contact([]),contact(['big-stage'],{x:60})])assert.ok(!m.events.some(e=>e.text.includes('假摔')));
});
