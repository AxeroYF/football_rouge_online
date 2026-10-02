import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createV22DemoAccounts} from '../engine/v2.2/demo-fixture.mjs';

const root=process.cwd(),out=path.join(root,'outputs/hot-update-20260929-r44'),bundle=path.join(out,'yellowdogs-hot-update-20260929-r44');
const app=path.join(out,'verified-preflight-fixture/app'),data=path.join(out,'runtime-qa-data');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
assert.ok(!fs.existsSync(data),'Never overwrite runtime QA saves');fs.mkdirSync(data);
const manifest=read(path.join(bundle,'MANIFEST.json'));
for(const dep of manifest.dependencies)fs.cpSync(path.join(root,dep.path),path.join(app,dep.path),{recursive:true});
for(const file of ['s4-player-catalog.json','s4-player-base-catalog.json','s4-player-profile-registry.json']){const source=path.join(root,'assets/data',file);if(fs.existsSync(source))fs.copyFileSync(source,path.join(app,'assets/data',file));}
fs.mkdirSync(path.join(app,'assets/player-profiles'),{recursive:true});fs.writeFileSync(path.join(app,'assets/player-profiles/r44-private-sentinel.txt'),'preserve private uploads');
const {CampaignService}=await import(pathToFileURL(path.join(app,'campaign-service.mjs')));
const {advanceCampaignLiveLeg}=await import(pathToFileURL(path.join(app,'engine/campaign-match-engine.mjs')));
const catalog=read(path.join(app,'assets/data/s4-player-catalog.json')),index=read(path.join(app,'assets/data/territory-index.json'));
const savePath=path.join(data,'campaign-accounts.json'),old=new CampaignService({dataPath:savePath,catalog,territoryIndex:index});
const homes=index.territories.filter(t=>t.spawnAllowed&&t.initialOwner.type==='neutral').slice(0,2),seedTeams=createV22DemoAccounts(),accounts=[];
for(let i=0;i<2;i++){
 old.register('R44验证'+i,'isolated-r44-password');const a=old.accountByNickname('R44验证'+i),seed=seedTeams[i],home=homes[i];
 Object.assign(a,{setupComplete:true,homeTerritoryId:home.territoryId,gold:123456,draft:seed.draft,playerSquads:seed.playerSquads,tactics:seed.tactics});a.draft.version='ydl-europe-33-v1';
 old.world.players[a.id]={playerId:a.id,capitalTerritoryId:home.territoryId,territoryIds:[home.territoryId]};Object.assign(old.world.territories[home.territoryId],{ownerType:'player',ownerId:a.id,capitalOf:a.id,buildings:[]});old.buildings.ensureCapitalHeadquarters(a,old.world,home.territoryId);accounts.push(a);
}
const legacyId=old.diplomacy.beginFriendly(...accounts),legacy=old.world.diplomacy.matches[legacyId].leg;legacy.startedAt=Date.now()-121000;
advanceCampaignLiveLeg(legacy,Date.now(),{maximumChains:179});assert.equal(legacy.match.finished,false);old.persist();
const before=fs.readFileSync(savePath,'utf8');
const {preflight,applyUpdate,rollbackUpdate}=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const options={bundle,app,data,backupRoot:path.join(out,'runtime-qa-backups'),stop:()=>{},start:()=>{},health:async()=>true,log:()=>{}};
preflight(options);const installed=await applyUpdate(options);assert.equal(fs.readFileSync(savePath,'utf8'),before);
let child,url,logs='',token=accounts[0].token;
async function start(){logs='';child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-r44-admin-password'},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<300;i++){const m=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){url='http://127.0.0.1:'+m[1];return;}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}throw Error('Runtime start timeout: '+logs);}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
async function api(route,body,authorization=token){const response=await fetch(url+'/versus/api/campaign/'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(authorization?{authorization:'Bearer '+authorization}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
async function waitUntil(fn){for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Runtime condition timed out');}
const checks=[];
try{
 await start();assert.ok((await fetch(url+'/healthz')).ok);
 const state=(await api('state')).state;assert.equal(state.wallet.gold,123456);assert.equal(state.draft.roster.length,11);checks.push('R43 account, wallet and roster survive actual installed server boot');
 await waitUntil(async()=>Boolean((await api('interactions/match?id='+encodeURIComponent(legacyId))).completed));
 const report=await api('interactions/match?id='+encodeURIComponent(legacyId));assert.equal(report.battle.broadcasts[0].dynamic,undefined);checks.push('In-flight R43 friendly settles using original V2.1 engine');
 const request=await api('interactions',{targetId:accounts[1].id,action:'friendly',requestId:crypto.randomUUID()});
 const accepted=await api('interactions',{targetId:accounts[0].id,action:'accept',proposalId:request.proposalId,requestId:crypto.randomUUID()},accounts[1].token);
 const id=accepted.matchId,match=await api('interactions/match?id='+encodeURIComponent(id));assert.equal(match.competition,'friendly');assert.equal(match.live.broadcast.engine,'v2.2');assert.ok(match.live.broadcast.dynamic.frames.length);
 const denied=await fetch(url+'/versus/api/campaign/interactions/match?id='+encodeURIComponent(id));assert.equal(denied.status,401);
 checks.push('Real invite/accept HTTP flow creates a private V2.2 friendly');
 await waitUntil(()=>read(savePath).world.diplomacy.matches[id]?.leg?.dynamic?.state?.tick>0);
 const savedTick=read(savePath).world.diplomacy.matches[id].leg.dynamic.state.tick;
 const delta=await api('interactions/match?id='+encodeURIComponent(id)+'&afterTick=0');assert.equal(delta.live.broadcast.playerPatch,true);
 checks.push('Scheduler persists live progress; authenticated delta endpoint works');
 await stop();await start();const resumed=await api('interactions/match?id='+encodeURIComponent(id));assert.equal(resumed.live.broadcast.engine,'v2.2');assert.ok(resumed.live.broadcast.dynamic.frames.at(-1).tick>=savedTick);checks.push('Actual process restart restores dynamic match checkpoint');
 for(const route of ['client/league/dynamic-broadcast.js','client/league/daily-league-controller.js','shared/config/league-featured.mjs','engine/v2.2/hybrid-engine.js'])assert.ok((await fetch(url+'/versus/'+route)).ok,route);
 assert.equal(fs.readFileSync(path.join(app,'assets/player-profiles/r44-private-sentinel.txt'),'utf8'),'preserve private uploads');checks.push('New modules accessible; private uploads preserved');
 await stop();await rollbackUpdate({...options,backup:installed.backup});assert.equal(fs.readFileSync(savePath,'utf8'),before);
 await start();assert.ok((await fetch(url+'/healthz')).ok);assert.equal((await api('state')).state.wallet.gold,123456);checks.push('Matched R43 code/save rollback boots and preserves account');
 const result={passed:true,platform:process.platform,node:process.version,checks,remoteDeployed:false,scope:'Real isolated Windows Node servers and HTTP; systemd service hooks mocked, no remote deployment'};fs.writeFileSync(path.join(out,'runtime-qa.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await stop();}
