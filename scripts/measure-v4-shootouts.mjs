import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {VERSION} from '../versus/v4/world.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const root=path.resolve('versus/v4');
const sourceHashes=Object.fromEntries(fs.readdirSync(root).filter(f=>f.endsWith('.js')).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const count=Number(args.seeds??32),rows=[];let skipped=0;
for(let i=0;i<count;i++){
  const input=demoInput({duration:60,format:'full',seed:`${args.split??'penalty-check'}-${i}`});input.competition={resolution:'penalties'};
  const m=createMatch(input,{recording:false});while(!m.state.shootout&&m.state.phase!=='finished')advanceMatch(m);
  if(!m.state.shootout){skipped++;continue;}
  const stats=JSON.stringify(m.state.stats),score=[...m.state.score];while(m.state.phase!=='finished'){advanceMatch(m,250);assert.ok(m.state.time<2000);}
  assert.equal(JSON.stringify(m.state.stats),stats);assert.deepEqual(m.state.score,score);
  assert.ok(m.events.filter(e=>e.type==='shootoutShot').every(e=>e.target.x===m.state.shootout.goalX));
  rows.push({seed:input.seed,score:m.state.shootout.score,kicks:m.state.shootout.kicks,winner:m.state.shootout.winner});
}
const kicks=rows.reduce((n,r)=>n+r.kicks.length,0),goals=rows.reduce((n,r)=>n+r.score[0]+r.score[1],0);
const report={version:VERSION,split:args.split??'penalty-check',sourceHashes,passed:goals/kicks>=.55&&goals/kicks<=.85,runs:rows.length,skipped,kicks,goals,conversion:goals/kicks,
  scope:'Synthetic equal squads with short regulation; only tied games enter the shootout. Engineering conversion band 55–85%, not a real-league estimate. Main score and regular statistics remain unchanged.',rows};
const output=path.resolve(args.output??'outputs/v4-capabilities-20261117/shootout-train.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,runs:rows.length,skipped,kicks,goals,conversion:report.conversion,passed:report.passed}));if(args.enforce==='true'&&!report.passed)process.exitCode=1;
