import crypto from 'node:crypto';
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
const root=process.cwd(),out=path.join(root,'outputs/scout-elite-fixes-20260909'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-v21-review-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const has=(id,terrain)=>resources.territories[id].terrain.includes(terrain);
const home=process.argv[2]?.includes('scotland')?byId.get('adm1:region-gbr-f9c96ad579'):index.territories.find(t=>t.countryCode==='FRA'&&has(t.territoryId,'plains')&&t.landNeighbors.some(id=>has(id,'hills')||has(id,'mountain'))&&t.landNeighbors.some(id=>has(id,'plains'))&&t.landNeighbors.length>=3);
assert.ok(home);
const hill=home.landNeighbors.find(id=>has(id,'hills')||has(id,'mountain'))??home.landNeighbors[0],plain=home.landNeighbors.find(id=>id!==hill&&has(id,'plains'));
const owned=[home.territoryId,...home.landNeighbors];
const s=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const base=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const pt=catalog.filter(p=>p.nationality==='葡萄牙').slice(0,3);const roster=[...base.filter(p=>p.nationality!=='葡萄牙'),...pt,{...pt[0],id:'pt-duplicate',cardDefinitionId:pt[0].id}];
const actor={id:'wonder-browser',nickname:'奇观验收',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:2000000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'奇观验收',totalPicks:roster.length,roster},resources:{fans:50000}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
const chosen=[];
for(const role of ['GK','LB','RB','CB','CB','DM','AM','LM','ST','ST','RW'])chosen.push(catalog.find(p=>p.role===role&&!p.isX&&!chosen.some(v=>v.id===p.id)));
assert.ok(chosen.every(Boolean));
const reserve=[['GK',1],['DEF',4],['MID',3],['ATT',3]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX&&!chosen.some(v=>v.id===p.id)).slice(0,n));
actor.draft.roster=[...chosen,...reserve];actor.draft.totalPicks=22;
actor.playerSquads={schemaVersion:2,assignments:Object.fromEntries(actor.draft.roster.map(p=>[p.id,chosen.includes(p)?'expedition':'garrison']))};
const coords=[[50,90],[15,62],[85,62],[40,68],[60,68],[40,48],[60,40],[15,44],[40,20],[60,20],[85,20]];
const positions=Object.fromEntries(chosen.map((p,i)=>[p.id,{x:coords[i][0],y:coords[i][1]}]));
const lines={attack:20,midfield:44,defense:68,goalkeeper:90},starters=chosen.map(p=>p.id);
s.saveTactics(actor,{activeSquadId:'expedition',playerSquads:actor.playerSquads,squads:{expedition:{starters,positions,formationLines:lines,planSnapshots:{__s4V2:{starters,positionPresets:{position1:positions,position2:positions,position3:positions},formationLinePresets:{position1:lines,position2:lines,position3:lines}}}}}});

