import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/optimization-r30/enhancement-sort-browser';fs.mkdirSync(out,{recursive:true});
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
 const context=await browser.newContext({viewport:{width:1280,height:720}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/versus/?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 await page.locator('#topbar-enhancement').click();await page.locator('[data-enhancement-card]').first().waitFor();
 const order=()=>page.locator('.enhancement-warehouse [data-enhancement-card]').evaluateAll(nodes=>nodes.map(n=>n.dataset.enhancementCard));
 const selected=first.id+'-sort-7';
 for(const mode of ['upgrade','overall','name']){
  await page.locator('[data-backpack-sort]').selectOption(mode);const before=await order();
  await page.locator('[data-enhancement-card="'+selected+'"]').click();
  check(mode+' selection preserves all remaining positions',JSON.stringify(await order())===JSON.stringify(before.filter(id=>id!==selected)));
  await page.locator('[data-enhancement-slot-card="main"]').click();
  check(mode+' returning main restores the original order',JSON.stringify(await order())===JSON.stringify(before));
 }
 await page.screenshot({path:out+'/stable-order.png'});check('no browser errors',errors.length===0);
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
