import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const target=path.resolve('outputs/v4-dispatch-accepted-20261118');
if(fs.existsSync(target))throw new Error('禁止覆盖已经冻结的调度验收');
const entries=['scripts/accept-v4-dispatch.mjs','scripts/verify-v4-dispatch-local.mjs','scripts/verify-v4-dispatch-worker.mjs','versus/v4-host/dispatch-worker.js','test/engine-v4-dispatcher.test.js','docs/YFFM1-V4-LOCAL-DISPATCH-20261118.md'];
const sources=dependencyHashes(entries),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const proofPath='outputs/v4-dispatch-20261118/verification.json',proof=JSON.parse(fs.readFileSync(proofPath,'utf8'));
assert.equal(proof.passed,true);assert.equal(proof.matches,8);assert.equal(proof.peakWorkers,2);
for(const [file,expected] of Object.entries(proof.dependencyHashes))assert.equal(hash(file),expected,`Stale dispatch evidence: ${file}`);
const result=spawnSync(process.execPath,['scripts/run-tests.mjs','engine-v4-dispatcher.test.js'],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
assert.equal(result.status,0,result.stdout+result.stderr);
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),units=JSON.parse(fs.readFileSync(summary.report,'utf8'));
assert.equal(units.failed,0);assert.equal(units.timedOut,0);assert.equal(units.results[0].counts.pass,6);
assert.deepEqual(dependencyHashes(entries),sources);const preservation=verifyV4ProtectedFiles();
fs.mkdirSync(target);const files={};
const copy=(file,label)=>{const output=path.join(target,label);fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(file,output);files[label]=hash(output);assert.equal(files[label],hash(file));};
for(const file of Object.keys(sources))copy(file,'source/'+file);
copy(proofPath,'evidence/verification.json');copy(path.join(proof.root,'result.json'),'evidence/real-round.json');
copy(summary.report,'evidence/unit-report.json');copy(path.join(path.dirname(summary.report),'engine-v4-dispatcher.test.js.tap'),'evidence/engine-v4-dispatcher.test.js.tap');
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Local isolated durable dispatch and rollback rehearsal; production scheduler and storage are not enabled.',tests:6,realFullMatches:8,peakWorkers:2,sourceArchive:target,sourceHashes:sources,files,preservation,productionEnabled:false,cloudConnected:false,
  prerequisites:['Frozen prototype.8 engine bundle in outputs/v4-accepted-local-20261118/engine.','Original service protection baseline in outputs/v4-host-hardened-20261118.'],
  limitations:['Formal scheduler, cross-round fresh preparation, overlap rules and original JSON/shard transaction bridge are still pending.','Eight-match proof is not a resource-constrained capacity test.','Legacy selection delegates execution to the existing host; this local dispatcher does not run the old engine.']};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(report,null,2));fs.writeFileSync('outputs/v4-dispatch-20261118/acceptance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,tests:6,realFullMatches:8,sourceArchive:target,preservation}));
