import fs from 'node:fs';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
const source=readLeagueSource(process.cwd()),rows=[];
const position=p=>p?{x:p.x,y:p.y,vx:p.vx,vy:p.vy,task:p.task?.type,target:p.task?.target}:null;
for(let i=0;i<16;i++){
  const {input}=compileRealMatch(source,{homeId:source.teams[i].id,awayId:source.teams[(i+1)%16].id,fixtureId:`arrival-${i}`,duration:600,seed:'real-adapter-train-0'});
  input.format='clip';const match=createMatch(input,{recording:false}),passes=new Map();let cursor=0;
  while(match.state.phase!=='finished'){
    const before=new Map(match.state.players.map(p=>[p.key,position(p)]));advanceMatch(match);
    for(const event of match.events.slice(cursor)){
      if(event.type==='pass'&&event.to)passes.set(event.id,{team:source.teams[i].id,id:event.id,time:event.time,to:event.to,role:event.actorRole,distance:event.execution?.distance,deviation:event.execution?.deviation,trajectory:event.trajectory,decision:event.decision?.candidates?.[0],release:before.get(event.to)});
      if(event.type==='loose'&&passes.has(event.decisionId)){
        const pass=passes.get(event.decisionId),p=match.state.players.find(p=>p.key===pass.to),target=p.task?.target;
        rows.push({...pass,endTime:event.time,arrival:position(p),targetGap:target?Math.hypot(p.x-target.x,p.y-target.y):null,ball:position(match.state.ball)});
      }
    }cursor=match.events.length;
  }
}
const ground=rows.filter(r=>r.trajectory==='ground'),mean=(list,fn)=>list.reduce((n,r)=>n+fn(r),0)/list.length;
const summary={unclaimed:rows.length,ground:ground.length,meanTargetGap:mean(ground,r=>r.targetGap),meanDeviation:mean(ground,r=>Math.abs(r.deviation)),examples:ground.filter(r=>r.targetGap>1).slice(0,12)};
fs.writeFileSync('outputs/v4-real-teams-20261117/pass-arrival-diagnostic.json',JSON.stringify({summary,rows},null,2));console.log(JSON.stringify(summary));
