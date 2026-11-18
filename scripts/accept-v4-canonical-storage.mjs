import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const target=path.resolve('outputs/v4-canonical-storage-accepted-20261118');if(fs.existsSync(target))throw new Error('禁止覆盖原存储结算验收');
const tests=['engine-v4-canonical-storage.test.js','engine-v4-shadow-settlement.test.js','engine-v4-dispatcher.test.js','engine-v4-archive.test.js','engine-v4-stream.test.js','engine-v4-playback.test.js','engine-v4-stream-http.test.js','engine-v4-shadow-job.test.js','engine-v4-player-report.test.js','engine-v4-initialize-job.test.js','engine-v4-configured-host.test.js','engine-v4-host.test.js','engine-v4-main-host.test.js','engine-v33-service-resume.test.js','engine-v4-atomic-file.test.js'];
const entries=['scripts/accept-v4-canonical-storage.mjs','scripts/verify-v4-canonical-storage-local.mjs','scripts/verify-v4-canonical-storage-worker.mjs','scripts/verify-v4-host-browser.mjs','scripts/benchmark-v4-stream-local.mjs','scripts/v4-producer-worker.mjs','scripts/inbox-load-limits.ps1','versus/v4-host/dispatch-worker.js','devtool/server.js','docs/YFFM1-V4-CANONICAL-STORAGE-20261118.md',...tests.map(t=>'test/'+t)];
const sources=dependencyHashes(entries),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reports=['outputs/v4-canonical-storage-20261118/verification.json','outputs/v4-host-20261118/host-browser-verification.json','outputs/v4-stream-capacity-20261118/iteration17/capacity.json'];
for(const file of reports){const value=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(value.passed,true);for(const [source,expected] of Object.entries(value.dependencyHashes))assert.equal(hash(source),expected,`Stale evidence: ${source}`);}
const capacity=JSON.parse(fs.readFileSync(reports[2],'utf8'));assert.equal(capacity.metrics.completed.length,8);assert.equal(capacity.limits.logicalProcessors,2);assert.equal(capacity.limits.jobMemoryBytes,2147483648);
assert.equal(capacity.seconds,180);
const bundle=JSON.parse(fs.readFileSync('outputs/v4-accepted-local-20261118/engine/manifest.json','utf8'));for(const [file,expected] of Object.entries(bundle.files))assert.equal(hash(file),expected,`Kernel changed: ${file}`);
const result=spawnSync(process.execPath,['scripts/run-tests.mjs',...tests],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),units=JSON.parse(fs.readFileSync(summary.report,'utf8'));assert.equal(units.failed,0);assert.equal(units.timedOut,0);assert.equal(units.passed,tests.length);
assert.deepEqual(dependencyHashes(entries),sources);const preservation=verifyV4ProtectedFiles();
fs.mkdirSync(target);const files={};
function copy(file,label){const destination=path.join(target,label);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);files[label]=hash(destination);assert.equal(files[label],hash(file));}
for(const file of Object.keys(sources))copy(file,'source/'+file);
for(const file of reports)copy(file,'evidence/'+path.basename(file));
copy('outputs/v4-stream-capacity-20261118/iteration15/capacity.json','evidence/eight-matches-120s-failed.json');
copy('outputs/v4-stream-capacity-20261118/iteration16/capacity.json','evidence/eight-matches-sharing-conflict-failed.json');
copy(summary.report,'evidence/unit-report.json');for(const name of tests)copy(path.join(path.dirname(summary.report),name+'.tap'),'evidence/'+name+'.tap');
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Original JSON/shard atomic settlement in marked local copies and partial archive crash recovery. Production remains disabled.',tests:units.results.reduce((n,r)=>n+r.counts.tests,0),testFiles:tests.length,realMatchesPerStorage:8,capacityMatches:8,capacityBudgetSeconds:180,sourceArchive:target,sourceHashes:sources,files,preservation,kernelVersion:bundle.engineVersion,kernelDigest:bundle.sourceDigest,kernelUnchanged:true,productionEnabled:false,cloudConnected:false,
  limitations:['Formal schedule hooks, cross-round preparation and overlap checks remain pending.','Storage reconciliation is synchronous and has not passed concurrent business HTTP latency validation.','Eight fixtures did not finish within 120 seconds (six finished); accepted processing budget is 180 seconds. Production match duration is unchanged.','Capacity covers two producers and ten playback viewers, not combined asset/prediction traffic or cloud.','Existing final-tournament legacy suite still has 28 pre-existing failures; see stage 41 differential evidence.','Independent new legacy ledger IDs may differ with wall-clock time; committed IDs remain stable.']};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(report,null,2));fs.writeFileSync('outputs/v4-canonical-storage-20261118/acceptance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,tests:report.tests,testFiles:tests.length,realMatchesPerStorage:8,capacityMatches:8,sourceArchive:target,preservation}));
