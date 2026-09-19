import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/war-notices-review');fs.mkdirSync(out,{recursive:true});
const links=fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8">${links}<style>body{margin:0;background:#214737}#review-map{position:relative;height:calc(100vh - 96px);margin-top:80px}#review-notices{position:absolute;right:24px;top:0;width:360px}#review-list{display:none}</style></head><body><div id="review-map"><aside id="scouting-window" class="scouting-window has-scout-pools"><div class="scouting-surface"><header class="scouting-header"><h2>球探</h2><button>×</button></header><div class="scouting-content" data-scout-content></div><footer class="facility-actions" hidden></footer></div></aside><div id="review-notices"></div><div id="review-list"></div><section id="review-interaction" hidden></section></div></body></html>`;
const serve=createStaticHandler(root),server=http.createServer((req,res)=>{if(req.url==='/review.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);}else serve(req,res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1366,height:768},deviceScaleFactor:1}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,condition,detail)=>{checks.push({name,pass:Boolean(condition),detail});assert.ok(condition,name+': '+JSON.stringify(detail));};
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/review.html`);
 await page.evaluate(async()=>{
  const {scoutingDetailMarkup}=await import('/client/buildings/scouting-controller.js'),{SCOUTING_RULES,scoutingLevel}=await import('/shared/config/scouting.mjs');
  window.drawScout=(neutral=false,rounds=1)=>{document.querySelector('[data-scout-content]').innerHTML=scoutingDetailMarkup({kind:'unit',canDiscover:!neutral,neutralTerritory:neutral,scout:{id:'u',name:'Oliver Reed',level:2,status:'idle',movableTerritoryIds:['next']},rules:SCOUTING_RULES,levelRules:scoutingLevel(2),coreCountry:true,country:'德国',territoryLabel:'德国 · 黑森州'},{gold:50000,queueRounds:rounds});};drawScout(true);
  const {createInteractionController}=await import('/client/social/interaction-controller.js'),{createCampaignStore}=await import('/client/core/campaign-store.js');
  const news=Array.from({length:3},(_,i)=>({id:'n'+i,text:'俱乐部攻下了测试地块 '+i,createdAt:Date.now()}));
  window.store=createCampaignStore({playerId:'me',setupComplete:true,interactions:{news,events:[{id:'e0',from:'other',to:'me',type:'war',createdAt:Date.now()}],requests:[],players:[{id:'me',teamName:'测试俱乐部',self:true,ready:true},{id:'other',teamName:'对方俱乐部',ready:true}]}});
  window.requests=[];window.toasts=[];window.stateWrites=0;store.subscribe(()=>stateWrites++);
  createInteractionController({root:document.querySelector('#review-interaction'),listRoot:document.querySelector('#review-list'),notices:document.querySelector('#review-notices'),getState:store.getState,campaignStore:store,getRequest:()=>((url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))),showToast:t=>toasts.push(t)});
 });
 for(const [width,height] of [[1600,900],[1366,768],[1280,720]]){
  await page.setViewportSize({width,height});
  for(const neutral of [true,false])for(const rounds of [1,20]){
   await page.evaluate(([neutral,rounds])=>drawScout(neutral,rounds),[neutral,rounds]);
   const m=await page.evaluate(()=>{const content=document.querySelector('[data-scout-content]'),panel=document.querySelector('#scouting-window'),button=document.querySelector('[data-scout-start]');const c=content.getBoundingClientRect(),b=button.getBoundingClientRect();return {height:content.clientHeight,scroll:content.scrollHeight,bottom:b.bottom,panelBottom:panel.getBoundingClientRect().bottom,button:button.textContent,disabled:button.disabled,pies:[...document.querySelectorAll('.scout-pool-pie')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),fits:b.bottom<=c.bottom&&content.scrollHeight<=content.clientHeight+1};});
   check(`scout ${width}x${height}, neutral=${neutral}, rounds=${rounds}`,m.fits&&m.pies.every(p=>p.width>60&&p.height>60),m);
  }
 }
 await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>drawScout(true));await page.screenshot({path:path.join(out,'compact-scout.png')});
 const immediate=await page.evaluate(()=>{const start=performance.now();document.querySelector('[data-world-news="n0"] button').click();return {elapsed:performance.now()-start,hidden:!document.querySelector('[data-world-news="n0"]'),requests:requests.length,writes:stateWrites};});
 check('notice disappears synchronously before request resolves',immediate.hidden&&immediate.requests===1&&immediate.writes===0,immediate);
 const concurrent=await page.evaluate(()=>{document.querySelector('[data-world-news="n1"] button').click();document.querySelector('[data-notice-event="e0"] button').click();return {count:requests.length,visible:document.querySelectorAll('#review-notices article').length};});
 check('multiple acknowledgements do not block each other',concurrent.count===3&&concurrent.visible===1,concurrent);
 await page.evaluate(()=>store.setState({...store.getState()}));check('stale poll cannot revive pending notices',await page.locator('#review-notices article').count()===1);
 await page.evaluate(()=>{requests[0].resolve({acknowledged:true});requests[1].resolve({acknowledged:true});requests[2].reject(Error('模拟保存失败'));});
 await page.waitForFunction(()=>toasts.length===1);check('failed save restores only failed notice',await page.locator('#review-notices article').count()===2);
 const retry=await page.evaluate(()=>{document.querySelector('[data-notice-event="e0"] button').click();return requests[2].options.body.requestId===requests[3].options.body.requestId;});check('failed acknowledgement reuses idempotency key',retry);
 await page.evaluate(()=>requests[3].resolve({acknowledged:true}));
 await page.evaluate(()=>store.setState({...store.getState()}));check('successful read stays hidden through stale poll',await page.locator('#review-notices article').count()===1);
 check('acknowledgements never write the full campaign state',await page.evaluate(()=>stateWrites)===2);
 await page.evaluate(()=>{document.querySelector('[data-world-news="n2"] button').click();store.setState({...store.getState(),playerId:'another'});requests[4].reject(Error('过期账号错误'));});
 await page.waitForTimeout(20);check('account switch drops old hidden notices and failures',await page.locator('#review-notices article').count()===4&&await page.evaluate(()=>toasts.length)===1);
 check('no browser runtime errors',errors.length===0,errors);
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.pass).length,output:out}));
