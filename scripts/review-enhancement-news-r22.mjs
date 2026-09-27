import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/enhancement-news-r22-review';fs.mkdirSync(out,{recursive:true});
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
 check('old world news absent',await page.locator('[data-world-news="news:old"]').count()===0);
 await page.locator('[data-world-news="news:recent"]').waitFor();const expand=page.locator('[data-notification-toggle][aria-expanded="false"]');if(await expand.count())await expand.click();
 await page.locator('[data-world-news="news:recent"] button').click();await page.waitForFunction(()=>!document.querySelector('[data-world-news="news:recent"]'));check('read persisted',f.a.worldNewsReadIds.includes('news:recent'));
 await page.reload();await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));check('news stays dismissed after reload',await page.locator('[data-world-news]').count()===0);
 await page.locator('#topbar-enhancement').click();await page.locator('[data-enhancement-card]').first().waitFor();
 for(const mode of ['upgrade','overall','name']){
  await page.locator('[data-backpack-sort]').selectOption(mode);const ids=await page.locator('.enhancement-card-grid [data-enhancement-card]').evaluateAll(es=>es.map(e=>e.dataset.enhancementCard));
  const familyIds=ids.filter(id=>id.startsWith(first.id));const start=ids.indexOf(familyIds[0]);check(mode+' same-name contiguous',ids.slice(start,start+familyIds.length).join()===familyIds.join());
  check(mode+' upgrades descending',familyIds[0].endsWith('-7')&&familyIds[1].endsWith('-2'));check(mode+' all card instances retained',familyIds.length===4);
 }
 await page.screenshot({path:out+'/warehouse.png'});check('no browser errors',!errors.length);
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
