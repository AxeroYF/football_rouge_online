import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import { autoCompletePlayerSquads } from '../shared/config/player-squads.mjs';
import { buildAccountMatchSeat } from '../shared/football/account-match-seat.mjs';
import { expeditionPanelView } from '../client/map/expedition-panel-controller.js';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { CampaignService } from '../campaign-service.mjs';
import { DRAFT_VERSION } from '../shared/config/draft.mjs';
import { territoryPointToDisplay } from '../client/map/campaign-map-geometry.js';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/scout-travel-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-expedition-browser-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const samples=[1,2,3].map(count=>index.territories.find(t=>['FRA','ESP','DEU','ITA'].includes(t.countryCode)&&Object.values(resources.territories[t.territoryId].yields).filter(Boolean).length===count&&(t.bounds[2]-t.bounds[0])>.5&&(t.bounds[3]-t.bounds[1])>.4));
assert.ok(samples.every(Boolean));
const science=index.territories.find(t=>t.countryCode==='ESP'&&resources.territories[t.territoryId].yields.science>0);
const owned=[...new Set([...samples.map(t=>t.territoryId),science.territoryId])];
const start=Date.now()-3*3600000;
const service=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources,now:()=>start});
const roster=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const actor={id:'resource-review',nickname:'远征审阅俱乐部',token:'isolated-resource-review',createdAt:start,setupComplete:true,homeTerritoryId:samples[0].territoryId,gold:10000,mapColor:'#4f8d79',draft:{version:DRAFT_VERSION,teamName:'远征审阅俱乐部',totalPicks:33,roster},resources:{production:30,science:25,fans:0}};
service.accounts.set(actor.id,actor);service.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:actor.homeTerritoryId};
for(const id of owned)Object.assign(service.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===actor.homeTerritoryId?actor.id:null});
const placed=[{id:'art-stadium',type:'main-stadium',level:5},{id:'art-scout-center',type:'scout-center',level:3},{id:'art-training',type:'training-center',level:4}];
for(const [i,b]of placed.entries())service.world.territories[samples[i].territoryId].buildings=[{...b,status:'active',createdAt:start,updatedAt:start}];
service.world.territories[samples[0].territoryId].buildings.push({id:'art-contour-training',type:'training-center',level:1,status:'active',createdAt:start,updatedAt:start},{id:'art-contour-shop',type:'club-shop',level:1,status:'active',createdAt:start,updatedAt:start});
actor.scouting={schemaVersion:2,tasks:{},recruitRequests:{},units:Object.fromEntries(['a','b'].map((id,i)=>['art-scout-'+id,{id:'art-scout-'+id,name:i?'James Walker':'Oliver Reed',level:1,territoryId:samples[1].territoryId,originTerritoryId:samples[1].territoryId,originBuildingId:'art-scout-center',recruitedAt:start,movement:null}]))};
actor.playerSquads=autoCompletePlayerSquads(null,roster).playerSquads;
for(const pool of ['GK','DEF','MID','ATT'])roster.filter(p=>p.pool===pool).forEach((p,i,group)=>actor.playerSquads.assignments[p.id]=i<Math.floor(group.length/2)?'expedition':'garrison');
const squads={};
for(const id of ['expedition','garrison']){
 const seat=buildAccountMatchSeat(actor,id),starters=seat.players.map(p=>p.id);
 squads[id]={starters,positions:seat.positions,formation:seat.formation,attackStyle:id==='expedition'?'positive':'parkBus',defenseStyle:id==='expedition'?'wingPlay':'lowBlock'};
}
actor.tactics={schemaVersion:2,activeSquadId:'garrison',squads,...structuredClone(squads.garrison)};
roster.forEach((p,i)=>{p.state={...p.state,fitness:[100,73,46,0][i%4]};});
service.save();fs.mkdirSync(out,{recursive:true});



