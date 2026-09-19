import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import pointInPolygon from '@turf/boolean-point-in-polygon';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { CampaignService } from '../campaign-service.mjs';
import { DRAFT_VERSION } from '../shared/config/draft.mjs';
import { territoryPointToDisplay } from '../client/map/campaign-map-geometry.js';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/resource-hover-review'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-resources-browser-'));
fs.mkdirSync(out,{recursive:true});
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const samples=[1,2,3].map(count=>index.territories.find(t=>['FRA','ESP','DEU','ITA'].includes(t.countryCode)&&Object.values(resources.territories[t.territoryId].yields).filter(Boolean).length===count&&(t.bounds[2]-t.bounds[0])>.5&&(t.bounds[3]-t.bounds[1])>.4));
assert.ok(samples.every(Boolean));
const science=index.territories.find(t=>t.countryCode==='ESP'&&resources.territories[t.territoryId].yields.science>0);
const owned=[...new Set([...samples.map(t=>t.territoryId),science.territoryId])];
owned.push(...index.territories.filter(t=>!owned.includes(t.territoryId)&&t.countryCode==='FRA'&&resources.territories[t.territoryId].yields.production===0&&resources.territories[t.territoryId].yields.science===0).slice(0,18).map(t=>t.territoryId));
const start=Date.now()-3*3600000;
const service=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources,now:()=>start});
const roster=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const actor={id:'resource-review',nickname:'资源审阅俱乐部',token:'isolated-resource-review',createdAt:start,setupComplete:true,homeTerritoryId:samples[0].territoryId,gold:942097,mapColor:'#4f8d79',draft:{version:DRAFT_VERSION,teamName:'资源审阅俱乐部',totalPicks:33,roster},resources:{production:349,science:112,fans:0}};
service.accounts.set(actor.id,actor);service.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:actor.homeTerritoryId};
for(const id of owned)Object.assign(service.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===actor.homeTerritoryId?actor.id:null});
service.save();
let child,browser,page,stderr='',stdout='';const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);};
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-resource-review-password'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-resource-review'));
 // Expose the existing Leaflet map only in this isolated review response.
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();const source=await response.text();assert.ok(source.includes('}).setView([52, 12], 3.25);'));await route.fulfill({response,body:source.replace('}).setView([52, 12], 3.25);','}).setView([52, 12], 3.25);\nwindow.__resourceReviewMap = map;')});});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});
 await page.locator('#topbar-resource-summary').waitFor({state:'visible',timeout:60000});
 await page.waitForFunction(()=>window.__resourceReviewMap&&!document.querySelector('#campaign-map')?.classList.contains('is-loading'),{},{timeout:60000});
 const loaded=await context.request.get(url+'/api/campaign/state',{headers:{authorization:'Bearer isolated-resource-review'}});const state=(await loaded.json()).state;
 check('offline time adds only gold, never production or science balances',state.wallet.gold>942097&&!Object.hasOwn(state.resources.balances,'production')&&!Object.hasOwn(state.resources.balances,'science'));
 check('actual server rate equals the sum of held territories',['gold','production','science'].every(k=>(k==='gold'?state.resources.hourly.gold:state.resources.current[k])===owned.reduce((sum,id)=>sum+resources.territories[id].yields[k],0)));
 check('resource HUD appears after login',await page.locator('#topbar-resource-summary [data-resource]').count()===3);

 check('gold is inside the same resource control',await page.locator('#topbar-resource-summary #gold-balance').count()===1);
 check('topbar shows current production, not retired 349',await page.locator('#topbar-resource-summary [data-resource="production"]').innerText()===String(state.resources.current.production));
 check('topbar shows current science, not retired 112',await page.locator('#topbar-resource-summary [data-resource="science"]').innerText()===String(state.resources.current.science));
 await page.locator('#topbar-resource-summary').screenshot({path:path.join(out,'resource-strip.png')});

 check('server exposes all and only owned territory sources',state.resources.sources.length===owned.length&&state.resources.sources.every(s=>owned.includes(s.territoryId)));
 const fits=()=>page.locator('.resource-hover-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
 for(const id of ['gold','production','science']){
  await page.locator('[data-resource-trigger="'+id+'"]').hover();
  await page.locator('[data-resource-total="'+id+'"]').waitFor({state:'visible'});
  check(id+' opens on hover without clicking',await page.locator('#resource-window').isVisible());
  const expected=id==='gold'?state.resources.hourly.gold:state.resources.current[id];
  check(id+' source rows sum to the current headline',await page.locator('[data-source-amount]').evaluateAll(nodes=>nodes.reduce((sum,n)=>sum+Number(n.dataset.sourceAmount),0))===expected);
  check(id+' sources show no explanatory small text',await page.locator('#resource-window small, #resource-window p').count()===0);
  check(id+' popover fits desktop',await fits());
  if(id!=='gold')check(id+' contributions are not hourly stock growth',!(await page.locator('#resource-window').innerText()).includes('小时'));
  check('resource hover does not activate modal blur '+id,await page.locator('.map-stage.has-stage-window').count()===0);
  await page.screenshot({path:path.join(out,'hover-'+id+'-desktop.png'),fullPage:true});
  if(id==='gold'){
   await page.locator('.resource-source-scroll').hover();
   await page.waitForTimeout(260);
   check('pointer can enter the source panel without dismissing it',await page.locator('#resource-window').isVisible());
   const zoom=await page.evaluate(()=>window.__resourceReviewMap.getZoom());
   await page.mouse.wheel(0,500);await page.waitForTimeout(200);
   check('long source list scrolls',await page.locator('.resource-source-scroll').evaluate(el=>el.scrollTop>0));
   check('scrolling sources does not zoom the map',await page.evaluate(()=>window.__resourceReviewMap.getZoom())===zoom);
  }
 }
 await page.mouse.move(20,100);await page.locator('#resource-window').waitFor({state:'hidden'});
 check('leaving the trigger and panel closes the source details',await page.locator('#resource-window').isHidden());
 await page.locator('[data-resource-trigger="gold"]').hover();await page.keyboard.press('Escape');
 check('Escape dismisses the hover panel',await page.locator('#resource-window').isHidden());
 await page.locator('[data-resource-trigger="gold"]').click();await page.waitForTimeout(260);
 check('desktop click does not reopen the dismissed hover panel',await page.locator('#resource-window').isHidden());
 await page.keyboard.press('Enter');await page.locator('[data-resource-total="gold"]').waitFor({state:'visible'});
 check('keyboard can open resource sources',await page.locator('#resource-window').isVisible());
 await page.keyboard.press('Escape');
 for(const [i,t]of samples.entries()){
  const point=territoryPointToDisplay(t.centroid,t.region);
  await page.evaluate(p=>{window.__resourceReviewMap.setView(p,8,{animate:false});},point);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const feature=geo.features.find(f=>f.properties.territoryId===t.territoryId),candidates=[];
  for(let a=1;a<12;a++)for(let b=1;b<12;b++){const p=[t.bounds[0]+(t.bounds[2]-t.bounds[0])*a/12,t.bounds[1]+(t.bounds[3]-t.bounds[1])*b/12];if(pointInPolygon(p,feature))candidates.push(p);}
  candidates.sort((a,b)=>Math.hypot(a[0]-t.centroid[0],a[1]-t.centroid[1])-Math.hypot(b[0]-t.centroid[0],b[1]-t.centroid[1]));
  const target=await page.evaluate(points=>{const map=window.__resourceReviewMap,box=map.getContainer().getBoundingClientRect();for(const p of points){const v=map.latLngToContainerPoint(p),x=box.left+v.x,y=box.top+v.y;if(x<box.left+20||x>box.right-20||y<box.top+20||y>box.bottom-20)continue;const top=document.elementsFromPoint(x,y)[0];if(top?.tagName==='CANVAS')return{x,y};}return null;},candidates.map(p=>territoryPointToDisplay(p,t.region)));
  assert.ok(target,'visible unoccluded interior of '+t.name);
  await page.mouse.move(target.x-2,target.y-2);await page.mouse.move(target.x,target.y,{steps:5});
  await page.locator('.territory-tooltip .territory-yield-list').waitFor({state:'visible',timeout:15000});
  check(`hover ${i+1}-resource tile`,await page.locator('.territory-tooltip .territory-yield-list > .resource-amount').count()===i+1);
  check('territory hover omits hourly units '+i,!(await page.locator('.territory-tooltip .territory-yield-list').innerText()).includes('小时'));
  await page.mouse.click(target.x,target.y);await page.locator('#territory-resources').waitFor({state:'visible'});
  check('territory detail omits hourly units '+i,!(await page.locator('#territory-resources').innerText()).includes('小时'));
  check(`detail ${i+1}-resource tile`,await page.locator('#territory-resources .territory-yield-list > .resource-amount').count()===i+1);
  check(`detail ${i+1} rates match asset`,await page.locator('#territory-resources').evaluate((el,yields)=>Object.entries(yields).filter(([,value])=>value>0).every(([id,value])=>el.querySelector(`[data-resource="${id}"]`).textContent.includes(String(value))),resources.territories[t.territoryId].yields));
  await page.screenshot({path:path.join(out,`territory-${i+1}-resources.png`),fullPage:true});
  if(i===0){
    const build=async type=>{
      const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/campaign/territory/buildings/build')&&r.request().method()==='POST'),page.locator('[data-build-type="'+type+'"][data-build-method="production"]').click()]);
      const payload=await response.json();assert.equal(response.status(),200,JSON.stringify(payload));return payload;
    };
    const first=await build('training-center');
    check('real build button starts production-driven construction',first.building.status==='constructing'&&first.building.productionWork.allocation===state.resources.current.production);
    const second=await build('club-shop');
    check('construction toast uses the estimated time instead of a fixed minute',!(await page.locator('body').innerText()).includes('预计 1 分钟后建成'));
    const jobs=second.state.buildings.territories[t.territoryId].buildings.filter(b=>b.status==='constructing');
    check('second build shares the same capacity across both projects',jobs.length===2&&jobs.every(b=>b.productionWork.allocation===state.resources.current.production/2));
    check('construction panel describes the shared capacity', (await page.locator('.building-production-summary').innerText()).includes('2 个项目平均分配'));
    await page.locator('[data-construction-progress]').nth(1).waitFor({state:'visible'});
    check('both construction notices show finite work progress',await page.locator('[data-construction-progress]').evaluateAll(nodes=>nodes.every(n=>Number.isFinite(Number(n.getAttribute('aria-valuenow'))))));
    await page.screenshot({path:path.join(out,'shared-construction-desktop.png'),fullPage:true});
  }

  await page.mouse.click(target.x,target.y);
 }

 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-resource-trigger="gold"]').hover();await page.locator('#resource-window').waitFor({state:'visible'});
 check('hover panel fits narrow display',await fits());
 await page.screenshot({path:path.join(out,'resources-mobile.png'),fullPage:true});
 check('page has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 for(const width of [320,360,768,1024,1366]){
  await page.setViewportSize({width,height:900});await page.locator('[data-resource-trigger="gold"]').hover();
  check('resource hover and header fit '+width,await fits()&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.keyboard.press('Escape');
 const touchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
 await touchContext.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-resource-review'));
 const touchPage=await touchContext.newPage();touchPage.on('pageerror',e=>errors.push(e.message));
 await touchPage.goto(url+'/game',{waitUntil:'domcontentloaded'});await touchPage.locator('[data-resource-trigger="gold"]').waitFor({state:'visible',timeout:60000});
 await touchPage.locator('[data-resource-trigger="gold"]').tap();await touchPage.locator('[data-resource-total="gold"]').waitFor({state:'visible'});
 check('touch fallback uses the same compact source panel',await touchPage.locator('.resource-hover-panel').isVisible());
 await touchPage.screenshot({path:path.join(out,'resources-touch.png'),fullPage:true});
 await touchPage.locator('[data-resource-source] td').first().tap();await touchPage.waitForTimeout(260);
 await touchPage.locator('[data-resource-source] td').first().tap();await touchPage.waitForTimeout(260);
 check('touching source rows does not dismiss the panel',await touchPage.locator('#resource-window').isVisible());
 await touchPage.touchscreen.tap(190,700);await touchPage.locator('#resource-window').waitFor({state:'hidden'});
 check('outside tap closes touch sources',await touchPage.locator('#resource-window').isHidden());await touchContext.close();
 await page.keyboard.press('Escape');await page.setViewportSize({width:1600,height:1050});await page.locator('.nav-item').nth(2).click();check('tactics controller still opens',await page.locator('#campaign-tactics').isVisible());await page.locator('.nav-item').nth(0).click();
 const atlas=await context.newPage();atlas.on('pageerror',error=>errors.push(error.message));await atlas.goto(pathToFileURL(path.join(root,'outputs/territory-resources-20260907/territory-resource-atlas.html')).href);
 check('atlas lists all territories',await atlas.locator('#rows tr').count()===1470);await atlas.locator('#region').selectOption('south-america');await atlas.locator('#yieldCount').selectOption('3');check('atlas combines region and yield filters',await atlas.locator('#rows tr').count()===20);await atlas.locator('#region').selectOption('');await atlas.locator('#yieldCount').selectOption('');await atlas.locator('#search').fill('巴登');check('atlas name search works',await atlas.locator('#rows tr').count()>0);await atlas.locator('#search').fill('');await atlas.screenshot({path:path.join(out,'atlas-desktop.png'),fullPage:true});await atlas.close();
 check('no browser runtime errors',errors.length===0);
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors,samples:samples.map(t=>({id:t.territoryId,name:t.name,yields:resources.territories[t.territoryId].yields})),isolation:'Temporary full server and temporary account. App response exposes its map only for review; no production code instrumentation or real saves.'},null,2));console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(out,"browser-failure.png"),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,"browser-failure.json"),JSON.stringify({message:error.message,errors,checks,body:await page.locator("body").innerText()},null,2));}throw error;}finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});if(path.dirname(path.resolve(data))!==path.resolve(os.tmpdir())||!path.basename(data).startsWith('ydl-resources-browser-'))throw new Error('Unexpected test directory');fs.rmSync(data,{recursive:true,force:true});}
