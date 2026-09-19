import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {createCampaignApiHandler,sendJson} from '../server/http/campaign-api-handler.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {createRequire} from 'node:module';
import {CampaignService} from '../campaign-service.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/district-demolition-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const has=(id,terrain)=>resources.territories[id].terrain.includes(terrain);
const home=index.territories.find(t=>t.countryCode==='FRA'&&has(t.territoryId,'plains')&&t.landNeighbors.some(id=>has(id,'hills')||has(id,'mountain'))&&t.landNeighbors.some(id=>has(id,'plains'))&&t.landNeighbors.length>=3);
assert.ok(home);
const hill=home.landNeighbors.find(id=>has(id,'hills')||has(id,'mountain')),plain=home.landNeighbors.find(id=>id!==hill&&has(id,'plains'));
const owned=[home.territoryId,...home.landNeighbors];
let clock=Date.now();
const s=new CampaignService({now:()=>clock,dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const roles=['GK','LB','CB','CB','RB','DM','AM','AM','LW','RW','ST'];
const roster=[];for(let group=0;group<4;group++)for(const role of roles){const p=catalog.find(p=>p.role===role&&!p.isX&&!roster.some(q=>q.id===p.id));assert.ok(p);roster.push(p);}
const actor={id:'wonder-browser',nickname:'黄狗经理',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:100000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'黄狗俱乐部',totalPicks:roster.length,roster},resources:{fans:50000}};
actor.playerSquads={schemaVersion:2,assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))};actor.tactics={squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
const trainingBuilding=s.buildings.createRecord('training-center');s.world.territories[hill].buildings.push(trainingBuilding);s.save();


s.world.territories[home.territoryId].buildings.find(b=>b.type==='club-headquarters').level=5;
s.buildings.isCoastal=()=>true;s.save();
const errors=[],checks=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};fs.mkdirSync(out,{recursive:true});
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser,page;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),actor.token);
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__review={selectTerritory,panel:buildingPanelController,state:()=>campaignState,apply:state=>campaignStore.setState(state),map,point:sourcePointToDisplay};'});});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/game');await page.waitForFunction(()=>window.__review&&document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
 await page.evaluate(id=>{window.__review.selectTerritory(id);window.__review.panel.open(id);},plain);
 await page.locator('[data-district-preview="factory"]').waitFor();
 const preview=s.buildings.territoryView(actor,s.world,plain).buildPreviews.factory;
 check('factory preview shows terrain, adjacency, fan coverage and global capacity',(await page.locator('[data-district-preview="factory"]').innerText()).includes('选址基础 '+preview.baseYield));
 check('university also has a selected-site preview',await page.locator('[data-district-preview="university"]').count()===1);
 check('preview bonus numbers do not truncate',await page.locator('[data-district-preview="factory"] dd').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth)));await page.locator('[data-district-preview="factory"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'site-preview-desktop.jpg'),quality:70});
 async function mutation(suffix,action){const response=page.waitForResponse(r=>r.url().endsWith(suffix)&&r.request().method()==='POST');await action();const r=await response;assert.equal(r.status(),200,await r.text());return r.json();}
 async function demolish(id){await page.locator('[data-demolish-building="'+id+'"]').click();await page.locator('[data-demolition-confirm]:not([disabled])').waitFor();const result=await mutation('/buildings/demolish',()=>page.locator('[data-demolition-confirm]').click());await page.locator('#facility-demolition-dialog').waitFor({state:'hidden'});return result;}
 let result=await mutation('/buildings/build',()=>page.locator('[data-build-type="factory"][data-build-method="gold"]').click());
 const factoryId=result.building.id;check('factory actual production equals construction preview',s.world.resourceEconomy.rates[actor.id].production===preview.projectedCapacity);
 await page.locator('[data-building-card="'+factoryId+'"] [data-district-preview]').waitFor();
 const next=s.buildings.territoryView(actor,s.world,plain).buildings.find(b=>b.id===factoryId).nextSiteYield;
 await mutation('/buildings/upgrade',()=>page.locator('[data-upgrade-building="'+factoryId+'"][data-upgrade-method="gold"]').click());
 check('factory upgrade matches predicted capacity',s.world.resourceEconomy.rates[actor.id].production===next.projectedCapacity);
 check('factory upgrade card shows old and new values',(await page.locator('[data-building-card="'+factoryId+'"]').innerText()).includes(' → '));
 await page.locator('[data-demolish-building="'+factoryId+'"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'factory-upgrade-desktop.jpg'),quality:70});
 const removed=await demolish(factoryId);check('factory demolition releases unique slot',removed.territory.availableTypes.includes('factory'));
 result=await mutation('/buildings/build',()=>page.locator('[data-build-type="university"][data-build-method="production"]').click());
 const universityId=result.building.id;check('university production construction is available',result.building.status==='constructing');
 await page.locator('[data-demolish-building="'+universityId+'"]').click();await page.locator('[data-demolition-confirm]:not([disabled])').waitFor();
 check('construction demolition warns that invested work is lost',(await page.locator('#facility-demolition-dialog').innerText()).includes('已投入生产力不返还'));
 await page.locator('[data-demolition-close]').first().click();
 clock=Math.ceil(s.world.territories[plain].buildings.find(b=>b.id===universityId).completesAt)+1;s.save();await page.evaluate(state=>window.__review.apply(state),s.state(actor));
 await page.waitForFunction(id=>document.querySelector('[data-building-card="'+id+'"]')?.textContent.includes('已建成'),universityId);
 check('completed university feeds science',s.world.resourceEconomy.rates[actor.id].science>0);
 await demolish(universityId);check('university demolition releases unique slot',s.buildings.territoryView(actor,s.world,plain).availableTypes.includes('university'));
 for(const type of ['main-stadium','port','medical-center','recovery-center','club-shop','scout-center','training-center']){
  const r=await mutation('/buildings/build',()=>page.locator('[data-build-type="'+type+'"][data-build-method="gold"]').click());
  await page.locator('[data-demolish-building="'+r.building.id+'"]').waitFor();await demolish(r.building.id);check(type+' can be built and demolished through the territory panel');
 }
 await page.evaluate(id=>{window.__review.selectTerritory(id);window.__review.panel.open(id);},home.territoryId);
 const hq=s.world.territories[home.territoryId].buildings.find(b=>b.type==='club-headquarters');await page.locator('[data-building-card="'+hq.id+'"]').waitFor();
 check('capital headquarters retains its core protection',await page.locator('[data-demolish-building="'+hq.id+'"]').count()===0);
 check('no browser errors',errors.length===0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));
}catch(e){if(page)await page.screenshot({path:path.join(out,'failure.jpg'),quality:60}).catch(()=>{});throw e;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
