import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createReplayLifecycle} from '../versus/v4-host/replay-lifecycle.js';
import {createStreamService} from '../versus/v4-stream/http-service.js';

test('an in-flight read and its reconnect lease block expiry; expiry excludes new reads and survives failed attempts',async()=>{
  let now=1000;const life=createReplayLifecycle({now:()=>now,leaseMs:1000}),release=life.acquire('match');let commits=0;
  now=5000;assert.equal((await life.expire('match',async()=>commits++)).expired,false);
  release();release();assert.equal(life.viewing('match'),true);now=6001;
  await assert.rejects(life.expire('match',async()=>{assert.throws(()=>life.acquire('match'),/归档/);throw new Error('disk');}),/disk/);
  assert.equal(life.expired('match'),false);
  assert.equal((await life.expire('match',async()=>commits++)).expired,true);assert.equal(commits,1);
  assert.throws(()=>life.acquire('match'),error=>error.code==='V4_REPLAY_EXPIRED');
  const reopened=createReplayLifecycle();reopened.restoreExpired('match');assert.throws(()=>reopened.acquire('match'),error=>error.code==='V4_REPLAY_EXPIRED');
});

test('HTTP checks authorization before leases, releases failed reads, and returns 410 without reading retired payloads',async()=>{
  let now=1000,reads=0;const lifecycle=createReplayLifecycle({now:()=>now,leaseMs:1000});
  const service=createStreamService({lifecycle,authorize:async req=>req.headers.authorization==='Bearer owner'?{subject:'owner',ownerSide:0}:null});
  service.register('proof',{manifest:{matchId:'proof'},async refresh(){reads++;throw new Error('test read failure');}});
  const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res)){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const url=`http://127.0.0.1:${server.address().port}/v4/matches/proof/head`,headers={Authorization:'Bearer owner'};
    assert.equal((await fetch(url)).status,403);assert.equal(lifecycle.viewing('proof'),false);
    assert.equal((await fetch(url,{headers})).status,503);assert.equal(lifecycle.viewing('proof'),true);
    now=2001;assert.equal((await lifecycle.expire('proof',async()=>{})).expired,true);
    assert.equal((await fetch(url,{headers})).status,410);assert.equal(reads,1);assert.equal((await fetch(url)).status,403);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
