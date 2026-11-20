import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const settlement=process.argv.includes('--settlement'),hardening=settlement||process.argv.includes('--hardening');if(process.argv.slice(2).some(arg=>!['--hardening','--settlement'].includes(arg)))throw new Error('未知验收参数');
const target=path.resolve(settlement?'outputs/v4-settlement-accepted-20261118':hardening?'outputs/v4-host-hardened-20261118':'outputs/v4-host-accepted-20261118');if(fs.existsSync(target))throw new Error('已有冻结归档，禁止覆盖');
const tests=['engine-v4-player-report.test.js','engine-v4-shadow-job.test.js','engine-v4-archive.test.js','engine-v4-stream.test.js','engine-v4-playback.test.js','engine-v4-stream-http.test.js','engine-v4-atomic-file.test.js','engine-v4-host.test.js','engine-v4-configured-host.test.js','engine-v4-main-host.test.js','engine-v4-rollout.test.js','runtime-http.test.js','runtime-config.test.js',...(hardening?['engine-v4-initialize-job.test.js']:[]),...(settlement?['engine-v4-shadow-settlement.test.js','engine-v4-canonical-penalties.test.js','engine-v33-service-resume.test.js','retired-season-final.test.js']:[])];
const entries=['scripts/verify-v4-host-acceptance.mjs','scripts/verify-v4-host-local.mjs','scripts/verify-v4-host-browser.mjs','scripts/create-v4-shadow-preview.mjs','devtool/server.js','versus/v4-host/public/index.html','versus/v4-host/public/app.js','versus/v4-host/public/style.css','docs/YFFM1-V4-STREAM-CONTRACT-20261117.md',...(hardening?['scripts/benchmark-v4-host-preview.mjs']:[]),...(settlement?['scripts/verify-v4-legacy-consumer-regression.mjs']:[]),...tests.map(name=>'test/'+name)];
const sourceBefore=dependencyHashes(entries),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protectedFiles=JSON.parse(fs.readFileSync('outputs/v4-before-stage5-20261117/protected-hashes.json','utf8').replace(/^\uFEFF/,''));
const checkProtected=()=>{if(settlement)return verifyV4ProtectedFiles();for(const item of protectedFiles)assert.equal(hash(item.Path),item.Hash.toLowerCase());return {verified:true,unchangedFiles:8};};checkProtected();
const bundle=JSON.parse(fs.readFileSync('outputs/v4-accepted-local-20261118/engine/manifest.json','utf8'));
for(const [name,expected] of Object.entries(bundle.files))assert.equal(hash(name),expected,`Accepted kernel changed: ${name}`);
const output=path.resolve('outputs/v4-host-20261118'),run=fs.mkdtempSync(path.join(output,'acceptance-'));
fs.writeFileSync(path.join(run,'source-before.json'),JSON.stringify(sourceBefore,null,2));
function execute(name,args){
  const result=spawnSync(process.execPath,args,{cwd:process.cwd(),windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024,timeout:180000});
  fs.writeFileSync(path.join(run,name+'.log'),result.stdout+result.stderr);assert.equal(result.status,0,result.stderr||result.error?.message||`${name} failed`);
  console.log(`${name}: passed`);return result.stdout;
}
const outputText=execute('tests',['scripts/run-tests.mjs',...tests]),suite=JSON.parse(outputText.trim().split(/\r?\n/).at(-1));
const units=JSON.parse(fs.readFileSync(suite.report,'utf8'));assert.equal(units.failed,0);assert.equal(units.timedOut,0);assert.equal(units.passed,tests.length);
execute('canonical',['scripts/verify-v4-host-local.mjs']);execute('browser',['scripts/verify-v4-host-browser.mjs']);
if(settlement)execute('legacy-comparison',['scripts/verify-v4-legacy-consumer-regression.mjs']);
const capacityPath=`outputs/v4-host-capacity-20261118/iteration${settlement?3:2}/capacity.json`;
const reports=['outputs/v4-host-20261118/host-local-verification.json','outputs/v4-host-20261118/host-browser-verification.json',...(hardening?[capacityPath]:[]),...(settlement?['outputs/v4-settlement-20261118/legacy-consumer-regression.json']:[])];
for(const file of reports){const report=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(report.passed,true);for(const [name,expected] of Object.entries(report.dependencyHashes))assert.equal(hash(name),expected,`Stale evidence: ${name}`);}
const preservation=checkProtected();assert.deepEqual(dependencyHashes(entries),sourceBefore);
if(hardening){const capacity=JSON.parse(fs.readFileSync(capacityPath,'utf8'));assert.equal(capacity.clients.length,10);assert.ok(capacity.clients.every(c=>c.complete));assert.equal(capacity.limits.logicalProcessors,2);assert.equal(capacity.limits.jobMemoryBytes,2147483648);assert.equal(capacity.limits.maxConcurrent,16);}
fs.mkdirSync(target);const copied={};
function copy(file,label){const destination=path.join(target,label);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);assert.equal(hash(destination),hash(file));copied[label]=hash(destination);}
for(const file of Object.keys(sourceBefore))copy(file,'source/'+file);
for(const file of reports)copy(file,'evidence/'+path.basename(file));
copy(suite.report,'evidence/unit-report.json');for(const test of tests)copy(path.join(path.dirname(suite.report),test+'.tap'),'evidence/'+test+'.tap');
const total=units.results.reduce((n,r)=>n+r.counts.tests,0);
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Local default-off shadow host, isolated canonical settlement and account preview; no formal settlement, deployment or cloud verification.',kernelVersion:bundle.engineVersion,kernelDigest:bundle.sourceDigest,kernelUnchanged:true,tests:total,testFiles:tests.length,sourceHashes:sourceBefore,run,sourceArchive:target,evidence:reports,preservation,productionEnabled:false,
  limitations:['Production scheduler and atomic settlement bridge remain separate work.',...(hardening?['Unpublished initialization staging directories are retained for inspection; old incomplete jobs are not silently repaired.','Fast replay capacity uses precomputed archives, without concurrent producers.']:['Initial incomplete journal/archive creation can fail closed and require inspection.','Ten viewers at simultaneous 64x speed have not been capacity-tested.']),'No cloud connection or deployment.']};
const reportName=settlement?'settlement-acceptance.json':hardening?'host-hardening-acceptance.json':'host-acceptance.json';fs.writeFileSync(path.join(output,reportName),JSON.stringify(report,null,2));copy(path.join(output,reportName),'evidence/'+reportName);
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({format:'v4-host-accepted-source-1',...report,files:copied},null,2));
console.log(JSON.stringify({passed:true,tests:total,sourceArchive:target,run}));
