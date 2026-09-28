import os from 'node:os';
import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM ?? (os.homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'))('playwright');
const out='outputs/mobile-player-cards-review';fs.mkdirSync(out,{recursive:true});const links=fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8">${links}</head><body><button id="trigger"><span data-inventory-count></span></button><section id="inventory-window" hidden></section><section id="card-management-window" class="card-management-window standard-window" hidden></section></body></html>`;
const serve=createStaticHandler(process.cwd()),server=http.createServer((req,res)=>{if(req.url==='/review.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else serve(req,res)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));const check=(name,ok)=>{checks.push({name,pass:!!ok});assert.ok(ok,name);};
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/review.html`);
 await page.evaluate(async()=>{
  const {createInventoryController}=await import('/client/inventory/inventory-controller.js'),{createCampaignStore}=await import('/client/core/campaign-store.js'),{createCardManagementController}=await import('/client/cards/card-management-controller.js'),{CARD_MANAGEMENT_DEFAULTS}=await import('/shared/config/card-management.mjs'),{observeCardStage}=await import('/client/ui/card-stage-performance.js');
  const catalog=await (await fetch('/assets/data/s4-player-catalog.json')).json();window.materials=catalog.filter(p=>p.grade==='C').slice(0,5).map((p,i)=>({...p,id:'c'+i,playerId:'c'+i,squad:'garrison',recycleValue:100,minimumListingPrice:100}));window.candidates=catalog.filter(p=>p.grade==='B').slice(0,3).map((p,i)=>({...p,id:'r'+i,playerId:'r'+i}));
  window.view={cards:materials,listings:[],history:[],config:CARD_MANAGEMENT_DEFAULTS};window.store=createCampaignStore({playerId:'a',setupComplete:true,draft:{roster:materials},wallet:{gold:10000},inventory:{totalPacks:1,packs:[],pendingOpening:{id:'opening',cards:candidates}}});window.posts=[];window.claims=[];window.sync=[];window.toasts=[];window.mapPaused=false;observeCardStage(document,v=>mapPaused=v);
  window.inventory=createInventoryController({trigger:document.querySelector('#trigger'),windowRoot:document.querySelector('#inventory-window'),getCampaignState:store.getState,campaignStore:store,getCampaignRequest:()=>async(url,options)=>{claims.push(options.body);if(window.failClaim){window.failClaim=false;throw Error('network failure')};if(window.holdClaim)await new Promise(resolve=>window.finishClaim=resolve);return {player:candidates.find(p=>p.id===options.body.playerId),state:{...store.getState(),inventory:{totalPacks:0,packs:[],pendingOpening:null}}};},showToast:t=>toasts.push(t)});
  window.manager=createCardManagementController({root:document.querySelector('#card-management-window'),getCampaignState:store.getState,campaignStore:store,getCampaignRequest:()=>async(url,options)=>{if(!options){if(window.delaySync)return new Promise(resolve=>sync.push({url,resolve}));return view;}posts.push({url,...options});if(url.endsWith('/preview'))return {kind:'trade-up',cardIds:materials.map(p=>p.id),cards:materials,targetGrade:'B',candidates,quote:'quote'};window.delaySync=true;return {result:{kind:'trade-up',card:candidates[0],cards:materials}};},showToast:t=>toasts.push(t)});inventory.open();
 });
 await page.locator('[data-player-card-action="pack-choice"]').first().waitFor();

 for(const size of [{width:320,height:740},{width:390,height:844},{width:780,height:360},{width:768,height:1024},{width:1440,height:1000}]){
  await page.setViewportSize(size);await page.waitForTimeout(1100);
  const widths=await page.locator('.inventory-choice-card').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().width));
  check('compact choice '+size.width,widths.every(w=>w>70&&w<=(size.width>1024?300:151)));
  check('viewport overflow '+size.width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:out+'/'+size.width+'-choice.png'});
 }
 await page.setViewportSize({width:390,height:844});await page.locator('[data-player-card-action="pack-choice"]').first().click();await page.locator('.inventory-acquired-card').waitFor();
 await page.waitForTimeout(1200);check('compact acquired card',(await page.locator('.inventory-acquired-card').boundingBox()).width<=159);await page.screenshot({path:out+'/390-acquired.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
