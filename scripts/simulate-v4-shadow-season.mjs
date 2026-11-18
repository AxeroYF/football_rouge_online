import fs from 'node:fs';
import path from 'node:path';
import {Worker,isMainThread,workerData,parentPort} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {simulateMatch} from '../versus/v4/engine.js';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {createShadowSeason,shadowSchedule,applyShadowRound,shadowSummary} from '../versus/v4-adapter/shadow-season.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const args=workerData?.args??Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const workers=Math.max(1,Math.min(4,Number(args.workers??4)));
const sourceHashes=dependencyHashes(['scripts/simulate-v4-shadow-season.mjs']);
if(!isMainThread){
  const rows=workerData.jobs.map(envelope=>({envelope,state:simulateMatch(envelope.input,{recording:false}).state}));parentPort.postMessage(rows);
}else{
  const output=path.resolve(args.output??'outputs/v4-shadow-season-20261117');fs.mkdirSync(output,{recursive:true});
  const source=readLeagueSource(process.cwd()),sourceBefore=JSON.stringify(source),schedule=shadowSchedule(source),runs=[];let shadow=createShadowSeason(source),rotations=0;
  for(const round of schedule){
    const envelopes=round.fixtures.map((fixture,i)=>compileRealMatch(shadow,{...fixture,fixtureId:`shadow-${round.number}-${i}`,seed:`${args.split??'shadow-season-independent-A'}-${round.number}-${i}`}));
    for(const e of envelopes)for(const team of e.input.teams){const saved=shadow.teams.find(t=>t.id===team.id);for(const p of team.players){assert.ok(!(saved.playerState[p.id]?.injuryRounds>0));assert.ok(!(saved.playerState[p.id]?.suspension>0));if(!saved.preferredStarterIds.includes(p.id))rotations++;}}
    const results=(await Promise.all(Array.from({length:workers},(_,i)=>new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:{args,jobs:envelopes.filter((_,j)=>j%workers===i)}});worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(new Error(`影子计算退出 ${code}`));});})))).flat();
    shadow=applyShadowRound(shadow,round.number,results);
    runs.push(...results.map(r=>({fixtureId:r.envelope.input.fixtureId,round:round.number,teams:r.envelope.input.teams.map(t=>t.id),score:r.state.score,
      inputFingerprint:r.envelope.fingerprint,sourceFingerprint:r.envelope.sourceFingerprint,stats:r.state.stats,injuries:r.state.players.filter(p=>p.injury).map(p=>p.key)})));
    fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({completedRound:round.number,matches:runs.length,totalRounds:schedule.length}));console.log(JSON.stringify({round:round.number,matches:runs.length}));
  }
  const summary=shadowSummary(shadow),goals=runs.reduce((n,r)=>n+r.score[0]+r.score[1],0),table=summary.teams.map(t=>t.table);
  assert.equal(runs.length,112);assert.ok(table.every(t=>t.played===14));assert.equal(table.reduce((n,t)=>n+t.goalsFor,0),goals);assert.equal(table.reduce((n,t)=>n+t.goalsAgainst,0),goals);assert.equal(table.reduce((n,t)=>n+t.won,0),table.reduce((n,t)=>n+t.lost,0));
  assert.equal(JSON.stringify(source),sourceBefore);
  assert.deepEqual(dependencyHashes(['scripts/simulate-v4-shadow-season.mjs']),sourceHashes);
  for(const [name,expected] of Object.entries(source.sourceRevisions))assert.equal(createHash('sha256').update(fs.readFileSync(path.join('data',name))).digest('hex'),expected);
  const report={passed:true,matches:runs.length,rounds:schedule.length,rotatedStarterSelections:rotations,originFingerprint:source.fingerprint,sourceRevisions:source.sourceRevisions,summary,runs,
    scope:'Two divisions of eight, 14 rounds, evolving isolated fitness/injury/red suspensions and prematch selection. No economy, chemistry growth, wall-clock recovery or actual promotion/season reset. Original source and all formal saves remain unchanged.',
    dependencyHashes:sourceHashes};
  fs.writeFileSync(path.join(output,'shadow-season.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,matches:runs.length,rounds:schedule.length,rotations}));
}
