import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startLocalServer} from '../test/helpers/local-server.js';
const require=createRequire(import.meta.url);
const {chromium}=process.env.PLAYWRIGHT_REQUIRE_FROM?createRequire(path.resolve(process.env.PLAYWRIGHT_REQUIRE_FROM,'package.json'))('playwright'):require('playwright');
const server=await startLocalServer();let browser;
const output=path.resolve('outputs/browser-review');await fs.mkdir(output,{recursive:true});
const reports=[];
try {
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url+'/versus/');await page.locator('#auth-form').waitFor();
  if(!(await page.title()).includes('YFFM1'))throw new Error('Wrong product title');
  await page.locator('[data-auth-mode="register"]').click();
  await page.locator('#auth-nickname').fill('Browser'+viewport.width);await page.locator('#auth-password').fill('browser-test-password');
  await page.locator('#auth-form button[type="submit"]').click();await page.locator('#open-league').waitFor();
  await page.locator('#open-league').click();await page.waitForFunction(()=>!!document.querySelector('.league-join, .league-draft, #league-team-name')||document.querySelector('#app')?.textContent.includes('球队名称'));
  await page.screenshot({path:path.join(output,viewport.width+'.png'),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(errors.length||overflow)throw new Error(JSON.stringify({viewport,errors,overflow}));
  reports.push({viewport,errors,overflow});await context.close();
 }
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
}finally{await browser?.close();await server.stop();}
