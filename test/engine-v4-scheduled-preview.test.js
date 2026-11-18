import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {openScheduledPreviewHost} from '../versus/v4-host/scheduled-preview-host.js';
import {createArchive} from '../versus/v4-stream/archive.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {VERSION} from '../versus/v4/world.js';

for(const competition of ['league','cup'])test(`${competition}: scheduled preview registers before production, authenticates before disk access and releases growing archives by the pinned clock`,async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-scheduled-preview-'));await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const input=demoInput({duration:30}),league={state:{teams:input.teams.map((team,i)=>({...team,ownerId:i===0?'home':'away'}))}};
  const rooms={account(id,token){if(token!==`token-${id}`)throw Object.assign(new Error('unauthorized'),{statusCode:401});return {id};}};
  let now=1000;const host=await openScheduledPreviewHost({root,rooms,league,enabled:true,now:()=>now});
  const pin={engineVersion:VERSION,sourceDigest:'b'.repeat(64)},round={competition,key:'a'.repeat(64),startedAt:1000,releaseRate:1,enginePin:pin,tasks:[{fixture:{id:'growing'},context:{event:{stage:'roundOf16',leg:1}},envelope:{engineVersion:VERSION,fingerprint:'c'.repeat(64),input:{...input,competition:{aggregate:[0,0]}}}}]};
  host.registerRound(round,{publicWatch:true});
  const server=http.createServer(async(req,res)=>{if(!await host.handle(req,res)){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer token-home','X-Player-Id':'home'};
    let realpaths=0;const realpath=fs.realpath.bind(fs);t.mock.method(fs,'realpath',async(...args)=>{realpaths++;return realpath(...args);});
    assert.equal((await fetch(base+'/v4/matches/growing/head')).status,403);assert.equal(realpaths,0);
    const head=await (await fetch(base+'/v4/matches/growing/head',{headers})).json();assert.equal(head.publishedThrough,-1);assert.deepEqual(head.segments,[]);assert.equal(head.ownerSide,0);
    assert.deepEqual(head.competition,competition==='cup'?{kind:'cup',stage:'roundOf16',leg:1,aggregate:[0,0]}:null);
    const folder=path.join(root,competition+'-queue-'+round.key,'jobs','growing','archive');await fs.mkdir(path.dirname(folder),{recursive:true});
    const writer=await createArchive(folder,{matchId:'growing',engineVersion:VERSION,inputFingerprint:'c'.repeat(64),sourceDigest:pin.sourceDigest,teams:input.teams}),match=createMatch(input,{frameInterval:1});
    advanceMatch(match,50);await writer.appendMatch(match);
    round.releaseRate=64;round.startedAt=-999999;
    assert.deepEqual((await (await fetch(base+'/v4/matches/growing/head',{headers})).json()).segments,[]);
    now=11000;const packet=await (await fetch(base+'/v4/matches/growing/segments/0',{headers})).json();assert.equal(packet.ownerSide,0);assert.ok(packet.frames.first.players.some(player=>player.side===0&&player.task));assert.ok(packet.frames.first.players.filter(player=>player.side===1).every(player=>player.task===undefined));
    const publicPacket=await (await fetch(base+'/v4/matches/growing/segments/0',{headers:{Authorization:'Bearer token-spectator','X-Player-Id':'spectator'}})).json();assert.equal(publicPacket.ownerSide,null);assert.ok(publicPacket.frames.first.players.every(player=>player.task===undefined));
    while(match.state.phase!=='finished'){advanceMatch(match,50);await writer.appendMatch(match);}
    assert.equal((await (await fetch(base+'/v4/matches/growing/head',{headers})).json()).complete,false);
    now=31000;assert.equal((await (await fetch(base+'/v4/matches/growing/head',{headers})).json()).complete,true);
    assert.throws(()=>host.registerRound({...round,startedAt:2000},{publicWatch:true}),/锁定/);
    host.unregisterRound(round.key);assert.equal((await fetch(base+'/v4/matches/growing/head',{headers})).status,403);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
