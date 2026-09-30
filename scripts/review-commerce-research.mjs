import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||'C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const f=coalitionFixture(),type='legendary-player-pack';f.a.gold=1000000;f.s.playerPacks.addPacks(f.a,type,6);f.s.save();
const serve=createStaticHandler(process.cwd()),api=createCampaignApiHandler({campaign:f.s});
const links=fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html=`<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div class="map-stage" style="position:fixed;inset:0"><button id="shop-trigger">商店</button><button id="pack-trigger">背包 <b data-inventory-count></b></button><section id="shop-window" class="standard-window" hidden></section><section id="inventory-window" class="inventory-window" hidden></section><section id="review-notices" style="position:absolute;top:60px;right:12px;width:300px"></section></div></body></html>`;
const calls=[],errors=[],checks=[];
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/review-commerce.html'){res.writeHead(200,{'content-type':'text/html'});res.end(html);}else if(u.pathname.startsWith('/api/')){calls.push({path:u.pathname,method:req.method});await api(req,res,u.pathname,u.href);}else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});
const out='outputs/commerce-research-review';fs.mkdirSync(out,{recursive:true});
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
let page;
try{
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/review-commerce.html`);
 await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js');const {createShopController}=await import('/client/shop/shop-controller.js');const {createInventoryController}=await import('/client/inventory/inventory-controller.js');const {createConstructionNotifications}=await import('/client/buildings/construction-notifications.js');
  window.request=async(path,options={})=>{const r=await fetch(path,{method:options.method||'GET',headers:{authorization:'Bearer a','content-type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};
  window.store=createCampaignStore((await request('/api/campaign/state')).state);window.toasts=[];
  const common={campaignStore:store,showToast:t=>toasts.push(t)};
  window.shop=createShopController({...common,root:document.querySelector('#shop-window'),trigger:document.querySelector('#shop-trigger'),getState:store.getState,getRequest:()=>request});
  window.inventory=createInventoryController({...common,windowRoot:document.querySelector('#inventory-window'),trigger:document.querySelector('#pack-trigger'),getCampaignState:store.getState,getCampaignRequest:()=>request});
  window.notices=createConstructionNotifications({...common,notifications:document.querySelector('#review-notices'),onResearchNotice:async(noticeId,action)=>{const value=await request('/api/campaign/research/'+action,{method:'POST',body:{noticeId,revision:store.getState().formationResearch.revision,compact:true}});store.setState({...store.getState(),...value.statePatch});}});
  shop.open();
 });
 await page.waitForSelector('[data-shop-offer]');
 await page.evaluate(()=>{window.shopNodes=[...document.querySelectorAll('.shop-card-art img,.shop-pack>img')];window.shopContent=document.querySelector('.shop-content');window.oldDraft=store.getState().draft;window.oldWorld=store.getState().world;});
 check('shop uses static player cards',await page.locator('#shop-window canvas[data-card-motion]').count()===0);
 const beforeShopCalls=calls.filter(c=>c.path==='/api/campaign/shop').length;
 await page.locator('[data-shop-buy="pack"]').first().click();await page.waitForFunction(()=>toasts.length===1);await page.waitForTimeout(100);
 check('purchase preserves all shop image nodes and scroll container',await page.evaluate(()=>shopNodes.every(n=>n.isConnected)&&shopContent===document.querySelector('.shop-content')));
 check('pack purchase preserves roster and world objects',await page.evaluate(()=>oldDraft===store.getState().draft&&oldWorld===store.getState().world));
 check('success does not immediately refetch shop',calls.filter(c=>c.path==='/api/campaign/shop').length===beforeShopCalls);
 const shopBuyBefore=calls.filter(c=>c.path==='/api/campaign/shop/buy').length;
 await page.evaluate(()=>{const b=document.querySelector('[data-shop-buy="player"]');b.click();b.click();});await page.waitForFunction(()=>toasts.length===2);
 check('rapid player purchase submits once',calls.filter(c=>c.path==='/api/campaign/shop/buy').length===shopBuyBefore+1);
 check('sold card keeps original artwork nodes',await page.evaluate(()=>shopNodes.every(n=>n.isConnected)));
 await page.screenshot({path:out+'/shop-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/shop-phone.png'});
 check('mobile shop stays within viewport',await page.locator('.shop-surface').evaluate(n=>n.getBoundingClientRect().right<=innerWidth));
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>{shop.close();inventory.open();});
 await page.locator(`[data-select-pack="${type}"]`).click();await page.locator(`[data-open-pack="${type}"]`).click();await page.waitForSelector('[data-player-card-action="pack-choice"]');await page.waitForTimeout(1300);
 await page.evaluate(()=>{window.choiceNodes=[...document.querySelectorAll('.inventory-choice-card')];window.choiceImages=[...document.querySelectorAll('.inventory-choice-card img')];});
 const chooseBefore=calls.filter(c=>c.path.endsWith('/packs/choose')).length;
 await page.evaluate(()=>{const b=document.querySelector('[data-player-card-action="pack-choice"]');b.click();b.click();});
 await page.waitForSelector('[data-inventory-next-pack]');
 check('pack claim is single request',calls.filter(c=>c.path.endsWith('/packs/choose')).length===chooseBefore+1);
 check('claim keeps original cards and images with no acquired screen',await page.evaluate(()=>choiceNodes.every(n=>n.isConnected)&&choiceImages.every(n=>n.isConnected)&&!document.querySelector('.inventory-acquired-card')));
 check('selected card stops entry animation',await page.locator('.is-pack-selected').evaluate(n=>getComputedStyle(n).animationName==='none'));
 await page.screenshot({path:out+'/pack-desktop.png'});
 let failed=false;await page.route('**/api/campaign/inventory/packs/open',async route=>{if(!failed){failed=true;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟暂时失败'})});}else await route.continue();});
 await page.locator('[data-inventory-next-pack]').click();await page.waitForFunction(()=>toasts.includes('模拟暂时失败'));
 check('failed next pack preserves original selected card',await page.evaluate(()=>choiceNodes.every(n=>n.isConnected)));
 await page.locator('[data-inventory-next-pack]').click();await page.waitForFunction(()=>!document.querySelector('.is-pack-selected'));
 for(const [width,height] of [[390,844],[844,390],[1024,768]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(1100);
  await page.evaluate(()=>document.querySelectorAll('[data-player-card-action="pack-choice"]')[2].click());await page.waitForSelector('[data-inventory-next-pack]');
  const geometry=await page.locator('[data-inventory-next-pack]').boundingBox();check(`next-pack action fits ${width}x${height}`,geometry&&geometry.x>=0&&geometry.y>=0&&geometry.x+geometry.width<=width&&geometry.y+geometry.height<=height);
  await page.screenshot({path:`${out}/pack-${width}x${height}.png`});
  if(width!==1024){await page.locator('[data-inventory-next-pack]').click();await page.waitForFunction(()=>!document.querySelector('.is-pack-selected'));}
 }
 await page.evaluate(()=>inventory.close());
 const modifiers=f.s.wonders.modifiers.bind(f.s.wonders);f.s.wonders.modifiers=account=>({...modifiers(account),packChoices:4});
 await page.evaluate(async()=>{store.setState((await request('/api/campaign/state')).state);inventory.open();});
 await page.locator(`[data-select-pack="${type}"]`).click();await page.locator(`[data-open-pack="${type}"]`).click();await page.waitForSelector('[data-choice-count="4"]');
 for(const [width,height] of [[390,844],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(1100);
  const grid=await page.locator('.inventory-choice-grid').boundingBox();check(`four choices fit ${width}x${height}`,grid&&grid.x>=0&&grid.x+grid.width<=width);
 }
 await page.evaluate(()=>document.querySelectorAll('[data-player-card-action="pack-choice"]')[3].click());await page.waitForSelector('[data-inventory-next-pack]');
 check('four-choice landscape result actions fit',await page.locator('[data-inventory-next-pack]').evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight));
 await page.screenshot({path:out+'/pack-four-landscape.png'});await page.evaluate(()=>inventory.close());
 f.s.formationResearch.mutate(f.a,'start-topic',{topicId:'biology:match-endurance',revision:f.s.formationResearch.data(f.a).revision});
 f.s.formationResearch.completeJob(f.a.formationResearch,f.a.formationResearch.active,f.now);f.s.save();
 await page.evaluate(async()=>store.setState((await request('/api/campaign/state')).state));
 await page.waitForSelector('[data-research-complete]');
 check('completed biology notice remains at 100 percent',await page.locator('[data-research-complete] [role="progressbar"]').getAttribute('aria-valuenow')==='100');
 await page.locator('[data-continue-research]').click();await page.waitForSelector('[data-cancel-research]');
 check('notification continues same topic at level two',f.a.formationResearch.active.topicId==='biology:match-endurance'&&f.a.formationResearch.active.level===2);
 f.s.formationResearch.completeJob(f.a.formationResearch,f.a.formationResearch.active,f.now);f.s.save();
 await page.evaluate(async()=>store.setState((await request('/api/campaign/state')).state));await page.waitForSelector('[data-read-research]');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/research-complete-phone.png'});
 await page.locator('[data-read-research]').click();await page.waitForFunction(()=>!document.querySelector('[data-research-complete]'));
 check('acknowledgement clears only notice and retains level',f.a.formationResearch.topicLevels['biology:match-endurance']===2&&f.a.formationResearch.completionNotices.length===0);
 check('no browser exceptions',errors.length===0);
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,checks,errors,calls},null,2));console.log(JSON.stringify({passed:true,checks,errors}));
} catch(e){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:e.stack,checks,errors,calls},null,2));throw e;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
