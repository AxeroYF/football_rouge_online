import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createQueuedJsonWriter} from '../versus/infrastructure/queued-json-writer.js';
test('queued writes capture command snapshots and keep a valid previous backup',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'yffm1-writes-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const target=path.join(root,'state.json'),backup=path.join(root,'previous.json');
  const writer=createQueuedJsonWriter(target,backup);
  const state={revision:0};const pending=[];
  for(let n=0;n<20;n++){state.revision=n;pending.push(writer.write(state));}
  await Promise.all(pending);await writer.flush();
  assert.deepEqual(JSON.parse(await readFile(target,'utf8')),{revision:19});
  assert.deepEqual(JSON.parse(await readFile(backup,'utf8')),{revision:18});
  assert.equal((await readdir(root)).some(f=>f.endsWith('.tmp')),false);
});
