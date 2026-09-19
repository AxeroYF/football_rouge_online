import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import pointInPolygon from '@turf/boolean-point-in-polygon';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { CampaignService } from '../campaign-service.mjs';
import { DRAFT_VERSION } from '../shared/config/draft.mjs';
import { territoryPointToDisplay } from '../client/map/campaign-map-geometry.js';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/facility-model-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-facilities-browser-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const samples=[1,2,3].map(count=>index.territories.find(t=>['FRA','ESP','DEU','ITA'].includes(t.countryCode)&&Object.values(resources.territories[t.territoryId].yields).filter(Boolean).length===count&&(t.bounds[2]-t.bounds[0])>.5&&(t.bounds[3]-t.bounds[1])>.4));
assert.ok(samples.every(Boolean));
const science=index.territories.find(t=>t.countryCode==='ESP'&&resources.territories[t.territoryId].yields.science>0);
const owned=[...new Set([...samples.map(t=>t.territoryId),science.territoryId])];
const start=Date.now()-3*3600000;
const service=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources,now:()=>start});
const roster=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const actor={id:'resource-review',nickname:'模型审阅俱乐部',token:'isolated-resource-review',createdAt:start,setupComplete:true,homeTerritoryId:samples[0].territoryId,gold:10000,mapColor:'#4f8d79',draft:{version:DRAFT_VERSION,teamName:'模型审阅俱乐部',totalPicks:33,roster},resources:{production:30,science:25,fans:0}};
service.accounts.set(actor.id,actor);service.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:actor.homeTerritoryId};
for(const id of owned)Object.assign(service.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===actor.homeTerritoryId?actor.id:null});
const placed=[{id:'art-stadium',type:'main-stadium',level:5},{id:'art-scout-center',type:'scout-center',level:3},{id:'art-training',type:'training-center',level:4}];
for(const [i,b]of placed.entries())service.world.territories[samples[i].territoryId].buildings=[{...b,status:'active',createdAt:start,updatedAt:start}];
actor.scouting={schemaVersion:2,tasks:{},recruitRequests:{},units:Object.fromEntries(['a','b'].map((id,i)=>['art-scout-'+id,{id:'art-scout-'+id,name:i?'James Walker':'Oliver Reed',level:1,territoryId:samples[1].territoryId,originTerritoryId:samples[1].territoryId,originBuildingId:'art-scout-center',recruitedAt:start,movement:null}]))};service.save();
let child,browser,page,stderr='',stdout='';const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);};
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-resource-review-password'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-resource-review'));
 // Expose the existing Leaflet map only in this isolated review response.
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();const source=await response.text();assert.ok(source.includes('}).setView([52, 12], 3.25);'));await route.fulfill({response,body:source.replace('}).setView([52, 12], 3.25);','}).setView([52, 12], 3.25);\nwindow.__resourceReviewMap = map;')});});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});
 await page.locator('#topbar-resource-summary').waitFor({state:'visible',timeout:60000});
 await page.waitForFunction(()=>window.__resourceReviewMap&&!document.querySelector('#campaign-map')?.classList.contains('is-loading'),{},{timeout:60000});

 const loaded=await context.request.get(url+'/api/campaign/state',{headers:{authorization:'Bearer isolated-resource-review'}});const state=(await loaded.json()).state;
 check('seven facility catalog entries use new model icons',state.buildings.catalog.length===7&&state.buildings.catalog.every(i=>i.iconPath.includes('/facilities/icons/')));
 check('upgrading is still disabled',state.buildings.catalog.every(i=>i.upgradeEnabled===false));check('expedition and scouts expose new art',state.expeditionPiece.tokenUrl.includes('/expedition-units/icons/messi')&&state.scouting.scouts.every(u=>u.tokenUrl.includes('/facilities/icons/scout')));
 async function focus(t){await page.evaluate(p=>{window.__resourceReviewMap.setView(p,8,{animate:false});},territoryPointToDisplay(t.centroid,t.region));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
 async function imageOK(selector,part){await page.locator(selector).first().waitFor({state:'visible'});await page.waitForFunction(({selector,part})=>{const img=document.querySelector(selector);return img?.complete&&img.naturalWidth>0&&img.src.includes(part);},{selector,part});}
 await focus(samples[0]);await imageOK('.expedition-piece-token img','/expedition-units/icons/messi');await imageOK('[data-building-id="art-stadium"] img','main-stadium-lv5');check('map LV5 stadium and expedition icons render');await page.screenshot({path:path.join(out,'game-stadium.png')});await page.locator('[data-building-id="art-stadium"]').click();await imageOK('#building-panel [data-building-card="art-stadium"] img','main-stadium-lv5');check('building details keep actual LV5 artwork');
 await focus(samples[1]);await imageOK('[data-building-id="art-scout-center"] img','scout-center-lv3');await imageOK('.scout-map-token img','/facilities/icons/scout');check('map scout center and both scout tokens render',await page.locator('.scout-map-token').count()===2);await page.screenshot({path:path.join(out,'game-scouts.png')});await page.locator('[data-building-id="art-scout-center"]').click();await imageOK('.scout-center-identity img','scout-center-lv3');check('scout center details use LV3 model');check('upgrade action remains disabled',await page.locator('#scouting-window .facility-upgrade').isDisabled());await page.screenshot({path:path.join(out,'game-scout-center.png')});await page.keyboard.press('Escape');
 await page.locator('.scout-map-token').first().click();await imageOK('.scout-building-art img','/facilities/icons/scout');check('scout unit details use new model');await page.screenshot({path:path.join(out,'game-scout-unit.png')});await page.keyboard.press('Escape');
 await focus(samples[2]);await page.locator('[data-building-id="art-training"]').click();await imageOK('.training-overview img','training-center-lv4');check('training center uses actual LV4 model');check('training upgrade remains disabled',await page.locator('#training-window .facility-upgrade').isDisabled());await page.screenshot({path:path.join(out,'game-training-center.png')});
 check('no runtime errors',errors.length===0);fs.writeFileSync(path.join(out,'game-browser-report.json'),JSON.stringify({passed:checks.length,checks,errors,isolation:'Own temporary full game server/account. Level 3/4/5 assets seeded only in isolated fixture; no upgrade gameplay enabled.'},null,2));console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(out,'game-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'game-failure.json'),JSON.stringify({message:error.message,checks,errors},null,2));}throw error;}finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});const resolved=path.resolve(data),parent=path.resolve(os.tmpdir());if(!resolved.startsWith(parent+path.sep)||!path.basename(resolved).startsWith('ydl-facilities-browser-'))throw Error('Unexpected temporary review path');fs.rmSync(resolved,{recursive:true,force:true});}
