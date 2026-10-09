import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeSample,observeRuntime} from '../server/infrastructure/runtime-observer.mjs';
test('runtime diagnostics contain aggregate counters, not account records or tokens',()=>{
 const c={accounts:new Map([['private-id',{token:'private-token',airportRequests:{one:{}},elite:{requests:{two:{}}}}]]),world:{diplomacy:{receipts:{r:{}},matches:{m:{leg:{}}}}},repository:{lastSave:{bytes:123,durationMs:4}}};
 const sample=runtimeSample(c,{rss:100,heapUsed:50,external:2,arrayBuffers:1});
 assert.equal(sample.accounts,1);assert.equal(sample.receipts.airportRequests,1);assert.equal(sample.receipts.elite,1);assert.equal(sample.activeMatches,1);assert.equal(sample.save.bytes,123);
 assert.doesNotMatch(JSON.stringify(sample),/private-id|private-token/);
});
test('maintenance persistence failure is logged and does not stop runtime sampling',()=>{
 const messages=[],c={accounts:new Map([['a',{airportRequests:{legacy:{}}}]]),world:{},now:()=>1800000000000,persist(){throw Error('test disk failure');}};
 const observer=observeRuntime(c,{intervalMs:60000,log:(...args)=>messages.push(args),warn:(...args)=>messages.push(args)});
 try{observer.tick();assert.ok(messages.some(x=>x[0]==='[campaign-maintenance]'));assert.ok(messages.some(x=>x[0]==='[campaign-runtime]'||x[0]==='[campaign-memory-warning]'));assert.equal(c.accounts.get('a').airportRequests.legacy.recordedAt,undefined);}finally{observer.stop();}
});
