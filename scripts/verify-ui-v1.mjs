import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startLocalServer} from '../test/helpers/local-server.js';
const {chromium}=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');
const out='outputs/ui-v1';await fs.mkdir(out,{recursive:true});
const server=await startLocalServer({publicOnly:false});let browser;
try{
 const call=async(route,body,token)=>{const r=await fetch(server.url+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.ok(r.ok&&j.ok!==false,JSON.stringify(j));return j;};
 const account=await call('/api/versus/register',{nickname:'主场设计验证',password:'isolated-ui-check'}),identity={playerId:account.profile.id,accountToken:account.accountToken};
 await call('/api/versus/league/draft/start',{...identity,teamName:'海港竞技'});await call('/api/versus/league/draft/auto',identity);await call('/api/versus/league/draft/finish',identity);
 const admin=await call('/api/admin/login',{password:'isolated-test-password-only'});
 await call('/api/admin/league/cup/start',{},admin.token);
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(account=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'overview'}));},account);
 await page.goto(server.url+'/versus/');await page.locator('.club-home').waitFor();await page.waitForTimeout(400);
await page.screenshot({path:out+'/home-dark.png',fullPage:true});
 const summary=[];
 const inspect=async name=>{const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));summary.push({name,...size});};
 await inspect('home-dark');
 // Hover must never move the workspace. Explicit collapse may change its reserved width.
 const before=await page.locator('.league-page-content').boundingBox();await page.locator('.league-sidebar').hover();const after=await page.locator('.league-page-content').boundingBox();assert.equal(before.x,after.x);assert.equal(before.width,after.width);
 for (const division of ['A','B']) {
   const rows=page.locator('.home-standing .division-'+division+' tbody tr:visible');
   assert.equal(await rows.count(),8);
   assert.deepEqual(await rows.locator('td:first-child').allTextContents(),['1','2','3','4','5','6','7','8']);
 }
 await page.locator('[data-league-theme-toggle]').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/home-light.png',fullPage:true});
 await page.locator('[data-league-theme-toggle]').click();
 for(const tab of ['schedule','cup','squad','players','backpack','enhancement','club','shop','market','inbox','television','stats','predictions']){
  await page.locator(`#league-primary-nav [data-league-tab="${tab}"]`).click();await page.waitForTimeout(250);await inspect(tab);await page.screenshot({path:`${out}/${tab}.png`,fullPage:false});
 }
 await page.locator('#league-primary-nav [data-league-tab="overview"]').click();
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/home-mobile.png',fullPage:true});await inspect('home-mobile');
 assert.equal(await page.locator('.yffm-bottom-nav button').count(),5);
 for(const tab of ['schedule','squad','television','club']){
  await page.locator(`.yffm-bottom-nav [data-league-tab="${tab}"]`).click();await page.waitForTimeout(250);await inspect(tab+'-mobile');await page.screenshot({path:`${out}/${tab}-mobile.png`,fullPage:false});
 }
 await page.locator('.yffm-bottom-nav [data-league-tab="overview"]').click();
 await page.locator('[data-league-mobile-nav]').click();
 await page.locator('#league-primary-nav [data-league-tab="market"]').click();
 await page.locator('[data-market-section="ownership"]').click();
 assert.ok(await page.locator('.s4-market-board').isVisible());
 await page.locator('.yffm-bottom-nav [data-league-tab="overview"]').click();
 await page.locator('.home-calendar summary').click();
 assert.ok(await page.locator('.home-calendar').evaluate(el=>el.open));
 assert.equal(await page.locator('.home-standing tbody tr:visible').count(),16);
 assert.ok(summary.every(entry=>entry.scroll<=entry.width));
 await fs.writeFile(out+'/results.json',JSON.stringify({errors,summary},null,2));console.log(JSON.stringify({errors,summary},null,2));assert.deepEqual(errors,[]);
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:out+'/failure.png',fullPage:true});await fs.writeFile(out+'/failure.html',await page.content());}throw error;}
finally{await browser?.close();await server.stop();}
