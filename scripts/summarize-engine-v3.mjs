import fs from 'node:fs/promises';
import {createV2MatchRng} from '../versus/v2/match-engine-v2.js';
const paired=JSON.parse(await fs.readFile('outputs/engine-v3/paired.json','utf8'));
const independent=JSON.parse(await fs.readFile('outputs/engine-v3/independent-equal.json','utf8'));
const tactical=JSON.parse(await fs.readFile('outputs/engine-v3/tactical-probe.json','utf8'));
const mean=values=>values.reduce((s,x)=>s+x,0)/values.length;
const variance=values=>values.reduce((s,x)=>s+(x-mean(values))**2,0)/(values.length-1);
const sd=rows=>Math.sqrt(variance(rows.map(r=>r.score[0]-r.score[1])));
const rows=[...paired.rows,...independent.rows];
const groups=[...Map.groupBy(rows,row=>row.id+':'+row.version)].map(([key,data])=>({
 key,games:data.length,seedPairs:new Set(data.map(row=>row.pair)).size,
 wins:data.filter(row=>row.score[0]>row.score[1]).length,draws:data.filter(row=>row.score[0]===row.score[1]).length,
 goalMargin:mean(data.map(row=>row.score[0]-row.score[1])),goalMarginSampleSD:sd(data),
 totalGoals:mean(data.map(row=>row.score[0]+row.score[1])),xgMargin:mean(data.map(row=>row.xg[0]-row.xg[1])),meanWallMs:mean(data.map(row=>row.ms)),
}));
const active=rows.filter(r=>r.id==='equal'&&r.version===3);
function bootstrapRatio(reference){
 const rng=createV2MatchRng('v3-variance-bootstrap'),samples=[],seeds=[...new Set(active.map(r=>r.pair))];
 for(let i=0;i<5000;i++){
  const a=[],b=[];
  for(let j=0;j<seeds.length;j++){
   const seed=seeds[Math.floor(rng()*seeds.length)];a.push(...active.filter(r=>r.pair===seed));b.push(...reference.filter(r=>r.pair===seed));
  }
  samples.push(sd(a)/sd(b));
 }
 samples.sort((a,b)=>a-b);
 return {ratio:sd(active)/sd(reference),ci95:[samples[125],samples[4874]],method:'paired seed-cluster bootstrap, 5000 draws'};
}
const summary={groups,varianceComparisons:{againstV21:bootstrapRatio(rows.filter(r=>r.id==='equal'&&r.version===2)),againstV3Independent:bootstrapRatio(independent.rows)},tactical:{conditions:tactical.rows.length,samplesPerCondition:tactical.rows[0].count,nativeOutputChecks:tactical.nativeOutputChecks,contrast:tactical.contrast},limits:'Synthetic equal-attribute squads, sunny/standard; 24 seed pairs for variance and 8 for other full-match cells; tactical probe uses fixed state and raw chain shot quality, not official match xG.'};
await fs.writeFile('outputs/engine-v3/summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
