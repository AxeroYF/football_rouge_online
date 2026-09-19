import {createFormationResearchSlot} from '../shared/config/formation-research.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {CampaignService} from '../campaign-service.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/conquest-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-wonder-live-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const has=(id,terrain)=>resources.territories[id].terrain.includes(terrain);
const home=index.territories.find(t=>t.countryCode==='FRA'&&has(t.territoryId,'plains')&&t.landNeighbors.some(id=>has(id,'hills')||has(id,'mountain'))&&t.landNeighbors.some(id=>has(id,'plains'))&&t.landNeighbors.length>=3);
assert.ok(home);
const hill=home.landNeighbors.find(id=>has(id,'hills')||has(id,'mountain')),plain=home.landNeighbors.find(id=>id!==hill&&has(id,'plains'));
const owned=[home.territoryId];
const s=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const base=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const pt=catalog.filter(p=>p.nationality==='葡萄牙').slice(0,3);const roster=[...base.filter(p=>p.nationality!=='葡萄牙'),...pt,{...pt[0],id:'pt-duplicate',cardDefinitionId:pt[0].id}];
const actor={id:'wonder-browser',nickname:'奇观验收',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:100000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'奇观验收',totalPicks:roster.length,roster},resources:{fans:50000}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
actor.developmentFogDisabled=true;
const exhausted={...structuredClone(actor),id:'quota-exhausted',token:'isolated-quota-token',homeTerritoryId:plain,conquest:{day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),used:5,cooldownUntil:0}};
s.accounts.set(exhausted.id,exhausted);s.world.players[exhausted.id]={playerId:exhausted.id,territoryIds:[plain],capitalTerritoryId:plain};Object.assign(s.world.territories[plain],{ownerType:'player',ownerId:exhausted.id,capitalOf:exhausted.id,buildings:[]});
actor.conquest={day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),used:4,cooldownUntil:Date.now()+1200000};s.save();
const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
fs.mkdirSync(out,{recursive:true});
let child,browser,page,stdout='',stderr='';
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-wonder-admin'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code+' '+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:2514,height:1316}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-wonder-token'));
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__conquestReview={store:campaignStore,select:id=>territoryController.selectTerritory(id)};'});});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});await page.locator('#topbar-conquest:not([hidden])').waitFor({timeout:90000});
 check('persisted daily count loads in game',(await page.locator('[data-conquest-count]').textContent())==='1/5');
 check('cooldown is visible after server restart',await page.locator('[data-conquest-cooldown]').isVisible());
 const old=await page.locator('[data-conquest-cooldown]').textContent();await page.waitForTimeout(1200);check('cooldown ticks without rebuilding game',old!==await page.locator('[data-conquest-cooldown]').textContent());
 const response=await page.request.post(url+'/api/campaign/territory/challenge',{headers:{Authorization:'Bearer isolated-wonder-token'},data:{territoryId:hill}});
 check('HTTP endpoint rejects attack during cooldown',response.status()===409);check('HTTP error explains rest period',/休整/.test(await response.text()));
 const quotaResponse=await page.request.post(url+'/api/campaign/territory/challenge',{headers:{Authorization:'Bearer isolated-quota-token'},data:{territoryId:hill}});
 check('HTTP endpoint rejects exhausted daily quota',quotaResponse.status()===409&&/次数已用完/.test(await quotaResponse.text()));
 await page.locator('#map-loader.is-ready').waitFor({state:'attached',timeout:90000});await page.evaluate(id=>window.__conquestReview.select(id),hill);
 check('territory attack button disabled in cooldown',await page.locator('#territory-challenge-button').isDisabled());
 for(const width of [2514,1600,1000,680,390,320]){
   await page.setViewportSize({width,height:width<700?850:1050});await page.waitForTimeout(250);
   const boxes=await page.evaluate(()=>['#topbar-conquest','#yoogle-search','#topbar-resource-summary'].map(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return {sel,x:r.x,right:r.right,width:r.width};}));
   check(`HUD and resources fit ${width}`,boxes.every(b=>b.x>=0&&b.right<=width+1));
   check(`HUD precedes search without overlap ${width}`,boxes[1].width===0||boxes[0].right<=boxes[1].x+1);
   await page.screenshot({path:path.join(out,`conquest-${width}.png`)});
 }
 await page.evaluate(()=>{const store=window.__conquestReview.store,state=store.getState();store.setState({...state,conquest:{...state.conquest,used:5,remaining:0,cooldownUntil:0}});});
 check('zero quota display',(await page.locator('[data-conquest-count]').textContent())==='0/5');check('expired cooldown hidden',!await page.locator('[data-conquest-cooldown]').isVisible());
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#topbar-conquest:not([hidden])').waitFor({timeout:90000});check('reload restores authoritative quota',(await page.locator('[data-conquest-count]').textContent())==='1/5');
 check('no browser runtime errors',errors.length===0);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:error.stack,checks,errors,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000)});fs.rmSync(data,{recursive:true,force:true});}

