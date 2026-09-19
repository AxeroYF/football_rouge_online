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
const root=process.cwd(),out=path.join(root,'outputs/research-custom-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-wonder-live-'));
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




 const trigger=page.locator('#topbar-research'),window=page.locator('#research-window');await trigger.click();await window.waitFor({state:'visible'});
 check('four direction cards without subtitles',await page.locator('[data-research-direction]').count()===4&&await page.locator('.research-direction-summary').count()===0);
 check('club palette retained',await page.locator('.research-surface').evaluate(e=>getComputedStyle(e).backgroundColor==='rgb(26, 36, 31)'));
 check('entry centered',await page.locator('.research-directions').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.closest('.research-content').getBoundingClientRect();return Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<3;}));
 await page.screenshot({path:path.join(out,'directions.png')});
 const enter=async(i=0)=>{await page.locator('[data-research-direction="formation"]').click();await page.locator(`[data-formation-slot="${i}"]`).click();};
 await page.locator('[data-research-direction="formation"]').click();
 check('three custom slots replace preset selector',await page.locator('[data-formation-slot]').count()===3&&await window.locator('select').count()===0);
 await page.screenshot({path:path.join(out,'slots.png')});await page.locator('[data-formation-slot="0"]').click();
 check('exactly ten draggable points',await page.locator('[data-formation-point]').count()===10);check('four reference lines',await page.locator('[data-research-line]').count()===4);check('role shading present',await page.locator('.research-formation-board .formation-role-zone').count()===13);check('default recognized shape',(await page.locator('[data-formation-shape]').textContent())==='4-3-3');
 check('twelve independent metric choices',await page.locator('[data-formation-direction]').count()===12);check('five level previews',await page.locator('[data-formation-level]').count()===5);check('research remains preview',await page.locator('.formation-research-detail .research-start').isDisabled());
 await page.screenshot({path:path.join(out,'editor.png')});
 const getPoint=id=>page.locator(`[data-formation-point="point-${id}"]`);
 const position=async id=>getPoint(id).evaluate(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top)}));
 async function dragTo(locator,x,y){const b=await page.locator('.research-formation-board').boundingBox(),p=await locator.boundingBox();await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*x/100,b.y+b.height*y/100,{steps:12});await page.mouse.up();}
 await dragTo(getPoint(1),20,44);check('mouse drag changes shape',(await page.locator('[data-formation-shape]').textContent())==='4-4-2');
 await getPoint(2).focus();await page.keyboard.press('ArrowRight');check('keyboard moves point',(await position(2)).x===51);
 const before=await page.locator('.formation-role-zone.role-st').evaluate(e=>e.style.height);
 await dragTo(page.locator('[data-research-line="attack"] span'),8,14);check('reference drag updates zones',await page.locator('.formation-role-zone.role-st').evaluate(e=>e.style.height)!==before);
 await dragTo(getPoint(10),85,99);check('outfield point cannot become goalkeeper',(await getPoint(10).textContent()).includes('RB')&&(await position(10)).y<90);
 await page.locator('[data-formation-zones]').uncheck();check('shading toggle hides regions',await page.locator('.research-formation-board .formation-role-zone').count()===0);await page.locator('[data-formation-zones]').check();
 await page.locator('[data-formation-name]').fill('自定义压迫');await page.locator('[data-formation-direction="pressing"]').click();await page.locator('[data-formation-level="5"]').click();check('chosen direction level five',(await page.locator('[data-formation-detail]').textContent()).includes('+5%'));
 await page.locator('[data-formation-direction="movement"]').click();check('second direction starts independently',await page.locator('[data-formation-level="1"]').getAttribute('aria-pressed')==='true');await page.locator('[data-formation-level="3"]').click();await page.locator('[data-formation-direction="pressing"]').click();check('first direction selection retained',await page.locator('[data-formation-level="5"]').getAttribute('aria-pressed')==='true');
 await page.locator('[data-formation-save]').click();check('save status visible',(await page.locator('[data-formation-status]').textContent()).includes('已保存'));
 const saved=await position(1);const boardHandle=await page.locator('.research-formation-board').elementHandle();await page.waitForTimeout(6500);check('resource polling does not replace board',await boardHandle.evaluate(el=>el.isConnected));check('poll preserves direction and level',await page.locator('[data-formation-level="5"]').getAttribute('aria-pressed')==='true');
 await page.locator('[data-formation-slots-back]').click();check('slot reflects saved name',(await page.locator('[data-formation-slot="0"]').textContent()).includes('自定义压迫'));await page.locator('[data-formation-slot="1"]').click();check('second slot independent',await page.locator('[data-formation-name]').inputValue()==='自定义阵型 2'&&(await position(1)).y===20);await page.locator('[data-formation-direction="finishing"]').click();await page.locator('[data-formation-level="2"]').click();
 await page.keyboard.press('Escape');await trigger.click();await enter();check('close reopen retains first slot',(await position(1)).y===saved.y&&await page.locator('[data-formation-name]').inputValue()==='自定义压迫');
 await page.reload({waitUntil:'domcontentloaded'});await ready();await trigger.click();await enter();check('reload restores shape and name',(await position(1)).y===saved.y&&await page.locator('[data-formation-name]').inputValue()==='自定义压迫');check('reload restores independent direction preview',await page.locator('[data-formation-level="5"]').getAttribute('aria-pressed')==='true');
 // Explicit pointer cancellation restores the in-flight change.
 const cancelBefore=await position(3),b=await page.locator('.research-formation-board').boundingBox(),p=await getPoint(3).boundingBox();await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.75,b.y+b.height*.35,{steps:5});await getPoint(3).dispatchEvent('pointercancel',{pointerId:1,bubbles:true});await page.mouse.up();check('cancelled drag restores point',JSON.stringify(await position(3))===JSON.stringify(cancelBefore));
 await page.screenshot({path:path.join(out,'editor-custom.png')});
 await page.locator('[data-research-back]').click();check('header back first returns slots',await page.locator('[data-formation-slot]').count()===3);await page.locator('[data-research-back]').click();await page.locator('[data-research-direction="tactic"]').click();await page.locator('[data-research-object]').selectOption('style:lowBlock');await page.locator('[data-research-level="4"]').click();check('tactic research unchanged',(await page.locator('[data-research-level-detail]').textContent()).includes('+4%'));
 await page.locator('[data-research-back]').click();await page.locator('[data-research-direction="enhancement"]').click();await page.locator('[data-research-set]').click();await page.locator('[data-research-level="10"]').click();check('enhancement remains 57 to 62 percent',(await page.locator('[data-research-level-detail]').textContent()).includes('62%'));await page.keyboard.press('Escape');
 for(const width of [1280,1024,768,390,320]){await page.setViewportSize({width,height:900});await trigger.click();await page.locator('[data-research-direction="formation"]').click();check(width+' slots fit',await page.locator('.research-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.locator('[data-formation-slot="0"]').click();check(width+' editor fits',await page.locator('.research-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.locator('[data-formation-level="3"]').click();check(width+' level reachable',await page.locator('[data-formation-level="3"]').getAttribute('aria-pressed')==='true');if(width===390){await page.locator('.research-content').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(out,'mobile-board.png')});await page.locator('[data-formation-level="3"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'mobile-directions.png')});}await page.keyboard.press('Escape');}
 await page.setViewportSize({width:1600,height:1050});await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','other-private-token'));await page.reload({waitUntil:'domcontentloaded'});await ready();await trigger.click();await enter();check('account drafts isolated',await page.locator('[data-formation-name]').inputValue()==='自定义阵型 1'&&(await position(1)).y===20);await page.locator('#topbar-wonders').click();check('standard windows remain exclusive',await window.isHidden());
 const touchContext=await browser.newContext({viewport:{width:390,height:900},hasTouch:true,isMobile:true});await touchContext.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','other-private-token'));const touch=await touchContext.newPage();touch.on('pageerror',e=>errors.push(e.message));await touch.goto(url+'/game',{waitUntil:'domcontentloaded'});await touch.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});await touch.locator('#topbar-research').click();await touch.locator('[data-research-direction="formation"]').tap();await touch.locator('[data-formation-slot="0"]').tap();const tp=touch.locator('[data-formation-point="point-2"]');await tp.scrollIntoViewIfNeeded();const tbox=await tp.boundingBox(),tx=tbox.x+tbox.width/2,ty=tbox.y+tbox.height/2,cdp=await touchContext.newCDPSession(touch);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty,id:0}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx+30,y:ty+30,id:0}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});check('real touch drag moves outfield point',await tp.evaluate(e=>parseFloat(e.style.left)>55&&parseFloat(e.style.top)>23));
 await touch.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});await touch.locator('[data-formation-save]').click();await touch.waitForFunction(()=>document.querySelector('[data-formation-status]')?.textContent.includes('保存失败'),null,{timeout:3000});check('storage failure shown instead of false success',(await touch.locator('[data-formation-status]').textContent()).includes('保存失败'));await touchContext.close();
 check('no browser exceptions',errors.length===0);fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:error.stack,checks,errors,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000)});fs.rmSync(data,{recursive:true,force:true});}
