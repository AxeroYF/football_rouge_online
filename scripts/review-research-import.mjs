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
const root=process.cwd(),out=path.join(root,'outputs/research-import-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-wonder-live-'));
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
s.formationResearch.mutate(actor,'confirm',{revision:0,slotId:'custom-2',formation:createFormationResearchSlot(1)});
s.formationResearch.mutate(actor,'start',{revision:1,slotId:'custom-2',direction:'buildUp'});
const started=actor.formationResearch.active.startedAt;s.formationResearch.prepare(s.accounts,{[actor.id]:[{from:started,to:started+7200000,units:{science:100000}}]},started+7200000);assert.equal(actor.formationResearch.active,null);s.save();
for(const i of [0,2]){const formation=createFormationResearchSlot(i);formation.name=i===0?'高位压迫与快速推进的自定义阵型方案':'全方向研究成果';s.formationResearch.mutate(actor,'confirm',{revision:actor.formationResearch.revision,slotId:formation.id,formation});}
for(const key of Object.keys(actor.formationResearch.slots[2].levels))actor.formationResearch.slots[2].levels[key]=5;s.save();
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




 const tactics=page.locator('#campaign-tactics'),dialog=page.locator('.research-import-dialog');
 await page.locator('.nav-item').filter({hasText:/^战术$/}).click();await page.locator('[data-import-research]').waitFor();
 await page.locator('.league-tactics-detail-scroll').evaluate(e=>e.scrollTop=200);
 const beforeScroll=await page.locator('.league-tactics-detail-scroll').evaluate(e=>e.scrollTop);
 await page.locator('.league-board-panel').evaluate(e=>window.__originalBoard=e);
 const open=async()=>{await page.locator('[data-import-research]').click();await dialog.waitFor({state:'visible'});};
 await open();
 check('native dialog occupies modal top layer',await dialog.evaluate(e=>e.matches(':modal')));
 check('three confirmed formations',await page.locator('[data-use-research]').count()===3);
 check('each formation thumbnail includes 11 positions',await dialog.locator('.player-dot,.keeper-dot').count()===33);
 check('actual research benefits are shown',(await dialog.locator('[data-use-research="custom-2"]').textContent()).includes('组织出球 +1%'));
 check('current destination is explicit',(await dialog.locator('header p').textContent()).includes('远征 · 默认站位'));
 check('old tactical tooltip removed',await page.locator('.league-magnet-tooltip').count()===0);
 const fits=()=>dialog.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1;});
 check('desktop centered',await dialog.evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<2&&Math.abs(r.y+r.height/2-innerHeight/2)<2;}));
 await page.screenshot({path:path.join(out,'desktop.png')});
 for(let i=0;i<8;i++){await page.keyboard.press('Tab');check('keyboard focus stays in dialog '+i,await dialog.evaluate(e=>e.contains(document.activeElement)));}
 await page.keyboard.press('Escape');check('Escape closes only import dialog',await dialog.count()===0&&await tactics.isVisible());
 check('closing preserves board DOM',await page.locator('.league-board-panel').evaluate(e=>e===window.__originalBoard));
 check('closing preserves detail scroll',await page.locator('.league-tactics-detail-scroll').evaluate(e=>e.scrollTop)===beforeScroll);
 check('focus returns to import button',await page.locator('[data-import-research]').evaluate(e=>e===document.activeElement));
 await open();await page.mouse.click(3,3);check('backdrop dismisses without closing tactics',await dialog.count()===0&&await tactics.isVisible());
 await open();await page.locator('[data-close-research-import]').click();check('close button dismisses',await dialog.count()===0);
 for(const [width,height] of [[1280,900],[768,900],[390,680],[320,480]]){
  await page.setViewportSize({width,height});await open();check(width+' dialog fits viewport',await fits());
  const last=dialog.locator('[data-use-research]').last();await last.scrollIntoViewIfNeeded();check(width+' last formation reachable',await last.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await page.screenshot({path:path.join(out,'dialog-'+width+'.png')});await page.keyboard.press('Escape');
 }
 await page.setViewportSize({width:1600,height:1050});await page.locator('[data-league-position-preset="position2"]').click();await open();check('leading preset destination correct',(await dialog.locator('header p').textContent()).includes('领先站位'));
 await page.locator('[data-use-research="custom-2"]').click();await page.waitForTimeout(1600);
 check('successful import closes dialog',await dialog.count()===0);check('research formation is locked',await page.locator('[data-release-research]').isVisible());
 const response=await page.request.get(url+'/api/campaign/state',{headers:{Authorization:'Bearer isolated-wonder-token'}}),state=(await response.json()).state;
 const ids=state.tactics.squads.expedition.planSnapshots.__s4V2.researchFormationIds;
 check('only selected preset is imported and saved',ids.position2==='custom-2'&&!ids.position1&&!ids.position3);
 await open();check('imported formation shows current badge',(await dialog.locator('[data-use-research="custom-2"]').textContent()).includes('当前使用'));await page.keyboard.press('Escape');
 await page.keyboard.press('Escape');await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','other-private-token'));await page.reload({waitUntil:'domcontentloaded'});await ready();await page.locator('.nav-item').filter({hasText:/^战术$/}).click();await open();check('empty state remains a centered closable modal',await dialog.locator('.research-import-empty').isVisible()&&await fits());await page.locator('[data-close-research-import]').click();
 check('no browser errors',errors.length===0);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:error.stack,checks,errors,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000)});fs.rmSync(data,{recursive:true,force:true});}
