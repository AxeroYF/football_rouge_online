import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {produceArchive} from '../versus/v4-stream/producer.js';
import {openArchive} from '../versus/v4-stream/archive.js';
import {createViewer} from '../versus/v4-stream/publisher.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {simulateMatch} from '../versus/v4/engine.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const output=path.resolve('outputs/v4-stream-20261117'),root=fs.mkdtempSync(path.join(output,'full-'));
const input=demoInput({duration:5400,seed:'archive-full-proof'}),baseline=simulateMatch(input,{recording:false});
const result=await produceArchive(input,path.join(root,'archive'),{matchId:'full-proof'});assert.deepEqual(result.state,baseline.state);
const archive=await openArchive(path.join(root,'archive'));archive.publishUntil(result.state.time);
const reader=createViewer({matchId:'full-proof',engineVersion:result.state.version,maxFrames:256,maxEvents:256});
for(const entry of archive.manifest.segments){reader.accept(await archive.read(entry.index));assert.ok(reader.frames.length<=256);assert.ok(reader.events.length<=256);}
assert.equal(reader.complete,true);assert.deepEqual(reader.frames.at(-1).score,result.state.score);
assert.ok(result.metrics.highWater.frames<256);assert.ok(result.metrics.highWater.events<2048);
const report={passed:true,dependencyHashes:dependencyHashes(['versus/v4-stream/producer.js','versus/v4-stream/archive.js','versus/v4-stream/publisher.js']),
  score:result.state.score,metrics:result.metrics,archive:root,exactSimulation:true,boundedViewer:true,
  scope:'Single local full-match recording; not a restricted-resource or cloud capacity result.'};
fs.writeFileSync(path.join(output,'full-archive-measurement.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
