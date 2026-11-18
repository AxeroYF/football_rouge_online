import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const target=path.resolve('outputs/v4-season-retention-accepted-20261118');if(fs.existsSync(target))throw new Error('禁止覆盖赛季与录像保留验收');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),reports={units:'outputs/v4-season-retention-20261118/unit-verification.json',season:'outputs/v4-full-season-20261118/verification.json',retentionBrowser:'outputs/v4-replay-retention-20261118/browser-verification.json',cupBrowser:'outputs/v4-cup-lifecycle-20261118/browser-verification.json'},evidence={};
for(const [label,file] of Object.entries(reports)){
  const value=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(value.passed,true,file);for(const [source,expected] of Object.entries(value.dependencyHashes))assert.equal(hash(source),expected,`Stale evidence: ${label}/${source}`);evidence[label]=value;
}
assert.equal(evidence.season.storages.length,2);assert.ok(evidence.season.storages.every(storage=>storage.matches===141&&storage.rounds===14&&storage.cupEvents===7&&storage.reset&&storage.reopenExactlyOnce));
assert.ok(evidence.retentionBrowser.cleaned.removedBytes>0&&evidence.retentionBrowser.reloadExpired&&evidence.retentionBrowser.desktop&&evidence.retentionBrowser.mobile);
assert.ok(evidence.cupBrowser.checked.some(match=>match.aggregate)&&evidence.cupBrowser.checked.some(match=>match.shootout&&match.final));
const planDirectory='outputs/v4-replay-retention-20261118',plans=fs.readdirSync(planDirectory).filter(name=>/^plan-\d+\.json$/.test(name)).map(name=>({name,value:JSON.parse(fs.readFileSync(path.join(planDirectory,name),'utf8'))})).filter(({value})=>value.root===path.join(evidence.season.root,'live'));
assert.ok(plans.some(({value})=>!value.simulatedClock)&&plans.some(({value})=>value.simulatedClock));
for(const {value} of plans){assert.equal(value.filesDeleted,0);assert.equal(value.plan.kept+value.plan.expire.length,141);for(const [source,expected] of Object.entries(value.dependencyHashes))assert.equal(hash(source),expected,`Stale retention plan: ${source}`);}
const unitReport=JSON.parse(fs.readFileSync(evidence.units.unitReport,'utf8'));assert.equal(unitReport.failed,0);assert.equal(unitReport.timedOut,0);assert.equal(unitReport.passed,evidence.units.files.length);
const bundle=JSON.parse(fs.readFileSync('outputs/v4-accepted-local-20261118/engine/manifest.json','utf8'));for(const [file,expected] of Object.entries(bundle.files))assert.equal(hash(file),expected,`Frozen kernel changed: ${file}`);
const entries=['scripts/accept-v4-season-retention.mjs','scripts/plan-v4-local-replay-retention.mjs','docs/YFFM1-V4-SEASON-RETENTION-20261118.md','scripts/diagnose-v4-counterpress-report.mjs','scripts/diagnose-v4-completed-report.mjs',...Object.keys(evidence.units.dependencyHashes)],sources=dependencyHashes(entries),preservation=verifyV4ProtectedFiles(),files={};fs.mkdirSync(target);
function copy(file,label){const destination=path.join(target,label);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination);files[label]=hash(destination);assert.equal(files[label],hash(file));}
for(const source of Object.keys(sources))copy(source,'source/'+source);for(const [label,file] of Object.entries(reports))copy(file,'evidence/'+label+'.json');
copy(evidence.units.unitReport,'evidence/unit-report.json');for(const name of evidence.units.files)copy(path.join(path.dirname(evidence.units.unitReport),name+'.tap'),'evidence/'+name+'.tap');
for(const name of fs.readdirSync(evidence.season.root).filter(name=>/^worker-\d+\.log$/.test(name)))copy(path.join(evidence.season.root,name),'evidence/season-attempts/'+name);
for(const name of ['desktop-expired.png','mobile-expired.png'])copy(path.join(evidence.retentionBrowser.root,name),'evidence/'+name);
for(const {name} of plans)copy(path.join(planDirectory,name),'evidence/'+name);
for(const name of fs.readdirSync(evidence.cupBrowser.sandbox).filter(name=>/^(desktop|mobile)-\d+\.png$/.test(name)))copy(path.join(evidence.cupBrowser.sandbox,name),'evidence/cup-'+name);
const report={passed:true,acceptedAt:new Date().toISOString(),scope:'Complete current 112-league/29-cup local season, original daily rewards/honors/archive/promotion/reset, atomic boundary receipts, local replay payload retention and authenticated expiry browser.',tests:evidence.units.tests,testFiles:evidence.units.testFiles,fullMatchesPerStorage:141,storages:['shards','json'],sourceArchive:target,sourceHashes:sources,files,preservation,kernelVersion:bundle.engineVersion,kernelDigest:bundle.sourceDigest,kernelUnchanged:true,productionEnabled:false,cloudConnected:false,
  limitations:['This interleaved season is not a CPU/memory-limited capacity run.','Production timers, controlled host orchestration and deployment remain disabled.','Replay leases require one local root owner and the same lifecycle in every viewing entry point; distributed leases are not implemented.','Retention budget counts compressed frame payloads, not total disk usage; pinned input, results, manifests and receipts are intentionally retained.','Hot settlement indexes cap at 4096 games and season-boundary receipts at 512; cross-season metadata compaction remains pending.','Season finals remain disabled under current product rules.','Unsupported source weather/traits still fail closed.','Stage 50 capacity evidence is tied to its own frozen source, and synchronous commit latency remains a final integration concern.']};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(report,null,2));fs.writeFileSync('outputs/v4-season-retention-20261118/acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,tests:report.tests,testFiles:report.testFiles,fullMatchesPerStorage:141,sourceArchive:target,preservation}));
