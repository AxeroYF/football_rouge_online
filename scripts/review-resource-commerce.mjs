import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/resource-commerce-review');fs.mkdirSync(out,{recursive:true});
const links=fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8">${links}</head><body><button id="open-shop">商店</button><div id="review-list"></div><div id="review-notices"></div><section id="interaction-window" class="standard-window" hidden></section><section id="shop-window" class="standard-window" hidden></section></body></html>`;
const serve=createStaticHandler(root),server=http.createServer((req,res)=>{if(req.url==='/review.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);}else serve(req,res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));const check=(name,value)=>{checks.push({name,pass:Boolean(value)});assert.ok(value,name);};
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/review.html`);
 await page.evaluate(async()=>{
  const {createInteractionController}=await import('/client/social/interaction-controller.js'),{createCampaignStore}=await import('/client/core/campaign-store.js'),{createShopController}=await import('/client/shop/shop-controller.js'),{createPlayerCardViewModel}=await import('/shared/player-card/player-card-contract.js');
  const card=id=>createPlayerCardViewModel({id,playerId:id,name:'测试传奇 '+id,grade:'S',role:'CM',pool:'MID',overall:92,attributes:{passing:92},upgradeLevel:3});
  window.view={player:{id:'b',nickname:'对方经理',teamName:'对方俱乐部',color:'#468d75'},selfId:'a',gold:120000,oil:200,relationship:'neutral',myCards:[card('a1')],theirCards:[card('b1')],squad:{unavailable:true,players:[]},requests:[],events:[],matches:[],targetAllianceMembers:[],allianceMembers:[],rules:{maxTradeGold:1000000000,maxTradeOil:1000000}};
  window.store=createCampaignStore({playerId:'a',setupComplete:true,interactions:{players:[],events:[],requests:[],news:[]}});window.posts=[];
  window.interaction=createInteractionController({root:document.querySelector('#interaction-window'),listRoot:document.querySelector('#review-list'),notices:document.querySelector('#review-notices'),getState:store.getState,campaignStore:store,getRequest:()=>async(url,options)=>{if(options)posts.push(options.body);return {view,state:store.getState()};}});
  window.shopView={gold:0,oil:200,serverNow:Date.now(),refreshAt:Date.now()+7200000,rotationId:'r1',packs:[],offers:[1,2,3].map(i=>({id:'offer'+i,price:100000,oilPrice:150,sold:false,player:card('s'+i)}))};
  window.shop=createShopController({root:document.querySelector('#shop-window'),trigger:document.querySelector('#open-shop'),getState:store.getState,campaignStore:store,getRequest:()=>async(url,options)=>{if(options){posts.push(options.body);shopView.offers.find(o=>o.id===options.body.itemId).sold=true;shopView.oil-=150;return {shop:shopView,state:store.getState(),purchase:{name:'测试传奇'}};}return {shop:shopView};}});
  interaction.open('b');
 });
 await page.locator('[data-interaction-action="trade-form"]').click();
 await page.locator('[data-trade-oil="give"]').fill('20');await page.locator('[data-trade-gold="take"]').fill('800');await page.locator('[data-trade-card="give"]').check();
 check('oil and gold are editable in the same quote',await page.locator('[data-trade-oil="give"]').inputValue()==='20');
 await page.screenshot({path:path.join(out,'resource-trade.png')});
 await page.locator('[data-interaction-action="trade-gift"]').click();
 check('gift mode clears requested resources while preserving outgoing assets',await page.evaluate(()=>!document.querySelector('[data-trade-gold="take"]')&&document.querySelector('[data-trade-oil="give"]').value==='20'&&document.querySelector('[data-trade-card="give"]').checked));
 await page.locator('[data-interaction-trade] button[type="submit"]').click();
 await page.waitForFunction(()=>posts.length===1);
 check('gift submits oil and player without requesting payment',await page.evaluate(()=>posts[0].trade.mode==='gift'&&posts[0].trade.giveOil===20&&posts[0].trade.giveCardIds[0]==='a1'&&posts[0].trade.takeGold===0&&posts[0].trade.takeOil===0&&posts[0].trade.takeCardIds.length===0));
 await page.locator('[data-interaction-action="trade-form"]').click();await page.locator('[data-trade-gold="give"]').fill('100');await page.locator('[data-trade-oil="take"]').fill('5');await page.locator('[data-interaction-trade] button[type="submit"]').click();
 await page.waitForFunction(()=>posts.length===2);check('exchange submits both resource directions',await page.evaluate(()=>posts[1].trade.mode==='trade'&&posts[1].trade.giveGold===100&&posts[1].trade.takeOil===5));
 await page.locator('[data-interaction-action="gift-form"]').click();check('player homepage has a direct gift entry',await page.locator('[data-interaction-trade]').textContent().then(t=>t.includes('赠送资源与球员')));
 await page.evaluate(()=>{interaction.close();shop.open();});await page.locator('[data-shop-currency="oil"]').first().waitFor();
 check('oil can purchase when gold cannot',await page.locator('[data-shop-currency="oil"]').first().isEnabled()&&await page.locator('[data-shop-buy="player"]:not([data-shop-currency])').first().isDisabled());
 await page.screenshot({path:path.join(out,'legend-oil.png')});
 await page.locator('[data-shop-currency="oil"]').first().click();await page.waitForFunction(()=>posts.length===3);
 check('oil button sends explicit oil payment',await page.evaluate(()=>posts[2].currency==='oil'&&posts[2].kind==='player'));
 check('sale disables the shared gold stock and removes its oil purchase',await page.locator('[data-shop-offer="offer1"] [data-shop-buy]').isDisabled()&&await page.locator('[data-shop-offer="offer1"] [data-shop-currency="oil"]').count()===0);
 check('wallet refresh reflects oil spending',await page.locator('[data-shop-wallet]').textContent().then(t=>t.includes('50 石油')));
 await page.evaluate(async()=>{
  shop.close();
  const {createExpeditionPanelController}=await import('/client/map/expedition-panel-controller.js');
  const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'],roster=[],assignments={},squads={};
  for(const squad of ['expedition','garrison']){
   const starters=roles.map((role,i)=>{const id=squad+i;roster.push({id,name:(squad==='expedition'?'远征':'留守')+'球员'+i,role,pool:i===0?'GK':i<5?'DEF':i<9?'MID':'ATT',overall:80,grade:'B',state:{fitness:100}});assignments[id]=squad;return id;});
   squads[squad]={starters,formation:'4-4-2'};
  }
  store.setState({...store.getState(),draft:{teamName:'体力检查俱乐部',roster},playerSquads:{assignments},tactics:{activeSquadId:'garrison',squads},expeditionPiece:{territoryId:'home'},expeditionFitness:{players:Object.fromEntries(roster.map(p=>[p.id,{fitness:p.id.startsWith('expedition')?48:100,recoveryPerMinute:0.5}]))}});
  const root=document.createElement('aside');root.id='expedition-panel';document.body.append(root);
  window.expedition=createExpeditionPanelController({root,mapElement:document.body,getState:store.getState,campaignStore:store});expedition.open();
 });
 check('map expedition panel shows expedition live fitness with garrison tab active',await page.locator('[data-expedition-fitness]').allTextContents().then(v=>v.length===11&&v.every(t=>t==='48')));
 check('map expedition panel does not list garrison players',!(await page.locator('#expedition-panel').textContent()).includes('留守球员'));
 await page.evaluate(()=>{const state=store.getState();store.setState({...state,expeditionFitness:{players:{...state.expeditionFitness.players,expedition0:{fitness:61,recoveryPerMinute:0.5}}}});});
 check('an open expedition panel updates on a live fitness refresh',await page.locator('[data-expedition-player-id="expedition0"] [data-expedition-fitness]').textContent()==='61');
 await page.screenshot({path:path.join(out,'expedition-fitness.png')});
 check('no browser runtime errors',errors.length===0);
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.pass).length,output:out}));
