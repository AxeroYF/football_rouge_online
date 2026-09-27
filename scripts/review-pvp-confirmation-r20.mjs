import assert from 'node:assert/strict';
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/pvp-confirmation-r20-review';fs.mkdirSync(out,{recursive:true});
const f=coalitionFixture(),api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd());
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))await api(req,res,u.pathname,u.href);else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];let page;
const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name);};
const inView=async selector=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
try{
 const context=await browser.newContext({viewport:{width:696,height:320},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/versus/?renderer=leaflet');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 const open=async id=>{await page.locator('#mobile-menu-toggle').tap();await page.locator(id).tap();};
 await open('#topbar-coalition');await page.locator('[data-coalition-action="create"]').tap();await page.locator('[data-coalition-action="lend"]').first().waitFor();
 for(const size of [{width:696,height:320},{width:800,height:390},{width:1236,height:540}]){
  await page.setViewportSize(size);await page.waitForTimeout(100);
  check(size.width+' coalition fits viewport',await inView('.coalition-window'));
  await page.screenshot({path:out+'/'+size.width+'-coalition.png',scale:'css'});
  await page.locator('[data-tab="management"]').tap();await page.locator('[data-transfer-commander]').selectOption('b');
  check(size.width+' command transfer reachable',await page.locator('[data-coalition-action="transfer-command"]').isVisible());
  await page.locator('[data-tab="roster"]').tap();
 }
 await page.setViewportSize({width:696,height:320});
 check('advanced filters collapsed on phones',await page.locator('[data-warehouse="coalition-mine"] [data-warehouse-filter="upgradeLevel"]').isHidden());
 await page.locator('[data-warehouse="coalition-mine"] [data-warehouse-expand]').tap();
 check('advanced filters can expand',await page.locator('[data-warehouse="coalition-mine"] [data-warehouse-filter="upgradeLevel"]').isVisible());
 await page.locator('[data-warehouse="coalition-mine"] [data-warehouse-expand]').tap();
 await page.locator('[data-pane="allies"]').tap();check('ally pane available',await page.locator('[data-loan-owner]').isVisible());
 await page.locator('[data-pane="lineup"]').tap();check('lineup pane available',await page.locator('.coalition-lineup').isVisible());
 await page.locator('[data-pane="mine"]').tap();
 const lend=page.locator('[data-coalition-action="lend"]').first();const id=await lend.getAttribute('data-player-id');await lend.tap();await page.waitForFunction(()=>document.querySelectorAll('[data-warehouse="coalition-roster"] .social-warehouse-card').length===1);
 check('touch loan reaches real latest coalition API',f.s.coalitions.find(f.a).loans.some(l=>l.playerId===id));
 await page.evaluate(async()=>{const {confirmPvpAttack}=await import('/client/challenge/pvp-confirmation.js');window.__paid=null;confirmPvpAttack({shares:Array.from({length:12},(_,i)=>({name:'盟友'+i,amount:2500}))}).then(v=>window.__paid=v);});
 await page.locator('[data-pvp-confirm]').waitFor();check('long guarantee footer stays in viewport',await inView('[data-pvp-confirm]'));
 check('guarantee footer is above coalition and touch reachable',await page.locator('[data-pvp-confirm]').evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
 await page.screenshot({path:out+'/696-guarantee.png',scale:'css'});
 check('native back consumes top confirmation',await page.evaluate(()=>window.yellowdogsMobileBack()));
 check('native back cancels guarantee',await page.evaluate(()=>window.__paid===false));check('parent coalition stays open',await page.locator('.coalition-window').isVisible());
 check('next native back closes coalition',await page.evaluate(()=>window.yellowdogsMobileBack()));check('coalition closed',await page.locator('.coalition-window').isHidden());
 await page.locator('#mobile-menu-toggle').tap();check('native back closes navigation',await page.evaluate(()=>window.yellowdogsMobileBack()));check('navigation is closed',await page.locator('.primary-nav').isHidden());
 await page.locator('.mobile-map-tools').tap();check('native back closes map tools',await page.evaluate(()=>window.yellowdogsMobileBack()));
 const loginContext=await browser.newContext({viewport:{width:696,height:320},isMobile:true,hasTouch:true,deviceScaleFactor:3});const login=await loginContext.newPage();login.on('pageerror',e=>errors.push(e.message));await login.goto(url+'/versus/?renderer=leaflet');await login.locator('#entry-auth-form input').first().waitFor();
 await login.locator('#entry-auth-form input').first().tap();await login.setViewportSize({width:696,height:180});await login.locator('#entry-auth-form input').first().fill('横屏测试');await login.locator('.entry-primary').scrollIntoViewIfNeeded();
 check('keyboard-sized login button reachable',await login.locator('.entry-primary').evaluate(e=>{const r=e.getBoundingClientRect();return r.y>=0&&r.bottom<=innerHeight;}));
 check('keyboard-sized shell stays pinned',await login.locator('.campaign-shell').evaluate(e=>Math.abs(e.getBoundingClientRect().y)<1));
 await login.screenshot({path:out+'/696-keyboard-login.png',scale:'css'});
 for(const size of [{width:1440,height:900},{width:696,height:320}]){
  await page.setViewportSize(size);
  for(const accept of [false,true]){
   await page.evaluate(async()=>{const {confirmPvpAttack}=await import('/client/challenge/pvp-confirmation.js');window.__paid=null;const blocker=document.createElement('div');blocker.id='qa-map-layer';blocker.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:auto;background:#1232';document.body.append(blocker);confirmPvpAttack({conquest:{limit:9,playerLimit:4}}).then(v=>{window.__paid=v;blocker.remove();});});
   const button=page.locator(accept?'[data-pvp-confirm]':'.pvp-attack-confirmation [data-small-window-close]');
   check(size.width+' dialog is browser top layer',await page.locator('.pvp-attack-confirmation').evaluate(e=>e.matches(':modal')));
   check(size.width+' button is unobstructed '+accept,await button.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
   check(size.width+' wonder-aware confirmation', (await page.locator('.pvp-confirmation-copy').innerText()).includes('9 块'));
   if(accept)await page.screenshot({path:out+'/'+size.width+'-confirmation.png',scale:'css'});
   await button.tap();check(size.width+' real tap resolves '+accept,await page.evaluate(expected=>window.__paid===expected,accept));
   check(size.width+' modal removed',await page.locator('.pvp-attack-confirmation').count()===0);
  }
 }
 check('no browser exceptions',errors.length===0);
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,scope:'Real Chrome touch emulation, isolated latest API; 44 CSS pixel rail allowance. Native Android device not authorized.'},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
