import test from 'node:test';
import assert from 'node:assert/strict';
import {createV3Match} from '../versus/v3/match-engine-v3.js';
import {advanceV2Match,resolvePassivePlayerExit} from '../versus/v2/match-engine-v2.js';
import {comparePassiveSubstitutes} from '../versus/passive-substitution.js';
import {makeAssessmentTeam} from '../scripts/engine-assessment-fixtures.mjs';
import {V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';

function fixture(ownerId=null,substitutionsEnabled=true,events={}){
  const seats=['A','B'].map(name=>makeAssessmentTeam(name,{boardLines:true,holdScorePlans:true}));
  for(const seat of seats){
    seat.ownerId=ownerId;
    seat.positionPresets=Object.fromEntries(['position1','position2','position3'].map(key=>[key,structuredClone(seat.positions)]));
    seat.players.push(...seat.players.map((p,i)=>({...structuredClone(p),id:`${seat.name}-bench-${i}`,active:false,state:{fitness:100}})));
  }
  return createV3Match(seats,{seed:'passive-boundaries',weather:'sunny',referee:'standard',parameters:{...structuredClone(V3_MATCH_PARAMETERS),state:{...V3_MATCH_PARAMETERS.state,substitutionsEnabled},events:{...V3_MATCH_PARAMETERS.events,...events}}});
}
const onField=team=>team.players.filter(p=>p.active);
const goalkeeper=team=>onField(team).find(p=>p.assignedRole==='GK');
const benchKeeper=team=>team.players.find(p=>!p.active&&p.role==='GK');
function exit(match,player,cause='red'){
  player.active=false;player.sentOff=cause==='red';player.injury=cause==='injury'?{severity:'matchEnding',injuryRounds:1}:null;
  return resolvePassivePlayerExit(match,match.teams[0],player,cause);
}
function assertSlot(team,incoming,departed,removed){
  for(const positions of [team.positions,...Object.values(team.positionPresets)]){
    assert.ok(positions[incoming.id]);assert.equal(positions[departed.id],undefined);
    if(removed&&removed.id!==incoming.id)assert.equal(positions[removed.id],undefined);
  }
  for(const plan of [team,team.openingPlan,...Object.values(team.tacticalPlans)]){
    assert.ok(Object.hasOwn(plan.playerDuties,incoming.id));assert.equal(plan.playerDuties[departed.id],undefined);
  }
  assert.equal(team.structureRoles[incoming.id],'GK');
}

for(const owner of [null,'human-manager'])test(`goalkeeper dismissal preserves two centre-backs and all slots (${owner??'AI'})`,()=>{
  const match=fixture(owner),team=match.teams[0],departed=goalkeeper(team);
  const cbs=onField(team).filter(p=>p.assignedRole==='CB');assert.equal(cbs.length,2);
  const result=exit(match,departed);
  assert.equal(result.status,'substituted');assert.ok(cbs.every(p=>p.active));
  assert.equal(onField(team).length,10);assert.equal(team.stats.substitutions,1);
  assertSlot(team,result.incoming,departed,result.outgoing);
  assert.ok(match.flowState.shapes[0][result.incoming.id]);assert.equal(match.flowState.shapes[0][departed.id],undefined);
  assert.equal(match.flowState.shapes[0][result.outgoing.id],undefined);
  assert.equal(result.outgoing.substitutedOut,true);
  assert.equal(match.events.at(-1).reason,'goalkeeperRedCard');
});

test('goalkeeper dismissal works without a centre-back',()=>{
  const match=fixture(),team=match.teams[0];onField(team).filter(p=>p.assignedRole==='CB').forEach(p=>p.assignedRole='DM');
  const result=exit(match,goalkeeper(team));assert.equal(result.status,'substituted');assert.equal(onField(team).length,10);
});

for(const failure of ['disabled','limit','noEligibleSubstitute','noPositionMatch','lowFitness'])test(`keeper emergency has precise ${failure} reason and is idempotent`,()=>{
  const match=fixture(null,failure!=='disabled'),team=match.teams[0],departed=goalkeeper(team),reserve=benchKeeper(team);
  const candidate=onField(team).at(-1);candidate.attributes={...candidate.attributes,goalkeeping:99,reflexes:99,positioning:99};candidate.state.fitness=100;
  if(failure==='limit')team.stats.substitutions=5;
  if(failure==='noEligibleSubstitute')team.players.filter(p=>!p.active).forEach(p=>p.substitutedOut=true);
  if(failure==='noPositionMatch')reserve.injury={severity:'matchEnding'};
  if(failure==='lowFitness')reserve.state.fitness=1;
  const count=team.stats.substitutions,result=exit(match,departed);
  assert.equal(result.status,'emergencyGoalkeeper');assert.equal(result.failureReason,failure);
  assert.equal(result.emergencyGoalkeeper.id,candidate.id);assert.equal(candidate.assignedRole,'GK');
  assert.equal(onField(team).length,10);assert.equal(team.stats.substitutions,count);
  assertSlot(team,candidate,departed);assert.ok(match.flowState.shapes[0][candidate.id]);
  assert.equal(match.events.at(-1).reason,'emergencyGoalkeeper');assert.equal(match.events.at(-1).failureReason,failure);
  const events=match.events.length;assert.equal(resolvePassivePlayerExit(match,team,departed,'red').status,'ignored');assert.equal(match.events.length,events);
});

test('injured goalkeeper also gets an emergency keeper when the bench cannot help',()=>{
  const match=fixture(),team=match.teams[0];benchKeeper(team).sentOff=true;
  const result=exit(match,goalkeeper(team),'injury');assert.equal(result.status,'emergencyGoalkeeper');
  assert.equal(onField(team).length,10);assert.equal(team.stats.substitutions,0);
  const second=exit(match,result.emergencyGoalkeeper,'injury');assert.equal(second.status,'emergencyGoalkeeper');
  assert.equal(onField(team).length,9);assert.notEqual(second.emergencyGoalkeeper.id,result.emergencyGoalkeeper.id);
  assert.equal(onField(team).filter(p=>p.assignedRole==='GK').length,1);
});

test('injury replacements prefer effective fitness-adjusted ability and reject exhausted or used players',()=>{
  const match=fixture(),team=match.teams[0],departed=onField(team).find(p=>p.assignedRole==='CB');
  const benches=team.players.filter(p=>!p.active);
  benches.forEach(p=>{p.role='ST';p.secondaryRole=null;p.traits=[];});
  const [exhausted,tired,fresh,used]=benches;
  for(const p of [exhausted,tired,fresh,used])p.role='CB';
  exhausted.overall=99;exhausted.state.fitness=1;tired.overall=91;tired.state.fitness=50;
  fresh.overall=90;fresh.state.fitness=100;used.overall=99;used.substitutedOut=true;
  const result=exit(match,departed,'injury');assert.equal(result.incoming.id,fresh.id);
  assert.equal(onField(team).length,11);assert.equal(team.stats.substitutions,1);
  assert.equal(departed.substitutedOut,true);
});

test('position fit still outranks effective ability, with deterministic ties',()=>{
  const players=[{id:'utility',role:'ST',traits:['utility-player'],overall:99,state:{fitness:100}},
    {id:'secondary',role:'DM',secondaryRole:'CB',overall:99,state:{fitness:100}},
    {id:'b',role:'CB',overall:70,state:{fitness:45}},{id:'a',role:'CB',overall:70,state:{fitness:45}}];
  players.sort((a,b)=>comparePassiveSubstitutes('CB',a,b));assert.deepEqual(players.map(p=>p.id),['a','b','secondary','utility']);
});

test('ordinary red never restores a player and shared opponent IDs retain possession',()=>{
  const match=fixture(),team=match.teams[0],player=onField(team).find(p=>p.assignedRole==='CB');
  match.flowState.owner=1;match.flowState.carrierId=player.id;
  const result=exit(match,player);assert.equal(result.status,'shortHanded');assert.equal(onField(team).length,10);
  assert.equal(team.stats.substitutions,0);assert.equal(match.flowState.carrierId,player.id);
  assert.equal(team.positions[player.id],undefined);assert.equal(match.events.filter(e=>e.type==='substitution').length,0);
});

test('failed injury substitution reports exhausted quota and clears abandoned slots',()=>{
  const match=fixture(),team=match.teams[0],player=onField(team).find(p=>p.assignedRole==='CB');team.stats.substitutions=5;
  const result=exit(match,player,'injury');assert.equal(result.failureReason,'limit');assert.match(result.message,/名额已用完/);
  assert.equal(onField(team).length,10);assert.equal(team.positions[player.id],undefined);
});

test('emergency goalkeeper persists through score-plan changes and exact checkpoint continuation',()=>{
  const match=fixture(),team=match.teams[0];benchKeeper(team).injury={severity:'matchEnding'};
  const result=exit(match,goalkeeper(team));const id=result.emergencyGoalkeeper.id;
  team.score=2;match.score=[2,0];team.tacticalPlans.leading.planAfter='0';
  const resumed=JSON.parse(JSON.stringify(match));
  advanceV2Match(match,2);advanceV2Match(resumed,2);
  assert.deepEqual(JSON.parse(JSON.stringify(match)),JSON.parse(JSON.stringify(resumed)));
  assert.equal(team.players.find(p=>p.id===id).assignedRole,'GK');
  assert.equal(onField(team).filter(p=>p.assignedRole==='GK').length,1);
  advanceV2Match(match,Infinity);advanceV2Match(resumed,Infinity);
  assert.equal(match.finished,true);assert.equal(resumed.finished,true);
  assert.deepEqual(JSON.parse(JSON.stringify(match)),JSON.parse(JSON.stringify(resumed)));
});

test('real injury pipeline propagates failure reasons to event and commentary',()=>{
  const match=fixture(null,true,{injuryPerChain:1});
  for(const team of match.teams)team.stats.substitutions=5;
  advanceV2Match(match,3);
  const injuries=match.events.filter(event=>event.type==='injury');assert.ok(injuries.length>0);
  for(const event of injuries){
    assert.equal(event.substitutionFailureReason,'limit');assert.match(event.text,/名额已用完/);
    assert.equal(match.commentary.find(entry=>entry.id===event.id).text,event.text);
  }
  assert.equal(match.events.filter(event=>event.type==='substitution').length,0);
});
