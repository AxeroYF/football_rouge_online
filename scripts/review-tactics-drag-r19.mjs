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
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/tactics-drag-r19'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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
const expeditionIds=new Set([['GK',1],['DEF',4],['MID',3],['ATT',3]].flatMap(([pool,n])=>actor.draft.roster.filter(p=>p.pool===pool).slice(0,n).map(p=>p.id)));
actor.playerSquads={schemaVersion:2,assignments:Object.fromEntries(actor.draft.roster.map(p=>[p.id,expeditionIds.has(p.id)?'expedition':'garrison']))};
s.world.territories[home.territoryId].buildings.push(trainingBuilding);
const scoutBuilding=s.buildings.createRecord('scout-center');s.world.territories[home.territoryId].buildings.push(scoutBuilding);s.save();
actor.tactics={...(actor.tactics??{}),activeSquadId:'garrison'};s.save();
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:780,height:360}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),actor.token);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/versus/?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 if(mobile)await page.locator('#mobile-menu-toggle').click();await page.locator('.primary-nav button:nth-child(3)').click();
 if(mobile)await page.locator('[data-mobile-tactics-tab="controls"]').click();
 await page.waitForTimeout(500);if(await page.locator('[data-lineup-squad="garrison"]').getAttribute('aria-pressed')!=='true')await page.locator('[data-lineup-squad="garrison"]').click();await page.locator('[data-lineup-squad="garrison"].active').waitFor();
 if(mobile)await page.locator('[data-mobile-tactics-tab="lineup"]').click();await page.waitForTimeout(200);
 const bench=page.locator('.bench-magnet-list');await bench.evaluate(e=>e.scrollTop=200);const scroll=await bench.evaluate(e=>e.scrollTop);console.log('BENCH',mobile,await bench.evaluate(e=>({height:e.clientHeight,full:e.scrollHeight,count:e.children.length}))); assert.ok(scroll>0,'fixture has scrollable bench');
 const line=page.locator('[data-formation-line="midfield"]');const old=parseFloat(await line.evaluate(e=>e.style.top));
 const hit=await line.evaluate(e=>{const r=e.getBoundingClientRect();for(let x=r.x+3;x<r.right-3;x+=4){const el=document.elementFromPoint(x,r.y+r.height/2);if(el===e||e.contains(el))return{x,y:r.y+r.height/2};}throw Error('Line has no reachable point');});
 const pitch=await page.locator('#league-tactics-pitch').boundingBox();const delta=Math.max(16,pitch.height*.035);
 const saved=page.waitForResponse(r=>r.url().includes('/api/campaign/tactics')&&r.request().method()==='POST'&&r.status()===200);
 if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hit.x,y:hit.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:hit.x,y:hit.y+delta}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else {await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.mouse.move(hit.x,hit.y+delta,{steps:6});await page.mouse.up();}
 await page.waitForTimeout(700);console.log("LINE",mobile,await line.evaluate(e=>e.style.top),await page.locator("[data-league-autosave-status]").innerText());await saved;await page.waitForTimeout(250);const next=parseFloat(await line.evaluate(e=>e.style.top));assert.ok(Math.abs(next-old)>1,'line moves and persists');assert.ok(Math.abs(await bench.evaluate(e=>e.scrollTop)-scroll)<=1,'line render retains bench');
 const player=page.locator('[data-league-magnet]').nth(5);const before=await player.evaluate(e=>e.style.left);const r=await player.evaluate(e=>{const r=e.getBoundingClientRect();for(let y=r.y+3;y<r.bottom-3;y+=3)for(let x=r.x+3;x<r.right-3;x+=3){const t=document.elementFromPoint(x,y);if(t&&e.contains(t)&&!t.closest('[data-duty-step]'))return{x,y,width:0,height:0};}throw Error('no player drag point');});const playerSave=page.waitForResponse(r=>r.url().includes('/api/campaign/tactics')&&r.request().method()==='POST'&&r.status()===200);
 const endX=r.x+Math.max(24,pitch.width*.12);
 if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x,y:r.y}]});await page.waitForTimeout(50);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:endX,y:r.y}]});await page.waitForTimeout(50);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await page.mouse.move(r.x,r.y);await page.mouse.down();await page.mouse.move(endX,r.y,{steps:6});await page.mouse.up();}
 await playerSave;await page.waitForTimeout(250);
 assert.notEqual(await player.evaluate(e=>e.style.left),before,'player moved');assert.ok(Math.abs(await bench.evaluate(e=>e.scrollTop)-scroll)<=1,'player render retains bench');
 await page.screenshot({path:path.join(out,mobile?'touch.png':'desktop.png'),scale:'css'});
 report.push({mobile,lineBefore:old,lineAfter:next,benchScrollBefore:scroll,benchScrollAfter:await bench.evaluate(e=>e.scrollTop),saveResponse:200});
 await context.close();
 }
 assert.equal(errors.length,0);console.log(JSON.stringify({report,errors}));
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({report,errors},null,2));await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
