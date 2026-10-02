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
import {createPlayerCardInstance} from '../server/domain/player-card-instance.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const require=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM ?? path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'));
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/league-registration-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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
actor.draft.roster.push(...roster.slice(0,16).map(p=>createPlayerCardInstance(p,1)));
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
const reps=(await import('../shared/config/representative-players.mjs')).representativePlayers(actor.draft.roster);actor.playerSquads={schemaVersion:2,assignments:Object.fromEntries(reps.map((p,i)=>[p.id,i<22?'expedition':'garrison']))};s.state(actor);s.save();
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:780,height:360},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),actor.token);
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__audit={sync:state=>campaignStore.setState(state),team:()=>teamController.open(),training:(v)=>trainingController.open(v),tactics:(v)=>fullTacticsController.open(v),scouting:(v)=>scoutingController.open(v),select:(id)=>selectTerritory(id)};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/game');await page.locator('#server-players:not([hidden])').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});



 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/league/registration'))writes++;});
 const dragChecks=[];
 async function assertGhost(anchor){await page.waitForFunction(()=>document.querySelector('.team-transfer-ghost .s4-player-card'));assert.equal(await page.evaluate(()=>String(window.getSelection())), '');assert.ok(await page.locator('html.team-card-drag-active').count());
  if(anchor){await page.waitForFunction(a=>{const r=document.querySelector('.team-transfer-ghost')?.getBoundingClientRect();return r&&Math.abs(r.left-a.left)<1&&Math.abs(r.top-a.top)<1&&Math.abs(r.width-a.width)<1&&Math.abs(r.height-a.height)<1;},anchor);const r=await page.locator('.team-transfer-ghost').boundingBox();dragChecks.push({viewport:page.viewportSize(),maxError:Math.max(Math.abs(r.x-anchor.left),Math.abs(r.y-anchor.top),Math.abs(r.width-anchor.width),Math.abs(r.height-anchor.height))});}
 }
 async function drag(source,target,touch){await source.scrollIntoViewIfNeeded();const sourceRect=await source.evaluate(e=>{const r=e.closest('.team-batch-card').querySelector('.s4-player-card').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});const a=await source.boundingBox(),b=await target.boundingBox(),start={x:a.x+a.width*.35,y:a.y+a.height*.3},end={x:b.x+b.width/2,y:b.y+Math.min(70,b.height/2)};const anchor=point=>({left:point.x-start.x+sourceRect.x,top:point.y-start.y+sourceRect.y,width:sourceRect.width,height:sourceRect.height});
  if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*n/8,y:start.y+(end.y-start.y)*n/8,id:1}]});await assertGhost(anchor(end));await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.mouse.move(start.x,start.y);await page.mouse.down();const edge={x:2,y:2};await page.mouse.move(edge.x,edge.y,{steps:4});await assertGhost(anchor(edge));await page.mouse.move(end.x,end.y,{steps:8});await assertGhost(anchor(end));await page.screenshot({path:path.join(out,'drag-card.png'),scale:'css'});await page.mouse.up();}await page.waitForTimeout(450);assert.equal(await page.locator('.team-transfer-ghost,html.team-card-drag-active,.is-transfer-dragging').count(),0);
 }
 for(const size of [{width:1440,height:900},{width:390,height:844},{width:780,height:360},{width:768,height:1024}]){
  await page.setViewportSize(size);await page.evaluate(()=>window.__audit.team());await page.locator('[data-team-mode="league"]').waitFor();await page.screenshot({path:path.join(out,`${size.width}-menu.png`),scale:'css'});
  await page.locator('[data-team-mode="batch"]').click();await page.locator('[data-batch-row]').first().waitFor();
  const source=page.locator('[data-batch-column="garrison"] [data-batch-row]').first(),id=await source.getAttribute('data-batch-row');
  await drag(size.width<1000?source.locator('[data-card-drag]'):source.locator('.s4-player-card'),page.locator('[data-batch-column="expedition"]'),size.width<1000);
  assert.equal(await page.locator(`[data-batch-column="expedition"] [data-batch-row="${id}"]`).count(),1);
  await page.locator('[data-batch-undo]').click();assert.equal(await page.locator(`[data-batch-column="garrison"] [data-batch-row="${id}"]`).count(),1);
  await page.screenshot({path:path.join(out,`${size.width}-batch.png`),scale:'css'});await page.locator('[data-team-back]').click();
  await page.locator('[data-team-mode="league"]').click();await page.locator('[data-registration-card]').first().waitFor();
  const all=page.locator('[data-registration-column="all"]'),registered=page.locator('[data-registration-column="registered"]'),initial=[...actor.leagueRegistration.playerIds],before=writes;
  assert.ok((await all.locator('[data-registration-card]').count())<=36,'first batch bounded');
  await all.locator('[data-registration-select-all]').click();
  assert.match(await page.locator('.team-batch-selection').innerText(),new RegExp('已选 '+(reps.length-initial.length)+' 人'),'select all includes unloaded cards');
  await page.locator('[data-registration-clear]').click();
  while(await page.locator('[data-registration-more]').count())await page.locator('[data-registration-more]').click();
  assert.equal(await all.locator('[data-registration-card]').count(),reps.length-initial.length,'all batches exclude registered families');
  const candidate=(await all.locator('[data-registration-card]').evaluateAll(es=>es.map(e=>e.dataset.registrationCard))).find(id=>!initial.includes(id));
  await drag(all.locator(`[data-registration-card="${candidate}"] [data-card-drag]`),registered,size.width<1000);
  assert.equal(await registered.locator(`[data-registration-card="${candidate}"]`).count(),1);assert.equal(writes,before,'drag must remain local');assert.equal(await all.locator(`[data-registration-card="${candidate}"]`).count(),0,'added card leaves available column');
  if(size.width===1440){
   const handle=all.locator('[data-card-drag]').first();await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
   for(const event of ['pointercancel','blur']){await page.mouse.move(box.x+8,box.y+8);await page.mouse.down();await page.mouse.move(box.x+30,box.y+30);await assertGhost();await page.evaluate(type=>window.dispatchEvent(type==='blur'?new Event(type):new PointerEvent(type,{pointerId:1})),event);await page.mouse.up();assert.equal(await page.locator('.team-transfer-ghost,html.team-card-drag-active,.is-transfer-dragging').count(),0);}
   const input=page.locator('[data-registration-filter="search"]');if(await input.count()){await input.fill('zzzz-no-player-match');assert.equal(await all.locator('[data-registration-card]').count(),0);assert.equal(await registered.locator('[data-registration-card]').count(),initial.length+1,'search does not hide registered cards');await input.fill('test');assert.equal(await input.evaluate(n=>{n.select();return n.selectionEnd-n.selectionStart;}),4);await input.fill('');}
  }
  await page.locator('[data-registration-save]').click();await page.waitForFunction(()=>document.querySelector('[data-registration-save]')?.disabled);assert.equal(writes,before+1);assert.ok(actor.leagueRegistration.playerIds.includes(candidate));
  await registered.locator(`[data-registration-select="${candidate}"]`).check();await page.locator('[data-registration-remove]').click();assert.equal(await registered.locator(`[data-registration-card="${candidate}"]`).count(),0);assert.equal(await all.locator(`[data-registration-card="${candidate}"]`).count(),1,'removed card returns to available column');
  await page.locator('[data-registration-save]').click();await page.waitForFunction(()=>document.querySelector('[data-registration-save]')?.disabled);
  await page.locator('[data-registration-filter="position"]').selectOption('GK');assert.ok((await all.locator('[data-registration-card]').count())<reps.length);assert.equal(await registered.locator('[data-registration-card]').count(),initial.length,'position filter only affects available cards');await page.locator('[data-registration-filter="position"]').selectOption('');
  for(const key of ['club','nationality']){const filter=page.locator(`[data-registration-filter="${key}"]`),value=await filter.locator('option').nth(1).getAttribute('value');await filter.selectOption(value);assert.equal(await registered.locator('[data-registration-card]').count(),initial.length,key+' does not filter registered cards');await filter.selectOption('');}
  await drag(registered.locator('[data-registration-card]').first().locator('[data-card-drag]'),all,size.width<1000);assert.equal(await registered.locator('[data-registration-card]').count(),initial.length-1);assert.equal(await all.locator('[data-registration-card]').count(),Math.min(36,reps.length-initial.length+1));await page.locator('[data-registration-reset]').click();
  await page.screenshot({path:path.join(out,`${size.width}-registration.png`),scale:'css'});
  for(const column of [all,registered]){const b=await column.boundingBox();assert.ok(b.width>100&&b.height>80);}
  const local=actor.draft.roster.find(p=>initial.includes(p.id));actor.leagueRegistration.conditions[local.id]={state:{fitness:42},at:clock};local.state={...local.state,fitness:87};s.persist();
  await page.evaluate(state=>window.__audit.sync(state),s.state(actor));await page.evaluate(()=>window.__audit.tactics({squadId:'league'}));await page.locator('[data-lineup-squad="league"]').waitFor({state:'attached'});
  const bar=page.locator(`[data-league-magnet="${local.id}"] [data-magnet-fitness]`);await bar.waitFor();assert.equal(Number(await bar.getAttribute('data-magnet-fitness')),42);
  if(size.width===1440){
   const old=structuredClone(actor.tactics);await page.locator('[data-fitness-threshold]').fill('72');await page.locator('[data-fitness-threshold]').dispatchEvent('change');
   await page.waitForFunction(()=>document.querySelector('[data-league-autosave-label]')?.textContent==='已自动保存');assert.equal(actor.leagueRegistration.tactics.planSnapshots.__s4V2.fitnessThreshold,72);assert.deepEqual(actor.tactics,old);
  }
  await page.screenshot({path:path.join(out,`${size.width}-tactics.png`),scale:'css'});report.push({size,registrationWrites:writes-before,uniqueCards:reps.length});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({report,dragChecks,errors},null,2));console.log(JSON.stringify({report,dragChecks,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
