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
const root=process.cwd(),out=path.join(root,'outputs/research-atlas-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-wonder-live-'));
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



 const trigger=page.locator('#topbar-research'),window=page.locator('#research-window'),viewport=page.locator('.research-viewport'),detail=page.locator('.research-detail');await trigger.click();await window.waitFor({state:'visible'});
 check('atlas opens from flat topbar',await trigger.getAttribute('aria-current')==='page');check('all 32 subjects retained',await page.locator('[data-research-topic]').count()===32);check('horizontal stage headings',await page.locator('.research-era-bands header').count()===7);check('route lines drawn',await page.locator('[data-route-from]').count()>26);check('details do not consume canvas initially',await detail.isHidden());check('node cards never overlap',await page.locator('[data-research-topic]').evaluateAll(nodes=>{const boxes=nodes.map(n=>n.getBoundingClientRect());return boxes.every((a,i)=>boxes.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom+3<=b.top||b.bottom+3<=a.top));}));
 check('actual science capacity visible',Number((await page.locator('[data-research-capacity]').textContent()).replace(/[^0-9.]/g,''))>0);
 await page.screenshot({path:path.join(out,'atlas-desktop.png')});
 const first=page.locator('[data-research-topic="formation:4-3-3"]');await first.hover();await detail.waitFor({state:'visible'});check('hover shows node detail',(await detail.textContent()).includes('4-3-3'));check('eleven formation positions',await detail.locator('.research-player-dot').count()===11);check('preview cannot start research',await detail.locator('.research-start').isDisabled());
 await first.click();await page.mouse.move(1000,170);check('clicked detail stays pinned',await detail.isVisible());await page.screenshot({path:path.join(out,'atlas-detail.png')});await page.locator('[data-research-dismiss]').click();check('detail closes independently',await detail.isHidden()&&await window.isVisible());
 const start=await viewport.evaluate(e=>e.scrollLeft);await viewport.hover({position:{x:850,y:50}});await page.mouse.wheel(0,350);await page.waitForTimeout(200);check('wheel pans horizontally',await viewport.evaluate(e=>e.scrollLeft)>start);
 const b=await viewport.boundingBox();const panStart=await viewport.evaluate(e=>e.scrollLeft);await page.mouse.move(b.x+650,b.y+48);await page.mouse.down();await page.mouse.move(b.x+870,b.y+48,{steps:6});await page.mouse.up();check('background drag pans',await viewport.evaluate(e=>e.scrollLeft)<panStart);
 await page.locator('[data-research-zoom="out"]').click();check('zoom changes scale',(await page.locator('[data-research-scale]').textContent())==='75%');await page.locator('[data-research-fit]').click();check('fit displays complete graph',await viewport.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1));await page.locator('[data-research-home]').click();await page.waitForTimeout(400);
 await page.locator('[data-research-branch="tactic"]').click();check('tactic branch has 13 nodes',await page.locator('[data-research-topic]').count()===13);await page.locator('[data-research-search]').fill('摆大巴');check('search preserves route context',await page.locator('[data-research-topic]').count()===13&&await page.locator('.research-node.is-match').count()===1);check('search pans to matching node',await page.locator('[data-research-topic="style:lowBlock"]').evaluate(e=>{const b=e.getBoundingClientRect(),v=e.closest('.research-viewport').getBoundingClientRect();return b.left>=v.left&&b.right<=v.right;}));await page.locator('[data-research-topic="style:lowBlock"]').click();check('search result correct',(await detail.locator('h2').textContent())==='摆大巴');
 await page.locator('[data-research-search]').fill('no-such-tech');check('empty search hides old detail',await page.locator('[data-research-empty]').isVisible()&&await detail.isHidden());await page.locator('[data-research-search]').fill('');
 await page.locator('[data-research-branch="enhancement"]').click();await page.locator('[data-research-scroll]').fill('1000');await page.locator('[data-research-topic="enhancement:8"]').click();check('target +8 and base probability',(await detail.textContent()).includes('当前 +7')&&(await detail.textContent()).includes('目标 +8')&&(await detail.textContent()).includes('25%'));await page.screenshot({path:path.join(out,'atlas-enhancement.png')});
 await detail.evaluate(e=>e.scrollTop=60);const before=await viewport.evaluate(e=>[e.scrollLeft,e.scrollTop]);const detailScroll=await detail.evaluate(e=>e.scrollTop);await page.waitForTimeout(6500);check('polling preserves graph pan',JSON.stringify(await viewport.evaluate(e=>[e.scrollLeft,e.scrollTop]))===JSON.stringify(before));check('polling preserves pinned details',await detail.isVisible()&&await detail.evaluate(e=>e.scrollTop)===detailScroll&&(await detail.locator('h2').textContent())==='强化 +8');
 await page.keyboard.press('Escape');check('escape dismisses detail first',await detail.isHidden()&&await window.isVisible());await page.keyboard.press('Escape');check('escape closes atlas and restores focus',await window.isHidden()&&await trigger.evaluate(e=>e===document.activeElement));await trigger.click();await page.locator('#topbar-wonders').click();check('standard windows remain exclusive',await window.isHidden());await page.keyboard.press('Escape');
 for(const width of [1280,768,390,320]){await page.setViewportSize({width,height:900});await trigger.click();await page.waitForTimeout(180);check(width+' no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check(width+' surface fits',await page.locator('.research-surface').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1;}));if(width===390){await page.locator('[data-research-branch="formation"]').click();await page.locator('[data-research-home]').click();await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'atlas-mobile.png')});await page.locator('[data-research-topic="formation:4-3-3"]').click();check('mobile detail fits',await detail.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));await page.screenshot({path:path.join(out,'atlas-mobile-detail.png')});await page.locator('[data-research-dismiss]').click();}await page.keyboard.press('Escape');}
 check('no browser exceptions',errors.length===0);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:error.stack,checks,errors,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000)});fs.rmSync(data,{recursive:true,force:true});}
