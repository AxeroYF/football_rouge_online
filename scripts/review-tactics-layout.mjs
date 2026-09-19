import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/tactics-layout-20260914';fs.mkdirSync(out,{recursive:true});
const f=coalitionFixture(),catalog=JSON.parse(fs.readFileSync('assets/data/s4-player-catalog.json','utf8'));
for(let i=0;i<9;i++){const p={...structuredClone(catalog.filter(p=>!p.isX)[i]),id:'bench-'+i,playerId:'bench-'+i,cardDefinitionId:'bench-'+i};f.a.draft.roster.push(p);f.a.playerSquads.assignments[p.id]='expedition';}
for(const p of f.a.draft.roster){p.name=(catalog.find(x=>x.role===p.role)??catalog[0]).name;}
f.s.save();
const command=(account,action,extra={})=>{const army=f.s.coalitions.find(account);return f.s.coalitions.mutate(account,{action,armyId:army?.id,revision:army?.revision,requestId:crypto.randomUUID(),...extra});};
command(f.a,'create');for(const p of f.a.draft.roster.slice(0,6))command(f.a,'lend',{playerId:p.id});for(const p of f.b.draft.roster.slice(6,11))command(f.b,'lend',{playerId:p.id});command(f.a,'auto-lineup');
const state=f.s.state(f.a),view=f.s.coalitions.view(f.a);
const links=fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8">${links}</head><body><div id="map" class="map-stage" style="height:100vh"><section id="campaign-tactics" class="campaign-tactics" hidden></section></div></body></html>`;
const serve=createStaticHandler(process.cwd()),server=http.createServer((req,res)=>{if(req.url==='/review.html'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);}else serve(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/review.html');
 await page.evaluate(async({state,view})=>{localStorage.setItem('ydl-tactics-piece-display','cards');const {createTacticsController}=await import('/tactics-page.js');window.tactics=createTacticsController({panel:document.getElementById('campaign-tactics'),mapElement:document.getElementById('map'),getCampaignState:()=>state,setCampaignState:()=>{},request:async path=>{if(path==='/api/campaign/coalition')return {view};throw Error('Unexpected mutation '+path);},showToast:()=>{}});await tactics.open();},{state,view});
 for(const [width,height] of [[2200,1241],[1920,1080],[1600,900],[1366,768],[2560,1440]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const metrics=await page.evaluate(()=>{
   const panel=document.getElementById('campaign-tactics'),bench=panel.querySelector('.league-bench'),title=bench.querySelector('header b'),status=bench.querySelector('[data-league-autosave-label]'),detail=panel.querySelector('.league-tactics-detail'),head=detail.querySelector(':scope>header');
   const controls=[...head.querySelectorAll('select,button')].filter(e=>e.getBoundingClientRect().width),rects=controls.map(e=>e.getBoundingClientRect());
   const overlaps=rects.some((a,i)=>rects.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
   return {benchWidth:bench.clientWidth,titleHeight:title.getBoundingClientRect().height,titleLineHeight:parseFloat(getComputedStyle(title).lineHeight),statusFits:status.scrollWidth<=status.clientWidth+1,columnsFit:[...panel.querySelector('.league-lineup-workspace').children].every(e=>e.getBoundingClientRect().right<=innerWidth&&e.getBoundingClientRect().left>=0),detailFits:detail.scrollWidth<=detail.clientWidth+1,controlsFit:rects.every(r=>r.left>=head.getBoundingClientRect().left&&r.right<=head.getBoundingClientRect().right),overlaps,benchCards:bench.querySelectorAll('[data-league-bench-magnet]').length,fieldsColumns:getComputedStyle(panel.querySelector('.league-match-plan-fields')).gridTemplateColumns.split(' ').length};
  });
  checks.push({width,height,...metrics});assert.ok(metrics.benchWidth>=298&&metrics.titleHeight<30&&metrics.statusFits&&metrics.columnsFit&&metrics.detailFits&&metrics.controlsFit&&!metrics.overlaps&&metrics.benchCards===9&&metrics.fieldsColumns===2,JSON.stringify(checks.at(-1)));
  await page.screenshot({path:out+'/tactics-'+width+'.png'});
 }
 await page.locator('[data-lineup-squad="garrison"]').click();await page.locator('[data-lineup-squad="garrison"].active').waitFor();
 await page.locator('[data-lineup-squad="coalition"]').click();await page.locator('[data-lineup-squad="coalition"].active').waitFor();
 assert.equal(await page.locator('[data-lineup-squad]').count(),3);assert.equal(await page.locator('[data-league-magnet]').count(),11);assert.equal(errors.length,0);
 console.log(JSON.stringify({passed:true,checks,squadSwitches:true,errors}));
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
