import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {coordinates,direction,playerByKey} from '../versus/v4/world.js';
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const duration=Number(args.duration??600),seeds=Number(args.seeds??3);
const cases={width:[.5,1.1],press:[.2,.9],directness:[.2,.85],lineHeight:[.2,.8],restDefense:['adventurous','conservative'],clockManagement:['quick','slow']};
const rows=[];
const sourceHashes=Object.fromEntries(fs.readdirSync('versus/v4').filter(f=>f.endsWith('.js')).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join('versus/v4',f))).digest('hex')]));
for(const [field,values] of Object.entries(cases))for(const value of values)for(const side of [0,1])for(let seed=0;seed<seeds;seed++){
  const input=demoInput({home:'balanced',away:'balanced',duration,seed:`instruction-control-${seed}`});input.teams[side].instructions={[field]:value};
  const m=createMatch(input,{recording:false}),samples={attack:0,defend:0,width:0,line:0,rest:0};
  while(m.state.phase!=='finished'){
    advanceMatch(m,5);const s=m.state;if(s.phase!=='playing')continue;
    const holder=playerByKey(s,s.ball.holder),owner=holder?.side??s.ball.flight?.side??s.lastOwner,{localPoint}=coordinates(s);
    const own=s.players.filter(p=>p.side===side&&p.active&&p.role!=='GK');
    if(owner===side){samples.attack++;samples.width+=Math.max(...own.map(p=>p.y))-Math.min(...own.map(p=>p.y));samples.rest+=s.coordination[side].restDefense.length;}
    else {const cb=own.filter(p=>p.role==='CB');samples.defend++;samples.line+=cb.reduce((n,p)=>n+localPoint(p,side).x,0)/Math.max(1,cb.length);}
  }
  const events=m.events.filter(e=>e.side===side),decisions=events.filter(e=>e.decision),passes=events.filter(e=>e.type==='pass');
  const mean=(n,d)=>n/Math.max(1,d),stats=m.state.stats[side];
  rows.push({field,value,side,seed,score:m.state.score,metrics:{
    attackingWidth:mean(samples.width,samples.attack),defensiveLine:mean(samples.line,samples.defend),restDefenders:mean(samples.rest,samples.attack),
    pressSeconds:stats.pressSeconds,fitnessSpent:m.state.players.filter(p=>p.side===side).reduce((n,p)=>n+100-p.fitness,0),
    passProgress:mean(passes.reduce((n,e)=>n+(e.target.x-e.position.x)*direction(side,{clock:e.clock}),0),passes.length),
    plannedObservationSeconds:mean(events.filter(e=>e.controlPlan).reduce((n,e)=>n+e.controlPlan.duration,0),events.filter(e=>e.controlPlan).length),
    passCompletion:mean(stats.completed,stats.passes),shots:stats.shots,goals:m.state.score[side],conceded:m.state.score[1-side],
    shotConsidered:decisions.filter(e=>e.decision.considered?.shot).length,weakSideConsidered:decisions.filter(e=>e.decision.considered?.weakSide).length,
    weakSideSelected:passes.filter(e=>e.intent==='switch').length,cutbackConsidered:decisions.filter(e=>e.decision.considered?.cutback).length,cutbackSelected:passes.filter(e=>e.intent==='cutback').length}});
}
const grouped=Object.fromEntries(Object.entries(cases).map(([field,values])=>[field,Object.fromEntries(values.map(value=>{
  const subset=rows.filter(r=>r.field===field&&r.value===value),keys=Object.keys(subset[0].metrics);
  return [value,Object.fromEntries(keys.map(key=>[key,subset.reduce((sum,r)=>sum+r.metrics[key],0)/subset.length]))];
}))]));
const checks={width:grouped.width[1.1].attackingWidth>grouped.width[.5].attackingWidth,
  press:grouped.press[.9].pressSeconds>grouped.press[.2].pressSeconds,
  lineHeight:grouped.lineHeight[.8].defensiveLine>grouped.lineHeight[.2].defensiveLine,
  restDefense:grouped.restDefense.conservative.restDefenders>grouped.restDefense.adventurous.restDefenders,
  directness:grouped.directness[.85].passProgress>grouped.directness[.2].passProgress,
  clockManagement:grouped.clockManagement.slow.plannedObservationSeconds>grouped.clockManagement.quick.plannedObservationSeconds};
const report={version:1,runs:rows.length,duration,seeds,sourceHashes,checks,grouped,rows,
  scope:'Same synthetic starting squads, one instruction changed, both sides and multiple seeds. Whole trajectories branch; shared seeds do not pair every later random draw. Spatial metrics sampled each football second; considered counts are decision windows, not independent chances.'};
const output=args.output??'outputs/v4-tactics-20261117/single-factor.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,runs:rows.length,checks}));if(args.enforce==='true'&&Object.values(checks).some(v=>!v))process.exitCode=1;
