import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startLocalServer} from '../test/helpers/local-server.js';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const out='outputs/league-divisions-20261116';fs.mkdirSync(out,{recursive:true});
const server=await startLocalServer({publicOnly:false});let browser;
try{
 const call=async(route,body,token)=>{const r=await fetch(server.url+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.ok(r.ok&&j.ok!==false,JSON.stringify(j));return j;};
 const account=await call('/api/versus/register',{nickname:'双级联赛测试',password:'isolated-only'}),identity={playerId:account.profile.id,accountToken:account.accountToken};
 await call('/api/versus/league/draft/start',{...identity,teamName:'双级验证队'});await call('/api/versus/league/draft/auto',identity);await call('/api/versus/league/draft/finish',identity);
 const admin=await call('/api/admin/login',{password:'isolated-test-password-only'});
 await call('/api/admin/league/cup/start',{},admin.token);
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:2560,height:1440}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(account=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');if(!localStorage.getItem('football_test1_versus_view_v1'))localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'overview'}));},account);
 await page.goto(server.url+'/versus/');await page.locator('.division-boards').waitFor();
 await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
 for(const d of ['A','B'])assert.equal(await page.locator(`[data-division="${d}"] tbody tr`).count(),8);
 const a=await page.locator('[data-division="A"]').boundingBox(),b=await page.locator('[data-division="B"]').boundingBox();
 assert.ok(Math.abs(a.y-b.y)<2&&b.x>a.x,'Desktop standings must appear side by side');
 assert.equal(await page.locator('[data-league-tab="seasonFinal"]').count(),0);
 assert.equal(await page.locator('tr.zone-promotion').count(),2);assert.equal(await page.locator('tr.zone-relegation').count(),2);
 await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));
 await page.screenshot({path:out+'/overview.png',fullPage:true});
 await page.screenshot({path:out+'/overview-compact.png'});
 await page.locator('[data-sidebar-open]').focus();await page.locator('[data-league-tab="cup"]').first().click();
 await page.locator('.ko-bracket-symmetric').waitFor();
 assert.ok(await page.locator('#yffm-cup-view-tree').isChecked());
 assert.equal(await page.locator('.ko-tree-scroll .ko-card').count(),15);
 await page.reload();await page.locator('.ko-bracket-symmetric').waitFor();
 for(const width of [1920,390]){
   await page.setViewportSize({width,height:900});
   assert.ok(await page.locator('.ko-tree-scroll').isVisible());
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.locator('label[for="yffm-cup-view-rounds"]').click();
 await page.locator('.knockout-stages').waitFor();assert.equal(await page.locator('[data-cup-stage="roundOf16"] .knockout-tie').count(),8);
 assert.equal(await page.locator('[data-cup-stage="roundOf16"] .knockout-leg').count(),16);assert.equal(await page.locator('[data-cup-page="league"]').count(),0);
 for(const width of [2560,1920,390]){
   await page.setViewportSize({width,height:900});
   const stages=await page.locator('.knockout-stage').all();
   for(let i=1;i<stages.length;i++){
     const before=await stages[i-1].boundingBox(),after=await stages[i].boundingBox();
     assert.ok(after.x>=before.x+before.width && Math.abs(after.y-before.y)<1);
   }
   const firstRound=stages[0].locator('.knockout-tie');
   const rows=await firstRound.evaluateAll(cards=>new Set(cards.map(c=>Math.round(c.getBoundingClientRect().y))).size);
   assert.equal(rows,8);
   if(width===390)assert.ok(await page.locator('.knockout-scroll').evaluate(el=>el.scrollWidth>el.clientWidth));
   const legs=page.locator('[data-cup-stage="roundOf16"] .knockout-leg');
   for(const leg of await legs.all()){
     const names=leg.locator('.competition-team-name'),badges=leg.locator('.competition-team-badges');
     const boxes=await Promise.all([names.nth(0),names.nth(1),badges.nth(0),badges.nth(1)].map(el=>el.boundingBox()));
     assert.ok(Math.abs(boxes[0].y-boxes[1].y)<1 && Math.abs(boxes[2].y-boxes[3].y)<1);
     const score=await leg.locator(':scope>b').boundingBox();
     const top=Math.min(boxes[2].y,boxes[3].y),bottom=Math.max(boxes[0].y+boxes[0].height,boxes[1].y+boxes[1].height);
     assert.ok(Math.abs(score.y+score.height/2-(top+bottom)/2)<1);
     const button=await leg.boundingBox();
     assert.ok(Math.abs(score.x+score.width/2-(button.x+button.width/2))<1);
     assert.ok(await names.first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
     assert.ok(await leg.locator(':scope>b').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=20));
     assert.ok(await leg.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   }
   const badge=legs.locator('.team-cosmetic-badge').first();
   const badgeHeight=(await badge.boundingBox()).height;
   assert.ok(badgeHeight>=38 && badgeHeight<=46);
 }
 await page.setViewportSize({width:1920,height:1080});
 await page.screenshot({path:out+'/cup.png',fullPage:true});
 await page.locator('[data-sidebar-open]').focus();await page.locator('[data-league-tab="overview"]').first().click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/overview-mobile.png',fullPage:true});
 const points=await page.locator('[data-division="A"] tbody tr').first().locator('td').last().boundingBox();assert.ok(points.x+points.width<=390,'Mobile points must remain visible');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/ui-verification.json',JSON.stringify({passed:true,divisions:2,teamsPerDivision:8,promotionRows:2,relegationRows:2,firstRoundTies:8,firstRoundLegs:16,seasonFinalHidden:true,mobileNoOverflow:true,errors},null,2));
 console.log('PASS: two tables, movement zones, 16-team cup, disabled season final and mobile layout');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:out+'/failure.png',fullPage:true});fs.writeFileSync(out+'/failure.html',await page.content());}throw error;}
finally{await browser?.close();await server.stop();}
