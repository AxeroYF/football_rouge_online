import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createArchive,openArchive} from '../versus/v4-stream/archive.js';
import {createViewer} from '../versus/v4-stream/publisher.js';
import {publicFrame,publicEvent} from '../versus/v4-stream/codec.js';
import {createMatch,advanceMatch,simulateMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {VERSION,snapshot} from '../versus/v4/world.js';
import {producePinnedArchive} from '../versus/v4-stream/producer.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';

const identity={matchId:'archive-proof',engineVersion:VERSION,inputFingerprint:'test-fixture'};
test('a sub-ulp boundary inversion retains the complete injury/substitution event prefix for the next chunk',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-event-prefix-')),directory=path.join(root,'match');
  const match=createMatch(demoInput({duration:30}),{frameInterval:1}),writer=await createArchive(directory,identity);
  advanceMatch(match,50);const time=match.state.time,firstId=match.state.nextEventId;
  for(const [index,type] of ['injury','substitution','playerEffectsChanged'].entries())match.events.push({id:match.state.nextEventId++,time:index<2?time+Number.EPSILON*time:time,tick:match.state.tick,type,side:0});
  match.frames.push(snapshot(match.state));await writer.appendMatch(match);
  assert.deepEqual(match.events.map(e=>e.id),[firstId,firstId+1,firstId+2]);
  const reader=await openArchive(directory),viewer=createViewer({...identity,ownerSide:0});reader.publishUntil(time);viewer.accept(await reader.read(0,0));
  assert.ok(viewer.cursor.event<firstId);
  advanceMatch(match,50);await writer.appendMatch(match);await reader.refresh();reader.publishUntil(reader.producedThrough);viewer.accept(await reader.read(1,0));
  assert.deepEqual(viewer.events.filter(e=>e.id>=firstId&&e.id<=firstId+2).map(e=>e.id),[firstId,firstId+1,firstId+2]);
  assert.equal(match.events.some(e=>e.id<=firstId+2),false);
});
test('bounded recorder drains only committed data; disk replay equals original recording and simulation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-archive-')),directory=path.join(root,'match');
  const input=demoInput({duration:90,seed:'archive-proof'}),full=simulateMatch(input,{frameInterval:1}),m=createMatch(input,{frameInterval:1});
  const writer=await createArchive(directory,identity);let highWater=0;
  while(m.state.phase!=='finished'){advanceMatch(m,50);highWater=Math.max(highWater,m.frames.length);await writer.appendMatch(m);assert.equal(m.frames.length,1);}
  assert.deepEqual(m.state,full.state);assert.ok(highWater<200);assert.equal(m.events.length,0);
  const archive=await openArchive(directory,{cacheBytes:10000});assert.equal(await archive.read(0),null);
  archive.publishUntil(90);
  for(const ownerSide of [null,0,1]){
    const viewer=createViewer({...identity,ownerSide});
    for(let i=0;i<archive.manifest.segments.length;i++)viewer.accept(await archive.read(i,ownerSide));
    assert.deepEqual(viewer.frames,full.frames.map(f=>publicFrame(f,ownerSide)));
    assert.deepEqual(viewer.events,full.events.map(e=>publicEvent(e,ownerSide)).filter(Boolean));assert.equal(viewer.complete,true);
  }
  assert.ok(archive.cachedBytes<=10000);await assert.rejects(createArchive(directory,identity));
  assert.throws(()=>archive.publishUntil(89));await assert.rejects(archive.read('../manifest',null));
  await assert.rejects(writer.appendMatch(m));
});

