import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {purchaseFixture} from '../test/card-purchase-fixture.mjs';
import {createCampaignApiHandler,sendJson} from '../server/http/campaign-api-handler.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'))('playwright');
const f=purchaseFixture(),api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd()),out='outputs/card-purchase-review';fs.mkdirSync(out,{recursive:true});
const links=[...fs.readFileSync('index.html','utf8').matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('');
const calls=[],server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/review'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1">'+links+'</head><body style="background:#14241c"><section id="root" class="card-management-window standard-window" hidden></section></body></html>');}else if(url.pathname.startsWith('/api/')){calls.push(req.method+' '+req.url);await api(req,res,url.pathname,req.url);}else await serve(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
async function open(actor){await page.goto('http://127.0.0.1:'+server.address().port+'/review');await page.evaluate(async ({actor,now})=>{
  const {setRequestClock}=await import('/client/core/request-id.js');setRequestClock(now);
  const {createCardManagementController}=await import('/client/cards/card-management-controller.js'),{createCampaignStore}=await import('/client/core/campaign-store.js');
  window.request=async(url,options={})=>{const r=await fetch(url,{method:options.method??'GET',headers:{authorization:'Bearer '+actor,'content-type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
  window.store=createCampaignStore({playerId:actor,setupComplete:true,wallet:{gold:100000}});window.controller=createCardManagementController({root:document.querySelector('#root'),getCampaignState:store.getState,campaignStore:store,getCampaignRequest:()=>request});controller.open();
},{actor,now:f.now});await page.locator('[data-cm-screen="purchase"]').click();await page.locator('[data-cpo-action="create"]:enabled').first().waitFor();}
try{
 await open('a');await page.screenshot({path:out+'/desktop-board.png'});
 await page.locator('[data-cpo-action="create"]').first().click();await page.locator('[data-cpo-field="search"]:enabled').waitFor();await page.locator('[data-cpo-field="search"]').fill(f.definition.name);await page.locator('[data-cpo-action="add"]').first().waitFor();await page.locator('[data-cpo-action="add"][data-id="'+f.definition.id+'"]').click();await page.locator('[data-cpo-level="0"]').selectOption('2');
 await page.locator('[data-cpo-field="gold"]').fill('1234');await page.locator('[data-cpo-field="oil"]').fill('50');await page.locator('[data-cpo-land="'+f.land+'"]').check();
 for(const [name,width,height] of [['desktop',1440,1000],['portrait',390,844],['landscape',844,390]]){await page.setViewportSize({width,height});await page.screenshot({path:out+'/'+name+'-compose.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'viewport overflow '+name);}
 await page.setViewportSize({width:390,height:844});await page.locator('[data-cpo-action="publish-review"]').click();await page.locator('[data-cpo-action="publish"]').click();await page.locator('[data-cpo-action="detail"]:enabled').waitFor();await page.screenshot({path:out+'/portrait-published.png'});
 assert.equal(f.s.cardPurchases.list(f.a,{mine:true}).total,1);assert.equal(f.a.gold,100000);
 const id=f.s.cardPurchases.list(f.a,{mine:true}).orders[0].id;
 await open('b');await page.locator('[data-cpo-action="detail"][data-id="'+id+'"]').click();await page.locator('[data-cpo-action="choose"]:enabled').waitFor();await page.locator('[data-cpo-action="choose"][data-id="'+f.card.id+'"]').click();await page.screenshot({path:out+'/portrait-delivery.png'});
 await page.locator('[data-cpo-action="preview"]').click();await page.locator('[data-cpo-action="accept"]:enabled').waitFor();await page.screenshot({path:out+'/portrait-confirm.png'});await page.locator('[data-cpo-action="accept"]').click();await page.locator('[data-cpo-action="create"]:enabled').first().waitFor();
 assert.equal(f.s.cardPurchases.find(id).order.status,'filled');assert.equal(f.s.world.territories[f.land].ownerId,'b');assert.ok(f.a.draft.roster.some(p=>p.id===f.card.id));assert.deepEqual(errors,[]);
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(async()=>{
   controller.close();const {state}=await request('/api/campaign/state');store.setState(state);
   const panel=document.createElement('section');panel.id='campaign-tactics';panel.hidden=true;document.body.append(panel);const map=document.createElement('div');document.body.append(map);
   const {createTacticsController}=await import('/tactics-page.js');window.tactics=createTacticsController({panel,mapElement:map,getCampaignState:store.getState,setCampaignState:store.setState,request,showToast:()=>{}});await tactics.open({squadId:'garrison'});
 });
 assert.equal(await page.locator('.league-lineup-share-actions,.league-ai-training-actions,.league-mirror-upload').count(),0);
 assert.ok(await page.locator('[data-captain]').count());
 for(const [label,width,height] of [['desktop',1440,1000],['tablet',1024,768],['phone',390,844]]){await page.setViewportSize({width,height});await page.locator('.league-tactics-detail>header').screenshot({path:out+'/tactics-'+label+'.png'});}
 assert.deepEqual(errors,[]);
 const report={published:true,mixedPayment:true,delivered:true,resolutions:3,tacticsControlsRemoved:true,errors,requests:calls.length};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(report);
}catch(error){await page.screenshot({path:out+'/failure.png'});console.error(await page.locator('#root').innerText(),errors);throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
