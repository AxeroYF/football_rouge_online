import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startLocalServer} from '../test/helpers/local-server.js';
import {AI_CLUBS} from '../versus/public/ai-club-config.js';
import {CLUB_BADGES} from '../versus/cosmetic-items.js';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const out='outputs/club-badges-20261117';fs.mkdirSync(out,{recursive:true});
const server=await startLocalServer({publicOnly:false});let browser;
try{
  const call=async(route,body,token)=>{
    const r=await fetch(server.url+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    const j=await r.json();assert.ok(r.ok&&j.ok!==false,JSON.stringify(j));return j;
  };
  const join=async nickname=>{
    const account=await call('/api/versus/register',{nickname,password:'isolated-only'});
    const identity={playerId:account.profile.id,accountToken:account.accountToken};
    await call('/api/versus/league/draft/start',{...identity,teamName:nickname});
    await call('/api/versus/league/draft/auto',identity);await call('/api/versus/league/draft/finish',identity);
    return {account,identity};
  };
  const {account,identity}=await join('有装饰球队');await join('无装饰球队');
  for(const itemId of ['country-badge-argentina','club-badge-real-madrid'])await call('/api/versus/league/cosmetics/equip',{...identity,itemId});
  const admin=await call('/api/admin/login',{password:'isolated-test-password-only'});
  await call('/api/admin/league/cup/start',{},admin.token);
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:2200,height:1200}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(account=>{
    localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));
    sessionStorage.setItem('football_test1_versus_browser_session_v1','1');
    localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'overview'}));
  },account);
  await page.goto(server.url+'/versus/');await page.locator('.division-boards').waitFor();
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
  await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));
  const urls=AI_CLUBS.map(club=>CLUB_BADGES.find(b=>b.clubName===club.name).imageUrl);
  const loaded=await page.evaluate(async urls=>Promise.all(urls.map(async url=>{const img=new Image();img.src=url;await img.decode();return img.naturalWidth>0;})),urls);
  assert.equal(loaded.filter(Boolean).length,16);
  assert.equal(await page.locator('img[src*="ai-team-badge"]').count(),0);
  const rows=page.locator('.league-match-centre>section').first().locator('.league-result');
  assert.equal(await rows.count(),8);
  const check=async()=>{
    const cells=await rows.locator(':scope > b').evaluateAll(elements=>elements.map(el=>{
      const cell=el.getBoundingClientRect(),name=el.querySelector('.competition-team-name').getBoundingClientRect();
      return {name:el.textContent,delta:Math.abs(cell.x+cell.width/2-name.x-name.width/2),badges:el.querySelectorAll('img').length,overflow:el.scrollWidth>el.clientWidth+1};
    }));
    assert.equal(cells.length,16);assert.ok(cells.every(c=>c.delta<1&&!c.overflow),JSON.stringify(cells));
    assert.equal(cells.find(c=>c.name==='无装饰球队').badges,0);
    assert.equal(cells.find(c=>c.name==='有装饰球队').badges,2);
    assert.ok(cells.filter(c=>!c.name.includes('装饰')).every(c=>c.badges===1));
    return cells;
  };
  const desktop=await check();
  await page.locator('.recent-panel').screenshot({path:out+'/fixtures-desktop.png'});
  await page.setViewportSize({width:1400,height:1000});await check();
  await page.locator('.recent-panel').screenshot({path:out+'/fixtures-medium.png'});
  await page.setViewportSize({width:390,height:844});const mobile=await check();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('.recent-panel').screenshot({path:out+'/fixtures-mobile.png'});
  await page.setViewportSize({width:1600,height:1100});
  await page.locator('[data-sidebar-open]').focus();await page.locator('[data-league-tab="cup"]').first().click();
  await page.locator('.knockout-stages').waitFor();
  assert.equal(await page.locator('[data-cup-stage="roundOf16"] .competition-team-identity').count(),32);
  await page.screenshot({path:out+'/cup.png',fullPage:true});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(out+'/ui-verification.json',JSON.stringify({passed:true,clubCrestsLoaded:16,desktop,mobile,errors},null,2));
  console.log('PASS: 16 real club crests; AI, decorated and undecorated names centered at 2200/1400/390px; cup and mobile verified.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:out+'/failure.png',fullPage:true});fs.writeFileSync(out+'/failure.html',await page.content());}throw error;}
finally{await browser?.close();await server.stop();}
