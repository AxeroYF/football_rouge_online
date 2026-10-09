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
const out=new URL('../outputs/performance-20260919/interaction-capacity/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-launch-audit-'));let clock=Date.now();
const s=new CampaignService({now:()=>clock,dataPath:path.join(temp,'campaign.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const roles=['GK','LB','CB','CB','RB','DM','AM','AM','LW','RW','ST'],roster=[];
for(let group=0;group<3;group++)for(const role of roles){const p=catalog.find(p=>p.role===role&&!p.isX&&!roster.some(q=>q.id===p.id));if(!p)throw Error(role);roster.push(p);}
const homes=index.territories.filter(t=>t.playable&&s.world.territories[t.territoryId].ownerType==='neutral');
const report={at:new Date().toISOString(),node:process.version,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,hostMemoryGB:os.totalmem()/2**30,note:'Local synthetic benchmark; 33 cards/account, one territory, no history. Not target-server capacity. No production saves read or modified.',rows:[]};
const metric=values=>{const a=[...values].sort((a,b)=>a-b);return {mean:a.reduce((s,v)=>s+v,0)/a.length,p95:a[Math.min(a.length-1,Math.floor(a.length*.95))],max:a.at(-1)};};
const time=fn=>{const t=performance.now();fn();return performance.now()-t;};
for(const count of [10]){
 while(s.accounts.size<count){const i=s.accounts.size,home=homes[i].territoryId,id='audit-'+i,a={id,nickname:id,token:'isolated-'+id,createdAt:clock,setupComplete:true,homeTerritoryId:home,gold:50000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:id,totalPicks:33,roster:structuredClone(roster)},resources:{fans:5000}};
 a.playerSquads={schemaVersion:2,assignments:Object.fromEntries(roster.map((p,j)=>[p.id,j<22?'expedition':'garrison']))};a.tactics={squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};s.accounts.set(id,a);s.playerPacks.migrateAccount(a);s.world.players[id]={playerId:id,territoryIds:[home],capitalTerritoryId:home};Object.assign(s.world.territories[home],{ownerType:'player',ownerId:id,capitalOf:id,buildings:[]});s.buildings.ensureCapitalStadium(a,s.world,home);}
 s.save();for(const a of s.accounts.values())s.state(a);
 const times=[],bytes=[],gzip=[],accounts=[...s.accounts.values()];
 for(let i=0;i<count*2;i++){let body;times.push(time(()=>body=JSON.stringify({state:s.state(accounts[i%count])})));bytes.push(Buffer.byteLength(body));gzip.push(gzipSync(body,{level:2}).length);}
 const saves=[];for(let i=0;i<5;i++){clock+=5000;saves.push(time(()=>s.save()));}
 const row={accounts:count,stateJsonMs:metric(times),responseBytes:metric(bytes),gzipBytes:metric(gzip),fullSaveMs:metric(saves),saveBytes:fs.statSync(path.join(temp,'campaign.json')).size,memoryMB:process.memoryUsage().rss/2**20};report.rows.push(row);console.log(JSON.stringify(row));
}

const account=s.accounts.values().next().value;
const full=[],compact=[];let fullBody,patchBody;
for(let i=0;i<10;i++){
 full.push(time(()=>fullBody=JSON.stringify(s.state(account))));
 compact.push(time(()=>patchBody=JSON.stringify(s.actionState(account))));
}
report.actionSnapshots={fullMs:metric(full),compactMs:metric(compact),fullBytes:Buffer.byteLength(fullBody),compactBytes:Buffer.byteLength(patchBody)};
const extra=homes[10].territoryId;Object.assign(s.world.territories[extra],{ownerType:'player',ownerId:account.id});s.world.players[account.id].territoryIds.push(extra);s.save();
const legacyMove=s.moveExpedition(account,extra,{useOil:false});s.cancelExpedition(account);
const compactMove=s.moveExpedition(account,extra,{useOil:false,compact:true});
if(!legacyMove.state||compactMove.state||!compactMove.statePatch.expeditionPiece.moving||compactMove.statePatch.attackableTerritoryIds.length)throw Error('Movement response contract');
const selected=account.draft.roster[0].id;
const assignment=s.assignPlayerSquad(account,selected,'garrison',{compact:true});
if(assignment.world||assignment.playerSquads.assignments[selected]!=='garrison')throw Error('Squad response contract');
report.movement={legacyBytes:Buffer.byteLength(JSON.stringify(legacyMove)),compactBytes:Buffer.byteLength(JSON.stringify(compactMove)),started:true,durationMs:compactMove.expeditionPiece.movement.durationMs};
report.squad={updated:true,bytes:Buffer.byteLength(JSON.stringify(assignment))};
fs.writeFileSync(new URL('report.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify({actionSnapshots:report.actionSnapshots,movement:report.movement,squad:report.squad}));
