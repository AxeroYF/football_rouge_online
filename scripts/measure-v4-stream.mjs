import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {simulateMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {VERSION} from '../versus/v4/world.js';
import {createPublisher,createViewer} from '../versus/v4-stream/publisher.js';
import {publicFrame,publicEvent} from '../versus/v4-stream/codec.js';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const duration=Number(args.duration??600),start=performance.now(),match=simulateMatch(demoInput({duration,seed:'stream-size-proof'}));
const simulationMs=performance.now()-start,rawBytes=Buffer.byteLength(JSON.stringify({frames:match.frames,events:match.events}));
const stateBefore=JSON.stringify(match.state),results=[];
for(const ownerSide of [null,0]){
  const identity={matchId:'synthetic-size-proof',engineVersion:VERSION,ownerSide},publisher=createPublisher(match,identity),viewer=createViewer(identity);
  publisher.publishUntil(match.state.time);let packets=0,jsonBytes=0,gzipBytes=0,maxPacketBytes=0,encodeMs=0,decodeMs=0;
  while(!viewer.complete){
    const started=performance.now(),packet=publisher.read(viewer.cursor);encodeMs+=performance.now()-started;
    const json=JSON.stringify(packet);jsonBytes+=Buffer.byteLength(json);const compressed=gzipSync(json);gzipBytes+=compressed.length;maxPacketBytes=Math.max(maxPacketBytes,compressed.length);
    const decodeStart=performance.now();viewer.accept(JSON.parse(json));decodeMs+=performance.now()-decodeStart;packets++;
    assert.ok(packets<10000,'bounded packet sequence');
  }
  assert.equal(viewer.frames.length,match.frames.length);
  for(let i=0;i<viewer.frames.length;i++)assert.deepEqual(viewer.frames[i],publicFrame(match.frames[i],ownerSide));
  assert.deepEqual(viewer.events,match.events.map(e=>publicEvent(e,ownerSide)).filter(Boolean));
  const projectedRawBytes=Buffer.byteLength(JSON.stringify({frames:viewer.frames,events:viewer.events}));
  results.push({ownerSide,packets,projectedRawBytes,jsonBytes,gzipBytes,maxPacketBytes,wireReduction:1-gzipBytes/rawBytes,
    encodingReduction:1-gzipBytes/projectedRawBytes,encodeMs,decodeMs,frames:viewer.frames.length,events:viewer.events.length});
}
assert.equal(JSON.stringify(match.state),stateBefore);
const report={passed:true,engineVersion:VERSION,duration,simulationSeconds:match.state.time,rawBytes,simulationMs,results,
  scope:'Local synthetic recording, independent HTTP-style gzip packets and exact reconstructed presentation state. No cloud capacity claim; no real save or production service imported.'};
const output=path.resolve(args.output??'outputs/v4-stream-20261117/size.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
