import fs from 'node:fs/promises';
import {createV2Match} from '../versus/v2/match-engine-v2.js';
import {buildV2TeamSnapshots} from '../versus/v2/team-snapshot-v2.js';
import {buildV2SpatialMatchup,buildV2StageSpatialMatchup} from '../versus/v2/spatial-model-v2.js';
import {resolveV2MatchParameters} from '../versus/v2/match-parameters-v2.js';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';

const state={minute:30,score:[0,0]},environment={weather:'sunny',referee:'standard'};
const results=[];
for(const [control,values] of [['defenseDirection',['left','right']],['defensiveWidth',['protectCenter','forceWide']]]){
 const fixtures=values.map(value=>{
  const match=createV2Match([makeAssessmentTeam('A',{boardLines:true}),makeAssessmentTeam('B',{boardLines:true,plan:{outOfPossessionDetails:{[control]:value}}})]);
  return buildV2TeamSnapshots(match.teams,{state,environment});
 });
 for(const mode of ['off','stable'])for(const stage of ['opening','buildUp','progression','finalThird','chance','shot']){
  const parameters=resolveV2MatchParameters({dynamicShape:{mode}});
  const [a,b]=fixtures.map(teams=>stage==='opening'?buildV2SpatialMatchup(teams,{parameters}):buildV2StageSpatialMatchup(teams,0,stage,{parameters,ballLane:'farLeft'}));
  const deltas=a.teams[1].players.map((p,i)=>Math.hypot(p.localPosition.x-b.teams[1].players[i].localPosition.x,p.localPosition.y-b.teams[1].players[i].localPosition.y));
  results.push({control,values,mode,stage,maxPositionDelta:Math.max(...deltas),effectiveZonesEqual:JSON.stringify(a.teams[0].zones)===JSON.stringify(b.teams[0].zones)});
 }
}
await fs.mkdir('outputs/engine-assessment',{recursive:true});
await fs.writeFile('outputs/engine-assessment/defensive-controls.json',JSON.stringify({state,environment,results},null,2));
for(const row of results)console.log(JSON.stringify(row));
