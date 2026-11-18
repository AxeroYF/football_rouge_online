import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {startV4StreamLab} from './serve-v4-stream-lab.mjs';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {createHash} from 'node:crypto';
const packagePath=process.env.PLAYWRIGHT_PACKAGE_PATH??'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json';
const {chromium}=createRequire(packagePath)('playwright');
const output=path.resolve('outputs/v4-stream-20261117');fs.mkdirSync(output,{recursive:true});
const real=process.argv.includes('--real'),source=real?readLeagueSource(process.cwd()):null;
const entries=['scripts/verify-v4-stream-lab.mjs','scripts/serve-v4-stream-lab.mjs','versus/v4-stream/producer.js','versus/v4/engine.js','versus/v4-stream/lab/index.html','versus/v4-stream/lab/style.css','versus/v4-stream/lab/app.js','versus/v4-stream/playback.js'];
const sourceHashes=dependencyHashes(entries);
const input=real?compileRealMatch(source,{homeId:source.teams[0].id,awayId:source.teams[1].id,fixtureId:'stream-real-proof',duration:90,seed:'stream-real-proof'}).input:null;
if(input)input.format='clip';
const homePlayer=real?`0:${input.teams[0].players[1].id}`:'0:p2',awayPlayer=real?`1:${input.teams[1].players[1].id}`:'1:p2',prefix=real?'real-':'';
const lab=await startV4StreamLab({port:0,duration:90,manualPublication:true,input});let browser;const errors=[];
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(lab.url);await page.waitForSelector('body[data-ready="true"]');assert.equal(await page.locator('#player option').count(),1);
  await lab.publishUntil(10);await page.waitForFunction(()=>document.querySelector('#player').options.length>=23);
  assert.equal(await page.locator('body').getAttribute('data-owner'),'null');await page.selectOption('#player',homePlayer);assert.match(await page.locator('#task').innerText(),/公开位置/);
  await page.click('#play');await page.waitForFunction(()=>Number(document.body.dataset.time)>0.5);await page.click('#play');const paused=await page.locator('body').getAttribute('data-time');
  await page.waitForTimeout(250);assert.equal(await page.locator('body').getAttribute('data-time'),paused);
  await page.selectOption('#speed','64');await page.uncheck('#slow');await page.click('#play');await page.waitForFunction(()=>Number(document.body.dataset.time)>=Number(document.querySelector('#timeline').max));assert.ok(Number(await page.locator('body').getAttribute('data-time'))<=10);
  await page.selectOption('#view','home');await page.waitForFunction(()=>document.body.dataset.owner==='0');await page.selectOption('#player',homePlayer);assert.match(await page.locator('#task').innerText(),/体能/);
  await page.selectOption('#player',awayPlayer);assert.match(await page.locator('#task').innerText(),/公开位置/);
  while(!lab.production){assert.equal(lab.producerError,null);await page.waitForTimeout(100);}
  await lab.publishUntil(90);await page.waitForFunction(()=>Number(document.querySelector('#timeline').max)===90);
  await page.locator('#timeline').fill('45');await page.waitForFunction(()=>Math.abs(Number(document.body.dataset.time)-45)<.01);
  await context.setOffline(true);await page.waitForTimeout(1200);assert.match(await page.locator('#connection').innerText(),/连接|重试/);const retained=await page.locator('#score').innerText();
  await context.setOffline(false);await page.waitForTimeout(1200);assert.equal(await page.locator('#score').innerText(),retained);
  await page.click('#live');await page.waitForFunction(()=>Number(document.body.dataset.time)>=88);await page.click('#play');
  await page.screenshot({path:path.join(output,`${prefix}stream-desktop.png`),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,`${prefix}stream-mobile.png`),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  assert.deepEqual(dependencyHashes(entries),sourceHashes);
  const report={passed:true,dependencyHashes:sourceHashes,
    desktop:true,mobile:true,paused:true,releaseBoundary:true,privateOwnerView:true,seek:true,reconnect:true,catchUp:true,errors,production:lab.production,archive:lab.directory};
  if(real){assert.equal(await page.locator('#home-name').innerText(),input.teams[0].name);for(const [name,expected] of Object.entries(source.sourceRevisions))assert.equal(createHash('sha256').update(fs.readFileSync(path.join('data',name))).digest('hex'),expected);report.realSnapshot=true;report.sourceUnchanged=true;report.sourceFingerprint=source.fingerprint;}
  fs.writeFileSync(path.join(output,`${prefix}stream-browser-verification.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await lab.stop();}
