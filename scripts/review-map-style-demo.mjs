import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let require=createRequire(import.meta.url),chromium;
try{({chromium}=require('playwright'));}catch{require=createRequire(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'));({chromium}=require('playwright'));}
const output=path.join(root,'outputs/map-style-demo');await fs.mkdir(output,{recursive:true});
const server=http.createServer(createStaticHandler(root));await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,page;
const report={checks:[],errors:[],failedResources:[],states:[]},loaded=new Set(),requests=[];
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 page=await browser.newPage({viewport:{width:1600,height:1050},deviceScaleFactor:1});
 page.on('request',r=>requests.push(r.url()));
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text().slice(0,1000));});
 page.on('response',r=>{if(r.status()>=400)report.failedResources.push({url:r.url(),status:r.status()});if(r.ok()&&r.url().endsWith('.glb'))loaded.add(new URL(r.url()).pathname);});
 await page.goto('http://127.0.0.1:'+server.address().port+'/map-style-demo.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.mapStyleDemo?.getState().ready,null,{timeout:90000});
 const state=()=>page.evaluate(()=>mapStyleDemo.getState());
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const capture=async name=>{await settle();await page.screenshot({path:path.join(output,name+'.png')});};
 const initial=await state();check('Seven facilities and terrain loaded',initial.stats.models===7&&initial.stats.terrainTriangles>90000);
 check('Forests appear on land',initial.stats.trees>1000);
 check('No game API requested',!requests.some(url=>new URL(url).pathname.startsWith('/api/')));
 await capture('overview');
 for(const view of ['club','mountains','port']){
  await page.locator('[data-view="'+view+'"]').click();check('Preset '+view,(await state()).view===view);await capture(view);
 }
 await page.locator('[data-view="club"]').click();
 for(const level of ['1','2','4','5','3']){
  await page.locator('#facility-level').selectOption(level);
  await page.waitForFunction(n=>mapStyleDemo.getState().level===n&&!document.querySelector('#facility-level').disabled,Number(level));
  check('Level '+level+' renders seven facilities',(await state()).stats.models===7);
  check('Level '+level+' labels synchronized',await page.locator('.map-label small').evaluateAll((nodes,n)=>nodes.length===7&&nodes.every(e=>e.textContent==='LV'+n),level));
  if(level==='1'||level==='5')await capture('club-lv'+level);
 }
 check('All 35 GLB models loaded',loaded.size===35);
 for(const angle of [55,45,50]){
  await page.locator('[data-angle="'+angle+'"]').click();
  check('Ground angle '+angle,(await state()).angle===angle);
  await capture('angle-'+angle);
 }
 await page.locator('#show-borders').uncheck();check('Hide boundaries',!(await state()).bordersVisible);
 await page.locator('#show-borders').check();check('Restore boundaries',(await state()).bordersVisible);
 await page.locator('#show-labels').uncheck();await settle();check('Hide labels',await page.locator('.map-label:visible').count()===0);
 await page.locator('#show-labels').check();await settle();check('Restore labels',await page.locator('.map-label:visible').count()>0);
 const point=await page.evaluate(()=>mapStyleDemo.projectSite('club-shop')),box=await page.locator('#map-canvas').boundingBox();
 let clicked=false;
 for(const [x,y]of [[0,0],[0,-12],[12,0],[-12,0],[0,12]]){await page.mouse.click(box.x+point.x+x,box.y+point.y+y);if((await state()).selected==='club-shop'){clicked=true;break;}}
 check('Real mesh picking opens club shop',clicked);
 check('Building card displays correct name',(await page.locator('#building-name').textContent())==='俱乐部商店');
 await capture('building-detail');
 await page.keyboard.press('Escape');check('Escape closes detail',await page.locator('#building-card').isHidden());
 const beforeZoom=(await state()).cameraZoom;
 await page.locator('#zoom-in').click();check('Zoom in',(await state()).cameraZoom>beforeZoom);
 await page.locator('#zoom-out').click();check('Zoom out',Math.abs((await state()).cameraZoom-beforeZoom)<.001);
 const beforePan=(await state()).cameraTarget;
 await page.mouse.move(800,730);await page.mouse.down();await page.mouse.move(910,775,{steps:8});await page.mouse.up();
 check('Map drag pans the camera',JSON.stringify(beforePan)!==JSON.stringify((await state()).cameraTarget));
 await page.locator('#reset').click();check('Reset overview and angle',(await state()).view==='overview'&&(await state()).angle===50&&(await state()).cameraZoom===1);
 await page.locator('[data-mode="legacy"]').click();check('Comparison mode',(await state()).mode==='legacy');
 check('Comparison is identified as illustrative',(await page.locator('#mode-note').textContent()).includes('非正式游戏截图'));
 await capture('comparison');
 await page.locator('[data-mode="enhanced"]').click();check('Restore improved map',(await state()).mode==='enhanced');
 for(const [width,height]of [[768,1024],[390,844],[320,740]]){
  await page.setViewportSize({width,height});await settle();
  check(width+'px page fits viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(width+'px controls fit',await page.locator('.control-panel').evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<innerHeight;}));
  for(const v of ['port','club']){await page.locator('[data-view="'+v+'"]').click();check(width+'px preset '+v,(await state()).view===v);}
  await capture('mobile-'+width);
 }
 await page.setViewportSize({width:1600,height:1050});await page.locator('#reset').click();await capture('overview');
 check('No browser / WebGL errors',report.errors.length===0);
 check('No failed assets',report.failedResources.length===0);
 report.finalState=await state();report.loadedModels=[...loaded];report.completedAt=new Date().toISOString();
 await fs.writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:report.checks.length,models:loaded.size,errors:report.errors,failedResources:report.failedResources,finalState:report.finalState},null,2));
}catch(e){
 report.failure=e.stack;
 if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
 await fs.writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));throw e;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
