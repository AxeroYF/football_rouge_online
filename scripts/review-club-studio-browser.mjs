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
const root=process.cwd(),out=path.join(root,'outputs/club-studio-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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




 let posts=0,backgroundPresence=0;const posted=[];page.on('request',r=>{if(r.method()==='POST'){if(r.url().endsWith('/api/campaign/raids')&&r.postDataJSON()?.action==='presence'){backgroundPresence++;return;}posts++;posted.push({url:r.url(),body:r.postDataJSON()});}});
 await page.evaluate(id=>window.__audit.club(id),'social-rival');
 await page.locator('#interaction-club-name').waitFor();
 await page.locator('[data-interaction-action="cards-load"]').first().click();
 await page.locator('.club-card-gallery article').first().waitFor();
 await page.waitForTimeout(700);await page.locator('.interaction-scroll').evaluate(e=>e.scrollTop=0);
 await page.screenshot({path:path.join(out,'club-desktop.png')});
 assert.equal(await page.locator('.club-lineup-stage .s4-player-card').count(),11);
 await page.locator('.club-secondary-actions summary').click();await page.locator('[data-interaction-action="friendship"]').waitFor({state:'visible'});await page.locator('.club-secondary-actions summary').click();
 for(const size of [{width:768,height:1024},{width:780,height:360}]){await page.setViewportSize(size);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'club-'+size.width+'.png')});}

 await page.setViewportSize({width:390,height:844});await page.locator('.interaction-scroll').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(out,'club-mobile.png')});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('[data-interaction-action="trade-form"]').click();await page.locator('[data-trade-gold="give"]').waitFor();await page.locator('[data-interaction-action="trade-close"]').click();
 await page.locator('#interaction-window [data-stage-window-close]').first().click();
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(id=>window.__audit.club(id),'wonder-browser');
 await page.locator('[data-club-share]').waitFor();await page.screenshot({path:path.join(out,'own-club.png')});
 const beforeExportPosts=posts;
 await page.locator('[data-club-share]').click();await page.locator('.roster-poster-page .s4-player-card').first().waitFor();
 await page.locator('[name="title"]').fill('为这十一人，全力以赴');
 const exportPng=async name=>{const before=posts;
  await page.locator('[data-poster-generate]').click();
  await page.locator('[data-poster-save]:not([hidden])').waitFor({timeout:60000});
  const status=await page.locator('.poster-status').innerText();assert.ok(!status.includes('未加载'),status);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-poster-save]').click()]);
  await download.saveAs(path.join(out,name+'.png'));
  const buffer=fs.readFileSync(path.join(out,name+'.png'));assert.equal(buffer.subarray(1,4).toString(),'PNG');
  assert.equal(posts,before,'PNG generation must not send mutations');
  report.push({name,bytes:buffer.length,width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),cards:await page.locator('.roster-poster-page .s4-player-card').count()});
 };
 assert.equal(await page.locator('.roster-poster-page .s4-player-card').count(),11);
 await exportPng('lineup-export');
 await page.locator('[name="mode"]').selectOption('roster');await page.locator('[name="title"]').fill('我们的远征军');await exportPng('roster-export');await page.locator('[name=theme]').selectOption('silver');await exportPng('silver-roster-export');
 await page.locator('[data-poster-next]').click();assert.equal(await page.locator('.roster-poster-page .s4-player-card').count(),2);
 await page.locator('[name="squad"]').selectOption('garrison');assert.ok(await page.locator('.roster-poster-page .s4-player-card').count()<=20);
 await page.locator('[name="squad"]').selectOption('league');await page.locator('[name="mode"]').selectOption('lineup');assert.equal(await page.locator('.roster-poster-page .s4-player-card').count(),11);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'poster-mobile-preview.png')});
 await exportPng('league-mobile-export');
 for(const size of [{width:768,height:1024},{width:780,height:360}]){await page.setViewportSize(size);const rect=await page.locator('[data-poster-generate]').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=size.height);}
 await page.locator('[data-poster-close]').click();assert.equal(await page.locator('.roster-poster-dialog').count(),0);
 assert.deepEqual(errors,[]);assert.equal(posts,0,JSON.stringify(posted));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({report,posts,backgroundPresence,posted,errors},null,2));console.log(JSON.stringify({report,posts,backgroundPresence,posted,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
