import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openLocalReplayRetention} from '../versus/v4-host/local-replay-retention.js';
import {recoverDispatchLock} from '../versus/v4-host/dispatch-store.js';
import {readCompletedShadowJob} from '../versus/v4-host/shadow-settlement.js';
import {retentionFixture} from './v4-replay-retention-fixture.js';

test('killing cleanup before or after its first unlink preserves the tombstone and recovers without losing settlement evidence',async()=>{
  const f=await retentionFixture(),state=await f.readLeague(),id=f.round.tasks[0].fixture.id;
  for(const point of ['before','after']){
    const root=path.join(f.root,'crash-'+point),job=path.join(root,'league-queue-'+f.round.key,'jobs',id);await fs.mkdir(path.dirname(job),{recursive:true});await fs.cp(f.jobs[0],job,{recursive:true});
    await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));await fs.writeFile(path.join(root,'state.json'),JSON.stringify(state));
    const options={root,policy:{maxBytes:0,minAgeMs:0,maxAgeMs:1,keepLatest:0}},readLeague=async()=>JSON.parse(await fs.readFile(path.join(root,'state.json'),'utf8'));
    const moduleUrl=new URL('../versus/v4-host/local-replay-retention.js',import.meta.url).href;
    const script=`import fs from 'node:fs/promises';import path from 'node:path';import {openLocalReplayRetention} from ${JSON.stringify(moduleUrl)};const options=JSON.parse(process.env.V4_RETENTION_OPTIONS),unlink=fs.unlink.bind(fs);let stopped=false;fs.unlink=async file=>{if(!stopped&&String(file).endsWith('.gz')){stopped=true;if(process.env.V4_RETENTION_STOP==='after')await unlink(file);process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);return;}return unlink(file);};const manager=await openLocalReplayRetention({...options,readLeague:async()=>JSON.parse(await fs.readFile(path.join(options.root,'state.json'),'utf8')),now:()=>Number(process.env.V4_RETENTION_NOW)});await manager.sweep();await manager.close();`;
    const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,env:{...process.env,V4_RETENTION_OPTIONS:JSON.stringify(options),V4_RETENTION_STOP:point,V4_RETENTION_NOW:String(f.now())},stdio:['ignore','ignore','pipe','ipc']}),exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
    try{
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('cleanup child timeout '+stderr)),10000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('cleanup exited '+stderr));});});
      assert.equal(JSON.parse(await fs.readFile(path.join(job,'archive/retired.json'),'utf8')).cleaned,false);
      await assert.rejects(openLocalReplayRetention({...options,readLeague,now:f.now}),/锁已占用/);await assert.rejects(recoverDispatchLock(path.join(root,'replay-retention.lock')),/仍在运行/);
      child.kill();await exited;await recoverDispatchLock(path.join(root,'replay-retention.lock'));
      const manager=await openLocalReplayRetention({...options,readLeague,now:f.now});
      try{assert.throws(()=>manager.lifecycle.acquire(id),error=>error.code==='V4_REPLAY_EXPIRED');assert.deepEqual((await manager.plan()).pendingCleanup,[id]);assert.ok((await manager.sweep()).removedBytes>0);assert.deepEqual((await manager.plan()).pendingCleanup,[]);}finally{await manager.close();}
      assert.ok(!(await fs.readdir(path.join(job,'archive'))).some(name=>name.endsWith('.gz')));assert.equal((await readCompletedShadowJob(job)).pinned.fixtureId,id);assert.deepEqual(await readLeague(),state);
    }finally{if(child.exitCode===null)child.kill();await exited;}
  }
});
