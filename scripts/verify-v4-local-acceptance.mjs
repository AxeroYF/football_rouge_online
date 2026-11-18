import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {VERSION} from '../versus/v4/world.js';
import {bundleDigest} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const directory='outputs/v4-real-teams-20261117',candidate=args.candidate??'14';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const proofFiles={},proofs={};
function verify(file,{passed=true,hashes=true}={}){
  const report=read(file);proofFiles[file]=hash(file);
  if(passed)assert.equal(report.passed,true,`${file}: not passed`);
  if(hashes){
    assert.ok(report.dependencyHashes||report.sourceHashes,`${file}: missing source provenance`);
    for(const [name,expected] of Object.entries(report.dependencyHashes??{}))assert.equal(hash(name),expected,`${file}: changed ${name}`);
    for(const [name,expected] of Object.entries(report.sourceHashes??{}))assert.equal(hash(path.join('versus/v4',name)),expected,`${file}: changed ${name}`);
  }
  return report;
}
const baseline=read('outputs/v4-before-stage5-20261117/protected-hashes.json');
const preservation=baseline.map(item=>({path:item.Path,sha256:hash(item.Path),unchanged:hash(item.Path)===item.Hash.toLowerCase()}));
assert.ok(preservation.every(p=>p.unchanged),'protected formal engine/save changed');
const calibration={};
for(const source of ['real','synthetic'])for(const duration of [600,5400]){
  const validationName=source==='real'?'C':'B';
  const training=verify(`${directory}/${source}-iteration${candidate}-${duration}.json`,{passed:false});
  const validation=verify(`${directory}/${source}-validation-${validationName}-${duration}.json`,{passed:false});
  for(const [kind,report] of [['training',training],['validation',validation]]){
    assert.equal(report.duration,duration);assert.ok(Object.keys(report.gates).length>=3);assert.ok(Object.values(report.gates).every(Boolean),`${source}/${duration}/${kind}: calibration gate`);
    const minimum=kind==='validation'?(duration===5400?(source==='real'?480:512):256):(duration===5400?(source==='real'?240:256):128);
    assert.ok(report.summary.runs>=minimum,`${source}/${duration}/${kind}: insufficient sample`);
    assert.equal(report.rows.length,report.summary.runs);
    if(duration===5400)for(const row of report.rows){
      assert.equal(row.periods.length,2);assert.ok(Math.abs(row.simulationSeconds-row.matchSeconds-900)<1e-4);
      for(const period of row.periods){assert.ok(period.elapsed>=2700+period.announced);assert.ok(Math.abs(period.elapsed-period.inPlay-period.dead)<1e-4);}
    }
    if(source==='real')for(const [name,expected] of Object.entries(report.sourceRevisions))assert.equal(hash(path.join('data',name)),expected);
  }
  const used=new Set(training.rows.map(r=>r.seed));assert.ok(validation.rows.every(r=>!used.has(r.seed)),'holdout seed overlaps training');
  calibration[`${source}${duration}`]={training:training.summary,validation:validation.summary,trainingSplit:training.split,validationSplit:validation.split};
}
const suite=verify(`${directory}/local-suite-verification.json`);assert.ok(suite.v4Tests>=136);assert.equal(suite.legacyTests,16);
assert.equal(hash(suite.runnerReport),suite.runnerReportHash);const runner=read(suite.runnerReport);assert.equal(runner.failed,0);assert.equal(runner.timedOut,0);
const core=verify(`${directory}/core-verification.json`);assert.equal(core.matches,48);assert.equal(core.fullExtraTime.periods.length,4);assert.equal(core.knockout.result.method,'penalties');
const scenarios=read(`${directory}/scenarios.json`);assert.ok(Object.keys(scenarios).length>=22);assert.ok(Object.values(scenarios).every(r=>r.passed));proofFiles[`${directory}/scenarios.json`]=hash(`${directory}/scenarios.json`);
proofs.browser=verify(`${directory}/verification.json`);assert.deepEqual(proofs.browser.errors,[]);assert.deepEqual(proofs.browser.badResponses,[]);
proofs.adapter=verify(`${directory}/real-adapter-verification.json`);assert.equal(proofs.adapter.shortRuns,32);assert.equal(proofs.adapter.sourceUnchanged,true);assert.equal(proofs.adapter.settlementAllowed,false);
proofs.catalog=verify(`${directory}/catalog-parity.json`);assert.ok(proofs.catalog.players>=733);assert.equal(proofs.catalog.originalFilesUnchanged,true);
const factors=verify(`${directory}/single-factor-iteration${candidate}.json`,{passed:false});assert.ok(Object.values(factors.checks).every(Boolean));
const tactics=verify(`${directory}/tactical-preset-audit-iteration${candidate}.json`,{passed:false});assert.deepEqual(tactics.warnings,[]);
const shootout=verify(`${directory}/shootout-validation-B.json`);assert.ok(shootout.kicks>=500);
const fairness=verify(`${directory}/fairness-iteration${candidate}.json`);assert.ok(fairness.total.runs>=256);assert.ok(fairness.rows.filter(r=>r.labelChecked).length>=16);
const shadow=verify(`outputs/v4-shadow-season-20261118/iteration${candidate}/shadow-season.json`);assert.equal(shadow.matches,112);assert.equal(shadow.rounds,14);
for(const prefix of ['','real-'])proofs[`${prefix}streamBrowser`]=verify(`outputs/v4-stream-20261117/${prefix}stream-browser-verification.json`);
const archive=verify('outputs/v4-stream-20261117/full-archive-measurement.json');assert.equal(archive.exactSimulation,true);assert.equal(archive.boundedViewer,true);
const capacity=verify(args.capacity??`outputs/v4-stream-capacity-20261118/iteration${candidate}/capacity.json`);
assert.equal(capacity.metrics.completed.length,4);assert.equal(capacity.limits.logicalProcessors,2);assert.equal(capacity.limits.jobMemoryBytes,2147483648);
const rollout=verify('outputs/v4-rollout-20261117/rollout-verification.json');assert.equal(rollout.sourceDigest,bundleDigest(dependencyHashes(['versus/v4/engine.js'])));
assert.equal(rollout.exactResume,true);assert.equal(rollout.settlementExactlyOnce,true);assert.equal(rollout.productionEnabled,false);
const report={passed:true,version:VERSION,candidate,scope:'Local V4 adapter, stream, shadow-season and isolated recovery acceptance. Production integration and cloud capacity are not certified.',
  productionEnabled:false,formalEngineReplaced:false,formalSettlementAllowed:false,v4Tests:suite.v4Tests,legacyTests:suite.legacyTests,matrixRuns:core.matches,scenarios:Object.keys(scenarios).length,
  calibration,preservation,sourceFingerprint:proofs.adapter.sourceFingerprint,proofFiles,
  fairness:{total:fairness.total,byPreset:fairness.byPreset},shadow:{matches:shadow.matches,rounds:shadow.rounds,rotations:shadow.rotatedStarterSelections},
  stream:{bytesByView:archive.metrics.bytesByView,highWater:archive.metrics.highWater},capacity:{seconds:capacity.seconds,latency:capacity.latency,rss:capacity.metrics.highRss},
  shootout:{kicks:shootout.kicks,conversion:shootout.conversion},engineSourceDigest:rollout.sourceDigest,
  dependencyHashes:dependencyHashes(['scripts/verify-v4-local-acceptance.mjs']),
  remaining:['Formal account/match authorization host wiring and legacy-compatible player settlement report remain disabled.','Unsupported weather and trait hooks are rejected; no handball, advantage or voluntary substitutions.','Cloud verification explicitly deferred by user; local Windows results do not certify Hong Kong hosting.']};
fs.writeFileSync(path.join(directory,'local-acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,version:VERSION,v4Tests:report.v4Tests,legacyTests:report.legacyTests,proofFiles:Object.keys(proofFiles).length,productionEnabled:false}));
