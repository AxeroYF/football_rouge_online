import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {leagueFixture} from '../test/daily-league-fixture.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';
const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||'C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const t=leagueFixture({ten:true});t.start();const f=t.f;
const serve=createStaticHandler(process.cwd()),api=createCampaignApiHandler({campaign:f.s});
const links=fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html=legacy=>`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${legacy?links.replace(/<link[^>]*map-hud[^>]*>/,''):links}</head><body><main class="campaign-shell"><header class="topbar"><strong style="padding:12px;color:#dfc479">黄狗风云</strong><nav class="primary-nav"><button id="topbar-television">电视台</button></nav></header><div class="map-stage" style="background:radial-gradient(ellipse at 30% 60%,#395750,#203940)"><aside id="daily-league-sidebar" hidden><header><strong>每日联赛</strong><button id="daily-league-toggle" aria-expanded="false">展开</button></header></aside><section id="daily-league-window" class="standard-window" hidden></section><aside id="server-players" hidden></aside><section id="interaction-window" class="standard-window" hidden></section><div id="campaign-notifications" class="campaign-notifications" hidden><header class="notification-center-header"><strong>通知栏 <span data-notification-count>0</span></strong><button data-notification-toggle aria-expanded="true">收起</button></header><div id="campaign-notification-list" class="notification-center-list" tabindex="0"><section id="league-notifications" hidden></section><section id="interaction-notifications" hidden></section><section id="review-notifications">${Array.from({length:20},(_,i)=>`<article class="construction-notice"><header><strong>训练中心 · ${i+1}</strong></header><p>球员训练进行中</p><div class="construction-progress"><i style="width:60%"></i></div></article>`).join('')}</section></div></div></div></main></body></html>`;
const calls=[],errors=[],checks=[],legacy=[];
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/review-hud'){res.writeHead(200,{'content-type':'text/html'});res.end(html(u.searchParams.has('legacy')));}else if(u.pathname.startsWith('/api/')){calls.push({path:u.pathname,method:req.method});await api(req,res,u.pathname,u.href);}else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
const out='outputs/map-hud-review';fs.mkdirSync(out,{recursive:true});let page;
const buttons=['#daily-league-toggle','[data-players-toggle]','[data-notification-toggle]'];
async function setup(){await page.evaluate(async()=>{
 const {createCampaignStore}=await import('/client/core/campaign-store.js');const {createInteractionController}=await import('/client/social/interaction-controller.js');const {createDailyLeagueController}=await import('/client/league/daily-league-controller.js');const {createNotificationCenter}=await import('/client/buildings/notification-center.js');
 window.request=async(path,options={})=>{const r=await fetch(path,{method:options.method||'GET',headers:{authorization:'Bearer a','content-type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};
 window.store=createCampaignStore((await request('/api/campaign/state')).state);const common={getState:store.getState,getRequest:()=>request,campaignStore:store};
 window.social=createInteractionController({...common,root:document.querySelector('#interaction-window'),listRoot:document.querySelector('#server-players'),notices:document.querySelector('#interaction-notifications')});
 window.league=createDailyLeagueController({...common,root:document.querySelector('#daily-league-window'),trigger:document.querySelector('#daily-league-toggle'),tvTrigger:document.querySelector('#topbar-television'),notices:document.querySelector('#league-notifications')});
 window.center=createNotificationCenter(document.querySelector('#campaign-notifications'));await import('/client/ui/mobile-landscape.js');
 });await page.waitForSelector('[data-players-toggle]');await page.waitForTimeout(120);}
async function hits(){return page.evaluate(selectors=>selectors.map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {selector:s,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};}),buttons);}
async function assertEntries(label){const rows=await hits();assert.ok(rows.every(r=>r.hit&&r.inside),label+JSON.stringify(rows));checks.push(label);}
async function toggle(selector,open){const e=page.locator(selector);if((await e.getAttribute('aria-expanded')==='true')!==open)await e.click();}
try{
 for(const [width,height] of [[390,844],[844,390],[980,460]]){page=await browser.newPage({viewport:{width,height}});await page.goto(`http://127.0.0.1:${server.address().port}/review-hud?legacy`);await setup();legacy.push({size:[width,height],buttons:await hits()});await page.close();}
 for(const [name,width,height,isMobile] of [['phone',390,844,true],['small-phone',320,740,true],['phone-landscape',844,390,true],['desktop-mode',980,460,false],['desktop-mode-portrait',980,1800,false],['tablet',1024,768,true],['boundary',1280,720,false],['short-desktop',1440,500,false],['desktop',1440,1000,false]]){
  const context=await browser.newContext({viewport:{width,height},isMobile,hasTouch:name!=='desktop',deviceScaleFactor:isMobile?2:1});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/review-hud`);await setup();
  await toggle('[data-notification-toggle]',false);await toggle('[data-players-toggle]',false);await assertEntries(name+' collapsed entries reachable');
  await page.screenshot({path:out+'/'+name+'-entries.png',scale:'css'});
  await toggle('[data-players-toggle]',true);await assertEntries(name+' expanded players keeps all entries reachable');
  const list=page.locator('.server-player-list');const box=await list.boundingBox();assert.ok(box&&box.width>=Math.min(240,width-20)&&box.x>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,name+' player list bounds');
  await page.screenshot({path:out+'/'+name+'-players.png',scale:'css'});
  await toggle('[data-notification-toggle]',true);await assertEntries(name+' expanded notifications keeps all entries reachable');
  const notification=page.locator('#campaign-notification-list');const nr=await notification.boundingBox();assert.ok(nr&&nr.width>=Math.min(240,width-20)&&nr.x>=0&&nr.x+nr.width<=width+1&&nr.y+nr.height<=height+1,name+' notification bounds');
  assert.ok(await notification.evaluate(e=>{e.scrollTop=200;return e.scrollTop>0;}),name+' notification scroll');
  await toggle('[data-notification-toggle]',false);await toggle('[data-notification-toggle]',true);assert.ok(await notification.evaluate(e=>e.scrollTop>0),name+' notification scroll retained');
  await page.screenshot({path:out+'/'+name+'-notifications.png',scale:'css'});
  await page.locator('#daily-league-toggle').click();await page.locator('.league-table').waitFor();await page.locator('[data-league-tab="schedule"]').click();await page.locator('.league-fixture').first().waitFor();await page.screenshot({path:out+'/'+name+'-league.png',scale:'css'});await page.locator('[data-league-close]').click();await assertEntries(name+' entries restored after league closes');
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.ok(calls.every(c=>c.method==='GET'),'HUD never writes gameplay state');
 const report={passed:true,checks,legacy,errors,calls,scope:'Real Chrome, game CSS and three real controllers against an isolated campaign; touch and desktop viewport emulation, no physical mobile browser'};fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:checks.length,legacy,errors}));
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:e.stack,checks,legacy,errors},null,2));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
