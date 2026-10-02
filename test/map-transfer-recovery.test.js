import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchMapAsset} from '../client/map/map-asset-fetch.js';
import {loadCampaignMapData} from '../client/map/campaign-map-data.js';
import {createCampaignApiClient} from '../client/core/campaign-api-client.js';
const fixture=url=>url.includes('countries')||url.includes('territories.geojson')?{features:[]}:url.includes('territory-index')?{territories:[]}:[];
test('continuous download longer than idle timeout completes without redownload',async()=>{
 let requests=0;const bytes=new TextEncoder().encode('{"ok":true}');
 const value=await fetchMapAsset('/slow.json',{timeoutMs:80,totalTimeoutMs:1500,fetchImpl:async()=>{requests++;return new Response(new ReadableStream({async start(c){for(const byte of bytes){await new Promise(r=>setTimeout(r,20));c.enqueue(Uint8Array.of(byte));}c.close();}}));}});
 assert.deepEqual(value,{ok:true});assert.equal(requests,1);
});
test('body stall aborts only that transfer and retries once',async()=>{
 let calls=0,canceled=false;
 const value=await fetchMapAsset('/stall.json',{timeoutMs:15,fetchImpl:async()=>++calls===1?new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){canceled=true;}})):new Response('{"ok":true}')});
 assert.deepEqual(value,{ok:true});assert.equal(calls,2);assert.equal(canceled,true);
});
test('caller cancellation propagates to elevation transport without retry',async()=>{
 const controller=new AbortController();let calls=0,child;
 const task=fetchMapAsset('/height.bin',{signal:controller.signal,type:'arrayBuffer',fetchImpl:async(url,options)=>{calls++;child=options.signal;return new Promise(()=>{});}});
 controller.abort();await assert.rejects(task,{name:'AbortError'});assert.equal(child.aborted,true);assert.equal(calls,1);
});
test('failed dataset retry retains completed siblings',async()=>{
 let fail=true;const counts=new Map();
 const fetchImpl=async url=>{counts.set(url,(counts.get(url)??0)+1);return {ok:!(fail&&url.includes('coastlines')),status:503,json:async()=>fixture(url)};};
 await assert.rejects(loadCampaignMapData({fetchImpl}));fail=false;await loadCampaignMapData({fetchImpl});
 for(const [url,n]of counts)assert.equal(n,url.includes('coastlines')?3:1,url);
});
test('API body timeout preserves session and does not repeat a mutation',async()=>{
 let calls=0;const client=createCampaignApiClient({timeoutMs:15,storage:{getItem:()=> 'retained'},fetchImpl:async()=>{calls++;return {ok:true,json:()=>new Promise(()=>{})}}});
 await assert.rejects(client.request('/action',{method:'POST',body:{}}),/勿重复提交/);assert.equal(calls,1);assert.equal(client.hasToken(),true);
});
test('API exposes unauthorized status for explicit login recovery',async()=>{
 const client=createCampaignApiClient({storage:null,fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'登录已失效'})})});
 await assert.rejects(client.request('/state'),e=>e.status===401&&e.message==='登录已失效');
});
test('canceling elevation load aborts all six underlying requests',async()=>{
 const {loadReliefFields}=await import('../client/map-three/relief-field.js');
 const controller=new AbortController(),signals=[];
 const task=loadReliefFields({signal:controller.signal,fetchImpl:async(url,options)=>{signals.push(options.signal);return new Promise(()=>{});}});
 assert.equal(signals.length,6);controller.abort();await assert.rejects(task,{name:'AbortError'});assert.ok(signals.every(s=>s.aborted));
});
