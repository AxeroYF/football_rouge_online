import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createMaritimeRoutePlanner } from '../maritime-routes.mjs';
import { CampaignService } from '../campaign-service.mjs';
import {sponsorLogoMarkup} from '../client/sponsorship/sponsor-markup.js';
import {SPONSORS} from '../shared/config/sponsorship.mjs';
import {createCampaignLiveLeg, publicCampaignLiveLeg, buildAccountMatchSeat} from '../engine/campaign-match-engine.mjs';
import { DRAFT_VERSION } from '../shared/config/draft.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/stadium-center-20260908'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-sponsors-browser-'));
fs.mkdirSync(out,{recursive:true});
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const samples=[1,2,3].map(count=>index.territories.find(t=>['FRA','ESP','DEU','ITA'].includes(t.countryCode)&&Object.values(resources.territories[t.territoryId].yields).filter(Boolean).length===count&&(t.bounds[2]-t.bounds[0])>.5&&(t.bounds[3]-t.bounds[1])>.4));
assert.ok(samples.every(Boolean));
const science=index.territories.find(t=>t.countryCode==='ESP'&&resources.territories[t.territoryId].yields.science>0);
const owned=[...new Set([...samples.map(t=>t.territoryId),science.territoryId])];
owned.push(...index.territories.filter(t=>!owned.includes(t.territoryId)&&t.countryCode==='FRA'&&resources.territories[t.territoryId].yields.production===0&&resources.territories[t.territoryId].yields.science===0).slice(0,18).map(t=>t.territoryId));
const start=Date.now()-3*3600000;let clock=start;
const service=new CampaignService({dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources,maritimePlanner:createMaritimeRoutePlanner({coastlineData:read('assets/data/campaign-coastlines.json'),territoryGeoJson:geo,territoryIndex:index}),now:()=>clock});
const roster=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
const coastal=index.territories.find(t=>['FRA','ESP','ITA'].includes(t.countryCode)&&service.buildings.isCoastal(t.territoryId)&&!owned.includes(t.territoryId));
assert.ok(coastal);owned.push(coastal.territoryId);
const actor={id:'resource-review',nickname:'资源审阅俱乐部',token:'isolated-resource-review',createdAt:start,setupComplete:true,homeTerritoryId:samples[0].territoryId,gold:942097,mapColor:'#4f8d79',draft:{version:DRAFT_VERSION,teamName:'资源审阅俱乐部',totalPicks:33,roster},resources:{production:349,science:112,fans:0}};
service.accounts.set(actor.id,actor);service.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:actor.homeTerritoryId};
for(const id of owned)Object.assign(service.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===actor.homeTerritoryId?actor.id:null});

