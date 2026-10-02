import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'),{chromium}=require('playwright');
const styles=[...fs.readFileSync('index.html','utf8').matchAll(/<link[^>]*href="([^" ]+\.css[^" ]*)"/g)].map(m=>m[1]);
const serve=createStaticHandler(process.cwd()),server=http.createServer((req,res)=>{if(req.url==='/__review'){res.setHeader('Content-Type','text/html');res.end('<html><head>'+styles.map(s=>`<link rel="stylesheet" href="/${s.replace(/^\.\//,'')}">`).join('')+'</head><body><div id="campaign-notifications"><main id="campaign-notification-list"><section id="campaign-defence-notices"></section></main></div><div id="campaign-liberation-notices"></div><div id="battle-result-liberation"></div><nav id="primary-navigation"></nav></body></html>');}else serve(req,res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],report={};page.on('pageerror',e=>errors.push(e.message));
const catalog=JSON.parse(fs.readFileSync('assets/data/s4-player-catalog.json')),cards=Array.from({length:60},(_,i)=>({...catalog[i],id:'card-'+i,playerId:'card-'+i,cardInstanceId:'card-'+i,upgradeLevel:i%4,blocked:null}));
const boot=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/__review');await page.evaluate(cards=>{window.cards=cards;window.requests=[];window.messages=[];},cards);};
try {
 await boot();await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js'),{createLiberationController}=await import('/client/challenge/liberation-controller.js');
  const choices=[{territoryId:'t',challengeId:'battle',originalOwnerName:'盟友球队',originalOwnerId:'b',canLiberate:true}];
  window.store=createCampaignStore({playerId:'a',pendingLiberations:choices});window.controller=createLiberationController({documentRef:document,getState:store.getState,store,request:()=>async(url,opts)=>{requests.push({url,...opts});return {state:{playerId:'a',pendingLiberations:[]}};},territoryName:()=> '巴黎',onWorldChanged:()=>{},showToast:m=>messages.push(m)});controller.showBattle({challengeId:'battle'});
 });
 assert.equal(await page.locator('#battle-result-liberation [data-liberation-action]').count(),2);assert.equal(await page.locator('#campaign-liberation-notices [data-liberation-action]').count(),2);
 await page.screenshot({path:'outputs/performance-20260919/liberation-browser.png'});
 await page.locator('#battle-result-liberation [data-liberation-action="liberate"]').click();assert.equal(await page.locator('#campaign-liberation-notices').isHidden(),true);assert.equal(await page.evaluate(()=>requests[0].body.action),'liberate');report.liberation=true;
 await boot();await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js'),{createCoalitionController}=await import('/client/social/coalition-controller.js');
  window.store=createCampaignStore({playerId:'a',setupComplete:true,coalition:{army:{revision:1}}});
  window.view={serverNow:Date.now(),members:[{id:'a',name:'我'},{id:'b',name:'盟友球队'}],myCards:[],army:{id:'army',name:'同盟联军',revision:1,canCommand:true,commanderId:'a',commanderName:'我',territoryId:'a',busy:false,contributors:['a','b'],roster:[],loans:[],loanRequests:[]}};
  window.controller=createCoalitionController({getState:store.getState,campaignStore:store,metadata:new Map(),showToast:m=>messages.push(m),onOpenAirport:v=>window.airportTarget=v,getRequest:()=>async(url,opts)=>{
   if(opts?.body?.action==='loan-cards')return {view:{ownerId:'b',name:'盟友球队',cards}};
   if(opts){requests.push(opts.body);if(opts.body.action==='request-loan')view.army.loanRequests.push({id:'request',playerId:opts.body.playerId,playerName:'测试球员',ownerId:'b',requesterId:'a',status:'pending'});if(opts.body.action==='accept-loan')view.army.loanRequests=[];}
   return {view,state:store.getState()};
  }});await controller.open();
 });

 assert.equal(await page.locator('#coalition-request-notice').isVisible(),false);
 await page.evaluate(()=>store.setState({...store.getState(),coalitionCommandRequests:[{id:'req'}]}));
 assert.equal(await page.locator('#coalition-request-notice').isVisible(),true);
 await page.locator('#coalition-request-notice').click();
 assert.equal(await page.locator('[data-transfer-commander]').count(),1);
 await page.locator('[data-transfer-commander]').selectOption('b');
 await page.locator('[data-coalition-action="transfer-command"]').click();
 assert.equal(await page.evaluate(()=>requests.at(-1).action),'transfer-command');
 assert.equal(await page.evaluate(()=>requests.at(-1).targetId),'b');
 await page.evaluate(()=>store.setState({...store.getState(),coalitionCommandRequests:[]}));
 assert.equal(await page.locator('#coalition-request-notice').isVisible(),false);
 await page.locator('[data-tab="roster"]').click();report.hiddenNotices=true;report.directCommandTransfer=true;
 await page.locator('[data-loan-owner]').selectOption('b');await page.locator('[data-warehouse="coalition-ally-b"]').waitFor();
 await page.locator('[data-warehouse="coalition-ally-b"] [data-warehouse-filter="upgradeLevel"]').selectOption('3');
 const ids=await page.locator('[data-coalition-action="request-loan"]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.playerId.split('-').at(-1))));assert.ok(ids.length&&ids.every(i=>i%4===3));
 await page.locator('[data-coalition-action="request-loan"]').first().click();assert.equal(await page.evaluate(()=>requests.at(-1).action),'request-loan');
 await page.screenshot({path:'outputs/performance-20260919/coalition-loan-browser.png'});
 await page.evaluate(async()=>{controller.close();store.setState({playerId:'b',setupComplete:true,coalition:{army:{revision:2}}});view.army.canCommand=false;view.army.revision=2;await controller.open();});

 await page.locator('[data-tab="management"]').click();
 await page.locator('[data-coalition-action="request-command"]').click();
 assert.equal(await page.evaluate(()=>requests.at(-1).action),'request-command');report.commandRequest=true;
 await page.locator('[data-tab="roster"]').click();
 await page.locator('[data-coalition-action="accept-loan"]').click();assert.equal(await page.evaluate(()=>requests.at(-1).action),'accept-loan');report.loanApproval=true;
 await page.evaluate(async()=>{controller.close();store.setState({playerId:'a',setupComplete:true,coalition:{army:{revision:3}}});view.army.canCommand=true;view.army.revision=3;await controller.openActions();});
 await page.locator('[data-coalition-action="airport"]').click();assert.deepEqual(await page.evaluate(()=>airportTarget),{territoryId:'a',kind:'coalition',unitId:'army'});report.airportEntry=true;
 await boot();await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js'),{createAirportController}=await import('/client/buildings/airport-controller.js');window.store=createCampaignStore({playerId:'a'});
  window.controller=createAirportController({getState:store.getState,campaignStore:store,showToast:m=>messages.push(m),getRequest:()=>async(url,opts)=>{requests.push(opts.body);if(opts.body.action==='view')return {view:{name:'测试机场',gold:400,units:[{kind:'expedition',id:'expedition',name:'远征队'},{kind:'coalition',id:'army',name:'同盟联军'}],destinations:[{id:'b',name:'盟友机场'}]}};if(opts.body.action==='quote')return {quote:{goldCost:600,distanceKm:74,quoteId:'price',shares:[{ownerId:'a',name:'我',amount:300,balance:400},{ownerId:'b',name:'盟友',amount:300,balance:400}]}};return {state:{playerId:'a'}};}});await controller.open({territoryId:'a',kind:'coalition',unitId:'army'});
 });
 assert.equal(await page.locator('[data-unit]').inputValue(),'coalition:army');await page.locator('[data-action="quote"]').click();assert.equal(await page.locator('[data-action="depart"]').isEnabled(),true);assert.match(await page.locator('.airport-ticket').innerText(),/全体盟友均摊/);
 await page.screenshot({path:'outputs/performance-20260919/coalition-airport-browser.png'});
 await page.locator('[data-action="depart"]').click();assert.equal(await page.evaluate(()=>requests.at(-1).quoteId),'price');report.airportSplit=true;
 assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify(report));
} finally {fs.writeFileSync('outputs/performance-20260919/coalition-management-20260920-browser.json',JSON.stringify({...report,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
