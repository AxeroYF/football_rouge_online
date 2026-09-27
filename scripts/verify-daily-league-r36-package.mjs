import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [bundleArg,...baseArgs]=process.argv.slice(2),bundle=path.resolve(bundleArg),root=process.cwd();
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest=read(path.join(bundle,'MANIFEST.json'));
const baseLayers=baseArgs.map(p=>path.resolve(p));
const initial=path.join(root,'outputs/hot-update-20260920-r17/base-r16');
const fixture=path.join(path.dirname(bundle),'verified-preflight-fixture-final'),app=path.join(fixture,'app'),data=path.join(fixture,'data');
assert.ok(!fs.existsSync(fixture),'Do not overwrite an existing fixture');fs.mkdirSync(app,{recursive:true});fs.mkdirSync(data,{recursive:true});
const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
for(const item of manifest.requiredBaseFiles){
 const source=[...baseLayers].reverse().map(p=>path.join(p,'payload',item.path)).concat(path.join(initial,item.path)).find(p=>fs.existsSync(p)&&hash(p)===item.sha256);
 assert.ok(source,'Missing verified base: '+item.path);copy(source,path.join(app,item.path));
}
for(const dep of manifest.dependencies)copy(path.join(root,dep.path,'package.json'),path.join(app,dep.path,'package.json'));
fs.writeFileSync(path.join(data,'campaign-accounts.json'),'{}');
const {preflight,verifyBundle,applyUpdate,rollbackUpdate}=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const options={bundle,app,data},checks=[];
preflight(options);checks.push('Complete '+manifest.baseline+' base accepted');
const stable=manifest.requiredBaseFiles.find(f=>!manifest.files.some(x=>x.path===f.path)&&f.path.endsWith('.js'));
const target=path.join(app,stable.path),original=fs.readFileSync(target);
fs.appendFileSync(target,'\n// altered base');assert.throws(()=>preflight(options),/baseline mismatch/);fs.writeFileSync(target,original);checks.push('Modified base rejected');
fs.renameSync(target,target+'.missing');assert.throws(()=>preflight(options),/baseline missing/);fs.renameSync(target+'.missing',target);checks.push('Missing base rejected');
for(const item of manifest.files){assert.equal(hash(path.join(root,item.path)),item.sha256,'Workspace/package mismatch: '+item.path);copy(path.join(bundle,'payload',item.path),path.join(app,item.path));}
preflight(options);checks.push('Applied '+manifest.version+' supports safe reapply');
const changed=path.join(bundle,'payload',manifest.files[0].path),good=fs.readFileSync(changed);
try{fs.appendFileSync(changed,'\ninvalid');assert.throws(()=>verifyBundle(bundle),/checksum mismatch/);}finally{fs.writeFileSync(changed,good);}checks.push('Corrupt payload rejected');
// Resolve direct runtime imports against the effective installation, including new modules.
let imports=0;
for(const entry of manifest.files.filter(f=>/\.(?:mjs|js)$/.test(f.path))){
 const text=fs.readFileSync(path.join(app,entry.path),'utf8');
 for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g)){
  const rel=path.posix.normalize(path.posix.join(path.posix.dirname(entry.path),match[1].split('?')[0]));
  assert.ok(fs.existsSync(path.join(app,rel))||fs.existsSync(path.join(initial,rel)),'Missing runtime import: '+rel);imports++;
 }
}
checks.push('Changed-module imports resolve against base plus payload');
// Restore the exact R16 baseline and rehearse code/data transactions with mock service hooks.
for(const item of manifest.requiredBaseFiles){const source=[...baseLayers].reverse().map(p=>path.join(p,'payload',item.path)).concat(path.join(initial,item.path)).find(p=>fs.existsSync(p)&&hash(p)===item.sha256);assert.ok(source);copy(source,path.join(app,item.path));}
for(const item of manifest.files.filter(f=>f.baselineSha256===null))fs.unlinkSync(path.join(app,item.path));
const sentinel=JSON.stringify({accounts:{test:{id:'test',gold:123}},world:{revision:7}});
fs.writeFileSync(path.join(data,'campaign-accounts.json'),sentinel);
const options2={...options,backupRoot:path.join(fixture,'backups'),stop:()=>{},start:()=>{},health:async()=>true,log:()=>{}};
const installedResult=await applyUpdate(options2);
assert.equal(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'),sentinel);
await rollbackUpdate({...options2,backup:installedResult.backup});preflight(options);
assert.equal(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'),sentinel);
checks.push('Apply and explicit rollback preserve matched save with mocked service hooks');
let healthCalls=0;await assert.rejects(()=>applyUpdate({...options2,health:async()=>++healthCalls>1}),/automatically rolled back/);
preflight(options);assert.equal(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'),sentinel);
checks.push('Health failure automatically rolls back with mocked service hooks');
const result={passed:true,version:manifest.version,checks,changedFiles:manifest.files.length,newFiles:manifest.files.filter(f=>f.baselineSha256===null).length,requiredBaseFiles:manifest.requiredBaseFiles.length,imports,scope:'Windows isolated file and transaction rehearsal; service hooks mocked, no Linux service upgrade',remoteDeployed:false};
fs.writeFileSync(path.join(path.dirname(bundle),'incremental-preflight.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
