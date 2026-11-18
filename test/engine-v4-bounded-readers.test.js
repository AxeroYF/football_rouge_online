import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoundedReplayReaders} from '../versus/v4-host/bounded-replay-readers.js';

test('historical-reader LRU cannot evict an in-flight read, shares opening and remains bounded across revisits',async()=>{
  const pool=createBoundedReplayReaders({limit:2});let opens=0,unblock;
  const open=()=>{opens++;return new Promise(resolve=>{unblock=resolve;});},a=pool.acquire('a',open),a2=pool.acquire('a',open);
  const first=pool.get('a'),second=pool.get('a');await Promise.resolve();assert.equal(opens,1);unblock({cachedBytes:10});assert.equal(await first,await second);
  const b=pool.acquire('b',async()=>({cachedBytes:20}));await pool.get('b');assert.throws(()=>pool.acquire('c',async()=>({})),/繁忙/);assert.throws(()=>pool.close(),/进行/);
  a();a();assert.equal(pool.stats.active,2);a2();const c=pool.acquire('c',async()=>({cachedBytes:30}));await pool.get('c');assert.equal(pool.peek('a'),null);assert.equal(pool.stats.cachedBytes,50);
  b();c();for(let i=0;i<100;i++){const release=pool.acquire('history-'+i,async()=>({cachedBytes:1}));await pool.get('history-'+i);release();assert.equal(pool.stats.entries,2);}
  pool.close();assert.equal(pool.stats.entries,0);assert.throws(()=>pool.acquire('x',open),/关闭/);
});

test('a missing or failed opening can be retried without leaking reader slots',async()=>{
  const pool=createBoundedReplayReaders({limit:1});let attempt=0;
  const release=pool.acquire('growing',async()=>{attempt++;if(attempt===1)throw new Error('disk');return attempt===2?null:{cachedBytes:5};});
  await assert.rejects(pool.get('growing'),/disk/);assert.equal(await pool.get('growing'),null);assert.equal((await pool.get('growing')).cachedBytes,5);release();pool.close();
});
