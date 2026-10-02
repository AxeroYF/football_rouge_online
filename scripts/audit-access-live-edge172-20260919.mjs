import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');const {chromium}=require('playwright');
const out='outputs/access-live-edge172-20260919';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP yellowdogsleague.online 172.67.189.119']});const report={at:new Date().toISOString(),scope:'Public production URLs only. Fresh contexts; no account login, cookies, or existing browser profile.',cases:[]};
try{for(const mode of ['desktop']){
 const context=await browser.newContext(mode==='desktop'?{viewport:{width:1600,height:1000}}:{viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const page=await context.newPage(),errors=[],failed=[],responses=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}));page.on('response',r=>responses.push({path:new URL(r.url()).pathname,status:r.status()}));
 const start=performance.now();let navigationError=null;try{await page.goto('https://yellowdogsleague.online/versus/',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(10000);}catch(e){navigationError=e.message}
 const ui=await page.evaluate(()=>({title:document.title,authForm:!!document.querySelector('#entry-auth-form'),entryText:document.querySelector('#campaign-entry')?.innerText??'',loaderText:document.querySelector('#map-loader')?.innerText??'',resourceCount:performance.getEntriesByType('resource').length})).catch(e=>({error:e.message}));
 const row={mode,elapsedMs:Math.round(performance.now()-start),navigationError,ui,errors,failed,responses};report.cases.push(row);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(out,mode+'.png')}).catch(()=>{});console.log(JSON.stringify(row));await context.close();
}}finally{await browser.close()}
