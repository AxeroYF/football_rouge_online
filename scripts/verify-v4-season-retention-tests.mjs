import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const prior=JSON.parse(fs.readFileSync('outputs/v4-cup-lifecycle-accepted-20261118/manifest.json','utf8'));
const tests=[...Object.keys(prior.sourceHashes).filter(file=>file.startsWith('test/')&&file.endsWith('.test.js')).map(file=>file.slice(5)),
  'engine-v4-season-boundary.test.js','engine-v4-season-storage.test.js','engine-v4-season-crash.test.js','engine-v4-replay-retention-plan.test.js','engine-v4-replay-lifecycle.test.js','engine-v4-local-replay-retention.test.js','engine-v4-retention-crash.test.js'];
assert.equal(new Set(tests).size,tests.length);
const entries=['scripts/verify-v4-season-retention-tests.mjs','scripts/run-tests.mjs','scripts/verify-v4-full-season-local.mjs','scripts/verify-v4-full-season-worker.mjs','scripts/verify-v4-retention-browser.mjs','scripts/verify-v4-cup-browser.mjs','devtool/server.js','versus/v4-host/dispatch-worker.js','versus/v4-host/public/index.html','versus/v4-host/public/app.js','versus/v4-host/public/style.css',...tests.map(test=>'test/'+test)],sources=dependencyHashes(entries);
verifyV4ProtectedFiles();const result=spawnSync(process.execPath,['scripts/run-tests.mjs',...tests],{windowsHide:true,encoding:'utf8',timeout:420000,maxBuffer:2*1024*1024});
const output=path.resolve('outputs/v4-season-retention-20261118');fs.mkdirSync(output,{recursive:true});const attempt=Date.now();fs.writeFileSync(path.join(output,`tests-${attempt}.log`),result.stdout+result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),report=JSON.parse(fs.readFileSync(summary.report,'utf8'));assert.equal(report.failed,0);assert.equal(report.timedOut,0);assert.equal(report.passed,tests.length);assert.deepEqual(dependencyHashes(entries),sources);
const value={passed:true,tests:report.results.reduce((n,row)=>n+row.counts.tests,0),testFiles:tests.length,files:tests,unitReport:summary.report,dependencyHashes:sources,preservation:verifyV4ProtectedFiles(),productionEnabled:false};
fs.writeFileSync(path.join(output,`units-${attempt}.json`),JSON.stringify(value,null,2));fs.writeFileSync(path.join(output,'unit-verification.json'),JSON.stringify(value,null,2));console.log(JSON.stringify({passed:true,tests:value.tests,testFiles:tests.length,unitReport:summary.report}));
