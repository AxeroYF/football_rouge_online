import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm1-pack-online-'));
const out=process.argv.includes('--recovery')?'outputs/pack-batch-recovery-20261117':process.argv.includes('--after')?'outputs/pack-batch-100-after-20261117':'outputs/pack-batch-100-audit-20261117';fs.mkdirSync(out,{recursive:true});
const paths={VERSUS_ACCOUNTS_PATH:path.join(dir,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(dir,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(dir,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(dir,'studio.json')};
Object.assign(process.env,paths);
let server,browser,stopTraffic=()=>{};
async function start(statePath){
  const child=spawn(process.execPath,['--max-old-space-size=1024','server.mjs'],{windowsHide:true,env:{...process.env,...paths,YELLOWDOGS_LEAGUE_PATH:statePath,APP_ENV:'test',VERSUS_HOST:'127.0.0.1',DEVTOOL_PORT:'0',VERSUS_PUBLIC_ONLY:'0',YFFM_ADMIN_PASSWORD:'isolated-test-password-only'}});
  const exit=new Promise(resolve=>child.once('exit',resolve));let output='',timer;
  server={child,stop:async()=>{if(child.exitCode===null)child.kill();await exit;}};
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${child.pid}).ProcessorAffinity = [intptr]3`],{windowsHide:true});
  const url=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('startup timeout '+output.slice(-1500))),20000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m)resolve(m[0]);});child.stderr.on('data',b=>output+=b);child.once('exit',c=>reject(new Error('server exit '+c+' '+output.slice(-1500))));});
  clearTimeout(timer);server.url=url;return url;
}
const request=async(route,body,token)=>{
  const r=await fetch(server.url+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await r.json();assert.ok(r.ok&&data.ok!==false,JSON.stringify(data).slice(0,500));return data;
};
try{
  await start(paths.YELLOWDOGS_LEAGUE_PATH);
  const accounts=[];
  for(let i=0;i<10;i++){
    const a=await request('/api/versus/register',{nickname:`开包负载${i+1}`,password:'isolated-only'});
    const identity={playerId:a.profile.id,accountToken:a.accountToken};accounts.push({a,identity});
    await request('/api/versus/league/draft/start',{...identity,teamName:`测试球队${i+1}`});
    await request('/api/versus/league/draft/auto',identity);await request('/api/versus/league/draft/finish',identity);
  }
  const admin=await request('/api/admin/login',{password:'isolated-test-password-only'});
  await request('/api/admin/league/s4-packs/grant',{recipientMode:'specified',accountIds:[accounts[0].identity.playerId],packType:'private-mixed',quantity:100},admin.token);
  await server.stop();
  const {YellowDogsLeagueService}=await import('../versus/league-service.js');
  const {LeagueShardStore,unwrapTracked}=await import('../versus/league-shard-store.js');
  const s=new YellowDogsLeagueService({statePath:paths.YELLOWDOGS_LEAGUE_PATH,backupDir:null});
  const owner=accounts[0].identity.playerId,team=s.accountTeam(owner),sample=Object.values(s.state.s4Assets.cards).find(c=>c.ownerId===owner);
  for(let i=0;i<10000;i++){const id=`audit-existing-${i}`;s.state.s4Assets.cards[id]={...structuredClone(sample),id,playerId:team.rosterIds[i%team.rosterIds.length]};}
  for(let i=s.state.s4Assets.transactions.length;i<5000;i++)s.state.s4Assets.transactions.push({id:`audit-existing-tx-${i}`,type:'card-created',playerId:sample.playerId,cardIds:[sample.id],toOwnerId:owner,metadata:{source:'isolated-existing'},createdAt:Date.now()});
  const shardPath=path.join(dir,'shards'),store=new LeagueShardStore(shardPath,{backupDir:null});store.save(unwrapTracked(s.state),{forceFull:true});
  await start(shardPath);
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(a=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(a));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:a.profile.id,mode:'league',leagueTab:'backpack'}));},accounts[0].a);
  await page.goto(server.url+'/versus/');
  const button=page.locator('[data-s4-pack-open-batch="private-mixed"]');await button.waitFor();
  await page.locator('#backpack-batch-count-private-mixed').fill('100');
  await page.evaluate(()=>{window.packAuditLongTasks=[];new PerformanceObserver(list=>window.packAuditLongTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:false});});
  let active=true;stopTraffic=()=>{active=false;};const pings=[];
  const loops=accounts.slice(1).map(async({identity},index)=>{let count=0;while(active){const start=performance.now();try{await request(count++%5===0?'/api/versus/league':'/api/versus/league/head',identity);pings.push({player:index+2,ms:performance.now()-start,ok:true});}catch(e){pings.push({player:index+2,ms:performance.now()-start,ok:false,error:e.message});}await new Promise(r=>setTimeout(r,250));}});
  await new Promise(r=>setTimeout(r,600));
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/packs/open-batch'),{timeout:30000});
  const started=performance.now();await button.click();const response=await responsePromise;
  const responseMs=performance.now()-started,result=await response.json();assert.ok(response.ok(),JSON.stringify(result).slice(0,500));
  assert.equal(result.league.packBatchOpening.results.length,100);
  await page.locator('.s4-pack-batch-results article').first().waitFor();
  const visibleMs=performance.now()-started;assert.equal(await page.locator('.s4-pack-batch-results article').count(),20);
  active=false;await Promise.all(loops);
  const times=pings.map(p=>p.ms).sort((a,b)=>a-b),quantile=q=>times[Math.floor((times.length-1)*q)];
  await page.locator('#league-dialog-overlay').screenshot({path:out+'/online-100-result.png'});
  const report={target:{provider:'Alibaba Cloud',region:'Hong Kong',vCPU:2,ramGiB:2,diskGiB:64,onlinePlayers:10},actual:{environment:'local Windows isolated server',logicalCpuAffinity:2,nodeOldSpaceMiB:1024,wholeMachine2GiBLimit:false,cloudDiskAndHongKongNetwork:false,syntheticExistingCards:10000,syntheticTransactions:5000},requested:100,awarded:100,responseMs,visibleMs,responseBytes:Buffer.byteLength(JSON.stringify(result)),visibleCards:20,background:{players:9,cadenceMs:250,fullViewEvery:5,requests:pings.length,p50:quantile(.5),p95:quantile(.95),max:times.at(-1),errors:pings.filter(p=>!p.ok)},browserLongTasks:await page.evaluate(()=>window.packAuditLongTasks),pageErrors:errors};
  fs.writeFileSync(out+'/online-100.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(process.argv.includes('--recovery')){
    const identity=accounts[0].identity,pendingKey=`yffm_direct_pack_pending_${identity.playerId}`;
    const readView=async()=>(await request('/api/versus/league',identity)).league;
    const cardCount=view=>view.ownTeam.roster.reduce((sum,p)=>sum+p.cards.length,0);
    const currentAdmin=await request('/api/admin/login',{password:'isolated-test-password-only'});
    const grant=async()=>request('/api/admin/league/s4-packs/grant',{recipientMode:'specified',accountIds:[identity.playerId],packType:'private-mixed',quantity:100},currentAdmin.token);
    // Lose the response after the server has committed all rewards.
    await grant();await page.reload();await button.waitFor();
    const beforeCount=cardCount(await readView());let opens=0,queries=0,lostPayload;
    page.on('request',r=>{if(r.url().endsWith('/packs/batch-result'))queries++;});
    await page.route('**/packs/open-batch',async route=>{
      opens++;lostPayload=route.request().postDataJSON();
      const response=await route.fetch();assert.ok(response.ok());await route.abort('connectionreset');
    });
    await button.click();await page.locator('.s4-pack-batch-results article').first().waitFor();
    assert.equal(opens,1);assert.ok(queries>=1);
    assert.equal(cardCount(await readView()),beforeCount+100);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),pendingKey),null);
    await page.unroute('**/packs/open-batch');
    // Reload with a pending record of that committed request: query only.
    await page.evaluate(({key,payload})=>localStorage.setItem(key,JSON.stringify(payload)),{key:pendingKey,payload:lostPayload});
    await page.reload();await page.locator('[data-direct-pack-recover]').click();
    await page.locator('.s4-pack-batch-results article').first().waitFor();
    assert.equal(cardCount(await readView()),beforeCount+100);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),pendingKey),null);
    // Reload with a request that never reached the server: exact safe retry.
    await grant();const fresh=await readView(),packIds=fresh.s4Packs.inventory.filter(p=>p.packType==='private-mixed').map(p=>p.id);
    assert.equal(packIds.length,100);
    const payload={requestId:'browser-unsent-100',packIds,packType:'private-mixed'};
    await page.evaluate(({key,payload})=>localStorage.setItem(key,JSON.stringify(payload)),{key:pendingKey,payload});
    await page.reload();await page.locator('[data-direct-pack-recover]').click();
    await page.locator('.s4-pack-batch-results article').first().waitFor();
    assert.equal(cardCount(await readView()),beforeCount+200);
    // The latest completed results remain available after another reload.
    await page.reload();await page.locator('[data-direct-pack-last]').click();
    await page.locator('.s4-pack-batch-results article').first().waitFor();
    assert.equal(await page.locator('.s4-pack-batch-results article').count(),20);
    await page.locator('[data-pack-batch-page="next"]').click();
    assert.match(await page.locator('.s4-pack-batch-pager').textContent(),/2 \/ 5/);
    await page.locator('#league-dialog-overlay').screenshot({path:out+'/recovered-result.png'});
    assert.deepEqual(errors,[]);
    const recovery={lostResponseRecovered:true,reloadCommittedRecovered:true,reloadUnsentRetried:true,lastResultAvailable:true,pagination20:true,duplicateRewards:0,pageErrors:errors};
    fs.writeFileSync(out+'/recovery.json',JSON.stringify(recovery,null,2));console.log(JSON.stringify(recovery,null,2));
  }
}finally{stopTraffic();await browser?.close();await server?.stop();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'yffm1-pack-online-'));fs.rmSync(dir,{recursive:true,force:true});}
