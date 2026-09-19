import test from 'node:test';
import assert from 'node:assert/strict';
import {TV_DEFAULTS,normalizeTvAppearance,readTvAppearance,saveTvAppearance,tvStorageKey} from '../client/settings/tv-appearance.js';
test('TV choices normalize stale or injected values without affecting valid choices',()=>{
 assert.deepEqual(normalizeTvAppearance(null),TV_DEFAULTS);assert.deepEqual(normalizeTvAppearance({pitchColor:'silver',standStyle:'url(bad)',extra:true}),{...TV_DEFAULTS,pitchColor:'silver'});
});
test('TV preferences survive reload and are isolated by account',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const next={pitchColor:'silver',pitchStyle:'checker',standStyle:'steep',backgroundEffect:'meteor'};saveTvAppearance(storage,'one',next);assert.deepEqual(readTvAppearance(storage,'one'),next);assert.deepEqual(readTvAppearance(storage,'two'),TV_DEFAULTS);
 data.set(tvStorageKey('two'),'not json');assert.deepEqual(readTvAppearance(storage,'two'),TV_DEFAULTS);
 saveTvAppearance(storage,'one',TV_DEFAULTS);assert.deepEqual(readTvAppearance(storage,'one'),TV_DEFAULTS);
});
test('TV settings reports unavailable writes and tolerates unavailable reads',()=>{const storage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};assert.deepEqual(readTvAppearance(storage,'one'),TV_DEFAULTS);assert.throws(()=>saveTvAppearance(storage,'one',TV_DEFAULTS),/blocked/);});
