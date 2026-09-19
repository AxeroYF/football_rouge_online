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
const root=process.cwd(),out=path.join(root,'outputs/expedition-vehicles-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-expedition-browser-'));
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
service.world.territories[samples[0].territoryId].buildings.push({id:'art-contour-training',type:'training-center',level:1,status:'active',createdAt:start,updatedAt:start},{id:'art-contour-shop',type:'club-shop',level:1,status:'active',createdAt:start,updatedAt:start});
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
 async function focus(t){await page.evaluate(p=>{window.__resourceReviewMap.setView(p,8,{animate:false});},territoryPointToDisplay(t.centroid,t.region));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
 await focus(samples[0]);await page.locator('.expedition-piece-token img').waitFor({state:'visible'});
 check('default map icon uses airplane',state.expeditionPiece.tokenUrl.includes('/expedition-units/icons/airplane'));
 const auth={authorization:'Bearer isolated-resource-review'};
 const gameState=async()=>{const r=await context.request.get(url+'/api/campaign/state',{headers:auth});return (await r.json()).state;};
 async function openStyles(){await page.locator('#account-menu-trigger').click();await page.locator('#account-expedition-style').click();await page.locator('#expedition-appearance-window').waitFor({state:'visible'});}
 async function selectStyle(id){await page.locator('[data-expedition-style="'+id+'"]').click();const button=page.locator('[data-expedition-style-apply]');if(await button.isEnabled()){const saved=page.waitForResponse(r=>r.url().endsWith('/api/campaign/expedition/appearance')&&r.request().method()==='POST');await button.click();assert.equal((await saved).status(),200);await page.waitForFunction(()=>document.querySelector('[data-expedition-style-apply]')?.textContent==='正在使用');}}
 async function modalAboveMinimap(){return page.evaluate(()=>{const r=document.querySelector('.campaign-minimap-panel').getBoundingClientRect();return Boolean(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#expedition-appearance-window'));});}
 await openStyles();check('desktop modal sits above minimap',await modalAboveMinimap());check('appearance menu shows five named units',await page.locator('[data-expedition-style]').count()===5);check('default legacy unit maps to airplane',await page.locator('[data-expedition-style="airplane"] .expedition-style-status').textContent()==='当前使用');check('current selection cannot be redundantly applied',await page.locator('[data-expedition-style-apply]').isDisabled());
 for(const id of ['excavator','bus','sports-car','tank','airplane']){await selectStyle(id);check('saved '+id+' appearance',(await gameState()).expeditionPiece.styleId===id);await page.keyboard.press('Escape');await page.waitForFunction(id=>{const img=document.querySelector('.expedition-piece-token img');return img?.complete&&img.naturalWidth>0&&img.src.includes('/expedition-units/icons/'+id+'.png');},id);check('map uses '+id+' image');await page.locator('.expedition-piece-token').screenshot({path:path.join(out,'map-token-'+id+'.png')});await openStyles();}
 await page.screenshot({path:path.join(out,'appearance-window.png')});
 // A failed save stays reviewable and can be retried, without a false current badge.
 await page.locator('[data-expedition-style="excavator"]').click();await page.route('**/api/campaign/expedition/appearance',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟保存失败'})}));await page.locator('[data-expedition-style-apply]').click();await page.locator('.expedition-style-error').filter({hasText:'模拟保存失败'}).waitFor();check('failed save leaves the saved style unchanged',(await gameState()).expeditionPiece.styleId==='airplane');await page.unroute('**/api/campaign/expedition/appearance');await selectStyle('excavator');check('failed save can be retried',(await gameState()).expeditionPiece.styleId==='excavator');
 await page.setViewportSize({width:390,height:844});check('mobile appearance stays inside viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('mobile modal sits above minimap',await modalAboveMinimap());await page.locator('[data-expedition-style="tank"]').scrollIntoViewIfNeeded();check('fifth unit is reachable on mobile',await page.locator('[data-expedition-style="tank"]').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));await page.locator('.expedition-appearance-grid').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:path.join(out,'appearance-mobile.png')});await page.keyboard.press('Escape');await page.setViewportSize({width:1600,height:1050});
 const move=await context.request.post(url+'/api/campaign/expedition/move',{headers:auth,data:{territoryId:samples[1].territoryId}});assert.equal(move.status(),200);const before=(await move.json()).expeditionPiece.movement;await openStyles();await selectStyle('tank');const after=(await gameState()).expeditionPiece;check('appearance change does not restart travel',after.moving&&after.movement.startedAt===before.startedAt&&after.movement.arrivesAt===before.arrivesAt&&after.movement.toTerritoryId===before.toTerritoryId);await page.keyboard.press('Escape');
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#topbar-resource-summary').waitFor({state:'visible'});await page.waitForFunction(()=>window.__resourceReviewMap&&!document.querySelector('#campaign-map')?.classList.contains('is-loading'));check('reloaded session keeps selected appearance',(await gameState()).expeditionPiece.styleId==='tank');check('disk save contains selected appearance',JSON.parse(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8')).accounts[actor.id].expeditionPiece.tokenId==='tank');
 const invalid=await context.request.post(url+'/api/campaign/expedition/appearance',{headers:auth,data:{tokenId:'../hidden'}});check('invalid appearance rejected',invalid.status()===400);const denied=await context.request.post(url+'/api/campaign/expedition/appearance',{headers:{authorization:'Bearer invalid'},data:{tokenId:'airplane'}});check('unauthenticated appearance change rejected',denied.status()===401);
 await context.request.post(url+'/api/campaign/expedition/cancel',{headers:auth});check('cancel movement preserves selected appearance',(await gameState()).expeditionPiece.styleId==='tank');await focus(samples[0]);await page.screenshot({path:path.join(out,'game-selected-unit.png')});
 check('no runtime errors',errors.length===0);fs.writeFileSync(path.join(out,'game-browser-report.json'),JSON.stringify({passed:checks.length,checks,errors,isolation:'Own temporary full game server/account. Five styles, failed-save retry, moving appearance change, disk persistence and auth/invalid-input checks. No real account modified.'},null,2));console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(out,'game-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'game-failure.json'),JSON.stringify({message:error.message,checks,errors},null,2));}throw error;}finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});const resolved=path.resolve(data),parent=path.resolve(os.tmpdir());if(!resolved.startsWith(parent+path.sep)||!path.basename(resolved).startsWith('ydl-expedition-browser-'))throw Error('Unexpected temporary review path');fs.rmSync(resolved,{recursive:true,force:true});}
