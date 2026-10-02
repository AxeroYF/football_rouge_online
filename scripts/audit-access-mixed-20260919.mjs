import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {gzipSync} from 'node:zlib';
import http from 'node:http';
import {createCampaignApiHandler,sendJson} from '../server/http/campaign-api-handler.mjs';
import {CampaignService} from '../campaign-service.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const out=new URL('../outputs/access-mixed-audit-20260919/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-launch-audit-'));let clock=Date.now();
const s=new CampaignService({now:()=>clock,dataPath:path.join(temp,'campaign.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const roles=['GK','LB','CB','CB','RB','DM','AM','AM','LW','RW','ST'],roster=[];
for(let group=0;group<3;group++)for(const role of roles){const p=catalog.find(p=>p.role===role&&!p.isX&&!roster.some(q=>q.id===p.id));if(!p)throw Error(role);roster.push(p);}
const homes=index.territories.filter(t=>t.playable&&s.world.territories[t.territoryId].ownerType==='neutral');
const report={at:new Date().toISOString(),node:process.version,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,hostMemoryGB:os.totalmem()/2**30,note:'Local synthetic benchmark; 33 cards/account, one territory, no history. Not target-server capacity. No production saves read or modified.',rows:[]};
const metric=values=>{const a=[...values].sort((a,b)=>a-b);return {mean:a.reduce((s,v)=>s+v,0)/a.length,p95:a[Math.min(a.length-1,Math.floor(a.length*.95))],max:a.at(-1)};};
const time=fn=>{const t=performance.now();fn();return performance.now()-t;};
for(const count of [60]){
 while(s.accounts.size<count){const i=s.accounts.size,home=homes[i].territoryId,id='audit-'+i,a={id,nickname:id,token:'isolated-'+id,createdAt:clock,setupComplete:true,homeTerritoryId:home,gold:50000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:id,totalPicks:33,roster:structuredClone(roster)},resources:{fans:5000}};
 a.playerSquads={schemaVersion:2,assignments:Object.fromEntries(roster.map((p,j)=>[p.id,j<22?'expedition':'garrison']))};a.tactics={squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};s.accounts.set(id,a);s.playerPacks.migrateAccount(a);s.world.players[id]={playerId:id,territoryIds:[home],capitalTerritoryId:home};Object.assign(s.world.territories[home],{ownerType:'player',ownerId:id,capitalOf:id,buildings:[]});s.buildings.ensureCapitalStadium(a,s.world,home);}
 s.save();for(const a of s.accounts.values())s.state(a);
 const times=[],bytes=[],gzip=[],accounts=[...s.accounts.values()];
 for(let i=0;i<count*2;i++){let body;times.push(time(()=>body=JSON.stringify({state:s.state(accounts[i%count])})));bytes.push(Buffer.byteLength(body));gzip.push(gzipSync(body,{level:2}).length);}
 const saves=[];for(let i=0;i<5;i++){clock+=5000;saves.push(time(()=>s.save()));}
 const row={accounts:count,stateJsonMs:metric(times),responseBytes:metric(bytes),gzipBytes:metric(gzip),fullSaveMs:metric(saves),saveBytes:fs.statSync(path.join(temp,'campaign.json')).size,memoryMB:process.memoryUsage().rss/2**20};report.rows.push(row);console.log(JSON.stringify(row));
}
const begin=[],ticks=[];for(const a of [...s.accounts.values()].slice(0,5))begin.push(time(()=>s.eliteChallenges.begin(a,{clubId:'real-madrid',requestId:crypto.randomUUID()})));
for(let i=0;i<150;i++){clock+=100;ticks.push(time(()=>s.advanceActiveChallenges(clock,{maximumMatches:1,maximumChainsPerMatch:1})));}
report.matches={concurrent:5,beginMs:metric(begin),schedulerSliceMs:metric(ticks),saveMs:time(()=>s.save()),saveBytes:fs.statSync(path.join(temp,'campaign.json')).size,memoryMB:process.memoryUsage().rss/2**20,minutes:Object.values(s.world.eliteChallenges).map(c=>c.leg.match.minute)};
const handler=createCampaignApiHandler({campaign:s});
const server=http.createServer(async(req,res)=>{try{await handler(req,res,new URL(req.url,'http://localhost').pathname,req.url);}catch(e){sendJson(res,e.statusCode??500,{error:e.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 report.http=[];
 for(const concurrency of [10,30,60]){const samples=[],errors=[];for(let round=0;round<3;round++)await Promise.all([...s.accounts.values()].slice(0,concurrency).map(async a=>{const at=performance.now();const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/campaign/state',{headers:{authorization:'Bearer '+a.token}});await r.arrayBuffer();samples.push(performance.now()-at);if(r.status!==200)errors.push(r.status);}));report.http.push({concurrency,requests:samples.length,responseMs:metric(samples),errors});}
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
const {monitorEventLoopDelay}=await import('node:perf_hooks');
const {createChallengeScheduler}=await import('../server/scheduler/challenge-scheduler.mjs');
const {createStaticHandler}=await import('../server/http/static-handler.mjs');
const serveStatic=createStaticHandler(process.cwd());
const mixedServer=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p==='/healthz'){sendJson(res,200,{status:'ok'});return;}if(p.startsWith('/api/'))await handler(req,res,p,req.url);else await serveStatic(req,res);}catch(e){sendJson(res,e.statusCode??500,{error:e.message});}});
await new Promise(r=>mixedServer.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+mixedServer.address().port;
const delay=monitorEventLoopDelay({resolution:10});delay.enable();
const saves=[],mixedTicks=[],components={},originalSave=s.save.bind(s),originalAdvance=s.advanceActiveChallenges.bind(s);
for(const [object,key,label] of [[s.repository,'save','disk-and-json'],[s.territoryProduction,'prepare','territory-production'],[s.fog,'refreshAll','fog-all'],[s.operatingCosts,'prepare','operating-costs'],[s.oil,'prepare','oil'],[s.fitness,'prepare','fitness'],[s.coalitions,'prepare','coalition']]){const old=object[key].bind(object);object[key]=(...args)=>{const at=performance.now();try{return old(...args)}finally{(components[label]??=[]).push(performance.now()-at)}};}
s.save=(...args)=>{const at=performance.now();try{return originalSave(...args)}finally{saves.push(performance.now()-at)}};
s.advanceActiveChallenges=(...args)=>{const at=performance.now();try{return originalAdvance(...args)}finally{mixedTicks.push(performance.now()-at)}};
const wallStart=Date.now(),gameStart=clock;const current=()=>clock=gameStart+Date.now()-wallStart;
s.now=current;
const scheduler=createChallengeScheduler({campaign:s,now:current});
const samples={state:[],health:[],page:[]},errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(kind,path,token){const at=performance.now();try{const r=await fetch(origin+path,{headers:token?{authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(10000)});await r.arrayBuffer();samples[kind].push(performance.now()-at);if(!r.ok)errors.push({kind,status:r.status});}catch(e){errors.push({kind,error:e.name})}}
const deadline=Date.now()+30000;
async function poll(kind,path,token,interval,offset=0){await sleep(offset);while(Date.now()<deadline){const start=Date.now();await request(kind,path,token);await sleep(Math.max(0,interval-(Date.now()-start)));}}
try{await Promise.all([...s.accounts.values()].map((a,i)=>poll('state','/api/campaign/state',a.token,5000,i*70)).concat([poll('health','/healthz',null,200),poll('page','/versus/',null,500)]));}
finally{scheduler.stop({flush:false});delay.disable();mixedServer.closeAllConnections();await new Promise(r=>mixedServer.close(r));}
report.mixed={seconds:30,accounts:60,matches:5,scope:'same-process loopback clients, no public network, no nginx; event-loop delay measured separately',responses:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,{requests:v.length,...metric(v)}])),eventLoopDelayMs:{p95:delay.percentile(95)/1e6,p99:delay.percentile(99)/1e6,max:delay.max/1e6},saves:metric(saves),slices:metric(mixedTicks),components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,{calls:v.length,totalMs:v.reduce((a,b)=>a+b,0),...metric(v)}])),rssMB:process.memoryUsage().rss/2**20,errors};
const actor=[...s.accounts.values()][0];actor.passwordSalt='a'.repeat(32);actor.passwordHash=crypto.scryptSync('isolated-password',actor.passwordSalt,64).toString('hex');
const first=s.login(actor.nickname,'isolated-password').token;const second=s.login(actor.nickname,'isolated-password').token;let oldStatus=200;try{s.authenticate(first)}catch(e){oldStatus=e.statusCode}
report.multiDeviceSession={tokensDiffer:first!==second,oldTokenStatus:oldStatus,newTokenWorks:s.authenticate(second)===actor};
console.log(JSON.stringify({mixed:report.mixed,multiDeviceSession:report.multiDeviceSession}));
const values=Object.entries(resources.territories).filter(([id])=>index.territories.find(t=>t.territoryId===id)?.playable).map(([,v])=>v.yields);
report.economy={playableTerritories:values.length,ordinaryTerritories:homes.length,rates:Object.fromEntries(['gold','production','science'].map(key=>[key,{...metric(values.map(v=>v[key])),zero:values.filter(v=>v[key]===0).length,min:Math.min(...values.map(v=>v[key]))}]))};
fs.writeFileSync(new URL('report.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report.matches));console.log(JSON.stringify(report.economy));console.log(JSON.stringify(report.http));
