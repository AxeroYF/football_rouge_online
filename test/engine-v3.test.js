import test from 'node:test';
import assert from 'node:assert/strict';
import {V31_MATCH_PARAMETERS as V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {engineProfile} from '../versus/v3/model-config.js';
import {matchOutcomeRoll} from '../versus/v3/outcome-sampling.js';
import {createV3Match as createCurrentV3Match,simulateV3Match as simulateCurrentV3Match} from '../versus/v3/match-engine-v3.js';
import {createV2MatchRng,simulateV2Match} from '../versus/v2/match-engine-v2.js';
import {createYdlLeagueV2Match,publicYdlLeagueV2Match} from '../versus/v2/ydl-league-engine-adapter.js';
import {buildV2TeamSnapshots} from '../versus/v2/team-snapshot-v2.js';
import {buildV2StageSpatialMatchup,buildV2StageSpatialCache,v2MidfieldStructureProfile} from '../versus/v2/spatial-model-v2.js';
import {simulateV2PossessionChain} from '../versus/v2/possession-chain-v2.js';
import {validateV2MatchParameters,V2_MATCH_PARAMETERS,resolveV2MatchParameters} from '../versus/v2/match-parameters-v2.js';
import {makeAssessmentTeam} from '../scripts/engine-assessment-fixtures.mjs';

const createV3Match=(teams,options={})=>createCurrentV3Match(teams,{...options,parameters:options.parameters??V3_MATCH_PARAMETERS});
const simulateV3Match=(teams,options={})=>simulateCurrentV3Match(teams,{...options,parameters:options.parameters??V3_MATCH_PARAMETERS});
const parameters=V3_MATCH_PARAMETERS,state={minute:30,score:[0,0]},environment={weather:'sunny',referee:'standard'};
const V3_ENGINE_PROFILE=engineProfile(parameters);
const team=(name,options={})=>makeAssessmentTeam(name,{boardLines:true,holdScorePlans:true,...options});
const average=values=>values.reduce((s,x)=>s+x,0)/values.length;
const variance=values=>average(values.map(x=>(x-average(values))**2));

test('V3 has its own validated version, while V2 parameters stay unchanged',()=>{
 assert.equal(parameters.engineVersion,'3.1.0');
 assert.deepEqual(validateV2MatchParameters(parameters),{valid:true,errors:[]});
 assert.equal(V2_MATCH_PARAMETERS.engineVersion,'2.1.0');
 assert.equal(resolveV2MatchParameters(parameters),parameters);
 assert.throws(()=>resolveV2MatchParameters({engineVersion:'3.1.0',v3:{sampling:{bucketSize:0}}}),/bucketSize/);
 const match=createYdlLeagueV2Match([team('A'),team('B')],{seed:'v3-version',parameters});
 assert.equal(match.engineVersion,'3.1.0');assert.equal(match.engineProfile,V3_ENGINE_PROFILE);
 assert.equal(publicYdlLeagueV2Match(match).engineVersion,'3.1.0');
 const legacy=createYdlLeagueV2Match([team('A'),team('B')],{seed:'v2-version'});
 assert.equal(legacy.engineVersion,'2.1.0');assert.equal(legacy.engineProfile,'v2.1-stable-dynamic.2');
});

test('V3 defensive direction reaches every effective stage and both defending sides',()=>{
 for(const defendingSide of [0,1]){
  const shapes=['left','right'].map(direction=>{
   const teams=[team('A'),team('B')];teams[defendingSide]=team(defendingSide?'B':'A',{plan:{outOfPossessionDetails:{defenseDirection:direction}}});
   const match=createV3Match(teams);
   return buildV2TeamSnapshots(match.teams,{parameters,state,environment});
  });
  for(const stage of parameters.chain.stages.slice(1)){
   const [left,right]=shapes.map(teams=>buildV2StageSpatialMatchup(teams,1-defendingSide,stage,{parameters,ballLane:'center'}));
   const delta=Math.max(...left.teams[defendingSide].players.map((p,i)=>Math.abs(p.localPosition.x-right.teams[defendingSide].players[i].localPosition.x)));
   assert.ok(delta>4,stage+' must preserve the direction instruction');
   assert.notDeepEqual(left.teams[1-defendingSide].zones,right.teams[1-defendingSide].zones);
  }
 }
});

test('V3 midfield risk varies smoothly across the former counting boundary',()=>{
 const players=[{group:'MID',localPosition:{x:38,y:48}},{group:'MID',localPosition:{x:62,y:48}},{group:'MID',localPosition:{x:50,y:31.99}}];
 const before=v2MidfieldStructureProfile(players,parameters);
 const oldBefore=v2MidfieldStructureProfile(players);
 players[2].localPosition.y=32.01;
 const after=v2MidfieldStructureProfile(players,parameters),oldAfter=v2MidfieldStructureProfile(players);
 assert.ok(Math.abs(after.integrity-before.integrity)<.002);
 assert.ok(Math.abs(after.longShotExposure-before.longShotExposure)<.002);
 assert.ok(oldAfter.integrity-oldBefore.integrity>.15);
 assert.ok(after.integrity>before.integrity);
});

test('V3 defending a flank opens the other flank and width choices have a coverage tradeoff',()=>{
 const project=details=>{
  const match=createV3Match([team('A'),team('B',{plan:{outOfPossessionDetails:details}})]);
  const snapshots=buildV2TeamSnapshots(match.teams,{parameters,state,environment});
  return buildV2StageSpatialMatchup(snapshots,0,'chance',{parameters,ballLane:'center'}).teams[0].zones;
 };
 const left=project({defenseDirection:'left'}),right=project({defenseDirection:'right'});
 assert.ok(left['box:farLeft'].exploitableSpace>left['box:farRight'].exploitableSpace);
 assert.ok(right['box:farRight'].exploitableSpace>right['box:farLeft'].exploitableSpace);
 const narrow=project({defensiveWidth:'protectCenter'}),wide=project({defensiveWidth:'forceWide'});
 assert.ok(narrow['box:farLeft'].exploitableSpace>wide['box:farLeft'].exploitableSpace);
 assert.ok(wide['box:center'].exploitableSpace>narrow['box:center'].exploitableSpace);
});

test('V3 outcome sampling lowers aggregate variance without changing probability or strength',()=>{
 const regular=[],independent=[];
 for(let seed=0;seed<2000;seed++){
  const match={parameters,simulationSeed:String(seed)},rng=createV2MatchRng('sampling-'+seed);
  let a=0,b=0;
  for(let shot=0;shot<12;shot++){a+=Number(matchOutcomeRoll(match,'goal:0')<.18);b+=Number(rng()<.18);}
  regular.push(a);independent.push(b);
 }
 assert.ok(Math.abs(average(regular)-12*.18)<.08);
 assert.ok(variance(regular)<variance(independent)*.8);
 const first={parameters,simulationSeed:'resume'};for(let i=0;i<7;i++)matchOutcomeRoll(first,'stage:0:chance');
 const restored=JSON.parse(JSON.stringify(first));
 assert.deepEqual(Array.from({length:30},()=>matchOutcomeRoll(first,'stage:0:chance')),Array.from({length:30},()=>matchOutcomeRoll(restored,'stage:0:chance')));
});

test('V3 sampling does not compensate for score or squad strength',()=>{
 const favored={parameters,simulationSeed:'same-seed',score:[5,0],teams:[{overall:99},{overall:60}]};
 const underdog={parameters,simulationSeed:'same-seed',score:[0,5],teams:[{overall:60},{overall:99}]};
 assert.deepEqual(Array.from({length:100},()=>matchOutcomeRoll(favored,'goal:0')),Array.from({length:100},()=>matchOutcomeRoll(underdog,'goal:0')));
});

test('lazy stage projection matches the eager calculation and reuses a computed stage',()=>{
 const match=createV3Match([team('A'),team('B')]);
 const snapshot=buildV2TeamSnapshots(match.teams,{parameters,state,environment});
 const lazy=buildV2StageSpatialCache(snapshot,{parameters,lazy:true}),eager=buildV2StageSpatialCache(snapshot,{parameters});
 assert.equal(lazy[0].chance,lazy[0].chance);
 for(const side of [0,1])for(const stage of parameters.chain.stages.slice(1))assert.deepEqual(lazy[side][stage],eager[side][stage]);
 const run=stageSpatials=>simulateV2PossessionChain(match.teams,{parameters,snapshotTeams:snapshot,state,environment,stageSpatials,rng:createV2MatchRng('same-chain'),deferShotResolution:true});
 assert.deepEqual(run(lazy),run(eager));
});

test('V3 full matches remain reproducible and retain valid scores and source version',()=>{
 const seats=[team('A'),team('B')],options={seed:'v3-replay',possessionChains:180,weather:'sunny',referee:'standard'};
 const first=simulateV3Match(seats,options),second=simulateV3Match(seats,options);
 assert.deepEqual(first.score,second.score);assert.deepEqual(first.chains,second.chains);
 assert.equal(first.modelVersion,'match-engine-v3.1');
 assert.equal(first.chains[0].modelVersion,'possession-chain-v3.0');
 assert.ok(first.score.every(score=>Number.isInteger(score)&&score>=0));
 const legacy=simulateV2Match(seats,{...options,possessionChains:12});
 assert.equal(legacy.modelVersion,'match-engine-v2.1');
});
