import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {simulateV2Match} from '../versus/v2/match-engine-v2.js';
import {makeAssessmentTeam,fullMatchScenarios} from './engine-assessment-fixtures.mjs';

if(!isMainThread){
 parentPort.on('message',task=>{
  try{
   const a=makeAssessmentTeam('A',{...task.scenario.a,holdScorePlans:task.constant,boardLines:task.modern}),b=makeAssessmentTeam('B',{...task.scenario.b,holdScorePlans:task.constant,boardLines:task.modern});
   const started=performance.now();
   const match=simulateV2Match(task.mirrored?[b,a]:[a,b],{seed:task.seed,possessionChains:180,weather:'sunny',referee:'standard'});
   const i=task.mirrored?1:0,j=1-i;
   const stats=match.teams.map(t=>t.stats);
   parentPort.postMessage({taskId:task.taskId,scenario:task.scenario.id,pair:task.pair,mirrored:task.mirrored,seed:task.seed,ms:performance.now()-started,score:[match.score[i],match.score[j]],xg:[stats[i].xg,stats[j].xg],shots:[stats[i].shots,stats[j].shots],possession:stats[i].possessionSeconds/5400,reds:[stats[i].redCards,stats[j].redCards],injuries:[stats[i].injuries,stats[j].injuries],independentEvents:match.events.filter(e=>['blackWhistle','brawl','ownGoal','lightning'].includes(e.type)).map(e=>e.type),events:match.events.length});
  }catch(error){parentPort.postMessage({error:error.stack});}
 });
}else{
 const output=path.resolve('outputs/engine-assessment');await fs.mkdir(output,{recursive:true});
 const quick=process.argv.includes('--smoke');
 const seedOffset=Number(process.argv.find(value=>value.startsWith('--seed-offset='))?.split('=')[1]??0);
 const constant=process.argv.includes('--constant');
 const modern=process.argv.includes('--board-lines');
 const batches=Number(process.argv.find(value=>value.startsWith('--batches='))?.split('=')[1]??1);
 const scenarios=quick?fullMatchScenarios.slice(0,2).map(s=>({...s,pairs:1})):fullMatchScenarios;
 const tasks=scenarios.flatMap(scenario=>Array.from({length:scenario.pairs*batches},(_,index)=>{const pair=index%scenario.pairs+seedOffset+Math.floor(index/scenario.pairs)*32;return [false,true].map(mirrored=>({scenario,pair,mirrored,constant,modern,seed:'yffm-engine-audit-20261103:'+pair}));})).flat();
 tasks.forEach((task,index)=>task.taskId=index);
 let cursor=0,completed=0;const rows=[];const started=Date.now();
 const file=path.join(output,quick?'matches-smoke.json':modern?'matches-modern.json':constant?'matches-constant.json':seedOffset?'matches-'+seedOffset+'.json':'matches.json');
 const hash=createHash('sha256').update(await fs.readFile('versus/v2/match-parameters-v2.json')).digest('hex');
 await new Promise((resolve,reject)=>{
  const workers=[];
  const fail=error=>{for(const worker of workers)worker.terminate();reject(error);};
  for(let i=0;i<3;i++){
   const worker=new Worker(new URL(import.meta.url),{workerData:{audit:true}});workers.push(worker);
   worker.on('error',fail);
   worker.on('message',async row=>{
    if(row.error)return fail(new Error(row.error));
    rows.push(row);completed++;
    console.log(JSON.stringify({completed,total:tasks.length,scenario:row.scenario,score:row.score,matchMs:Math.round(row.ms),elapsedSeconds:Math.round((Date.now()-started)/1000)}));
    // Single completion can terminate the other idle workers only after all data is collected.
    if(completed===tasks.length){
     await fs.writeFile(file,JSON.stringify({parametersSha256:hash,chains:180,weather:'sunny',referee:'standard',constantScorePlans:constant,explicitBoardLines:modern,fixture:'11 synthetic starters, all attributes 80 or 88, no traits/bonds/substitutes; '+(constant?'same explicit plan in all score states':'opening plan only, native default leading/trailing fallbacks')+'; '+(modern?'current explicit default board lines':'legacy board-role inference')+'; native full engine, no calculation changes',scenarios,rows,elapsedMs:Date.now()-started},null,2));
     for(const item of workers)await item.terminate();resolve();
    }else if(cursor<tasks.length)worker.postMessage(tasks[cursor++]);
   });
   if(cursor<tasks.length)worker.postMessage(tasks[cursor++]);
  }
 });
 console.log(file);
}
