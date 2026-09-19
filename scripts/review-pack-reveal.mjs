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
const root=process.cwd(),out=path.join(root,'outputs/pack-reveal-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-wonder-live-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const has=(id,terrain)=>resources.territories[id].terrain.includes(terrain);
const home=index.territories.find(t=>t.countryCode==='FRA'&&has(t.territoryId,'plains')&&t.landNeighbors.some(id=>has(id,'hills')||has(id,'mountain'))&&t.landNeighbors.some(id=>has(id,'plains'))&&t.landNeighbors.length>=3);
assert.ok(home);
const hill=home.landNeighbors.find(id=>has(id,'hills')||has(id,'mountain')),plain=home.landNeighbors.find(id=>id!==hill&&has(id,'plains'));
const owned=[home.territoryId,...home.landNeighbors];
const s=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const base=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const pt=catalog.filter(p=>p.nationality==='葡萄牙').slice(0,3);const roster=[...base.filter(p=>p.nationality!=='葡萄牙'),...pt,{...pt[0],id:'pt-duplicate',cardDefinitionId:pt[0].id}];
const actor={id:'wonder-browser',nickname:'奇观验收',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:100000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'奇观验收',totalPicks:roster.length,roster},resources:{fans:50000}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
const built=id=>({id:'fixture-'+id,type:'wonder:'+id,wonderId:id,level:1,status:'active',builtAt:Date.now(),wonderActivatedAt:Date.now()});
 s.world.territories[hill].buildings.push(built('christ-the-redeemer'));
 const other={...structuredClone(actor),id:'other-owner',nickname:'模型测试对手',token:'other-private-token',homeTerritoryId:plain,draft:{...actor.draft,teamName:'另一家俱乐部'}};
 s.accounts.set(other.id,other);s.world.players[actor.id].territoryIds=owned.filter(id=>id!==plain);s.world.players[other.id]={playerId:other.id,territoryIds:[plain],capitalTerritoryId:plain};s.world.territories[plain].ownerId=other.id;s.world.territories[plain].capitalOf=other.id;s.world.territories[plain].buildings.push(built('christ-the-redeemer'));
 s.world.territories[home.territoryId].buildings.push({id:'fixture-eiffel',type:'wonder:eiffel-tower',wonderId:'eiffel-tower',level:1,status:'constructing',buildMethod:'production',constructionRequirements:{totalProduction:100000,adjacentBuildings:[],terrain:{anyOf:[],allOf:[]},playerCollection:null},productionWork:{required:6000000000,completed:1200000000,updatedAt:Date.now(),ownerId:actor.id},constructionStartedAt:Date.now()});
 const hiddenProject=structuredClone(s.world.territories[home.territoryId].buildings.find(b=>b.wonderId==='eiffel-tower'));Object.assign(hiddenProject,{id:'hidden-rival-project',type:'wonder:colosseum',wonderId:'colosseum'});hiddenProject.productionWork.ownerId=other.id;s.world.territories[plain].buildings.push(hiddenProject);s.save();
s.playerPacks.addPacks(actor,'legendary-player-pack',2);const beckham=catalog.find(p=>p.name?.includes('贝克汉姆')&&!p.isX)||catalog[0];actor.draft.roster=actor.draft.roster.filter(p=>p.id!==beckham.id);actor.inventory.pendingOpening={id:'pack-reveal-fixture',packType:'legendary-player-pack',openedAt:Date.now(),candidateIds:[beckham.id,...catalog.filter(p=>p.id!==beckham.id&&!p.isX).slice(0,2).map(p=>p.id)]};s.save();
const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
fs.mkdirSync(out,{recursive:true});
let child,browser,page,stdout='',stderr='';
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-wonder-admin'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code+' '+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-wonder-token'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});await page.waitForTimeout(400);};
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});await ready();check('map finishes loading');


 await page.locator('#topbar-inventory').click();await page.locator('[data-player-card-action="pack-choice"]').first().waitFor();await page.waitForTimeout(1200);
 await page.locator('[data-player-card-action="pack-choice"]').first().click();await page.locator('.inventory-acquired-card').waitFor();
 const card=page.locator('.inventory-acquired-card');await card.evaluate(el=>{for(const a of el.getAnimations()){a.pause();a.currentTime=472.5;}});
 const computed=await card.evaluate(el=>{const s=getComputedStyle(el);return {background:s.background,shadow:s.boxShadow,filter:s.filter,cardBackground:getComputedStyle(el.firstElementChild).background};});
 fs.writeFileSync(path.join(out,'computed.json'),JSON.stringify(computed,null,2));await page.screenshot({path:path.join(out,'acquired-midpoint.png')});
 check('card artwork and wrapper remain transparent',computed.background.includes('rgba(0, 0, 0, 0)')&&computed.cardBackground.includes('rgba(0, 0, 0, 0)'));
 check('acquisition glow has no rectangular shadow',computed.shadow==='none');check('glow follows card alpha',computed.filter.includes('drop-shadow'));
 for(const t of [0,200,600,1050]){await card.evaluate((el,t)=>{for(const a of el.getAnimations())a.currentTime=t;},t);check(t+'ms no rectangular shadow',await card.evaluate(el=>getComputedStyle(el).boxShadow==='none'));}
 await page.setViewportSize({width:390,height:844});await card.evaluate(el=>{for(const a of el.getAnimations())a.currentTime=472.5;});await page.screenshot({path:path.join(out,'acquired-mobile.png')});check('mobile card fits viewport',await card.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
 check('no browser exceptions',errors.length===0);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:error.stack,checks,errors,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000)});fs.rmSync(data,{recursive:true,force:true});}
