import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {districtFixture} from '../test/oil-fixture.mjs';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'),{chromium}=require('playwright');
const out='outputs/optional-movement-oil-20260918';fs.mkdirSync(out,{recursive:true});
const exp=districtFixture(),coal=coalitionFixture();
function action(a,kind,extra={}){const army=coal.s.coalitions.find(a);return coal.s.coalitions.mutate(a,{action:kind,requestId:crypto.randomUUID(),armyId:army?.id,revision:army?.revision,...extra});}
action(coal.a,'create');for(const p of coal.a.draft.roster.slice(0,6))action(coal.a,'lend',{playerId:p.id});for(const p of coal.b.draft.roster.slice(6,11))action(coal.b,'lend',{playerId:p.id});action(coal.a,'auto-lineup');
const state=(f)=>({playerId:f.a.id,setupComplete:true,world:f.s.world,expeditionPiece:f.s.state(f.a).expeditionPiece});
const index=fs.readFileSync('index.html','utf8'),styles=[...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('\n'),map=index.match(/<script type="importmap">[\s\S]*?<\/script>/)[0],panel=index.match(/<section id="expedition-move-confirm"[\s\S]*?<\/section>/)[0];
const html=`<!doctype html><html><head>${styles}${map}</head><body><nav class="topbar"><div class="nav"></div></nav><div id="map"></div>${panel}<script type="module">
import {createExpeditionPieceController} from './client/map/expedition-piece-controller.js';
import {createCoalitionController} from './client/social/coalition-controller.js';
import {createCampaignStore} from './client/core/campaign-store.js';
const coalition=location.search.includes('coalition'),fixture=await fetch('/fixture'+location.search).then(r=>r.json());
const store=createCampaignStore(fixture.state),toasts=[],calls=[];
const request=async(url,options={})=>{calls.push({url,...options});const r=await fetch(url,{method:options.method??'GET',headers:{'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});const value=await r.json();if(!r.ok)throw Error(value.message);return value;};
const metadata=new Map(fixture.territories.map(t=>[t.territoryId,t]));
let controller;
if(coalition){controller=createCoalitionController({getState:store.getState,getRequest:()=>request,campaignStore:store,mapElement:document.querySelector('#map'),metadata,showToast:t=>toasts.push(t)});await controller.openActions();}
else{const marker={on(){return this;},addTo(){return this;},setLatLng(){},setIcon(){},remove(){}};
controller=createExpeditionPieceController({Leaflet:{DomEvent:{disableClickPropagation(){}},divIcon:x=>x,marker:()=>marker,polyline:()=>marker},map:{getZoom:()=>6},mapElement:document.querySelector('#map'),layer:{clearLayers(){}},territoryMetadataById:metadata,getCampaignState:store.getState,getCampaignRequest:()=>request,sourcePointToDisplay:(_id,p)=>p,campaignStore:store,applyCampaignWorldSnapshot(){},showToast:t=>toasts.push(t)});
controller.beginMoveMode();controller.handleTerritoryClick('t1');}
window.review={controller,calls,toasts};
</script></body></html>`;
const staticHandler=createStaticHandler(process.cwd());
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');try{
 if(url.pathname==='/review'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);}
 if(url.pathname==='/fixture'){const f=url.search.includes('coalition')?coal:exp;res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({state:state(f),territories:f.s.territoryIndex.territories}));}
 if(url.pathname.startsWith('/api/')){let body='';for await(const chunk of req)body+=chunk;const b=body?JSON.parse(body):{};let value;
 if(url.pathname.endsWith('/expedition/estimate'))value=exp.s.estimateExpedition(exp.a,b.territoryId,b);
 else if(url.pathname.endsWith('/expedition/move'))value=exp.s.moveExpedition(exp.a,b.territoryId,b);
 else if(url.pathname.endsWith('/coalition')){
  if(req.method==='GET')value={view:coal.s.coalitions.view(coal.a)};
  else if(b.action==='estimate')value={estimate:coal.s.coalitions.estimate(coal.s.coalitions.find(coal.a),b)};
  else value={...coal.s.coalitions.mutate(coal.a,b),view:coal.s.coalitions.view(coal.a),state:state(coal)};
 }else throw Error('unknown route');
 res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(value));
 }
 return staticHandler(req,res,url.pathname);
 }catch(e){res.writeHead(e.statusCode??500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const report={checks:[],errors:[]};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(e.message));const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/review');const selector=page.locator('[data-expedition-use-oil]');await selector.waitFor();await selector.selectOption('slow');
 assert.match(await page.locator('[data-expedition-duration]').innerText(),/不耗石油.*×4/);
 await selector.selectOption('fuel');assert.match(await page.locator('[data-expedition-duration]').innerText(),/消耗 2 石油/);
 await selector.selectOption('slow');await page.screenshot({path:out+'/expedition.png'});
 const oil=exp.a.oil.balance;await page.locator('[data-expedition-move-confirm]').click();await page.waitForFunction(()=>review.calls.some(c=>c.url.endsWith('/move')));await page.locator('#expedition-move-confirm').waitFor({state:'hidden'});
 assert.equal(exp.a.oil.balance,oil);assert.equal(exp.a.expeditionPiece.movement.useOil,false);assert.equal(exp.a.expeditionPiece.movement.durationMs,240000);report.checks.push('expedition selector toggles time and submits slow trip without fuel debit');
 await page.goto(base+'/review?coalition');await page.locator('[data-coalition-action="select-move"]').click();await page.evaluate(()=>review.controller.handleTerritoryClick('b'));
 const choice=page.locator('[data-coalition-use-oil]');await choice.waitFor();await choice.selectOption('slow');await page.waitForFunction(()=>!document.querySelector('[data-coalition-use-oil]').disabled&&document.querySelector('[data-coalition-use-oil]').value==='slow');
 assert.match(await page.locator('.coalition-quote').innerText(),/预计 4 分钟 · 石油 0/);
 await page.screenshot({path:out+'/coalition.png'});const balances=[coal.a.oil.balance,coal.b.oil.balance];
 await page.locator('[data-coalition-action="confirm-order"]').click();await page.waitForFunction(()=>!document.querySelector('[data-coalition-action="confirm-order"]'));
 assert.deepEqual([coal.a.oil.balance,coal.b.oil.balance],balances);assert.equal(coal.s.coalitions.find(coal.a).movement.useOil,false);report.checks.push('coalition requotes slow mode, shows zero shares, and charges no ally');
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{fs.writeFileSync(out+'/browser.json',JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
