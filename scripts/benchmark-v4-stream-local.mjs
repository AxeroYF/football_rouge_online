import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {openArchive} from '../versus/v4-stream/archive.js';
import {createStreamService} from '../versus/v4-stream/http-service.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const output=path.resolve(args.output??'outputs/v4-stream-capacity-20261117');fs.mkdirSync(output,{recursive:true});
const sourceHashes=dependencyHashes(['scripts/benchmark-v4-stream-local.mjs','scripts/v4-producer-worker.mjs','scripts/inbox-load-limits.ps1','versus/v4-adapter/read-source.js','versus/v4-adapter/compile-match.js']);

if(args.child==='true'){
  // Wait until the parent confirms the Job Object and CPU affinity are applied.
  await new Promise(resolve=>process.once('message',resolve));
  const {readLeagueSource}=await import('../versus/v4-adapter/read-source.js');
  const {compileRealMatch}=await import('../versus/v4-adapter/compile-match.js');
  const snapshot=readLeagueSource(process.cwd()),archives=new Map(),completed=[],workers=new Set(),failures=[];
  const directory=fs.mkdtempSync(path.join(output,'run-')),lag=monitorEventLoopDelay({resolution:10});lag.enable();
  let highRss=0,highHeap=0;const timer=setInterval(()=>{const m=process.memoryUsage();highRss=Math.max(highRss,m.rss);highHeap=Math.max(highHeap,m.heapUsed);},100);
  const service=createStreamService({requestsPerMinute:1200,maxConcurrent:16,authorize:async req=>{
    const m=/^Bearer bench-viewer-([0-9])$/.exec(req.headers.authorization??'');return m?{subject:m[0],ownerSide:Number(m[1])%3===0?null:Number(m[1])%3-1}:null;
  }});
  const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.send({type:'ready',url:`http://127.0.0.1:${server.address().port}`});
  const fixtures=Number(args.fixtures??4),queue=Array.from({length:fixtures},(_,i)=>i);let running=0;
  function startNext(){
    while(running<2&&queue.length){
      const i=queue.shift(),matchId=`capacity-${i}`,envelope=compileRealMatch(snapshot,{homeId:snapshot.teams[i].id,awayId:snapshot.teams[(i+5)%16].id,fixtureId:matchId,seed:`capacity-independent-${i}`});
      const folder=path.join(directory,matchId),worker=new Worker(new URL('./v4-producer-worker.mjs',import.meta.url),{workerData:{input:envelope.input,directory:folder,matchId},resourceLimits:{maxOldGenerationSizeMb:256}});workers.add(worker);running++;
      let tail=Promise.resolve(),workerError=null;
      worker.on('message',message=>{tail=tail.then(async()=>{
        if(message.type==='committed'){
          let archive=archives.get(matchId);if(!archive){archive=await openArchive(folder);archives.set(matchId,archive);service.register(matchId,archive);}
          await archive.refresh();archive.publishUntil(Math.max(archive.publishedThrough,message.through));
        }else if(message.type==='complete')completed.push({matchId,...message});
      }).catch(error=>{workerError=error.message;});});
      worker.on('error',error=>{workerError=error.message;});worker.on('exit',async code=>{await tail;if(code||workerError)failures.push({matchId,code,error:workerError});running--;workers.delete(worker);startNext();});
    }
  }
  startNext();
  process.on('message',async message=>{
    if(message.type!=='finish')return;clearInterval(timer);lag.disable();
    process.send({type:'metrics',completed,failures,pending:queue.length+running,highRss,highHeap,eventLoopP95Ms:lag.percentile(95)/1e6,directory});
    for(const worker of workers)await worker.terminate();server.closeAllConnections();server.close(()=>process.exit(0));
  });
}else{
  if(process.platform!=='win32')throw new Error('此验收脚本需要 Windows Job Object；不能把未受限运行当成容量验证');
  verifyV4ProtectedFiles();
  const protectedPaths=JSON.parse(fs.readFileSync('outputs/v4-before-stage5-20261117/protected-hashes.json','utf8').replace(/^\uFEFF/,''));
  const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');const before=Object.fromEntries(protectedPaths.map(p=>[p.Path,hash(p.Path)]));
  const child=spawn(process.execPath,['--max-old-space-size=1024',new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),'--child=true',`--output=${output}`,`--fixtures=${args.fixtures??4}`],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let guard,metrics,childOutput='';child.stdout.on('data',b=>{childOutput=(childOutput+b).slice(-10000);});child.stderr.on('data',b=>{childOutput=(childOutput+b).slice(-10000);});
  const exit=new Promise(resolve=>child.once('exit',resolve));
  try{
    guard=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/inbox-load-limits.ps1'),'-TargetProcessId',String(child.pid)],{windowsHide:true});
    await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('资源限制器未就绪')),20000);guard.stdout.on('data',b=>{text+=b;if(text.includes('RESOURCE_LIMITS_READY')){clearTimeout(timer);resolve();}});guard.stderr.on('data',b=>{text+=b;});guard.once('error',reject);guard.once('exit',code=>{clearTimeout(timer);reject(new Error(`资源限制器退出 ${code}: ${text}`));});});
    const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('容量服务启动超时')),30000);child.on('message',message=>{if(message.type==='ready'){clearTimeout(timer);resolve(message.url);}if(message.type==='metrics')metrics=message;});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`容量服务退出 ${code}: ${childOutput}`));});});child.send({type:'start'});const url=await ready;
    const seconds=Number(args.seconds??60),deadline=performance.now()+seconds*1000,requests=[],statuses={},cursors=Array(10).fill(0);
    async function request(client,suffix){const start=performance.now();const response=await fetch(`${url}/v4/matches/capacity-${client%Number(args.fixtures??4)}/${suffix}`,{headers:{Authorization:`Bearer bench-viewer-${client}`},signal:AbortSignal.timeout(10000)});const value=await response.json();requests.push({kind:suffix==='head'?'head':'segment',ms:performance.now()-start,status:response.status});statuses[response.status]=(statuses[response.status]??0)+1;return {response,value};}
    await Promise.all(Array.from({length:10},async(_,client)=>{await sleep(client*23);while(performance.now()<deadline){
      const head=await request(client,'head');if(head.response.ok&&head.value.segments.length>cursors[client]){const packet=await request(client,`segments/${cursors[client]}`);if(packet.response.ok)cursors[client]++;}await sleep(300);
    }}));
    child.send({type:'finish'});await exit;if(!metrics)throw new Error('容量服务未返回指标 '+childOutput);
    const quantile=(values,p)=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]??0;
    const latency=Object.fromEntries(['head','segment'].map(kind=>{const rows=requests.filter(r=>r.kind===kind&&r.status===200).map(r=>r.ms);return [kind,{count:rows.length,p50:quantile([...rows],.5),p95:quantile([...rows],.95),max:Math.max(0,...rows)}];}));
    const preservation=verifyV4ProtectedFiles(),protectedUnchangedDuringRun=Object.entries(before).every(([file,value])=>hash(file)===value);
    const sourcesUnchanged=JSON.stringify(sourceHashes)===JSON.stringify(dependencyHashes(['scripts/benchmark-v4-stream-local.mjs','scripts/v4-producer-worker.mjs','scripts/inbox-load-limits.ps1','versus/v4-adapter/read-source.js','versus/v4-adapter/compile-match.js']));
    const gates={allMatchesFinished:metrics.completed.length===Number(args.fixtures??4)&&metrics.pending===0,noWorkerFailures:metrics.failures.length===0,
      memory:metrics.highRss<1.5*1024**3,headP95:latency.head.count>0&&latency.head.p95<150,segmentP95:latency.segment.count>0&&latency.segment.p95<300,
      noOverload:!statuses[429]&&!statuses[500]&&!statuses[503],boundedRecording:metrics.completed.length>0&&metrics.completed.every(r=>r.metrics.highWater.frames<256&&r.metrics.highWater.events<2048),preservation:preservation.verified&&protectedUnchangedDuringRun,sourcesUnchanged};
    const report={passed:Object.values(gates).every(Boolean),gates,limits:{cpuAffinity:3,logicalProcessors:2,jobMemoryBytes:2147483648,mainHeapMiB:1024,producerHeapMiB:256,maxProducers:2},
      scope:`Local Windows loopback, 10 viewers, ${args.fixtures??4} read-only real-team fixtures, accelerated publication and frequent polling. Not Hong Kong cloud/network/disk validation; no production endpoints or settlement.`,
      host:{platform:os.platform(),cpu:os.cpus()[0].model,totalHostMemory:os.totalmem()},seconds,statuses,latency,metrics,
      dependencyHashes:sourceHashes,preservation};
    fs.writeFileSync(path.join(output,'capacity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,gates,latency,completed:metrics.completed.length,highRss:metrics.highRss}));if(!report.passed)process.exitCode=1;
  }finally{if(child.exitCode===null)child.kill();await exit;guard?.kill();}
}
