import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'),{chromium}=require('playwright');
const styles=[...fs.readFileSync('index.html','utf8').matchAll(/<link[^>]*href="([^\"]+\.css[^\"]*)"/g)].map(m=>m[1]);
const serve=createStaticHandler(process.cwd()),server=http.createServer((req,res)=>{if(req.url==='/__warehouse'){res.setHeader('Content-Type','text/html');res.end('<html><head>'+styles.map(s=>`<link rel="stylesheet" href="/${s.replace(/^\.\//,'')}">`).join('')+'</head><body><nav id="primary-navigation"></nav></body></html>');}else serve(req,res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],report={};page.on('pageerror',e=>errors.push(e.message));
const catalog=JSON.parse(fs.readFileSync('assets/data/s4-player-catalog.json'));
const cards=Array.from({length:70},(_,i)=>({...catalog[i%catalog.length],id:'card-'+i,playerId:'card-'+i,cardInstanceId:'card-'+i,grade:i%2?'A':'S',role:i%3?'ST':'GK',upgradeLevel:i%4,blocked:i===0?'训练中':null}));
const boot=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/__warehouse');await page.evaluate(cards=>{window.cards=cards;window.requests=[];window.toast=[];window.tick=()=>new Promise(r=>setTimeout(r,70));},cards);};
try{
 await boot();
 await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js'),{createInteractionController}=await import('/client/social/interaction-controller.js'),{INTERACTION_RULES}=await import('/shared/config/diplomacy.mjs');
  const state={playerId:'p',setupComplete:true,interactions:{players:[],requests:[],events:[],news:[]}},store=createCampaignStore(state);
  const root=document.createElement('section');root.id='interaction-window';root.hidden=true;const listRoot=document.createElement('section'),notices=document.createElement('section');document.body.append(root,listRoot,notices);
  const view={selfId:'p',player:{id:'q',teamName:'对方球队'},gold:100000,oil:200,rules:INTERACTION_RULES,relationship:'peace',requests:[],events:[],myCards:cards,theirCards:cards.map(p=>({...p,id:'q-'+p.id,playerId:'q-'+p.id})),squad:{unavailable:true,roster:[],starters:[]},stats:{},matches:[]};
  window.controller=createInteractionController({root,listRoot,notices,campaignStore:store,getState:store.getState,getRequest:()=>async(url,opts)=>{if(opts)requests.push(opts.body);return {view,state};},showToast:m=>toast.push(m)});controller.open('q');await tick();
 });
 await page.locator('[data-interaction-action="trade-form"]').click();
 const give=page.locator('[data-warehouse="trade-give"]'),take=page.locator('[data-warehouse="trade-take"]');
 assert.equal(await give.locator('.social-warehouse-card').count(),24);assert.equal(await take.locator('.social-warehouse-card').count(),24);
 await page.locator('[data-trade-gold="give"]').fill('123');await give.locator('[data-trade-card][value="card-1"]').check();
 await give.locator('[data-warehouse-filter="grade"]').selectOption('S');assert.equal(await give.locator('[data-trade-card][value="card-1"]').count(),0);
 await take.locator('[data-trade-card][value="q-card-2"]').check();
 await give.locator('[data-warehouse-reset]').click();assert.equal(await give.locator('[data-trade-card][value="card-1"]').isChecked(),true);
 await give.locator('[data-warehouse-more]').click();assert.equal(await give.locator('.social-warehouse-card').count(),48);
 await page.locator('.interaction-scroll').evaluate(n=>n.scrollTop=0);await page.waitForTimeout(300);await page.screenshot({path:'outputs/performance-20260919/trade-warehouse.png'});
 await page.locator('[data-interaction-trade] button[type="submit"]').click();
 const trade=await page.evaluate(()=>requests.find(r=>r.action==='trade')?.trade);assert.deepEqual(trade.giveCardIds,['card-1']);assert.deepEqual(trade.takeCardIds,['q-card-2']);assert.equal(trade.giveGold,123);assert.equal(Object.hasOwn(trade,'warehouses'),false);report.trade={selectedAcrossFilters:true,independentFilters:true,batch:48,submitted:trade};
 await boot();
 await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js'),{createCoalitionController}=await import('/client/social/coalition-controller.js');
  const state={playerId:'p',setupComplete:true,coalition:{army:{revision:1}},expeditionFitness:{serverNow:Date.parse('2026-09-19T02:00:00Z')}},store=createCampaignStore(state);
  const view={serverNow:state.expeditionFitness.serverNow,members:[{id:'p',name:'我'},{id:'q',name:'盟友'}],army:{id:'army',name:'联合球队',revision:1,loans:[],roster:[],contributors:['p','q'],canCommand:true,commanderName:'我'},myCards:cards};
  window.controller=createCoalitionController({getState:store.getState,campaignStore:store,metadata:new Map(),showToast:m=>toast.push(m),getRequest:()=>async(url,opts)=>{if(opts){requests.push(opts.body);const p=cards.find(p=>p.id===opts.body.playerId);if(opts.body.action==='lend'){p.blocked='已借调';p.loan={armyId:'army'};view.army.loans.push({ownerId:'p',playerId:p.id});view.army.roster.push({...p,id:JSON.stringify(['p',p.id]),ownerName:'我'});}else{p.blocked=null;p.loan=null;view.army.loans=[];view.army.roster=[];}view.army.revision++;}return {view:structuredClone(view),state:{...state,coalition:{army:{revision:view.army.revision}}}};}});await controller.open();
 });
 const mine=page.locator('[data-warehouse="coalition-mine"]');await mine.locator('[data-warehouse-filter="grade"]').selectOption('A');assert.equal(await mine.locator('.social-warehouse-count').textContent(),'35 / 70 张');
 await mine.locator('[data-warehouse-more]').click();await mine.locator('[data-warehouse-scroll]').evaluate(n=>n.scrollTop=200);
 const before=await mine.locator('[data-warehouse-scroll]').evaluate(n=>{window.heldScroll=n;window.heldCard=n.querySelector('.social-warehouse-card');return n.scrollTop;});
 await mine.locator('[data-coalition-action="lend"][data-player-id="card-1"]').evaluate(n=>n.click());await page.waitForFunction(()=>requests.length===1);await page.waitForTimeout(100);
 assert.equal(await mine.locator('[data-warehouse-filter="grade"]').inputValue(),'A');assert.equal(await mine.locator('[data-warehouse-scroll]').evaluate(n=>n===heldScroll&&n.scrollTop===200),true);
 assert.equal(await page.locator('[data-warehouse="coalition-roster"] .social-warehouse-card').count(),1);
 await page.screenshot({path:'outputs/performance-20260919/coalition-warehouse.png'});
 await page.locator('[data-coalition-action="withdraw"]').click();await page.waitForTimeout(100);assert.equal(await page.locator('[data-warehouse="coalition-roster"] .social-warehouse-card').count(),0);report.coalition={filterRetained:true,scroll:before,lendAndWithdraw:true};
 await boot();
 await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js'),{createRaidController}=await import('/client/elite/raid-controller.js');
  const state={playerId:'p',setupComplete:true},store=createCampaignStore(state),army={id:'raid-army',revision:1,roster:[],loans:[],canCommand:true,commanderId:'p',busy:false};
  const activity={open:true,raids:[],matches:[],queue:[],history:[],coalition:{army,myCards:cards},army};
  window.controller=createRaidController({getState:store.getState,campaignStore:store,showToast:m=>toast.push(m),getRequest:()=>async(url,opts)=>{if(opts){requests.push(opts.body);if(opts.body.action==='lend'){const p=cards.find(p=>p.id===opts.body.playerId);army.roster=[{...p,id:JSON.stringify(['p',p.id]),ownerName:'我'}];army.loans=[{ownerId:'p',playerId:p.id}];p.blocked='已借调';}if(opts.body.action==='withdraw'){army.roster=[];army.loans=[];cards.find(p=>p.id===opts.body.playerId).blocked=null;}}return {activity,state};}});await controller.open();
 });
 const raid=page.locator('[data-warehouse="raid-mine"]');await raid.locator('[data-warehouse-filter="position"]').selectOption('GK');await raid.locator('[data-warehouse-filter="usable"]').check();
 await raid.locator('[data-raid-action="lend"]').first().click();await page.waitForTimeout(100);assert.equal(await page.locator('[data-warehouse="raid-roster"] .social-warehouse-card').count(),1);
 await page.locator('[data-raid-action="withdraw"]').click();await page.waitForTimeout(100);assert.equal(await page.locator('[data-warehouse="raid-roster"] .social-warehouse-card').count(),0);
 await page.screenshot({path:'outputs/performance-20260919/raid-warehouse.png'});report.raid={keeperFilter:true,usableFilter:true,lendAndWithdraw:true};
 await page.setViewportSize({width:700,height:900});await raid.scrollIntoViewIfNeeded();await page.waitForTimeout(250);await page.screenshot({path:'outputs/performance-20260919/raid-warehouse-mobile.png'});report.mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(report.mobile.overflow,false);
 assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify(report));
}finally{fs.writeFileSync('outputs/performance-20260919/social-warehouse-browser.json',JSON.stringify({...report,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
