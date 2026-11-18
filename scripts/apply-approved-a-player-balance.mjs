// Apply the approved 230-player proposal through the application's authoritative
// content overrides. Original imports remain available as reference data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ATTRIBUTE_NAMES,playerOverallFromAttributes} from '../shared/football/schema.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const sourceDir=path.join(root,'outputs/a-player-adjustment-20261116');
const backup=path.join(root,'outputs/backups/a-player-balance-before-20261116');
const out=path.join(root,'outputs/a-player-balance-applied-20261116');
const live='data/ydl-content-overrides.json',studio='data/ydl-player-card-studio.json';
const ledgerFile='data/player-balance-a-20261116.json';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=file=>fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
const manifestFile=path.join(backup,'manifest.json');
const candidate=path.join(out,'candidate-content.json');
function effective(content,studioPath,output){
  const script="import fs from 'node:fs';const {REAL_PLAYERS}=await import('./versus/player-pool.js');const {flushContentWrites}=await import('./versus/ydl-content-store.js');await flushContentWrites();fs.writeFileSync(process.env.BALANCE_SNAPSHOT_OUTPUT,JSON.stringify(REAL_PLAYERS,null,2)+'\\n');";
  execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:root,windowsHide:true,env:{...process.env,YDL_CONTENT_OVERRIDES_PATH:content,YDL_PLAYER_CARD_STUDIO_PATH:studioPath,BALANCE_SNAPSHOT_OUTPUT:output},stdio:'pipe'});
  return read(output);
}
function verify(before,after,ledger){
  assert.equal(before.length,733);assert.equal(after.length,733);assert.equal(new Set(after.map(p=>p.id)).size,733);
  const target=new Map(ledger.players.map(p=>[p.id,p])),old=new Map(before.map(p=>[p.id,p]));let changed=0,attributeChanges=0;
  for(const p of after){const prev=old.get(p.id);assert.ok(prev,p.id);const approved=target.get(p.id);
    if(!approved){assert.deepEqual(p,prev,`Out-of-scope player changed: ${p.id}`);continue;}
    const expected={...prev,overall:approved.afterOverall,baseOverall:approved.afterOverall,attributes:approved.after,referenceAttributes:approved.after};
    assert.deepEqual(p,expected,`Approved data mismatch: ${p.id}`);
    assert.equal(playerOverallFromAttributes(p.attributes,p.role),p.overall,p.id);changed++;
    attributeChanges+=ATTRIBUTE_NAMES.filter(k=>prev.attributes[k]!==p.attributes[k]).length;
  }
  assert.equal(changed,230);assert.equal(attributeChanges,3220);
  const distribution=Object.fromEntries([86,87,88,89].map(n=>[n,after.filter(p=>p.grade==='A'&&p.overall===n).length]));
  assert.deepEqual(distribution,{86:115,87:80,88:28,89:7});
  return {total:733,changedPlayers:changed,unchangedPlayers:503,attributeChanges,distribution,identityAndPositionChanges:0};
}
if(process.argv.includes('--prepare')){
  assert.ok(!fs.existsSync(manifestFile),'Backup already exists; reuse --apply or --verify instead of overwriting it.');
  assert.ok(!fs.existsSync(path.join(root,ledgerFile)),'Approved ledger already exists.');
  const proposal=read(path.join(sourceDir,'proposal.json'));
  const files=[...new Set([...Object.keys(proposal.summary.sourceHashes),'data/s4-player-candidates-500.json','data/s4-retired-famous-players-50.json','data/ydl-content-overrides.backup.json','versus/player-pool.js','versus/ydl-content-store.js','versus/player-data-migrations.js'])];
  fs.mkdirSync(backup,{recursive:true});fs.mkdirSync(out,{recursive:true});
  const entries=[];
  for(const file of files){const source=path.join(root,file),hash=sha(source);entries.push({file,sha256:hash});if(hash){const dest=path.join(backup,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);assert.equal(sha(dest),hash);}}
  for(const file of ['proposal.json','A球员完整调整方案.xlsx'])fs.copyFileSync(path.join(sourceDir,file),path.join(backup,'approved-'+file));
  const preLoad=path.join(out,'before-content-copy.json');fs.copyFileSync(path.join(root,live),preLoad);
  const studioCopy=path.join(out,'studio-copy.json');if(fs.existsSync(path.join(root,studio)))fs.copyFileSync(path.join(root,studio),studioCopy);else write(studioCopy,{});
  const before=effective(preLoad,studioCopy,path.join(backup,'effective-players-before.json'));
  const byId=new Map(before.map(p=>[p.id,p]));
  for(const p of proposal.players){const current=byId.get(p.id);assert.ok(current,p.id);assert.equal(current.grade,'A');assert.equal(current.overall,p.beforeOverall,`Stale proposal: ${p.name}`);assert.deepEqual(current.attributes,p.before,`Stale proposal: ${p.name}`);for(const key of ['name','role','secondaryRole','nationality','club'])assert.equal(current[key],p[key],`Identity changed: ${p.name}:${key}`);}
  const ledger={revision:'a-balance-20261116-v1',approvedOn:'2026-11-16',source:'User-approved A-player proposal',proposalSha256:sha(path.join(sourceDir,'proposal.json')),applicationLayer:live,summary:proposal.summary,players:proposal.players.map(p=>({id:p.id,name:p.name,grade:p.grade,role:p.role,secondaryRole:p.secondaryRole,nationality:p.nationality,club:p.club,beforeOverall:p.beforeOverall,afterOverall:p.afterOverall,before:p.before,after:p.after,signatures:p.signatures,protections:p.protections,reason:p.reason}))};
  const original=read(path.join(root,live)),next=structuredClone(original);next.players??={};
  for(const p of ledger.players)next.players[p.id]={...(next.players[p.id]??{}),overall:p.afterOverall,attributes:{...p.after},balanceRevision:ledger.revision};
  next.updatedAt=new Date().toISOString();write(candidate,next);
  const after=effective(candidate,studioCopy,path.join(out,'candidate-effective.json'));
  const checks=verify(before,after,ledger);
  const normalized=read(candidate),allowed=new Set(ledger.players.map(p=>p.id));
  for(const [id,patch] of Object.entries(original.players??{}))if(!allowed.has(id))assert.deepEqual(normalized.players[id],patch,`Unrelated admin patch changed ${id}`);
  assert.deepEqual({...normalized,players:null,updatedAt:null},{...original,players:null,updatedAt:null},'Other content changed');
  for(const entry of entries)assert.equal(sha(path.join(root,entry.file)),entry.sha256,'Source changed during preparation');
  const candidateHash=sha(candidate);effective(candidate,studioCopy,path.join(out,'restart-effective.json'));assert.equal(sha(candidate),candidateHash,'Candidate must be stable on restart');
  write(path.join(root,ledgerFile),ledger);
  write(manifestFile,{revision:ledger.revision,createdAt:new Date().toISOString(),files:entries,proposalSha256:ledger.proposalSha256,ledgerSha256:sha(path.join(root,ledgerFile)),candidateSha256:candidateHash,checks,restore:{file:live,backup:path.join(backup,live),note:'Restore the saved content override to recover the previous effective player scheme. Other backed-up source files are unchanged by this application.'}});
  write(path.join(out,'prepared.json'),checks);console.log(JSON.stringify({prepared:true,backup,ledger:ledgerFile,...checks},null,2));
}else if(process.argv.includes('--apply')){
  const manifest=read(manifestFile),ledger=read(path.join(root,ledgerFile));
  assert.equal(sha(path.join(root,ledgerFile)),manifest.ledgerSha256);assert.equal(sha(candidate),manifest.candidateSha256);
  const alreadyApplied=sha(path.join(root,live))===manifest.candidateSha256;
  if(!alreadyApplied){
    for(const entry of manifest.files)assert.equal(sha(path.join(root,entry.file)),entry.sha256,`Live source changed: ${entry.file}`);
    const temp=path.join(root,'data/ydl-content-overrides.a-balance-pending.json');assert.ok(!fs.existsSync(temp));
    fs.copyFileSync(candidate,temp,fs.constants.COPYFILE_EXCL);assert.equal(sha(temp),manifest.candidateSha256);
    fs.renameSync(temp,path.join(root,live));
  }
  const verifyCopy=path.join(out,'applied-content-copy.json');fs.copyFileSync(path.join(root,live),verifyCopy);
  const after=effective(verifyCopy,path.join(out,'studio-copy.json'),path.join(out,'effective-players-after.json'));
  const checks=verify(read(path.join(backup,'effective-players-before.json')),after,ledger);
  for(const entry of manifest.files)if(entry.file!==live)assert.equal(sha(path.join(root,entry.file)),entry.sha256,entry.file);
  write(path.join(out,'applied.json'),{revision:ledger.revision,appliedAt:new Date().toISOString(),alreadyApplied,backup,...checks});console.log(JSON.stringify({applied:true,...checks,backup},null,2));
}else if(process.argv.includes('--verify')){
  const ledger=read(path.join(root,ledgerFile)),copy=path.join(out,'verify-content-copy.json');fs.copyFileSync(path.join(root,live),copy);
  const after=effective(copy,path.join(out,'studio-copy.json'),path.join(out,'verified-effective.json'));
  console.log(JSON.stringify(verify(read(path.join(backup,'effective-players-before.json')),after,ledger),null,2));
}else throw Error('Use --prepare, --apply, or --verify.');
