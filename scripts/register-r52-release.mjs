import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd(),version='20261006-r52',parent='20261004-r51';
const output=path.join(root,'outputs/hot-update-'+version),bundle=path.join(output,'yellowdogs-hot-update-'+version);
const archive=path.join(output,'yellowdogs-hot-update-'+version+'.tar.gz'),release=path.join(root,'releases',version);
assert.ok(!fs.existsSync(release),'Refusing to overwrite release metadata');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,value)=>fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n');
const sum=fs.readFileSync(archive+'.sha256','utf8').trim().split(/\s+/)[0];
assert.equal(sum,crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
const current=read(path.join(root,'releases/CURRENT.json'));
assert.equal(current.lastUserConfirmedDeployed,parent);
assert.equal(current.latestPublished,parent);
const previous=read(path.join(root,'releases',parent,'BASELINE.json'));
const manifest=read(path.join(bundle,'MANIFEST.json')),qa=read(path.join(bundle,'QA.json'));
assert.equal(manifest.baseline,parent);assert.equal(manifest.files.length,20);assert.equal(qa.passed,true);
const files=new Map(previous.files.map(row=>[row.path,row.sha256]));
for(const row of manifest.files){
 const payload=path.join(bundle,'payload',row.path);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(payload)).digest('hex'),row.sha256,row.path);
 files.set(row.path,row.sha256);
}
assert.equal(files.size,1300);
fs.mkdirSync(release);
fs.copyFileSync(path.join(bundle,'MANIFEST.json'),path.join(release,'MANIFEST.json'));
fs.copyFileSync(path.join(bundle,'QA.json'),path.join(release,'QA.json'));
fs.copyFileSync(archive+'.sha256',path.join(release,'ARCHIVE.sha256'));
const baseline={kind:'rougelite-release-baseline',schemaVersion:1,version,parent,source:manifest.scope,dependencies:manifest.dependencies,
 files:[...files].sort(([left],[right])=>left.localeCompare(right)).map(([file,sha256])=>({path:file,sha256})),
 excludedRuntimeInputs:previous.excludedRuntimeInputs};
save(path.join(release,'BASELINE.json'),baseline);
current.latestPublished=version;
current.sourceState='R52 package built from current workspace against the user-confirmed R51 deployment on 2026-10-06. R52 is not deployed; keep lastUserConfirmedDeployed at R51.';
current.releases.push({version,parent,bundleSha256:sum,baselineFiles:files.size,changedFiles:manifest.files.length,deployment:'not-confirmed'});
save(path.join(root,'releases/CURRENT.json'),current);
console.log(JSON.stringify({version,parent,archive,sha256:sum,baselineFiles:files.size,changedFiles:manifest.files.length,deployment:'not-confirmed'}));
