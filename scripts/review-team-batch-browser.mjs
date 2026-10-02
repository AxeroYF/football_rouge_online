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
const root=process.cwd(),out=path.join(root,'outputs/team-batch-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
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
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__audit={team:()=>teamController.open(),training:(v)=>trainingController.open(v),tactics:(v)=>fullTacticsController.open(v),scouting:(v)=>scoutingController.open(v),select:(id)=>selectTerritory(id)};'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/game');await page.locator('#server-players:not([hidden])').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});



 let batchWrites=0;page.on('request',req=>{if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/campaign/squads/batch')batchWrites++;});
 for(const size of [{width:1440,height:900},{width:390,height:844},{width:780,height:360},{width:768,height:1024}]){
  await page.setViewportSize(size);await page.evaluate(()=>window.__audit.team());
  await page.locator('[data-team-mode="list"]').waitFor();assert.equal(await page.locator('[data-team-squad-player]').count(),0);
  await page.screenshot({path:path.join(out,`${size.width}-menu.png`),scale:'css'});
  await page.locator('[data-team-mode="list"]').click();await page.locator('[data-team-squad-player]').first().waitFor();
  await page.locator('[data-team-back]').click();await page.locator('[data-team-mode="batch"]').click();await page.locator('[data-batch-select]').first().waitFor();

  const snapshot=s.squadBatchDetails(actor),sample=snapshot.players.find(p=>p.role&&p.club&&p.nationality);
  await page.locator('[data-batch-filters]>summary').click();
  for(const [key,value]of [['position',sample.role],['club',sample.club],['nationality',sample.nationality],['upgrade',String(sample.upgradeLevel??0)]])await page.locator(`[data-batch-filter="${key}"]`).selectOption(value);
  const filtered=snapshot.players.filter(p=>(p.role===sample.role||p.secondaryRole===sample.role)&&p.club===sample.club&&p.nationality===sample.nationality&&Number(p.upgradeLevel??0)===Number(sample.upgradeLevel??0));
  assert.deepEqual((await page.locator('[data-batch-row]').evaluateAll(es=>es.map(e=>e.dataset.batchRow))).sort(),filtered.map(p=>p.id).sort());
  assert.equal(await page.locator('.team-batch-card-art').count(),filtered.length);
  await page.screenshot({path:path.join(out,`${size.width}-filters.png`),scale:'css'});
  await page.locator('[data-batch-clear-filters]').click();await page.locator('[data-batch-filters]>summary').click();
  const before=structuredClone(actor.playerSquads.assignments),writesBefore=batchWrites;

  const ids=s.squadBatchDetails(actor).players.map(p=>p.id),from=ids.find(id=>before[id]==='garrison'),to=ids.find(id=>before[id]==='expedition');
  if(size.width<=700)await page.locator('[data-batch-tab="garrison"]').click();
  await page.locator(`[data-batch-row="${from}"]`).click({position:{x:50,y:65}});assert.equal(await page.locator(`[data-batch-select="${from}"]`).isChecked(),true);await page.locator('[data-batch-move="expedition"]').click();
  assert.match(await page.locator('.team-batch-savebar').innerText(),/23\/22/);assert.equal(await page.locator('[data-batch-preview]').isDisabled(),true);
  if(size.width<=700)await page.locator('[data-batch-tab="expedition"]').click();
  await page.locator(`[data-batch-select="${to}"]`).check();await page.locator('[data-batch-move="garrison"]').click();
  assert.match(await page.locator('.team-batch-savebar').innerText(),/2 人待调整/);assert.deepEqual(actor.playerSquads.assignments,before);assert.equal(batchWrites,writesBefore);
  await page.locator('[data-batch-undo]').click();assert.match(await page.locator('.team-batch-savebar').innerText(),/23\/22/);
  await page.locator(`[data-batch-select="${to}"]`).check();await page.locator('[data-batch-move="garrison"]').click();
  await page.keyboard.press('Escape');await page.locator('.team-batch-modal').waitFor();assert.equal(await page.locator('#campaign-team').isVisible(),true);await page.locator('[data-batch-continue]').click();
  await page.locator('[data-team-back]').click();await page.locator('.team-batch-modal').waitFor();await page.locator('[data-batch-continue]').click();
  const listBoxes=await page.locator('.team-batch-list:visible').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.ok(listBoxes.every(h=>h>=65),JSON.stringify({size,listBoxes}));
  const savebox=await page.locator('[data-batch-preview]').boundingBox();assert.ok(savebox.y>=0&&savebox.y+savebox.height<=size.height);
  await page.screenshot({path:path.join(out,`${size.width}-draft.png`),scale:'css'});
  await page.locator('[data-batch-preview]').click();await page.locator('[data-batch-save]').waitFor();
  await page.screenshot({path:path.join(out,`${size.width}-review.png`),scale:'css'});
  if(size.width===1440){await page.route('**/api/campaign/squads/batch',async route=>{if(route.request().method()==='POST'){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟保存失败'})});}else await route.continue();},{times:1});await page.locator('[data-batch-save]').click();await page.getByRole('alert').filter({hasText:'模拟保存失败'}).waitFor();assert.deepEqual(actor.playerSquads.assignments,before);}
  await page.locator('[data-batch-save]').evaluate(e=>{e.click();e.click();});await page.locator('.team-batch-modal').waitFor({state:'hidden'});
  assert.equal(actor.playerSquads.assignments[from],'expedition');assert.equal(actor.playerSquads.assignments[to],'garrison');assert.equal(batchWrites-writesBefore,size.width===1440?2:1);
  assert.match(await page.locator('.team-batch-savebar').innerText(),/0 人待调整/);
  await page.locator('[data-team-back]').click();await page.locator('[data-team-mode="list"]').click();assert.equal(await page.locator(`[data-team-squad-player="${from}"]`).inputValue(),'expedition');

  if(size.width===1440){
   // Original list still commits immediately, and re-entering batch reloads it.
   const select=page.locator(`[data-team-squad-player="${from}"]`);
   await select.selectOption('garrison');await page.waitForFunction(id=>document.querySelector(`[data-team-squad-player="${id}"]`)?.disabled===false,from);assert.equal(actor.playerSquads.assignments[from],'garrison');
   await select.selectOption('expedition');await page.waitForFunction(id=>document.querySelector(`[data-team-squad-player="${id}"]`)?.disabled===false,from);assert.equal(actor.playerSquads.assignments[from],'expedition');
   await page.locator('[data-team-back]').click();await page.locator('[data-team-mode="batch"]').click();await page.locator(`[data-batch-select="${from}"]`).check();
   await page.locator('[data-batch-filter="search"]').fill('no-player-matches-this');assert.match(await page.locator('.team-batch-selection').innerText(),/1 人不在当前结果中/);
   await page.locator('[data-batch-filter="search"]').fill('');await page.locator('[data-batch-move="garrison"]').click();
   const stateBeforeConflict=structuredClone(actor.playerSquads.assignments);
   actor.tactics={...(actor.tactics??{}),batchConflictTest:true};
   await page.locator('[data-batch-preview]').click();await page.getByRole('alert').filter({hasText:'状态已变化'}).waitFor();assert.deepEqual(actor.playerSquads.assignments,stateBeforeConflict);
   await page.locator('[data-batch-load]').click();await page.locator(`[data-batch-revert="${from}"]`).first().waitFor();assert.match(await page.locator('.team-batch-savebar').innerText(),/1 人待调整/);
   await page.locator('[data-batch-preview]').click();await page.locator('[data-batch-save]').waitFor();await page.locator('[data-batch-continue]').click();
   await page.locator('[data-team-back]').click();await page.locator('[data-batch-discard-leave]').click();await page.locator('[data-team-mode="list"]').waitFor();assert.deepEqual(actor.playerSquads.assignments,stateBeforeConflict);
  }
  await page.locator('[data-team-close]').click();report.push({size,listBoxes,writes:batchWrites-writesBefore});

 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({report,errors},null,2));console.log(JSON.stringify({report,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