test('growing archive keeps publication separate, restores after reopen, and detects corrupted segments',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-archive-')),directory=path.join(root,'match');
  const m=createMatch(demoInput({duration:30}),{frameInterval:1}),writer=await createArchive(directory,identity);
  advanceMatch(m,50);await writer.appendMatch(m);const reader=await openArchive(directory,{cacheBytes:0});reader.publishUntil(reader.manifest.segments.at(-1).through);
  const first=await reader.read(0,0);assert.ok(first);assert.equal(await reader.read(1,0),null);
  advanceMatch(m,50);await writer.appendMatch(m);assert.equal(await reader.refresh({snapshot:false}),undefined);assert.equal(await reader.read(1,0),null);
  const head=reader.publishedHead();assert.deepEqual(head.segments,[{index:0,through:first.through}]);assert.equal(head.complete,false);
  assert.equal(head.inputFingerprint,undefined);assert.equal(head.sourceDigest,undefined);assert.equal(head.segments[0].files,undefined);
  head.segments[0].through=999;head.teams.push({id:'forged',name:'forged'});
  assert.equal(reader.publishedHead().segments[0].through,first.through);assert.equal(reader.publishedHead().teams.length,0);
  assert.equal(reader.producedThrough,writer.manifest.segments.at(-1).through);
  reader.publishUntil(reader.manifest.segments.at(-1).through);const next=await reader.read(1,0);assert.deepEqual(next.from,first.to);
  const reopened=await openArchive(directory,{cacheBytes:0});assert.equal(await reopened.read(0),null);reopened.publishUntil(reader.publishedThrough);
  assert.deepEqual(await reopened.read(1,0),next);
  await fs.appendFile(path.join(directory,'000001-owner0.json.gz'),'corrupt');await assert.rejects(reopened.read(1,0),/校验/);
});

test('a stopped producer replays its pinned input, verifies the committed prefix and reuses identical crash leftovers',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-recover-')),baseline=path.join(root,'baseline'),interrupted=path.join(root,'interrupted');
  const bundleDirectory=path.join(root,'engine'),bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])});
  const input=demoInput({duration:30,seed:'archive-recovery'}),options={matchId:'recover',sourceDigest:bundle.sourceDigest,bundleDirectory,engineVersion:VERSION};
  const expected=await producePinnedArchive(input,baseline,options);
  await assert.rejects(producePinnedArchive(input,interrupted,{...options,onCommitted:()=>{throw new Error('stopped after commit');}}),/stopped after commit/);
  const committed=await fs.readFile(path.join(interrupted,'manifest.json'),'utf8');
  const manifest=JSON.parse(await fs.readFile(path.join(baseline,'manifest.json'),'utf8'));
  for(const suffix of ['public','owner0','owner1'])await fs.copyFile(path.join(baseline,`000001-${suffix}.json.gz`),path.join(interrupted,`000001-${suffix}.json.gz`));
  await fs.writeFile(path.join(interrupted,'manifest.json.pending'),JSON.stringify({...manifest,segments:manifest.segments.slice(0,2),complete:false}));
  await assert.rejects(producePinnedArchive(input,interrupted,{...options,sourceDigest:'b'.repeat(64),replayExisting:true}),/锁定引擎包/);
  await assert.rejects(producePinnedArchive({...input,seed:'other'},interrupted,{...options,replayExisting:true}),/锁定比赛/);
  assert.equal(await fs.readFile(path.join(interrupted,'manifest.json'),'utf8'),committed);
  const recovered=await producePinnedArchive(input,interrupted,{...options,replayExisting:true});assert.deepEqual(recovered.state,expected.state);
  assert.equal(await fs.readFile(path.join(interrupted,'manifest.json'),'utf8'),await fs.readFile(path.join(baseline,'manifest.json'),'utf8'));
  const reader=await openArchive(interrupted);assert.equal(await reader.read(0),null);
  reader.publishUntil(30);assert.equal((await reader.read(manifest.segments.length-1)).complete,true);
  await fs.appendFile(path.join(interrupted,'000000-public.json.gz'),'corrupt');
  await assert.rejects(producePinnedArchive(input,interrupted,{...options,replayExisting:true}),/已提交归档内容/);
});

