import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeChunkedJson} from '../server/infrastructure/chunked-json.mjs';
import {JsonCampaignRepository} from '../server/infrastructure/json-campaign-repository.mjs';
test('chunked output matches native JSON including Unicode and optional values',()=>{
 const value={version:4,accounts:{a:{gold:123,missing:undefined,nan:NaN,unicode:'球员😀',arr:[undefined,,Infinity,null,{x:'中'}],date:new Date(0),custom:{toJSON(){return {z:1};}}}},world:{}};
 const chunks=[];const bytes=writeChunkedJson(value,s=>chunks.push(s),{chunkChars:7});
 assert.equal(chunks.join(''),JSON.stringify(value));assert.equal(bytes,Buffer.byteLength(JSON.stringify(value)));
});
test('large history is split into small writes and round trips without loss',()=>{
 const value={accounts:{a:{battleHistory:Array.from({length:100},(_,id)=>({id,events:Array.from({length:100},(_,i)=>({i,text:'球员传球'.repeat(30)}))}))}},world:{}};
 let max=0,total=0;const pieces=[];writeChunkedJson(value,s=>{max=Math.max(max,s.length);total+=s.length;pieces.push(s);});
 assert.ok(total>1000000);assert.ok(max<70000);assert.deepEqual(JSON.parse(pieces.join('')),value);
});
test('failed serialization preserves committed save and cleans temporary file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-json-test-')),dataPath=path.join(dir,'save.json'),repo=new JsonCampaignRepository({dataPath});
 try{repo.save({accounts:{a:{gold:15}},world:{}});const before=fs.readFileSync(dataPath,'utf8');
 const cycle={};cycle.self=cycle;assert.throws(()=>repo.save({accounts:{a:{gold:30}},world:cycle}),/circular/i);
 assert.equal(fs.readFileSync(dataPath,'utf8'),before);assert.deepEqual(fs.readdirSync(dir),['save.json']);assert.equal(repo.load().accounts.a.gold,15);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('disk write failure preserves committed save and allows retry',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-json-write-test-')),dataPath=path.join(dir,'save.json'),repo=new JsonCampaignRepository({dataPath});
 const original=fs.writeFileSync;
 try{repo.save({accounts:{a:{gold:15}},world:{}});const before=fs.readFileSync(dataPath,'utf8');let calls=0;
 fs.writeFileSync=(...args)=>{if(++calls===2)throw Error('disk full');return original(...args);};
 assert.throws(()=>repo.save({accounts:{a:{gold:30,history:Array.from({length:3000},(_,id)=>({id,text:'x'.repeat(100)}))}},world:{}}),/disk full/);
 fs.writeFileSync=original;assert.equal(fs.readFileSync(dataPath,'utf8'),before);assert.deepEqual(fs.readdirSync(dir),['save.json']);repo.save({accounts:{a:{gold:30}},world:{}});assert.equal(repo.load().accounts.a.gold,30);
 }finally{fs.writeFileSync=original;fs.rmSync(dir,{recursive:true,force:true});}
});
