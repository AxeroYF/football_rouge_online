import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/enhancement-full-r51';fs.mkdirSync(out,{recursive:true});
const f=coalitionFixture(),api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd());
const first=f.a.draft.roster[0];
for(const level of [8,9,10])for(const suffix of ['a','b']){const p=structuredClone(first);p.id='high-'+level+'-'+suffix;p.cardDefinitionId=first.id;delete p.playerId;f.s.enhancement.applyLevel(p,level);f.a.draft.roster.push(p);}
f.s.save();
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))await api(req,res,u.pathname,u.href);else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];let page;
const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name);};
const inView=async selector=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/versus/?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 await page.locator('#topbar-enhancement').click();await page.locator('[data-enhancement-card="high-8-a"]').waitFor();
 const main=page.locator('[data-enhancement-drop="main"]'),material=page.locator('[data-enhancement-drop="material"]');
 for(const level of [8,9]){
  await page.locator('[data-enhancement-card="high-'+level+'-a"]').dragTo(main);
  check('full game +'+level+' native main drag',await main.locator('[data-enhancement-card-id="high-'+level+'-a"]').count()===1);
  await page.locator('[data-enhancement-card="high-'+level+'-b"]').click();
  check('full game +'+level+' material click',await material.locator('[data-enhancement-card-id="high-'+level+'-b"]').count()===1);
  check('full game +'+level+' submit enabled',await page.locator('[data-enhancement-submit]').isEnabled());
  await main.locator('[data-enhancement-slot-card]').click();await material.locator('[data-enhancement-slot-card]').click();
 }
 await page.locator('[data-enhancement-card="high-10-a"]').dragTo(main);check('+10 stays capped',await main.locator('[data-enhancement-slot-card]').count()===0);
 await page.screenshot({path:out+'/full-game.png'});check('no browser errors',!errors.length);
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
