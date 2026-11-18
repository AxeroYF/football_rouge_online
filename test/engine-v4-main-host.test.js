import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createArchive} from '../versus/v4-stream/archive.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {startLocalServer} from './helpers/local-server.js';

test('formal server entry selects V4 for the league and cup',async t=>{
  const server=await startLocalServer({v4Schedule:'default'});
  t.after(server.stop);
  const config=await (await fetch(server.url+'/api/versus/config')).json();
  assert.equal(config.matchEngines.league,'v4');
  assert.equal(config.matchEngines.cup,'v4');
  assert.equal(config.matchEngines.friendly,'v4');assert.equal(config.matchEngines.prediction,'v1');
  assert.match(config.engineVersion,/^4\./);
});

test('main HTTP server explicitly opts into read-only preview without changing its V3.3 engine',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-main-host-')),input=demoInput({duration:20});input.teams[0].id='ydl-team-1';input.teams[1].id='ydl-team-2';
  const m=createMatch(input),sourceDigest='a'.repeat(64),inputFingerprint='b'.repeat(64);
  const archive=await createArchive(path.join(root,'archive'),{matchId:'main-preview',engineVersion:m.state.version,sourceDigest,inputFingerprint,teams:m.state.input.teams});
  while(m.state.phase!=='finished'){advanceMatch(m,50);await archive.appendMatch(m);}
  const config=path.join(root,'preview.json');await fs.writeFile(config,JSON.stringify({format:'yffm-v4-stream-host-1',scope:'shadow-preview',matches:[{matchId:'main-preview',homeId:'ydl-team-1',awayId:'ydl-team-2',archive:'archive',engineVersion:m.state.version,sourceDigest,inputFingerprint,startAt:Date.now()-60000,releaseRate:1,publicWatch:true}]}));
  const child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,APP_ENV:'test',VERSUS_HOST:'127.0.0.1',DEVTOOL_PORT:'0',YFFM_MATCH_ENGINE:'v3',YDL_V4_SCHEDULE:'0',YFFM_ADMIN_PASSWORD:'isolated-v4-main-only',YDL_V4_STREAM_MANIFEST:config,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles')}});
  const exit=once(child,'exit');let output='';
  try{
    const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('preview host timeout '+output)),15000);
      child.stdout.on('data',b=>{output+=b;const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});
      child.stderr.on('data',b=>output+=b);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('preview host exited '+output));});});
    const config=await (await fetch(base+'/api/versus/config')).json();assert.equal(config.engineVersion,'3.3.0');assert.equal(config.matchEngine,'v3');
    const page=await fetch(base+'/v4-preview/?match=main-preview');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
    const user=await (await fetch(base+'/api/versus/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:'preview-viewer',password:'preview-test-password'})})).json();assert.equal(user.ok,true);
    const endpoint=base+'/v4/matches/main-preview/head';assert.equal((await fetch(endpoint)).status,403);
    const head=await (await fetch(endpoint,{headers:{Authorization:`Bearer ${user.accountToken}`,'X-Player-Id':user.profile.id}})).json();assert.equal(head.ownerSide,null);assert.equal(head.complete,true);
    for(const route of ['/v4-preview/v4/engine.js','/v4-preview/v4-host/configured-host.js','/v4-preview/archive/manifest.json'])assert.equal((await fetch(base+route)).status,404);
  }finally{if(child.exitCode===null)child.kill();await exit;}
});
