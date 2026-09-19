import {createFormationResearchSlot} from '../shared/config/formation-research.mjs';
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
const root=process.cwd(),out=path.join(root,'outputs/wingbacks-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-wonder-live-'));
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
const formation=createFormationResearchSlot(0);formation.positions=Object.fromEntries(Object.keys(formation.positions).map((key,i)=>[key,{x:coords[i+1][0],y:coords[i+1][1]}]));formation.lines=lines;
s.formationResearch.mutate(actor,'confirm',{revision:0,slotId:'custom-1',formation});s.save();
const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
fs.mkdirSync(out,{recursive:true});
let child,browser,page,stdout='',stderr='';
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-wonder-admin'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code+' '+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050}});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-wonder-token'));
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__panelReview={select:id=>territoryController.selectTerritory(id),visible:id=>territoryVisible(id),state:()=>campaignState,map};'});});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});await page.waitForTimeout(400);};
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});await ready();check('map finishes loading');




 await page.locator('.nav-item').filter({hasText:/^战术$/}).click();await page.locator('[data-import-research]').waitFor();
 const wing=side=>page.locator(`[data-league-magnet="${chosen[side==='left'?1:2].id}"]`);
 for(const [side,label] of [['left','左翼卫'],['right','右翼卫']]){
  check(side+' fullback detected as wingback',(await wing(side).locator('.league-magnet-role').textContent())===label);
  check(side+' wingback shows primary familiarity',await wing(side).evaluate(e=>e.classList.contains('fit-primary')));
 }
 await page.screenshot({path:path.join(out,'wingbacks-board.png')});
 await page.locator('[data-import-research]').click();await page.locator('[data-use-research="custom-1"]').click();await page.waitForTimeout(1500);
 for(const [side,label] of [['left','左翼卫'],['right','右翼卫']]){
  check(side+' fullback is selected for research wingback slot',(await wing(side).locator('.league-magnet-role').textContent())===label);
  check(side+' imported wingback keeps primary familiarity',await wing(side).evaluate(e=>e.classList.contains('fit-primary')));
 }
 await page.reload({waitUntil:'domcontentloaded'});await ready();await page.locator('.nav-item').filter({hasText:/^战术$/}).click();await page.locator('[data-release-research]').waitFor();
 for(const side of ['left','right'])check(side+' wingback familiarity survives save and reload',await wing(side).evaluate(e=>e.classList.contains('fit-primary')));
 check('no browser errors',errors.length===0);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:error.stack,checks,errors,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000)});fs.rmSync(data,{recursive:true,force:true});}
