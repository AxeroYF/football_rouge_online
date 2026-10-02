import os from 'node:os';
import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM ?? (os.homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'))('playwright');
const serve=createStaticHandler(process.cwd()),server=http.createServer((req,res)=>{if(req.url==='/test'){res.setHeader('content-type','text/html');res.end('<html><body><section id="root" hidden></section><section id="list"></section><section id="notices"></section></body></html>');}else serve(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{await page.goto('http://127.0.0.1:'+server.address().port+'/test');await page.evaluate(async()=>{
 const {createInteractionController}=await import('/client/social/interaction-controller.js'),{createCampaignStore}=await import('/client/core/campaign-store.js');
 const store=createCampaignStore({playerId:'a',setupComplete:true,interactions:{players:[],requests:[],events:[],news:[]}});window.calls=[];window.pendingReads=[];
 window.controller=createInteractionController({root:document.querySelector('#root'),listRoot:document.querySelector('#list'),notices:document.querySelector('#notices'),getState:store.getState,campaignStore:store,getRequest:()=>async url=>{calls.push(url);return new Promise((resolve,reject)=>pendingReads.push({url,resolve,reject}));}});
 window.view=id=>({selfId:'a',player:{id,teamName:id,nickname:id},gold:1000,oil:0,rules:{},relationship:'neutral',requests:[],events:[],matches:[],cardCount:0,myCards:null,theirCards:null,squad:{players:[]}});
 controller.open('b');controller.open('c');
 });
 await page.waitForFunction(()=>pendingReads.length===2);await page.evaluate(()=>pendingReads[1].resolve({view:view('c')}));await page.locator('#interaction-club-name').waitFor();assert.equal(await page.locator('#interaction-club-name').innerText(),'c');
 await page.evaluate(()=>pendingReads[0].resolve({view:view('b')}));await page.waitForTimeout(100);assert.equal(await page.locator('#interaction-club-name').innerText(),'c');
 assert.equal(await page.evaluate(()=>calls.filter(u=>u.includes('/cards')).length),0);
 await page.locator('[data-interaction-action="trade-form"]').click();await page.waitForFunction(()=>pendingReads.length===3);
 await page.evaluate(()=>controller.open('b'));await page.waitForFunction(()=>pendingReads.length===4);await page.evaluate(()=>pendingReads[3].resolve({view:view('b')}));
 await page.evaluate(()=>pendingReads[2].resolve({myCards:[],theirCards:[{name:'STALE-CARD',playerId:'stale'}]}));await page.waitForTimeout(100);assert.equal(await page.locator('#interaction-club-name').innerText(),'b');assert.ok(!(await page.locator('#root').innerText()).includes('STALE-CARD'));
 await page.locator('[data-interaction-action="trade-form"]').click();await page.waitForFunction(()=>pendingReads.length===5);await page.evaluate(()=>pendingReads[4].reject(Error('test network failure')));await page.locator('.interaction-error').waitFor();
 await page.locator('[data-interaction-action="cards-load"]').first().click();await page.waitForFunction(()=>pendingReads.length===6);await page.evaluate(()=>pendingReads[5].resolve({myCards:[],theirCards:[]}));await page.locator('[data-warehouse="trade-give"]').waitFor();assert.equal(await page.locator('.interaction-error').count(),0);
 await page.evaluate(()=>controller.close());assert.equal(await page.locator('#root').isVisible(),false);assert.deepEqual(errors,[]);console.log(JSON.stringify({rapidSwitch:true,staleCardsIgnored:true,lazyCards:true,failedLoadRetry:true,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
