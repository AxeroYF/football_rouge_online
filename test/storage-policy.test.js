import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LeagueShardStore} from '../versus/league-shard-store.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {collectShardReferences,planShardGarbageCollection,shardIndexName} from '../versus/infrastructure/shard-references.js';
import {auditLeagueStorage} from '../scripts/audit-league-storage.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-storage-policy-'));
  t.after(()=>{assert.ok(directory.startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-storage-policy-'));fs.rmSync(directory,{recursive:true,force:true});});
  const root=path.join(directory,'shards');
  const state={version:2,updatedAt:1,teams:[],payload:'x'.repeat(20000),matches:[{id:'m1',report:{score:[1,0],events:[{type:'goal',minute:1}]}}],ledger:[],s4Assets:{cards:{c1:{id:'c1',ownerId:'owner',upgradeLevel:0}},transactions:[]},archives:[]};
  const store=new LeagueShardStore(root,{backupDir:null,maxLogSegments:4,maxCleanupFiles:10000});store.save(state,{forceFull:true});
  return{directory,root,state,store};
}

test('file-level collection removes obsolete files from a still-referenced revision',t=>{
  const {root,state,store}=fixture(t);const oldCore=path.join(root,store.manifest.shards.core),reportPath=path.join(root,store.matchReportPaths.get('m1'));
  for(let i=0;i<12;i++){state.updatedAt++;state.ledger.push({id:'l'+i});state.s4Assets.transactions.push({id:'t'+i});state.s4Assets.cards.c1.upgradeLevel=i%9;store.save(state,{scopes:['assets','ledger']});}
  const result=store.cleanupRevisions(store.manifest);assert.ok(result.deletedFiles>0);assert.equal(fs.existsSync(oldCore),false);assert.equal(fs.existsSync(reportPath),true);
  const restored=new LeagueShardStore(root,{backupDir:null}).load();assert.deepEqual(restored.matches[0].report,state.matches[0].report);assert.deepEqual(restored.ledger,state.ledger);assert.deepEqual(restored.s4Assets.cards,state.s4Assets.cards);
  const audit=auditLeagueStorage(root);assert.equal(audit.missingReferences,0);assert.equal(audit.largestGroups.find(group=>group.group==='core.json').files,2);
});

test('coalescing bounds log segments while preserving the exact current state and older backup',t=>{
  const {root,state,store}=fixture(t);const backupDir=path.join(root,'yellowdogs-league-backups');store.backupDir=backupDir;let backup,oldLedger,oldTransactions;
  for(let i=0;i<30;i++){
    state.updatedAt++;state.ledger.push({id:'l'+i,amount:i});state.s4Assets.transactions.push({id:'t'+i,type:'open'});store.save(state,{scopes:['assets','ledger']});
    if(i===2){backup=structuredClone(store.manifest);oldLedger=structuredClone(state.ledger);oldTransactions=structuredClone(state.s4Assets.transactions);store.backupSnapshot(path.join(backupDir,'kept.manifest.json'));}
  }
  assert.ok(store.manifest.shards.ledger.segments.length<=4);assert.ok(store.manifest.shards.assets.transactions.segments.length<=4);
  store.cleanupRevisions(store.manifest);
  const reader=new LeagueShardStore(root);const current=reader.load(),previous=reader.loadManifest(backup);
  assert.deepEqual(current.ledger,state.ledger);assert.deepEqual(current.s4Assets.transactions,state.s4Assets.transactions);
  assert.deepEqual(previous.ledger,oldLedger);assert.deepEqual(previous.s4Assets.transactions,oldTransactions);
});

test('a corrupt backup or missing nested report stops cleanup before deleting any files',t=>{
  const {root,state,store}=fixture(t);const junk=path.join(root,'revisions/1/obsolete.json');fs.writeFileSync(junk,'old');
  for(let i=0;i<3;i++){state.updatedAt++;store.save(state,{scopes:['core']});}
  const backupDir=path.join(root,'yellowdogs-league-backups');fs.mkdirSync(backupDir);fs.writeFileSync(path.join(backupDir,'broken.manifest.json'),'{');store.backupDir=backupDir;
  t.mock.method(console,'warn',()=>{});
  assert.equal(store.cleanupRevisions(store.manifest).skipped,true);assert.equal(fs.existsSync(junk),true);
  fs.unlinkSync(path.join(backupDir,'broken.manifest.json'));
  const index=JSON.parse(fs.readFileSync(path.join(root,store.manifest.shards.matches),'utf8'));index.entries[0].reportPath='revisions/1/reports/missing.json';fs.writeFileSync(path.join(root,store.manifest.shards.matches),JSON.stringify(index));
  assert.equal(store.cleanupRevisions(store.manifest).skipped,true);assert.equal(fs.existsSync(junk),true);
});

test('runtime collection respects its deletion budget and never removes the latest two revisions',t=>{
  const {root,state,store}=fixture(t);store.maxCleanupFiles=16;
  for(let i=0;i<50;i++)fs.writeFileSync(path.join(root,'revisions/1/junk-'+i+'.json'),'old');
  for(let i=0;i<2;i++){state.updatedAt++;store.save(state,{scopes:['core']});}
  const recent=path.join(root,'revisions',String(store.manifest.revision-1),'recent-junk.json');fs.writeFileSync(recent,'keep grace');
  const first=store.cleanupRevisions(store.manifest);assert.equal(first.deletedFiles,16);assert.ok(first.remainingFiles>0);assert.equal(fs.existsSync(recent),true);
  while(planShardGarbageCollection(root,store.manifest,{backupDir:null}).deletableFiles)store.cleanupRevisions(store.manifest);
  assert.equal(fs.existsSync(recent),true);assert.equal(new LeagueShardStore(root,{backupDir:null}).load().matches[0].report.score[0],1);
});

test('daily and pre-daily-reset backups expire after seven dates; admin/migration backups after thirty days',t=>{
  const {root,state,store}=fixture(t),service=Object.create(YellowDogsLeagueService.prototype);
  service.backupDir=path.join(root,'yellowdogs-league-backups');service.shardStore=store;service.lastBackupMaintenanceDate=null;store.backupDir=service.backupDir;
  const start=Date.parse('2026-01-01T04:00:00Z');let now=start;service.now=()=>now;
  service.backupFile('pre-migration.manifest.json');fs.utimesSync(path.join(service.backupDir,'pre-migration.manifest.json'),new Date(now),new Date(now));
  service.backupFile('before-full-reset-2026-01-01-'+now+'.manifest.json');
  for(let day=0;day<45;day++){
    now=start+day*86400_000;state.updatedAt=now;store.save(state,{scopes:['core']});
    service.backupFile('before-daily-reset-'+new Date(now).toISOString().slice(0,10)+'-'+now+'.manifest.json');service.maintainBackups();
  }
  const names=fs.readdirSync(service.backupDir);assert.equal(names.filter(n=>/^\d{4}-/.test(n)).length,7);assert.equal(names.filter(n=>n.startsWith('before-daily-reset-')).length,7);
  assert.equal(names.includes('pre-migration.manifest.json'),false);assert.equal(names.some(n=>n.startsWith('before-full-reset-')),false);
  store.cleanupRevisions(store.manifest);for(const name of names)assert.ok(collectShardReferences(root,JSON.parse(fs.readFileSync(path.join(service.backupDir,name),'utf8'))).size>0);
});

test('prefixed indexes remain traversable and an escaping reference is rejected',t=>{
  const {root,store}=fixture(t);
  assert.equal(shardIndexName('000002-000001-matches-index.json'),'matches-index.json');assert.equal(shardIndexName('000003-archives-index.json'),'archives-index.json');assert.equal(shardIndexName('match-report.json'),null);
  assert.throws(()=>collectShardReferences(root,{shards:{core:'revisions/../../outside.json'}}),/escapes/);
  const before=fs.statSync(path.join(root,'manifest.json')).mtimeMs;auditLeagueStorage(root);assert.equal(fs.statSync(path.join(root,'manifest.json')).mtimeMs,before);
});

test('abandoned temporary revisions expire after a day while fresh temporary work survives',t=>{
  const {root,store}=fixture(t);
  const stale=path.join(root,'revisions/.tmp-2-123-old'),fresh=path.join(root,'revisions/.tmp-compact-3-123');
  for(const directory of [stale,fresh]){fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'core.json'),'uncommitted');}
  const old=new Date(Date.now()-2*86400_000);fs.utimesSync(stale,old,old);
  store.cleanupRevisions(store.manifest);
  assert.equal(fs.existsSync(stale),false);assert.equal(fs.existsSync(fresh),true);
  assert.equal(new LeagueShardStore(root,{backupDir:null}).load().matches[0].report.score[0],1);
});

