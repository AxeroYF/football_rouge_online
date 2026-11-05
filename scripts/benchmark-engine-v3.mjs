import fs from 'node:fs/promises';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {simulateV2Match} from '../versus/v2/match-engine-v2.js';
import {V2_MATCH_PARAMETERS,resolveV2MatchParameters} from '../versus/v2/match-parameters-v2.js';
import {V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';

if(!isMainThread){
 const independentParameters=resolveV2MatchParameters({...V3_MATCH_PARAMETERS,v3:{...V3_MATCH_PARAMETERS.v3,sampling:{...V3_MATCH_PARAMETERS.v3.sampling,stageRegularity:0,goalRegularity:0}}});
 parentPort.on('message',task=>{
  try{
   const a=makeAssessmentTeam('A',{boardLines:true,holdScorePlans:true,...task.scenario.a});
   const b=makeAssessmentTeam('B',{boardLines:true,holdScorePlans:true,...task.scenario.b});
   const parameters=task.version===30?independentParameters:task.version===3?V3_MATCH_PARAMETERS:V2_MATCH_PARAMETERS;
   const start=performance.now();
   const match=simulateV2Match(task.mirrored?[b,a]:[a,b],{parameters,seed:task.seed,possessionChains:180,weather:'sunny',referee:'standard'});
   const i=task.mirrored?1:0,j=1-i;
   parentPort.postMessage({id:task.scenario.id,pair:task.pair,version:task.version,mirrored:task.mirrored,seed:task.seed,score:[match.score[i],match.score[j]],xg:[match.teams[i].stats.xg,match.teams[j].stats.xg],shots:[match.teams[i].stats.shots,match.teams[j].stats.shots],ms:performance.now()-start});
  }catch(error){parentPort.postMessage({error:error.stack});}
 });
}else{
 const smoke=process.argv.includes('--smoke');
 const independent=process.argv.includes('--independent-equal');
 let scenarios=[
  {id:'equal',a:{},b:{},pairs:32},
  {id:'ability88',a:{ability:88},b:{},pairs:16},
  {id:'strong-allout-vs-counter',a:{ability:88,profile:'allOut'},b:{profile:'counter'},pairs:16},
  ...['left','right'].flatMap(defense=>['left','right'].map(attack=>({id:`attack-${attack}-defend-${defense}`,a:{plan:{inPossessionDetails:{attackDirection:attack}}},b:{plan:{outOfPossessionDetails:{defenseDirection:defense}}},pairs:16}))),
  ...['protectCenter','forceWide'].flatMap(defense=>['left','center'].map(attack=>({id:`attack-${attack}-width-${defense}`,a:{plan:{inPossessionDetails:{attackDirection:attack}}},b:{plan:{outOfPossessionDetails:{defensiveWidth:defense}}},pairs:16}))),
 ];
 if(smoke)for(const scenario of scenarios)scenario.pairs=2;
 if(process.argv.includes('--focus')){
  scenarios=scenarios.filter(s=>!s.id.includes('-width-'));
  for(const scenario of scenarios)scenario.pairs=scenario.id==='equal'?24:8;
 }
 if(independent)scenarios=[{id:'equal',a:{},b:{},pairs:24}];
 const tasks=scenarios.flatMap(scenario=>Array.from({length:scenario.pairs},(_,pair)=>(independent?[30]:[2,3]).flatMap(version=>[false,true].map(mirrored=>({scenario,pair,version,mirrored,seed:'yffm-v3-paired:'+pair}))))).flat();
 const rows=[];let cursor=0,completed=0;const started=Date.now();
 await fs.mkdir('outputs/engine-v3',{recursive:true});
 const file='outputs/engine-v3/'+(independent?'independent-equal':smoke?'smoke':'paired')+'.json';
 await new Promise((resolve,reject)=>{
  const workers=[];
  const fail=error=>{for(const worker of workers)worker.terminate();reject(error);};
  for(let i=0;i<3;i++){
   const worker=new Worker(new URL(import.meta.url));workers.push(worker);worker.on('error',fail);
   worker.on('message',async row=>{
    if(row.error)return fail(new Error(row.error));
    rows.push(row);completed++;
    if(completed%16===0)console.log(JSON.stringify({completed,total:tasks.length,elapsedSeconds:Math.round((Date.now()-started)/1000)}));
    if(completed===tasks.length){
     await fs.writeFile(file,JSON.stringify({scenarios,v3Parameters:V3_MATCH_PARAMETERS,rows,elapsedMs:Date.now()-started},null,2));
     for(const item of workers)await item.terminate();resolve();
    }else if(cursor<tasks.length)worker.postMessage(tasks[cursor++]);
   });
   if(cursor<tasks.length)worker.postMessage(tasks[cursor++]);
  }
 });
 console.log(file);
}
