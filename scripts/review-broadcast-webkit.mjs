import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {combinedPitchMarkup} from '../campaign-broadcast.js';
import {createStaticHandler} from '../server/http/static-handler.mjs';

const {chromium,webkit}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM || 'C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const diagnostic=process.argv.includes('--diagnose'),out='outputs/broadcast-webkit-review';
fs.mkdirSync(out,{recursive:true});
const links=process.argv.includes('--bundle')?'<link rel="stylesheet" href="/game-startup.css">':fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const catalog=JSON.parse(fs.readFileSync('assets/data/s4-player-catalog.json','utf8'));
const positions=[[50,90],[17,68],[39,68],[65,68],[85,68],[18,44],[43,44],[59,44],[82,44],[38,20],[66,20]];
const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
const teams=[0,1].map(side=>({name:side?'蓝队':'红队',formation:'4-4-2',players:positions.map(([x,y],i)=>({...catalog[i+side*11],assignedRole:roles[i],active:true,fitness:80,rating:6.5,captain:i===0,position:{x,y}}))}));
const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8">${links}</head><body><main class="map-stage" style="height:calc(100vh - 64px);margin-top:64px"><section id="campaign-broadcast" class="broadcast-overlay"><div class="broadcast-v2-content"><div class="broadcast-screen"><header class="broadcast-toolbar"><button class="button">退出观赛</button><div><b>黄狗风云比赛电视台</b><small>每日联赛</small></div></header><div class="broadcast-match-shell"><div class="scoreboard"><div><small>红队</small><b>3</b></div><span><small>下半场</small><strong>59′</strong><em>晴朗</em></span><div><small>蓝队</small><b>1</b></div></div><div class="broadcast-v2-layout"><section class="broadcast-v2-field-column"><header class="broadcast-v2-venue-head"><div><small>HOME STADIUM</small><h2>主体育场</h2></div></header><div class="broadcast-v2-stadium">${combinedPitchMarkup(teams)}</div></section><aside class="broadcast-v2-sidebar"><section class="broadcast-v2-commentary"><header><h2>实时战况</h2></header><div class="event-feed">59′ 比赛进行中</div></section><section class="broadcast-v2-data-panel"><header><h2>比赛数据</h2></header></section></aside></div></div></div></div></section></main></body></html>`;
fs.writeFileSync(out+'/pitch.html',html);
const serve=createStaticHandler(process.cwd());
const server=http.createServer((req,res)=>{if(req.url==='/review'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);}else serve(req,res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const reports=[];
try {
 for(const [name,type] of [['webkit',webkit],['chromium',chromium]]) {
  const browser=await type.launch({headless:true,...(name==='chromium'?{channel:'chrome'}:{})});
  try {
   const page=await browser.newPage({deviceScaleFactor:2}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   for(const viewport of [{width:1440,height:900},{width:1280,height:800},{width:1512,height:982},{width:1728,height:1117},{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);await page.goto('http://127.0.0.1:'+server.address().port+'/review');
    await page.evaluate(()=>document.fonts.ready);
    const metrics=await page.locator('.broadcast-card-magnet').evaluateAll(nodes=>nodes.map(node=>{
     const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
     const face=node.querySelector('.broadcast-card-face'),card=face.querySelector('.broadcast-shield-card'),rim=face.querySelector('.broadcast-card-team-rim'),path=rim.querySelector('path');
     return {button:rect(node),face:rect(face),card:rect(card),rim:rect(rim),path:rect(path)};
    }));
    const passed=metrics.length===22&&metrics.every(m=>m.face.w>0&&m.face.h>0&&Math.abs(m.face.w-m.button.w)<1&&Math.abs(m.rim.w-m.face.w)<1&&Math.abs(m.rim.h-m.face.h)<1&&m.path.w<=m.face.w+1&&m.path.h<=m.face.h+1&&Math.abs(m.card.w/m.card.h-26/35)<.01);
    reports.push({browser:name,viewport,passed,metrics,errors:[...errors]});
    await page.screenshot({path:`${out}/${diagnostic?'before':'after'}-${name}-${viewport.width}.png`});
    if(!diagnostic)assert.ok(passed&&errors.length===0,`${name} ${viewport.width}: card/rim layout`);
   }
  } finally {await browser.close();}
 }
} finally {
 fs.writeFileSync(`${out}/${diagnostic?'before':'after'}-report.json`,JSON.stringify(reports,null,2));
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(reports.map(({browser,viewport,passed,metrics})=>({browser,viewport,passed,sample:metrics[0]}))));
