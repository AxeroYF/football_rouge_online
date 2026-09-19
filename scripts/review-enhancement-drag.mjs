import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'),{chromium}=require('playwright');
const before=process.argv.includes('--before'),out='outputs/enhancement-drag-20260918';fs.mkdirSync(out,{recursive:true});
const index=fs.readFileSync('index.html','utf8'),styles=[...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('\n'),map=index.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const html=`<!doctype html><html><head>${styles}${map}</head><body><section id="enhancement-window" class="enhancement-window wide-window" data-wide-window="enhancement" hidden></section><script type="module">
import {createEnhancementController} from './client/enhancement/enhancement-controller.js';
import {createCampaignStore} from './client/core/campaign-store.js';
import {S4_ENHANCEMENT} from './shared/config/enhancement.mjs';
const cards=Array.from({length:40},(_,i)=>({playerId:'card-'+i,cardDefinitionId:'henry',name:'亨利',overall:90,baseOverall:90,grade:'S',role:'ST',pool:'ATT',upgradeLevel:0,traits:[],labels:[]}));
const store=createCampaignStore({playerId:'p',setupComplete:true,wallet:{gold:10000},draft:{roster:cards}}),toasts=[];
let view={...S4_ENHANCEMENT,cards,history:[],traitOffers:[]},reads=0;
const request=async(url,options)=>{if(!options){reads++;return structuredClone(view);}throw Error('No mutation expected');};
const root=document.querySelector('#enhancement-window');
const controller=createEnhancementController({root,getCampaignState:store.getState,getCampaignRequest:()=>request,campaignStore:store,showToast:m=>toasts.push(m),delay:async()=>{}});
window.review={controller,toasts,store,reads:()=>reads,poll:()=>store.setState({...store.getState(),wallet:{gold:store.getState().wallet.gold+1}})};
controller.open();</script></body></html>`;
const serve=createStaticHandler(process.cwd()),server=http.createServer((q,r)=>{if(q.url==='/review'){r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(html);}else serve(q,r);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const report={before,checks:[],errors:[]};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/review');await page.locator('[data-enhancement-card="card-0"]').waitFor();
 const main=page.locator('[data-enhancement-drop="main"]'),material=page.locator('[data-enhancement-drop="material"]');
 await page.locator('[data-enhancement-card="card-0"]').dragTo(main);
 assert.equal(await main.locator('[data-enhancement-card-id="card-0"]').count(),1);report.checks.push('native warehouse -> main');
 await page.locator('[data-enhancement-card-id="card-0"]').dragTo(material);
 const moved=await material.locator('[data-enhancement-card-id="card-0"]').count()===1;
 report.mainToMaterial=moved;report.toasts=await page.evaluate(()=>review.toasts);
 if(!before){assert.ok(moved);report.checks.push('native main -> material');await page.locator('[data-enhancement-card-id="card-0"]').dragTo(page.locator('[data-enhancement-warehouse]'));}
 else await page.locator('[data-enhancement-card-id="card-0"]').click();
 const source=page.locator('[data-enhancement-card="card-1"]');await source.scrollIntoViewIfNeeded();const box=await source.boundingBox(),dest=await main.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-30,box.y+box.height/2,{steps:8});
 await page.evaluate(()=>{window.dragNode=document.querySelector('[data-enhancement-card="card-1"]');review.poll();});
 await page.waitForTimeout(150);report.sourceSurvivesPoll=await page.evaluate(()=>dragNode.isConnected);
 await page.mouse.move(dest.x+dest.width/2,dest.y+dest.height/2,{steps:10});await page.mouse.up();await page.waitForTimeout(100);
 report.pollDragLanded=await main.locator('[data-enhancement-card-id="card-1"]').count()===1;
 if(!before){assert.ok(report.sourceSurvivesPoll);assert.ok(report.pollDragLanded);report.checks.push('poll during native drag preserves source and drop');}
 if(!before){
  const last=page.locator('[data-enhancement-card="card-35"]');await last.scrollIntoViewIfNeeded();
  const scroll=await page.locator('.enhancement-card-grid').evaluate(e=>e.scrollTop);assert.ok(scroll>0);
  await last.dragTo(main);assert.equal(await main.locator('[data-enhancement-card-id="card-35"]').count(),1);
  assert.ok(Math.abs(await page.locator('.enhancement-card-grid').evaluate(e=>e.scrollTop)-scroll)<5);report.checks.push('scrolled warehouse keeps identity and scroll after drop');
  const second=page.locator('[data-enhancement-card="card-2"]');await second.dragTo(material);
  await main.locator('[data-enhancement-card-id="card-35"]').dragTo(material);
  assert.equal(await main.locator('[data-enhancement-card-id="card-2"]').count(),1);assert.equal(await material.locator('[data-enhancement-card-id="card-35"]').count(),1);report.checks.push('occupied slots swap without duplicate cards');
  const cancel=page.locator('[data-enhancement-card="card-3"]');await cancel.scrollIntoViewIfNeeded();const c=await cancel.boundingBox();
  await page.mouse.move(c.x+c.width/2,c.y+c.height/2);await page.mouse.down();await page.mouse.move(c.x+c.width/2-40,c.y+c.height/2,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.locator('.is-dragging,.is-dragover').count(),0);assert.equal(await page.locator('[data-enhancement-card="card-3"]').count(),1);report.checks.push('cancel drag clears state and retains card');
 }
 await page.screenshot({path:out+(before?'/before.png':'/after.png')});assert.equal(report.errors.length,0);
 if(before){assert.equal(report.mainToMaterial,false);assert.equal(report.sourceSurvivesPoll,false);}report.passed=true;
}finally{fs.writeFileSync(out+(before?'/before.json':'/after.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
