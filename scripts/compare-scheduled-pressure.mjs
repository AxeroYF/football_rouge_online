import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fork,spawn} from 'node:child_process';
import {once} from 'node:events';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {setImmediate as yieldLoop} from 'node:timers/promises';

async function size(dir){
  let bytes=0;
  for(const item of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);
    bytes+=item.isDirectory()?await size(file):(await fs.stat(file)).size;
  }
  return bytes;
}

async function runRound(version){
  const {YellowDogsLeagueService,S4_BOND_CATALOG}=await import('../versus/league-service.js');
  const {openFormalSchedule}=await import('../versus/v4-host/formal-schedule.js');
  const {REAL_PLAYERS}=await import('../versus/player-pool.js');
  const {YDL_TRAIT_CARDS}=await import('../versus/trait-pool.js');
  let time=Date.parse('2026-11-18T12:00:00+08:00');
  const now=()=>time,createService=options=>new YellowDogsLeagueService(options);
  const service=createService({statePath:process.env.YELLOWDOGS_LEAGUE_PATH,now,rng:()=>.5});
  service.state.season.nextRoundAt=time;
  service.save();
  const host=version==='v4'?await openFormalSchedule({service,createService,now,rooms:{account:id=>({id})},
    getCatalog:()=>({catalog:REAL_PLAYERS,traitCatalog:YDL_TRAIT_CARDS,bondCatalog:S4_BOND_CATALOG})}):null;
  const dir=path.dirname(service.statePath),before=await size(dir);
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();
  await new Promise(resolve=>setTimeout(resolve,20));
  const start=performance.now();
  await service.tick(host);
  time+=20*60_000;
  if(host){
    while(service.state.season.currentRound===0)await service.tick(host);
  }else{
    for(let step=0;service.state.season.currentRound===0&&step<10000;step++){
      service.advanceLiveRound(time,{maximumMatches:1,maximumChainsPerMatch:1});
      await yieldLoop();
    }
    await service.flushLiveSettlementJobs();
  }
  await service.flushLiveCheckpointIo();
  service.save();
  const elapsedMs=performance.now()-start;
  assert.equal(service.state.matches.length,8);
  const versions=[...new Set(service.state.matches.map(m=>m.report.engineVersion))];
  assert.equal(versions.length,1);
  assert.ok(versions[0].startsWith(version.slice(1)+'.'));
  await new Promise(resolve=>setTimeout(resolve,20));
  delay.disable();
  return {version,versions,matches:8,elapsedMs,eventLoopP95Ms:delay.percentile(95)/1e6,
    eventLoopMaxMs:delay.max/1e6,netDiskBytes:(await size(dir))-before};
}

async function measure(version){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yffm-pressure-'));
  const child=fork(new URL(import.meta.url),['--worker',version],{silent:true,windowsHide:true,env:{...process.env,
    YDL_V4_SCHEDULE:version==='v4'?'1':'0',YFFM_MATCH_ENGINE:'v3',YFFM_LEAGUE_MATCH_ENGINE:'v3',
    YELLOWDOGS_LEAGUE_PATH:path.join(dir,'league.json'),VERSUS_ACCOUNTS_PATH:path.join(dir,'accounts.json'),
    YDL_CONTENT_OVERRIDES_PATH:path.join(dir,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(dir,'studio.json')}});
  const guard=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/inbox-load-limits.ps1'),
    '-TargetProcessId',String(child.pid),'-ReportMetrics'],{windowsHide:true});
  const childExit=once(child,'exit'),guardExit=once(guard,'exit');
  let logs='',result,guardText='',started=false;
  child.stderr.on('data',b=>logs+=b);child.stdout.resume();guard.stderr.on('data',b=>logs+=b);
  child.on('message',m=>{result=m;});
  guard.stdout.on('data',b=>{
    guardText+=b;
    if(!started&&guardText.includes('RESOURCE_LIMITS_READY')){started=true;child.send('start');}
  });
  guard.once('exit',()=>{if(!started)child.kill();});
  const timeout=setTimeout(()=>child.kill(),360000);
  try{
    const [[code],[limitCode]]=await Promise.all([childExit,guardExit]);
    if(code!==0||limitCode!==0||!result)throw new Error(logs+guardText);
    const values=Object.fromEntries([...guardText.matchAll(/(\w+)=(\d+)/g)].map(([,k,v])=>[k,Number(v)]));
    assert.ok(values.cpu100ns>0&&values.peakJobMemoryBytes>0&&values.writeBytes>0);
    return {...result,cpuSeconds:values.cpu100ns/1e7,peakCommitBytes:values.peakJobMemoryBytes,
      ioWriteBytes:values.writeBytes,ioReadBytes:values.readBytes,processes:values.processes};
  }finally{clearTimeout(timeout);await fs.rm(dir,{recursive:true,force:true});}
}

if(process.argv[2]==='--worker'){
  await once(process,'message');
  const row=await runRound(process.argv[3]);
  process.send(row,()=>process.exit(0));
}else{
  const rows=[];
  const versions=process.argv.includes('--reverse')?['v4','v3']:['v3','v4'];
  for(const version of versions){const row=await measure(version);rows.push(row);console.log(row);}
  const output=path.resolve('outputs','scheduled-pressure-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  await fs.writeFile(output,JSON.stringify({cpu:os.cpus()[0].model,node:process.version,logicalCpuLimit:2,jobMemoryGiB:2,storage:'JSON',rows},null,2));
  console.log(output);
}
