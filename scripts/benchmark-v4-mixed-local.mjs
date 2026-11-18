import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(value=>value.replace(/^--/,'').split('='))),output=path.resolve(args.output??'outputs/v4-mixed-capacity-20261118/iteration1'),seconds=Number(args.seconds??180);
if(process.platform!=='win32'||!Number.isSafeInteger(seconds)||seconds<30||seconds>300)throw new Error('需要Windows受限资源测试及30–300秒时长');
fs.mkdirSync(output,{recursive:true});if(fs.existsSync(path.join(output,'capacity.json')))throw new Error('禁止覆盖容量证据');
const entries=['scripts/benchmark-v4-mixed-local.mjs','scripts/benchmark-v4-mixed-worker.mjs','versus/v4-host/dispatch-worker.js','scripts/inbox-load-limits.ps1'],sources=dependencyHashes(entries);verifyV4ProtectedFiles();
const root=fs.mkdtempSync(path.join(output,'run-'));fs.writeFileSync(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
for(const [from,to] of [['yellowdogs-league.json','league.json'],['ydl-content-overrides.json','content.json'],['ydl-player-card-studio.json','studio.json']])fs.copyFileSync(path.join('data',from),path.join(root,to));
const child=spawn(process.execPath,['--max-old-space-size=1024','scripts/benchmark-v4-mixed-worker.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,V4_MIXED_ROOT:root,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles'),VERSUS_PUBLIC_ONLY:'1'}});
const exited=new Promise(resolve=>child.once('exit',resolve)),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let guard,guardText='',childText='',metrics;
child.stdout.on('data',b=>childText=(childText+b).slice(-12000));child.stderr.on('data',b=>childText=(childText+b).slice(-12000));
try{
  guard=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/inbox-load-limits.ps1'),'-TargetProcessId',String(child.pid),'-ReportMetrics'],{windowsHide:true});const guardExit=new Promise(resolve=>guard.once('exit',resolve));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('限制器超时')),20000);guard.stdout.on('data',b=>{guardText+=b;if(guardText.includes('RESOURCE_LIMITS_READY')){clearTimeout(timer);resolve();}});guard.stderr.on('data',b=>guardText+=b);guard.once('error',reject);guard.once('exit',()=>{clearTimeout(timer);reject(new Error(guardText));});});
  const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('初始化超时 '+childText)),90000);child.on('message',message=>{if(message.type==='ready'){clearTimeout(timer);resolve(message);}if(message.type==='metrics')metrics=message;if(message.type==='failure'){clearTimeout(timer);reject(new Error(message.message));}});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error('测试服务退出 '+childText));});});
  child.send({type:'start'});const {url,accounts,matchIds}=await ready,began=performance.now(),deadline=began+seconds*1000,rows=[],errors=[],statuses={},firstFrames={};
  await Promise.all(accounts.map(async(account,index)=>{
    const matchId=matchIds[index%matchIds.length],headers={Authorization:`Bearer ${account.accountToken}`,'X-Player-Id':encodeURIComponent(account.profile.id)};let cursor=0,iteration=0;
    await sleep(index*23);
    async function request(kind,endpoint,init){
        const started=performance.now();try{
          const response=await fetch(url+endpoint,{...init,signal:AbortSignal.timeout(15000)}),body=await response.json();rows.push({kind,ms:performance.now()-started,status:response.status,route:kind==='business'?endpoint:null});statuses[response.status]=(statuses[response.status]??0)+1;
          if(response.ok&&kind==='segment'){cursor++;firstFrames[matchId]??=performance.now()-began;}
          if(!response.ok&&response.status!==425)errors.push({kind,status:response.status,error:body.error??'request failed'});
        }catch(error){errors.push({kind,error:error.message});}
    }
    await Promise.all([(async()=>{
      while(performance.now()<deadline){
        await request('head',`/v4/matches/${matchId}/head`,{headers});
        await request('segment',`/v4/matches/${matchId}/segments/${cursor}`,{headers});
        await sleep(300);
      }
    })(),(async()=>{
      const routes=['/api/versus/league/head','/api/versus/league','/api/versus/league/inbox/list','/api/versus/league/predictions'];
      while(performance.now()<deadline){
        const read=iteration%10===9,route=read?'/api/versus/league/inbox/read':routes[iteration%routes.length];
        await request('business',route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:account.profile.id,accountToken:account.accountToken,...(read?{messageId:`mixed-${index}-${Math.floor(iteration/10)%64}`}:{})})});
        iteration++;await sleep(300);
      }
    })()]);
  }));
  child.send({type:'finish'});await exited;const guardCode=await guardExit;if(!metrics||guardCode!==0)throw new Error('缺少指标 '+childText+guardText);
  const peakJobMemoryBytes=Number(/RESOURCE_LIMITS_METRICS peakJobMemoryBytes=(\d+)/.exec(guardText)?.[1]),latency={};
  for(const kind of ['head','segment','business']){const values=rows.filter(row=>row.kind===kind&&row.status===200).map(row=>row.ms).sort((a,b)=>a-b);latency[kind]={count:values.length,p95:values[Math.floor((values.length-1)*.95)]??0,max:Math.max(0,...values)};}
  const preservation=verifyV4ProtectedFiles(),gates={roundComplete:metrics.outcome?.complete===true&&metrics.receipts===8&&metrics.finishedMs<=seconds*1000,noFailures:!metrics.failure&&!metrics.flushError&&!metrics.predictionError&&!errors.length,predictionRan:metrics.predictionStarted&&metrics.predictionFinished===true&&metrics.predictionSamples===24,
    allFrames:Object.keys(firstFrames).length===8&&Math.max(...Object.values(firstFrames))<10000,memory:Number.isFinite(peakJobMemoryBytes)&&peakJobMemoryBytes<1.5*1024**3,headP95:latency.head.count>0&&latency.head.p95<150,segmentP95:latency.segment.count>0&&latency.segment.p95<300,businessP95:latency.business.count>0&&latency.business.p95<150,preservation:preservation.verified,sourcesUnchanged:JSON.stringify(sources)===JSON.stringify(dependencyHashes(entries))};
  const report={passed:Object.values(gates).every(Boolean),root,seconds,gates,latency,peakJobMemoryBytes,firstFrames,statuses,errors,metrics,limits:{logicalProcessors:2,jobAffinity:3,jobMemoryBytes:2147483648},scope:'Original league HTTP API with ten actual isolated accounts, shard storage, eight scheduled V4 games and dynamic viewers, inbox reads/writes and one original V1/24-sample background forecast. Loopback, no cloud.',dependencyHashes:sources,preservation};
  report.clientModel='Ten accounts, each with independent playback and business loops; 300ms think time in each loop. Segment cursor advances one chunk per playback cycle.';
  fs.writeFileSync(path.join(output,'capacity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,gates,latency,peakJobMemoryBytes,finishedMs:metrics.finishedMs,failure:metrics.failure,predictionStarted:metrics.predictionStarted,predictionFinished:metrics.predictionFinished}));if(!report.passed)process.exitCode=1;
}finally{if(child.exitCode===null)child.kill();await exited;guard?.kill();fs.writeFileSync(path.join(root,'worker.log'),childText);}
