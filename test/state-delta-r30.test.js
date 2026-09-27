import test from 'node:test';
import assert from 'node:assert/strict';
import {stateDelta} from '../server/http/state-delta.mjs';
import {createReadGate} from '../client/core/read-gate.js';
test('delta roundtrip retains unchanged sections and detects changes without world revision',()=>{
 const first={playerId:'a',wallet:{gold:10},draft:{roster:[{id:'p',fitness:90}]},world:{revision:1},removed:true};
 const full=stateDelta(first,'{}');assert.deepEqual(full.statePatch,first);
 const next={...first,wallet:{gold:11},draft:{roster:[{id:'p',fitness:91}]}};delete next.removed;
 const delta=stateDelta(next,JSON.stringify(full.stateVersions));
 assert.equal(delta.statePatch.world,undefined);assert.equal(delta.statePatch.wallet.gold,11);
 assert.equal(delta.statePatch.draft.roster[0].fitness,91);
 const merged={...first,...delta.statePatch};for(const key of Object.keys(merged))if(!Object.hasOwn(delta.stateVersions,key))delete merged[key];
 assert.deepEqual(merged,next);assert.deepEqual(stateDelta(next,JSON.stringify(delta.stateVersions)).statePatch,{});
 assert.deepEqual(stateDelta(next,'bad-json').statePatch,next);
});
test('slow requests never overlap; closing invalidates late results; reopening can fetch again',async()=>{
 let resolve,calls=0,paint=0;const gate=createReadGate();
 const first=gate.run(async current=>{calls++;await new Promise(r=>resolve=r);if(current())paint++;});
 await gate.run(()=>{calls++;});assert.equal(calls,1);gate.reset();resolve();await first;
 assert.equal(paint,0);await gate.run(()=>{calls++;});assert.equal(calls,2);
});
test('failed reads back off, reset permits immediate retry',async()=>{
 let time=0,calls=0;const gate=createReadGate({now:()=>time});
 await assert.rejects(gate.run(()=>{calls++;throw Error('offline');}));
 await gate.run(()=>{calls++;});assert.equal(calls,1);time=3000;
 await gate.run(()=>{calls++;});assert.equal(calls,2);gate.reset();await gate.run(()=>calls++);assert.equal(calls,3);
});

import {createCampaignApiClient} from '../client/core/campaign-api-client.js';
test('API delta baseline resets on mutation and token change; legacy servers remain supported',async()=>{
 let state={playerId:'a',wallet:{gold:10},draft:{roster:[1]}},headers=[];
 const api=createCampaignApiClient({storage:null,fetchImpl:async(url,options)=>{
  headers.push(options.headers);if(options.method==='POST')return {ok:true,json:async()=>({ok:true})};
  return {ok:true,json:async()=>stateDelta(state,options.headers['x-campaign-versions'])};
 }});
 assert.deepEqual((await api.request('/api/campaign/state')).state,state);
 state={...state,wallet:{gold:20}};assert.deepEqual((await api.request('/api/campaign/state')).state,state);assert.ok(headers.at(-1)['x-campaign-versions']);
 await api.request('/mutate',{method:'POST',body:{}});await api.request('/api/campaign/state');assert.ok(headers.at(-1)['x-campaign-versions'],'mutation keeps the verified baseline; server hashes still return all changed fields');
 api.setToken('other');state={playerId:'b',wallet:{gold:3}};assert.deepEqual((await api.request('/api/campaign/state')).state,state);
 const legacy=createCampaignApiClient({storage:null,fetchImpl:async()=>({ok:true,json:async()=>({state})})});assert.deepEqual((await legacy.request('/api/campaign/state')).state,state);
});
test('response from before a mutation cannot replace the new baseline',async()=>{
 let release;const api=createCampaignApiClient({storage:null,fetchImpl:async(url)=>{
  if(url==='/mutate')return {ok:true,json:async()=>({ok:true})};await new Promise(r=>release=r);
  return {ok:true,json:async()=>stateDelta({playerId:'a',wallet:{gold:0}},'{}')};
 }});
 const pending=api.request('/api/campaign/state');await api.request('/mutate',{method:'POST',body:{}});release();await assert.rejects(pending,/变化/);
});

import {createFrameRefresh} from '../client/core/frame-refresh.js';
test('map queues latest payload once per frame and does not repaint identical keys',()=>{
 const callbacks=[],paint=[];const queue=createFrameRefresh({schedule:f=>callbacks.push(f)});
 queue.request('land','a',()=>paint.push('a'));queue.request('land','b',()=>paint.push('b'));assert.equal(callbacks.length,1);callbacks.shift()();assert.deepEqual(paint,['b']);
 queue.request('land','b',()=>paint.push('duplicate'));callbacks.shift()();assert.deepEqual(paint,['b']);
 queue.reset();queue.request('land','b',()=>paint.push('again'));callbacks.shift()();assert.deepEqual(paint,['b','again']);
});
test('consumer mutations cannot poison the delta baseline',async()=>{
 const state={playerId:'a',draft:{roster:[{id:'p'}]}};
 const api=createCampaignApiClient({storage:null,fetchImpl:async(url,o)=>({ok:true,json:async()=>stateDelta(state,o.headers['x-campaign-versions'])})});
 const first=await api.request('/api/campaign/state');first.state.draft.roster.length=0;
 assert.deepEqual((await api.request('/api/campaign/state')).state,state);
});

test('an older overlapping state read cannot regress a newer baseline',async()=>{
 const replies=[];const api=createCampaignApiClient({storage:null,fetchImpl:async()=>new Promise(resolve=>replies.push(value=>resolve({ok:true,json:async()=>stateDelta(value,'{}')})))});
 const first=api.request('/api/campaign/state',{timeoutMs:1000});const second=api.request('/api/campaign/state',{timeoutMs:2000});
 replies[1]({playerId:'a',wallet:{gold:20}});assert.equal((await second).state.wallet.gold,20);
 replies[0]({playerId:'a',wallet:{gold:10}});await assert.rejects(first,/变化/);
});
