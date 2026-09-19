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
const root=process.cwd(),out=path.join(root,'outputs/operating-cost-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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

const errors=[],checks=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};fs.mkdirSync(out,{recursive:true});
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),actor.token);
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__review={selectTerritory,panel:buildingPanelController,state:()=>campaignState,apply:state=>campaignStore.setState(state),resources:resourceController};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/game');await page.waitForFunction(()=>window.__review&&document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
 const initial=s.resourceState(actor),costs=initial.expenses;
 check('first version has low hourly wages and upkeep',costs.wages<=actor.draft.roster.length*2.5&&costs.maintenance===3.5);
 check('headline is the sum of income and negative expenses',Math.abs(initial.hourly.gold-initial.sources.reduce((n,x)=>n+x.yields.gold,0))<.001);
 await page.locator('[data-resource-trigger="gold"]').hover();await page.locator('#resource-window [data-resource-source="club-wages"]').waitFor();
 check('gold tooltip shows both operating costs',await page.locator('#resource-window [data-resource-source="club-maintenance"]').count()===1);
 await page.locator('[data-resource-source="club-wages"] summary').click();
 check('wage breakdown names grades and rates',(await page.locator('[data-resource-source="club-wages"]').innerText()).includes('级球员'));
 check('protection against debt is explained',(await page.locator('#resource-window').innerText()).includes('不累积欠款'));
 await page.screenshot({path:path.join(out,'gold-income-expenses-desktop.jpg'),quality:75});
 await page.evaluate(id=>{window.__review.resources.close();window.__review.selectTerritory(id);window.__review.panel.open(id);},plain);
 await page.locator('[data-build-type="factory"]').first().waitFor();check('build preview shows future maintenance',(await page.locator('[data-wonder-id="facility:factory"]').innerText()).includes('基础养护 0.5 金币/小时'));
 const response=page.waitForResponse(r=>r.url().endsWith('/buildings/build')&&r.request().method()==='POST');await page.locator('[data-build-type="factory"][data-build-method="gold"]').click();const built=await response;assert.equal(built.status(),200);const result=await built.json();
 await page.locator('[data-building-card="'+result.building.id+'"]').waitFor();check('upgrade shows maintenance before and after',(await page.locator('[data-building-card="'+result.building.id+'"]').innerText()).includes('基础养护 0.5 → 1 金币/小时'));
 await page.locator('[data-building-card="'+result.building.id+'"] .building-panel-notice').last().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'facility-upkeep-desktop.jpg'),quality:75});
 const before=actor.gold,state=s.resourceState(actor),at=clock;clock+=3600000;s.save();
 check('one offline hour settles net income once',actor.gold===before+Math.floor(state.hourly.gold+state.expenses.total)-Math.floor(state.expenses.wages)-Math.floor(state.expenses.maintenance));const after=actor.gold;s.save();check('repeat refresh cannot double bill',actor.gold===after);
 const persisted=JSON.parse(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'));check('salary checkpoint is persisted',persisted.accounts[actor.id].operatingCosts.settledAt===clock);
 check('no browser errors',errors.length===0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,example:{wages:costs.wages,maintenance:costs.maintenance,netHourly:initial.hourly.gold}},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
