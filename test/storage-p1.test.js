import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {LeagueShardStore,createTrackedState,unwrapTracked,matchReportMetadata} from '../versus/league-shard-store.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {ColdJsonCache,compressColdJson} from '../versus/infrastructure/cold-json-cache.js';
import {collectShardReferences} from '../versus/infrastructure/shard-references.js';
import {optimizeLeagueStorage} from '../devtool/optimize-league-storage.js';

function fixture(t,options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-p1-'));
  t.after(()=>{assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-p1-'));fs.rmSync(dir,{recursive:true,force:true});});
  const root=path.join(dir,'shards'),store=new LeagueShardStore(root,{backupDir:null,...options});
  const report={score:[2,1],engineVersion:'3.0.0',engineProfile:'v3.0-tactical-control.1',events:[{minute:2,type:'goal'}],tacticalReview:{one:'unchanged'},dotReplay:{frames:[{x:1}]},payload:'same-full-report-'.repeat(1000)};
  const state={version:2,updatedAt:1,teams:[],season:{id:'current'},matches:[{id:'same-id',homeId:'a',awayId:'b',score:[2,1],report:structuredClone(report)}],seasonFinalTournament:{status:'completed',matches:[{id:'same-id',competition:'season-final',score:[0,1],report:{...structuredClone(report),score:[0,1]}}]},ledger:[],s4Assets:{cards:{a:{id:'a',ownerId:'one',traits:{level:1}},b:{id:'b',ownerId:'two',traits:{level:2}}},transactions:[]},s4Packs:{inventory:{one:[{id:'p1'}],two:[{id:'p2'}]}},inbox:{one:[{id:'i1',read:false}],two:[{id:'i2',read:false}]},archives:[{archiveKey:'past',season:{id:'past'},matches:[{id:'old',report:structuredClone(report)}]}]};
  return {dir,root,store,state,report};
}
const read=(root,ref)=>JSON.parse(fs.readFileSync(path.join(root,ref),'utf8'));

test('compressed league, finals and archive retain every field and finals never enter core',t=>{
  const {root,store,state,report}=fixture(t);store.save(state,{scopes:['core']});
  assert.equal(typeof Object.getOwnPropertyDescriptor(state.matches[0],'report').get,'function');
  const index=read(root,store.manifest.shards.matches),finals=read(root,store.manifest.shards.seasonFinal);
  assert.equal(read(root,store.manifest.shards.core).seasonFinalTournament,undefined);
  assert.notEqual(index.entries[0].reportPath,finals.entries[0].reportPath);
  assert.match(index.entries[0].reportPath,/\.json\.gz$/);
  assert.deepEqual(JSON.parse(gunzipSync(fs.readFileSync(path.join(root,index.entries[0].reportPath)))),report);
  const reader=new LeagueShardStore(root,{backupDir:null}),loaded=reader.load();
  assert.equal(reader.coldCache.reads,0);
  assert.deepEqual(unwrapTracked(loaded.matches[0].report),report);
  assert.deepEqual(unwrapTracked(loaded.seasonFinalTournament.matches[0].report.score),[0,1]);
  assert.deepEqual(reader.readFullArchive(loaded.archives[0]).matches[0].report,report);
  const archive=reader.readFullArchive(loaded.archives[0]);archive.matches[0].report.score[0]=99;
  assert.equal(reader.readFullArchive(loaded.archives[0]).matches[0].report.score[0],2);
  const finalRef=store.manifest.shards.seasonFinal;state.updatedAt++;store.save(state,{scopes:['core']});
  assert.equal(store.manifest.shards.seasonFinal,finalRef);
  collectShardReferences(root,store.manifest);
});

test('summaries and tracked archive assignments do not read deferred report bodies',t=>{
  const {root,store,state}=fixture(t);store.save(state,{forceFull:true});
  const reader=new LeagueShardStore(root,{backupDir:null}),loaded=reader.load(),dirty=new Set(),tracked=createTrackedState(loaded,s=>dirty.add(s));
  const service=Object.create(YellowDogsLeagueService.prototype);service.state=tracked;
  const summary=service.matchSummary(tracked.matches[0]);
  assert.equal(summary.hasDetails,true);assert.equal(summary.hasTacticalReview,true);assert.equal(summary.hasDotReplay,true);
  assert.equal(reader.coldCache.reads,0);
  tracked.archives.push({archiveKey:'next',matches:tracked.matches,seasonFinalTournament:tracked.seasonFinalTournament});
  assert.equal(reader.coldCache.reads,0);assert.equal(dirty.has('archives'),true);
  assert.deepEqual(matchReportMetadata(tracked.seasonFinalTournament.matches[0]).engineVersion,'3.0.0');
  assert.equal(reader.coldCache.reads,0);
});

test('nested deferred-report edits and array changes persist without changing another view',t=>{
  const {root,store,state,report}=fixture(t);store.save(state,{forceFull:true});
  const reader=new LeagueShardStore(root,{backupDir:null}),loaded=reader.load(),dirty=new Set(),tracked=createTrackedState(loaded,s=>dirty.add(s));
  const other=reader.loadManifest(reader.manifest),view=tracked.matches[0].report;
  view.events.push({minute:5,type:'save'});view.events.splice(0,1);view.score[0]=3;delete view.tacticalReview.one;
  view.tacticalReview.new={value:1};view.tacticalReview.new.value=2;
  assert.equal(dirty.has('matches'),true);
  assert.deepEqual(unwrapTracked(other.matches[0].report),report);
  assert.doesNotThrow(()=>structuredClone(unwrapTracked(tracked.matches[0])));
  reader.save(tracked,{scopes:[...dirty]});
  const reloaded=new LeagueShardStore(root,{backupDir:null}).load().matches[0].report;
  assert.deepEqual(unwrapTracked(reloaded.events),[{minute:5,type:'save'}]);assert.equal(reloaded.score[0],3);
  assert.deepEqual(unwrapTracked(reloaded.tacticalReview),{new:{value:2}});
});

test('owner/map fast paths serialize only changed buckets, including nested edits and transfers',t=>{
  const {root,store,state}=fixture(t),tracked=createTrackedState(state,()=>{});store.save(tracked,{forceFull:true});
  const writes=[],original=store.writeRevisionJson.bind(store);
  store.writeRevisionJson=(...args)=>{writes.push(args[1]);return original(...args);};
  tracked.s4Assets.cards.a.traits.level++;tracked.s4Packs.inventory.one.push({id:'new'});tracked.inbox.one[0].read=true;
  store.save(tracked,{scopes:['assets','packs','inbox']});
  assert.equal(writes.filter(f=>f.startsWith('cards/')).length,1);assert.equal(writes.filter(f=>f.startsWith('packs/')).length,1);assert.equal(writes.filter(f=>f.startsWith('inbox/')).length,1);
  writes.length=0;tracked.s4Assets.cards.a.ownerId='two';store.save(tracked,{scopes:['assets']});
  assert.equal(store.manifest.shards.assets.cards.one,undefined);assert.equal(writes.filter(f=>f.startsWith('cards/')).length,1);
  tracked.s4Packs.inventory.two=[{id:'replacement'}];delete tracked.inbox.two;store.save(tracked,{scopes:['packs','inbox']});
  const loaded=new LeagueShardStore(root,{backupDir:null}).load();
  assert.equal(loaded.s4Assets.cards.a.traits.level,2);assert.equal(loaded.s4Assets.cards.a.ownerId,'two');
  assert.deepEqual(loaded.s4Packs.inventory.two,[{id:'replacement'}]);assert.equal(loaded.inbox.two,undefined);
  // Untracked callers must retain the comparison fallback.
  loaded.s4Assets.cards.a.traits.level=4;store.save(loaded,{scopes:['assets']});
  assert.equal(new LeagueShardStore(root,{backupDir:null}).load().s4Assets.cards.a.traits.level,4);
});

test('LRU bounds decoded bytes and entries; oversized records and corrupt gzip are handled explicitly',t=>{
  const {dir}=fixture(t),cache=new ColdJsonCache({maxBytes:100,maxEntries:2});
  for(let i=0;i<4;i++){const file=path.join(dir,`${i}.json.gz`);fs.writeFileSync(file,compressColdJson(JSON.stringify({id:i,data:'x'.repeat(25)})));cache.read(file);}
  assert.ok(cache.bytes<=100);assert.ok(cache.entries.size<=2);
  const huge=path.join(dir,'huge.json.gz');fs.writeFileSync(huge,compressColdJson(JSON.stringify({data:'x'.repeat(200)})));cache.read(huge);
  assert.equal(cache.entries.has(huge),false);assert.ok(cache.bytes<=100);
  const file=path.join(dir,'3.json.gz');const hits=cache.hits;cache.read(file);assert.equal(cache.hits,hits+1);
  fs.writeFileSync(file,'broken gzip');assert.throws(()=>cache.read(file));
});

test('failed writes restore log cursors and bucket caches; retry does not lose transactions',t=>{
  const {root,store,state}=fixture(t),tracked=createTrackedState(state,()=>{});store.save(tracked,{forceFull:true});
  tracked.ledger.push({id:'money',amount:7});tracked.s4Assets.transactions.push({id:'card-tx'});tracked.s4Assets.cards.a.traits.level=9;
  const previous=store.manifest,original=store.writePacks;store.writePacks=()=>{throw new Error('injected disk failure');};
  assert.throws(()=>store.save(tracked),/injected disk failure/);assert.equal(store.manifest,previous);
  store.writePacks=original;store.save(tracked);
  const loaded=new LeagueShardStore(root,{backupDir:null}).load();
  assert.deepEqual(loaded.ledger,[{id:'money',amount:7}]);assert.deepEqual(loaded.s4Assets.transactions,[{id:'card-tx'}]);assert.equal(loaded.s4Assets.cards.a.traits.level,9);
});

test('v1 reads, migration rollback and repeated compaction protect both report families',t=>{
  const {root,store,state,report}=fixture(t);store.save(state,{forceFull:true});
  // Construct a genuine old-format head with plain reports, an inline final and a plain archive.
  const manifest=structuredClone(store.manifest),index=read(root,manifest.shards.matches),core=read(root,manifest.shards.core);
  const plain='revisions/1/legacy-report.json';fs.writeFileSync(path.join(root,plain),JSON.stringify(report));
  index.entries[0].reportPath=plain;delete index.entries[0].reportMeta;fs.writeFileSync(path.join(root,manifest.shards.matches),JSON.stringify(index));
  core.seasonFinalTournament=unwrapTracked(state.seasonFinalTournament);fs.writeFileSync(path.join(root,manifest.shards.core),JSON.stringify(core));
  const archivePlain='revisions/1/legacy-archive.json';fs.writeFileSync(path.join(root,archivePlain),JSON.stringify(store.readFullArchive(state.archives[0])));
  manifest.shards.archives.entries[0].path=archivePlain;fs.writeFileSync(path.join(root,manifest.shards.archives.index),JSON.stringify({entries:manifest.shards.archives.entries}));
  delete manifest.shards.seasonFinal;manifest.schemaVersion=1;fs.writeFileSync(store.manifestPath,JSON.stringify(manifest));
  const reader=new LeagueShardStore(root),loaded=reader.load();assert.equal(reader.coldCache.reads,0);assert.equal(loaded.seasonFinalTournament.matches[0].report.score[1],1);
  assert.equal(optimizeLeagueStorage(root,{apply:true,offline:true,expectedRevision:1}).verified,true);reader.load();assert.equal(reader.manifest.schemaVersion,2);
  const backups=fs.readdirSync(reader.backupDir);assert.equal(backups.some(n=>n.startsWith('before-storage-v2-')),true);
  const rollback=JSON.parse(fs.readFileSync(path.join(reader.backupDir,backups[0])));assert.equal(rollback.schemaVersion,1);
  assert.deepEqual(unwrapTracked(reader.loadManifest(rollback).matches[0].report),report);collectShardReferences(root,rollback);
  // loadManifest is intentionally side-effectful for reference maps, so reload the current head.
  reader.load();assert.match(reader.manifest.shards.archives.entries[0].path,/\.gz$/);
  for(let i=0;i<2;i++){
    const result=spawnSync(process.execPath,['devtool/compact-league-shards.js','compact',root,'--apply'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const compacted=new LeagueShardStore(root),current=compacted.load();
    assert.deepEqual(unwrapTracked(current.matches[0].report),report);assert.deepEqual(unwrapTracked(current.seasonFinalTournament.matches[0].report.score),[0,1]);
    collectShardReferences(root,compacted.manifest);
  }
});

test('explicit core save also persists a dirty final, and a cleared tournament stays cleared',t=>{
  const {root}=fixture(t);const service=new YellowDogsLeagueService({statePath:root,backupDir:null,now:()=>Date.parse('2026-08-12T12:00:00Z'),rng:()=>.37});
  service.state.seasonFinalTournament={status:'pending',matches:[]};service.save({scopes:['core'],skipDailyBackup:true});
  assert.equal(new LeagueShardStore(root,{backupDir:null}).load().seasonFinalTournament.status,'pending');
  service.state.seasonFinalTournament=null;service.save({scopes:['core'],skipDailyBackup:true});
  assert.equal(new LeagueShardStore(root,{backupDir:null}).load().seasonFinalTournament,null);
});

test('offline migration is read-only by default and verifies complete data before reporting success',t=>{
  const {root,store,state}=fixture(t);store.save(state,{forceFull:true});
  const before=fs.readFileSync(store.manifestPath,'utf8');
  assert.equal(optimizeLeagueStorage(root).status,'dry-run');assert.equal(fs.readFileSync(store.manifestPath,'utf8'),before);
  assert.throws(()=>optimizeLeagueStorage(root,{apply:true,expectedRevision:1}),/offline/);
  assert.throws(()=>optimizeLeagueStorage(root,{apply:true,offline:true,expectedRevision:9}),/expected-revision/);
  const result=optimizeLeagueStorage(root,{apply:true,offline:true,expectedRevision:1});
  assert.equal(result.verified,true);assert.equal(result.schemaVersion,2);assert.ok(fs.existsSync(result.rollback));
  assert.equal(fs.existsSync(path.join(root,'.storage-maintenance.lock')),false);
});

test('an orphan from an interrupted manifest commit does not prevent a successful retry',t=>{
  const {root,store,state}=fixture(t);store.save(state,{forceFull:true});
  state.ledger.push({id:'pending'});const original=store.finalizeRevisionRefs;
  store.finalizeRevisionRefs=()=>{throw new Error('interrupted before manifest commit');};
  assert.throws(()=>store.save(state),/interrupted/);assert.equal(store.manifest.revision,1);
  store.finalizeRevisionRefs=original;store.save(state);
  assert.equal(store.manifest.revision,3);assert.deepEqual(new LeagueShardStore(root,{backupDir:null}).load().ledger,[{id:'pending'}]);
});

test('a missing committed final index triggers manifest-backup recovery rather than an empty tournament',t=>{
  const {root,store,state}=fixture(t);store.save(state,{forceFull:true});
  store.backupDir=path.join(root,'backups');store.backupSnapshot(path.join(store.backupDir,'known-good.manifest.json'));
  const expected=store.manifest.revision;state.seasonFinalTournament=null;store.save(state,{scopes:['seasonFinal']});
  fs.unlinkSync(path.join(root,store.manifest.shards.seasonFinal));
  const reader=new LeagueShardStore(root,{backupDir:store.backupDir}),loaded=reader.load();
  assert.equal(reader.manifest.revision,expected);assert.equal(loaded.seasonFinalTournament.status,'completed');
});
