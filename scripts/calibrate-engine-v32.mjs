import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';
import {V32_MATCH_PARAMETERS as V3_MATCH_PARAMETERS,V31_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {simulateV3Match} from '../versus/v3/match-engine-v3.js';
import {configurationDigest} from '../versus/v3/match-configuration.js';

const quick=process.argv.includes('--quick');
const out=new URL(`../outputs/v32-calibration${quick?'-quick':''}/`,import.meta.url);
await mkdir(out,{recursive:true});
const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const sd=values=>Math.sqrt(values.reduce((sum,value)=>sum+(value-mean(values))**2,0)/Math.max(1,values.length-1));
const scenarios=[
  {id:'equal',pairs:quick?1:8,a:{},b:{},legacy:true},
  {id:'ability-88-vs-80',pairs:quick?1:4,a:{ability:88},b:{},legacy:true},
  {id:'counterpress-vs-regroup',pairs:quick?1:4,a:{plan:{lossTransition:'counterPress'}},b:{plan:{lossTransition:'regroup'}}},
  {id:'conservative-vs-adventurous',pairs:quick?1:4,a:{plan:{restDefense:'conservative'}},b:{plan:{restDefense:'adventurous'}}},
  {id:'clock-quick',pairs:quick?1:4,a:{plan:{clockManagement:'quick'}},b:{plan:{clockManagement:'quick'}}},
  {id:'clock-slow',pairs:quick?1:4,a:{plan:{clockManagement:'slow'}},b:{plan:{clockManagement:'slow'}}},
];
const rows=[];
for(const parameters of [V31_MATCH_PARAMETERS,V3_MATCH_PARAMETERS])for(const scenario of scenarios) {
  if(parameters===V31_MATCH_PARAMETERS&&!scenario.legacy)continue;
  for(let seed=0;seed<scenario.pairs;seed++)for(const reversed of [false,true]) {
    const a=makeAssessmentTeam('A',{boardLines:true,holdScorePlans:true,...scenario.a});
    const b=makeAssessmentTeam('B',{boardLines:true,holdScorePlans:true,...scenario.b});
    const before=performance.now();
    // Clock scenarios share seeds to make duration comparisons paired.
    const seedGroup=scenario.id.startsWith('clock-')?'clock':scenario.id;
    const match=simulateV3Match(reversed?[b,a]:[a,b],{parameters,seed:`v32-calibration:${seedGroup}:${seed}`,weather:'sunny',referee:'standard'});
    const index=reversed?1:0;
    rows.push({version:match.engineVersion,scenario:scenario.id,seed,reversed,score:match.score,
      netGoals:match.score[index]-match.score[1-index],netXg:match.teams[index].stats.xg-match.teams[1-index].stats.xg,
      totalGoals:match.score[0]+match.score[1],shots:match.teams.map(team=>team.stats.shots),xg:match.teams.map(team=>team.stats.xg),
      chains:match.chains.length,footballSeconds:match.flowState?.elapsedSeconds??5400,
      activeSeconds:match.flowState?.activeSeconds??null,
      counterPressAttempts:match.flowState?.counterPressAttempts??[0,0],counterPressRecoveries:match.flowState?.counterPressRecoveries??[0,0],
      fitness:mean(match.teams.flatMap(team=>team.players.map(player=>player.state.fitness))),
      actions:match.chains.flatMap(chain=>chain.actions??[]).reduce((counts,action)=>{counts[action.type]=(counts[action.type]??0)+1;return counts;},{}),
      elapsedMs:performance.now()-before,serializedBytes:Buffer.byteLength(JSON.stringify(match))});
  }
  console.log(`${parameters.engineVersion} ${scenario.id}: ${scenario.pairs*2} matches`);
}
const groups=[...new Set(rows.map(row=>`${row.version}:${row.scenario}`))].map(key=>{
  const selected=rows.filter(row=>`${row.version}:${row.scenario}`===key);
  const paired=[...new Set(selected.map(row=>row.seed))].map(seed=>mean(selected.filter(row=>row.seed===seed).map(row=>row.netXg)));
  const half=1.96*sd(paired)/Math.sqrt(paired.length);
  return {key,matches:selected.length,meanGoals:mean(selected.map(row=>row.totalGoals)),netGoalsSD:sd(selected.map(row=>row.netGoals)),
    meanNetXg:mean(paired),approximate95CI:paired.length>1?[mean(paired)-half,mean(paired)+half]:null,
    meanShots:mean(selected.map(row=>row.shots[0]+row.shots[1])),meanChains:mean(selected.map(row=>row.chains)),
    meanFitness:mean(selected.map(row=>row.fitness)),meanElapsedMs:mean(selected.map(row=>row.elapsedMs)),
    meanSerializedBytes:mean(selected.map(row=>row.serializedBytes)),
    counterPressAttempts:selected.reduce((sum,row)=>sum+row.counterPressAttempts[0]+row.counterPressAttempts[1],0),
    counterPressRecoveries:selected.reduce((sum,row)=>sum+row.counterPressRecoveries[0]+row.counterPressRecoveries[1],0)};
});
const summary={generatedAt:new Date().toISOString(),quick,matches:rows.length,parameterDigest:configurationDigest(V3_MATCH_PARAMETERS),
  scope:'Frozen synthetic rosters, sunny/standard, paired seeds and side swaps. Exploratory only; versions change probabilities, action counts and RNG consumption. Sample SD is not proof of universal variance reduction. CI uses independent seed clusters and a normal approximation.',groups};
await writeFile(new URL('matches.json',out),JSON.stringify(rows,null,2)+'\n');
await writeFile(new URL('summary.json',out),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
