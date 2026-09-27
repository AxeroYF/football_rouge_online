import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {prepareHistoryCompaction} from '../server/application/history-compaction.mjs';
import {JsonCampaignRepository} from '../server/infrastructure/json-campaign-repository.mjs';
const [mode,input]=process.argv.slice(2);
if(mode){
 const saved=JSON.parse(fs.readFileSync(input,'utf8'));global.gc?.();const before=process.memoryUsage();
 const c={accounts:new Map(Object.entries(saved.accounts)),world:saved.world};let migrationMs=0;
 if(mode==='compact'){const t=performance.now();prepareHistoryCompaction(c,{maxRecords:Infinity});migrationMs=performance.now()-t;}
 global.gc?.();const resident=process.memoryUsage();
 const target=input+'.'+mode,repo=new JsonCampaignRepository({dataPath:target}),times=[];let peakHeap=0,peakRss=0;
 const original=fs.writeFileSync;fs.writeFileSync=(...args)=>{const m=process.memoryUsage();peakHeap=Math.max(peakHeap,m.heapUsed);peakRss=Math.max(peakRss,m.rss);return original(...args);};
 for(let i=0;i<3;i++){const t=performance.now();if(mode==='native'){fs.writeFileSync(target,JSON.stringify(saved));}else repo.save(saved);times.push(performance.now()-t);}
 fs.writeFileSync=original;global.gc?.();
 console.log(JSON.stringify({mode,inputBytes:fs.statSync(input).size,outputBytes:fs.statSync(target).size,migrationMs,before,resident,after:process.memoryUsage(),peakHeapAtWrite:peakHeap,peakRssAtWrite:peakRss,maxRssKiB:process.resourceUsage().maxRSS,saveMs:times}));
}else{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-memory-r31-')),input=path.join(dir,'synthetic.json');
 const accounts={};
 const events=Array.from({length:800},(_,i)=>({id:i,minute:i/10,type:i%8?'pass':'goal',text:'球员传球形成进攻，队友在边路接应。',positions:Array.from({length:22},(_,j)=>({id:j,x:(i*7+j*3)%100,y:(i+j*11)%100}))}));
 const player={id:'card',name:'合成测试球员',attributes:Object.fromEntries(Array.from({length:40},(_,i)=>['attribute'+i,60+i%30])),traits:events.slice(0,3)};
 for(let i=0;i<12;i++)accounts['synthetic-'+i]={battleHistory:Array.from({length:12},(_,id)=>({id,captured:false,broadcasts:[{events}]})),scouting:{tasks:Object.fromEntries(Array.from({length:20},(_,id)=>[id,{id,claimedAt:1,selectedCardId:'card',claimedPlayers:[player],candidates:Array(20).fill(player),rounds:[]}]))},enhancement:{requests:Object.fromEntries(Array.from({length:100},(_,id)=>[id,{signature:String(id),result:{player}}]))}};
 fs.writeFileSync(input,JSON.stringify({version:4,accounts,world:{}}));
 const rows=[];for(const mode of ['native','chunked','compact']){const r=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),mode,input],{encoding:'utf8',timeout:120000,maxBuffer:2000000});if(r.status!==0)throw Error(r.stderr||r.stdout);rows.push(JSON.parse(r.stdout));}
 const report={fixture:input,note:'Synthetic history workload; identical input in separate processes, not the production save or a production capacity guarantee.',rows};
 fs.mkdirSync('outputs/memory-r31',{recursive:true});fs.writeFileSync('outputs/memory-r31/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
