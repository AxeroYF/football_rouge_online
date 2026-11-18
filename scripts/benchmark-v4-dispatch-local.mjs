import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {createLocalDispatcher} from '../versus/v4-host/dispatcher.js';
import {createCanonicalShadowSettlement} from '../versus/v4-host/shadow-settlement.js';
import {openArchive} from '../versus/v4-stream/archive.js';
import {createStreamService} from '../versus/v4-stream/http-service.js';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(value=>value.replace(/^--/,'').split('='))),output=path.resolve(args.output??'outputs/v4-fair-capacity-20261118');
fs.mkdirSync(output,{recursive:true});
const entries=['scripts/benchmark-v4-dispatch-local.mjs','versus/v4-host/dispatch-worker.js','scripts/inbox-load-limits.ps1'],sourceHashes=dependencyHashes(entries),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

if(args.child==='true'){
  await new Promise(resolve=>process.once('message',resolve));
  const directory=fs.mkdtempSync(path.join(output,'run-')),snapshot=readLeagueSource(process.cwd()),archives=new Map(),firstChunks={};
  const bundleDirectory=path.resolve('outputs/v4-accepted-local-20261118/engine'),bundle=JSON.parse(fs.readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8'));
  // Capacity measures the actual dispatcher/producer and journal, but uses a
  // small statistics consumer. Asset/round reward workloads remain separate.
  const createService=options=>({...options,finalizeFixture(fixture,round,match){
    fixture.matchId=`capacity-record-${round}`;this.state.matches.push({id:fixture.matchId,score:match.report.score});
    for(const team of match.report.teams)for(const player of team.players){
      const key=`${team.id}:${player.id}:ai`,prior=this.state.playerStats[key]??{},next={};
      for(const [name,value] of Object.entries(player.stats))next[name]=(prior[name]??0)+value;
      next.appearances=(prior.appearances??0)+1;next.ratingTotal=(prior.ratingTotal??0)+player.rating;this.state.playerStats[key]=next;
    }
  }});
  const settlement=await createCanonicalShadowSettlement(path.join(directory,'settlement'),{initialState:{matches:[],teams:snapshot.teams.map(t=>({id:t.id,ownerId:null})),playerStats:{}},createService});
  const queue=await createLocalDispatcher(path.join(directory,'queue'),{settlement,candidate:{accepted:true,bundleDirectory,engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest},maxWorkers:2,matchesPerWorker:4,maxPending:8});
  await queue.setPolicy({mode:'shadow'},{expectedRevision:0});
  for(let i=0;i<8;i++){
    const fixtureId=`capacity-${i}`,envelope=compileRealMatch(snapshot,{homeId:snapshot.teams[i].id,awayId:snapshot.teams[(i+5)%16].id,fixtureId,seed:`capacity-independent-${i}`});
    await queue.enqueue({fixture:{id:fixtureId,competition:'league'},envelope,context:{competition:'league',round:i+1}});
  }
  const service=createStreamService({requestsPerMinute:1200,maxConcurrent:16,authorize:async request=>{
    const match=/^Bearer bench-viewer-([0-9])$/.exec(request.headers.authorization??'');return match?{subject:match[0],ownerSide:Number(match[1])%3===0?null:Number(match[1])%3-1}:null;
  }});
  const started=performance.now();let highRss=0,highHeap=0,peakWorkers=0,peakActiveMatches=0,watching=false,watchError=null,lastQueueRead=-Infinity;
  const descriptors=Array.from({length:8},(_,index)=>({fixture:{id:`capacity-${index}`}}));
  const lag=monitorEventLoopDelay({resolution:10});lag.enable();
  async function watch(){
    if(watching)return;watching=true;
    try{
      const memory=process.memoryUsage();highRss=Math.max(highRss,memory.rss);highHeap=Math.max(highHeap,memory.heapUsed);
      if(performance.now()-lastQueueRead>=1000){
        lastQueueRead=performance.now();const running=(await queue.read()).jobs.filter(job=>job.status==='running');
        peakWorkers=Math.max(peakWorkers,new Set(running.map(job=>job.workerSlot)).size);peakActiveMatches=Math.max(peakActiveMatches,running.length);
      }
      for(const job of descriptors){
        const id=job.fixture.id,folder=path.join(directory,'queue/jobs',id,'archive');if(archives.has(id)||!fs.existsSync(path.join(folder,'manifest.json')))continue;
        const archive=await openArchive(folder);archives.set(id,archive);
        service.register(id,{
          get manifest(){return archive.manifest;},get publishedThrough(){return archive.publishedThrough;},read:archive.read,publishedHead:archive.publishedHead,
          async refresh(){await archive.refresh({snapshot:false});const through=archive.producedThrough;if(through>=0){firstChunks[id]??=performance.now()-started;archive.publishUntil(Math.max(archive.publishedThrough,through));}},
        });
      }
    }catch(error){watchError=error.message;}finally{watching=false;}
  }
  const interval=setInterval(watch,100),server=http.createServer(async(request,response)=>{if(!await service.handle(request,response)){response.writeHead(404);response.end(JSON.stringify({error:'not ready'}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const controller=new AbortController();let drainResult=null,drainError=null,finishedMs=null;
  const drain=queue.drain({signal:controller.signal}).then(result=>{drainResult=result;finishedMs=performance.now()-started;},error=>{drainError=error.message;});
  process.send({type:'ready',url:`http://127.0.0.1:${server.address().port}`});
  process.once('message',async message=>{
    if(message.type!=='finish')return;clearInterval(interval);controller.abort();await drain;while(watching)await sleep(10);lag.disable();
    const jobs=(await queue.read()).jobs.map(job=>({fixtureId:job.fixture.id,status:job.status,error:job.error??null}));
    process.send({type:'metrics',directory,jobs,drainResult,drainError,watchError,firstChunks,finishedMs,peakWorkers,peakActiveMatches,mainRss:highRss,mainHeap:highHeap,eventLoopP95Ms:lag.percentile(95)/1e6});
    server.closeAllConnections();server.close(()=>process.exit(0));
  });
}else{
  if(process.platform!=='win32')throw new Error('需要Windows Job Object，不能用未受限运行替代');
  verifyV4ProtectedFiles();const seconds=Number(args.seconds??180);if(!Number.isSafeInteger(seconds)||seconds<30||seconds>300)throw new Error('容量时长无效');
  const child=spawn(process.execPath,['--max-old-space-size=1024',fileURLToPath(import.meta.url),'--child=true',`--output=${output}`],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let guard,guardOutput='',childOutput='',metrics;const childExit=new Promise(resolve=>child.once('exit',resolve));
  child.stdout.on('data',bytes=>childOutput=(childOutput+bytes).slice(-5000));child.stderr.on('data',bytes=>childOutput=(childOutput+bytes).slice(-5000));
  try{
    guard=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/inbox-load-limits.ps1'),'-TargetProcessId',String(child.pid),'-ReportMetrics'],{windowsHide:true});
    const guardExit=new Promise(resolve=>guard.once('exit',resolve));
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('资源限制器启动超时')),20000);guard.stdout.on('data',bytes=>{guardOutput+=bytes;if(guardOutput.includes('RESOURCE_LIMITS_READY')){clearTimeout(timeout);resolve();}});guard.stderr.on('data',bytes=>guardOutput+=bytes);guard.once('error',reject);guard.once('exit',code=>{clearTimeout(timeout);reject(new Error(`资源限制器退出 ${code}: ${guardOutput}`));});});
    const ready=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('调度容量服务启动超时')),30000);child.on('message',message=>{if(message.type==='ready'){clearTimeout(timeout);resolve(message.url);}if(message.type==='metrics')metrics=message;});child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`容量服务退出 ${code}: ${childOutput}`));});});
    child.send({type:'start'});const url=await ready,deadline=performance.now()+seconds*1000,requests=[],statuses={},clientErrors=[];
    await Promise.all(Array.from({length:10},async(_,client)=>{
      let cursor=0;await sleep(client*23);
      while(performance.now()<deadline){
        for(const suffix of ['head',`segments/${cursor}`]){
          const began=performance.now();
          try{const response=await fetch(`${url}/v4/matches/capacity-${client%8}/${suffix}`,{headers:{Authorization:`Bearer bench-viewer-${client}`},signal:AbortSignal.timeout(10000)});await response.json();requests.push({kind:suffix==='head'?'head':'segment',ms:performance.now()-began,status:response.status});statuses[response.status]=(statuses[response.status]??0)+1;if(response.ok&&suffix!=='head')cursor++;}
          catch(error){clientErrors.push(String(error.message));}
        }
        await sleep(300);
      }
    }));
    child.send({type:'finish'});await childExit;const guardCode=await guardExit;if(!metrics||guardCode!==0)throw new Error('容量指标或资源限制器失败 '+childOutput+guardOutput);
    const peakJobMemoryBytes=Number(/RESOURCE_LIMITS_METRICS peakJobMemoryBytes=(\d+)/.exec(guardOutput)?.[1]);
    const latency=Object.fromEntries(['head','segment'].map(kind=>{const values=requests.filter(row=>row.kind===kind&&row.status===200).map(row=>row.ms).sort((a,b)=>a-b);return [kind,{count:values.length,p95:values[Math.floor((values.length-1)*.95)]??0,max:Math.max(0,...values)}];}));
    const preservation=verifyV4ProtectedFiles(),sourcesUnchanged=JSON.stringify(sourceHashes)===JSON.stringify(dependencyHashes(entries));
    const gates={allEightFinished:metrics.jobs.length===8&&metrics.jobs.every(job=>job.status==='settled'),noFailures:!metrics.drainError&&!metrics.watchError&&clientErrors.length===0,
      earlyFrames:Object.keys(metrics.firstChunks).length===8&&Math.max(...Object.values(metrics.firstChunks))<10000,boundedWorkers:metrics.peakWorkers===2&&metrics.peakActiveMatches===8,
      memory:Number.isFinite(peakJobMemoryBytes)&&peakJobMemoryBytes<1.5*1024**3,headP95:latency.head.count>0&&latency.head.p95<150,segmentP95:latency.segment.count>0&&latency.segment.p95<300,
      noOverload:!statuses[429]&&!statuses[500]&&!statuses[503],preservation:preservation.verified,sourcesUnchanged};
    const report={passed:Object.values(gates).every(Boolean),gates,seconds,limits:{logicalProcessors:2,jobAffinity:3,jobMemoryBytes:2147483648,maxProducerProcesses:2,matchesPerProducer:4,producerHeapMiB:256},
      scope:'Actual durable dispatcher and forked producer groups with ten loopback viewers. Minimal statistics consumer, not full canonical asset/reward or prediction traffic. No cloud.',peakJobMemoryBytes,latency,statuses,clientErrors,metrics,dependencyHashes:sourceHashes,preservation};
    fs.writeFileSync(path.join(output,'capacity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,gates,peakJobMemoryBytes,latency,firstChunkMs:metrics.firstChunks,finishedMs:metrics.finishedMs}));if(!report.passed)process.exitCode=1;
  }finally{if(child.exitCode===null)child.kill();await childExit;guard?.kill();}
}
