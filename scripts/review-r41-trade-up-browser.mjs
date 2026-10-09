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
const root=process.cwd(),out=path.join(root,'outputs/r41-trade-up-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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




 await page.setViewportSize({width:1440,height:900});
 const material=catalog.find(p=>p.grade==='C'&&!p.isX&&s.cardManagement.pool([p,p,p,p,p]).candidates.length);
 for(let i=0;i<90;i++)s.cardManagement.receive(actor,createPlayerCardInstance(material,0));s.persist();
 await page.evaluate(state=>window.__audit.sync(state),s.state(actor));
 const requests=[];page.on('request',r=>{if(r.url().includes('/api/campaign/cards')||r.url().includes('/api/campaign/state'))requests.push({method:r.method(),path:new URL(r.url()).pathname});});
 await page.locator('#topbar-card-management').click();await page.locator('[data-cm-screen="trade-up"]').click();await page.locator('[data-cmu-filter="grade"]').selectOption('C');
 await page.locator('[data-cmu-select]').first().waitFor();
 const report=[];
 for(let run=0;run<2;run++){
  const scroll=page.locator('[data-cmu-scroll]');
  await scroll.evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
  await page.waitForFunction(()=>document.querySelectorAll('[data-cmu-grid] [data-cmu-select]').length>24);
  const ids=await page.locator('[data-cmu-select]:not([disabled])').evaluateAll(es=>es.slice(0,5).map(e=>e.dataset.cmuSelect));assert.equal(ids.length,5);
  for(const id of ids)await page.locator(`[data-cmu-select="${id}"]`).evaluate(e=>e.click());
  await scroll.evaluate(e=>e.scrollTop=350);
  await page.locator('[data-cmu-action="preview"]').click();await page.locator('[data-cm-confirm]').waitFor();
  const before=requests.length,visibleBefore=await page.locator('[data-cmu-grid] [data-cmu-select]').count(),top=await scroll.evaluate(e=>e.scrollTop);
  await page.evaluate(ids=>{window.__unchangedCard=[...document.querySelectorAll('[data-cmu-grid] article')].find(e=>!ids.includes(e.dataset.uiKey));},ids);
  const responsePromise=page.waitForResponse(r=>r.url().includes('/cards/trade-up')&&r.request().method()==='POST');await page.locator('[data-cm-confirm]').click();const response=await responsePromise,body=await response.json();assert.equal(response.status(),200);assert.ok(body.cardDelta);assert.equal(body.cardDelta.cards.length,1);assert.equal(body.state,undefined);assert.equal(body.view,undefined);
  await page.locator('.cm-dialog #cm-dialog-title').filter({hasText:'汰换完成'}).waitFor();if(await page.getByRole('button',{name:'跳过动画',exact:true}).count())await page.getByRole('button',{name:'跳过动画',exact:true}).click();await page.locator('.cm-dialog [data-cm-dialog-close]').last().click();await page.locator('.cm-dialog').waitFor({state:'detached'});
  assert.equal(await scroll.evaluate(e=>e.scrollTop),top);assert.equal(await page.locator('[data-cmu-filter="grade"]').inputValue(),'C');assert.ok(await page.locator('[data-cmu-grid] [data-cmu-select]').count()>=visibleBefore-5);
  assert.ok(await page.evaluate(()=>window.__unchangedCard.isConnected),'unchanged card DOM is reused');
  assert.equal(requests.slice(before).filter(r=>r.method==='GET').length,0,'no full warehouse or state reload');
  for(const id of ids)assert.equal(await page.locator(`[data-cmu-select="${id}"]`).count(),0);
  report.push({run:run+1,responseBytes:Buffer.byteLength(JSON.stringify(body)),visibleBefore,scrollTop:top,followupReads:0,unchangedCardReused:true});
 }
 await page.screenshot({path:path.join(out,'warehouse-after-two-trades.png'),scale:'css'});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,report,errors},null,2));console.log(JSON.stringify({passed:true,report,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
