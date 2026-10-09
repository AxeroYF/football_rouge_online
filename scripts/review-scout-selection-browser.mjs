import os from 'node:os';
import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import {createRequire} from 'node:module';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM ?? (os.homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'))('playwright');
const index=fs.readFileSync('index.html','utf8'),links=[...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('');const out='outputs/scout-selection-review';fs.mkdirSync(out,{recursive:true});
const fragment=index.slice(index.indexOf('<aside id="scouting-window"'),index.indexOf('<section id="expedition-move-confirm"'));
const fixture=`<!doctype html><html data-ui-theme="club"><head><meta name="viewport" content="width=device-width,initial-scale=1">${links}</head><body><div class="map-stage" style="position:fixed;inset:0;width:100%;height:100%">${fragment}<div id="notices"></div></div><script type="module">
import {createScoutingController} from '/client/buildings/scouting-controller.js';import {createCampaignStore} from '/client/core/campaign-store.js';import {SCOUTING_RULES,scoutingLevel} from '/shared/config/scouting.mjs';
const cards=[0,1,2].map(i=>({playerId:'candidate-'+i,name:'候选球员'+i,grade:'A',overall:80,role:'ST'}));const task={id:'task',territoryId:'a',status:'ready',cards};if(location.search.includes('queue')){task.roundCount=2;task.rounds=[{cards},{cards:cards.map(c=>({...c,playerId:c.playerId+'-round2'}))}];}const store=createCampaignStore({playerId:'p',setupComplete:true,wallet:{gold:1000},draft:{roster:[]},scouting:{rules:SCOUTING_RULES,tasks:[task],scouts:[]}});
window.requestCount=0;window.c=createScoutingController({windowRoot:document.querySelector('#scouting-window'),selectionRoot:document.querySelector('#scouting-selection'),notifications:document.querySelector('#notices'),getCampaignState:store.getState,campaignStore:store,getCampaignRequest:()=>async(url,options)=>{if(options){window.requestCount++;return new Promise((resolve,reject)=>window.pending={resolve,reject});}return {kind:'legacy',task,rules:SCOUTING_RULES,levelRules:scoutingLevel(1)};}});window.store=store;window.task=task;await c.open({taskId:'task'},{showResults:true});window.ready=true;
</script></body></html>`;
const staticHandler=createStaticHandler(process.cwd());const server=http.createServer(async(req,res)=>{if(req.url.startsWith('/fixture')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);}else await staticHandler(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;

try{
 browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
 for(const [width,height]of [[390,844],[780,360],[768,1024],[1440,900]])for(const queue of [false,true]){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<1025,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/fixture'+(queue?'?queue':''));await page.waitForFunction(()=>window.ready);await page.waitForTimeout(1400);
  if(queue){await page.locator('[data-scout-select]').last().tap();await page.waitForTimeout(1400);}
  await page.locator('[data-scout-select]').last().scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>{window.oldGrid=document.querySelector('.inventory-choice-grid');window.oldCard=document.querySelectorAll('[data-scout-select]')[2];return {scroll:oldGrid.scrollTop,y:oldCard.getBoundingClientRect().y};});
  await page.locator('[data-scout-select]').last().tap();
  const after=await page.evaluate(()=>{const grid=document.querySelector('.inventory-choice-grid'),card=document.querySelectorAll('[data-scout-select]')[2];return {sameGrid:oldGrid===grid,sameCard:oldCard===card,scroll:grid.scrollTop,y:card.getBoundingClientRect().y,requests:requestCount};});
  assert.equal(after.sameGrid,true);assert.equal(after.sameCard,true);assert.equal(after.scroll,before.scroll);assert.ok(Math.abs(after.y-before.y)<=5);
  if(queue)await page.locator('[data-scout-claim-queue]').tap();
  assert.equal(await page.evaluate(()=>requestCount),1);
  await page.evaluate(()=>store.setState({...store.getState(),draft:{roster:[{cardDefinitionId:task.cards[2].playerId,upgradeLevel:4}]}}));
  assert.equal(await page.evaluate(()=>oldGrid===document.querySelector('.inventory-choice-grid')),true);
  await page.evaluate(()=>pending.reject(new Error('simulated retry')));await page.waitForFunction(()=>[...document.querySelectorAll('[data-scout-select]')].every(e=>!e.disabled));
  assert.equal(await page.evaluate(()=>oldGrid===document.querySelector('.inventory-choice-grid')),true);
  assert.equal(await page.locator('.inventory-choice-grid').evaluate(e=>e.scrollTop),before.scroll);
  await page.screenshot({path:path.join(out,`verified-${width}-${queue?'queue':'single'}.png`)});
  await page.locator(queue?'[data-scout-claim-queue]':'[data-scout-select]').last().tap();
  assert.equal(await page.evaluate(()=>requestCount),2);
  await page.evaluate(()=>pending.resolve({player:task.cards[2],players:task.cards,statePatch:{scouting:{...store.getState().scouting,tasks:[]}}}));
  await page.waitForFunction(()=>document.querySelector('#scouting-selection').hidden);
  assert.deepEqual(errors,[]);results.push({width,height,queue,before,after,retryAndClose:true});await page.close();
 }
 fs.writeFileSync(path.join(out,'verified.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({scenarios:results.length,passed:true,results}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
