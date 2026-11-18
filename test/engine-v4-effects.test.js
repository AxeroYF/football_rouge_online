import test from 'node:test';
import assert from 'node:assert/strict';
import {demoInput} from '../versus/v4/fixtures.js';
import {createMatch,awardRestart,injurePlayer,penalizeFoul,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {refreshPlayerEffects} from '../versus/v4/player-effects.js';
import {playerByKey,assertWorld} from '../versus/v4/world.js';
import {positionExecution} from '../versus/v4/execution.js';
import {publicEvent} from '../versus/v4-stream/codec.js';

function config(){
  const input=structuredClone(createMatch(demoInput({duration:180})).state.input);input.playerEffects=true;
  for(const team of input.teams){team.sourcePlans={normal:{style:'possession',tactic:'balanced'},leading:{style:'possession',tactic:'balanced'},trailing:{style:'possession',tactic:'balanced'}};team.sourceBondCatalog=[];
    for(const p of team.players){p.baseAttributes={...p.attributes};p.baseHeightCm=p.heightCm;p.traitDefinitions=[];p.upgradeLevel=0;}}
  return input;
}
test('conditional attributes recompute from the base and active bonds disappear when the eleven is reduced',()=>{
  const input=config();input.teams[0].players[9].traitDefinitions=[{id:'late',rules:[{hook:'allAttributes',multiply:1.1,when:{minuteGte:60}}]}];
  const s=createMatch(input).state,p=playerByKey(s,'0:p10'),initial=p.attributes.finishing;
  s.clock.elapsed=3600;refreshPlayerEffects(s);const enhanced=p.attributes.finishing;assert.ok(enhanced>initial);
  assert.deepEqual(refreshPlayerEffects(s),[]);assert.equal(p.attributes.finishing,enhanced);
  playerByKey(s,'0:p2').active=false;refreshPlayerEffects(s);assert.ok(p.attributes.finishing<enhanced);
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
