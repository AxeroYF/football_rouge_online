import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const target=path.resolve('outputs/v4-cup-lifecycle-accepted-20261118');if(fs.existsSync(target))throw new Error('禁止覆盖杯赛验收');
const tests=['engine-v4-scheduled-cup.test.js','engine-v4-cup-lifecycle.test.js','engine-v4-cup-scheduler.test.js','engine-v4-cup-crash.test.js','engine-v4-competition-presentation.test.js','engine-v4-storage-coordination.test.js','engine-v4-scheduled-league.test.js','engine-v4-scheduled-crash.test.js','engine-v4-scheduled-preview.test.js','engine-v4-canonical-storage.test.js','engine-v4-shadow-settlement.test.js','engine-v4-dispatcher.test.js','engine-v4-archive.test.js','engine-v4-stream.test.js','engine-v4-playback.test.js','engine-v4-stream-http.test.js','engine-v4-shadow-job.test.js','engine-v4-player-report.test.js','engine-v4-initialize-job.test.js','engine-v4-configured-host.test.js','engine-v4-host.test.js','engine-v4-main-host.test.js','engine-v33-service-resume.test.js','engine-v4-atomic-file.test.js'];
tests.push('engine-v4-cup-storage-failures.test.js','league-divisions.test.js','engine-v4-rollout.test.js');
const entries=['scripts/accept-v4-cup-lifecycle.mjs','scripts/run-tests.mjs','scripts/verify-v4-cup-local.mjs','scripts/verify-v4-cup-worker.mjs','scripts/verify-v4-cup-browser.mjs','versus/v4-host/dispatch-worker.js','devtool/server.js','versus/v4-host/public/index.html','versus/v4-host/public/app.js','versus/v4-host/public/style.css','docs/YFFM1-V4-CUP-LIFECYCLE-20261118.md',...tests.map(t=>'test/'+t)];
const sources=dependencyHashes(entries),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),reports={cup:'outputs/v4-cup-lifecycle-20261118/verification.json',browser:'outputs/v4-cup-lifecycle-20261118/browser-verification.json'},evidence={};
for(const [label,file] of Object.entries(reports)){
  const value=JSON.parse(fs.readFileSync(file,'utf8'));evidence[label]=value;assert.equal(value.passed,true,file);
  for(const [source,expected] of Object.entries(value.dependencyHashes))assert.equal(hash(source),expected,`Stale evidence: ${source}`);
}
assert.equal(evidence.cup.storages.length,2);assert.ok(evidence.cup.storages.every(s=>s.events===7&&s.matches===29&&s.reopenExactlyOnce));assert.ok(evidence.browser.checked.some(match=>match.aggregate));assert.ok(evidence.browser.checked.some(match=>match.final));
const bundle=JSON.parse(fs.readFileSync('outputs/v4-accepted-local-20261118/engine/manifest.json','utf8'));for(const [file,expected] of Object.entries(bundle.files))assert.equal(hash(file),expected,`Kernel changed: ${file}`);
const result=spawnSync(process.execPath,['scripts/run-tests.mjs',...tests],{windowsHide:true,encoding:'utf8',timeout:240000,maxBuffer:1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),units=JSON.parse(fs.readFileSync(summary.report,'utf8'));assert.equal(units.failed,0);assert.equal(units.timedOut,0);assert.equal(units.passed,tests.length);assert.deepEqual(dependencyHashes(entries),sources);
const preservation=verifyV4ProtectedFiles(),files={};fs.mkdirSync(target);
function copy(file,label){const destination=path.join(target,label);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);files[label]=hash(destination);assert.equal(files[label],hash(file));}
for(const file of Object.keys(sources))copy(file,'source/'+file);for(const [label,file] of Object.entries(reports))copy(file,'evidence/'+label+'.json');
copy(summary.report,'evidence/unit-report.json');for(const name of tests)copy(path.join(path.dirname(summary.report),name+'.tap'),'evidence/'+name+'.tap');
copy('outputs/tests/2026-11-17T20-26-12-996Z/engine-v4-storage-coordination.test.js.tap','evidence/initial-windows-fixture-rename-failure.tap');
copy('outputs/tests/2026-11-17T20-41-17-159Z/engine-v4-shadow-settlement.test.js.tap','evidence/initial-exclusive-lock-denial.tap');
copy(path.join(evidence.cup.root,'worker.log'),'evidence/initial-two-hour-publication-assumption-failure.log');
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Explicit local-copy cup event scheduler, pinned two-leg aggregate, complete original cup lifecycle and authenticated browser presentation. Production disabled.',tests:units.results.reduce((n,r)=>n+r.counts.tests,0),testFiles:tests.length,sourceArchive:target,sourceHashes:sources,files,preservation,kernelVersion:bundle.engineVersion,kernelDigest:bundle.sourceDigest,kernelUnchanged:true,eventsPerStorage:7,fullMatchesPerStorage:29,browserShootout:evidence.browser.shootoutAvailable,productionEnabled:false,cloudConnected:false,
  limitations:['Complete real rehearsal covers the current round-of-16 knockout cup, not historical league/Swiss cup formats.','Production timers, interleaved full season and archive retention remain pending.','Season finals remain disabled under the existing product rules; no reactivation is included.','Stage 50 mixed capacity is tied to its own frozen source; this cup rehearsal is not resource-limited.','Synchronous storage commits still cause latency spikes.','Unsupported source traits/weather remain fail-closed.','The legacy final-tournament suite retains 28 expectations for the now-disabled format; current division tests are the product-rule regression.']};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(report,null,2));fs.writeFileSync('outputs/v4-cup-lifecycle-20261118/acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,tests:report.tests,testFiles:tests.length,sourceArchive:target,browserShootout:report.browserShootout,preservation}));
