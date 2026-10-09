import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/battle-report-r25-review';fs.mkdirSync(out,{recursive:true});
const f=coalitionFixture(),api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd());
f.a.battleHistory=[{id:'coalition-report',challengeId:'coalition-report',coalitionId:'army',coalitionContributors:['a','b'],attackerId:'a',territoryId:'c',captured:false,score:[1,2],settledAt:f.now},{id:'defence-report',defenderId:'a',territoryId:'a',score:[0,0],settledAt:f.now}];f.s.save();
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))await api(req,res,u.pathname,u.href);else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];let page;
const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name);};
const inView=async selector=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
try{
 const context=await browser.newContext({viewport:{width:844,height:390}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/versus/?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 await page.locator('[data-dismiss-battle-report="coalition-report"]').waitFor({state:'attached'});const expand=page.locator('[data-notification-toggle][aria-expanded="false"]');if(await expand.count())await expand.click();
 await page.locator('[data-dismiss-battle-report="coalition-report"]').scrollIntoViewIfNeeded();check('phone dismiss button visible',await inView('[data-dismiss-battle-report="coalition-report"]'));await page.screenshot({path:out+'/before.png'});
 await page.locator('[data-dismiss-battle-report="coalition-report"]').click();await page.waitForFunction(()=>!document.querySelector('[data-dismiss-battle-report="coalition-report"]'));check('acknowledgement persisted',f.a.battleReportReadIds.includes('coalition-report'));check('report kept',f.a.battleHistory.some(b=>b.id==='coalition-report'));await page.reload();await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));check('dismissed report stays hidden after reload',await page.locator('[data-dismiss-battle-report="coalition-report"]').count()===0);check('other reports remain',await page.locator('[data-dismiss-battle-report="defence-report"]').count()===1);
 const expand2=page.locator('[data-notification-toggle][aria-expanded="false"]');if(await expand2.count())await expand2.click();await page.locator('[data-dismiss-battle-report="defence-report"]').click();await page.waitForFunction(()=>!document.querySelector('[data-dismiss-battle-report]'));check('defence report also dismissible',f.a.battleReportReadIds.includes('defence-report'));check('no browser errors',!errors.length);await page.screenshot({path:out+'/after.png'});
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