for(const p of actor.draft.roster){p.cardInstanceId=p.id;p.state={...p.state,fitness:23};}
const scoutCenter=s.buildings.createRecord('scout-center');scoutCenter.level=3;s.world.territories[home.territoryId].buildings.push(scoutCenter);
s.scouting.recruit(actor,s.world,{territoryId:home.territoryId,buildingId:scoutCenter.id,count:2,requestId:crypto.randomUUID()});
const winner=structuredClone(actor);winner.id='elite-winner';winner.token='elite-winner-token';winner.draft.teamName='奖励验收';s.accounts.set(winner.id,winner);
const pending=s.eliteChallenges.begin(winner,{clubId:'barcelona',requestId:crypto.randomUUID()});const won=s.eliteChallenges.active(winner);won.leg.match.finished=true;won.leg.match.score=[0,2];won.leg.winnerIndex=1;s.eliteChallenges.settle(winner);const expectedFans=winner.resources.fans;
s.save();fs.mkdirSync(out,{recursive:true});
let child,browser,stdout='',stderr='';const errors=[];
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-elite-review'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-wonder-token'));
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__eliteReview={map,state:()=>campaignState,elite:eliteController,scouts:()=>scoutUnitController};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/game');await page.waitForFunction(()=>window.__eliteReview?.state()?.playerId==='wonder-browser',null,{timeout:60000});
 await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 await page.evaluate(coords=>{window.__eliteReview.map.setView(coords,6.2,{animate:false});},[home.centroid[1],home.centroid[0]]);
 await page.waitForFunction(()=>document.querySelectorAll('.scout-unit-map-icon').length===2);
 await page.evaluate(()=>{const {map,scouts}=window.__eliteReview;scouts().updateZoom();const nodes=[...document.querySelectorAll('.scout-unit-map-icon')];window.__scoutSamples=[];map.on('zoom',()=>window.__scoutSamples.push({zoom:map.getZoom(),same:nodes.every(n=>n.isConnected),points:nodes.map(n=>{const w=parseFloat(n.style.width),h=parseFloat(n.style.height),z=2**map.getZoom();return [(w/2+parseFloat(n.style.marginLeft))/z,(h*.85+parseFloat(n.style.marginTop))/z];})}));});
 await page.mouse.move(160,400);await page.mouse.wheel(0,-340);await page.waitForTimeout(1300);await page.mouse.wheel(0,520);await page.waitForTimeout(1600);await page.mouse.wheel(0,-180);await page.waitForTimeout(1400);
 const zoomSamples=await page.evaluate(()=>window.__scoutSamples);assert.ok(zoomSamples.length>10);assert.ok(zoomSamples.every(s=>s.same));const initial=zoomSamples[0];assert.ok(zoomSamples.every(s=>s.points.every((p,i)=>Math.hypot(p[0]-initial.points[i][0],p[1]-initial.points[i][1])<.0001)),'ground contacts stay fixed throughout inertial zoom');
 fs.writeFileSync(path.join(out,'scout-zoom.json'),JSON.stringify(zoomSamples,null,2));await page.screenshot({path:path.join(out,'scouts-after-zoom.png')});
 await page.locator('#topbar-elite').click();await page.waitForSelector('[data-elite-club]');
 assert.equal(await page.locator('[data-elite-club]').count(),18);assert.equal(await page.locator('.elite-player').count(),0);assert.equal(await page.locator('[data-elite-begin]').count(),0);assert.deepEqual(await page.locator('[data-elite-tier]').evaluateAll(es=>es.map(e=>e.querySelectorAll('[data-elite-club]').length)),[1,6,5,4,2]);await page.waitForFunction(()=>[...document.querySelectorAll('.elite-badge')].length===18&&[...document.querySelectorAll('.elite-badge')].every(i=>i.complete&&i.naturalWidth>0));await page.evaluate(async()=>{await Promise.all([...document.querySelectorAll('.elite-badge')].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'elite-catalog-desktop.png')});
 const bounds=await page.locator('.elite-surface').boundingBox();assert.ok(bounds.width<=1060&&bounds.height<=880);
 const headers={authorization:'Bearer isolated-wonder-token'};
 const info=await (await context.request.get(url+'/api/campaign/elite',{headers})).json();assert.ok(info.elite.clubs.every(c=>c.available));assert.equal(info.elite.rules.fee,5000);assert.equal(info.elite.selected.fans,2000);assert.ok((await page.locator('[data-elite-tier="1"]').innerText()).includes('2,000 球迷'));
 await page.locator('[data-elite-club="barcelona"]').click();await page.waitForFunction(()=>document.querySelector('.elite-heading h3')?.textContent==='巴塞罗那');assert.ok((await page.locator('.elite-rules').innerText()).includes('1600 球迷'));assert.equal(expectedFans,actor.resources.fans+1600);assert.equal(await page.locator('.elite-player').count(),11);assert.equal(await page.locator('[data-elite-club]').count(),0);await page.locator('[data-elite-back]').click();await page.waitForSelector('[data-elite-club]');await page.locator('.elite-catalog').evaluate(e=>e.scrollTop=e.scrollHeight);const catalogScroll=await page.locator('.elite-catalog').evaluate(e=>e.scrollTop);await page.locator('[data-elite-club="tottenham-hotspur"]').click();await page.waitForFunction(()=>document.querySelector('.elite-heading h3')?.textContent==='托特纳姆热刺');await page.locator('[data-elite-back]').click();assert.equal(await page.locator('.elite-catalog').evaluate(e=>e.scrollTop),catalogScroll);await page.locator('[data-elite-club="barcelona"]').click();await page.waitForFunction(()=>document.querySelector('.elite-heading h3')?.textContent==='巴塞罗那');
 await page.waitForFunction(()=>[...document.querySelectorAll('.elite-pitch img')].every(i=>i.complete));await page.evaluate(async()=>{await Promise.all([...document.querySelectorAll('.elite-detail img')].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await page.screenshot({path:path.join(out,'elite-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'elite-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('[data-elite-back]').click();await page.locator('.elite-catalog').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(out,'elite-catalog-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('[data-elite-club="barcelona"]').click();await page.waitForSelector('.elite-player');await page.setViewportSize({width:1600,height:1050});
 const gold=(await (await context.request.get(url+'/api/campaign/state',{headers})).json()).state.wallet.gold;
 const response=page.waitForResponse(r=>r.url().endsWith('/api/campaign/elite/begin')&&r.request().method()==='POST');await page.locator('[data-elite-begin]').click();const started=await (await response).json();assert.ok(started.challengeId,JSON.stringify(started));assert.ok(started.state.wallet.gold>=gold-5000&&started.state.wallet.gold<=gold-4980);assert.equal(readFileSyncLocal().accounts[actor.id].goldLedger.filter(e=>e.reason==='elite-challenge'&&e.delta===-5000).length,1);
 await page.waitForFunction(()=>document.querySelector('#campaign-broadcast:not([hidden])'),null,{timeout:20000});
 await page.screenshot({path:path.join(out,'elite-live.png')});
 const id=started.challengeId;const snap=await (await context.request.get(url+'/api/campaign/elite/match?id='+encodeURIComponent(id),{headers})).json();assert.equal(snap.live.broadcast.teams[0].name,'巴塞罗那');
 // Persisted match keeps the 100-fitness starting copy while the original roster stays tired.
 const saved=readFileSyncLocal();const live=saved.world.eliteChallenges[actor.id];assert.ok(live.leg.away.players.every(p=>p.state.fitness===100));assert.ok(saved.accounts[actor.id].draft.roster.some(p=>p.state.fitness<50));
 const repeat=await context.request.post(url+'/api/campaign/elite/begin',{headers,data:{clubId:'barcelona',requestId:crypto.randomUUID()}});assert.equal(repeat.status(),409);
 const eliteTerritory=s.territoryIndex.territories.find(t=>t.eliteClubIds?.length).territoryId;
 const occupy=await context.request.post(url+'/api/campaign/territory/challenge',{headers,data:{territoryId:eliteTerritory}});assert.ok([403,409].includes(occupy.status()));assert.ok((await occupy.json()).error);
 // Switch to a separate victorious fixture: reward survives restart and only one card is delivered.
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','elite-winner-token'));await page.reload();await page.waitForFunction(()=>window.__eliteReview?.state()?.playerId==='elite-winner',null,{timeout:60000});await page.locator('#topbar-elite').click();await page.waitForSelector('#inventory-window .inventory-choice-card');assert.equal(await page.locator('#inventory-window .inventory-choice-card').count(),3);
 await page.waitForTimeout(1400);await page.screenshot({path:path.join(out,'elite-reward.png')});
 await page.keyboard.press('Escape');await page.waitForSelector('#elite-window:not([hidden]) [data-elite-reward]');await page.locator('[data-elite-watch]').click();await page.locator('#campaign-broadcast:not([hidden])').waitFor();await page.screenshot({path:path.join(out,'elite-report.png')});await page.keyboard.press('Escape');await page.waitForSelector('#inventory-window .inventory-choice-card');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1400);
 for(const card of await page.locator('#inventory-window .inventory-choice-card').all()){
  await card.scrollIntoViewIfNeeded();const box=await card.boundingBox();const stage=await page.locator('#inventory-window .inventory-opening-stage').boundingBox();assert.ok(box.y>=stage.y-1&&box.y+box.height<=stage.y+stage.height+1,'each mobile choice is fully reachable');
 }
 await page.locator('.inventory-choice-grid').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(out,'elite-reward-mobile.png')});await page.setViewportSize({width:1600,height:1050});
 // A failed claim restores all three cards and allows a retry without losing the reward.
 await context.route('**/api/campaign/elite/claim',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'验收：请重试领取'})}),{times:1});
 await page.locator('[data-player-card-action="pack-choice"]').first().click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('请重试领取'));await page.waitForFunction(()=>document.querySelectorAll('.inventory-choice-card.is-dismissed').length===0);assert.equal(await page.locator('.inventory-choice-card').count(),3);
 const choice=page.waitForResponse(r=>r.url().endsWith('/api/campaign/elite/claim')&&r.request().method()==='POST');await page.locator('[data-player-card-action="pack-choice"]').first().dblclick();const claimed=await (await choice).json();assert.ok(claimed.playerId,JSON.stringify(claimed));await page.waitForSelector('.inventory-acquired-card');await page.waitForTimeout(1200);await page.screenshot({path:path.join(out,'elite-acquired.png')});await page.keyboard.press('Escape');await page.waitForSelector('#elite-window:not([hidden])');assert.equal(await page.locator('[data-elite-reward]').count(),0);
 const after=readFileSyncLocal().accounts[winner.id];assert.equal(after.draft.roster.length,23);assert.equal(after.draft.roster.at(-1).upgradeLevel,0);assert.equal(after.resources.fans,expectedFans);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({clubs:info.elite.clubs.map(c=>({name:c.name,formation:c.formation,average:c.average,fans:c.fans})),challengeId:id,rewardPlayer:claimed.playerId,errors,checks:['18 badges in five tiers [1,6,5,4,2]','catalog and detail navigation','back restores list scroll','all badge images load','desktop and mobile','all three mobile reward cards fully reachable','5000 debit','live V2.1 broadcast','full fitness match copy','regular capture blocked','restart retains reward','one base card delivered','wheel zoom keeps both scout ground anchors stable','compact 1060x880 window','shared pack reveal and acquired flow','escape resumes reward','failed claim retry','double click claims once']},null,2));console.log('Elite browser review passed: '+out);
 function readFileSyncLocal(){return JSON.parse(fs.readFileSync(path.join(data,'campaign-accounts.json'),'utf8'));}
}finally{await browser?.close();child?.kill();}
