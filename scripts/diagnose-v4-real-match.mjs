import fs from 'node:fs';
import path from 'node:path';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {simulateMatch} from '../versus/v4/engine.js';
import {shotDiagnostics} from '../versus/v4/diagnostics.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const source=readLeagueSource(process.cwd()),home=args.home??'ydl-team-14',away=args.away??'ydl-team-2',seed=args.seed??'real-adapter-train-3';
const e=compileRealMatch(source,{homeId:home,awayId:away,fixtureId:`diagnostic:${home}:${away}:${seed}`,seed});
const m=simulateMatch(e.input,{recording:false}),byId=new Map(m.events.map(event=>[event.id,event]));
const teams=e.input.teams.map((team,side)=>({id:team.id,name:team.name,
  meanAttribute:team.players.reduce((n,p)=>n+Object.values(p.attributes).reduce((a,b)=>a+b,0)/Object.keys(p.attributes).length,0)/11,
  initialFitness:team.players.reduce((n,p)=>n+p.fitness,0)/11,finalFitness:m.state.players.filter(p=>p.side===side&&p.active).map(p=>({id:p.id,role:p.role,fitness:p.fitness})),
  instructions:team.instructions,scorePlans:team.scorePlans,scoreTriggers:team.scoreTriggers,
  stats:m.state.stats[side],shots:shotDiagnostics(m.events.filter(event=>event.type!=='shot'||event.side===side)),
  periods:[1,2].map(period=>{const events=m.events.filter(event=>event.clock.period===period&&event.side===side);return {period,shots:events.filter(e=>e.type==='shot').length,passes:events.filter(e=>e.type==='pass').length,goals:m.events.filter(e=>e.clock.period===period&&e.type==='goal'&&e.scoringSide===side).length};})}));
const goals=m.events.filter(event=>event.type==='goal').map(event=>{
  const shot=byId.get(event.decisionId);return {time:event.time,period:event.clock.period,side:event.scoringSide,score:event.score,ownGoal:event.ownGoal,shot:shot?{actor:shot.actor,bodyPart:shot.bodyPart,position:shot.position,target:shot.target,intent:shot.intent,execution:shot.execution,opportunity:shot.opportunity}:null};
});
const report={version:m.state.version,dependencyHashes:dependencyHashes(['versus/v4/engine.js','versus/v4-adapter/read-source.js','versus/v4-adapter/compile-match.js']),sourceFingerprint:source.fingerprint,home,away,seed,score:m.state.score,teams,goals,
  plans:m.events.filter(e=>e.type==='tacticalPlanChanged').map(e=>({time:e.time,side:e.side,plan:e.plan,score:e.score})),scope:'Read-only diagnostic; no target frequencies feed into match decisions.'};
const output=path.resolve(args.output??`outputs/v4-real-teams-20261117/diagnostic-${home}-${away}.json`);fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,score:report.score,teams:teams.map(t=>({id:t.id,meanAttribute:t.meanAttribute,periods:t.periods})),plans:report.plans}));
