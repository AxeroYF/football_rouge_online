import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const target=path.resolve('outputs/v4-fair-production-accepted-20261118');
if(fs.existsSync(target))throw new Error('禁止覆盖同轮生产验收');
const tests=['engine-v4-canonical-storage.test.js','engine-v4-shadow-settlement.test.js','engine-v4-dispatcher.test.js','engine-v4-archive.test.js','engine-v4-stream.test.js','engine-v4-playback.test.js','engine-v4-stream-http.test.js','engine-v4-shadow-job.test.js','engine-v4-player-report.test.js','engine-v4-initialize-job.test.js','engine-v4-configured-host.test.js','engine-v4-host.test.js','engine-v4-main-host.test.js','engine-v33-service-resume.test.js','engine-v4-atomic-file.test.js'];
const entries=['scripts/accept-v4-fair-production.mjs','scripts/verify-v4-dispatch-local.mjs','scripts/verify-v4-dispatch-worker.mjs','scripts/verify-v4-canonical-storage-local.mjs','scripts/verify-v4-canonical-storage-worker.mjs','scripts/verify-v4-host-browser.mjs','scripts/benchmark-v4-dispatch-local.mjs','scripts/inbox-load-limits.ps1','versus/v4-host/dispatch-worker.js','devtool/server.js','docs/YFFM1-V4-FAIR-PRODUCTION-20261118.md',...tests.map(t=>'test/'+t)];
const sources=dependencyHashes(entries),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reports={
  round:'outputs/v4-dispatch-20261118/verification.json',
  storage:'outputs/v4-canonical-storage-20261118/verification.json',
  browser:'outputs/v4-host-20261118/host-browser-verification.json',
  capacity:'outputs/v4-fair-capacity-20261118/iteration2/capacity.json',
  repeat:'outputs/v4-fair-capacity-20261118/iteration3/capacity.json',
};
const evidence={};
for(const [label,file] of Object.entries(reports)){
  const value=JSON.parse(fs.readFileSync(file,'utf8'));evidence[label]=value;assert.equal(value.passed,true,file);
  for(const [source,expected] of Object.entries(value.dependencyHashes))assert.equal(hash(source),expected,`Stale evidence: ${source}`);
}
for(const label of ['capacity','repeat']){
  const value=evidence[label];assert.equal(value.seconds,120);assert.equal(value.limits.logicalProcessors,2);assert.equal(value.limits.jobMemoryBytes,2147483648);
  assert.equal(value.metrics.jobs.length,8);assert.ok(value.metrics.jobs.every(job=>job.status==='settled'));
  assert.equal(value.metrics.peakWorkers,2);assert.equal(value.metrics.peakActiveMatches,8);assert.ok(Object.values(value.gates).every(Boolean));
}
assert.equal(evidence.round.matches,8);assert.equal(evidence.round.peakWorkers,2);assert.equal(evidence.round.peakActiveMatches,8);
const bundle=JSON.parse(fs.readFileSync('outputs/v4-accepted-local-20261118/engine/manifest.json','utf8'));
for(const [file,expected] of Object.entries(bundle.files))assert.equal(hash(file),expected,`Kernel changed: ${file}`);
const result=spawnSync(process.execPath,['scripts/run-tests.mjs',...tests],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
assert.equal(result.status,0,result.stdout+result.stderr);
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),units=JSON.parse(fs.readFileSync(summary.report,'utf8'));
assert.equal(units.failed,0);assert.equal(units.timedOut,0);assert.equal(units.passed,tests.length);assert.deepEqual(dependencyHashes(entries),sources);
const preservation=verifyV4ProtectedFiles(),files={};fs.mkdirSync(target);
function copy(file,label){const destination=path.join(target,label);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);files[label]=hash(destination);assert.equal(files[label],hash(file));}
for(const file of Object.keys(sources))copy(file,'source/'+file);
for(const [label,file] of Object.entries(reports))copy(file,'evidence/'+label+'.json');
copy('outputs/v4-fair-capacity-20261118/iteration1/capacity.json','evidence/capacity-initial-failed.json');
copy(summary.report,'evidence/unit-report.json');for(const name of tests)copy(path.join(path.dirname(summary.report),name+'.tap'),'evidence/'+name+'.tap');
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Bounded two-process/eight-match local dispatch with early replay for all fixtures; production disabled.',tests:units.results.reduce((n,r)=>n+r.counts.tests,0),testFiles:tests.length,sourceArchive:target,sourceHashes:sources,files,preservation,kernelVersion:bundle.engineVersion,kernelDigest:bundle.sourceDigest,kernelUnchanged:true,productionEnabled:false,cloudConnected:false,
  capacity:{matches:8,viewers:10,budgetSeconds:120,runs:['capacity','repeat'].map(label=>({finishedMs:evidence[label].metrics.finishedMs,latency:evidence[label].latency,peakJobMemoryBytes:evidence[label].peakJobMemoryBytes}))},
  limitations:['Capacity excludes full assets/rewards/prediction and other business HTTP traffic.','Local Windows Job affinity/memory restrictions do not reproduce cloud disk or Hong Kong network.','Formal schedule binding, whole-round completion, cross-round preparation and overlap checks remain pending.','Canonical storage reconciliation remains synchronous; concurrent business latency not accepted.','Legacy final-tournament suite has 28 pre-existing failures, recorded in stage 41.']};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(report,null,2));
fs.mkdirSync('outputs/v4-fair-production-20261118',{recursive:true});fs.writeFileSync('outputs/v4-fair-production-20261118/acceptance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,tests:report.tests,sourceArchive:target,capacity:report.capacity,preservation}));
