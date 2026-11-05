import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaticAssetCache,acceptsGzip} from '../devtool/static-asset-cache.js';
test('static assets share one read and compression across concurrent requests and invalidate on change',async()=>{
  let reads=0,compressions=0;
  const cache=createStaticAssetCache({read:async()=>{reads++;return Buffer.alloc(4096,'a');},zip:async()=>{compressions++;return Buffer.from('compressed');}});
  const details={size:4096,mtimeMs:1,ctimeMs:1};
  const [first,second]=await Promise.all([cache.get('app.js',details,true),cache.get('app.js',details,true)]);
  assert.equal(first,second);assert.equal(reads,1);assert.equal(compressions,1);
  await cache.get('app.js',{...details,ctimeMs:2},true);
  assert.equal(reads,2);
});
test('cache evicts assets beyond its byte budget and can retry a failed read',async()=>{
  let reads=0;
  const cache=createStaticAssetCache({maxBytes:8,read:async()=>{reads++;if(reads===1)throw new Error('missing');return Buffer.alloc(8);}});
  const details={size:8,mtimeMs:1,ctimeMs:1};
  await assert.rejects(cache.get('a',details,false),/missing/);
  await cache.get('a',details,false);await cache.get('b',details,false);await cache.get('a',details,false);
  assert.equal(reads,4);
});
test('gzip negotiation respects explicit rejection and wildcard fallback',()=>{
  assert.equal(acceptsGzip('gzip;q=0, *;q=1'),false);
  assert.equal(acceptsGzip('br'),false);assert.equal(acceptsGzip(),false);
  assert.equal(acceptsGzip('br, gzip'),true);assert.equal(acceptsGzip('*;q=0.5'),true);
});
