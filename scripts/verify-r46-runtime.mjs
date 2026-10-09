import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),out=path.join(root,'outputs/hot-update-20260930-r46'),bundle=path.join(out,'yellowdogs-hot-update-20260930-r46'),app=path.join(out,'verified-preflight-fixture/app'),data=path.join(out,'runtime-qa-data');
assert.ok(!fs.existsSync(data),'Do not overwrite QA data');fs.mkdirSync(data);
const manifest=JSON.parse(fs.readFileSync(path.join(bundle,'MANIFEST.json'),'utf8'));
for(const dep of manifest.dependencies)fs.cpSync(path.join(root,dep.path),path.join(app,dep.path),{recursive:true});
for(const file of ['s4-player-catalog.json','s4-player-base-catalog.json','s4-player-profile-registry.json']){const source=path.join(root,'assets/data',file);if(fs.existsSync(source))fs.copyFileSync(source,path.join(app,'assets/data',file));}
fs.mkdirSync(path.join(app,'assets/player-profiles'),{recursive:true});fs.writeFileSync(path.join(app,'assets/player-profiles/r46-private-sentinel.txt'),'keep existing uploads');
const {CampaignService}=await import(pathToFileURL(path.join(app,'campaign-service.mjs')));
const savePath=path.join(data,'campaign-accounts.json'),old=new CampaignService({dataPath:savePath});
old.register('R46检查','isolated-r46-password');const account=old.accountByNickname('R46检查');old.persist();const before=fs.readFileSync(savePath,'utf8');
const {applyUpdate,rollbackUpdate}=await import(pathToFileURL(path.join(bundle,'updater.mjs')));
const options={bundle,app,data,backupRoot:path.join(out,'runtime-qa-backups'),stop:()=>{},start:()=>{},health:async()=>true,log:()=>{}};
const installed=await applyUpdate(options);assert.equal(fs.readFileSync(savePath,'utf8'),before);
let child,url,logs='';
async function start(){logs='';child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-r46-admin-password'},stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<300;i++){const match=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){url='http://127.0.0.1:'+match[1];return;}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}throw Error('Startup timeout');}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
async function checkAccount(){const response=await fetch(url+'/versus/api/campaign/state',{headers:{authorization:'Bearer '+account.token}});assert.equal(response.status,200);const {state}=await response.json();assert.equal(state.playerId,account.id);}
try{
 await start();assert.ok((await fetch(url+'/healthz')).ok);await checkAccount();
 const document=await fetch(url+'/game');assert.equal(document.status,200);const html=await document.text();
 const css=html.match(/href="([^\"]*styles\/map-hud\.css\?v=sha256-[^\"]*)"/);assert.ok(css,'Content-versioned HUD stylesheet in installed page');
 for(const file of manifest.files.filter(f=>f.path!=='index.html')){const response=await fetch(url+'/versus/'+file.path);assert.equal(response.status,200);const source=await response.text();assert.equal(source,fs.readFileSync(path.join(bundle,'payload',file.path),'utf8'));if(file.path.endsWith('.css'))assert.match(response.headers.get('content-type'),/text\/css/);}
 await stop();await start();await checkAccount();assert.equal(fs.readFileSync(path.join(app,'assets/player-profiles/r46-private-sentinel.txt'),'utf8'),'keep existing uploads');
 await stop();await rollbackUpdate({...options,backup:installed.backup});assert.equal(fs.readFileSync(savePath,'utf8'),before);assert.equal(fs.existsSync(path.join(app,'styles/map-hud.css')),false);await start();assert.ok((await fetch(url+'/healthz')).ok);await checkAccount();
 const result={passed:true,platform:process.platform,node:process.version,checks:['R45 save unchanged during apply','Installed R46 server health and authenticated account endpoint','Installed HTML references content-versioned map HUD CSS','All changed JS and CSS served with exact payload bytes; CSS MIME correct','Actual restart preserves account and private assets','Rollback restores R45 code and matching save, removes added CSS, and server boots'],scope:'Actual isolated Windows Node servers and HTTP, mocked systemd hooks, no remote deployment',remoteDeployed:false};fs.writeFileSync(path.join(out,'runtime-qa.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await stop();}
