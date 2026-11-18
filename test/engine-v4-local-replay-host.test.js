import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {openLocalReplayHost} from '../versus/v4-host/local-replay-host.js';
import {createReplayLifecycle} from '../versus/v4-host/replay-lifecycle.js';
import {createArchive} from '../versus/v4-stream/archive.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {VERSION} from '../versus/v4/world.js';

test('forty historical matches remain authorized and addressable with only two cached readers and monotonic validated history',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-history-host-'));await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const rounds=[],folders=new Map(),sourceDigest='b'.repeat(64);let now=100000;
  for(let number=1;number<=20;number++){
    const round={key:number.toString(16).padStart(64,'0'),startedAt:1000,releaseRate:1,enginePin:{engineVersion:VERSION,sourceDigest},tasks:[]};
    for(let side=0;side<2;side++){
      const id=`history-${number}-${side}`,match=createMatch({...demoInput({duration:30}),fixtureId:id}),input=match.state.input,fingerprint=createHash('sha256').update(JSON.stringify({engineVersion:VERSION,input})).digest('hex');
      round.tasks.push({fixture:{id},envelope:{engineVersion:VERSION,fingerprint,input}});const folder=path.join(root,'league-queue-'+round.key,'jobs',id,'archive');folders.set(id,folder);await fs.mkdir(path.dirname(folder),{recursive:true});
      const writer=await createArchive(folder,{matchId:id,engineVersion:VERSION,sourceDigest,inputFingerprint:fingerprint,teams:input.teams});while(match.state.phase!=='finished'){advanceMatch(match,50);await writer.appendMatch(match);}
    }
    rounds.push(round);
  }
  const league={state:{teams:rounds[0].tasks[0].envelope.input.teams.map((team,side)=>({...team,ownerId:side===0?'owner':null}))}},rooms={account(id,token){if(token!=='token-'+id)throw Object.assign(new Error('unauthorized'),{statusCode:401});return {id};}},lifecycle=createReplayLifecycle({now:()=>now});
  const host=await openLocalReplayHost({enabled:true,root,rooms,league,lifecycle,now:()=>now,readerLimit:2});rounds.forEach(round=>host.registerRound(round,{publicWatch:true}));assert.equal(host.registeredMatches,40);
  let diskOpens=0;const realpath=fs.realpath.bind(fs);t.mock.method(fs,'realpath',async(...args)=>{diskOpens++;return realpath(...args);});
  const server=http.createServer(async(req,res)=>{if(!await host.handle(req,res)){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer token-owner','X-Player-Id':'owner'},get=(id,suffix='/head',auth=headers)=>fetch(base+`/v4/matches/${id}`+suffix,{headers:auth});
  try{
    assert.equal((await get('history-1-0','/head',{})).status,403);assert.equal(diskOpens,0);assert.equal(host.readerStats.entries,0);
    for(const round of rounds)for(const task of round.tasks){const head=await (await get(task.fixture.id)).json();assert.equal(head.complete,true);assert.equal(head.ownerSide,0);assert.ok(host.readerStats.entries<=2);}
    now=1000;assert.equal((await (await get('history-1-0')).json()).publishedThrough,30);
    const packet=await (await get('history-1-0','/segments/0')).json();assert.equal(packet.ownerSide,0);assert.ok(packet.frames.first.players.some(player=>player.side===0&&player.task));
    await get('history-20-0');await get('history-20-1');
    const file=path.join(folders.get('history-1-0'),'manifest.json'),original=await fs.readFile(file,'utf8'),corrupt=JSON.parse(original);corrupt.segments[0].files[0].sha256='0'.repeat(64);await fs.writeFile(file,JSON.stringify(corrupt));
    assert.equal((await get('history-1-0')).status,503);await fs.writeFile(file,original);assert.equal((await get('history-1-0')).status,200);
    now=300000;assert.equal((await lifecycle.expire('history-1-0',async()=>{})).expired,true);assert.equal((await get('history-1-0')).status,410);assert.equal((await get('history-1-0','/head',{})).status,403);
    assert.ok(host.readerStats.entries<=2);assert.ok(host.readerStats.cachedBytes<=4*1024*1024);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));host.close();lifecycle.close();}
});
