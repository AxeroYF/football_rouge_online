import {prepareHistoryCompaction} from '../server/application/history-compaction.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {performance} from 'node:perf_hooks';
import {CampaignService} from '../campaign-service.mjs';import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
fs.mkdirSync('outputs/memory-r32',{recursive:true});
const source=read('outputs/memory-r31/report.json'),input=read(source.fixture),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-http-r31-'));
const catalog=read('assets/data/s4-player-catalog.json'),index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json');
const c=new CampaignService({dataPath:path.join(dir,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const roster=[],roles=['GK','LB','CB','CB','RB','DM','AM','AM','LW','RW','ST'];
for(let g=0;g<3;g++)for(const role of roles){const p=catalog.find(p=>p.role===role&&!p.isX&&!roster.some(q=>q.id===p.id));roster.push(p);}
const homes=index.territories.filter(t=>t.playable&&c.world.territories[t.territoryId].ownerType==='neutral');
for(const [i,[id,hist]]of Object.entries(input.accounts).entries()){
 const home=homes[i].territoryId,a={...hist,id,nickname:id,token:'isolated-'+id,createdAt:Date.now(),setupComplete:true,homeTerritoryId:home,gold:50000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:id,totalPicks:33,roster:structuredClone(roster)},resources:{fans:5000}};
 a.enhancement={offers:{},history:[],...a.enhancement};
 a.playerSquads={schemaVersion:2,assignments:Object.fromEntries(roster.map((p,j)=>[p.id,j<22?'expedition':'garrison']))};a.tactics={squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};c.accounts.set(id,a);c.playerPacks.migrateAccount(a);c.world.players[id]={playerId:id,territoryIds:[home],capitalTerritoryId:home};Object.assign(c.world.territories[home],{ownerType:'player',ownerId:id,capitalOf:id,buildings:[]});c.buildings.ensureCapitalStadium(a,c.world,home);
}
prepareHistoryCompaction(c,{maxRecords:Infinity});
const players=[...c.accounts.values()];
for(const a of players.slice(0,2)){c.eliteRaids.touch(a,{foreground:true});c.eliteChallenges.begin(a,{clubId:'real-madrid',requestId:crypto.randomUUID()});}
const day=c.eliteRaids.ensureDay();for(const [i,r] of day.raids.entries()){r.status='waiting';r.index=0;r.route=[{territoryId:players[i].homeTerritoryId,ownerId:players[i].id}];}
for(const a of players){const t=c.world.territories[a.homeTerritoryId];t.buildings.push({id:'waiting-'+a.id,type:'university',status:'constructing',level:1,constructionStartedAt:Date.now(),completesAt:Date.now()+86400000,productionWork:{required:1e12,completed:0,updatedAt:Date.now(),ownerId:a.id}});}
c.save();c.persist();const originalBytes=fs.statSync(path.join(dir,'campaign-accounts.json')).size;
const start=performance.now();const child=spawn(process.execPath,['--max-old-space-size=512','server.mjs'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,NODE_ENV:'production',ADMIN_BOOTSTRAP_PASSWORD:'isolated-memory-test-password'},stdio:['ignore','pipe','pipe']});let logs='',err='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>err+=x);
let base;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const metrics=[],errors=[],versions=new Map();
try{
 const deadline=Date.now()+60000;while(!base&&Date.now()<deadline){const m=logs.match(/http:\/\/127\.0\.0\.1:(\d+)\/versus/);if(m)base='http://127.0.0.1:'+m[1];else{if(child.exitCode!==null)throw Error(err);await sleep(100);}}
 if(!base)throw Error('startup timeout');const startupMs=performance.now()-start;
 const request=async(route,headers={})=>{const at=performance.now();const r=await fetch(base+route,{headers,signal:AbortSignal.timeout(15000)}),text=await r.text();metrics.push({route,status:r.status,ms:performance.now()-at,bytes:Buffer.byteLength(text)});if(!r.ok)errors.push({route,status:r.status,body:text.slice(0,500)});return r.headers.get('content-type')?.includes('json')?JSON.parse(text):text;};
 for(let round=0;round<20;round++){
  await Promise.all([request('/healthz'),request('/versus/'),...[...c.accounts.values()].map(async a=>{const result=await request('/api/campaign/state',{authorization:'Bearer '+a.token,'x-campaign-delta':'1','x-campaign-versions':JSON.stringify(versions.get(a.id)??{})});if(result.stateVersions)versions.set(a.id,result.stateVersions);})]);if(errors.length)throw Error(JSON.stringify(errors.slice(0,2)));await sleep(3000);
 }
 const summarize=route=>{const rows=metrics.filter(r=>r.route===route),times=rows.map(r=>r.ms).sort((a,b)=>a-b);return {count:rows.length,maxMs:times.at(-1),p95Ms:times[Math.floor(times.length*.95)],meanMs:times.reduce((a,b)=>a+b,0)/times.length};};
 const report={note:'Local synthetic 12-account large-history HTTP test, 12 constructing buildings, 2 active elite matches and 2 waiting raids, 512MiB old-space limit. Not production capacity.',originalBytes,compactedBytes:fs.statSync(path.join(dir,'campaign-accounts.json')).size,startupMs,home:summarize('/versus/'),health:summarize('/healthz'),state:summarize('/api/campaign/state'),errors,runtime:logs.split('\n').filter(s=>s.includes('[campaign-runtime]')),stderr:err};
 fs.writeFileSync('outputs/memory-r32/http-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));const sample=JSON.parse(report.runtime.at(-1)?.split('[campaign-runtime] ')[1]??'null');if(!sample||sample.save.count>50)throw Error('unexpected save amplification');if(errors.length)throw Error('HTTP errors');
}finally{child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(10000)]);if(child.exitCode===null)child.kill('SIGKILL');}
