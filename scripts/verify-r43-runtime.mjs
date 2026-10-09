import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),out=path.join(root,'outputs/hot-update-20260928-r43-final'),bundle=path.join(out,'yellowdogs-hot-update-20260928-r43');
const fixture=path.join(out,'verified-preflight-fixture'),app=path.join(fixture,'app'),data=path.join(out,'runtime-qa-data-final');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
assert.ok(!fs.existsSync(data),'Do not overwrite an existing runtime fixture');fs.mkdirSync(data);
const manifest=read(path.join(bundle,'MANIFEST.json'));
for(const dep of manifest.dependencies)fs.cpSync(path.join(root,dep.path),path.join(app,dep.path),{recursive:true});
// Protected player content stands in for the existing server library; it is never packaged.
for(const file of ['s4-player-catalog.json','s4-player-base-catalog.json','s4-player-profile-registry.json']){const source=path.join(root,'assets/data',file);if(fs.existsSync(source))fs.copyFileSync(source,path.join(app,'assets/data',file));}
fs.mkdirSync(path.join(app,'assets/player-profiles'),{recursive:true});fs.writeFileSync(path.join(app,'assets/player-profiles/r43-private-sentinel.txt'),'preserve uploads');
const {CampaignService}=await import(pathToFileURL(path.join(app,'campaign-service.mjs')));
const catalog=read(path.join(app,'assets/data/s4-player-catalog.json')),index=read(path.join(app,'assets/data/territory-index.json'));
const old=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index});
old.register('R43升级验证','isolated-r43-password');const account=old.accountByNickname('R43升级验证'),home=index.territories.find(t=>t.spawnAllowed&&t.initialOwner.type==='neutral');
const roster=[['GK',2],['DEF',8],['MID',6],['ATT',6]].flatMap(([pool,count])=>structuredClone(catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,count)));
Object.assign(account,{setupComplete:true,homeTerritoryId:home.territoryId,gold:123456,draft:{version:'ydl-europe-33-v1',teamName:'升级验证队',roster},playerSquads:{schemaVersion:2,assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i%2?'garrison':'expedition']))}});
old.world.players[account.id]={playerId:account.id,capitalTerritoryId:home.territoryId,territoryIds:[home.territoryId]};Object.assign(old.world.territories[home.territoryId],{ownerType:'player',ownerId:account.id,capitalOf:account.id,buildings:[]});old.buildings.ensureCapitalHeadquarters(account,old.world,home.territoryId);const trainingCenter=old.buildings.createRecord('training-center');trainingCenter.level=5;old.world.territories[home.territoryId].buildings.push(trainingCenter);old.save();

const before=fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8');
const {preflight,applyUpdate,rollbackUpdate}=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const options={bundle,app,data,backupRoot:path.join(out,'runtime-qa-backups'),stop:()=>{},start:()=>{},health:async()=>true,log:()=>{}};
preflight(options);const installed=await applyUpdate(options);assert.equal(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'),before);
let child,url,logs='',token;
async function start(){logs='';child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-r43-admin-password'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<300;i++){const match=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){url='http://127.0.0.1:'+match[1];return;}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}throw Error('Runtime start timeout: '+logs);}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
async function api(route,body){const response=await fetch(url+'/versus/api/campaign/'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
const checks=[];
try{
 await start();assert.ok((await fetch(url+'/healthz')).ok);
 const login=await api('login',{nickname:'R43升级验证',password:'isolated-r43-password'});token=login.token;
 const state=(await api('state')).state;assert.equal(state.wallet.gold,123456);assert.equal(state.draft.roster.length,22);checks.push('R42 account login, wallet and roster preserved after upgrade');
 const unauth=await fetch(url+'/versus/api/campaign/player-ladder');assert.equal(unauth.status,401);checks.push('Leaderboard requires authenticated access');
 const center=await api('training/center?territoryId='+home.territoryId+'&buildingId='+trainingCenter.id);assert.equal(center.capacity,5);
 const candidate=center.players.find(p=>p.pool==='ATT'&&p.canTrain&&p.canAfford);
 const started=await api('training/start',{territoryId:home.territoryId,buildingId:trainingCenter.id,pool:'ATT',slot:0,playerId:candidate.playerId,requestId:'r43-runtime-training'});
 assert.ok(started.state.training.tasks.some(t=>t.id===started.task.id));
 const cancelled=await api('training/cancel',{taskId:started.task.id});assert.equal(cancelled.state.wallet.gold,123456);assert.ok(!cancelled.state.training.tasks.some(t=>t.id===started.task.id));
 checks.push('Installed training details, start and cancel return authoritative state and refund exactly');
 const first=(await api('player-ladder')).ladder;assert.equal(first.entries.length,22);assert.equal(first.entries[0].owner.id,account.id);for(let i=1;i<first.entries.length;i++)assert.ok(first.entries[i-1].score>=first.entries[i].score);
 const next=(await api('player-ladder')).ladder;assert.equal(next.generatedAt,first.generatedAt);assert.deepEqual(next.entries,first.entries);checks.push('Installed ladder endpoint returns owned cards in descending order and reuses cache');
 for(const route of ['client/cards/player-ladder-controller.js','client/core/adaptive-poller.js','client/social/club-presentation.js','client/share/roster-poster.js','client/share/dom-image.js','styles/club-studio.css','styles/player-ladder.css'])assert.ok((await fetch(url+'/versus/'+route)).ok,route);checks.push('New browser modules and styles served from installed payload');
 await stop();await start();assert.equal((await api('player-ladder')).ladder.entries.length,22);checks.push('Server restarts successfully and reconstructs leaderboard');
 assert.equal(fs.readFileSync(path.join(app,'assets/player-profiles/r43-private-sentinel.txt'),'utf8'),'preserve uploads');checks.push('Protected uploaded content preserved');
 await stop();await rollbackUpdate({...options,backup:installed.backup});assert.equal(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'),before);
 await start();assert.ok((await fetch(url+'/healthz')).ok);token=(await api('login',{nickname:'R43升级验证',password:'isolated-r43-password'})).token;assert.equal((await api('state')).state.wallet.gold,123456);checks.push('Matched R42 code/save restored and old server starts successfully');
 const report={passed:true,platform:process.platform,node:process.version,checks,remoteDeployed:false,scope:'Real Windows Node server starts and HTTP requests; updater service hooks mocked; no Linux systemd deployment'};fs.writeFileSync(path.join(out,'runtime-qa.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await stop();}
