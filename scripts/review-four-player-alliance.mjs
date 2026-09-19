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
const root=process.cwd(),out=path.join(root,'outputs/alliance-loading-20260918');
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
const states=accounts.map(a=>s.state(a));
assert.ok(states.every(state=>state.fog.sharedVision.length===3));
const report={scope:'Local real Chrome with four isolated allied accounts on real Europe/South America map; no production data',players:[],errors:[],httpErrors:[]};
const handler=createCampaignApiHandler({campaign:s}),serveStatic=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await serveStatic(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 for(const a of accounts){
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),a.token);
  await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__allianceLoadingReview={map,state:()=>campaignState};'});});
  const page=await context.newPage();page.setDefaultTimeout(45000);
  page.on('pageerror',e=>{report.errors.push({player:a.id,error:e.message});console.log('BROWSER ERROR '+e.message);});
  page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname.startsWith('/api/'))report.httpErrors.push({url:r.url(),status:r.status()});});
  const start=performance.now();await page.goto(url+'/game',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
  const loadMs=Math.round(performance.now()-start);
  const state=await page.evaluate(()=>{const s=window.__allianceLoadingReview.state();return {allies:s.fog.sharedVision.length,scouts:s.fog.scoutSourceTerritoryIds.length,visible:s.fog.visibleTerritoryIds.length};});
  assert.equal(state.allies,3);assert.ok(state.scouts>0);
  const pan=performance.now();await page.evaluate(()=>{window.__allianceLoadingReview.map.panBy([80,0],{animate:false});});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const panMs=Math.round(performance.now()-pan);
  await page.screenshot({path:path.join(out,a.id+'.png')});
  report.players.push({id:a.id,loadMs,panMs,...state});console.log(JSON.stringify(report.players.at(-1)));
  await context.close();
 }
 assert.equal(report.errors.length,0);assert.equal(report.httpErrors.length,0);report.passed=true;
} catch(error){report.passed=false;report.failure=error.stack;throw error;}
finally{fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));}
