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
const root=process.cwd(),out=path.join(root,'outputs/interactions-profile-20260909'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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
const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
fs.mkdirSync(out,{recursive:true});
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser,pageA,pageB;
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const open=async token=>{const context=await browser.newContext({viewport:{width:1920,height:1080}});await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),token);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/game');await page.locator('#server-players:not([hidden])').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});return page;};
 pageA=await open(actor.token);pageB=await open(second.token);
 const rootA=pageA.locator('#interaction-window'),rootB=pageB.locator('#interaction-window');
 const click=async(page,selector)=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/campaign/interactions')&&r.request().method()==='POST'&&JSON.parse(r.request().postData()).action!=='read');await page.locator(selector).click();const r=await response;const body=await r.json();assert.equal(r.status(),200,JSON.stringify(body));return body;};
 const respond=(page,id)=>click(page,`[data-interaction-response="accept"][data-proposal="${id}"]`);
 const waitEnabled=async(page,selector)=>{await page.locator(selector).waitFor();await page.waitForFunction(selector=>!document.querySelector(selector)?.disabled,selector);};
 check('server player list includes six accounts',await pageA.locator('#server-players [data-interaction-player]').count()===6);
 await pageA.screenshot({path:path.join(out,'server-players-desktop.png')});
 await pageA.locator(`#server-players [data-interaction-player="${second.id}"]`).click();await rootA.getByText('总部位置尚未向你开放',{exact:true}).waitFor();
 check('unapproved headquarters remains hidden',s.diplomacy.details(actor,second.id).location===null);
 const box=await rootA.locator('.interaction-surface').boundingBox();
 check('profile uses compact width instead of standard 1600px',box.width<=1080&&box.width>=900);
 check('profile height fits content and leaves map visible',box.height<1000);
 check('profile shows eleven real expedition cards',await rootA.locator('.interaction-player').count()===11);
 await pageA.waitForFunction(()=>[...document.querySelectorAll('.interaction-player img[data-player-card-art]')].length===11&&[...document.querySelectorAll('.interaction-player img[data-player-card-art]')].every(img=>img.complete&&img.naturalWidth>0));
 check('all eleven card portraits load',true);
 await rootA.locator('.interaction-player img[data-player-card-art]').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));await pageA.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await pageA.screenshot({path:path.join(out,'profile-desktop.png')});

 await pageA.setViewportSize({width:390,height:844});await rootA.locator('.interaction-scroll').evaluate(el=>el.scrollTop=0);await pageA.screenshot({path:path.join(out,'profile-mobile.png')});
}catch(e){if(pageA)await pageA.screenshot({path:path.join(out,'failure-a.png')}).catch(()=>{});if(pageB)await pageB.screenshot({path:path.join(out,'failure-b.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:e.stack,checks,errors},null,2));throw e;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(data,{recursive:true,force:true});}
