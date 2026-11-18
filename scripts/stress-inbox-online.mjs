import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-inbox-load-'));
const paths={VERSUS_ACCOUNTS_PATH:path.join(dir,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(dir,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(dir,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(dir,'studio.json')};
Object.assign(process.env,paths);
const predictionAfter=process.argv.includes('--prediction-after');
const out=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)??(predictionAfter?'outputs/prediction-load-after-20261117':process.argv.includes('--profile')?'outputs/inbox-load-profile-20261117':process.argv.includes('--after')?'outputs/inbox-load-after-20261117':'outputs/inbox-load-20261117');fs.mkdirSync(out,{recursive:true});
let server,limiter;
async function start(statePath=paths.YELLOWDOGS_LEAGUE_PATH,metricsPath=null){
  const child=spawn(process.execPath,[...(process.argv.includes('--profile')?['--cpu-prof',`--cpu-prof-dir=${path.resolve(out)}`]:[]),'--max-old-space-size=1024','--import',pathToFileURL(path.resolve('scripts/inbox-load-metrics.mjs')).href,'server.mjs'],{windowsHide:true,env:{...process.env,...paths,YELLOWDOGS_LEAGUE_PATH:statePath,INBOX_LOAD_METRICS:metricsPath ?? '',APP_ENV:'test',VERSUS_HOST:'127.0.0.1',DEVTOOL_PORT:'0',VERSUS_PUBLIC_ONLY:'0',YFFM_ADMIN_PASSWORD:'isolated-test-password-only'}});
  const exit=new Promise(resolve=>child.once('exit',resolve));let output='',timer;
  server={child,stop:async()=>{if(child.exitCode===null)child.kill();await exit;if(limiter){await limiter.exit;limiter=null;}}};
  try{server.url=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('startup timeout '+output.slice(-1000))),20000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m)resolve(m[0]);});child.stderr.on('data',b=>output+=b);child.once('error',reject);child.once('exit',c=>reject(new Error(`server exit ${c}: ${output.slice(-1000)}`)));});}
  finally{clearTimeout(timer);}
  if(process.platform==='win32'){
    const guard=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/inbox-load-limits.ps1'),'-TargetProcessId',String(child.pid)],{windowsHide:true});
    limiter={child:guard,exit:new Promise(resolve=>guard.once('exit',resolve))};
    await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('resource limiter timeout')),15000);
      guard.stdout.on('data',chunk=>{text+=chunk;if(text.includes('RESOURCE_LIMITS_READY')){clearTimeout(timer);resolve();}});
      guard.stderr.on('data',chunk=>text+=chunk);guard.once('error',reject);guard.once('exit',code=>{clearTimeout(timer);reject(new Error(`limiter exit ${code}: ${text}`));});});
  } else throw new Error('This local harness requires Windows Job Objects; use the documented Linux limits on the target host.');

}
async function post(route,body){
  const response=await fetch(server.url+'/api/versus'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const value=await response.json();assert.ok(response.ok&&value.ok!==false,JSON.stringify(value).slice(0,500));return value;
}
const results=[];
const diskBytes=folder=>fs.readdirSync(folder,{withFileTypes:true}).reduce((sum,e)=>sum+(e.isDirectory()?diskBytes(path.join(folder,e.name)):fs.statSync(path.join(folder,e.name)).size),0);
const stats=values=>{const v=[...values].sort((a,b)=>a-b);return {count:v.length,p50:v[Math.floor((v.length-1)*.5)]??0,p95:v[Math.floor((v.length-1)*.95)]??0,max:v.at(-1)??0};};
try{
  await start();
  const accounts=[];
  for(let i=0;i<10;i++){
    const a=await post('/register',{nickname:`收件箱负载${i+1}`,password:'isolated-only'});
    const identity={playerId:a.profile.id,accountToken:a.accountToken};accounts.push(identity);
    await post('/league/draft/start',{...identity,teamName:`邮件负载队${i+1}`});await post('/league/draft/auto',identity);await post('/league/draft/finish',identity);
  }
  await server.stop();
  const {YellowDogsLeagueService}=await import('../versus/league-service.js');
  const {LeagueShardStore,unwrapTracked}=await import('../versus/league-shard-store.js');
  const base=JSON.parse(fs.readFileSync(paths.YELLOWDOGS_LEAGUE_PATH,'utf8'));
  for(const count of (process.argv.includes('--profile')||process.argv.includes('--heavy-only')?[2000]:[100,500,2000])){
    fs.writeFileSync(paths.YELLOWDOGS_LEAGUE_PATH,JSON.stringify(base));
    const service=new YellowDogsLeagueService({statePath:paths.YELLOWDOGS_LEAGUE_PATH,backupDir:null,pagedInbox:true});
    const now=Date.now();service.state.friendlyInvitations=[];service.state.dailyAutomation.enabled=false;
    if(predictionAfter){
      // Guarantee a cold market during the measured background tick, even near the daily deadline.
      service.state.matchPredictions={schemaVersion:1,markets:{},bets:[],distributions:[]};
      service.state.season.nextRoundAt=now+3600000;
    }
    for(const identity of accounts){
      const team=service.accountTeam(identity.playerId);service.state.inbox[team.id]=[];
      for(let i=0;i<count;i++){
        const id=`load-${team.id}-${String(i).padStart(5,'0')}`,pending=i<count-1;
        if(pending)service.state.friendlyInvitations.push({id,status:'pending',fromOwnerId:'synthetic-source',fromTeamId:'synthetic-source',toOwnerId:team.ownerId,toTeamId:team.id,createdAt:now,expiresAt:now+7200000});
        service.state.inbox[team.id].push({id,type:pending?'friendly-invite':'admin-update',title:pending?`有效待办${i}`:'大正文公告',summary:'压力测试摘要',body:pending?'合成说明。'.repeat(100):'完整公告内容。'.repeat(50000),createdAt:now+i,updatedAt:now+i,readAt:null,
          payload:pending?{friendlyInvitationId:id}:null});
      }
      service.grantS4Pack(team.ownerId,'private-mixed',2);
    }
    const team0=service.accountTeam(accounts[0].playerId),legacyBytes=Buffer.byteLength(JSON.stringify(service.inbox(team0)));
    const shardPath=path.join(dir,`shards-${count}`);new LeagueShardStore(shardPath,{backupDir:null}).save(unwrapTracked(service.state),{forceFull:true});
    const metricsPath=path.join(dir,`metrics-${count}.json`);await start(shardPath,metricsPath);
    const view=await post('/league',accounts[0]);assert.equal(view.league.inbox,undefined);assert.equal(view.league.inboxMeta.total,count);
    const first=await post('/league/inbox/list',accounts[0]);assert.equal(first.inboxPage.messages.length,25);
    const pageBytes=Buffer.byteLength(JSON.stringify(first));
    const samples=[],errors=[],startedAt=Date.now(),durationMs=20000;
    await Promise.all(accounts.map(async(identity,index)=>{
      let iteration=0,page=null;
      while(Date.now()-startedAt<durationMs){
        const slot=iteration++%6;let route,body={...identity};
        if(slot===0||slot===3){route='/league/inbox/list';if(slot===3&&page?.hasNext){body.cursor=page.nextCursor;body.anchor=page.anchor;}}
        else if(slot===1||slot===4){route='/league/inbox/detail';body.messageId=page?.messages[slot===1?0:Math.min(3,page.messages.length-1)]?.id;}
        else if(slot===2){route='/league/inbox/read';body.messageId=page?.messages[0]?.id;}
        else route='/league/head';
        const start=performance.now();
        try{const value=await post(route,body);const bytes=Buffer.byteLength(JSON.stringify(value));samples.push({player:index+1,route,ms:performance.now()-start,bytes});if(value.inboxPage)page=value.inboxPage;}
        catch(error){errors.push({player:index+1,route,error:error.message,ms:performance.now()-start});}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }));
    const bulkStart=performance.now();
    const bulk=await Promise.all(accounts.map(async identity=>{const selection=(await post('/league/inbox/selection',{...identity,operation:'read',category:'action'})).inboxSelection;return (await post('/league/inbox/apply-selection',{...identity,selectionToken:selection.token})).inboxMutation;}));
    const bulkMs=performance.now()-bulkStart;
    for(const r of bulk){assert.equal(r.meta.counts.action,count-1);assert.equal(r.meta.unread.action,0);}
    const finalView=(await post('/league',accounts[0])).league;assert.equal(finalView.s4Packs.inventory.length,2);
    // Drain delayed read persistence before checking restart durability.
    await new Promise(resolve=>setTimeout(resolve,1800));
    const metrics=fs.existsSync(metricsPath)?JSON.parse(fs.readFileSync(metricsPath,'utf8')).filter(s=>s.time>=startedAt):[];
    const disk=diskBytes(shardPath);assert.ok(disk<64*1024**3);
    const byRoute=Object.fromEntries([...new Set(samples.map(s=>s.route))].map(route=>[route,{...stats(samples.filter(s=>s.route===route).map(s=>s.ms)),responseBytes:stats(samples.filter(s=>s.route===route).map(s=>s.bytes))}]));
    const result={mailPerPlayer:count,onlinePlayers:10,durationMs,requests:samples.length,errors,latencyMs:stats(samples.map(s=>s.ms)),byRoute,bulkAllPlayersReadMs:bulkMs,
      legacyAllMailBytes:legacyBytes,summaryPageBytes:pageBytes,reductionPercent:100*(1-pageBytes/legacyBytes),peakRssBytes:Math.max(0,...metrics.map(s=>s.rss)),peakHeapBytes:Math.max(0,...metrics.map(s=>s.heapUsed)),
      runtimeTimings:metrics.at(-1)?.timings,eventLoopMaxMs:Math.max(0,...metrics.map(s=>s.eventLoopMaxMs)),eventLoopP95Ms:stats(metrics.map(s=>s.eventLoopP95Ms)),diskBytes:disk,validPendingPreserved:count-1,rewardPacksPreserved:2};
    await server.stop();
    const reloaded=new YellowDogsLeagueService({statePath:shardPath,backupDir:null,pagedInbox:true});
    if(predictionAfter){
      const generated=Object.values(reloaded.state.matchPredictions.markets).filter(m=>m.simulation?.samples===24);
      assert.ok(generated.length>=1,'background prediction must complete and survive restart');
      assert.ok(result.runtimeTimings?.['league.prediction.worker']?.count>=1);
      assert.equal(result.runtimeTimings['league.prediction.worker'].errors,0);
      result.predictionMarketsPersisted=generated.length;
      result.predictionSamples=generated[0].simulation.samples;
    }
    for(const identity of accounts){
      const saved=reloaded.inboxMeta(reloaded.accountTeam(identity.playerId));assert.equal(saved.counts.action,count-1);assert.equal(saved.unread.action,0);
      assert.equal(reloaded.s4PackInventory(identity.playerId).length,2);
    }
    result.readStateSurvivedRestart=true;result.playersVerifiedAfterRestart=accounts.length;
    assert.equal(errors.length,0);assert.ok(result.peakRssBytes<2*1024**3);results.push(result);
    fs.writeFileSync(`${out}/scenario-${count}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }
  const report={target:{provider:'Alibaba Cloud',region:'Hong Kong',vCPU:2,ramGiB:2,diskGiB:64,onlinePlayers:10},actual:{environment:'local Windows isolated HTTP + sharded storage',hostRamBytes:os.totalmem(),hostCpu:os.cpus()[0]?.model,cpuAffinityMask:3,logicalProcessors:2,jobMemoryLimitBytes:2147483648,nodeOldSpaceMiB:1024,
    wholeMachine2GiBLimit:false,diskQuota64GiB:false,diskUsageVerifiedBelow64GiB:true,cloudDiskAndHongKongNetwork:false,network:'loopback',thinkTimeMs:250,includesLiveMatchSimulation:false},scenarios:results};
  fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));
}finally{
  await server?.stop();
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-inbox-load-'));
  fs.rmSync(dir,{recursive:true,force:true});
}
