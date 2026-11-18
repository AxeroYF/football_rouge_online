import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {createCanonicalStreamHost} from '../versus/v4-host/canonical-host.js';
import {createAccountPlayback} from '../versus/v4-host/account-playback.js';

test('disabled host never touches accounts, league state or existing request handling',async()=>{
  const host=createCanonicalStreamHost();assert.equal(host.enabled,false);assert.equal(await host.handle({},{}),false);assert.throws(()=>host.register({},{}),/未启用/);
});

test('canonical account credentials, cooldown and current team ownership control private replay access',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-canonical-auth-'));
  // Set every mutable path before dynamically loading the existing service.
  process.env.VERSUS_ACCOUNTS_PATH=path.join(root,'accounts.json');process.env.YELLOWDOGS_LEAGUE_PATH=path.join(root,'league.json');
  process.env.YDL_CONTENT_OVERRIDES_PATH=path.join(root,'content.json');process.env.YDL_PLAYER_CARD_STUDIO_PATH=path.join(root,'studio.json');
  const {VersusRoomService}=await import('../versus/room-service.js');
  const rooms=new VersusRoomService({accountsPath:path.join(root,'isolated-accounts.json'),now:()=>1000,lineups:new Map()});
  const home=rooms.bindAccount('v4-home'),away=rooms.bindAccount('v4-away'),viewer=rooms.bindAccount('v4-viewer');
  const league={state:{teams:[{id:'home',ownerId:home.profile.id},{id:'away',ownerId:away.profile.id}]}};
  let published=-1;const archive={manifest:{matchId:'auth-proof',engineVersion:'test',teams:[{id:'home',name:'Home'},{id:'away',name:'Away'}],segments:[{index:0,through:10,complete:false}]},
    refresh:async()=>{},get publishedThrough(){return published;},publishUntil:time=>{published=time;},read:async(index,side)=>published>=10?{ownerSide:side}:null};
  const host=createCanonicalStreamHost({enabled:true,rooms,league,requestsPerMinute:100});
  assert.throws(()=>host.register({matchId:'auth-proof',homeId:'away',awayId:'home'},archive),/归档球队/);
  host.register({matchId:'auth-proof',homeId:'home',awayId:'away',publicWatch:true},archive);host.release('auth-proof',10);
  const server=http.createServer(async(req,res)=>{if(!await host.handle(req,res)){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
  const baseUrl=`http://127.0.0.1:${server.address().port}`,read=(account,extra={})=>fetch(baseUrl+'/v4/matches/auth-proof/head',{headers:{Authorization:`Bearer ${account.accountToken}`,'X-Player-Id':encodeURIComponent(account.profile.id),...extra}});
  try{
    assert.equal((await (await read(home)).json()).ownerSide,0);assert.equal((await (await read(away)).json()).ownerSide,1);assert.equal((await (await read(viewer)).json()).ownerSide,null);
    assert.equal((await read(home,{'X-Player-Id':away.profile.id})).status,403);
    rooms.accounts.get(home.profile.id.toLowerCase()).loginCooldownUntil=2000;assert.equal((await read(home)).status,403);
    rooms.accounts.get(home.profile.id.toLowerCase()).loginCooldownUntil=0;league.state.teams[0].ownerId=viewer.profile.id;
    assert.equal((await (await read(home)).json()).ownerSide,null);assert.equal((await (await read(viewer)).json()).ownerSide,0);
    const playback=createAccountPlayback({matchId:'auth-proof',playerId:viewer.profile.id,accountToken:viewer.accountToken,baseUrl});
    await playback.refresh();assert.equal(playback.state.ownerSide,0);playback.close();
    host.unregister('auth-proof');assert.equal((await read(viewer)).status,403);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rooms.accountRepository.flush?.();}
});
