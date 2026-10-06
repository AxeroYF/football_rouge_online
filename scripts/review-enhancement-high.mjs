import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||'C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/enhancement-high-live-review';fs.mkdirSync(out,{recursive:true});
const staticHandler=createStaticHandler(process.cwd());
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles/player-card.css"><link rel="stylesheet" href="/styles/player-card-shield.css"><style>*{box-sizing:border-box}body{margin:0;background:#0e0c12;color:#eee;font-family:'Microsoft YaHei',sans-serif;padding:24px}h1{font-size:25px;font-weight:500;margin:0 0 8px}p{color:#aaa;font-size:12px}#cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px;margin-top:25px}article{min-width:0}h2{text-align:center;font-size:15px;font-weight:500}.s4-player-card{width:100%}#static{width:115px;margin:30px auto}.spacer{height:110vh}@media(max-width:700px){body{padding:12px}#cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}h2{font-size:12px}h1{font-size:19px}}</style></head><body><h1>+9 / +10 · 真实组件动效兼容检查</h1><p>红金底图、异色边框、原版流星雨 / 星际穿越 · 卡画在边框上方 · 全特性无编号</p><main id="cards"></main><div id="static"></div><div class="spacer"></div></body></html>`;
const server=http.createServer((req,res)=>{if(req.url==='/review'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);}else staticHandler(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try{
 const page=await browser.newPage({viewport:{width:1460,height:950},deviceScaleFactor:1.5});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/review`);
 await page.evaluate(async()=>{
  const {createCardMotionController}=await import('/client/player-card/card-motion-controller.js');let roll=0;
  window.motion=createCardMotionController({document,random:()=>[.1,.25,.9,.25][roll++%4]});document[Symbol.for('yellowdogs.card-motion-controller')]=window.motion;
  // Observe actual rendering calls: warp paints a radial haze; meteors do not.
  const get=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(...args){const ctx=get.apply(this,args);if(ctx&&!ctx.modeTracked){ctx.modeTracked=true;this.dataset.observedMode='meteor';const radial=ctx.createRadialGradient.bind(ctx);ctx.createRadialGradient=(...a)=>{this.dataset.observedMode='warp';return radial(...a);};}return ctx;};
  const {playerCardMarkup}=await import('/client/player-card/player-card.js');const catalog=await fetch('/assets/data/s4-player-catalog.json').then(r=>r.json());const p=catalog.find(p=>p.id==='legend-messi');
  const traits=['铁血蓝白','本质大心脏','借过一下','全能战士'];
  window.highCards=[9,9,10,10].map((level,i)=>({...p,id:'review-'+i,cardInstanceId:'review-'+i,upgradeLevel:level,effectiveOverall:96+(level===9?15:17),traits:traits.slice(0,level===9?3:4)}));
  document.querySelector('#cards').innerHTML=window.highCards.map((p,i)=>`<article><h2>+${p.upgradeLevel} · ${i%2?'星际穿越':'流星雨'}</h2>${playerCardMarkup(p,{eager:true})}</article>`).join('');
  document.querySelector('#static').innerHTML=playerCardMarkup(window.highCards[3],{animated:false,eager:true});
  await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));
 });
 await page.waitForFunction(()=>[...document.querySelectorAll('#cards canvas')].every(c=>c.width>1&&c.dataset.observedMode));
 await page.waitForTimeout(300);
 const metrics=await page.locator('#cards .player-card-shield').evaluateAll(cards=>cards.map(c=>{
  const q=s=>c.querySelector(s),z=s=>Number(getComputedStyle(q(s)).zIndex),b=q('.s4-player-card-upgrade').getBoundingClientRect(),r=c.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(q('.s4-player-card-upgrade'));const text=range.getBoundingClientRect();
  return {mode:q('canvas').dataset.observedMode,traits:c.querySelectorAll('.shield-card-trait-row').length,folds:c.querySelectorAll('.shield-card-trait-more').length,canvas:z('canvas'),background:z('.shield-card-background'),rim:z('.shield-card-rim'),portrait:z('.s4-player-card-profile'),gloss:z('.shield-card-enhancement-gloss'),width:b.width/r.width,height:b.height/r.height,offset:Math.abs(text.y+text.height/2-b.y-b.height/2),backgroundUrl:q('.shield-card-background').getAttribute('src'),animation:getComputedStyle(q('.shield-card-enhancement-gloss')).animationPlayState};
 }));
 check('both levels retain real meteor and warp canvases',metrics.map(m=>m.mode).join(',')==='meteor,warp,meteor,warp');
 check('3/4 traits fully visible without folding',metrics.every((m,i)=>m.traits===(i<2?3:4)&&m.folds===0));
 check('background < particles < frame and gloss < legendary portrait',metrics.every(m=>m.background<m.canvas&&m.canvas<m.rim&&m.rim<m.portrait&&m.gloss<m.portrait));
 check('badge keeps original dimensions and centered digits',metrics.every(m=>Math.abs(m.width-.14)<.001&&Math.abs(m.height-.076)<.001&&m.offset<2));
 check('new redgold backgrounds and running shared-visibility highlights',metrics.every(m=>m.backgroundUrl.endsWith('s-redgold-background.svg')&&m.animation==='running'));
 check('static card creates no background canvas or gloss',await page.locator('#static canvas,#static .shield-card-enhancement-gloss').count()===0);
 const before=await page.locator('#cards canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL()));await page.waitForTimeout(240);const after=await page.locator('#cards canvas').evaluateAll(cs=>cs.map(c=>c.toDataURL()));check('all four existing particle animations continue drawing',before.every((v,i)=>v!==after[i]));
 await page.screenshot({path:out+'/desktop-effects.png'});
 await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>window.motion.inspect().active===0);
 check('offscreen backgrounds stop the single animation loop',await page.evaluate(()=>!window.motion.inspect().running));
 check('offscreen border highlights pause too',await page.locator('#cards .shield-card-enhancement-gloss').evaluateAll(es=>es.every(e=>getComputedStyle(e).animationPlayState==='paused')));
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>window.motion.inspect().active===4);
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!window.motion.inspect().running);
 check('reduced motion stops particles and high-grade gloss',await page.locator('#cards .shield-card-enhancement-gloss').evaluateAll(es=>es.every(e=>getComputedStyle(e).animationName==='none')));
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1024,height:768}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(100);
  check(`${viewport.width}x${viewport.height} page fits`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(`${viewport.width}x${viewport.height} all trait labels remain untruncated`,await page.locator('.shield-card-trait').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)));
  await page.screenshot({path:out+`/${viewport.width}x${viewport.height}.png`});
 }
 await page.evaluate(()=>document.querySelector('#cards').remove());await page.waitForFunction(()=>window.motion.inspect().cards===0);check('removing cards releases all particles and stops RAF',await page.evaluate(()=>!window.motion.inspect().running));
 check('no broken images',await page.locator('img').evaluateAll(es=>es.every(e=>e.complete&&e.naturalWidth>0)));check('no browser errors',errors.length===0);
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,checks,metrics,errors},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,out}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
