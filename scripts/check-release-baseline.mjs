import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const current=read(path.join(root,'releases/CURRENT.json'));
let prior=null;
const reports=[];
for(const record of current.releases){
 const dir=path.join(root,'releases',record.version),manifest=read(path.join(dir,'MANIFEST.json')),baseline=read(path.join(dir,'BASELINE.json'));
 assert.equal(manifest.version,record.version);assert.equal(manifest.baseline,record.parent);
 assert.equal(baseline.version,record.version);assert.equal(baseline.parent,record.parent);
 assert.equal(read(path.join(dir,'QA.json')).passed,true);
 assert.equal(fs.readFileSync(path.join(dir,'ARCHIVE.sha256'),'utf8').split(/\s/)[0],record.bundleSha256);
 const files=new Map();
 for(const row of baseline.files){
  assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.ok(!files.has(row.path),'Duplicate baseline path');
  assert.ok(!row.path.startsWith('/')&&!row.path.includes('\\')&&!row.path.split('/').includes('..'));
  assert.ok(!/^(data|seed|outputs|node_modules)\//.test(row.path),'Private/runtime path in baseline');files.set(row.path,row.sha256);
 }
 assert.equal(files.size,record.baselineFiles);
 if(prior){
  assert.equal(record.parent,prior.version);
  for(const row of manifest.requiredBaseFiles)assert.equal(prior.files.get(row.path),row.sha256,'Inherited base mismatch: '+row.path);
  const expected=new Map(prior.files);for(const row of manifest.files)expected.set(row.path,row.sha256);
  assert.deepEqual(files,expected,'Effective release snapshot mismatch');
 }
 for(const row of manifest.files)assert.equal(files.get(row.path),row.sha256,'Published payload differs from baseline');
 reports.push({version:record.version,parent:record.parent,files:files.size,changed:manifest.files.length});prior={version:record.version,files};
}
assert.equal(current.latestPublished,prior.version);
assert.ok(current.releases.some(r=>r.version===current.lastUserConfirmedDeployed&&r.deployment==='user-confirmed'));
const result={passed:true,latestPublished:current.latestPublished,lastUserConfirmedDeployed:current.lastUserConfirmedDeployed,releases:reports};
if(process.argv.includes('--workspace')){
 result.sourceDifferences=[];result.missing=[];
 for(const [relative,expected]of prior.files){const file=path.join(root,relative);if(!fs.existsSync(file)){result.missing.push(relative);continue;}if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)result.sourceDifferences.push(relative);}
 assert.equal(result.missing.length,0,'Tracked release inputs missing from checkout');
}
console.log(JSON.stringify(result,null,2));
