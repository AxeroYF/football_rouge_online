import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { createV22DemoInput } from '../engine/v2.2/demo-fixture.mjs';
import { createLeagueLiveLeg, advanceLeagueLiveLeg, publicLeagueLiveLeg, leagueBroadcastDelta } from '../engine/league-match-engine.mjs';

const rows=[];
for(let i=0;i<6;i++){
  const input=createV22DemoInput('league-benchmark-'+i),samples=[];
  const leg=createLeagueLiveLeg({home:input.teams[0],away:input.teams[1],seed:input.seed,startedAt:0,knockout:false},{engine:'v2.2',liveDurationMs:360000});
  let fullBytes=0,deltaBytes=0,viewBuildMs=0,sharedReadMs=0;
  for(let now=500;now<=360000&&!leg.match.finished;now+=500){
    const start=performance.now();advanceLeagueLiveLeg(leg,now);samples.push(performance.now()-start);
    if(now===180000){
      const viewStart=performance.now(),view=publicLeagueLiveLeg(leg);viewBuildMs=performance.now()-viewStart;
      const sharedStart=performance.now();for(let j=0;j<100;j++)publicLeagueLiveLeg(leg);sharedReadMs=performance.now()-sharedStart;
      fullBytes=Buffer.byteLength(JSON.stringify(view));deltaBytes=Buffer.byteLength(JSON.stringify(leagueBroadcastDelta(view,view.dynamic.frames.at(-1).tick-40)));
    }
  }
  const sorted=[...samples].sort((a,b)=>a-b);
  rows.push({seed:input.seed,finished:leg.match.finished,score:leg.match.score,simulationMs:samples.reduce((a,b)=>a+b,0),sliceP95Ms:sorted[Math.floor(sorted.length*.95)],sliceMaxMs:Math.max(...samples),liveCheckpointBytes:Buffer.byteLength(JSON.stringify(leg)),viewBuildMs,shared100ReadsMs:sharedReadMs,fullBytes,deltaBytes});
}
mkdirSync('outputs/league-dynamic-review',{recursive:true});
const report={node:process.version,cpu:cpus()[0]?.model,notes:'Local measurements, not a production capacity guarantee. 0.5 simulated seconds per scheduler visit; includes condition rules and checkpoints.',rows};
writeFileSync('outputs/league-dynamic-review/benchmark.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
