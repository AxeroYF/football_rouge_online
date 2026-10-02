import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptivePoller} from '../client/core/adaptive-poller.js';
function fixture(run=async()=>true,isBusy=()=>false){
 let time=0,job,ms;const doc=new EventTarget();doc.hidden=false;
 const poll=createAdaptivePoller({run,isBusy,document:doc,now:()=>time,schedule:(fn,delay)=>{job=fn;ms=delay;return 1;},cancel:()=>{job=null;}});
 return {poll,doc,get delay(){return job?ms:null;},time:t=>time=t,async tick(){const fn=job;job=null;await fn();}};
}
test('idle backs off, interaction wakes, hidden pauses and visibility refreshes',async()=>{
 const f=fixture();assert.equal(f.delay,5000);f.time(60000);await f.tick();assert.equal(f.delay,15000);
 f.doc.dispatchEvent(new Event('pointerdown'));assert.equal(f.delay,250);await f.tick();assert.equal(f.delay,5000);
 f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.delay,null);
 f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.delay,250);
 f.poll.stop();assert.equal(f.delay,null);f.poll.refresh();assert.equal(f.delay,null);
});
test('failures back off and successful retry restores cadence; active movement stays fast',async()=>{
 let ok=false;const f=fixture(async()=>ok);await f.tick();assert.equal(f.delay,10000);await f.tick();assert.equal(f.delay,20000);await f.tick();assert.equal(f.delay,30000);ok=true;await f.tick();assert.equal(f.delay,5000);
 const busy=fixture(async()=>true,()=>true);busy.time(120000);await busy.tick();assert.equal(busy.delay,5000);f.poll.stop();busy.poll.stop();
});
test('mutation during in-flight request queues one refresh without overlap',async()=>{
 let resolve,calls=0;const f=fixture(()=>{calls++;return new Promise(r=>resolve=r);});const work=f.tick();f.poll.refresh();f.poll.refresh();assert.equal(calls,1);resolve(true);await work;assert.equal(f.delay,250);f.poll.stop();
});
