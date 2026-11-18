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
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(account=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'overview'}));},account);
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
 await page.locator('.knockout-stages').waitFor();assert.equal(await page.locator('[data-cup-stage="roundOf16"] .knockout-tie').count(),8);
 assert.equal(await page.locator('[data-cup-stage="roundOf16"] .knockout-leg').count(),16);assert.equal(await page.locator('[data-cup-page="league"]').count(),0);
 await page.screenshot({path:out+'/cup.png',fullPage:true});
 await page.locator('[data-sidebar-open]').focus();await page.locator('[data-league-tab="overview"]').first().click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/overview-mobile.png',fullPage:true});
 const points=await page.locator('[data-division="A"] tbody tr').first().locator('td').last().boundingBox();assert.ok(points.x+points.width<=390,'Mobile points must remain visible');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/ui-verification.json',JSON.stringify({passed:true,divisions:2,teamsPerDivision:8,promotionRows:2,relegationRows:2,firstRoundTies:8,firstRoundLegs:16,seasonFinalHidden:true,mobileNoOverflow:true,errors},null,2));
 console.log('PASS: two tables, movement zones, 16-team cup, disabled season final and mobile layout');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:out+'/failure.png',fullPage:true});fs.writeFileSync(out+'/failure.html',await page.content());}throw error;}
finally{await browser?.close();await server.stop();}
