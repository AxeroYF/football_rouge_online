import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';
import {V32_MATCH_PARAMETERS,V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {simulateV3Match} from '../versus/v3/match-engine-v3.js';
import {tacticalProcessSummary} from '../versus/v3/tactical-execution.js';

const quick=process.argv.includes('--quick'),pairs=quick?1:4;
const out=new URL(`../outputs/v33-calibration${quick?'-quick':''}/`,import.meta.url);
await mkdir(out,{recursive:true});
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const scenarios=[
  {id:'default',plan:{},versions:[V32_MATCH_PARAMETERS,V3_MATCH_PARAMETERS]},
  {id:'wide-press',plan:{pressTrigger:'wide',pressAssignment:'closeDown'}},
  {id:'screen-creator',plan:{pressTrigger:'backPass',pressAssignment:'screen',defensiveFocus:'creator'}},
  {id:'left-pivot',plan:{buildUpRoute:'left',buildUpOutlet:'pivot',pressureEscape:'switch'}},
  {id:'near-attack',plan:{setPieceRoutine:'near',setPieceCommitment:'attack'}},
  {id:'far-protect',plan:{setPieceRoutine:'far',setPieceCommitment:'protect'}},
  {id:'short-balanced',plan:{setPieceRoutine:'short',setPieceCommitment:'balanced'}},
];
const rows=[];
for(const scenario of scenarios)for(const parameters of scenario.versions??[V3_MATCH_PARAMETERS]) {
  for(let seed=0;seed<pairs;seed++)for(const reversed of [false,true]) {
    const a=makeAssessmentTeam('A',{boardLines:true,holdScorePlans:true,plan:scenario.plan});
    const b=makeAssessmentTeam('B',{boardLines:true,holdScorePlans:true});
    const before=performance.now(),match=simulateV3Match(reversed?[b,a]:[a,b],{parameters,seed:`v33-calibration:${seed}`,weather:'sunny',referee:'standard'});
    const index=reversed?1:0,summary=tacticalProcessSummary(match).teams[index];
    rows.push({version:match.engineVersion,scenario:scenario.id,seed,reversed,score:match.score,
      netGoals:match.score[index]-match.score[1-index],netXg:match.teams[index].stats.xg-match.teams[1-index].stats.xg,
      totalGoals:match.score[0]+match.score[1],shots:match.teams.map(t=>t.stats.shots),chains:match.chains.length,
      fitness:mean(match.teams[index].players.filter(p=>p.active).map(p=>p.state.fitness)),
      opponentFitness:mean(match.teams[1-index].players.filter(p=>p.active).map(p=>p.state.fitness)),
      execution:summary,elapsedMs:performance.now()-before});
  }
  console.log(`${parameters.engineVersion} ${scenario.id}: ${pairs*2} matches`);
}
const groups=[...new Set(rows.map(r=>`${r.version}:${r.scenario}`))].map(key=>{
  const rs=rows.filter(r=>`${r.version}:${r.scenario}`===key);
  const sum=get=>rs.reduce((s,r)=>s+get(r.execution),0);
  return {key,matches:rs.length,meanGoals:mean(rs.map(r=>r.totalGoals)),meanNetXg:mean(rs.map(r=>r.netXg)),
    meanShots:mean(rs.map(r=>r.shots[0]+r.shots[1])),meanChains:mean(rs.map(r=>r.chains)),
    meanFitness:mean(rs.map(r=>r.fitness)),meanOpponentFitness:mean(rs.map(r=>r.opponentFitness)),meanElapsedMs:mean(rs.map(r=>r.elapsedMs)),
    pressAttempts:sum(e=>e.press.attempts),pressRecoveries:sum(e=>e.press.recoveries),pressPlayerSeconds:sum(e=>e.press.playerSeconds),
    markActions:sum(e=>e.mark.actions),buildAttempts:sum(e=>e.build.attempts),buildSuccesses:sum(e=>e.build.successes),
    corners:sum(e=>e.corners.attempts),cornerShots:sum(e=>e.corners.shots),secondBalls:sum(e=>e.corners.secondBalls)};
});
const summary={generatedAt:new Date().toISOString(),matches:rows.length,quick,scope:'Frozen equal-ability 4-3-3; paired seeds and side swaps; exploratory process checks, not causal evidence or universal balance claims.',groups};
await writeFile(new URL('matches.json',out),JSON.stringify(rows,null,2)+'\n');
await writeFile(new URL('summary.json',out),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
