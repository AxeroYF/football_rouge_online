import fs from 'node:fs';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {simulateMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
const source=readLeagueSource(process.cwd()),groups={};
for(const kind of ['real','synthetic'])for(let i=0;i<16;i++){
  const input=kind==='real'?compileRealMatch(source,{homeId:source.teams[i].id,awayId:source.teams[(i+1)%16].id,fixtureId:`passing-${i}`,duration:600,seed:'real-adapter-train-0'}).input:demoInput({home:['balanced','left','press','counter'][i%4],away:['balanced','left','press','counter'][Math.floor(i/4)],duration:600,seed:'adapter-train-0'});
  input.format='clip';const m=simulateMatch(input,{recording:false});
  for(const p of m.events.filter(e=>e.type==='pass')){
    const touches=m.events.filter(e=>e.decisionId===p.id&&['receive','miscontrol','interception','secondBall','loose','offside','out'].includes(e.type));
    const outcome=touches.find(e=>e.type!=='loose')??touches[0];
    const selected=p.decision?.candidates?.[0],margin=selected?.arrivalMargin??null;
    const keys=[kind,`${kind}:role:${p.actorRole}`,`${kind}:restart:${p.restartType??'open'}`,`${kind}:margin:${margin===null?'unknown':margin<0?'negative':margin<.5?'underHalf':margin<1?'halfToOne':'overOne'}`];
    for(const key of keys){const row=groups[key]??={passes:0,completed:0,miscontrol:0,interception:0,loose:0,other:0,distance:0,margin:0};row.passes++;row.distance+=p.execution?.distance??0;row.margin+=margin??0;
      if(outcome?.type==='receive'&&outcome.side===p.side)row.completed++;else if(['miscontrol','interception','loose'].includes(outcome?.type))row[outcome.type]++;else row.other++;
    }
  }
}
for(const row of Object.values(groups)){row.completion=row.completed/row.passes;row.meanDistance=row.distance/row.passes;row.meanMargin=row.margin/row.passes;}
fs.writeFileSync('outputs/v4-real-teams-20261117/passing-diagnostic.json',JSON.stringify({groups},null,2));console.log(JSON.stringify(groups));
