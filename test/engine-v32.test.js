import test from 'node:test';
import assert from 'node:assert/strict';
import {createV3Match as createCurrentMatch,simulateV3Match as simulateCurrentMatch} from '../versus/v3/match-engine-v3.js';
import {advanceV2Match,restoreV2MatchRuntime} from '../versus/v2/match-engine-v2.js';
import {createYdlLeagueV2Match,advanceYdlLeagueV2Match,publicYdlLeagueV2Match,v2PenaltyShootout} from '../versus/v2/ydl-league-engine-adapter.js';
import {V32_MATCH_PARAMETERS as V3_MATCH_PARAMETERS,V31_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {makeAssessmentTeam} from '../scripts/engine-assessment-fixtures.mjs';
import {configurationDigest} from '../versus/v3/match-configuration.js';
import {chooseBounded} from '../versus/v3/action-policy.js';
import {flowClock,periodRemaining} from '../versus/v3/flow-state.js';
import {buildV2TeamSnapshots} from '../versus/v2/team-snapshot-v2.js';
import {buildV2StageSpatialMatchup,buildV21StageDynamicShapeSnapshot} from '../versus/v2/spatial-model-v2.js';
import {simulateV2PossessionChain} from '../versus/v2/possession-chain-v2.js';
import {changeTacticalPrinciple,applyPrinciplePreset,tacticalPrincipleFields} from '../versus/public/tactical-principles.js';
import {continuousShape} from '../versus/v3/flow-shape.js';

const teams=(a={},b={})=>[makeAssessmentTeam('A',{boardLines:true,holdScorePlans:true,...a}),makeAssessmentTeam('B',{boardLines:true,holdScorePlans:true,...b})];
const options={seed:'v32-reliability',weather:'sunny',referee:'standard'};
const json=value=>JSON.parse(JSON.stringify(value));
const outcome=m=>({score:m.score,events:m.events,chains:m.chains,flowState:m.flowState,teams:m.teams,randomState:m.randomState,outcomeSampleCounters:m.outcomeSampleCounters,diagnostics:m.diagnostics});

test('V3.2 uses football time, physical durations, bounded stoppage and real period boundaries',()=>{
  const m=simulateV3Match(teams(),options),f=m.flowState;
  assert.equal(m.engineVersion,'3.2.0');assert.equal(m.finished,true);assert.equal(m.minute,90);
  assert.equal(f.periods.length,2);assert.equal(m.events.filter(e=>e.type==='halftime').length,1);
  assert.equal(m.events.filter(e=>e.type==='fulltime').length,1);
  assert.equal(m.chains.length,m.nextChainIndex);assert.ok(m.chains.length!==180);
  assert.ok(Math.abs(f.elapsedSeconds-5400-f.periods.reduce((s,p)=>s+p.addedSeconds,0))<.01);
  assert.ok(Math.abs(f.activeSeconds+f.deadBallSeconds-f.elapsedSeconds)<.02);
  assert.ok(Math.abs(m.teams.reduce((s,t)=>s+t.stats.possessionSeconds,0)-f.activeSeconds)<.02);
  assert.ok(m.chains.every(c=>c.activeDurationSeconds>0&&c.durationSeconds>0&&c.actions.length<=8));
  assert.ok(f.periods.every(p=>p.addedSeconds<=V3_MATCH_PARAMETERS.v32.maximumAddedSeconds));
});

test('checkpoint replay and one-chain budgets produce identical full V3.2 action/state output',()=>{
  const continuous=simulateV3Match(teams(),{...options,diagnosticTrace:true});
  let sliced=createV3Match(teams(),{...options,diagnosticTrace:true});
  while(!sliced.finished) {
    advanceV2Match(sliced,Infinity,{maximumChains:1});
    if([7,50,99,151].includes(sliced.nextChainIndex))sliced=json(sliced);
  }
  assert.equal(configurationDigest(outcome(sliced)),configurationDigest(outcome(continuous)));
  const damaged=json(createV3Match(teams(),options));delete damaged.flowState;
  assert.throws(()=>restoreV2MatchRuntime(damaged),/连续比赛状态/);
});

test('wall-time adapter and report are independent of CPU slice sizes',()=>{
  const start=1234567890000,settings={...options,now:start,parameters:V3_MATCH_PARAMETERS};
  const continuous=createYdlLeagueV2Match(teams(),settings);
  advanceYdlLeagueV2Match(continuous,start+120001,{maximumChains:Infinity});
  let sliced=createYdlLeagueV2Match(teams(),settings);
  for(const time of [30000,60000,90000,120001]) {
    let before=-1;
    while(!sliced.finished&&before!==sliced.nextChainIndex) {
      before=sliced.nextChainIndex;
      advanceYdlLeagueV2Match(sliced,start+time,{maximumChains:5});
      if(!sliced.finished)sliced=json(sliced);
    }
  }
  assert.deepEqual(json(sliced.report),json(continuous.report));
  assert.equal(sliced.report.clock.completedPeriods.length,2);
  assert.equal(sliced.report.tacticalReview.chainModelVersion,'possession-chain-v3.2');
  const exposed=JSON.stringify(publicYdlLeagueV2Match(sliced));
  for(const key of ['shapes','flowState','initialTeams','streams','simulationSeed'])assert.equal(exposed.includes('"'+key+'"'),false,key);
});

test('slow clock management reduces remaining possessions while fatigue tracks elapsed activity',()=>{
  const play=clock=>simulateV3Match(teams({plan:{clockManagement:clock}},{plan:{clockManagement:clock}}),{...options,seed:'v32-clock-control'});
  const quick=play('quick'),slow=play('slow');
  assert.ok(slow.chains.length<quick.chains.length*.9,`${slow.chains.length}/${quick.chains.length}`);
  assert.equal(quick.flowState.period,slow.flowState.period);
  assert.ok(Math.abs(quick.flowState.activeSeconds-slow.flowState.activeSeconds)<600);
  const fitness=m=>m.teams.flatMap(t=>t.players).reduce((s,p)=>s+p.state.fitness,0)/22;
  assert.ok(Math.abs(fitness(quick)-fitness(slow))<6);
});

test('actual positions move within reach and rest-defense principles change protected players',()=>{
  for(const [restDefense,count] of [['adventurous',2],['balanced',3],['conservative',4]]) {
    const m=createV3Match(teams({plan:{restDefense}}),options);
    const snapshots=buildV2TeamSnapshots(m.teams,{parameters:m.parameters});
    const desired=buildV21StageDynamicShapeSnapshot(snapshots,0,'chance',{parameters:m.parameters});
    assert.equal(desired.teams[0].players.filter(p=>p.restDefenseProtected).length,count);
    const spatial=buildV2StageSpatialMatchup(snapshots,0,'chance',{parameters:m.parameters,flowState:m.flowState,elapsedSeconds:1});
    for(const team of spatial.dynamicShape.teams)for(const player of team.players)assert.ok(player.distanceMoved<=1.5,`${player.id}:${player.distanceMoved}`);
  }
});

test('counterpress has one short paid attempt, can be bypassed and expires',()=>{
  const m=createV3Match(teams({}, {plan:{lossTransition:'counterPress'}}),options);
  Object.assign(m.flowState,{owner:0,zone:'defensiveThird:center',carrierId:'A0',transition:{lostTeam:1,wonTeam:0,expiresAt:6,lossStrategy:'counterPress',attempted:false}});
  const run=(roll,flow=m.flowState)=>simulateV2PossessionChain(m.teams,{parameters:m.parameters,flowState:flow,rng:()=>.4,outcomeRoll:()=>roll,domainRoll:()=>.9,deferShotResolution:true});
  const won=run(0),lost=run(.999);
  assert.equal(won.nextFlow.counterPressAttempts[1],1);assert.equal(won.nextFlow.counterPressRecoveries[1],1);
  assert.equal(lost.nextFlow.counterPressAttempts[1],1);assert.equal(lost.nextFlow.counterPressRecoveries[1],0);
  assert.equal(lost.actions[0].type,'counterPress');assert.equal(lost.actions[0].seconds,3);
  const expired=json(m.flowState);expired.elapsedSeconds=7;
  assert.equal(run(0,expired).nextFlow.counterPressAttempts[1],0);
});

test('bounded decisions favor clear advantages and preserve variation among close options',()=>{
  const values=[{id:'best',value:1},{id:'close',value:.99},{id:'bad',value:.2}];
  const selected=[.01,.5,.99].map(roll=>chooseBounded(values,x=>x.value,()=>roll,{judgment:80}));
  assert.ok(selected.every(x=>x.id!=='bad'));assert.ok(new Set(selected.map(x=>x.id)).size>1);
  assert.equal(chooseBounded([{id:'best',value:1},{id:'bad',value:.5}],x=>x.value,()=>.999,{judgment:95}).id,'best');
});

test('a period boundary consumes only remaining time and cannot create an unpaid shot',()=>{
  const m=createV3Match(teams(),options);
  Object.assign(m.flowState,{periodElapsed:2699.5,elapsedSeconds:2699.5,owner:0,zone:'box:center',phase:'shot',carrierId:'A9'});
  const chain=simulateV2PossessionChain(m.teams,{parameters:m.parameters,flowState:m.flowState,rng:()=>.4,outcomeRoll:()=>0,domainRoll:()=>.99});
  assert.equal(chain.activeDurationSeconds,.5);
  assert.equal(chain.terminalOutcome,'periodEnded');
  assert.equal(chain.actions.length,0);
  assert.equal(chain.stages.some(stage=>stage.outcome==='shotCreated'),false);
});

test('a long action stops counterpress movement when its short window expires',()=>{
  const player={id:'p',genericRole:'CM',basePosition:{x:50,y:80},targetPosition:{x:50,y:80}};
  const shape={teams:[{players:[],metrics:{}},{players:[player],metrics:{}}]};
  const flow={owner:0,zone:'defensiveThird:center',elapsedSeconds:5,shapes:[{},{p:{x:50,y:50}}],
    transition:{lostTeam:1,expiresAt:6,lossStrategy:'counterPress'}};
  const result=continuousShape(shape,[{players:[]},{players:[{id:'p',attributes:{pace:80},state:{fitness:100}}]}],flow,20,V3_MATCH_PARAMETERS.v32);
  assert.ok(result.teams[1].players[0].targetPosition.y>60,'regroup towards the settled shape after the one remaining pressing second');
});

test('generic score probability bonuses are retired and existing V3.1 parameters remain unchanged',()=>{
  assert.equal(V3_MATCH_PARAMETERS.state.leadingShotXgPenaltyPerGoal,0);
  assert.equal(V3_MATCH_PARAMETERS.state.trailingUrgencyMaximum,0);
  assert.equal(V31_MATCH_PARAMETERS.state.leadingShotXgPenaltyPerGoal,.04);
  assert.equal(V31_MATCH_PARAMETERS.dynamicShape.stableInfluence,.15);
});

test('flow tactics validate and round-trip independently in existing tactical plans',()=>{
  let plan=applyPrinciplePreset({tactic:'balanced',style:'possession'},'control');
  plan=changeTacticalPrinciple(plan,'lossTransition','counterPress');
  plan=changeTacticalPrinciple(plan,'restDefense','conservative');
  plan=changeTacticalPrinciple(plan,'clockManagement','slow');
  const fields=tacticalPrincipleFields(json(plan));
  assert.equal(fields.lossTransition,'counterPress');assert.equal(fields.restDefense,'conservative');assert.equal(fields.clockManagement,'slow');
  assert.equal(plan.possessionStyle,'possession');
  assert.throws(()=>tacticalPrincipleFields({...plan,restDefense:'invalid'}),/进攻留守/);
});

test('extra-time and shootout state stay deterministic across serialization',()=>{
  const seats=teams(),start=1234567890000;
  const regular=createYdlLeagueV2Match(seats,{...options,parameters:V3_MATCH_PARAMETERS,now:start});
  advanceYdlLeagueV2Match(regular,start+120001,{maximumChains:Infinity});
  const base=regular.score[0]>regular.score[1]?[0,regular.score[0]-regular.score[1]]:[regular.score[1]-regular.score[0],0];
  const m=createYdlLeagueV2Match(seats,{...options,parameters:V3_MATCH_PARAMETERS,now:start,regulationOnly:false,aggregateBaseScore:base});
  advanceYdlLeagueV2Match(m,start+120001,{maximumChains:Infinity});
  assert.equal(m.extraTimeStarted,true);
  let resumed=json(m);
  advanceYdlLeagueV2Match(m,start+160001,{maximumChains:Infinity});
  advanceYdlLeagueV2Match(resumed,start+160001,{maximumChains:Infinity});
  resumed=json(resumed);
  advanceYdlLeagueV2Match(m,start+300000,{maximumChains:Infinity});
  advanceYdlLeagueV2Match(resumed,start+300000,{maximumChains:Infinity});
  assert.deepEqual(json(resumed.report),json(m.report));
  assert.equal(m.flowState.periods.length,4);assert.equal(periodRemaining(m.flowState),0);
  const a=createV3Match(teams(),options),b=json(a);restoreV2MatchRuntime(b);
  assert.deepEqual(v2PenaltyShootout(a),v2PenaltyShootout(b));
});

test('V3.2 injury replacements, dismissals and paid set pieces survive checkpoint continuation',()=>{
  const seats=teams();seats[0].players[1].nationality='阿根廷';
  for(const team of seats)team.players.push(...team.players.slice(0,3).map((player,index)=>({...structuredClone(player),id:player.id+'bench'+index,active:false})));
  const parameters={...structuredClone(V3_MATCH_PARAMETERS),events:{...V3_MATCH_PARAMETERS.events,injuryPerChain:.04}};
  const match=createV3Match(seats,{...options,parameters,forceBlackWhistle:true});
  advanceV2Match(match,24);const resumed=json(match);
  advanceV2Match(match,Infinity);advanceV2Match(resumed,Infinity);
  assert.equal(configurationDigest(outcome(match)),configurationDigest(outcome(resumed)));
  for(const type of ['injury','substitution','red'])assert.ok(match.events.some(event=>event.type===type),type);
  assert.ok(match.chains.some(chain=>chain.secondaryActions?.some(action=>action.type==='setPiece')));
  assert.ok(match.chains.every(chain=>Number.isFinite(chain.durationSeconds)&&chain.durationSeconds>0));
  assert.ok(match.teams.flatMap(team=>team.players).every(player=>Number.isFinite(player.state.fitness)));
});

function createV3Match(teams,options={}) {return createCurrentMatch(teams,{...options,parameters:options.parameters??V3_MATCH_PARAMETERS});}
function simulateV3Match(teams,options={}) {return simulateCurrentMatch(teams,{...options,parameters:options.parameters??V3_MATCH_PARAMETERS});}
