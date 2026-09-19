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
const root=process.cwd(),out=path.join(root,'outputs/expedition-panel-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-expedition-browser-'));
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


let child,browser,page,stderr='',stdout='';const checks=[],errors=[],requests=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);if(checks.length%5===0)console.log('Passed '+checks.length+': '+name);};
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-resource-review-password'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-resource-review'));
 // Test hooks exist only in this isolated browser response, never in application code.
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__expeditionReview={map,store:campaignStore,piece:()=>expeditionPieceController,territories:territoryLayersById};'});});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/expedition/'))requests.push(new URL(r.url()).pathname);});
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});
 await page.locator('#topbar-resource-summary').waitFor({state:'visible',timeout:60000});
 await page.waitForFunction(()=>window.__expeditionReview?.piece()&&!document.querySelector('#campaign-map')?.classList.contains('is-loading'),{},{timeout:60000});
 const token=page.locator('.expedition-piece-token'),panel=page.locator('#expedition-panel'),move=panel.locator('[data-expedition-action="move"]');
 const state=await page.evaluate(()=>window.__expeditionReview.store.getState());
 const expected=expeditionPanelView(state);
 check('fixture retains independently saved expedition and garrison tactics',state.tactics.squads.expedition.attackStyle!==state.tactics.squads.garrison.attackStyle);
 async function focus(t){await page.evaluate(p=>{window.__expeditionReview.map.setView(p,7.6,{animate:false});},territoryPointToDisplay(t.centroid,t.region));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
 async function mode(){return page.locator('#campaign-map').evaluate(el=>el.classList.contains('is-expedition-move-mode'));}
 async function pickDestination(){await page.evaluate(({id,point})=>{window.__expeditionReview.territories.get(id).fire('click',{latlng:{lat:point[0],lng:point[1]},originalEvent:{stopPropagation(){},preventDefault(){}}});},{id:samples[1].territoryId,point:territoryPointToDisplay(samples[1].centroid,samples[1].region)});await page.locator('#expedition-move-confirm').waitFor({state:'visible'});}
 await focus(samples[0]);await token.click();await panel.waitFor({state:'visible'});
 check('token click opens inspection without entering movement',!await mode());check('inspection issues no movement or estimate requests',requests.length===0);
 assert.deepEqual(await panel.locator('[data-expedition-player-id]').evaluateAll(els=>els.map(el=>el.dataset.expeditionPlayerId)),expected.players.map(p=>p.id));check('all eleven match the engine expedition lineup');
 assert.deepEqual(await panel.locator('[data-expedition-fitness]').evaluateAll(els=>els.map(el=>Number(el.firstChild.textContent))),expected.players.map(p=>p.fitness));check('all eleven show current fitness alongside overall');
 check('formation and opening mentality/style match expedition',await panel.locator('[data-expedition-formation]').textContent()===expected.formation&&await panel.locator('[data-expedition-tactic]').textContent()==='积极进攻'&&await panel.locator('[data-expedition-style]').textContent()==='两翼齐飞');
 check('panel occupies upper left of map stage',await panel.evaluate(el=>{const p=el.getBoundingClientRect(),m=el.closest('.map-stage').getBoundingClientRect();return p.x-m.x<16&&p.y-m.y<16&&p.width<400;}));
 check('move is the only initial action',await panel.locator('[data-expedition-action]').count()===1&&await move.isEnabled());
 await page.screenshot({path:path.join(out,'desktop.png')});
 await page.keyboard.press('Escape');check('Escape closes panel and restores token focus',await panel.isHidden()&&await token.evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Enter');await panel.waitFor({state:'visible'});check('keyboard activation inspects without moving',!await mode());
 await move.click();check('explicit Move enters target mode and closes inspection',await mode()&&await panel.isHidden());check('entering target mode alone sends no requests',requests.length===0);
 await pickDestination();check('owned territory opens estimate confirmation',requests.at(-1)==='/api/campaign/expedition/estimate');
 check('travel has not begun before confirmation',!requests.includes('/api/campaign/expedition/move'));
 await page.locator('[data-expedition-move-back]').click();check('return allows another destination selection',await mode()&&await page.locator('#expedition-move-confirm').isHidden());
 await token.click();await panel.waitFor({state:'visible'});check('clicking token cancels target mode and opens inspection',!await mode());
 await move.click();await pickDestination();const saved=page.waitForResponse(r=>r.url().endsWith('/api/campaign/expedition/move')&&r.request().method()==='POST');await page.locator('[data-expedition-move-confirm]').click();assert.equal((await saved).status(),200);
 await page.locator('#expedition-movement-widget').waitFor({state:'visible'});check('confirmed travel retains existing movement progress',!await mode());
 await token.click();await panel.waitFor({state:'visible'});check('moving token remains inspectable with Move disabled',await move.isDisabled()&&(await panel.textContent()).includes('行军中'));
 await page.screenshot({path:path.join(out,'moving.png')});
 await panel.locator('[data-expedition-panel-close]').click();const cancelled=page.waitForResponse(r=>r.url().endsWith('/api/campaign/expedition/cancel')&&r.request().method()==='POST');await page.locator('[data-expedition-abort]').click();assert.equal((await cancelled).status(),200);
 await token.click();await panel.waitFor({state:'visible'});check('cancelled travel makes Move available again',await move.isEnabled());
 await page.locator('[data-building-id="art-contour-training"]').click();check('facility inspection replaces expedition panel',await panel.isHidden()&&await page.locator('#training-window').isVisible());
 await page.keyboard.press('Escape');await token.click();await panel.waitFor({state:'visible'});
 // Store updates represent saved tactics and server challenge/account changes without writing test changes to disk.
 await page.evaluate(()=>{const r=window.__expeditionReview,s=structuredClone(r.store.getState());s.tactics.squads.expedition.defenseStyle='highPress';r.store.setState(s,{source:'isolated-review'});});
 await page.evaluate(()=>{const r=window.__expeditionReview,s=structuredClone(r.store.getState()),id=document.querySelector('[data-expedition-player-id]').dataset.expeditionPlayerId;s.draft.roster.find(p=>p.id===id).state.fitness=0;r.store.setState(s,{source:'isolated-fitness-review'});});
 check('open panel refreshes zero fitness without replacing it with full fitness',await panel.locator('[data-expedition-fitness]').first().textContent()==='0');
 check('an open panel refreshes saved expedition tactics',await panel.locator('[data-expedition-style]').textContent()==='高位压迫');
 await page.evaluate(()=>{const r=window.__expeditionReview,s=structuredClone(r.store.getState());s.activeChallengeId='review-only';r.store.setState(s,{source:'isolated-review'});});
 check('challenge update disables Move with explanation',await move.isDisabled()&&(await panel.textContent()).includes('挑战进行中'));
 await page.evaluate(()=>{const r=window.__expeditionReview,s=structuredClone(r.store.getState());s.activeChallengeId=null;r.store.setState(s,{source:'isolated-review'});});
 await page.setViewportSize({width:390,height:844});
 check('mobile panel and pinned action fit screen',await move.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('#expedition-panel').getBoundingClientRect();return r.top>0&&r.bottom<=innerHeight&&p.left>=0&&p.right<=innerWidth;}));
 check('mobile fitness and overall stay inside each player row',await panel.locator('[data-expedition-player-id]').evaluateAll(rows=>rows.every(row=>{const r=row.getBoundingClientRect(),f=row.querySelector('[data-expedition-fitness]').getBoundingClientRect(),rating=row.querySelector('.expedition-player-rating').getBoundingClientRect();return f.right<=r.right&&rating.right<=f.left&&row.scrollWidth<=row.clientWidth;})));
 const last=panel.locator('[data-expedition-player-id]').last();await last.scrollIntoViewIfNeeded();check('all eleven reachable on mobile',await last.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
 await panel.locator('.expedition-panel-roster').evaluate(el=>{el.scrollTop=0;});await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#toast')).opacity)===0);await page.screenshot({path:path.join(out,'mobile.png')});
 const zoom=await page.evaluate(()=>window.__expeditionReview.map.getZoom());await panel.locator('.expedition-panel-roster').hover();await page.mouse.wheel(0,240);await page.waitForTimeout(200);check('scrolling roster does not zoom the map',await page.evaluate(()=>window.__expeditionReview.map.getZoom())===zoom);
 await page.evaluate(()=>{const r=window.__expeditionReview,s=structuredClone(r.store.getState());s.playerId='another-account';r.store.setState(s,{source:'isolated-review'});});check('account changes close inspection',await panel.isHidden());
 check('no browser runtime errors',errors.length===0);
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({passed:checks.length,checks,errors,requests,isolation:'Own temporary full game server and account; no real save modified.'},null,2));console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:error.message,checks,errors},null,2));}throw error;}finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});const resolved=path.resolve(data),parent=path.resolve(os.tmpdir());if(!resolved.startsWith(parent+path.sep)||!path.basename(resolved).startsWith('ydl-expedition-browser-'))throw Error('Unexpected temporary review path');fs.rmSync(resolved,{recursive:true,force:true});}
