import test from 'node:test';import assert from 'node:assert/strict';
import {playerTraitFitness,presentPlayerTraits} from '../shared/config/player-trait-presentation.mjs';
import {YDL_TRAIT_CARDS} from '../engine/s4-v2.1/versus/trait-pool.js';
import {createCampaignApiClient} from '../client/core/campaign-api-client.js';
import {createFogAreaVisibility} from '../client/map/fog-area-visibility.js';
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
test('fitness-only result equals full presentation for all traits and fitness values',()=>{
 for(const trait of [null,...YDL_TRAIT_CARDS])for(const fitness of [0,25,50,99,100]){
 const p={id:'fixture',role:'ST',traits:trait?[trait.id]:[],attributes:{pace:70,stamina:80,passing:60},state:{fitness}};
 const before=structuredClone(p);assert.equal(playerTraitFitness(p),presentPlayerTraits(p).effectiveFitness,trait?.id);assert.deepEqual(p,before);
 }
});
test('simultaneous GETs share one transport, return independent values and do not cache completed reads',async()=>{
 const g=gate();let calls=0;const c=createCampaignApiClient({storage:null,fetchImpl:async()=>{calls++;await g.promise;return {ok:true,json:async()=>({nested:{x:1}})}}});
 const a=c.request('/state'),b=c.request('/state');assert.equal(calls,1);g.resolve();const [x,y]=await Promise.all([a,b]);x.nested.x=3;assert.equal(y.nested.x,1);await c.request('/state');assert.equal(calls,2);
});
test('mutation and token changes invalidate in-flight GET reuse',async()=>{
 const g=gate();let calls=0;const c=createCampaignApiClient({storage:null,fetchImpl:async()=>{calls++;await g.promise;return {ok:true,json:async()=>({ok:true})}}});
 const tasks=[c.request('/state'),c.request('/buy',{method:'POST'}),c.request('/state')];assert.equal(calls,3);c.setToken('other');tasks.push(c.request('/state'));assert.equal(calls,4);g.resolve();await Promise.all(tasks);
});
test('area queries reuse models until geometry changes, including visibility revocation',()=>{
 let builds=0;const index={models:f=>{builds++;return {current:f.sourceTerritoryIds.length,explored:0}},touchesLand:n=>Boolean(n)};
 const query=createFogAreaVisibility(index),fog={enabled:true,sourceTerritoryIds:['home'],exploredSourceTerritoryIds:[]};
 assert.equal(query.update(fog),true);for(let i=0;i<10000;i++)assert.equal(query.isVisible({}),true);assert.equal(builds,1);
 assert.equal(query.update(structuredClone(fog)),false);assert.equal(builds,1);
 query.update({...fog,sourceTerritoryIds:[]});assert.equal(query.isVisible({}),false);assert.equal(builds,2);
 query.update({enabled:false});assert.equal(query.isVisible({}),true);
});
