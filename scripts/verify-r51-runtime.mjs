import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createV22DemoAccounts} from '../engine/v2.2/demo-fixture.mjs';
const root=process.cwd(),out=path.join(root,process.env.R51_QA_OUTPUT||'outputs/hot-update-20261004-r51'),bundle=path.join(out,'yellowdogs-hot-update-20261004-r51');
const app=path.join(out,'verified-preflight-fixture/app'),data=path.join(out,process.argv[2]||'runtime-qa-data');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
assert.ok(!fs.existsSync(data),'Never overwrite QA saves');fs.mkdirSync(data);
const manifest=read(path.join(bundle,'MANIFEST.json'));
for(const dep of manifest.dependencies)fs.cpSync(path.join(root,dep.path),path.join(app,dep.path),{recursive:true});
for(const file of ['s4-player-catalog.json','s4-player-base-catalog.json','s4-player-profile-registry.json']){const source=path.join(root,'assets/data',file);if(fs.existsSync(source))fs.copyFileSync(source,path.join(app,'assets/data',file));}
fs.mkdirSync(path.join(app,'assets/player-profiles'),{recursive:true});fs.writeFileSync(path.join(app,'assets/player-profiles/r51-private-sentinel.txt'),'preserve private uploads');
const {CampaignService}=await import(pathToFileURL(path.join(app,'campaign-service.mjs')));
const catalog=read(path.join(app,'assets/data/s4-player-catalog.json')),index=read(path.join(app,'assets/data/territory-index.json'));
const savePath=path.join(data,'campaign-accounts.json'),old=new CampaignService({dataPath:savePath,catalog,territoryIndex:index});
const seed=createV22DemoAccounts()[0],home=index.territories.find(t=>t.spawnAllowed&&t.initialOwner.type==='neutral');
old.register('R51验证','isolated-r51-password');const a=old.accountByNickname('R51验证');
Object.assign(a,{setupComplete:true,homeTerritoryId:home.territoryId,gold:250000,draft:seed.draft,playerSquads:seed.playerSquads,tactics:seed.tactics});a.draft.version='ydl-europe-33-v1';
old.world.players[a.id]={playerId:a.id,capitalTerritoryId:home.territoryId,territoryIds:[home.territoryId]};Object.assign(old.world.territories[home.territoryId],{ownerType:'player',ownerId:a.id,capitalOf:a.id,buildings:[]});old.buildings.ensureCapitalHeadquarters(a,old.world,home.territoryId);
old.oil.initialize(a);a.oil.balance=200;old.playerPacks.addPacks(a,'legendary-player-pack',3);
const at1830=Date.parse('2026-10-04T18:30:00+08:00'),at2000=Date.parse('2026-10-04T20:00:00+08:00');
old.shop.now=()=>at1830;const oldView=old.shop.publicState(a);
assert.equal(oldView.refreshAt,at2000);
const priorRequest={kind:'player',itemId:oldView.offers[0].id,rotationId:oldView.rotationId,requestId:crypto.randomUUID()};old.shop.buy(a,priorRequest);old.persist();
const clock=path.join(out,'runtime-shop-clock.json'),preload=path.join(out,'runtime-test-clock.mjs');fs.writeFileSync(clock,String(at1830));
// Clock control is external to the payload and limited to this isolated ShopService.
fs.writeFileSync(preload,`import fs from 'node:fs';import {ShopService} from ${JSON.stringify(pathToFileURL(path.join(app,'server/application/shop-service.mjs')).href)};const original=ShopService.prototype.ensureRotation;ShopService.prototype.ensureRotation=function(){this.now=()=>Number(fs.readFileSync(${JSON.stringify(clock)},'utf8'));return original.call(this);};`);
const before=fs.readFileSync(savePath,'utf8');
const {preflight,applyUpdate,rollbackUpdate}=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const options={bundle,app,data,backupRoot:path.join(out,'runtime-qa-backups'),stop:()=>{},start:()=>{},health:async()=>true,log:()=>{}};
preflight(options);const installed=await applyUpdate(options);assert.equal(fs.readFileSync(savePath,'utf8'),before);
let child,url,logs='',token=a.token;
async function start(){logs='';child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.mjs'],{cwd:app,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-r51-admin-password'},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<300;i++){const m=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){url='http://127.0.0.1:'+m[1];return;}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}throw Error('Runtime start timeout: '+logs);}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
async function api(route,body,expected=200,authorization=token){const response=await fetch(url+'/versus/api/campaign/'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(authorization?{authorization:'Bearer '+authorization}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
const checks=[];
try{
 await start();assert.ok((await fetch(url+'/healthz')).ok);let state=(await api('state')).state;
 assert.equal(state.wallet.gold,150000);assert.equal(state.draft.roster.length,12);assert.equal(state.enhancement.maxLevel,10);checks.push('R50 save, purchased player, wallet and +10 rules survive R51 boot');
 const first=(await api('shop')).shop;assert.equal(first.refreshAt,at2000);assert.notEqual(first.rotationId,oldView.rotationId);assert.ok(first.offers.every(o=>!o.sold));assert.equal(first.offers.length,3);
 const replay=await api('shop/buy',{...priorRequest,compact:true});assert.equal(replay.purchase.playerId,a.draft.roster.at(-1).id);assert.equal(replay.statePatch.wallet.gold,150000);checks.push('First shop access at 18:30 switches old three-hour stock once, deadline is 20:00, old receipt still replays');
 fs.writeFileSync(clock,String(at2000-1));const beforeBoundary=(await api('shop')).shop;assert.equal(beforeBoundary.rotationId,first.rotationId);assert.deepEqual(beforeBoundary.offers.map(o=>o.id),first.offers.map(o=>o.id));
 fs.writeFileSync(clock,String(at2000));const next=(await api('shop')).shop;assert.notEqual(next.rotationId,first.rotationId);assert.equal(next.refreshAt,Date.parse('2026-10-04T22:00:00+08:00'));
 await api('shop/buy',{kind:'player',itemId:first.offers[0].id,rotationId:first.rotationId,requestId:crypto.randomUUID()},409);checks.push('19:59:59 retains stock; 20:00 rotates to a 22:00 deadline and rejects old-offer purchases');
 const request={kind:'player',itemId:next.offers[0].id,rotationId:next.rotationId,requestId:crypto.randomUUID(),currency:'oil',compact:true};const bought=await api('shop/buy',request);assert.equal(bought.statePatch.resources.oil.balance,50);assert.equal(bought.statePatch.wallet.gold,150000);
 await stop();await start();const restored=(await api('shop')).shop;assert.equal(restored.rotationId,next.rotationId);assert.ok(restored.offers[0].sold);assert.equal(restored.offers[0].id,next.offers[0].id);await api('shop/buy',request);state=(await api('state')).state;assert.equal(state.draft.roster.length,13);assert.equal(state.resources.oil.balance,50);checks.push('Real restart retains two-hour rotation, sold inventory, card ownership and oil receipt idempotency');
 const page=await fetch(url+'/versus/');assert.ok(page.ok);assert.match(await page.text(),/game-startup[.]js[?]v=sha256-/);
 for(const entry of manifest.files){const response=await fetch(url+'/versus/'+entry.path);assert.ok(response.ok,entry.path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.path);}
 assert.equal(fs.readFileSync(path.join(app,'assets/player-profiles/r51-private-sentinel.txt'),'utf8'),'preserve private uploads');checks.push('Changed public resources match payload hashes; private uploads preserved');
 await stop();await rollbackUpdate({...options,backup:installed.backup});assert.equal(fs.readFileSync(savePath,'utf8'),before);fs.writeFileSync(clock,String(at1830));await start();assert.ok((await fetch(url+'/healthz')).ok);state=(await api('state')).state;assert.equal(state.wallet.gold,150000);assert.equal(state.draft.roster.length,12);const rolled=(await api('shop')).shop;assert.equal(rolled.refreshAt,oldView.refreshAt);assert.equal(rolled.offers[0].id,oldView.offers[0].id);assert.equal(rolled.offers[0].sold,true);checks.push('Matched R50 code/save rollback restores original three-hour stock and healthy server');
 const result={passed:true,platform:process.platform,node:process.version,checks,remoteDeployed:false,scope:'Actual isolated Windows Node servers and HTTP; systemd service hooks mocked; no remote deployment'};fs.writeFileSync(path.join(out,'runtime-qa.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await stop();}
