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
const root=process.cwd(),out=path.join(root,'outputs/unit-badge-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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
const roles=['GK','LB','CB','CB','RB','DM','AM','AM','LW','RW','ST'];
const roster=[];for(let group=0;group<4;group++)for(const role of roles){const p=catalog.find(p=>p.role===role&&!p.isX&&!roster.some(q=>q.id===p.id));assert.ok(p);roster.push(p);}
const actor={id:'wonder-browser',nickname:'黄狗经理',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:100000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'黄狗俱乐部',totalPicks:roster.length,roster},resources:{fans:50000}};
actor.playerSquads={schemaVersion:2,assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))};actor.tactics={squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
const trainingBuilding=s.buildings.createRecord('training-center');s.world.territories[hill].buildings.push(trainingBuilding);s.save();

const remote=index.territories.find(t=>t.countryCode==='GBR'&&t.spawnAllowed&&!t.eliteClubIds?.length);
const second=structuredClone(actor);Object.assign(second,{id:'social-rival',nickname:'北海经理',token:'isolated-rival-token',homeTerritoryId:remote.territoryId,mapColor:'#cf806b'});second.draft.teamName='北海联队';
second.draft.roster=second.draft.roster.map(p=>({...p,id:'rival:'+p.id,playerId:'rival:'+p.id,cardDefinitionId:p.cardDefinitionId??p.id,cardInstanceId:'rival:'+p.id}));
second.playerSquads={schemaVersion:2,assignments:Object.fromEntries(second.draft.roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))};second.tactics={squads:{expedition:{starters:second.draft.roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};
s.accounts.set(second.id,second);s.world.players[second.id]={playerId:second.id,territoryIds:[remote.territoryId,hill],capitalTerritoryId:remote.territoryId};
s.world.players[actor.id].territoryIds=s.world.players[actor.id].territoryIds.filter(id=>id!==hill);
Object.assign(s.world.territories[hill],{ownerType:'player',ownerId:second.id,capitalOf:null,buildings:[]});Object.assign(s.world.territories[remote.territoryId],{ownerType:'player',ownerId:second.id,capitalOf:second.id,buildings:[]});s.buildings.ensureCapitalStadium(second,s.world,remote.territoryId);
for(const [i,title]of ['南方星辰','港湾竞技','高原之光','新月俱乐部'].entries()){const a={id:'social-observer-'+i,nickname:'经理'+i,token:'observer-'+i,setupComplete:false,gold:1000,draft:{teamName:title,roster:[]}};s.accounts.set(a.id,a);}
s.state(actor);s.state(second);s.save();
const scoutCenter=s.buildings.createRecord('scout-center');s.world.territories[home.territoryId].buildings.push(scoutCenter);
const hired=s.scouting.recruit(actor,s.world,{territoryId:home.territoryId,buildingId:scoutCenter.id,count:1,requestId:'browser-recruit'});
const work=s.buildings.createRecord('training-center',{status:'constructing',constructionStartedAt:clock,completesAt:clock+3600000});s.world.territories[hill].buildings.push(work);s.save();
const beforeAlliance=s.publicWorld(actor).territories[hill]?.buildings.find(x=>x.id===work.id);assert.ok(beforeAlliance?.progressHidden);assert.equal(beforeAlliance.completesAt,undefined);
const recovery=s.buildings.createRecord('recovery-center');s.world.territories[hill].buildings.push(recovery);s.save();

// All records below belong to this process's isolated temporary save.
second.expeditionPiece.territoryId=hill;second.expeditionPiece.movement=null;
second.scouting={schemaVersion:2,units:{visitor:{id:'visitor',name:'Oliver Bennett',territoryId:hill,originTerritoryId:hill}},tasks:{},recruitRequests:{}};
Object.assign(s.world.territories[plain],{ownerType:'neutral',ownerId:null});s.world.players[actor.id].territoryIds=s.world.players[actor.id].territoryIds.filter(id=>id!==plain);
const ownRecovery=s.buildings.createRecord('recovery-center');s.world.territories[home.territoryId].buildings.push(ownRecovery);
s.playerPacks.addPacks(actor,'legendary-player-pack',1);s.playerPacks.open(actor,'legendary-player-pack');s.save();

const errors=[],checks=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};fs.mkdirSync(out,{recursive:true});
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),actor.token);
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__review={state:()=>campaignState,apply:state=>campaignStore.setState(state),map,point:sourcePointToDisplay};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/game');await page.waitForFunction(()=>window.__review&&document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
 await page.evaluate(()=>{const r=window.__review;r.map.setView(r.state().world.units[0].position,7,{animate:false});});
 await page.waitForFunction(()=>document.querySelectorAll('.foreign-map-token .map-unit-team-badge:not(.is-compact)').length===2);
 check('foreign units have filled team shields',await page.locator('.foreign-map-token .map-unit-team-badge').evaluateAll(nodes=>nodes.length===2&&nodes.every(n=>n.style.getPropertyValue('--unit-color')==='#cf806b')));
 check('both unit kinds have distinct symbols',await page.locator('.foreign-map-token [data-unit-kind="scout"]').count()===1&&await page.locator('.foreign-map-token [data-unit-kind="expedition"]').count()===1);
 check('own units have self marker',await page.locator('.scout-map-token .map-unit-team-self').count()===1&&await page.locator('.expedition-piece-token .map-unit-team-self').count()===1);
 check('old ground rings are gone',await page.locator('.map-unit-color-base').count()===0);
 await page.mouse.move(1500,700);check('team names do not clutter idle units',await page.locator('.map-unit-team-name').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).visibility==='hidden')));
 await page.waitForTimeout(700);await page.screenshot({path:path.join(out,'team-shields-desktop.jpg'),quality:75});
 await page.locator('.foreign-map-token').first().hover();check('hover reveals full team and unit name',await page.locator('.foreign-map-token').first().locator('.map-unit-team-name').evaluate(n=>getComputedStyle(n).visibility==='visible'&&n.textContent.includes('北海联队')));
 await page.screenshot({path:path.join(out,'team-shields-hover.jpg'),quality:75});
 await page.mouse.move(1500,700);await page.evaluate(()=>{window.__review.map.setZoom(5,{animate:false});});await page.waitForFunction(()=>document.querySelectorAll('.foreign-map-token .is-compact').length===2,null,{timeout:5000});
 check('overview uses compact shields',await page.locator('.foreign-map-token .map-unit-team-badge').first().evaluate(n=>n.getBoundingClientRect().width<=21));await page.screenshot({path:path.join(out,'team-shields-overview.jpg'),quality:70});
 second.expeditionPiece.territoryId=remote.territoryId;second.scouting.units.visitor.territoryId=remote.territoryId;await page.evaluate(state=>window.__review.apply(state),s.state(actor));await page.waitForFunction(()=>document.querySelectorAll('.foreign-map-token').length===0);
 check('units still disappear outside current fog',true);check('no browser errors',errors.length===0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
