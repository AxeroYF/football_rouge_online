import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const directory=path.resolve('outputs/v4-capabilities-20261117');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const baseline=read('outputs/v4-before-stage5-20261117/protected-hashes.json');
const protectedFiles=baseline.map(item=>({path:item.Path,before:item.Hash.toLowerCase(),after:hash(item.Path)}));
for(const file of protectedFiles){file.unchanged=file.before===file.after;assert.ok(file.unchanged,file.path);}
fs.writeFileSync(path.join(directory,'preservation.json'),JSON.stringify({passed:true,files:protectedFiles},null,2));
const calibration={};
for(const duration of [600,5400])for(const split of ['train','validation']){
  const file=`calibration-${split}-${duration}.json`,report=read(path.join(directory,file));
  assert.equal(report.duration,duration);assert.ok(Object.values(report.gates).every(Boolean),`${file}: calibration gate failed`);
  for(const [name,expected] of Object.entries(report.sourceHashes))assert.equal(hash(path.join('versus/v4',name)),expected,`${file}: source changed: ${name}`);
  if(duration===5400)for(const row of report.rows){
    assert.equal(row.periods.length,2,'both halves must finish');
    assert.ok(Math.abs(row.simulationSeconds-row.matchSeconds-900)<1e-4,'interval excluded from match time');
    for(const p of row.periods){assert.ok(p.elapsed>=2700+p.announced);assert.ok(Math.abs(p.elapsed-p.inPlay-p.dead)<1e-4);}
  }
  calibration[`${split}${duration}`]={file,runs:report.summary.runs,summary:report.summary,gates:report.gates};
}
for(const duration of [600,5400]){
  const training=read(path.join(directory,`calibration-train-${duration}.json`));
  const validation=read(path.join(directory,`calibration-validation-${duration}.json`));
  assert.ok(validation.rows.every(row=>!training.rows.some(t=>t.seed===row.seed)),'validation seeds must be independent');
}
const parseTap=name=>{const tap=fs.readFileSync(path.join(directory,name),'utf8');const passed=Number(tap.match(/# pass (\d+)/)?.[1]);assert.ok(passed>0);assert.match(tap,/# fail 0\b/);return passed;};
const browser=read(path.join(directory,'verification.json')),core=read(path.join(directory,'core-verification.json'));
assert.equal(browser.passed,true);assert.equal(core.passed,true);assert.deepEqual(browser.errors,[]);
assert.ok(core.sourceHashes);for(const [name,expected] of Object.entries(core.sourceHashes))assert.equal(hash(path.join('versus/v4',name)),expected,`core source changed: ${name}`);
assert.equal(core.fullExtraTime.periods.length,4);
const scenarios=read(path.join(directory,'scenarios.json'));assert.ok(Object.values(scenarios).every(s=>s.passed));
const singleFactor=read(path.join(directory,'single-factor.json'));
assert.ok(Object.values(singleFactor.checks).every(Boolean),'single-factor behavior gates');
const tacticAudit=read(path.join(directory,'tactical-preset-audit.json'));
assert.deepEqual(tacticAudit.warnings,[],'synthetic preset severe imbalance');
for(const report of [singleFactor,tacticAudit]){
  assert.ok(report.sourceHashes,'diagnostics must identify their source');
  for(const [name,expected] of Object.entries(report.sourceHashes))assert.equal(hash(path.join('versus/v4',name)),expected,`diagnostic source changed: ${name}`);
}
const shootouts=read(path.join(directory,'shootout-validation.json'));assert.equal(shootouts.passed,true);
assert.ok(shootouts.sourceHashes);for(const [name,expected] of Object.entries(shootouts.sourceHashes))assert.equal(hash(path.join('versus/v4',name)),expected,`shootout source changed: ${name}`);
assert.equal(core.knockout.periods.length,4);assert.equal(core.knockout.result.method,'penalties');
const report={passed:true,version:'4.0.0-prototype.7',v4Tests:parseTap('tests.tap'),legacyTests:parseTap('legacy-regression.tap'),
  matrixRuns:core.matches,scenarios:Object.keys(scenarios).length,longRun:core.longRun,fullRun:core.fullRun,calibration,
  protectedFilesUnchanged:true,browserPassed:true,singleFactor:{runs:singleFactor.runs,checks:singleFactor.checks},tacticalPresetAudit:tacticAudit.teams,knockout:core.knockout,fullExtraTime:core.fullExtraTime,shootouts:{runs:shootouts.runs,kicks:shootouts.kicks,conversion:shootouts.conversion},
  limitations:['Synthetic squads only; targets are engineering ranges, not real-league fitting.','No handball, advantage, voluntary substitutions or real-player adapters. Aerial reach is an envelope, not a full-body jump simulation.','No cloud capacity or full repository acceptance.']};
fs.writeFileSync(path.join(directory,'acceptance.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,v4Tests:report.v4Tests,legacyTests:report.legacyTests,scenarios:report.scenarios,protectedFilesUnchanged:true}));
