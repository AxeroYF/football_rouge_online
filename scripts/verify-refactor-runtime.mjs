import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-refactor-runtime-'));
let child;
async function stop(){
  if(!child||child.exitCode!==null)return;
  const ended=once(child,'exit');child.kill();await ended;child=null;
}
async function boot(){
  child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,NODE_ENV:'test'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  return new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('Isolated server startup timed out')),45000);
    const fail=error=>{clearTimeout(timer);reject(error);};
    child.once('error',fail);child.once('exit',code=>fail(Error(`Server exited ${code}: ${output.slice(-1000)}`)));
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/game: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.stderr.on('data',chunk=>{output+=chunk;});
  });
}
async function json(base,route,{method='GET',body,token}={}){
  const response=await fetch(base+route,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,route);return response.json();
}
try{
  let base=await boot();assert.equal((await json(base,'/healthz')).status,'ok');
  const credentials={nickname:'隔离重构验证',password:'isolated-refactor-test-only'};
  const registration=await json(base,'/api/campaign/register',{method:'POST',body:credentials});
  const saved=JSON.parse(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'));
  assert.ok(saved.accounts[registration.profile.id]);assert.equal(saved.version,4);
  const before=await json(base,'/api/campaign/state',{token:registration.token});
  // A successful command must survive process termination without a final save.
  await stop();base=await boot();
  const login=await json(base,'/api/campaign/login',{method:'POST',body:credentials});
  assert.equal(login.profile.id,registration.profile.id);assert.equal(login.state.wallet.gold,before.state.wallet.gold);
  const page=await fetch(base+'/game');assert.equal(page.status,200);assert.match(await page.text(),/topbar-team/);
  for(const route of ['/shared/geo/projection.js','/client/tactics/tactics-state.js','/client/core/feature-navigation.js','/engine/s4-v2.1/versus/v2/dot-replay-v2.js'])assert.equal((await fetch(base+route)).status,200,route);
  const report={passed:true,health:true,httpRegisterLogin:true,saveVersion:4,restartIdentity:true,restartWallet:true,newStaticModules:true};
  const out=path.join(root,'outputs/refactor-runtime-report.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await stop();}