service.sponsorship.migrateAccount(actor);
function reward(type,brand){
 for(let i=0;i<100000;i++){const c={id:'browser-'+type+'-'+brand+'-'+i,territoryId:coastal.territoryId,previousOwner:{type:'neutral'}},r=service.sponsorship.rewardForChallenge(actor,c);if(r?.type===type&&r.sponsorId===brand)return service.sponsorship.grantNeutralReward(actor,c);}
 throw Error('fixture draw missing');
}
for(const brand of ['microsoft','bmw','mcdonalds'])service.sponsorship.respond(actor,reward('normal',brand).id,'accept');
const stadiumOffer=reward('stadium','audi'),teamOffer=reward('team','ferrari'),blocked=reward('normal','tesla'),discard=reward('stadium','toyota');
service.save();
let child,browser,page,stderr='',stdout='';const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);};
try{
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:data,ADMIN_BOOTSTRAP_PASSWORD:'isolated-sponsor-review-password'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>stderr+=c);
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout '+stderr)),45000);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code+stderr));});child.stdout.on('data',c=>{stdout+=c;const m=stdout.match(/game: (http:\/\/127\.0\.0\.1:\d+)\/game/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','isolated-resource-review'));
 await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__sponsorReviewBroadcast=showCampaignBroadcast; window.__sponsorReviewSelect=selectTerritory;'});});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url+'/game',{waitUntil:'domcontentloaded'});
 await page.locator('#topbar-sponsorship').waitFor({state:'visible',timeout:60000});
 const headers={authorization:'Bearer isolated-resource-review'};
 const getState=async()=>(await (await context.request.get(url+'/api/campaign/state',{headers})).json()).state;
 const initial=await getState();check('offline ordinary sponsor payments caught up',initial.sponsorship.contracts.every(c=>c.paidHours===3));
 await page.locator('#topbar-sponsorship').click();
 await page.locator('.sponsor-contract').first().waitFor({state:'visible'});
 check('normal slot limit blocks signing without losing reward',await page.locator('[data-offer-id="'+blocked.id+'"][data-sponsor-action="accept"]').isDisabled());
 await page.locator('#sponsorship-window').screenshot({path:path.join(out,'contracts-desktop.png')});
 const accept=async offer=>{
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/campaign/sponsorship/respond')&&r.request().method()==='POST'),page.locator('[data-offer-id="'+offer.id+'"][data-sponsor-action="accept"]').click()]);
  const payload=await response.json();assert.equal(response.status(),200,JSON.stringify(payload));return payload.state;
 };
 await accept(stadiumOffer);const signed=await accept(teamOffer);
 check('all five slots sign with user-confirmed income',signed.sponsorship.hourlyGold===1500);
 check('team naming appears in public team name',signed.draft.teamName.endsWith('-法拉利'));
 check('new signing pays no upfront gold',Math.abs(signed.wallet.gold-initial.wallet.gold)<10);
 await page.locator('[data-sponsor-discard="'+discard.id+'"]').click();
 const [reject]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/campaign/sponsorship/respond')&&r.request().method()==='POST'),page.locator('[data-offer-id="'+discard.id+'"][data-sponsor-action="reject"]').click()]);
 check('discard explicitly resolves pending contract',!(await reject.json()).state.sponsorship.offers.some(o=>o.id===discard.id));
 await page.locator('[data-sponsor-tab="active"]').click();check('five active cards shown',await page.locator('.sponsor-contract').count()===5);
 await page.locator('[data-sponsor-tab="brands"]').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.sponsor-brand-grid img')].length===18&&[...document.querySelectorAll('.sponsor-brand-grid img')].every(i=>i.complete&&i.naturalWidth>0));
 check('management logos preserve original colors without filters',await page.locator('.sponsor-logo img').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).filter==='none')));
 check('all logo containers are transparent',await page.locator('.sponsor-logo').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(n).borderWidth==='0px')));
 check('all eighteen logo assets load',await page.locator('.sponsor-brand-grid img').count()===18);
 await page.locator('#sponsorship-window').screenshot({path:path.join(out,'brands-desktop.png')});
 for(const width of [320,390,768,1600]){
  await page.setViewportSize({width,height:width<768?844:1050});
  check('contract window has no horizontal overflow at '+width,await page.locator('.sponsorship-surface').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  check('brand logos use contain at '+width,await page.locator('.sponsor-brand-grid img').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).objectFit==='contain')));
  if(width===390)await page.locator('#sponsorship-window').screenshot({path:path.join(out,'brands-mobile.png')});
 }
 await page.locator('[aria-label="关闭赞助商"]').click();await page.locator('#sponsorship-window').waitFor({state:'hidden'});check('close button works');
 await page.locator('#topbar-wallet').hover();await page.locator('#resource-window').waitFor({state:'visible'});check('gold hover lists ordinary and naming income',/微软|普通赞助/.test(await page.locator('#resource-window').innerText())&&/法拉利/.test(await page.locator('#resource-window').innerText()));
 await page.mouse.move(20,500);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#topbar-sponsorship').waitFor({state:'visible',timeout:60000});
 const persisted=await getState();check('reload retains active and blocked pending offers',persisted.sponsorship.contracts.filter(c=>c.status==='active').length===5&&persisted.sponsorship.offers.length===1);
 await page.locator('#topbar-sponsorship').click();await page.keyboard.press('Escape');await page.locator('#sponsorship-window').waitFor({state:'hidden'});check('Escape closes contract window');
 clock=Date.now();actor.sponsorship.contracts=persisted.sponsorship.contracts;
 const rival={...structuredClone(actor),id:'rival',draft:{...actor.draft,teamName:'客场审阅队'},sponsorship:{contracts:[]}};
 const home=buildAccountMatchSeat(actor,'expedition',clock),away=buildAccountMatchSeat(rival,'expedition',clock);
 const live=publicCampaignLiveLeg(createCampaignLiveLeg({home,away,seed:'sponsors-browser',legNumber:1,startedAt:clock,venue:service.sponsorMatchVenue(actor,clock)}),{now:clock});
 await page.evaluate(broadcast=>{window.__sponsorController={snapshot:{live:{broadcast,legNumber:1}}};window.__sponsorReviewBroadcast(window.__sponsorController);},live);
 await page.waitForFunction(()=>[...document.querySelectorAll('.broadcast-sponsor-board img')].length===3&&[...document.querySelectorAll('.broadcast-sponsor-board img')].every(i=>i.complete&&i.naturalWidth>0));
 check('TV shows exactly the three home ordinary sponsor brands',JSON.stringify(await page.locator('.broadcast-sponsor-board [data-sponsor-brand]').evaluateAll(n=>n.map(e=>e.dataset.sponsorBrand)))===JSON.stringify(['microsoft','bmw','mcdonalds']));
 check('stadium naming appears beside live field',await page.locator('.broadcast-v2-venue-head h2').innerText()==='奥迪竞技场');
 const measurements=[];
 for(const width of [1920,1600,1280,1180,1024,768,390,320]){
  await page.setViewportSize({width,height:width<768?844:1050});
  const geometry=await page.evaluate(()=>{
   const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
   const board=box('.broadcast-sponsor-boards'),field=box('.broadcast-v2-stadium'),pitch=box('.broadcast-v2-pitch'),overlay=box('#campaign-broadcast');
   const ads=[...document.querySelectorAll('.broadcast-sponsor-board')].map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,background:getComputedStyle(n).backgroundColor,logoBackground:getComputedStyle(n.querySelector('.sponsor-logo')).backgroundColor};});
   return {board,field,pitch,overlay,ads,hidden:getComputedStyle(document.querySelector('.broadcast-sponsor-boards')).display==='none',contained:[...document.querySelectorAll('.broadcast-sponsor-board img')].every(n=>getComputedStyle(n).objectFit==='contain'&&getComputedStyle(n).filter==='none'),overflow:document.querySelector('#campaign-broadcast').scrollWidth>overlay.w+1};
  });
  measurements.push({width,...geometry});
  check('TV follows S4 left stand slots at '+width,width<=560?geometry.hidden:!geometry.hidden&&geometry.ads.every((ad,i)=>ad.x>=geometry.field.x&&ad.right<geometry.pitch.x&&Math.abs(ad.y-(geometry.field.y+geometry.field.h*[.10,.26,.42][i]))<2));
  check('TV logos have transparent backgrounds at '+width,geometry.ads.every(ad=>ad.background==='rgba(0, 0, 0, 0)'&&ad.logoBackground==='rgba(0, 0, 0, 0)'));
  check('pitch is horizontally centered at '+width,Math.abs((geometry.pitch.x+geometry.pitch.w/2)-(geometry.field.x+geometry.field.w/2))<1);
  check('TV preserves real pitch aspect at '+width,Math.abs(geometry.pitch.w/geometry.pitch.h-.64)<.015);
  check('TV logos fit and horizontal overflow is absent at '+width,geometry.contained&&!geometry.overflow);
  if([1600,1024,390].includes(width))await page.locator(width===390?'.broadcast-v2-field-column':'#campaign-broadcast').screenshot({path:path.join(out,'tv-'+width+'.png')});
 }
 await page.setViewportSize({width:1600,height:1050});
 const second=publicCampaignLiveLeg(createCampaignLiveLeg({home:away,away:home,seed:'sponsors-browser-2',legNumber:2,startedAt:clock,venue:{name:'本田竞技场',ownerId:'rival',sponsors:[{...persisted.sponsorship.brands.find(b=>b.id==='honda'),expiresAt:clock+3600000}]}}),{now:clock});
 await page.evaluate(broadcast=>{window.__sponsorController.snapshot={live:{broadcast,legNumber:2}};window.__sponsorController.renderOverlay();},second);
 await page.waitForFunction(()=>document.querySelector('.broadcast-sponsor-board img')?.complete&&document.querySelector('.broadcast-sponsor-board img')?.naturalWidth>0);
 await page.locator('.broadcast-v2-field-column').screenshot({path:path.join(out,'tv-honda-left.png')});
 check('changing home side replaces boards in the live renderer',await page.locator('.broadcast-sponsor-board').count()===1&&await page.locator('.broadcast-sponsor-board [data-sponsor-brand]').getAttribute('data-sponsor-brand')==='honda');
 await page.evaluate(()=>{window.__sponsorController.snapshot.live.broadcast.venue=null;window.__sponsorController.renderOverlay();});
 check('no ordinary contract leaves no reserved stand gutter',await page.locator('.broadcast-sponsor-board').count()===0);check('pitch stays centered without sponsors',await page.evaluate(()=>{const p=document.querySelector('.broadcast-v2-pitch').getBoundingClientRect(),s=document.querySelector('.broadcast-v2-stadium').getBoundingClientRect();return Math.abs(p.x+p.width/2-s.x-s.width/2)<1;}));

 const atlasHtml='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>18 个赞助商 · 品牌标识</title><style>body{margin:0;background:#12201b;color:#eeeade;font-family:"Microsoft YaHei",sans-serif}main{width:1120px;padding:32px 36px 38px}header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:25px}h1{font-size:27px;margin:0;font-weight:700}header span{font-size:14px;color:#b6ac8e}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}article{display:flex;flex-direction:column;align-items:center;gap:16px;padding:22px 10px 18px;border:1px solid #475549;border-radius:10px;background:#1e3027}strong{font-size:16px;font-weight:600}.sponsor-logo{display:flex;width:142px;height:90px;padding:13px;box-sizing:border-box;background:transparent;border-radius:0}.sponsor-logo.is-dark{background:transparent}.sponsor-logo img{width:100%;height:100%;object-fit:contain}</style><main id="logo-atlas"><header><h1>赞助商 · 品牌标识</h1><span>S4 原有 10 个 + 新增 8 个</span></header><div class="grid">'+SPONSORS.map(b=>'<article>'+sponsorLogoMarkup(b)+'<strong>'+b.name+'</strong></article>').join('')+'</div></main></html>';
 fs.writeFileSync(path.join(out,'sponsor-logos.html'),atlasHtml.replaceAll('src="/assets/','src="../../assets/'));
 const atlas=await context.newPage();await atlas.setViewportSize({width:1192,height:690});
 await atlas.route(url+'/sponsor-atlas-review.html',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:atlasHtml}));await atlas.goto(url+'/sponsor-atlas-review.html',{waitUntil:'domcontentloaded'});
 await atlas.waitForFunction(()=>document.images.length===18&&[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await atlas.locator('#logo-atlas').screenshot({path:path.join(out,'sponsor-logos.png')});await atlas.close();
 check('no browser runtime errors',errors.length===0);
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:checks.length,checks,errors,measurements,isolation:'Temporary full server, generated neutral offers, real engine broadcast payloads; original services and saves unchanged.'},null,2));
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(out,'browser-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({message:error.message,errors,checks,body:await page.locator('body').innerText()},null,2));}throw error;}finally{await browser?.close();child?.kill();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000);});if(path.dirname(path.resolve(data))!==path.resolve(os.tmpdir())||!path.basename(data).startsWith('ydl-sponsors-browser-'))throw new Error('Unexpected test directory');fs.rmSync(data,{recursive:true,force:true});}
