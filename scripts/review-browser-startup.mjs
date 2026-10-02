import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'));
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/r48-startup-review');fs.mkdirSync(out,{recursive:true});
const handler=createStaticHandler(root),requests=[];
const server=http.createServer((req,res)=>{requests.push(req.url);setTimeout(()=>handler(req,res),120);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const report=[];
try{
 for(const [name,url,size]of [['source','/index.html',{width:1280,height:800}],['bundle','/versus/',{width:1280,height:800}],['phone','/versus/',{width:390,height:844}]]){
  const page=await browser.newPage({viewport:size}),errors=[];page.on('pageerror',e=>errors.push(e.message));requests.length=0;
  const begin=Date.now();await page.goto(`http://127.0.0.1:${server.address().port}${url}`,{waitUntil:'domcontentloaded'});
  await page.locator('#entry-auth-form').waitFor();const firstMs=Date.now()-begin;
  const code=requests.filter(u=>/\.(?:js|mjs|css)(?:\?|$)/.test(u));
  assert.equal(errors.length,0);if(name!=='source')assert.equal(code.length,4,'One game bundle, one stylesheet, theme and Leaflet');
  await page.screenshot({path:path.join(out,name+'.png')});requests.length=0;
  const again=Date.now();await page.reload({waitUntil:'domcontentloaded'});await page.locator('#entry-auth-form').waitFor();
  const repeatCode=requests.filter(u=>/\.(?:js|mjs|css)(?:\?|$)/.test(u));
  if(name!=='source')assert.ok(!repeatCode.some(u=>u.includes('game-startup.')),'Versioned bundles reused without requests');
  report.push({name,firstMs,repeatMs:Date.now()-again,codeRequests:code.length,repeatCodeRequests:repeatCode.length,errors});await page.close();
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,latencyPerRequestMs:120,report},null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
