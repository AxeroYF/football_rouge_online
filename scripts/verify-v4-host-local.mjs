import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {runShadowJob} from '../versus/v4-host/shadow-job.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const entries=['scripts/verify-v4-host-local.mjs','scripts/verify-v4-canonical-settlement-worker.mjs','versus/v4-host/configured-host.js','versus/v4-host/account-playback.js'];
const sources=dependencyHashes(entries);verifyV4ProtectedFiles();
const output=path.resolve('outputs/v4-host-20261118');fs.mkdirSync(output,{recursive:true});const root=fs.mkdtempSync(path.join(output,'canonical-'));
fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'v4-canonical-settlement-proof-1'}));
const source=readLeagueSource(process.cwd()),teams=source.teams.slice(0,2),bundleDirectory=path.resolve('outputs/v4-accepted-local-20261118/engine');
const bundle=JSON.parse(fs.readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8')),tasks=[],jobs=[];let cupReport=null;
for(const label of ['league','cup','cup-shootout']){
  const competition=label==='league'?'league':'cup',fixtureId=`host-proof-${label}`;
  const regulation=jobs.find(job=>job.label==='cup')?.score;
  const aggregate=label==='cup-shootout'?[Math.max(0,regulation[1]-regulation[0]),Math.max(0,regulation[0]-regulation[1])]:[0,0];
  const envelope=compileRealMatch(source,{homeId:teams[0].id,awayId:teams[1].id,fixtureId,seed:`host-canonical-${competition}-1`,competition,aggregate,resolution:label==='cup-shootout'?'penalties':competition==='cup'?'extraTimeAndPenalties':'draw'});
  const job=await runShadowJob({directory:path.join(root,label),bundleDirectory,sourceDigest:bundle.sourceDigest,envelope});
  if(label==='cup')cupReport=job.result.report;
  if(label==='cup-shootout'){assert.ok(job.result.report.penalties);assert.deepEqual(job.result.report.regulationScore,regulation);assert.deepEqual(job.result.report.teams.map(t=>t.players.map(p=>p.stats)),cupReport.teams.map(t=>t.players.map(p=>p.stats)));}
  tasks.push({label,competition,fixtureId,job:label});jobs.push({label,competition,score:job.result.score,penalties:job.result.report.penalties,highWater:job.highWater,segments:job.segments,inputFingerprint:envelope.fingerprint});
  console.log(JSON.stringify({completed:label,score:job.result.score,penalties:job.result.report.penalties,segments:job.segments}));
}
for(const name of ['yellowdogs-league.json','ydl-content-overrides.json','ydl-player-card-studio.json'])fs.copyFileSync(path.join('data',name),path.join(root,name));
fs.writeFileSync(path.join(root,'tasks.json'),JSON.stringify(tasks));
const child=spawnSync(process.execPath,['scripts/verify-v4-canonical-settlement-worker.mjs'],{windowsHide:true,cwd:process.cwd(),encoding:'utf8',timeout:120000,maxBuffer:1024*1024,env:{...process.env,V4_CANONICAL_SANDBOX:root,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'yellowdogs-league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'ydl-content-overrides.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'ydl-player-card-studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles')}});
assert.equal(child.status,0,child.stderr);const preservation=verifyV4ProtectedFiles();assert.deepEqual(dependencyHashes(entries),sources);
const report={passed:true,engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest,sourceFingerprint:source.fingerprint,root,jobs,canonical:JSON.parse(fs.readFileSync(path.join(root,'canonical-result.json'),'utf8')),dependencyHashes:sources,preservation,productionEnabled:false,cloudConnected:false};
fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'host-local-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,root,jobs,preservation}));
