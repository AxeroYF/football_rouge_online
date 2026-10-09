import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createV22DemoAccounts} from '../engine/v2.2/demo-fixture.mjs';
const root=process.cwd(),out=path.join(root,'outputs/hot-update-20261004-r50'),bundle=path.join(out,'yellowdogs-hot-update-20261004-r50');
const app=path.join(out,'verified-preflight-fixture/app'),data=path.join(out,process.argv[2]||'runtime-qa-data');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
assert.ok(!fs.existsSync(data),'Never overwrite QA saves');fs.mkdirSync(data);
const manifest=read(path.join(bundle,'MANIFEST.json'));
for(const dep of manifest.dependencies)fs.cpSync(path.join(root,dep.path),path.join(app,dep.path),{recursive:true});
for(const file of ['s4-player-catalog.json','s4-player-base-catalog.json','s4-player-profile-registry.json']){const source=path.join(root,'assets/data',file);if(fs.existsSync(source))fs.copyFileSync(source,path.join(app,'assets/data',file));}
fs.mkdirSync(path.join(app,'assets/player-profiles'),{recursive:true});fs.writeFileSync(path.join(app,'assets/player-profiles/r50-private-sentinel.txt'),'preserve private uploads');
const {CampaignService}=await import(pathToFileURL(path.join(app,'campaign-service.mjs')));
const catalog=read(path.join(app,'assets/data/s4-player-catalog.json')),index=read(path.join(app,'assets/data/territory-index.json'));
const savePath=path.join(data,'campaign-accounts.json'),old=new CampaignService({dataPath:savePath,catalog,territoryIndex:index});
const seed=createV22DemoAccounts()[0],home=index.territories.find(t=>t.spawnAllowed&&t.initialOwner.type==='neutral');
old.register('R50验证','isolated-r50-password');const a=old.accountByNickname('R50验证');
Object.assign(a,{setupComplete:true,homeTerritoryId:home.territoryId,gold:250000,draft:seed.draft,playerSquads:seed.playerSquads,tactics:seed.tactics});a.draft.version='ydl-europe-33-v1';
old.world.players[a.id]={playerId:a.id,capitalTerritoryId:home.territoryId,territoryIds:[home.territoryId]};Object.assign(old.world.territories[home.territoryId],{ownerType:'player',ownerId:a.id,capitalOf:a.id,buildings:[]});old.buildings.ensureCapitalHeadquarters(a,old.world,home.territoryId);
old.oil.initialize(a);a.oil.balance=200;old.playerPacks.addPacks(a,'legendary-player-pack',3);
const main=a.draft.roster[0],mainId=main.id??main.playerId;
main.traits=[];main.enhancementTraitIds=[];old.enhancement.applyLevel(main,8);
a.enhancement={requests:{},offers:{},history:[]};
let pending=old.enhancement.offer(a,main);
while(pending){old.enhancement.chooseTrait(a,{offerId:pending.id,traitId:pending.traits[0].id});pending=old.enhancement.pending(a,mainId);}
assert.equal(main.enhancementTraitIds.length,2);
for(const suffix of ['a','b','c']){const material=structuredClone(main);material.id=material.playerId=material.cardInstanceId='r50-material-'+suffix;material.traits=[];material.enhancementTraitIds=[];a.draft.roster.push(material);a.playerSquads.assignments[material.id]='garrison';}
const expectedPacks=old.state(a).inventory.totalPacks;old.persist();
// This test-only preload fixes the enhancement roll in the isolated child. It is never part of the payload.
const preload=path.join(out,'runtime-test-roll.mjs');
fs.writeFileSync(preload,`import {EnhancementService} from ${JSON.stringify(pathToFileURL(path.join(app,'server/application/enhancement-service.mjs')).href)};const original=EnhancementService.prototype.perform;EnhancementService.prototype.perform=function(...args){const saved=this.random;this.random=()=>0;try{return original.apply(this,args);}finally{this.random=saved;}};`);
const before=fs.readFileSync(savePath,'utf8');
const {preflight,applyUpdate,rollbackUpdate}=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const options={bundle,app,data,backupRoot:path.join(out,'runtime-qa-backups'),stop:()=>{},start:()=>{},health:async()=>true,log:()=>{}};
preflight(options);const installed=await applyUpdate(options);assert.equal(fs.readFileSync(savePath,'utf8'),before);
let child,url,logs='',token=a.token;
async function start(){logs='';child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.mjs'],{cwd:app,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-r50-admin-password'},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<300;i++){const m=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){url='http://127.0.0.1:'+m[1];return;}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}throw Error('Runtime start timeout: '+logs);}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
async function api(route,body,expected=200,authorization=token){const response=await fetch(url+'/versus/api/campaign/'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(authorization?{authorization:'Bearer '+authorization}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
const checks=[];
try{
 await start();assert.ok((await fetch(url+'/healthz')).ok);let state=(await api('state')).state;
 assert.equal(state.wallet.gold,250000);assert.equal(state.draft.roster.length,14);assert.equal(state.inventory.totalPacks,expectedPacks);checks.push('R49 account, wallet, +8 card with two traits and inventory survive installed R50 boot');
 let view=await api('enhancement');assert.equal(view.maxLevel,10);assert.deepEqual(view.traitUnlockLevels,[4,7,9,10]);assert.deepEqual(view.equalLevelChances.slice(-2),[18,12]);
 const requests=[],choices=[];
 for(const [suffix,afterLevel,chance] of [['a',9,18],['b',10,7]]){
  const request={requestId:crypto.randomUUID(),mainCardId:mainId,materialCardId:'r50-material-'+suffix,compact:true};requests.push(request);
  const upgraded=await api('enhancement/enhance',request);assert.equal(upgraded.result.afterLevel,afterLevel);assert.equal(upgraded.result.chance,chance);assert.equal(upgraded.result.success,true);assert.equal(upgraded.result.traitOffer.unlockLevel,afterLevel);
  const replay=await api('enhancement/enhance',request);assert.equal(replay.result.id,upgraded.result.id);await api('enhancement/enhance',{...request,materialCardId:'r50-material-c'},409);
  const offer=upgraded.result.traitOffer,choice={offerId:offer.id,traitId:offer.traits[0].id,compact:true};choices.push(choice);
  await api('enhancement/trait',choice);await api('enhancement/trait',choice);
  state=(await api('state')).state;const player=state.draft.roster.find(p=>p.id===mainId);assert.equal(player.enhancementTraitIds.length,afterLevel-6);assert.equal(player.overall,main.baseOverall+(afterLevel===9?15:17));
 }
 checks.push('Actual enhancement HTTP reaches +9 and +10 with third/fourth traits, correct rates and bonuses; retries never consume twice');
 await api('enhancement/enhance',{requestId:crypto.randomUUID(),mainCardId:mainId,materialCardId:'r50-material-c'},400);await api('enhancement',undefined,401,'');
 assert.equal(state.draft.roster.length,12);const ids=state.draft.roster.find(p=>p.id===mainId).enhancementTraitIds;assert.equal(new Set(ids).size,4);checks.push('Cap rejects further enhancement without consuming spare material; APIs require authentication');
 await stop();await start();state=(await api('state')).state;const restored=state.draft.roster.find(p=>p.id===mainId);assert.equal(restored.upgradeLevel,10);assert.deepEqual(restored.enhancementTraitIds,ids);assert.equal(state.draft.roster.length,12);
 assert.equal((await api('enhancement/enhance',requests[1])).result.afterLevel,10);await api('enhancement/trait',choices[1]);assert.equal((await api('enhancement')).traitOffers.length,0);checks.push('Real process restart preserves +10, all four trait IDs and retry receipts without extra rewards');
 const page=await fetch(url+'/versus/');assert.ok(page.ok);assert.match(await page.text(),/game-startup[.]js[?]v=sha256-/);
 for(const route of ['game-startup.js','game-startup.css','client/player-card/card-motion-controller.js','assets/card-frames/shield-v1/enhancement-9-frame.svg','assets/card-frames/shield-v1/enhancement-10-frame.svg','assets/card-frames/shield-v1/enhancement-mask.svg','assets/card-frames/shield-v1/s-redgold-background.svg']){
  const response=await fetch(url+'/versus/'+route);assert.ok(response.ok,route);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(path.join(app,route))).digest('hex'),route);
 }
 assert.equal(fs.readFileSync(path.join(app,'assets/player-profiles/r50-private-sentinel.txt'),'utf8'),'preserve private uploads');checks.push('Public entry, startup bundle and all new effect assets load exact bytes; private uploads preserved');
 await stop();await rollbackUpdate({...options,backup:installed.backup});assert.equal(fs.readFileSync(savePath,'utf8'),before);await start();assert.ok((await fetch(url+'/healthz')).ok);state=(await api('state')).state;assert.equal(state.wallet.gold,250000);assert.equal(state.draft.roster.length,14);assert.equal((await api('enhancement')).maxLevel,8);assert.equal(state.draft.roster.find(p=>p.id===mainId).enhancementTraitIds.length,2);checks.push('Matched R49 code and save rollback restores a healthy +8 server');
 const result={passed:true,platform:process.platform,node:process.version,checks,remoteDeployed:false,scope:'Actual isolated Windows Node servers and HTTP; systemd service hooks mocked; no remote deployment'};fs.writeFileSync(path.join(out,'runtime-qa.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await stop();}