test('backup expiry is suspended when current references are broken, preserving old recovery points',t=>{
  const {root,state,store}=fixture(t),service=Object.create(YellowDogsLeagueService.prototype);
  service.backupDir=path.join(root,'yellowdogs-league-backups');service.shardStore=store;service.lastBackupMaintenanceDate=null;service.now=()=>Date.now();store.backupDir=service.backupDir;
  const backup=path.join(service.backupDir,'pre-recovery.manifest.json');store.backupSnapshot(backup);
  const old=new Date(Date.now()-60*86400_000);fs.utimesSync(backup,old,old);
  state.updatedAt++;state.matches=[{id:'m2',report:{score:[2,0]}}];store.save(state,{scopes:['matches']});
  const indexPath=path.join(root,store.manifest.shards.matches),index=JSON.parse(fs.readFileSync(indexPath,'utf8'));index.entries[0].reportPath='revisions/1/reports/not-present.json';fs.writeFileSync(indexPath,JSON.stringify(index));
  t.mock.method(console,'warn',()=>{});service.maintainBackups();
  assert.equal(fs.existsSync(backup),true);assert.ok(collectShardReferences(root,JSON.parse(fs.readFileSync(backup,'utf8'))).size>0);
  assert.deepEqual(fs.readdirSync(service.backupDir),['pre-recovery.manifest.json']);
});

test('index display text that resembles a path is never interpreted as a storage reference',t=>{
  const {root,state,store}=fixture(t);
  state.updatedAt++;state.matches[0].homeName='revisions/../../not-a-file';
  state.archives=[{archiveKey:'old',season:{id:'old',name:'revisions/not-a-season-file'},matches:[],standings:[{name:'revisions/not-a-team-file'}]}];
  store.save(state,{scopes:['matches','archives']});
  assert.ok(collectShardReferences(root,store.manifest).size>0);assert.equal(auditLeagueStorage(root).missingReferences,0);
  assert.equal(new LeagueShardStore(root,{backupDir:null}).load().matches[0].homeName,'revisions/../../not-a-file');
});
