import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';
import {V31_MATCH_PARAMETERS as V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {resolveV2MatchParameters} from '../versus/v2/match-parameters-v2.js';
import {createV2Match,advanceV2Match} from '../versus/v2/match-engine-v2.js';
import {initializeDiagnostics,ENGINE_RULE_OWNERSHIP} from '../versus/v3/diagnostics.js';
import {matchOutcomeRoll} from '../versus/v3/outcome-sampling.js';
import {configurationDigest} from '../versus/v3/match-configuration.js';

const out=new URL('../outputs/v31-calibration/',import.meta.url);
await mkdir(out,{recursive:true});
const quick=process.argv.includes('--quick');
const average=v=>v.reduce((s,x)=>s+x,0)/v.length;
const variance=v=>v.length>1?v.reduce((s,x)=>s+(x-average(v))**2,0)/(v.length-1):0;
const confidence=v=>{const mean=average(v),half=1.96*Math.sqrt(variance(v)/v.length);return {mean,approximate95CI:[mean-half,mean+half]};};
const legacy=resolveV2MatchParameters({...structuredClone(V3_MATCH_PARAMETERS),engineVersion:'3.0.0'});
const scenarios=[{id:'equal',pairs:quick?2:8,a:{},b:{}},
  {id:'ability-88-vs-80',pairs:quick?1:4,a:{ability:88},b:{}},
  {id:'patient-vs-press',pairs:quick?1:4,a:{profile:'patient'},b:{profile:'press'}}];
const rows=[];
for(const parameters of [legacy,V3_MATCH_PARAMETERS])for(const scenario of scenarios) {
  for(let seed=0;seed<scenario.pairs;seed++)for(const reversed of [false,true]) {
    const a=makeAssessmentTeam('A',{boardLines:true,holdScorePlans:true,...scenario.a});
    const b=makeAssessmentTeam('B',{boardLines:true,holdScorePlans:true,...scenario.b});
    const before=performance.now();
    const match=createV2Match(reversed?[b,a]:[a,b],{parameters,seed:`v31-baseline:${scenario.id}:${seed}`,weather:'sunny',referee:'standard'});
    if(!match.diagnostics)initializeDiagnostics(match,{diagnosticBaseline:true});
    advanceV2Match(match,180);
    const index=reversed?1:0;
    rows.push({engineVersion:match.engineVersion,scenario:scenario.id,seed,reversed,
      score:match.score,netGoals:match.score[index]-match.score[1-index],
      totalGoals:match.score[0]+match.score[1],netXg:match.teams[index].stats.xg-match.teams[1-index].stats.xg,
      shots:match.teams.map(t=>t.stats.shots),xg:match.teams.map(t=>t.stats.xg),
      elapsedMs:performance.now()-before,diagnostics:match.diagnostics.teams,
      serializedBytes:Buffer.byteLength(JSON.stringify(match))});
  }
  console.log(`${parameters.engineVersion} ${scenario.id}: ${scenario.pairs*2} matches`);
}
const groups=[];
for(const parameters of [legacy,V3_MATCH_PARAMETERS])for(const scenario of scenarios) {
  const selected=rows.filter(row=>row.engineVersion===parameters.engineVersion&&row.scenario===scenario.id);
  const paired=Array.from({length:scenario.pairs},(_,i)=>average(selected.filter(row=>row.seed===i).map(row=>row.netXg)));
  groups.push({engineVersion:parameters.engineVersion,scenario:scenario.id,matches:selected.length,
    meanTotalGoals:average(selected.map(r=>r.totalGoals)),netGoalStandardDeviation:Math.sqrt(variance(selected.map(r=>r.netGoals))),
    netXg:confidence(paired),meanElapsedMs:average(selected.map(r=>r.elapsedMs)),
    meanSerializedBytes:average(selected.map(r=>r.serializedBytes))});
}
// Treat each seed as one independent cluster. This also audits short shot runs
// and varying probabilities instead of only one fixed p and one bucket length.
const sampling=[];
for(const count of [4,12,24,60])for(const p of [.05,.18,.35,.65,'score-dependent']) {
  const errors=[],counts=[];
  for(let seed=0;seed<(quick?512:4096);seed++) {
    const match={parameters:V3_MATCH_PARAMETERS,simulationSeed:`v31-sampling:${seed}`};
    let actual=0,expected=0;
    for(let i=0;i<count;i++) {
      const probability=p==='score-dependent'?(actual===0?.24:.16):p;
      const goal=matchOutcomeRoll(match,'goal:0')<probability;
      actual+=Number(goal);expected+=probability;
    }
    counts.push(actual);errors.push((actual-expected)/count);
  }
  sampling.push({shots:count,probability:p,seeds:counts.length,meanGoals:average(counts),
    goalCountVariance:variance(counts),frequencyError:confidence(errors)});
}
const bins={};
for(const row of rows)for(const team of row.diagnostics)for(const [kind,values] of Object.entries({stage:team.stages,shot:team.shots}))for(const [name,entry] of Object.entries(values)) {
  const key=`${row.engineVersion}:${kind}:${name}`;
  const dest=bins[key]??={attempts:0,expected:0,actual:0,brierSum:0,bins:Array.from({length:5},()=>({attempts:0,expected:0,actual:0,brierSum:0}))};
  for(const key of ['attempts','expected','actual','brierSum'])dest[key]+=entry[key];
  entry.bins.forEach((bin,index)=>{for(const key of ['attempts','expected','actual','brierSum'])dest.bins[index][key]+=bin[key];});
}
const summary={generatedAt:new Date().toISOString(),quick,parameterDigest:configurationDigest(V3_MATCH_PARAMETERS),
  scope:'Synthetic frozen rosters, sunny/standard, paired seeds and side swaps. Exploratory calibration, not a production win-rate guarantee. CIs use independent seed clusters and a normal approximation.',
  groups,sampling,calibration:bins,ruleOwnership:ENGINE_RULE_OWNERSHIP};
await writeFile(new URL('matches.json',out),JSON.stringify(rows,null,2)+'\n');
await writeFile(new URL('summary.json',out),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({matches:rows.length,summary:new URL('summary.json',out).pathname,groups},null,2));
