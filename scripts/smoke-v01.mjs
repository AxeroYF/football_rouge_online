import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const app=path.resolve(process.argv[2]);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'yellowdogs-v01-smoke-'));
const { convertS4Accounts }=await import(pathToFileURL(path.join(app,'shared/account-import/s4-accounts.mjs')));
const password='test-fixture-only',salt=crypto.randomBytes(16);
const source={accounts:{fixture:{id:'S4-QA',nickname:'离线验收',passwordHash:'scrypt$'+salt.toString('base64url')+'$'+crypto.scryptSync(password,salt,64).toString('base64url'),createdAt:1}}};
fs.writeFileSync(path.join(directory,'campaign-accounts.json'),JSON.stringify(convertS4Accounts(source)));
let child,base,log='',requests=0,peakRssKB=0;
async function start(){
  log='';
  child=spawn(process.execPath,[path.join(app,'server.mjs')],{cwd:app,env:{...process.env,NODE_ENV:'production',PORT:'0',HOST:'127.0.0.1',DATA_DIR:directory,ADMIN_BOOTSTRAP_PASSWORD:'isolated-qa-admin-password'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
  for(let attempt=0;attempt<120;attempt++){
    const match=log.match(/game: http:\/\/127\.0\.0\.1:(\d+)\/game/);
    if(match){base='http://127.0.0.1:'+match[1];return;}
    if(child.exitCode!==null)throw Error('Package failed to boot: '+log);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Package startup timed out: '+log);
}
async function stop(){
  if(!child||child.exitCode!==null)return;
  const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
  const timeout=setTimeout(()=>child.kill('SIGKILL'),15000);
  await exit;clearTimeout(timeout);
  assert.equal(child.exitCode,0,'graceful package shutdown');
}
async function json(url,body,token){
  requests++;
  const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  const data=await r.json();assert.equal(r.status,200,url+': '+JSON.stringify(data).slice(0,200));return data;
}
function memory(){
  if(process.platform==='linux'){
    const value=fs.readFileSync('/proc/'+child.pid+'/status','utf8').match(/VmRSS:\s+(\d+)/);
    peakRssKB=Math.max(peakRssKB,Number(value?.[1]??0));
  }
}
try{
  await start();memory();
  assert.equal((await json('/healthz')).version,'0.1.0');
  let login=await json('/api/campaign/login',{nickname:'离线验收',password});
  assert.equal(login.state.setupComplete,false);
  const token=login.token;
  for(const url of ['/data/campaign-accounts.json','/data/admin-state.json','/server.mjs','/server/application/admin-service.mjs','/seed/campaign-accounts.json','/node_modules/three/package.json','/deploy/install.sh']){
    assert.equal((await fetch(base+url)).status,404,url);requests++;
  }
  for(const url of ['/game','/game/','/admin','/admin/','/assets/map-relief/relief-mesh/svalbard.bin','/client/core/request-id.js','/assets/data/territory-index.json','/assets/vendor/three/three.module.js']){
    const r=await fetch(base+url);assert.equal(r.status,200,url);await r.arrayBuffer();requests++;
  }
  await json('/api/campaign/draft/start',{teamName:'离线验收队'},token);
  const opened=await json('/api/campaign/draft/open',{pool:'ATT',pickNumber:1},token);
  assert.equal(opened.state.draft.offer.length,3);
  const chosen=await json('/api/campaign/draft/choose',{playerId:opened.state.draft.offer[0].id,offerId:opened.state.draft.offerId},token);
  assert.equal(chosen.state.draft.roster.length,1);
  const wrong=await fetch(base+'/api/campaign/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nickname:'离线验收',password:'wrong'})});
  assert.ok(wrong.status>=400);requests++;
  const admin=await json('/api/admin/login',{username:'admin',password:'isolated-qa-admin-password'});
  assert.ok(admin.token);
  const timings=[];
  for(let group=0;group<5;group++)await Promise.all(Array.from({length:4},async()=>{
    const begin=performance.now();await json('/api/campaign/state',null,token);timings.push(performance.now()-begin);
  }));
  memory();timings.sort((a,b)=>a-b);
  await stop();await start();
  login=await json('/api/campaign/login',{nickname:'离线验收',password});
  assert.equal(login.state.draft.roster.length,1,'selection persists after process restart');
  memory();await stop();
  const report={status:'passed',platform:process.platform,node:process.version,requests,parallelStateRequests:4,
    stateP50Ms:Math.round(timings[Math.floor(timings.length*.5)]),stateP95Ms:Math.round(timings[Math.floor(timings.length*.95)]),
    sampledPeakRssMB:Math.round(peakRssKB/1024),realS4PasswordsUsed:false,realSavesModified:false,remoteServerContacted:false};
  console.log(JSON.stringify(report));
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  fs.rmSync(directory,{recursive:true,force:true});
}
