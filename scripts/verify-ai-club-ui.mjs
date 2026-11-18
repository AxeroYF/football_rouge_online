import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startLocalServer} from '../test/helpers/local-server.js';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const out='outputs/ai-clubs-20261116';fs.mkdirSync(out,{recursive:true});
const server=await startLocalServer();let browser;
try {
 const post=async(route,body)=>{
  const response=await fetch(server.url+'/api/versus'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();assert.ok(result.ok!==false,JSON.stringify(result));return result;
 };
 const account=await post('/register',{nickname:'AI界面验证',password:'isolated-ui-test-only'});
 const identity={playerId:account.profile.id,accountToken:account.accountToken};
 await post('/league/draft/start',{...identity,teamName:'隔离测试队',formation:'4-3-3',style:'control'});
 for(let stage=0;stage<3;stage++)await post('/league/draft/reveal',{...identity,stage,attempt:1});
 await post('/league/draft/finish',{...identity,attempt:1});
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 await page.addInitScript(account=>{
  localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));
  sessionStorage.setItem('football_test1_versus_browser_session_v1','1');
  localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'overview'}));
 },account);
 // Only leaderboard display rows are synthetic; all club and training calls use the real server.
 await page.route('**/api/versus/league',async route=>{
  const response=await route.fetch();const json=await response.json();
  if(json.league){const rows=[{playerName:'同名球员',teamName:'AI测试队',isAi:true,appearances:1,goals:2},{playerName:'同名球员',teamName:'玩家测试队',isAi:false,appearances:1,goals:1}];json.league.leaderboards.scorers=rows;}
  await route.fulfill({response,json});
 });
 await page.goto(server.url+'/versus/');
 await page.locator('[data-league-team-detail]').first().waitFor();
 // Select a known AI slot; first slot has been claimed by the test player.
 await page.locator('[data-league-team-detail="ydl-team-2"]').first().click();
 await page.locator('.ai-club-boards').waitFor();
 assert.equal(await page.locator('.league-public-roster > div').count(),23);
 assert.equal(await page.locator('.ai-club-schemes details').count(),2);
 await page.locator('[data-ai-board="0"][data-ai-phase="leading"]').click();
 assert.match(await page.locator('[data-ai-plan="0"]').textContent(),/领先/);
 await page.locator('.ai-club-schemes details').nth(1).locator('summary').click();
 await page.locator('[data-ai-board="1"][data-ai-phase="trailing"]').click();
 assert.match(await page.locator('[data-ai-plan="1"]').textContent(),/落后/);
 await page.locator('.ai-club-boards').scrollIntoViewIfNeeded();
 await page.screenshot({path:out+'/club-dialog.png'});
 await page.locator('[data-close-league-dialog]').first().click();
 await page.locator('[data-sidebar-open]').focus();
 await page.locator('[data-league-tab="stats"]').first().click();
 await page.locator('[data-board-population="ai"]').click();
 assert.equal(await page.locator('.scope-league .ai-player-label').count(),1);
 assert.equal(await page.locator('.scope-league tbody tr').count(),1);
 await page.locator('[data-board-population="human"]').click();
 assert.equal(await page.locator('.scope-league .ai-player-label').count(),0);
 assert.match(await page.locator('.scope-league tbody').textContent(),/玩家测试队/);
 await page.locator('[data-sidebar-open]').focus();
 await page.locator('[data-league-tab="squad"]').first().click();
 await page.locator('[data-ai-training-open]').first().click();
 const opponent=page.locator('[data-ai-training-opponent]');
 assert.equal(await opponent.locator('option[value^="club:"]').count(),10);
 await opponent.selectOption('club:inter');
 await page.locator('[name="schemeIndex"]').selectOption('1');
 await page.locator('[name="upgradeLevel"]').selectOption('4');
 await page.locator('[name="trainingSeed"]').fill('ui-repeat');
 assert.equal(await page.locator('[name="trait1"]').isEnabled(),true);
 assert.equal(await page.locator('[name="trait2"]').isEnabled(),false);
 await page.locator('.league-dialog').screenshot({path:out+'/training-dialog.png'});
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/league/ai-training/start'));
 await page.locator('[data-ai-training-submit]').click();
 const response=await responsePromise;const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));
 assert.ok(value.actualAverageOverall>0);
 await page.locator('.broadcast-match-shell').waitFor();
 assert.deepEqual(errors,[]);
 await page.goto('file:///D:/YFFM1/outputs/ai-clubs-20261116/index.html');
 assert.equal(await page.locator('#club option').count(),10);
 for(let i=0;i<10;i++) {await page.locator('#club').selectOption(String(i));assert.equal(await page.locator('tbody tr').count(),23);await page.locator('#scheme').selectOption('1');await page.locator('#phase').selectOption('trailing');assert.equal(await page.locator('.player').count(),11);}
 await page.locator('#club').selectOption('0');await page.screenshot({path:out+'/review.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 fs.writeFileSync(out+'/ui-verification.json',JSON.stringify({passed:true,clubRoster:23,boards:2,clubTrainingOptions:10,realTrainingStarted:true,leaderboardLabelsAndFilters:true,reviewClubs:10,mobileReview:true,errors},null,2));
 console.log('PASS: real club detail, 23 players, dual boards, AI badges, filters, training launch and review page');
} catch(error) {
 const page=browser?.contexts()[0]?.pages()[0];
 if(page){await page.screenshot({path:out+'/ui-failure.png',fullPage:true});fs.writeFileSync(out+'/ui-failure.html',await page.content());console.log(await page.locator('body').innerText().then(s=>s.slice(-1800)));}
 throw error;
} finally {await browser?.close();await server.stop();}
