import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceCommittedFile} from '../versus/v4-stream/atomic-file.js';

test('transient sharing violations retry the same atomic replacement without removing the committed file',async()=>{
  const calls=[],delays=[];
  await replaceCommittedFile('pending','committed',{rename:async(...args)=>{calls.push(args);if(calls.length<3)throw Object.assign(new Error('reader open'),{code:'EPERM'});},wait:async ms=>delays.push(ms)});
  assert.deepEqual(calls,Array(3).fill(['pending','committed']));assert.deepEqual(delays,[5,10]);
});
test('persistent and unrelated filesystem failures remain visible with bounded retries',async()=>{
  for(const [code,expected] of [['EPERM',9],['ENOSPC',1]]){
    let calls=0;await assert.rejects(replaceCommittedFile('pending','committed',{rename:async()=>{calls++;throw Object.assign(new Error(code),{code});},wait:async()=>{}}),{code});assert.equal(calls,expected);
  }
});

test('archive replacement may tolerate a longer bounded sharing lock without retrying disk-full errors',async()=>{
  let attempts=0;
  await replaceCommittedFile('pending','committed',{maxRetries:32,rename:async()=>{if(++attempts<=12)throw Object.assign(new Error('reader open'),{code:'EPERM'});},wait:async()=>{}});
  assert.equal(attempts,13);
  await assert.rejects(replaceCommittedFile('pending','committed',{maxRetries:Infinity}),/重试上限/);
});
