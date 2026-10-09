import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {CampaignService} from '../campaign-service.mjs';
import {createMaritimeRoutePlanner} from '../maritime-routes.mjs';
import {createCampaignApiHandler,sendJson} from '../server/http/campaign-api-handler.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';

const {chromium,webkit}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM || 'C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),coasts=read('assets/data/campaign-coastlines.json'),catalog=read('assets/data/s4-player-catalog.json');
const planner=createMaritimeRoutePlanner({coastlineData:coasts,territoryGeoJson:geo,territoryIndex:index});
let clock=Date.now();
// An in-memory isolated world: this review never reads or writes a player save.
const s=new CampaignService({repository:{load:()=>null,save(){}},now:()=>clock,catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:read('assets/data/territory-resources.json'),maritimePlanner:planner});
const home=index.territories.find(t=>t.countryCode==='GBR'&&coasts.territories[t.territoryId]?.coastlines?.length&&t.landNeighbors.length);
assert.ok(home);const homeId=home.territoryId,secondId=home.landNeighbors[0];
const roster=['GK','DEF','MID','ATT'].flatMap(pool=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,8)).map(p=>structuredClone(p));
const actor={id:'review-player',token:'review-token',nickname:'航海训练经理',setupComplete:true,homeTerritoryId:homeId,gold:10000000,draft:{version:DRAFT_VERSION,teamName:'航海训练队',roster,offer:[]}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:[homeId,secondId],capitalTerritoryId:homeId};
for(const id of [homeId,secondId])Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,buildings:[],protectedUntil:0});
const center=s.buildings.createRecord('training-center'),second=s.buildings.createRecord('training-center');center.level=2;
s.world.territories[homeId].buildings.push(center);s.world.territories[secondId].buildings.push(second);
s.state(actor);s.save();
let sourcePoint,plan;
for(const point of coasts.territories[homeId].coastlines.flat().filter((_,i)=>i%5===0)) {
 const result=planner.routesFrom(s.world,actor.id,homeId,point,clock);
 if(result.routes.length){sourcePoint=point;plan=result;break;}
}
assert.ok(plan?.routes.length,'fixture has reachable sea targets');
const out='outputs/training-shop-maritime-review';fs.mkdirSync(out,{recursive:true});
const api=createCampaignApiHandler({campaign:s}),serve=createStaticHandler(process.cwd()),checks=[],errors=[],metrics=[];
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))await api(req,res,url.pathname,url.href);else await serve(req,res);}catch(e){sendJson(res,e.statusCode||500,{error:e.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
const seedTraining=()=>{
 actor.training={tasks:{}};for(const p of actor.draft.roster)delete p.training;
 for(const pool of ['ATT','MID'])s.training.start(actor,s.world,{territoryId:homeId,buildingId:center.id,pool,slot:0,playerId:actor.draft.roster.find(p=>p.pool===pool).id,requestId:'review-'+pool+'-'+clock});
 clock+=600001;s.training.settle(actor);
 s.training.start(actor,s.world,{territoryId:homeId,buildingId:center.id,pool:'DEF',slot:0,playerId:actor.draft.roster.find(p=>p.pool==='DEF').id,requestId:'review-DEF-'+clock});s.save();
};
try {
 for(const engine of ['chromium','webkit']) {
  seedTraining();const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
  try {
   const context=await browser.newContext({viewport:{width:1440,height:900}});
   await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','review-token'));
   // Observe the real built startup module; all requests and rendering remain real.
   await context.route('**/game-startup.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__review={map,sea:maritimeController,select:selectTerritory,point:sourcePointToDisplay,state:()=>campaignState,frames:()=>mapFrameRefresh};'});});
   const page=await context.newPage(),requests=[];page.on('pageerror',e=>errors.push({engine,message:e.message}));page.on('request',r=>{if(r.url().includes('/api/campaign/'))requests.push({url:r.url(),method:r.method()});});
   await page.goto(base+'/game?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
   await page.locator('#topbar-training').click();await page.locator('.training-summary').waitFor();
   check(engine+' top menu opens training',await page.locator('#training-window').isVisible());
   check(engine+' multiple centers selectable',await page.locator('[data-training-center] option').count()===2);
   if(await page.locator('[data-training-center]').inputValue()!==center.id)await page.locator('[data-training-center]').selectOption(center.id);
   await page.waitForFunction(()=>document.querySelector('[data-training-finish-completed]')?.textContent.includes('（2）'));
   await page.screenshot({path:out+'/'+engine+'-training-before.png'});
   const before=requests.length;await page.locator('[data-training-finish-completed]').click();
   await page.waitForFunction(()=>document.querySelector('[data-training-finish-completed]')?.disabled && !document.querySelector('[data-training-finish-completed]')?.textContent.includes('（'));
   check(engine+' completed seats cleared',await page.locator('.training-seat.is-completed').count()===0);
   check(engine+' working player retained',await page.locator('.training-seat.is-occupied').count()===1);
   check(engine+' batch uses one POST and no detail reload',requests.slice(before).filter(r=>r.url.includes('/training/')).length===1);
   await page.locator('[data-training-center]').selectOption(second.id);await page.waitForFunction(()=>document.querySelectorAll('.training-seat').length===4);
   check(engine+' switches centers',await page.locator('.training-seat').count()===4);
   await page.locator('#training-window [data-training-close]').click();
   // Buy through the real HTTP UI and inspect the server's public offer.
   await page.locator('#topbar-shop').click();await page.locator('.shop-legend').first().waitFor();
   const buy=page.locator('[data-shop-buy="player"]:not([disabled])').first();await buy.click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.shop-buyer')].some(n=>n.textContent.includes('航海训练经理')));
   check(engine+' sold card names buyer',await page.locator('.shop-buyer').first().textContent()==='购买玩家：航海训练经理');
   await page.screenshot({path:out+'/'+engine+'-shop.png'});await page.locator('#shop-window [data-stage-window-close]').click();
   await page.evaluate(({homeId,point})=>{const a=window.__review;a.select(homeId);a.map.setView(a.point(homeId,point),7,{animate:false});},{homeId,point:sourcePoint});
   const viewBefore=await page.evaluate(()=>({zoom:window.__review.map.getZoom(),center:window.__review.map.getCenter()}));
   await page.locator('#territory-challenge-button').click();
   check(engine+' sea selection opens',await page.evaluate(()=>window.__review.sea.isSelectingPoint()));
   const beforeSea=requests.length,start=performance.now();
   const responsePromise=page.waitForResponse(r=>r.url().includes('/maritime/routes'));
   await page.evaluate(({homeId,point})=>{const a=window.__review,display=a.point(homeId,point);return a.sea.confirmMaritimePoint({lat:display[0],lng:display[1]});},{homeId,point:sourcePoint});
   const response=await responsePromise,value=await response.json();
   await page.waitForFunction(()=>window.__review.sea.getMode()?.routes?.length>0);
   // Allow any queued map refresh / fit animation to run before checking the view.
   await page.waitForTimeout(800);
   const viewAfter=await page.evaluate(()=>({zoom:window.__review.map.getZoom(),center:window.__review.map.getCenter()}));
   check(engine+' survey retains zoom and center',JSON.stringify(viewBefore)===JSON.stringify(viewAfter));
   check(engine+' survey sends map patch',Boolean(value.statePatch)&&!value.state&&!value.statePatch.draft);
   const stateFetches=requests.slice(beforeSea).filter(r=>/\/api\/campaign\/state(?:\?|$)/.test(r.url));
   check(engine+' no global state fetch during survey '+JSON.stringify(stateFetches),stateFetches.length===0);
   check(engine+' one survey request',requests.slice(beforeSea).filter(r=>r.url.includes('/maritime/routes')).length===1);
   metrics.push({engine,routeCount:value.routes.length,responseBytes:Buffer.byteLength(JSON.stringify(value)),elapsedMs:Math.round(performance.now()-start-800),zoom:viewAfter.zoom});
   await page.screenshot({path:out+'/'+engine+'-sea-routes.png'});
   const cancelBefore=requests.length;await page.locator('#territory-maritime-cancel-button').click();
   await page.waitForFunction(()=>!window.__review.sea.getMode());
   check(engine+' cancel retains zoom',await page.evaluate(()=>window.__review.map.getZoom())===viewBefore.zoom);
   check(engine+' cancel does not reload full state',!requests.slice(cancelBefore).some(r=>/\/api\/campaign\/state(?:\?|$)/.test(r.url)));
  } finally {await browser.close();}
 }
 check('no browser errors',errors.length===0);
} finally {fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,metrics},null,2));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({passed:true,checks:checks.length,errors,metrics,out}));
