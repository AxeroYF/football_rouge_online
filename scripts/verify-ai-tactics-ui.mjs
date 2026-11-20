import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startLocalServer} from '../test/helpers/local-server.js';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const out='outputs/ai-tactics-ui-20261117';fs.mkdirSync(out,{recursive:true});
const server=await startLocalServer({publicOnly:false});let browser;
try{
  const post=async(path,body)=>{const r=await fetch(server.url+'/api/versus'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();assert.ok(r.ok&&j.ok!==false,JSON.stringify(j));return j;};
  const account=await post('/register',{nickname:'战术界面验证',password:'isolated-only'});
  const identity={playerId:account.profile.id,accountToken:account.accountToken};
  await post('/league/draft/start',{...identity,teamName:'战术验证队'});await post('/league/draft/auto',identity);await post('/league/draft/finish',identity);
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(account=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'overview'}));},account);
  await page.goto(server.url+'/versus/');
  const opponent=page.locator('.home-standing tr:not(.is-own) [data-league-team-detail]').first();
  const teamId=await opponent.getAttribute('data-league-team-detail');
  await opponent.click();await page.locator('[data-dossier-tab="ai"]').click();
  const boards=page.locator('.ai-club-boards');await boards.waitFor();
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));
  assert.equal(await boards.locator('.ai-scheme-card[open]').count(),2);
  const detail=(await post('/league/team/detail',{...identity,teamId})).team;
  for(const index of [0,1])for(const phase of ['leading','trailing','opening']){
    const button=boards.locator(`[data-ai-board="${index}"][data-ai-phase="${phase}"]`);
    await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');
    assert.equal(await boards.locator(`[data-ai-board="${index}"][aria-pressed="true"]`).count(),1);
    const expected=detail.aiSchemes[index].positionPresets[detail.aiSchemes[index].tacticalPlans[phase].positionPreset];
    const positions=await boards.locator(`[data-ai-pitch="${index}"] .league-public-magnet`).evaluateAll(nodes=>nodes.map(n=>[parseFloat(n.style.left),parseFloat(n.style.top)]));
    assert.deepEqual(positions,detail.aiSchemes[index].starters.map(p=>[expected[p.id].x,expected[p.id].y]));
  }
  await boards.locator('[data-ai-board="0"][data-ai-phase="leading"]').focus();await page.keyboard.press('Enter');
  assert.equal(await boards.locator('[data-ai-board="0"][data-ai-phase="leading"]').getAttribute('aria-pressed'),'true');
  await boards.screenshot({path:out+'/desktop-light.png'});
  await page.evaluate(()=>document.documentElement.dataset.leagueTheme='dark');await boards.screenshot({path:out+'/desktop-dark.png'});
  await page.setViewportSize({width:390,height:844});
  const overflow=await boards.evaluate(el=>el.scrollWidth>el.clientWidth);assert.equal(overflow,false);
  const boxes=await boards.locator('.ai-scheme-card').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,bottom:b.bottom,width:b.width};}));
  assert.ok(boxes[1].y>=boxes[0].bottom&&boxes.every(b=>b.x>=0&&b.x+b.width<=390));
  await boards.locator('.ai-scheme-card').first().screenshot({path:out+'/mobile.png'});
  await boards.locator('.ai-scheme-card').nth(1).screenshot({path:out+'/mobile-scheme-2.png'});
  const summary=boards.locator('.ai-scheme-card').first().locator('summary');await summary.click();assert.equal(await boards.locator('.ai-scheme-card[open]').count(),1);await summary.click();
  await boards.locator('.ai-club-notes summary').click();assert.ok(await boards.locator('.ai-club-notes[open]').count());
  assert.deepEqual(errors,[]);
  fs.writeFileSync(out+'/verification.json',JSON.stringify({passed:true,schemes:2,phasesPerScheme:3,positionChangesVerified:true,keyboard:true,lightAndDark:true,mobileNoOverflow:true,errors},null,2));
  console.log('PASS: two schemes, six phase positions, selection state, keyboard, folding, light/dark and mobile.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:out+'/failure.png',fullPage:true});throw error;}
finally{await browser?.close();await server.stop();}
