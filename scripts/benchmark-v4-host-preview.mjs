import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {openConfiguredStreamHost} from '../versus/v4-host/configured-host.js';
import {createAccountPlayback} from '../versus/v4-host/account-playback.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('='))),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=path.resolve(args.output??'outputs/v4-host-capacity-20261118');fs.mkdirSync(output,{recursive:true});
const entries=['scripts/benchmark-v4-host-preview.mjs','scripts/inbox-load-limits.ps1','versus/room-service.js'],sources=dependencyHashes(entries);
if(args.child==='true'){
  await new Promise(resolve=>process.once('message',resolve));
  const directory=fs.mkdtempSync(path.join(output,'run-'));
  for(const [key,name] of Object.entries({VERSUS_ACCOUNTS_PATH:'accounts.json',YELLOWDOGS_LEAGUE_PATH:'league.json',YDL_CONTENT_OVERRIDES_PATH:'content.json',YDL_PLAYER_CARD_STUDIO_PATH:'studio.json',YDL_PLAYER_PROFILE_ROOT:'profiles'}))process.env[key]=path.join(directory,name);
  const {VersusRoomService}=await import('../versus/room-service.js');
  const rooms=new VersusRoomService({accountsPath:process.env.VERSUS_ACCOUNTS_PATH,lineups:new Map()}),accounts=Array.from({length:10},(_,i)=>rooms.bindAccount(`capacity-preview-${i}`));
  const proof=JSON.parse(fs.readFileSync('outputs/v4-host-20261118/host-local-verification.json','utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(proof.root,'league/archive/manifest.json'),'utf8'));
  const configPath=path.join(proof.root,`capacity-preview-${process.pid}.json`);
  fs.writeFileSync(configPath,JSON.stringify({format:'yffm-v4-stream-host-1',scope:'shadow-preview',matches:[{matchId:manifest.matchId,homeId:manifest.teams[0].id,awayId:manifest.teams[1].id,archive:'league/archive',engineVersion:manifest.engineVersion,sourceDigest:manifest.sourceDigest,inputFingerprint:manifest.inputFingerprint,startAt:0,releaseRate:1,publicWatch:true}]}),{flag:'wx'});
  const league={state:{teams:manifest.teams.map((t,i)=>({id:t.id,ownerId:accounts[i].profile.id}))}},host=await openConfiguredStreamHost(configPath,{rooms,league});
  const lag=monitorEventLoopDelay({resolution:10});lag.enable();let highRss=0,highHeap=0;
  const timer=setInterval(()=>{const m=process.memoryUsage();highRss=Math.max(highRss,m.rss);highHeap=Math.max(highHeap,m.heapUsed);},100);
  const server=http.createServer(async(req,res)=>{try{if(!await host.handle(req,res)){res.writeHead(404);res.end();}}catch{res.writeHead(500);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.send({type:'ready',url:`http://127.0.0.1:${server.address().port}`,matchId:manifest.matchId,accounts,through:manifest.segments.at(-1).through});
  process.on('message',async message=>{
    if(message.type!=='finish')return;clearInterval(timer);lag.disable();await rooms.accountRepository.flush?.();
    process.send({type:'metrics',directory,highRss,highHeap,eventLoopP95Ms:lag.percentile(95)/1e6});server.closeAllConnections();server.close(()=>process.exit(0));
  });
}else{
  if(process.platform!=='win32')throw new Error('需要Windows Job Object资源限制');
  verifyV4ProtectedFiles();
  const child=spawn(process.execPath,['--max-old-space-size=1024','scripts/benchmark-v4-host-preview.mjs','--child=true',`--output=${output}`],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const exited=new Promise(resolve=>child.once('exit',resolve));let guard,metrics,logs='';child.stdout.on('data',b=>logs=(logs+b).slice(-10000));child.stderr.on('data',b=>logs=(logs+b).slice(-10000));
  try{
    guard=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/inbox-load-limits.ps1'),'-TargetProcessId',String(child.pid)],{windowsHide:true});
    await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('资源限制器超时')),20000);guard.stdout.on('data',b=>{output+=b;if(output.includes('RESOURCE_LIMITS_READY')){clearTimeout(timer);resolve();}});guard.stderr.on('data',b=>output+=b);guard.once('error',reject);guard.once('exit',code=>{clearTimeout(timer);reject(new Error(`资源限制器退出 ${code}: ${output}`));});});
    const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('宿主启动超时')),30000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m);}if(m.type==='metrics')metrics=m;});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`宿主退出 ${code}: ${logs}`));});});
    child.send({type:'start'});const {url,accounts,matchId,through}=await ready;
    const seconds=Number(args.seconds??Math.ceil(through/64)+15),deadline=performance.now()+seconds*1000,requests=[],statuses={},errors=[],clients=[];
    await Promise.all(accounts.map(async(account,i)=>{
      await sleep(i*50);const started=performance.now();let last=started,nextPump=started,maxFrames=0,maxEvents=0;
      const player=createAccountPlayback({matchId,playerId:account.profile.id,accountToken:account.accountToken,baseUrl:url,fetcher:async(url,init)=>{
        const start=performance.now(),response=await fetch(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(10000)])});
        const value=await response.json();statuses[response.status]=(statuses[response.status]??0)+1;requests.push({kind:url.endsWith('/head')?'head':'segment',ms:performance.now()-start,status:response.status});return {ok:response.ok,status:response.status,json:async()=>value};
      }});player.setRate(64);player.slowMotion(false);player.play();
      while(performance.now()<deadline){
        const now=performance.now();player.tick(Math.min(1,(now-last)/1000));last=now;
        if(now>=nextPump){nextPump=now+500;try{await player.pump();}catch(error){if(errors.length<20)errors.push({client:i,error:error.message});}}
        maxFrames=Math.max(maxFrames,player.state.frames);maxEvents=Math.max(maxEvents,player.state.events);
        if(player.state.complete&&player.state.time>=through)break;await sleep(20);
      }
      clients.push({client:i,complete:player.state.complete&&player.state.time>=through,footballSeconds:player.state.time,wallMs:performance.now()-started,maxFrames,maxEvents});player.close();
    }));
    child.send({type:'finish'});await exited;if(!metrics)throw new Error('缺少资源指标 '+logs);
    const quantile=(v,p)=>v.sort((a,b)=>a-b)[Math.floor((v.length-1)*p)]??0;
    const latency=Object.fromEntries(['head','segment'].map(kind=>{const values=requests.filter(r=>r.kind===kind&&r.status===200).map(r=>r.ms);return [kind,{count:values.length,p95:quantile(values,.95),max:Math.max(0,...values)}];}));
    const preservation=verifyV4ProtectedFiles();
    const gates={allTenFinished:clients.length===10&&clients.every(c=>c.complete),noOverload:!statuses[429]&&!statuses[403]&&!statuses[500]&&!statuses[503],noClientErrors:errors.length===0,headP95:latency.head.count>0&&latency.head.p95<150,segmentP95:latency.segment.count>0&&latency.segment.p95<300,memory:metrics.highRss<1.5*1024**3,boundedClients:clients.every(c=>c.maxFrames<=4096&&c.maxEvents<=4096),preservation:preservation.verified,sourcesUnchanged:JSON.stringify(dependencyHashes(entries))===JSON.stringify(sources)};
    const report={passed:Object.values(gates).every(Boolean),gates,scope:'Ten isolated canonical accounts replay the same completed real-team archive at 64x through the configured preview host. Local Windows loopback with constrained server; viewer decoding runs outside server limits. No concurrent producers, cloud or formal saves.',limits:{logicalProcessors:2,cpuAffinity:3,jobMemoryBytes:2147483648,heapMiB:1024,requestsPerMinute:600,maxConcurrent:16},host:{platform:os.platform(),cpu:os.cpus()[0].model},seconds,latency,statuses,errors,clients,metrics,dependencyHashes:sources,preservation};
    fs.writeFileSync(path.join(output,'capacity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,gates,latency,metrics,clients}));if(!report.passed)process.exitCode=1;
  }finally{if(child.exitCode===null)child.kill();await exited;guard?.kill();}
}
