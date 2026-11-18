import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {openConfiguredStreamHost} from '../versus/v4-host/configured-host.js';
import {createArchive} from '../versus/v4-stream/archive.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';

test('configured host releases only by trusted wall time, preserves release after clock reversal and rejects unsafe configuration',async()=>{
  assert.equal((await openConfiguredStreamHost(null)).enabled,false);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-config-host-')),configPath=path.join(root,'host.json');
  const m=createMatch(demoInput({duration:20}),{frameInterval:1}),sourceDigest='a'.repeat(64),inputFingerprint='b'.repeat(64);
  const writer=await createArchive(path.join(root,'archive'),{matchId:'clock-proof',engineVersion:m.state.version,sourceDigest,inputFingerprint,teams:m.state.input.teams});
  while(m.state.phase!=='finished'){advanceMatch(m,50);await writer.appendMatch(m);}
  const entry={matchId:'clock-proof',homeId:'blue',awayId:'coral',archive:'archive',engineVersion:m.state.version,sourceDigest,inputFingerprint,startAt:1000,releaseRate:1,publicWatch:false};
  const config={format:'yffm-v4-stream-host-1',scope:'shadow-preview',matches:[entry]};await fs.writeFile(configPath,JSON.stringify(config));
  let now=1000;const rooms={account:(id,token)=>{if(id!=='owner'||token!=='credential')throw Object.assign(new Error('unauthorized'),{statusCode:401});return {id};}},league={state:{teams:[{id:'blue',ownerId:'owner'},{id:'coral',ownerId:'other'}]}};
  const host=await openConfiguredStreamHost(configPath,{rooms,league,now:()=>now});
  const server=http.createServer(async(req,res)=>{if(!await host.handle(req,res)){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/v4/matches/clock-proof`,read=suffix=>fetch(base+suffix,{headers:{Authorization:'Bearer credential','X-Player-Id':'owner'}});
  try{
    const initial=await read('/head');assert.equal(initial.headers.get('X-YFFM-V4-Scope'),'shadow-preview');assert.equal((await initial.json()).segments.length,0);
    now=11000;const head=await (await read('/head')).json();assert.equal(head.segments.length,1);assert.equal((await read('/segments/1')).status,425);
    assert.equal((await read('/head?until=999')).status,400);now=1000;assert.equal((await (await read('/head')).json()).publishedThrough,head.publishedThrough);
    now=21000;assert.equal((await (await read('/head')).json()).complete,true);
    const archiveManifest=path.join(root,'archive/manifest.json'),original=await fs.readFile(archiveManifest,'utf8');
    await fs.writeFile(archiveManifest,'corrupt');
    assert.equal((await fetch(base+'/head')).status,403);assert.equal((await read('/head')).status,503);
    await fs.writeFile(archiveManifest,original);
    for(const change of [{archive:'..'},{sourceDigest:'c'.repeat(64)},{releaseRate:1000}]){
      await fs.writeFile(configPath,JSON.stringify({...config,matches:[{...entry,...change}]}));await assert.rejects(openConfiguredStreamHost(configPath,{rooms,league}),/超出|不一致|无效/);
    }
    await fs.writeFile(configPath,JSON.stringify({...config,scope:'production'}));await assert.rejects(openConfiguredStreamHost(configPath,{rooms,league}),/只允许影子预览/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