let child,browser,page,stderr='',stdout='';const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);if(checks.length%5===0)console.log('Passed '+checks.length+': '+name);};
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-resource-review-password'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:1});
 const auth={authorization:'Bearer isolated-resource-review'};
 async function post(route,body){const response=await context.request.post(url+'/api/campaign/'+route,{headers:auth,data:body});assert.equal(response.status(),200,await response.text());return response.json();}
 async function state(){return (await (await context.request.get(url+'/api/campaign/state',{headers:auth})).json()).state;}
 const expedition=await post('expedition/move',{territoryId:samples[1].territoryId});
 const travel=await post('scouting/move',{scoutId:'art-scout-a',territoryId:samples[0].territoryId,requestId:'review-scout-travel'});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-resource-review'));
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__scoutReview={map,store:campaignStore,scouting:()=>scoutingController,scoutMap:()=>scoutUnitController};'});});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});await page.locator('#topbar-resource-summary').waitFor({state:'visible',timeout:60000});await page.waitForFunction(()=>window.__scoutReview?.scoutMap()&&!document.querySelector('#campaign-map')?.classList.contains('is-loading'),{},{timeout:60000});
 const panel=page.locator('#scouting-window'),notice=page.locator('.scout-movement-notice'),army=page.locator('#expedition-movement-widget .campaign-expedition-card');
 await notice.waitFor({state:'visible'});check('both expedition and scout have active journey cards',await army.isVisible());
 check('initial scout notice resolves territory names after map loading',!(await notice.textContent()).includes('adm1:'));
 check('scout movement contains no visible percentage',!(await notice.textContent()).includes('%')&&await page.locator('[data-scout-move-percent]').count()===0);
 const dimensions=await page.evaluate(()=>{const items=[document.querySelector('#expedition-movement-widget .campaign-expedition-card'),document.querySelector('.scout-movement-notice')];return items.map(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el),time=getComputedStyle(el.querySelector('.campaign-expedition-footer span'));return {width:b.width,height:b.height,padding:s.padding,gap:s.gap,radius:s.borderRadius,timeSize:time.fontSize,timeWeight:time.fontWeight,button:el.querySelector('.campaign-expedition-footer button').textContent};});});
 assert.deepEqual(dimensions[1],dimensions[0]);check('journey cards share sizing, spacing, countdown and abort action');
 await page.screenshot({path:path.join(out,'unified-journeys.png')});
 // Fast-forward only the displayed server clock; this does not write gameplay data.
 for(const fraction of [.25,.5,.75]){
  await page.evaluate(({fraction,movement})=>{const r=window.__scoutReview,s=structuredClone(r.store.getState());s.scouting.serverNow=movement.startedAt+(movement.arrivesAt-movement.startedAt)*fraction;r.store.setState(s,{source:'isolated-clock'});r.scoutMap().refresh();}, {fraction,movement:travel.scout.movement});
  const result=await page.evaluate(({from,to})=>{const r=window.__scoutReview;let marker;r.map.eachLayer(l=>{if(l.options?.icon?.options?.className==='scout-unit-map-icon'&&l.options.icon.options.html.includes('Oliver Reed'))marker=l;});const a=r.map.project(from,0),b=r.map.project(to,0),p=r.map.project(marker.getLatLng(),0);const t=(p.x-a.x)/(b.x-a.x);return {t,deviation:Math.abs((p.y-a.y)-(b.y-a.y)*t),percent:Number(document.querySelector('[data-scout-move-progress="art-scout-a"]').getAttribute('aria-valuenow'))};},{from:territoryPointToDisplay(samples[1].centroid,samples[1].region),to:territoryPointToDisplay(samples[0].centroid,samples[0].region)});
  check('linear map position and progress agree at '+Math.round(fraction*100),Math.abs(result.t-fraction)<.003&&result.deviation<1e-7&&result.percent===fraction*100);
 }
 await page.evaluate(s=>window.__scoutReview.store.setState(s,{source:'isolated-restore-clock'}),await state());
 await notice.locator('[data-scout-open-moving]').click();await panel.locator('[data-scout-rename]').waitFor();check('moving scout can open rename',await panel.isVisible());
 await panel.locator('[data-scout-rename]').click();const input=panel.locator('[data-scout-name-input]'),save=panel.locator('[data-scout-rename-form] button[type=submit]');
 await input.fill('南美观察员');await page.evaluate(()=>{const r=window.__scoutReview;r.store.setState(structuredClone(r.store.getState()),{source:'isolated-poll'});});
 check('polling retains draft and input focus',await input.inputValue()==='南美观察员'&&await input.evaluate(el=>el===document.activeElement));
 await page.route('**/api/campaign/scouting/rename',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟保存失败'})}));await save.click();await panel.locator('#scout-name-error').filter({hasText:'模拟保存失败'}).waitFor();check('failed rename retains typed name and can retry',await input.inputValue()==='南美观察员'&&await save.isEnabled());
 check('failed rename does not change saved name',(await state()).scouting.scouts.find(s=>s.id==='art-scout-a').name==='Oliver Reed');
 await page.unroute('**/api/campaign/scouting/rename');const renamed=page.waitForResponse(r=>r.url().endsWith('/api/campaign/scouting/rename')&&r.request().method()==='POST');await save.click();assert.equal((await renamed).status(),200);await input.waitFor({state:'hidden'});
 check('renamed identity updates detail, notice and map label',(await panel.locator('.scout-name-row h3').textContent())==='南美观察员'&&(await notice.textContent()).includes('南美观察员')&&await page.locator('.scout-map-token[title*="南美观察员"]').count()===1);
 const after=await state();assert.deepEqual(after.scouting.scouts.find(s=>s.id==='art-scout-a').movement,travel.scout.movement);check('renaming preserves the entire active journey and its deadline');
 check('the other scout is unchanged',after.scouting.scouts.find(s=>s.id==='art-scout-b').name==='James Walker');
 const disk=JSON.parse(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'));check('new name is persisted to disk',disk.accounts[actor.id].scouting.units['art-scout-a'].name==='南美观察员');
 await panel.locator('[data-scout-rename]').click();await input.fill('');await save.click();await panel.locator('#scout-name-error').filter({hasText:'1～24'}).waitFor();check('empty name shows inline validation');await input.fill('未保存的名字');await page.keyboard.press('Escape');check('Escape cancels editing and keeps the scout panel',await input.isHidden()&&await panel.isVisible()&&(await panel.locator('.scout-name-row h3').textContent())==='南美观察员');
 await panel.locator('[data-scout-rename]').click();await input.fill('南美洲观察员');await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#toast')).opacity)===0);
 check('mobile rename controls fit and remain reachable',await save.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));await page.screenshot({path:path.join(out,'rename-mobile.png')});await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.setViewportSize({width:1600,height:1050});
 const discovery=await post('scouting/start',{scoutId:'art-scout-b',territoryId:samples[1].territoryId,requestId:'review-working-name'});
 const working=await post('scouting/rename',{scoutId:'art-scout-b',name:'欧洲观察员'});check('working scout keeps its task and updated notice name',working.state.scouting.tasks.some(t=>t.id===discovery.task.id&&t.scoutName==='欧洲观察员'));
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#topbar-resource-summary').waitFor({state:'visible'});await notice.waitFor({state:'visible'});
 check('reload keeps both new names and active notifications',(await notice.textContent()).includes('南美观察员')&&(await page.locator('#scouting-notifications').textContent()).includes('欧洲观察员'));
 const invalid=await context.request.post(url+'/api/campaign/scouting/rename',{headers:auth,data:{scoutId:'art-scout-a',name:'球'.repeat(25)}});check('oversized names are rejected',invalid.status()===400);
 const foreign=await context.request.post(url+'/api/campaign/scouting/rename',{headers:auth,data:{scoutId:'someone-elses-scout',name:'测试'}});check('another scout cannot be renamed',foreign.status()===404);
 const denied=await context.request.post(url+'/api/campaign/scouting/rename',{data:{scoutId:'art-scout-a',name:'测试'}});check('unauthenticated rename is rejected',denied.status()===401);
 await notice.locator('[data-scout-cancel-move]').click();await notice.waitFor({state:'hidden'});check('renamed scout still supports aborting movement',(await state()).scouting.scouts.find(s=>s.id==='art-scout-a').status==='idle');
 
 await page.evaluate(p=>{window.__scoutReview.map.setView(p,7.6,{animate:false});},territoryPointToDisplay(samples[1].centroid,samples[1].region));
 await page.locator('[data-building-id="art-scout-center"]').click();await panel.locator('[data-scout-open-unit="art-scout-a"]').waitFor();check('center roster shows both renamed scouts',(await panel.textContent()).includes('南美观察员')&&(await panel.textContent()).includes('欧洲观察员'));
 await panel.locator('[data-scout-open-unit="art-scout-a"]').click();await panel.locator('[data-scout-rename]').click();await page.setViewportSize({width:390,height:844});await input.fill('待命观察员');
 check('idle scout editor also stays reachable on mobile',await save.evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#toast')).opacity)===0);check('expanded rename editor preserves space for both forecast legends',await panel.locator('.scout-pool').evaluateAll(pools=>pools.every(pool=>{const r=pool.getBoundingClientRect(),last=pool.querySelector('li:last-child').getBoundingClientRect();return last.bottom<=r.bottom;})));await page.screenshot({path:path.join(out,'rename-idle-mobile.png')});await page.keyboard.press('Escape');
 check('no browser runtime errors',errors.length===0);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({passed:checks.length,checks,errors,isolation:'Own temporary full game server and test account; no real saves modified.'},null,2));console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:error.message,checks,errors},null,2));}throw error;}finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});const resolved=path.resolve(data),parent=path.resolve(os.tmpdir());if(!resolved.startsWith(parent+path.sep)||!path.basename(resolved).startsWith('ydl-expedition-browser-'))throw Error('Unexpected temporary review path');fs.rmSync(resolved,{recursive:true,force:true});}
