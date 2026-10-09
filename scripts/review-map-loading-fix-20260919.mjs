import {gzipSync} from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {CampaignService} from '../campaign-service.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
import {relationKey} from '../shared/config/diplomacy.mjs';
import {createCampaignApiHandler,sendJson} from '../server/http/campaign-api-handler.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/map-loading-fix-20260919');
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),catalog=read('assets/data/s4-player-catalog.json');
// Entirely in memory: never hydrate or overwrite an existing player save.
const s=new CampaignService({repository:{load:()=>null,save:()=>{}},catalog,territoryIndex:index,territoryGeoJson:geo});
const accounts=[];
for(const [i,country] of ['IRL','GBR','FRA','BRA'].entries()){
 const land=index.territories.filter(t=>t.countryCode===country&&t.centroid[1]>(country==='BRA'?-40:40)).slice(0,12),id='alliance-review-'+i;
 const roster=[];for(let group=0;group<2;group++)for(const role of ['GK','LB','CB','CB','RB','DM','AM','AM','LW','RW','ST']){
  const card=catalog.find(p=>p.role===role&&!p.isX&&!roster.some(q=>q.cardDefinitionId===p.id));assert.ok(card);
  roster.push({...structuredClone(card),id:id+':'+card.id,cardDefinitionId:card.id,cardInstanceId:id+':'+card.id});
 }
 const a={id,token:'isolated-'+id,nickname:country+'测试',setupComplete:true,createdAt:Date.now(),homeTerritoryId:land[0].territoryId,gold:100000,mapColor:['#5577aa','#aa6655','#55aa77','#aabb55'][i],draft:{version:DRAFT_VERSION,teamName:country+'测试队',roster,totalPicks:roster.length},scouting:{schemaVersion:2,units:{},tasks:[]}};
 a.playerSquads={schemaVersion:2,assignments:Object.fromEntries(roster.map((p,j)=>[p.id,j<11?'expedition':'garrison']))};
 a.tactics={squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id)},garrison:{starters:roster.slice(11).map(p=>p.id)}}};
 const owned=land.slice(0,6).map(t=>t.territoryId);
 for(const t of land.slice(0,6))Object.assign(s.world.territories[t.territoryId],{ownerType:'player',ownerId:id,capitalOf:t.territoryId===a.homeTerritoryId?id:null,buildings:[]});
 for(const [j,t] of land.slice(6).entries()){
  Object.assign(s.world.territories[t.territoryId],{ownerType:'neutral',ownerId:null,capitalOf:null});
  a.scouting.units[j]={id:String(j),name:'Scout '+j,territoryId:t.territoryId,originTerritoryId:a.homeTerritoryId,movement:null};
 }
 s.accounts.set(id,a);accounts.push(a);s.world.players[id]={playerId:id,territoryIds:owned,capitalTerritoryId:a.homeTerritoryId};
 if(i)s.world.diplomacy.relationships[relationKey(accounts[0].id,id)]={players:[accounts[0].id,id],state:'alliance',locations:{}};
}
s.save();
fs.mkdirSync(out,{recursive:true});
const state=s.state(accounts[0]);
let slow=false,territoryRequests=0;
const packed=gzipSync(fs.readFileSync('assets/data/campaign-territories.geojson'));
const serve=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{if(slow&&req.url.includes('campaign-territories.geojson')){territoryRequests++;res.writeHead(200,{'content-type':'application/json','content-encoding':'gzip'});let offset=0;const size=Math.ceil(packed.length/38);const timer=setInterval(()=>{res.write(packed.subarray(offset,offset+size));offset+=size;if(offset>=packed.length){clearInterval(timer);res.end();}},1000);res.on('close',()=>clearInterval(timer));return;}if(req.url.startsWith('/api/')){sendJson(res,200,{state,ok:true});return;}await serve(req,res);}catch(e){sendJson(res,500,{error:e.message});}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={scope:'Isolated fixture; normal Chrome without GPU bypass flags; mobile is emulated on this PC, not a physical phone.',cases:[]};
try{
 for(const mode of ['desktop','slow-compatible','stalled-bootstrap-state','blocked-entry-dependency','webgl-disabled']){
  slow=mode==='slow-compatible';territoryRequests=0;
  const context=await browser.newContext(mode==='mobile-emulated'?{viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:3}:{viewport:{width:1600,height:1000}});
  await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-review'));
  if(mode==='stalled-bootstrap-state')await context.route('**/api/campaign/state',()=>{});
  if(mode==='blocked-entry-dependency')await context.route('**/client/core/campaign-api-client.js*',r=>r.abort('failed'));
  if(mode==='webgl-disabled')await context.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:get.call(this,type,...args)};});
  const page=await context.newPage(),errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(new URL(r.url()).pathname));
  const started=performance.now();await page.goto('http://127.0.0.1:'+server.address().port+'/versus/'+(slow?'?renderer=leaflet':''),{waitUntil:'domcontentloaded'});
  if(mode==='stalled-bootstrap-state'||mode==='blocked-entry-dependency')await page.waitForTimeout(32000);
  else await page.waitForFunction(()=>document.querySelector('#map-loader')?.matches('.is-ready,.is-error'),null,{timeout:60000}).catch(e=>errors.push('map wait timed out'));
  const ui=await page.evaluate(()=>({ready:document.querySelector('#map-loader')?.classList.contains('is-ready'),loaderText:document.querySelector('#map-loader')?.innerText,authForm:!!document.querySelector('#entry-auth-form'),bootstrap:!!window.campaignBootstrap,recoveryVisible:!!document.querySelector('.map-loader-actions:not([hidden])'),sessionRetained:!!localStorage.getItem('yellowdogs-chronicles-token'),retryButton:!!document.querySelector('#entry-retry'),entryText:document.querySelector('#campaign-entry')?.innerText,entryChildren:document.querySelector('#campaign-entry')?.childElementCount}));
  const row={mode,territoryRequests,elapsedMs:Math.round(performance.now()-started),...ui,errors,failed};
  if(mode==='webgl-disabled'){await page.locator('.map-loader-actions a').filter({hasText:'打开兼容地图'}).click();await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});row.compatibleRecovered=true;}
  if(mode==='slow-compatible'){assert.equal(ui.ready,true);assert.equal(territoryRequests,1);}
  if(mode==='stalled-bootstrap-state'){assert.equal(ui.retryButton,true);assert.equal(ui.sessionRetained,true);}
  if(mode==='blocked-entry-dependency')assert.match(ui.entryText,/重新加载/);
  if(mode==='desktop')assert.equal(ui.ready,true);
  await page.screenshot({path:path.join(out,mode+'.png')});report.cases.push(row);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(row));await context.close();
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
