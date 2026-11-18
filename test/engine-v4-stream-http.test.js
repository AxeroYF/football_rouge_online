import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createStreamService,accountAuthorization} from '../versus/v4-stream/http-service.js';

test('HTTP binds private side to verified account; blocks future, mutation and forged query knobs',async()=>{
  let published=10,requested=[];
  const manifest={matchId:'proof',engineVersion:'test-v4',segments:[{index:0,through:10,complete:false},{index:1,through:20,complete:true}]};
  const archive={manifest,refresh:async()=>{},get publishedThrough(){return published;},read:async(index,side)=>{
    requested.push({index,side});return index===0||index===1&&published>=20?{ownerSide:side,index}:null;
  }};
  const authorize=accountAuthorization({verifyAccount:async token=>['owner','spectator'].includes(token)?{id:token}:null,
    matchAccess:async(id,matchId)=>({canWatch:matchId==='proof',ownerSide:id==='owner'?1:null})});
  const service=createStreamService({authorize,requestsPerMinute:8});service.register('proof',archive);
  const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res)){res.writeHead(404);res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/v4/matches/proof`;
  const read=(suffix,token='owner',options={})=>fetch(url+suffix,{headers:{Authorization:`Bearer ${token}`},...options});
  try{
    assert.equal((await read('/head','invalid')).status,403);
    const head=await (await read('/head')).json();assert.equal(head.ownerSide,1);assert.deepEqual(head.segments,[{index:0,through:10}]);assert.equal(head.complete,false);
    assert.equal((await read('/head?ownerSide=0')).status,400);assert.equal((await read('/segments/0?until=999')).status,400);
    assert.equal((await read('/segments/0','owner',{method:'POST'})).status,405);
    assert.deepEqual(await (await read('/segments/0')).json(),{ownerSide:1,index:0});
    assert.deepEqual(await (await read('/segments/0','spectator')).json(),{ownerSide:null,index:0});
    assert.equal((await read('/segments/1')).status,425);
    published=20;assert.equal((await (await read('/head')).json()).complete,true);
    for(let i=0;i<6;i++)await read('/head');assert.equal((await read('/head')).status,429);
    assert.ok(requested.every(r=>[null,1].includes(r.side)));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
