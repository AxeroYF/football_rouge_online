import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const target=path.resolve('outputs/v4-mixed-capacity-accepted-20261118');if(fs.existsSync(target))throw new Error('禁止覆盖混合容量验收');
const tests=['engine-v4-storage-coordination.test.js','engine-v4-scheduled-league.test.js','engine-v4-scheduled-crash.test.js','engine-v4-scheduled-preview.test.js','engine-v4-canonical-storage.test.js','engine-v4-shadow-settlement.test.js','engine-v4-dispatcher.test.js','engine-v4-archive.test.js','engine-v4-stream.test.js','engine-v4-playback.test.js','engine-v4-stream-http.test.js','engine-v4-shadow-job.test.js','engine-v4-player-report.test.js','engine-v4-initialize-job.test.js','engine-v4-configured-host.test.js','engine-v4-host.test.js','engine-v4-main-host.test.js','engine-v33-service-resume.test.js','engine-v4-atomic-file.test.js'];
const entries=['scripts/accept-v4-mixed-capacity.mjs','scripts/benchmark-v4-mixed-local.mjs','scripts/benchmark-v4-mixed-worker.mjs','scripts/verify-v4-round-replay-local.mjs','scripts/verify-v4-round-replay-worker.mjs','scripts/inbox-load-limits.ps1','versus/v4-host/dispatch-worker.js','devtool/server.js','docs/YFFM1-V4-MIXED-CAPACITY-20261118.md',...tests.map(t=>'test/'+t)];
const sources=dependencyHashes(entries),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reports={capacity:'outputs/v4-mixed-capacity-20261118/iteration6/capacity.json',replay:'outputs/v4-mixed-capacity-20261118/round-replay-verification.json'},evidence={};
for(const [label,file] of Object.entries(reports)){
  const value=JSON.parse(fs.readFileSync(file,'utf8'));evidence[label]=value;assert.equal(value.passed,true,file);
  for(const [source,expected] of Object.entries(value.dependencyHashes))assert.equal(hash(source),expected,`Stale evidence: ${source}`);
}
assert.equal(evidence.capacity.seconds,180);assert.equal(evidence.capacity.metrics.accounts,10);assert.match(evidence.capacity.clientModel,/independent playback and business loops/);assert.equal(evidence.capacity.metrics.receipts,8);
assert.ok(Object.values(evidence.capacity.gates).every(Boolean));assert.equal(evidence.replay.storages.length,2);assert.ok(evidence.replay.storages.every(s=>s.rounds===2&&s.matches===16&&s.inboxMatches&&s.reopenExactlyOnce));
const bundle=JSON.parse(fs.readFileSync('outputs/v4-accepted-local-20261118/engine/manifest.json','utf8'));for(const [file,expected] of Object.entries(bundle.files))assert.equal(hash(file),expected,`Kernel changed: ${file}`);
const result=spawnSync(process.execPath,['scripts/run-tests.mjs',...tests],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),units=JSON.parse(fs.readFileSync(summary.report,'utf8'));assert.equal(units.failed,0);assert.equal(units.timedOut,0);assert.equal(units.passed,tests.length);assert.deepEqual(dependencyHashes(entries),sources);
const preservation=verifyV4ProtectedFiles(),files={};fs.mkdirSync(target);
function copy(file,label){const destination=path.join(target,label);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);files[label]=hash(destination);assert.equal(files[label],hash(file));}
for(const file of Object.keys(sources))copy(file,'source/'+file);
for(const [label,file] of Object.entries(reports))copy(file,'evidence/'+label+'.json');
copy(summary.report,'evidence/unit-report.json');for(const name of tests)copy(path.join(path.dirname(summary.report),name+'.tap'),'evidence/'+name+'.tap');
for(const iteration of [2,3,4,5])copy(`outputs/v4-mixed-capacity-20261118/iteration${iteration}/capacity.json`,`evidence/historical-iteration${iteration}.json`);
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Local mixed original business API, ten real isolated accounts, eight full scheduled V4 games, original 24-sample forecast, independent playback/business loops, and exact pending inbox-read reconciliation. Production disabled.',tests:units.results.reduce((n,r)=>n+r.counts.tests,0),testFiles:tests.length,sourceArchive:target,sourceHashes:sources,files,preservation,kernelVersion:bundle.engineVersion,kernelDigest:bundle.sourceDigest,kernelUnchanged:true,roundsReplayedPerStorage:2,matchesReplayedPerStorage:16,capacityBudgetSeconds:180,capacity:evidence.capacity.latency,finishedMs:evidence.capacity.metrics.finishedMs,peakJobMemoryBytes:evidence.capacity.peakJobMemoryBytes,productionEnabled:false,cloudConnected:false,
  limitations:['Local Windows Job limits are not cloud hardware/network or a whole-machine 2GiB limit.','Synchronous settlement still causes approximately one-second latency spikes; P95 is not a maximum bound.','Segment clients read one chunk per 300ms cycle, not continuous 64x full replay.','Production timers, cup/final lifecycle, full season and archive retention remain pending.','Unsupported source traits/weather remain fail-closed.','Legacy final-tournament suite has 28 pre-existing failures, recorded in stage 41.']};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(report,null,2));fs.writeFileSync('outputs/v4-mixed-capacity-20261118/acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,tests:report.tests,testFiles:tests.length,sourceArchive:target,capacity:report.capacity,finishedMs:report.finishedMs,preservation}));
