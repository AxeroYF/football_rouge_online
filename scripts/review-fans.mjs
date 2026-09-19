import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {CampaignService} from '../campaign-service.mjs';
import {createMaritimeRoutePlanner} from '../maritime-routes.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const require=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')),{chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/fans-review'),data=path.join(out,'data');fs.mkdirSync(data,{recursive:true});
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f))),index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json'),coast=read('assets/data/campaign-coastlines.json');
const home=index.territories.find(t=>t.countryCode==='ITA'&&t.cityIds.some(id=>id.toLowerCase().includes('milan')))||index.territories.find(t=>t.countryCode==='ITA'&&t.name.includes('米兰'));
assert.ok(home,'Milan home');
const owned=[home,...index.territories.filter(t=>t.countryCode==='ITA'&&t!==home&&!t.clubIds.length).slice(0,7)];
const initial=new CampaignService({catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources,developmentTools:true});
const roster=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const actor={id:'fans-review',nickname:'球迷机制审阅',token:'isolated-fans-review',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:942097,mapColor:'#429c85',draft:{version:DRAFT_VERSION,teamName:'球迷机制审阅',totalPicks:33,roster},resources:{fans:250}};
initial.accounts.set(actor.id,actor);initial.world.players[actor.id]={playerId:actor.id,territoryIds:owned.map(t=>t.territoryId),capitalTerritoryId:home.territoryId};
for(const t of owned)Object.assign(initial.world.territories[t.territoryId],{ownerType:'player',ownerId:actor.id,capitalOf:t===home?actor.id:null});
initial.world.territories[home.territoryId].buildings=[initial.buildings.createRecord('main-stadium',{name:'球迷主场'})];
initial.save();fs.writeFileSync(path.join(data,'campaign-accounts.json'),JSON.stringify({version:4,accounts:[actor],world:initial.world}));
let child,browser,page,stdout='',stderr='';const checks=[],errors=[],failedRequests=[],check=(name,v=true)=>{assert.ok(v,name);checks.push(name);};
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'49689',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'fans-review-only'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exit '+code+' '+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});const context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-fans-review'));
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__fans={selectTerritory,getState:()=>campaignState,getLayer:()=>campaignThreeLayer,map};'});});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failedRequests.push([r.status(),r.url()]);});
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__fans?.getState()?.resources?.fans,{timeout:60000});
 const button=page.locator('[data-resource-trigger="fans"]');await button.waitFor({state:'visible'});
 check('topbar shows initial 5000 plus preserved 250 reward',/5,250/.test(await button.innerText()));
 check('all four resource buttons visible',await page.locator('[data-resource-trigger]').count()===4);
 await button.hover();await page.locator('[data-fan-preference="balanced"]').waitFor({state:'visible'});
 check('popover shows fixed growth and allocation requirement',/100 \/小时/.test(await page.locator('#resource-window').innerText())&&/需求 8,000/.test(await page.locator('#resource-window').innerText()));
 check('all owned territories listed including unstaffed ones',await page.locator('[data-fan-territory]').count()===8);
 check('partial territory allocation visible',/25%/.test(await page.locator('#resource-window').innerText()));
 for(const preference of ['gold','production','science','balanced']){
  await page.locator(`[data-fan-preference="${preference}"]`).click();
  await page.waitForFunction(p=>window.__fans.getState().resources.fans.preference===p,preference);
  check('preference persisted in returned state: '+preference,await page.locator(`[data-fan-preference="${preference}"]`).getAttribute('aria-pressed')==='true');
  const r=await page.evaluate(()=>window.__fans.getState().resources);
  for(const id of ['gold','production','science'])check(preference+' headline equals allocated sources: '+id,Math.abs(r.sources.filter(s=>s.type==='territory').reduce((sum,s)=>sum+s.yields[id],0)-(id==='gold'?r.hourly[id]:r.current[id]))<1e-8);
  check('switch does not consume fans: '+preference,r.balances.fans===5250);
 }
 const partial=await page.evaluate(()=>window.__fans.getState().resources.sources.find(s=>s.fans>0&&s.fans<1000));
 await page.keyboard.press('Escape');await page.evaluate(id=>window.__fans.selectTerritory(id),partial.territoryId);
 check('territory inspector shows actual utilization',/利用率 25%/.test(await page.locator('#territory-resources').innerText()));
 await page.waitForFunction(()=>window.__fans?.getLayer()?.getStats()?.loaded>=1,null,{timeout:60000});
 await page.waitForFunction(()=>document.querySelector('#map-loader')?.hidden||document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
 await button.hover();await page.screenshot({path:path.join(out,'fans-desktop.png')});
 await page.locator('[data-fan-preference="science"]').click();await page.waitForFunction(()=>window.__fans.getState().resources.fans.preference==='science');
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__fans?.getState()?.resources?.fans?.preference==='science',null,{timeout:60000});
 await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
 check('reload preserves preference and never regrants initial fans',await page.evaluate(()=>window.__fans.getState().resources.balances.fans===5250));
 for(const width of [320,390,768,1600]){
  await page.setViewportSize({width,height:width<500?844:1050});await button.focus();await page.keyboard.press('Enter');
  check('resource strip stays in viewport '+width,await page.locator('#topbar-resource-summary').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}));
  check('fan popover fits viewport '+width,await page.locator('#resource-window').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.bottom<=innerHeight+1&&el.scrollWidth<=el.clientWidth+1;}));
  check('each resource remains accessible '+width,await page.locator('[data-resource-trigger]').evaluateAll(nodes=>nodes.every(n=>{const b=n.getBoundingClientRect();return b.width>0&&b.height>0;})));
  if(width===390)await page.screenshot({path:path.join(out,'fans-mobile.png')});
  await page.keyboard.press('Escape');check('Escape closes popover '+width,await page.locator('#resource-window').isHidden());
 }
 // Touch uses the same popup; preferences are normal accessible buttons.
 const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await touch.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-fans-review'));
 const tp=await touch.newPage();await tp.goto(url+'/game?renderer=leaflet',{waitUntil:'domcontentloaded'});await tp.locator('[data-resource-trigger="fans"]').waitFor({state:'visible',timeout:60000});await tp.locator('[data-resource-trigger="fans"]').tap();await tp.locator('[data-fan-preference="gold"]').tap();await tp.waitForFunction(()=>document.querySelector('[data-fan-preference="gold"]')?.getAttribute('aria-pressed')==='true');check('touch opens fans and saves preference');await touch.close();
 check('no browser exceptions',errors.length===0);check('all requested assets succeed',failedRequests.length===0);
 fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({checks,errors,failedRequests},null,2));console.log(JSON.stringify({checks:checks.length,out}));
}catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,errors,failedRequests,stderr},null,2));throw error;}
finally{await browser?.close();child?.kill();}
