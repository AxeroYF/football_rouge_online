import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/airport-r21-review';fs.mkdirSync(out,{recursive:true});
const f=coalitionFixture(),api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd());
const index=JSON.parse(fs.readFileSync('assets/data/territory-index.json','utf8'));
for(const [id,t]of [['a',index.territories.find(t=>t.nameEn==='Rio Grande do Norte')],['b',index.territories.find(t=>t.countryCode==='TUR'&&t.name.includes('安塔利亚'))]]){
 Object.assign(f.s.territoryIndex.territories.find(x=>x.territoryId===id),{centroid:[...t.centroid],region:t.region});
 f.s.world.territories[id].buildings.push({id:'airport-'+id,type:'airport',status:'active',level:1});
}
f.a.gold=100000;f.s.coalitions.mutate(f.a,{action:'create',requestId:'create-browser-airport'});f.s.save();
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))await api(req,res,u.pathname,u.href);else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];let page;
const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name);};
const inView=async selector=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/versus/?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 await page.locator('#topbar-coalition').click();await page.locator('[data-tab="actions"]').click();await page.locator('[data-coalition-action="airport"]').click();
 await page.locator('.airport-window [data-action="quote"]').click();await page.locator('.airport-ticket').waitFor();
 const text=await page.locator('.airport-ticket').innerText();check('coalition preselected', (await page.locator('[data-unit]').inputValue()).startsWith('coalition:'));
 check('correct game-map distance displayed',text.includes('1091 公里'));check('correct ticket price displayed',text.includes('800 金币'));
 await page.screenshot({path:out+'/quote.png'});const gold=[f.a.gold,f.b.gold];await page.locator('.airport-window [data-action="depart"]').click();await page.waitForFunction(()=>document.querySelector('.airport-window').hidden);
 const army=f.s.coalitions.find(f.a);check('flight stores corrected distance',army.movement.distanceKm===1091);check('both allies pay 400',f.a.gold===gold[0]-400&&f.b.gold===gold[1]-400);
 f.tick(60000);f.s.save();check('arrives in one minute',army.territoryId==='b'&&!army.movement);check('no browser errors',!errors.length);
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
