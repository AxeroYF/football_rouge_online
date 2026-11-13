import test from 'node:test';
import assert from 'node:assert/strict';
import {createV3Match as createCurrentV3Match} from '../versus/v3/match-engine-v3.js';
import {V31_MATCH_PARAMETERS as V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {advanceV2Match,restoreV2MatchRuntime,createV2Match} from '../versus/v2/match-engine-v2.js';
import {createYdlLeagueV2Match,advanceYdlLeagueV2Match,publicYdlLeagueV2Match,v2PenaltyShootout} from '../versus/v2/ydl-league-engine-adapter.js';
import {resolveV2MatchParameters} from '../versus/v2/match-parameters-v2.js';
import {matchRandom} from '../versus/v3/random-state.js';
import {matchOutcomeRoll} from '../versus/v3/outcome-sampling.js';
import {makeAssessmentTeam} from '../scripts/engine-assessment-fixtures.mjs';
import {createTrackedState,unwrapTracked} from '../versus/league-shard-store.js';
import {YDL_TRAIT_BY_ID} from '../versus/trait-pool.js';
import {buildV2TeamSnapshots} from '../versus/v2/team-snapshot-v2.js';

const createV3Match=(teams,options={})=>createCurrentV3Match(teams,{...options,parameters:options.parameters??V3_MATCH_PARAMETERS});
const teams=()=>['A','B'].map(name=>makeAssessmentTeam(name,{boardLines:true}));
const options={seed:'upgrade-audit-20261112',weather:'sunny',referee:'standard'};
const json=value=>JSON.parse(JSON.stringify(value));
const result=match=>json({score:match.score,events:match.events,chains:match.chains,teams:match.teams,
  randomState:match.randomState,outcomeSampleCounters:match.outcomeSampleCounters,diagnostics:match.diagnostics});

test('V3.1 resumes exactly at multiple checkpoints and across different chain budgets',()=>{
  const continuous=createV3Match(teams(),options);
  advanceV2Match(continuous,180);
  let resumed=createV3Match(teams(),options);
  for(const target of [1,37,60,90,143,180]) {
    resumed=json(resumed);
    for(let index=resumed.nextChainIndex+1;index<=target;index++)advanceV2Match(resumed,index);
  }
  assert.deepEqual(result(resumed),result(continuous));
  assert.equal(resumed.randomState.recovery,'exact');
});

test('tracked-store cloning rebinds runtime to its own serialized random state',()=>{
  const original=createV3Match(teams(),options);
  const tracked=createTrackedState({liveRound:{matches:[]}},()=>{});
  tracked.liveRound.matches.push({match:original});
  const cloned=tracked.liveRound.matches[0].match;
  advanceV2Match(cloned,18);
  assert.equal(original.nextChainIndex,0);
  assert.ok(cloned.randomState.streams.decision.draws>0);
  assert.equal(original.randomState.streams.decision.draws,0);
  const saved=unwrapTracked(cloned),loaded=json(saved);
  advanceV2Match(cloned,36);advanceV2Match(loaded,36);
  assert.deepEqual(result(loaded),result(cloned));
});

test('presentation draws and optional decision traces do not perturb match results',()=>{
  const plain=createV3Match(teams(),{...options,possessionChains:36});
  const traced=createV3Match(teams(),{...options,possessionChains:36,diagnosticTrace:true});
  for(let i=0;i<200;i++)matchRandom(traced,'presentation');
  advanceV2Match(plain,36);advanceV2Match(traced,36);
  assert.deepEqual(traced.score,plain.score);
  assert.deepEqual(traced.events,plain.events);
  assert.deepEqual(traced.diagnostics.teams,plain.diagnostics.teams);
  assert.ok(traced.chains[0].decisionTrace.some(item=>item.kind==='actor'&&item.candidates.length));
  assert.ok(traced.chains.slice(16).every(chain=>!chain.decisionTrace));
});

test('random domains and stratified outcomes remain independently addressable after serialization',()=>{
  const first=createV3Match(teams(),options),second=json(first);
  restoreV2MatchRuntime(second);
  for(let i=0;i<30;i++)matchRandom(first,'injury');
  assert.equal(matchRandom(first,'decision'),matchRandom(second,'decision'));
  assert.equal(matchRandom(first,'shot'),matchRandom(second,'shot'));
  assert.equal(matchOutcomeRoll(first,'goal:0'),matchOutcomeRoll(second,'goal:0'));
});

test('optional weather descriptions do not shift actual weather injuries or playing decisions',()=>{
  const make=probability=>createV3Match(teams(),{...options,weather:'rain',possessionChains:36,
    parameters:resolveV2MatchParameters({...structuredClone(V3_MATCH_PARAMETERS),events:{...V3_MATCH_PARAMETERS.events,weatherImpactPerMatch:probability}})});
  const quiet=make(0),described=make(1);
  advanceV2Match(quiet,36);advanceV2Match(described,36);
  assert.deepEqual(quiet.chains,described.chains);
  assert.deepEqual(quiet.score,described.score);
  assert.deepEqual(quiet.teams.map(t=>t.stats),described.teams.map(t=>t.stats));
  for(const domain of ['decision','execution','shot','discipline','injury','environment'])assert.deepEqual(quiet.randomState.streams[domain],described.randomState.streams[domain]);
  assert.equal(described.events.filter(e=>e.type==='weather').length,1);
});

test('parameters, inputs and configuration digest are locked and checked on resume',()=>{
  const seats=teams(),parameters=json(V3_MATCH_PARAMETERS);
  const match=createV3Match(seats,{...options,parameters});
  const initial=match.configuration.initialTeams[0].players[0].attributes.finishing;
  seats[0].players[0].attributes.finishing=1;parameters.state.leadingShotXgPenaltyPerGoal=.5;
  assert.equal(match.configuration.initialTeams[0].players[0].attributes.finishing,initial);
  assert.equal(match.parameters.state.leadingShotXgPenaltyPerGoal,.04);
  assert.throws(()=>{match.parameters.state.leadingShotXgPenaltyPerGoal=.9;},TypeError);
  assert.throws(()=>{match.simulationSeed='tampered';},TypeError);
  const damaged=json(match);damaged.parameters.state.leadingShotXgPenaltyPerGoal=.5;
  assert.throws(()=>restoreV2MatchRuntime(damaged),/配置/);
  const missing=json(match);delete missing.randomState;
  assert.throws(()=>restoreV2MatchRuntime(missing),/随机状态/);
  const corrupted=json(match);corrupted.randomState.streams.shot.draws=-1;
  assert.throws(()=>restoreV2MatchRuntime(corrupted),/随机状态/);
});

test('V3.0 checkpoints retain their profile and declare legacy migration truthfully',()=>{
  const parameters=resolveV2MatchParameters({...json(V3_MATCH_PARAMETERS),engineVersion:'3.0.0'});
  const old=createV2Match(teams(),{...options,parameters});advanceV2Match(old,12);
  const exact=json(old);advanceV2Match(old,24);advanceV2Match(exact,24);
  assert.deepEqual(exact.chains,old.chains);
  const missing=json(exact);delete missing.randomState;restoreV2MatchRuntime(missing);
  assert.equal(missing.engineVersion,'3.0.0');assert.equal(missing.engineProfile,'v3.0-tactical-control.1');
  assert.equal(missing.randomState.recovery,'legacy-fallback');
  advanceV2Match(missing,25);
  const migrated=json(missing);advanceV2Match(missing,30);advanceV2Match(migrated,30);
  assert.deepEqual(migrated.chains,missing.chains);
});

test('adapter budgets, regulation boundaries and report diagnostics survive checkpoint resume',()=>{
  const start=1234567890000,settings={...options,parameters:V3_MATCH_PARAMETERS,now:start};
  const continuous=createYdlLeagueV2Match(teams(),settings);
  advanceYdlLeagueV2Match(continuous,start+120001,{maximumChains:Infinity});
  let sliced=createYdlLeagueV2Match(teams(),settings);
  while(!sliced.finished) {
    advanceYdlLeagueV2Match(sliced,start+120001,{maximumChains:7});
    if(!sliced.finished)sliced=json(sliced);
  }
  assert.deepEqual(json(sliced.report),json(continuous.report));
  assert.deepEqual(sliced.halfTimeScore,continuous.halfTimeScore);
  assert.equal(sliced.report.engineDiagnostics.chains,180);
  const exposed=JSON.stringify(publicYdlLeagueV2Match(sliced));
  for(const key of ['simulationSeed','initialTeams','matchTraitDefinitions','streams','decisionTrace'])assert.equal(exposed.includes('"'+key+'"'),false,key);
});

test('shootout randomness resumes exactly and is isolated from decision draws',()=>{
  const first=createV3Match(teams(),options),second=json(first);
  restoreV2MatchRuntime(second);
  for(let i=0;i<50;i++)matchRandom(second,'decision');
  assert.deepEqual(v2PenaltyShootout(first),v2PenaltyShootout(second));
});

test('active match trait definitions are insulated from later content edits',()=>{
  const trait=Object.values(YDL_TRAIT_BY_ID).find(value=>value.rules?.some(rule=>rule.hook==='attribute'));
  assert.ok(trait);
  const seats=teams();seats[0].players[1].traits=[trait.id];
  const match=createV3Match(seats,options);
  const before=buildV2TeamSnapshots(match.teams,{parameters:match.parameters});
  const rules=trait.rules;
  try {
    trait.rules=[{hook:'allAttributes',multiply:.01}];
    assert.deepEqual(buildV2TeamSnapshots(match.teams,{parameters:match.parameters}),before);
  } finally {trait.rules=rules;}
});

test('injuries, dismissals and automatic replacements continue exactly after a checkpoint',()=>{
  const seats=teams();
  seats[0].players[1].nationality="阿根廷";
  for(const team of seats)team.players.push(...team.players.slice(0,3).map((player,index)=>({...structuredClone(player),id:player.id+'bench'+index,active:false})));
  const parameters=resolveV2MatchParameters({...structuredClone(V3_MATCH_PARAMETERS),events:{...V3_MATCH_PARAMETERS.events,injuryPerChain:.12}});
  const continuous=createV3Match(seats,{...options,parameters,possessionChains:60,forceBlackWhistle:true});
  advanceV2Match(continuous,24);
  const resumed=json(continuous);
  advanceV2Match(continuous,60);advanceV2Match(resumed,60);
  assert.deepEqual(result(resumed),result(continuous));
  assert.ok(continuous.events.some(event=>event.type==='injury'));
  assert.ok(continuous.events.some(event=>event.type==='red'));
  assert.ok(continuous.events.some(event=>event.type==='substitution'));
});

test('extra-time boundaries and any pending penalty reveal survive resume',()=>{
  const start=1234567890000;
  const continuous=createYdlLeagueV2Match(teams(),{...options,parameters:V3_MATCH_PARAMETERS,regulationOnly:false,now:start});
  advanceYdlLeagueV2Match(continuous,start+120001,{maximumChains:Infinity});
  assert.equal(continuous.extraTimeStarted,true);
  let resumed=json(continuous);
  advanceYdlLeagueV2Match(continuous,start+160001,{maximumChains:Infinity});
  advanceYdlLeagueV2Match(resumed,start+160001,{maximumChains:Infinity});
  resumed=json(resumed);
  advanceYdlLeagueV2Match(continuous,start+300000,{maximumChains:Infinity});
  advanceYdlLeagueV2Match(resumed,start+300000,{maximumChains:Infinity});
  assert.equal(resumed.finished,true);
  assert.deepEqual(json(resumed.report),json(continuous.report));
});
