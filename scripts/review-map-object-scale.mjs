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
const root=process.cwd(),out=path.join(root,'outputs/map-object-scale-20260909/'+(process.argv[2]??'after')),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-v21-review-'));
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

const unitCount=process.argv[2]?.includes('-two')?2:4;
const hq=s.world.territories[home.territoryId].buildings.find(b=>b.type==='club-headquarters');hq.level=5;
const stadium=s.buildings.createRecord('main-stadium',{level:5});stadium.buildMethod='gold';s.world.territories[home.territoryId].buildings.push(stadium);
const center=s.buildings.createRecord('scout-center',{level:5});s.world.territories[hill].buildings=[center];
actor.scouting={schemaVersion:2,tasks:{},recruitRequests:{},units:Object.fromEntries(Array.from({length:unitCount},(_,i)=>{const id='scale-scout-'+i;return [id,{id,name:'球探 '+(i+1),level:5,territoryId:home.territoryId,originTerritoryId:hill,originBuildingId:center.id,recruitedAt:Date.now(),movement:null}];}))};
s.save();fs.mkdirSync(out,{recursive:true});
let child,browser,stdout='',stderr='';const errors=[],shots=[];
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-scale-review'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-wonder-token'));
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__scaleReview={map,territoryLayersById,state:()=>campaignState};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/game');await page.waitForFunction(()=>window.__scaleReview?.state()?.playerId==='wonder-browser',null,{timeout:60000});
 await page.waitForFunction(()=>!document.querySelector('#campaign-map')?.classList.contains('is-loading'),null,{timeout:60000});
 const {territoryPointToDisplay}=await import('../client/map/campaign-map-geometry.js');const point=territoryPointToDisplay(home.centroid,home.region);
 for(const zoom of [5.8,7,3+Math.log2(30)]){
  await page.evaluate(({point,zoom})=>{window.__scaleReview.map.setView(point,zoom,{animate:false});},{point,zoom});
  await page.waitForFunction(()=>[...document.querySelectorAll('.building-map-item img,.scout-map-token img,.expedition-piece-token img')].every(i=>i.complete&&i.naturalWidth));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const boxes=await page.evaluate(()=>Object.fromEntries(['.building-map-item','.scout-map-token','.expedition-piece-token'].map(selector=>[selector,[...document.querySelectorAll(selector)].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})])));
  if(process.argv[2]?.startsWith('anchor')){
   const contained=await page.evaluate(async id=>{
    const {insideUnitTerritory}=await import('/shared/map/unit-territory-layout.mjs');const {map,territoryLayersById}=window.__scaleReview;
    const raw=territoryLayersById.get(id).getLatLngs(),multi=!Array.isArray(raw[0])?[[raw]]:!Array.isArray(raw[0][0])?[raw]:raw;
    const polygons=multi.map(p=>p.map(r=>r.map(ll=>map.latLngToContainerPoint(ll)))),container=map.getContainer().getBoundingClientRect();
    return [...document.querySelectorAll('.scout-map-token,.expedition-piece-token')].map(e=>{const r=e.getBoundingClientRect();return insideUnitTerritory({x:r.x-container.x+r.width/2,y:r.y-container.y+r.height*.85},polygons);});
   },home.territoryId);assert.ok(contained.every(Boolean),'each stationed unit ground contact stays in its own polygon');
  }
  const file='zoom-'+zoom.toFixed(2)+'.png';await page.screenshot({path:path.join(out,file)});shots.push({zoom,boxes,file});
 }
 assert.equal(await page.locator('.scout-map-token').count(),unitCount);
 for(let i=0;i<unitCount;i++){await page.locator('.scout-map-token').nth(i).click();assert.ok(await page.locator('#scouting-window').isVisible());await page.keyboard.press('Escape');}
 await page.locator('.expedition-piece-token').click();assert.ok(await page.locator('#expedition-panel').isVisible());await page.keyboard.press('Escape');
 await page.locator('[data-building-id="'+stadium.id+'"]').click({position:{x:10,y:25}});assert.ok(await page.locator('#building-panel').isVisible());await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.evaluate(point=>{window.__scaleReview.map.setView(point,7,{animate:false});},point);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(out,'mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({shots,errors,checks:['all scout tokens clickable','expedition clickable','stadium clickable','mobile no horizontal page overflow','no page errors']},null,2));console.log('Map scale review passed: '+out);
}finally{await browser?.close();child?.kill();}
