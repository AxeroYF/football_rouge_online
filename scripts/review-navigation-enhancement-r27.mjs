import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/navigation-enhancement-r27-review';fs.mkdirSync(out,{recursive:true});
const f=coalitionFixture(),api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd());
const first=f.a.draft.roster[0],second=f.a.draft.roster[1];
for(const [source,levels]of [[first,[0,2,7]],[second,[0,4]]])for(const level of levels){const p=structuredClone(source);p.id=source.id+'-sort-'+level;f.s.enhancement.applyLevel(p,level);f.a.draft.roster.push(p);}
f.s.world.news=[{id:'news:old',key:'old',type:'alliance',text:'历史结盟消息不应播报',createdAt:f.now-7*86400000},{id:'news:recent',key:'recent',type:'alliance',text:'近期动态测试',createdAt:f.now}];f.s.save();
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))await api(req,res,u.pathname,u.href);else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];let page;
const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name);};
const inView=async selector=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/versus/?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 for(const width of [1024,1280,1366]) {
  await page.setViewportSize({width,height:768});
  const nav=page.locator('.primary-nav');
  await nav.evaluate(e=>{e.scrollLeft=0;window.navClicks=0;e.addEventListener('click',()=>window.navClicks++);});
  const box=await nav.boundingBox();
  const size=await nav.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
  check(width+' navigation has usable width',size.width>80);
  check(width+' navigation overflow enabled',await nav.evaluate(e=>getComputedStyle(e).overflowX==='auto'));
  if(size.scroll>size.width){
   await page.mouse.move(box.x+box.width-15,box.y+box.height/2);await page.mouse.down();
   await page.mouse.move(box.x+15,box.y+box.height/2,{steps:15});await page.mouse.up();
   check(width+' mouse drag scrolls',await nav.evaluate(e=>e.scrollLeft>20));
   check(width+' drag does not activate button',await page.evaluate(()=>window.navClicks===0));
   await page.mouse.wheel(0,3000);
   await page.waitForTimeout(100);
   check(width+' wheel reaches final action',await nav.evaluate(e=>e.scrollLeft+e.clientWidth>=e.scrollWidth-2));
  }
  await page.screenshot({path:out+'/topbar-'+width+'.png'});
 }
 await page.locator('#topbar-enhancement').click();await page.locator('[data-enhancement-card]').first().waitFor();
 check('ordinary navigation click still opens enhancement',await page.locator('[data-enhancement-card]').count()>0);
 const originals=await page.locator('[data-enhancement-card]').evaluateAll(es=>es.map(e=>e.dataset.enhancementCard));
 const main=first.id, material=first.id+'-sort-0';
 await page.locator('[data-enhancement-card="'+main+'"]').click();
 await page.locator('[data-enhancement-card="'+material+'"]').click();
 await page.locator('[data-enhancement-submit]').click();
 await page.locator('[data-enhancement-result-card]').waitFor();
 check('completed result shown',await page.locator('[data-enhancement-result-card]').count()===1);
 const next=first.id+'-sort-2';
 await page.locator('[data-enhancement-card="'+next+'"]').click();
 check('selecting next card clears result',await page.locator('[data-enhancement-result-card]').count()===0);
 check('previous result returned to warehouse',await page.locator('[data-enhancement-card="'+main+'"]').count()===1);
 check('new card occupies main slot',await page.locator('[data-enhancement-slot-card="main"]').getAttribute('data-enhancement-card-id')===next);
 check('consumed material not restored',await page.locator('[data-enhancement-card="'+material+'"]').count()===0);
 await page.setViewportSize({width:960,height:540});
 await page.locator('.enhancement-window-header [data-stage-window-close]').first().click();
 await page.locator('#mobile-menu-toggle').click();
 check('mobile menu keeps grid layout',await page.locator('.primary-nav').evaluate(e=>getComputedStyle(e).display==='grid'));
 await page.screenshot({path:out+'/warehouse.png'});check('no browser errors',!errors.length);
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
