import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const target=path.resolve('outputs/v4-scheduled-league-accepted-20261118');if(fs.existsSync(target))throw new Error('禁止覆盖轮次验收');
const tests=['engine-v4-scheduled-league.test.js','engine-v4-scheduled-crash.test.js','engine-v4-scheduled-preview.test.js','engine-v4-canonical-storage.test.js','engine-v4-shadow-settlement.test.js','engine-v4-dispatcher.test.js','engine-v4-archive.test.js','engine-v4-stream.test.js','engine-v4-playback.test.js','engine-v4-stream-http.test.js','engine-v4-shadow-job.test.js','engine-v4-player-report.test.js','engine-v4-initialize-job.test.js','engine-v4-configured-host.test.js','engine-v4-host.test.js','engine-v4-main-host.test.js','engine-v33-service-resume.test.js','engine-v4-atomic-file.test.js'];
const entries=['scripts/accept-v4-scheduled-league.mjs','scripts/verify-v4-scheduled-league-local.mjs','scripts/verify-v4-scheduled-league-worker.mjs','scripts/verify-v4-scheduled-browser.mjs','scripts/diagnose-v4-archive-order.mjs','versus/v4-host/dispatch-worker.js','devtool/server.js','docs/YFFM1-V4-SCHEDULED-LEAGUE-20261118.md',...tests.map(t=>'test/'+t)];
const sources=dependencyHashes(entries),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reports={rounds:'outputs/v4-scheduled-league-20261118/verification.json',browser:'outputs/v4-scheduled-league-20261118/browser-verification.json'},evidence={};
for(const [label,file] of Object.entries(reports)){
  const value=JSON.parse(fs.readFileSync(file,'utf8'));evidence[label]=value;assert.equal(value.passed,true,file);
  for(const [source,expected] of Object.entries(value.dependencyHashes))assert.equal(hash(source),expected,`Stale evidence: ${source}`);
}
assert.equal(evidence.rounds.storages.length,2);assert.ok(evidence.rounds.storages.every(s=>s.rounds===2&&s.matches===16&&s.reopenExactlyOnce));
const bundle=JSON.parse(fs.readFileSync('outputs/v4-accepted-local-20261118/engine/manifest.json','utf8'));for(const [file,expected] of Object.entries(bundle.files))assert.equal(hash(file),expected,`Kernel changed: ${file}`);
const result=spawnSync(process.execPath,['scripts/run-tests.mjs',...tests],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),units=JSON.parse(fs.readFileSync(summary.report,'utf8'));assert.equal(units.failed,0);assert.equal(units.timedOut,0);assert.equal(units.passed,tests.length);assert.deepEqual(dependencyHashes(entries),sources);
const preservation=verifyV4ProtectedFiles(),files={};fs.mkdirSync(target);
function copy(file,label){const destination=path.join(target,label);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);files[label]=hash(destination);assert.equal(files[label],hash(file));}
for(const file of Object.keys(sources))copy(file,'source/'+file);
for(const [label,file] of Object.entries(reports))copy(file,'evidence/'+label+'.json');
copy(summary.report,'evidence/unit-report.json');for(const name of tests)copy(path.join(path.dirname(summary.report),name+'.tap'),'evidence/'+name+'.tap');
copy('outputs/v4-scheduled-league-20261118/rounds-CxxSP4/worker.log','evidence/initial-event-boundary-failure.log');
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Explicit local-copy league scheduler, atomic original round lifecycle and dynamic authenticated playback; production disabled.',tests:units.results.reduce((n,r)=>n+r.counts.tests,0),testFiles:tests.length,sourceArchive:target,sourceHashes:sources,files,preservation,kernelVersion:bundle.engineVersion,kernelDigest:bundle.sourceDigest,kernelUnchanged:true,roundsPerStorage:2,matchesPerStorage:16,productionEnabled:false,cloudConnected:false,
  limitations:['Production timers, cup/final tournament lifecycle, mixed-business capacity and archive retention remain pending.','Canonical storage reconciliation is synchronous.','Stage 46 capacity belongs to its frozen source; current mixed traffic remains unverified.','Unsupported source traits/weather remain fail-closed.','Legacy final-tournament suite has 28 pre-existing failures, recorded in stage 41.']};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(report,null,2));fs.writeFileSync('outputs/v4-scheduled-league-20261118/acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,tests:report.tests,testFiles:tests.length,sourceArchive:target,preservation}));
