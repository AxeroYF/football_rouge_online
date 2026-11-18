import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startLocalServer} from '../test/helpers/local-server.js';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const out='outputs/prematch-fitness-ui-20261117';fs.mkdirSync(out,{recursive:true});
const server=await startLocalServer({publicOnly:false});let browser;
try{
  const post=async(path,body)=>{const r=await fetch(server.url+'/api/versus'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();assert.ok(r.ok&&j.ok!==false,JSON.stringify(j));return j;};
  const account=await post('/register',{nickname:'赛前红线验证',password:'isolated-only'});
  const identity={playerId:account.profile.id,accountToken:account.accountToken};
  await post('/league/draft/start',{...identity,teamName:'轮换验证队'});await post('/league/draft/auto',identity);await post('/league/draft/finish',identity);
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(account=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'squad'}));},account);
  await page.goto(server.url+'/versus/');
  const input=page.getByRole('spinbutton',{name:'赛前体力红线'});await input.waitFor();
  for(const threshold of [100,65]){
    const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/league/team')&&r.ok());
    await input.fill(String(threshold));await input.press('Tab');await saved;
    await page.reload();await input.waitFor();assert.equal(await input.inputValue(),String(threshold));
  }
  const boundary=await page.evaluate(async()=>{const m=await import('/versus/fitness-rules.js');return [m.belowFitnessThreshold(64.6,65),m.belowFitnessThreshold(65,65),m.belowFitnessThreshold(99,100)];});
  assert.deepEqual(boundary,[true,false,true]);
  await page.locator('.league-board-fitness').screenshot({path:out+'/desktop.png'});
  await page.setViewportSize({width:390,height:844});
  const box=await input.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=390);
  await page.locator('.league-board-fitness').screenshot({path:out+'/mobile.png'});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(out+'/verification.json',JSON.stringify({passed:true,autosaveAndReload:[100,65],boundary,mobileControlVisible:true,errors},null,2));
  console.log('PASS: fitness threshold autosave/reload, shared boundary rules and mobile control.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:out+'/failure.png',fullPage:true});throw error;}
finally{await browser?.close();await server.stop();}
