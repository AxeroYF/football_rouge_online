import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createV22DemoAccounts} from '../engine/v2.2/demo-fixture.mjs';
const root=process.cwd(),out=path.join(root,'outputs/hot-update-20260930-r48'),bundle=path.join(out,'yellowdogs-hot-update-20260930-r48');
const app=path.join(out,'verified-preflight-fixture/app'),data=path.join(out,process.argv[2]||'runtime-qa-data');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
assert.ok(!fs.existsSync(data),'Never overwrite QA saves');fs.mkdirSync(data);
const manifest=read(path.join(bundle,'MANIFEST.json'));
for(const dep of manifest.dependencies)fs.cpSync(path.join(root,dep.path),path.join(app,dep.path),{recursive:true});
for(const file of ['s4-player-catalog.json','s4-player-base-catalog.json','s4-player-profile-registry.json']){const source=path.join(root,'assets/data',file);if(fs.existsSync(source))fs.copyFileSync(source,path.join(app,'assets/data',file));}
fs.mkdirSync(path.join(app,'assets/player-profiles'),{recursive:true});fs.writeFileSync(path.join(app,'assets/player-profiles/r48-private-sentinel.txt'),'preserve private uploads');
const {CampaignService}=await import(pathToFileURL(path.join(app,'campaign-service.mjs')));
const catalog=read(path.join(app,'assets/data/s4-player-catalog.json')),index=read(path.join(app,'assets/data/territory-index.json'));
const savePath=path.join(data,'campaign-accounts.json'),old=new CampaignService({dataPath:savePath,catalog,territoryIndex:index});
const seed=createV22DemoAccounts()[0],home=index.territories.find(t=>t.spawnAllowed&&t.initialOwner.type==='neutral');
old.register('R48验证','isolated-r48-password');const a=old.accountByNickname('R48验证');
Object.assign(a,{setupComplete:true,homeTerritoryId:home.territoryId,gold:250000,draft:seed.draft,playerSquads:seed.playerSquads,tactics:seed.tactics});a.draft.version='ydl-europe-33-v1';
old.world.players[a.id]={playerId:a.id,capitalTerritoryId:home.territoryId,territoryIds:[home.territoryId]};Object.assign(old.world.territories[home.territoryId],{ownerType:'player',ownerId:a.id,capitalOf:a.id,buildings:[]});old.buildings.ensureCapitalHeadquarters(a,old.world,home.territoryId);
old.oil.initialize(a);a.oil.balance=200;old.playerPacks.addPacks(a,'legendary-player-pack',3);
old.formationResearch.mutate(a,'start-topic',{topicId:'biology:match-endurance',revision:0});a.formationResearch.active.completed=199;
a.pendingNeutralRewards=[{id:'r48-research-reward',kind:'research',amount:10000,status:'pending',receivedAt:Date.now()}];const expectedPacks=old.state(a).inventory.totalPacks;old.persist();
const before=fs.readFileSync(savePath,'utf8');
const {preflight,applyUpdate,rollbackUpdate}=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const options={bundle,app,data,backupRoot:path.join(out,'runtime-qa-backups'),stop:()=>{},start:()=>{},health:async()=>true,log:()=>{}};
preflight(options);const installed=await applyUpdate(options);assert.equal(fs.readFileSync(savePath,'utf8'),before);
let child,url,logs='',token=a.token;
async function start(){logs='';child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-r48-admin-password'},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<300;i++){const m=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){url='http://127.0.0.1:'+m[1];return;}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}throw Error('Runtime start timeout: '+logs);}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
async function api(route,body,expected=200,authorization=token){const response=await fetch(url+'/versus/api/campaign/'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(authorization?{authorization:'Bearer '+authorization}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
const checks=[];
try{
 await start();assert.ok((await fetch(url+'/healthz')).ok);let state=(await api('state')).state;
 assert.equal(state.wallet.gold,250000);assert.equal(state.draft.roster.length,11);assert.equal(state.inventory.totalPacks,expectedPacks);checks.push('R47 account, wallet, roster, packs and active research survive installed server boot');
 const request={requestId:crypto.randomUUID(),kind:'pack',itemId:'common-player-pack',compact:true};
 const bought=await api('shop/buy',request);assert.equal(bought.state,undefined);assert.equal(bought.statePatch.draft,undefined);assert.equal(bought.statePatch.world,undefined);assert.equal(bought.statePatch.wallet.gold,249000);assert.equal(bought.statePatch.inventory.totalPacks,expectedPacks+1);
 const replay=await api('shop/buy',request);assert.equal(replay.statePatch.wallet.gold,249000);assert.equal(replay.statePatch.inventory.totalPacks,expectedPacks+1);checks.push('Real compact pack purchase is idempotent and omits full map and roster');
 const shop=(await api('shop')).shop,legend=await api('shop/buy',{requestId:crypto.randomUUID(),kind:'player',itemId:shop.offers[0].id,rotationId:shop.rotationId,currency:'oil',compact:true});
 assert.equal(legend.rosterDelta.cards.length,1);assert.equal(legend.rosterDelta.cards[0].upgradeLevel,3);assert.equal(legend.statePatch.resources.oil.balance,50);checks.push('Existing oil legend purchase returns exactly one enhanced player delta');
 await api('shop/buy',{requestId:crypto.randomUUID(),kind:'pack',itemId:'common-player-pack',currency:'oil',compact:true},400);checks.push('Proposed pack oil pricing remains disabled');
 const pack=await api('inventory/packs/open',{packType:'legendary-player-pack',compact:true}),opening=pack.statePatch.inventory.pendingOpening;
 const choice=await api('inventory/packs/choose',{openingId:opening.id,playerId:opening.cards[0].playerId??opening.cards[0].id,compact:true});assert.equal(pack.state,undefined);assert.equal(choice.state,undefined);assert.equal(choice.statePatch.inventory.pendingOpening,null);assert.equal(choice.rosterDelta.cards.length,1);assert.equal((await api('state')).state.draft.roster.length,13);checks.push('Compact open and choose return one card delta, retain remaining packs and avoid full-state responses');
 state=(await api('state')).state;
 await api('rewards/research',{rewardId:'r48-research-reward',jobId:state.formationResearch.active.id});state=(await api('state')).state;
 const notice=state.formationResearch.completionNotices[0];assert.equal(notice.topicId,'biology:match-endurance');assert.equal(notice.level,1);
 const continued=await api('research/continue-notice',{noticeId:notice.id,revision:state.formationResearch.revision,compact:true});assert.equal(continued.statePatch.formationResearch.active.level,2);assert.equal(continued.statePatch.formationResearch.completionNotices.length,0);
 await api('rewards/research',{rewardId:'r48-research-reward',jobId:continued.statePatch.formationResearch.active.id});checks.push('Real research completion and continue APIs retain notices and start the same next level');
 await stop();await start();state=(await api('state')).state;const completed=state.formationResearch.completionNotices[0];assert.equal(completed.level,2);assert.equal(state.wallet.gold,249000);assert.equal(state.draft.roster.length,13);checks.push('Actual process restart preserves purchases and unread completed research');
 const acknowledged=await api('research/read-notice',{noticeId:completed.id,revision:state.formationResearch.revision,compact:true});assert.equal(acknowledged.statePatch.formationResearch.completionNotices.length,0);assert.equal(acknowledged.statePatch.formationResearch.topicLevels['biology:match-endurance'],2);
 await api('research/read-notice',{noticeId:completed.id,revision:-1,compact:true});await api('research/read-notice',{noticeId:completed.id,revision:0,compact:true},401,'');checks.push('Acknowledgement keeps research levels, retries safely and requires authentication');
 const page=await fetch(url+'/versus/');assert.ok(page.ok);assert.match(await page.text(),/game-startup[.]js[?]v=sha256-/);checks.push('Installed public entry serves the generated startup bundle');
 for(const route of ['game-startup.js','game-startup.css','client/shop/shop-controller.js','client/inventory/inventory-controller.js','client/buildings/construction-notifications.js','styles/inventory.css','client/core/merge-roster-delta.js'])assert.ok((await fetch(url+'/versus/'+route)).ok,route);
 assert.equal(fs.readFileSync(path.join(app,'assets/player-profiles/r48-private-sentinel.txt'),'utf8'),'preserve private uploads');checks.push('Updated assets load and private uploads remain intact');
 await stop();await rollbackUpdate({...options,backup:installed.backup});assert.equal(fs.readFileSync(savePath,'utf8'),before);await start();assert.ok((await fetch(url+'/healthz')).ok);state=(await api('state')).state;assert.equal(state.wallet.gold,250000);assert.equal(state.draft.roster.length,11);checks.push('Matched R47 code and save rollback restores a healthy server');
 const result={passed:true,platform:process.platform,node:process.version,checks,remoteDeployed:false,scope:'Actual isolated Windows Node servers and HTTP; systemd service hooks mocked; no remote deployment'};fs.writeFileSync(path.join(out,'runtime-qa.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await stop();}
