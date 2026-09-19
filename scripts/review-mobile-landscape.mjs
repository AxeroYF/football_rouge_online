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
const root=process.cwd(),out=path.join(root,'outputs/mobile-landscape-fix-20260909'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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
const base=[['GK',4],['DEF',10],['MID',10],['ATT',60]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const roster=[...new Map([...base,...catalog.filter(p=>p.nationality==='西班牙').slice(0,12),...catalog.filter(p=>p.nationality==='巴西').slice(0,8)].map(p=>[p.id,p])).values()];
const actor={id:'wonder-browser',nickname:'黄狗经理',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:100000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'黄狗俱乐部',totalPicks:roster.length,roster},resources:{fans:50000}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
const trainingBuilding=s.buildings.createRecord('training-center');s.world.territories[hill].buildings.push(trainingBuilding);s.save();

const remote=index.territories.find(t=>t.countryCode==='GBR'&&t.spawnAllowed&&!t.eliteClubIds?.length);
const second=structuredClone(actor);Object.assign(second,{id:'social-rival',nickname:'北海经理',token:'isolated-rival-token',homeTerritoryId:remote.territoryId,mapColor:'#cf806b'});second.draft.teamName='北海联队';
second.draft.roster=second.draft.roster.map(p=>({...p,id:'rival:'+p.id,playerId:'rival:'+p.id,cardDefinitionId:p.cardDefinitionId??p.id,cardInstanceId:'rival:'+p.id}));
s.accounts.set(second.id,second);s.world.players[second.id]={playerId:second.id,territoryIds:[remote.territoryId,hill],capitalTerritoryId:remote.territoryId};
s.world.players[actor.id].territoryIds=s.world.players[actor.id].territoryIds.filter(id=>id!==hill);
Object.assign(s.world.territories[hill],{ownerType:'player',ownerId:second.id,capitalOf:null,buildings:[]});Object.assign(s.world.territories[remote.territoryId],{ownerType:'player',ownerId:second.id,capitalOf:second.id,buildings:[]});s.buildings.ensureCapitalStadium(second,s.world,remote.territoryId);
for(const [i,title]of ['南方星辰','港湾竞技','高原之光','新月俱乐部'].entries()){const a={id:'social-observer-'+i,nickname:'经理'+i,token:'observer-'+i,setupComplete:false,gold:1000,draft:{teamName:title,roster:[]}};s.accounts.set(a.id,a);}
s.state(actor);s.state(second);s.save();

fs.mkdirSync(out,{recursive:true});
const errors=[],report=[];
actor.playerSquads={schemaVersion:2,assignments:Object.fromEntries(actor.draft.roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))};
s.world.territories[home.territoryId].buildings.push(trainingBuilding);
const scoutBuilding=s.buildings.createRecord('scout-center');s.world.territories[home.territoryId].buildings.push(scoutBuilding);s.save();
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:780,height:360},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),actor.token);
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__audit={training:(v)=>trainingController.open(v),scouting:(v)=>scoutingController.open(v),select:(id)=>selectTerritory(id)};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/game');await page.locator('#server-players:not([hidden])').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
 assert.equal(await page.locator('.topbar').evaluate(e=>Math.round(e.getBoundingClientRect().height)),44,'mobile stylesheet loaded');
 const capture=async(name,selectors=[])=>{
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const shellBox=await page.locator('.campaign-shell').boundingBox();assert.ok(Math.abs(shellBox.y)<1&&shellBox.y+shellBox.height<=page.viewportSize().height+1,'root stays in viewport: '+name);
  const metrics=await page.evaluate(selectors=>{
   const selectorsAll=['.campaign-shell','.topbar','.map-stage','.primary-nav','#topbar-resource-summary','.topbar-yoogle','#server-players','.campaign-minimap-panel','#campaign-notifications',...selectors];
   const measures=selectorsAll.flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length).map(e=>{
    const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {selector,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom),right:Math.round(r.right)},overflowY:c.overflowY,overflowX:c.overflowX,minHeight:c.minHeight,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,outside:r.bottom>innerHeight+1||r.right>innerWidth+1||r.x< -1||r.y< -1};
   }));
   const scope=document.querySelector('.map-stage.has-stage-window')||document;
   const controls=[...scope.querySelectorAll('button,input,select,summary')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]')).map(e=>{const r=e.getBoundingClientRect();return {text:(e.innerText||e.getAttribute('aria-label')||e.id).trim().slice(0,35),w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y),font:getComputedStyle(e).fontSize};});
   return {viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},measures,smallControls:controls.filter(c=>c.w<32||c.h<32).slice(0,24)};
  },selectors);
  await page.screenshot({path:path.join(out,name+'.png'),scale:'css'});report.push({name,...metrics});console.log('CAPTURE '+name);
 };
 const pages=[['team','.primary-nav button:nth-child(2)','#campaign-team'],['tactics','.primary-nav button:nth-child(3)','#campaign-tactics'],['shop','#topbar-shop','#shop-window'],['elite','#topbar-elite','#elite-window'],['sponsor','#topbar-sponsorship','#sponsorship-window'],['inventory','#topbar-inventory','#inventory-window'],['research','#topbar-research','#research-window'],['cards','#topbar-card-management','#card-management-window'],['enhancement','#topbar-enhancement','#enhancement-window'],['wonders','#topbar-wonders','#wonder-catalog-window']];
 console.log('NAV '+JSON.stringify(await page.locator('.primary-nav button').evaluateAll(es=>es.map(e=>({id:e.id,text:e.textContent})))));
 for(const size of [{width:780,height:360},{width:740,height:320}]){
  await page.setViewportSize(size);await page.keyboard.press('Escape');await page.evaluate(()=>window.scrollTo(0,0));await capture(size.width+'-map');
  for(const [name,trigger,window]of pages){
   try{
    await page.keyboard.press('Escape');await page.evaluate(()=>window.scrollTo(0,0));
    if(!await page.locator(trigger).count()){report.push({name,skip:'missing '+trigger});continue;}
    await page.locator('#mobile-menu-toggle').click();await page.locator(trigger).click();
    await page.waitForTimeout(300);
    await capture(size.width+'-'+name,[window,window+'>*','.league-lineup-workspace','.league-board-panel','.league-bench','.league-tactics-detail','.shop-content','.elite-content','.inventory-choice-grid']);
   }catch(e){throw new Error(name+': '+e.message);}
  }
  await page.keyboard.press('Escape');await page.evaluate(()=>window.scrollTo(0,0));await page.locator('#server-players [data-interaction-player="social-rival"]').evaluate(e=>e.click());await page.waitForSelector('.interaction-surface');await capture(size.width+'-interaction',['#interaction-window','.interaction-surface','.interaction-hero','.interaction-scroll','.interaction-profile-grid']);
 }

 await page.keyboard.press('Escape');await page.setViewportSize({width:780,height:360});
 for(const [kind,id]of [['training',trainingBuilding.id],['scouting',scoutBuilding.id]]){
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(({kind,value})=>window.__audit[kind](value),{kind,value:{territoryId:home.territoryId,buildingId:id}});
  await page.waitForTimeout(500);await capture('780-'+kind,['#'+kind+'-window','.'+kind+'-header','.'+kind+'-content','.facility-actions']);
  await page.keyboard.press('Escape');
 }

 await page.keyboard.press('Escape');await page.setViewportSize({width:780,height:360});
 await page.locator('#mobile-menu-toggle').click();await page.locator('.primary-nav button:nth-child(3)').click();await page.locator('.mobile-tactics-nav').waitFor();
 await capture('780-tactics-overview',['.league-board-panel','.league-bench','#league-tactics-pitch']);const pitchBox=await page.locator('#league-tactics-pitch').boundingBox();assert.ok(pitchBox.y+pitchBox.height<=360,'whole tactical pitch visible');
 await page.locator('[data-mobile-pitch-zoom]').click();await capture('780-tactics-edit',['#league-tactics-pitch']);await page.locator('[data-mobile-pitch-zoom]').click();
 await page.locator('[data-mobile-tactics-tab="controls"]').click();await page.locator('[data-league-position-preset="position2"]').click();await page.waitForTimeout(200);assert.equal(await page.locator('.league-squad-page').getAttribute('data-mobile-view'),'controls');await capture('780-tactics-controls');
 await page.locator('[data-mobile-tactics-tab="tactics"]').click();await page.locator('[data-select-plan="leading"]').click();await page.waitForTimeout(200);await capture('780-tactics-plans');
 assert.ok(await page.locator('[data-plan-state="leading"]').isVisible());assert.ok(await page.locator('[data-plan-state="opening"]').isHidden());
 await page.locator('[data-mobile-tactics-close]').click();assert.ok(await page.locator('#campaign-tactics').isHidden());
 await page.locator('.mobile-map-tools').click();await capture('780-map-tools');await page.locator('.mobile-map-tools').click();
 await page.locator('#mobile-menu-toggle').click();await capture('780-navigation');await page.locator('.primary-nav button:nth-child(2)').click();
 await page.locator('[data-mobile-filter-toggle]').click();assert.ok(await page.locator('.team-management-shell').evaluate(e=>e.classList.contains('mobile-filters-open')));await capture('780-team-filters');
 await page.locator('[data-mobile-filter-toggle]').click();await page.keyboard.press('Escape');
 await page.setViewportSize({width:1440,height:900});assert.ok(await page.locator('#mobile-menu-toggle').isHidden());assert.ok(await page.locator('.primary-nav').isVisible());await capture('1440-desktop-control');

 await page.setViewportSize({width:740,height:320});
 s.diplomacy.mutate(second,{targetId:actor.id,action:'friendship',requestId:'mobile-audit-friendship'});
 await page.reload();await page.waitForSelector('[data-notice-action="accept"]',{state:'attached'});await page.locator('[data-notification-toggle]').click();
 await capture('740-notification-actions');
 await page.locator('[data-notice-action="accept"]').first().click();await page.waitForFunction(()=>!document.querySelector('[data-notice-action="accept"]'));assert.equal(s.diplomacy.details(actor,second.id).relationship,'friendship');
 s.playerPacks.addPacks(actor,'legendary-player-pack',1);actor.inventory.pendingOpening={id:'mobile-qa-choice',packType:'legendary-player-pack',openedAt:Date.now(),candidateIds:catalog.filter(p=>!p.isX&&!actor.draft.roster.some(owned=>String(owned.id)===String(p.id))).slice(0,3).map(p=>String(p.id))};s.save();
 await page.reload();await page.locator('#mobile-menu-toggle').click();await page.locator('#topbar-inventory').click();await page.locator('.inventory-choice-card').first().waitFor();await page.waitForTimeout(1300);
 for(const choice of await page.locator('.inventory-choice-card').all()){const b=await choice.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=740&&b.y>=44&&b.y+b.height<=320,'whole choice card reachable');}
 await capture('740-pack-choice');await page.locator('[data-player-card-action="pack-choice"]').first().click();await page.waitForSelector('.inventory-acquired-card');await capture('740-pack-acquired');
 // Separate unauthenticated page: never alter the fixture login or real account.
 const login=await browser.newContext({viewport:{width:780,height:360},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const lp=await login.newPage();await lp.goto(url+'/game');await lp.waitForSelector('#entry-auth-form');await lp.screenshot({path:path.join(out,'780-login.png'),scale:'css'});const loginButton=await lp.locator('.entry-primary').boundingBox();assert.ok(loginButton.y>=0&&loginButton.y+loginButton.height<=360,'login button visible');
 report.push({name:'780-login',metrics:await lp.locator('.auth-panel,#entry-auth-form,.entry-primary').evaluateAll(es=>es.map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON()})))});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({scope:'Isolated local game; not production; screenshots in CSS pixels. Navigation and key flows are exercised with actual locator clicks; fixtures and state are isolated from production.',report,errors},null,2));
 console.log('AUDIT '+out);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
