import {reviewRefactorNavigation} from './lib/refactor-browser-checks.mjs';
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
const refactorReview=process.argv.includes('--refactor');
const root=process.cwd(),out=path.join(root,refactorReview?'outputs/refactor-browser-review':'outputs/training-capacity-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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
// Give the review clubs balanced, explicitly saved 4-3-3 lineups.
for(const a of [actor,second]){
 const players=(await import('../shared/config/representative-players.mjs')).representativePlayers(a.draft.roster);
 const expedition=['GK','DEF','MID','ATT'].flatMap((pool,i)=>players.filter(p=>p.pool===pool).slice(0,[2,8,6,6][i]));
 a.playerSquads={schemaVersion:2,assignments:Object.fromEntries(players.map(p=>[p.id,expedition.includes(p)?'expedition':'garrison']))};
 const {defaultStartingEleven,defaultPositions}=await import('../shared/football/account-match-seat.mjs');
 a.tactics={squads:Object.fromEntries(['expedition','garrison'].map(id=>{const selected=defaultStartingEleven(players.filter(p=>a.playerSquads.assignments[p.id]===id));return [id,{starters:selected.map(p=>p.id),positions:defaultPositions(selected),formation:'4-3-3'}];}))};
 a.leagueRegistration=undefined;s.state(a);
}
trainingBuilding.level=5;
actor.gold=10000000;
for(const pool of ['ATT','MID','DEF','GK']){
 const candidates=actor.draft.roster.filter(p=>p.pool===pool);
 for(let slot=0;slot<Math.min(4,candidates.length);slot++)s.training.start(actor,s.world,{territoryId:home.territoryId,buildingId:trainingBuilding.id,pool,slot,playerId:candidates[slot].id,requestId:'capacity-'+pool+'-'+slot});
}
s.save();
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),actor.token);
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__audit={club:id=>interactionController.open(id),sync:state=>campaignStore.setState(state),team:()=>teamController.open(),training:(v)=>trainingController.open(v),tactics:(v)=>fullTacticsController.open(v),scouting:(v)=>scoutingController.open(v),select:(id)=>selectTerritory(id)};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/game');await page.locator('#server-players:not([hidden])').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});




 const navigation=refactorReview?await reviewRefactorNavigation(page,out):null;
 let reads=0;page.on('request',r=>{if(r.url().includes('/training/center'))reads++;});
 await page.evaluate(value=>window.__audit.training(value),{territoryId:home.territoryId,buildingId:trainingBuilding.id});
 await page.locator('.training-summary').waitFor();
 assert.equal(await page.locator('#training-window [data-training-slot]').count(),20);
 const before=reads;
 for(const size of [{width:1440,height:1000},{width:390,height:844},{width:768,height:1024},{width:780,height:360}]){
  await page.setViewportSize(size);await page.locator('[data-training-filter="all"]').click();
  await page.screenshot({path:path.join(out,'training-'+size.width+'.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('.training-seats').evaluateAll(nodes=>nodes.every(e=>e.scrollHeight<=e.clientHeight+1)),'No nested vertical scrolling');
  await page.locator('[data-training-filter="ATT"]').click();assert.equal(await page.locator('#training-window [data-training-slot]').count(),5);
  await page.screenshot({path:path.join(out,'training-filter-'+size.width+'.png')});
  const upgrade=await page.locator('#training-window [data-facility-upgrade]').boundingBox();assert.ok(upgrade.y>=0&&upgrade.y+upgrade.height<=size.height);
 }
 assert.equal(reads,before,'Filters and resize do not request center');
 await page.locator('[data-training-pool="ATT"][data-training-slot="4"]').click();await page.locator('.training-card-list').waitFor();
 assert.equal(await page.locator('[data-training-player]').count(),24);
 await page.locator('[data-training-player]').first().evaluate(e=>window.__firstPick=e);
 await page.locator('[data-training-more]').click();assert.equal(await page.locator('[data-training-player]').count(),48);
 assert.ok(await page.locator('[data-training-player]').first().evaluate(e=>e===window.__firstPick),'Appending preserves existing player nodes');
 const selected=page.locator('[data-training-player]:not([disabled])').first();
 await selected.click();await page.locator('#training-picker').waitFor({state:'hidden'});
 await page.waitForTimeout(500);assert.equal(reads,before,'Successful start uses returned state without reloading center');
 await page.locator('[data-training-filter="MID"]').click();await page.locator('[data-training-pool="MID"][data-training-slot="4"]').click();await page.locator('[data-training-picker-close]').click();await page.locator('[data-training-filter="ATT"]').click();assert.equal(await page.locator('[data-training-filter="ATT"]').getAttribute('aria-pressed'),'true');
 await page.locator('.training-content').evaluate(e=>{e.scrollTop=80;window.__panelCard=e.querySelector('.training-seat-card');});
 await page.waitForTimeout(6000);assert.ok(await page.evaluate(()=>window.__panelCard===document.querySelector('.training-seat-card')),'Unchanged polling retains card nodes');
 assert.deepEqual(errors,[]);const result={passed:true,reads,errors,viewports:[1440,390,768,780],seats:20,navigation};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
