import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openLocalReplayRetention} from '../versus/v4-host/local-replay-retention.js';
import {retentionFixture} from './v4-replay-retention-fixture.js';

const policy={maxBytes:0,minAgeMs:0,maxAgeMs:1,keepLatest:0};
test('local cleanup protects pins, producer and viewer leases; removes only payloads and preserves exactly-once settlement',async()=>{
  const f=await retentionFixture(),ids=f.round.tasks.map(task=>task.fixture.id),before=await f.readLeague();
  const options={root:f.root,readLeague:f.readLeague,now:f.now,policy,pinnedMatchIds:[ids[0]]},manager=await openLocalReplayRetention(options);
  try{
    await assert.rejects(openLocalReplayRetention(options),/锁已占用/);
    const release=manager.lifecycle.acquire(ids[1]);await fs.writeFile(path.join(f.jobs[2],'producer.lock'),'protected');
    const plan=await manager.plan();assert.equal(plan.expire.length,5);assert.equal(plan.budgetSatisfied,false);
    const result=await manager.sweep();assert.equal(result.expired.length,5);assert.ok(result.removedBytes>0);
    for(const [index,job] of f.jobs.entries()){
      const files=await fs.readdir(path.join(job,'archive'));assert.ok(files.includes('manifest.json'));
      assert.equal(files.some(name=>name.endsWith('.gz')),index<3);
      assert.equal((await f.bridge.settleJob(job,f.round.tasks[index].context)).duplicate,true);
    }
    assert.deepEqual(await f.readLeague(),before);
    release();f.advance(90001);await fs.unlink(path.join(f.jobs[2],'producer.lock'));
    assert.equal((await manager.sweep()).expired.length,2);assert.equal((await manager.sweep()).removedBytes,0);
  }finally{await manager.close();}
  const reopened=await openLocalReplayRetention(options);
  try{assert.throws(()=>reopened.lifecycle.acquire(ids[3]),error=>error.code==='V4_REPLAY_EXPIRED');assert.equal((await reopened.plan()).expire.length,0);assert.deepEqual(await f.readLeague(),before);}finally{await reopened.close();}
});

test('corrupt payload is retained after a durable tombstone; repaired bytes permit restart cleanup, not replay resurrection',async()=>{
  const f=await retentionFixture(),id=f.round.tasks[0].fixture.id,folder=path.join(f.jobs[0],'archive'),file=path.join(folder,'000000-public.json.gz'),bytes=await fs.readFile(file);
  const options={root:f.root,readLeague:f.readLeague,now:f.now,policy,pinnedMatchIds:f.round.tasks.slice(1).map(task=>task.fixture.id)};
  await fs.appendFile(file,'corrupt');const manager=await openLocalReplayRetention(options);
  try{await assert.rejects(manager.sweep(),/校验失败/);assert.ok((await fs.stat(file)).size>bytes.length);assert.throws(()=>manager.lifecycle.acquire(id),error=>error.code==='V4_REPLAY_EXPIRED');}finally{await manager.close();}
  await fs.writeFile(file,bytes);const reopened=await openLocalReplayRetention(options);
  try{assert.deepEqual((await reopened.plan()).pendingCleanup,[id]);assert.ok((await reopened.sweep()).removedBytes>0);assert.deepEqual((await reopened.plan()).pendingCleanup,[]);assert.equal((await f.bridge.settleJob(f.jobs[0],f.round.tasks[0].context)).duplicate,true);}finally{await reopened.close();}
});

test('cleanup refreshes settlement eligibility, leaves unlisted files alone and refuses a redirected job path',async()=>{
  const f=await retentionFixture(),id=f.round.tasks[0].fixture.id,folder=path.join(f.jobs[0],'archive'),state=await f.readLeague(),original=structuredClone(state);
  const options={root:f.root,readLeague:async()=>state,now:f.now,policy,pinnedMatchIds:f.round.tasks.slice(1).map(task=>task.fixture.id)},manager=await openLocalReplayRetention(options);
  try{
    assert.equal((await manager.plan()).expire.length,1);state.v4LocalSettlements.receipts[id].inputFingerprint='0'.repeat(64);
    assert.deepEqual((await manager.sweep()).expired,[]);assert.ok((await fs.stat(path.join(folder,'000000-public.json.gz'))).size>0);
    state.v4LocalSettlements.receipts[id]=original.v4LocalSettlements.receipts[id];await fs.writeFile(path.join(folder,'operator-note.txt'),'keep');
    assert.deepEqual((await manager.sweep()).expired,[id]);assert.equal(await fs.readFile(path.join(folder,'operator-note.txt'),'utf8'),'keep');
  }finally{await manager.close();}
  const redirected=path.join(f.root,'redirected'),destination=path.join(redirected,'league-queue-'+f.round.key,'jobs');await fs.mkdir(destination,{recursive:true});
  await fs.writeFile(path.join(redirected,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));await fs.symlink(f.jobs[1],path.join(destination,f.round.tasks[1].fixture.id),'junction');
  await assert.rejects(openLocalReplayRetention({...options,root:redirected}),/路径不是普通/);assert.ok((await fs.stat(path.join(f.jobs[1],'archive/000000-public.json.gz'))).size>0);
});
