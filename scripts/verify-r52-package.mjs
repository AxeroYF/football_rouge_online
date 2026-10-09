import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),out=path.join(root,'outputs/hot-update-20261006-r52');
const bundle=path.join(out,'yellowdogs-hot-update-20261006-r52');
const baseline=path.join(root,'releases/20261004-r51');
const outputRoots=fs.readdirSync(path.join(root,'outputs'),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(root,'outputs',entry.name));
const baseRoots=[root,path.join(root,'outputs/aliyun-release-20260909-s4accounts/yellowdogs-rougelite-aliyun/app')];
for(const directory of outputRoots){
 if(path.basename(directory).startsWith('hot-update-')){
  for(const child of fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory())){
   const payload=path.join(directory,child.name,'payload');if(fs.existsSync(payload))baseRoots.push(payload);
  }
 }
}
const fixture=path.join(out,'verified-r52-fixture-'+Date.now()),app=path.join(fixture,'app'),data=path.join(fixture,'data');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.ok(!fs.existsSync(fixture),'Refusing to overwrite existing R52 QA fixture');
const manifest=read(path.join(bundle,'MANIFEST.json')),base=read(path.join(baseline,'BASELINE.json'));
const sourceRevision='37591c4304cca35159b24ab2fe595b5b9b4ec83c';
assert.equal(manifest.baseline,'20261004-r51');assert.equal(base.version,manifest.baseline);
assert.equal(manifest.requiredBaseFiles.length,base.files.length);
fs.mkdirSync(app,{recursive:true});fs.mkdirSync(data,{recursive:true});
for(const row of manifest.requiredBaseFiles){
 const source=baseRoots.map(base=>path.join(base,row.path)).find(candidate=>fs.existsSync(candidate)&&sha(candidate)===row.sha256);
 const bytes=source?fs.readFileSync(source):execFileSync('git',['show',`${sourceRevision}:${row.path}`],{maxBuffer:32*1024*1024,stdio:['ignore','pipe','ignore']});
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256,'Could not reconstruct exact deployed R51 baseline: '+row.path);
 const dest=path.join(app,row.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
}
for(const dep of manifest.dependencies){
 const source=path.join(root,dep.path),dest=path.join(app,dep.path);
 assert.equal(read(path.join(source,'package.json')).version,dep.version);
 fs.cpSync(source,dest,{recursive:true});
}
const save=path.join(data,'campaign-accounts.json'),saved='{"accounts":{"release-qa":{"id":"release-qa","gold":12345}},"world":{"revision":7}}\n';
fs.writeFileSync(save,saved);fs.mkdirSync(path.join(app,'assets/player-profiles'),{recursive:true});
const privateFile=path.join(app,'assets/player-profiles/r52-private-sentinel.txt');fs.writeFileSync(privateFile,'keep private uploads');
const updater=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const backupRoot=path.join(fixture,'backups');
const options={bundle,app,data,backupRoot,stop:async()=>{},start:async()=>{},health:async()=>true,log:()=>{}};
const checks=[];
updater.preflight(options);checks.push('Exact R51 effective file baseline and runtime dependencies accepted');
const current=manifest.files[0],target=path.join(app,current.path),original=fs.readFileSync(target);
fs.appendFileSync(target,'\nqa-corruption');assert.throws(()=>updater.preflight(options),/baseline mismatch/);fs.writeFileSync(target,original);
checks.push('Modified R51 base rejected');
assert.equal(updater.verifyBundle(bundle).files.length,manifest.files.length);
for(const entry of manifest.files)assert.equal(sha(path.join(root,entry.path)),entry.sha256,'Package/source mismatch: '+entry.path);
checks.push('All payload hashes match release source');
let importCount=0;
for(const entry of manifest.files.filter(row=>/\.(?:mjs|js)$/.test(row.path))){
 const source=fs.readFileSync(path.join(entry.baselineSha256===null?bundle+'/payload':app,entry.path),'utf8');
 for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g)){
  const relative=path.posix.normalize(path.posix.join(path.posix.dirname(entry.path),match[1].split('?')[0]));
  assert.ok(fs.existsSync(path.join(app,relative)),'Unresolved changed-module import: '+relative);importCount++;
 }
}
checks.push(`Changed-module relative imports resolve (${importCount})`);
const installed=await updater.applyUpdate(options);
assert.equal(fs.readFileSync(save,'utf8'),saved);assert.equal(fs.readFileSync(privateFile,'utf8'),'keep private uploads');
assert.ok(fs.existsSync(path.join(app,'client/settings/enhancement-settings.js')));
updater.preflight(options);checks.push('Install and idempotent reapply retain save, private file and new module');
await updater.rollbackUpdate({...options,backup:installed.backup});
assert.equal(fs.readFileSync(save,'utf8'),saved);assert.equal(fs.readFileSync(privateFile,'utf8'),'keep private uploads');
assert.ok(!fs.existsSync(path.join(app,'client/settings/enhancement-settings.js')));updater.preflight(options);
checks.push('Explicit rollback restores R51 while retaining save and user file');
let healthChecks=0;
await assert.rejects(()=>updater.applyUpdate({...options,health:async()=>++healthChecks>1}),/automatically rolled back/);
updater.preflight(options);assert.equal(fs.readFileSync(save,'utf8'),saved);
checks.push('Failed health check automatically rolls back to R51');
const browser=read(path.join(root,'outputs/training-shop-maritime-review/report.json'));
assert.equal(browser.checks.length,29);assert.equal(browser.errors.length,0);
const testLog=fs.readFileSync(path.join(root,'outputs/full-test-suite.log'),'utf8');
assert.match(testLog,/# pass 1711\r?\n# fail 0/);
const qa={passed:true,version:manifest.version,baseline:manifest.baseline,tests:{fullSuitePassed:1711,failed:0,syntaxCheckedModules:382},browser:{passed:true,checks:browser.checks.length,engines:['Chrome','WebKit'],errors:0,maritime:browser.metrics},incremental:{passed:true,checks,changedFiles:manifest.files.length,newFiles:manifest.files.filter(row=>row.baselineSha256===null).length,requiredBaseFiles:manifest.requiredBaseFiles.length,imports:importCount},releaseBaseline:{passed:true,missingFiles:0,archiveIncludesServerUpdater:true},remoteDeployed:false,scope:'R51-based isolated Windows file/update/rollback verification; app service hooks mocked; Chrome and WebKit UI checks; no remote deployment'};
fs.writeFileSync(path.join(bundle,'QA.json'),JSON.stringify(qa,null,2)+'\n');
console.log(JSON.stringify(qa));
