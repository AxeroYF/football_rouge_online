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
const root=process.cwd(),out=path.join(root,'outputs/minimap-right-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-training-refresh-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const has=(id,terrain)=>resources.territories[id].terrain.includes(terrain);
const home=index.territories.find(t=>t.countryCode==='FRA'&&has(t.territoryId,'plains')&&t.landNeighbors.some(id=>has(id,'hills')||has(id,'mountain'))&&t.landNeighbors.some(id=>has(id,'plains'))&&t.landNeighbors.length>=3);
assert.ok(home);
const hill=home.landNeighbors.find(id=>has(id,'hills')||has(id,'mountain')),plain=home.landNeighbors.find(id=>id!==hill&&has(id,'plains'));
const owned=[home.territoryId,...home.landNeighbors];
const s=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const base=[['GK',4],['DEF',10],['MID',10],['ATT',60]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const roster=[...new Map([...base,...catalog.filter(p=>p.nationality==='西班牙').slice(0,12),...catalog.filter(p=>p.nationality==='巴西').slice(0,8)].map(p=>[p.id,p])).values()];
const actor={id:'wonder-browser',nickname:'奇观验收',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:100000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'奇观验收',totalPicks:roster.length,roster},resources:{fans:50000}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
const trainingBuilding=s.buildings.createRecord('training-center');s.world.territories[hill].buildings.push(trainingBuilding);s.save();
const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
fs.mkdirSync(out,{recursive:true});
let child,browser,page,stdout='',stderr='';
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-wonder-admin'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code+' '+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-wonder-token'));
 await context.route('**/app.js?*',async route=>{const res=await route.fetch();await route.fulfill({response:res,body:await res.text()+'\nwindow.__trainingOpen=value=>trainingController.open(value);'});});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const ready=async()=>{await page.waitForFunction(()=>typeof window.__trainingOpen==='function',null,{timeout:60000});await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});await page.waitForTimeout(400);};
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});await ready();check('map finishes loading');
 const measurements=[];
 for(const width of [1600,1280,768,390,320]){
  await page.setViewportSize({width,height:width<=680?844:1050});await page.waitForTimeout(350);
  const geometry=await page.evaluate(()=>{
   const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const panel=document.querySelector('.campaign-minimap-panel'),map=document.querySelector('#campaign-minimap'),stage=panel.parentElement;
   const nav=document.querySelector('.topbar-nav');
   return {panel:box(panel),map:box(map),stage:box(stage),nav:nav?box(nav):null,children:[...panel.querySelectorAll('.map-layer-toggles,.map-development-controls')].map(box),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  measurements.push({width,...geometry});
  check('minimap right offset at '+width,Math.abs(geometry.stage.right-geometry.panel.right-(width<=680?8:14))<1);
  check('minimap bottom offset at '+width,Math.abs(geometry.stage.bottom-geometry.panel.bottom-(width<=680?8:14))<1);
  check('related controls remain above minimap at '+width,geometry.children.every(b=>b.bottom<=geometry.map.top&&b.left>=0&&b.right<=width));
  check('minimap and controls fit viewport at '+width,!geometry.overflow&&geometry.panel.top>=0&&geometry.panel.bottom<=(width<=680?844:1050));
  if(width===1600||width===390)await page.screenshot({path:path.join(out,'minimap-'+width+'.png')});
 }
 const toggle=page.locator('#snow-layer-toggle');const before=await toggle.isChecked();await toggle.locator('xpath=..').click();check('map display option still toggles',await toggle.isChecked()!==before);
 check('no browser exceptions',errors.length===0);
 fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(measurements,null,2));
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors,isolation:'Temporary campaign and real map UI across five viewports; no real saves changed.'},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:error.stack,checks,errors,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000)});fs.rmSync(data,{recursive:true,force:true});}