test('pinned recovery finishes partial uncommitted bytes but refuses a conflicting or committed prefix',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-partial-')),baseline=path.join(root,'baseline'),bundleDirectory=path.join(root,'engine');
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])});
  const input=demoInput({duration:30,seed:'partial-writes'}),options={matchId:'partial',sourceDigest:bundle.sourceDigest,bundleDirectory,engineVersion:VERSION};
  const expected=await producePinnedArchive(input,baseline,options),full=JSON.parse(await fs.readFile(path.join(baseline,'manifest.json'),'utf8'));
  for(const kind of ['empty','partial','conflicting']){
    const directory=path.join(root,kind);
    await assert.rejects(producePinnedArchive(input,directory,{...options,onCommitted:()=>{throw new Error('interrupt');}}),/interrupt/);
    const committed=await fs.readFile(path.join(directory,'manifest.json'));
    for(const suffix of ['public','owner0','owner1']){
      const name=`000001-${suffix}.json.gz`,data=await fs.readFile(path.join(baseline,name));
      await fs.writeFile(path.join(directory,name),kind==='empty'?Buffer.alloc(0):data.subarray(0,Math.floor(data.length/2)));
    }
    const pending=Buffer.from(JSON.stringify({...full,segments:full.segments.slice(0,2),complete:false}));
    await fs.writeFile(path.join(directory,'manifest.json.pending'),kind==='empty'?Buffer.alloc(0):kind==='conflicting'?Buffer.from('wrong'):pending.subarray(0,143));
    if(kind==='conflicting'){
      await assert.rejects(producePinnedArchive(input,directory,{...options,replayExisting:true}),/未提交文件与锁定重演不一致/);
      assert.deepEqual(await fs.readFile(path.join(directory,'manifest.json')),committed);
    }else{
      const recovered=await producePinnedArchive(input,directory,{...options,replayExisting:true});assert.deepEqual(recovered.state,expected.state);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')),full);
      await fs.truncate(path.join(directory,'000000-public.json.gz'),10);
      await assert.rejects(producePinnedArchive(input,directory,{...options,replayExisting:true}),/已提交归档内容/);
    }
  }
});

test('concurrent refresh requests share a queued read, while a post-commit caller still receives the newer manifest',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-refresh-')),directory=path.join(root,'match');
  const match=createMatch(demoInput({duration:30}),{frameInterval:1}),writer=await createArchive(directory,identity);
  advanceMatch(match,50);await writer.appendMatch(match);const reader=await openArchive(directory),file=path.join(directory,'manifest.json');
  const readFile=fs.readFile.bind(fs);let count=0,enteredResolve,releaseResolve;
  const entered=new Promise(resolve=>enteredResolve=resolve),release=new Promise(resolve=>releaseResolve=resolve);
  t.mock.method(fs,'readFile',async(...args)=>{const bytes=await readFile(...args);if(args[0]===file){count++;if(count===1){enteredResolve();await release;}}return bytes;});
  const first=reader.refresh();
  try{
    await entered;advanceMatch(match,50);await writer.appendMatch(match);
    const later=Array.from({length:20},()=>reader.refresh());releaseResolve();
    assert.equal((await first).segments.length,1);
    const snapshots=await Promise.all(later);assert.ok(snapshots.every(s=>s.segments.length===2));assert.equal(count,2);
    reader.publishUntil(writer.manifest.segments.at(-1).through);assert.ok(await reader.read(1));
  }finally{releaseResolve();await first;}
});

test('unchanged manifest bytes reuse validation while same-size history changes still fail closed',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-manifest-bytes-')),directory=path.join(root,'match');
  const match=createMatch(demoInput({duration:30}),{frameInterval:1}),writer=await createArchive(directory,identity);
  advanceMatch(match,50);await writer.appendMatch(match);const reader=await openArchive(directory),file=path.join(directory,'manifest.json'),original=await fs.readFile(file,'utf8');
  const parse=JSON.parse.bind(JSON);let parses=0;t.mock.method(JSON,'parse',(...args)=>{if(String(args[0]).includes('yffm-v4-archive-1'))parses++;return parse(...args);});
  const first=await reader.refresh();first.segments[0].through=-999;
  await reader.refresh({snapshot:false});assert.equal(parses,0);assert.notEqual(reader.manifest.segments[0].through,-999);
  const changed=parse(original);changed.segments[0].files[0].sha256=(changed.segments[0].files[0].sha256[0]==='a'?'b':'a')+changed.segments[0].files[0].sha256.slice(1);
  const altered=JSON.stringify(changed);assert.equal(altered.length,original.length);await fs.writeFile(file,altered);
  await assert.rejects(reader.refresh(),/历史被修改/);assert.equal(parses,1);
  await fs.writeFile(file,original);await reader.refresh();assert.equal(parses,1);
  advanceMatch(match,50);await writer.appendMatch(match);assert.equal((await reader.refresh()).segments.length,2);assert.equal(parses,2);
});
