import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Worker,isMainThread,workerData,parentPort} from 'node:worker_threads';
import {simulateMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const args=workerData?.args??Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const sourceHashes=dependencyHashes(['scripts/audit-v4-fairness.mjs']);
const seeds=Number(args.seeds??64),presets=['balanced','left','press','counter'];
const workers=Math.max(1,Math.min(4,Number(args.workers??4)));
const jobs=workerData?.jobs??presets.flatMap(preset=>Array.from({length:seeds},(_,seed)=>({preset,seed})));
const rows=[];
if(isMainThread){
  const chunks=await Promise.all(Array.from({length:workers},(_,index)=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{args,jobs:jobs.filter((_,i)=>i%workers===index)}});
    worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(new Error(`fairness worker exited ${code}`));});
  })));rows.push(...chunks.flat());
  const summary=sample=>({runs:sample.length,homeShare:sample.reduce((n,r)=>n+(r.score[0]>r.score[1]?1:r.score[0]===r.score[1]?.5:0),0)/sample.length,
    meanGoalDifference:sample.reduce((n,r)=>n+r.score[0]-r.score[1],0)/sample.length});
  const total=summary(rows),byPreset=Object.fromEntries(presets.map(p=>[p,summary(rows.filter(r=>r.preset===p))]));
  // Declared before this audit is run: population checks, never match quotas.
  const targets={homeShare:[.42,.58],meanGoalDifference:[-.35,.35],presetHomeShare:[.30,.70]};
  const gates={homeShare:total.homeShare>=.42&&total.homeShare<=.58,meanGoalDifference:Math.abs(total.meanGoalDifference)<=.35,
    noExtremePresetBias:Object.values(byPreset).every(r=>r.homeShare>=.30&&r.homeShare<=.70),labelsDoNotAffectPhysics:rows.every(r=>r.labelInvariant)};
  assert.deepEqual(dependencyHashes(['scripts/audit-v4-fairness.mjs']),sourceHashes);
  const output=path.resolve(args.output??'outputs/v4-real-teams-20261117/fairness.json');fs.mkdirSync(path.dirname(output),{recursive:true});
  const report={passed:Object.values(gates).every(Boolean),gates,targets,total,byPreset,rows,dependencyHashes:sourceHashes,
    scope:'Equal starting squads and identical tactics on both sides, full matches with ends change. Home share counts draws as half. Label changes compare exact mechanical state in a separate short replay; no claim of real-league population fit.'};
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,passed:report.passed,gates,total,byPreset}));if(!report.passed)process.exitCode=1;
}else{
  const mechanical=state=>({score:state.score,stats:state.stats,random:state.random,time:state.time,phase:state.phase,
    players:state.players.map(({key,x,y,vx,vy,fitness,active,status,attributes})=>({key,x,y,vx,vy,fitness,active,status,attributes}))});
  for(const {preset,seed} of jobs){
    const input=demoInput({home:preset,away:preset,duration:5400,seed:`fairness-holdout-a-${preset}-${seed}`});
    const match=simulateMatch(input,{recording:false});let labelInvariant=true;
    if(seed<4){
      const short={...input,duration:600,format:'clip'},renamed=structuredClone(short);
      for(const [side,team] of renamed.teams.entries()){team.name=`Neutral ${side}`;for(const [i,p] of team.players.entries())p.name=`Anonymous ${side}-${i}`;}
      assert.deepEqual(mechanical(simulateMatch(short,{recording:false}).state),mechanical(simulateMatch(renamed,{recording:false}).state));
    }
    rows.push({preset,seed,score:match.state.score,labelInvariant,labelChecked:seed<4});
  }
  parentPort.postMessage(rows);
}
