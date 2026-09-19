import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const bundle=path.resolve(process.argv[2]);
const app=path.join(bundle,'app');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-aliyun-qa-'));
const source=path.join(data,'s4-source.json');
const password='isolated-test-password',salt=crypto.randomBytes(16);
fs.writeFileSync(source,JSON.stringify({accounts:{old:{id:'qa-s4',nickname:'qa-old',createdAt:1,passwordHash:'scrypt$'+salt.toString('base64url')+'$'+crypto.scryptSync(password,salt,64).toString('base64url'),gold:1000000,resources:{fans:999999,production:99999},setupComplete:true,draft:{roster:[{}]}}}}),{mode:0o600});
let child,base,token,requests=0;
const checks=[];
async function start(){
  child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,NODE_ENV:'production',CAMPAIGN_DEV_TOOLS:'1',HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:crypto.randomBytes(24).toString('hex')},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<300;i++){
    const match=logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){base='http://127.0.0.1:'+match[1];return;}
    if(child.exitCode!=null)throw Error('Runtime failed: '+logs);
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error('Runtime start timeout');
}
async function stop(){if(child&&child.exitCode==null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
async function api(route,body){
  const response=await fetch(base+'/versus/api/campaign/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});requests++;
  const value=await response.json();assert.equal(response.status,200,route+': '+JSON.stringify(value));return value;
}
try{
 const seed=path.join(bundle,'seed/campaign-accounts.json');
 const seedData=JSON.parse(fs.readFileSync(seed,'utf8'));
 const importReport=JSON.parse(fs.readFileSync(path.join(bundle,'S4_ACCOUNT_IMPORT.json'),'utf8'));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(seed)).digest('hex'),importReport.seedSha256);
 assert.equal(Object.keys(seedData.accounts).length,11);assert.equal(seedData.world,null);
 const seedImporter=spawn(process.execPath,['scripts/import-s4-accounts.mjs',seed,path.join(data,'campaign-accounts.json')],{cwd:app,stdio:'ignore'});
 assert.equal((await once(seedImporter,'exit'))[0],0);
 for(let boot=0;boot<2;boot++){
  await start();
  assert.equal((await fetch(base+'/versus/seed/campaign-accounts.json')).status,404);
  assert.equal((await fetch(base+'/seed/campaign-accounts.json')).status,404);
  const saved=JSON.parse(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'));
  assert.deepEqual(Object.keys(saved.accounts).sort(),Object.keys(seedData.accounts).sort());
  for(const [id,old] of Object.entries(seedData.accounts)){
   const current=saved.accounts[id];
   assert.equal(current.nickname,old.nickname);assert.equal(current.passwordHash,old.passwordHash);
   assert.equal(current.token,null);assert.equal(current.setupComplete,false);assert.equal(current.draft,null);
   assert.equal(current.gold,20000);assert.equal(current.resources.fans,8000);
   assert.equal(current.homeTerritoryId,null);assert.equal(current.inventory.packs['rare-player-pack'],0);
   assert.ok(!Object.hasOwn(old,'gold')&&!Object.hasOwn(old,'resources')&&!Object.hasOwn(old,'inventory')&&!Object.hasOwn(old,'launchRewards'));
  }
  await stop();
 }
 checks.push('all 11 bundled S4 identities and password hashes retained across two real Linux boots; fresh 20000 gold and 8000 fans; seed URLs denied');
 // Continue the password-login and gameplay test with a synthetic credential in the same isolated temporary directory.
 fs.unlinkSync(path.join(data,'campaign-accounts.json'));
 const importer=spawn(process.execPath,['scripts/import-s4-accounts.mjs',source,path.join(data,'campaign-accounts.json')],{cwd:app,stdio:'ignore'});
 assert.equal((await once(importer,'exit'))[0],0);
 const fog=await import(pathToFileURL(path.join(app,'shared/config/fog.mjs')));
 assert.ok(Object.values(fog).some(v=>v?.radius===9));checks.push('fog radius 9');
 await start();
 for(const route of ['/versus/','/versus/app.js','/versus/styles.css','/versus/client/core/request-id.js','/assets/data/s4-player-catalog.json','/versus/assets/data/territory-index.json','/healthz']){
  const response=await fetch(base+route);assert.equal(response.status,200,route);await response.arrayBuffer();requests++;
 }
 for(const route of ['/','/versus']){const response=await fetch(base+route,{redirect:'manual'});assert.equal(response.status,308);assert.equal(response.headers.get('location'),'/versus/');}
 for(const route of ['/versus/data/campaign-accounts.json','/data/campaign-accounts.json','/versus/server.mjs'])assert.equal((await fetch(base+route)).status,404);
 checks.push('prefixed HTML, JS, CSS, module and assets; redirects; private files denied');
 let session=await api('login',{nickname:'qa-old',password});token=session.token;
 assert.equal(session.state.wallet.gold,20000);assert.equal(session.state.resources.balances.fans,8000);assert.equal(session.state.setupComplete,false);
 assert.equal(session.state.development.enabled,false);assert.equal(session.state.development.fogEnabled,true);assert.equal(session.state.conquest.limit,8);
 const fogAttempt=await fetch(base+'/versus/api/campaign/development/fog',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({enabled:false})});assert.equal(fogAttempt.status,403);
 checks.push('S4 credentials preserved; developer resources discarded; production fog locked even with dev env flag');
 let state=(await api('draft/start',{teamName:'QA Club'})).state;
 for(let pick=0;!state.setupComplete&&pick<33;pick++){
  state=(await api('draft/open',{pool:state.draft.availablePools[0],pickNumber:state.draft.pickNumber})).state;
  state=(await api('draft/choose',{playerId:state.draft.offer[0].id,offerId:state.draft.offerId})).state;
 }
 assert.equal(state.setupComplete,true);assert.equal(state.draft.roster.length,33);
 const count=(s,type)=>s.inventory.packs.find(p=>p.type===type).count;
 assert.equal(count(state,'rare-player-pack'),2);assert.equal(count(state,'exotic-player-pack'),1);
 const index=JSON.parse(fs.readFileSync(path.join(app,'assets/data/territory-index.json'),'utf8'));
 const home=index.territories.find(t=>t.spawnAllowed&&t.initialOwner?.type==='neutral');assert.ok(home);
 state=(await api('home/claim',{territoryId:home.territoryId})).state;
 assert.equal(state.neutralRewards.pending.filter(r=>r.source==='launch').length,1);assert.equal(state.neutralRewards.pending.find(r=>r.source==='launch').amount,400);
 checks.push('real 33-player HTTP draft grants 2 rare and 1 exotic pack; HQ grants 400 supplement');
 await stop();await start();session=await api('login',{nickname:'qa-old',password});token=session.token;state=session.state;
 assert.equal(state.wallet.gold,20000);assert.equal(state.resources.balances.fans,8000);assert.equal(count(state,'rare-player-pack'),2);assert.equal(count(state,'exotic-player-pack'),1);assert.equal(state.neutralRewards.pending.filter(r=>r.source==='launch').length,1);
 checks.push('real runtime restart retains balance, packs, HQ and supplement without duplicate grants');
 const fresh=await api('register',{nickname:'qa-fresh',password});assert.equal(fresh.state.wallet.gold,20000);assert.equal(fresh.state.resources.balances.fans,8000);
 checks.push('fresh registration matches imported fresh account resources');
 const report={passed:true,bundledAccountsVerified:11,actualPlayerPasswordsUsed:false,node:process.version,platform:process.platform,arch:process.arch,requests,checks,at:new Date().toISOString(),remoteDeploymentPerformed:false};
 fs.writeFileSync(path.join(bundle,'QA.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await stop();fs.rmSync(data,{recursive:true,force:true});}
