import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const baseline=process.argv.includes('--baseline'),out='outputs/optimization-r30/map-drag-'+(baseline?'before':'after');fs.mkdirSync(out,{recursive:true});
const f=coalitionFixture();f.s.developmentTools=true;f.s.setDevelopmentFog(f.a,false);const api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd());
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/campaign/'))await api(req,res,u.pathname,u.href);else await serve(req,res);}catch(e){res.writeHead(e.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 await page.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__dragReview={map,getLayer:()=>campaignThreeLayer};'});});
 await page.goto('http://127.0.0.1:'+server.address().port+'/versus/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__dragReview?.getLayer()&&document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:120000});
 const report=await page.evaluate(async()=>{
  const {map,getLayer}=window.__dragReview,layer=getLayer();layer.setSuspended(false);map.setMaxBounds(null);map.setView([48,10],4,{animate:false});
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const observations=[];let previous=layer.getStats().renderedFrames;
  const sample=()=>{const current=layer.getStats().renderedFrames;observations.push({renderedInMove:current>previous,frames:current});};
  map.on('move',sample);
  // Leaflet's drag and inertia update mapPane inside RAF; observe in that same callback.
  for(let i=0;i<24;i++)await new Promise(resolve=>requestAnimationFrame(()=>{previous=layer.getStats().renderedFrames;map.panBy([i%2? -65:80,i%3?12:-24],{animate:false});resolve();}));
  map.off('move',sample);
  const settled=layer.getStats().renderedFrames;await new Promise(r=>setTimeout(r,350));
  return {observations,moves:observations.length,lateFrames:observations.filter(x=>!x.renderedInMove).length,idleFrames:layer.getStats().renderedFrames-settled,stats:layer.getStats()};
 });
 await page.screenshot({path:out+'/settled.png'});
 await page.evaluate(()=>{
  const {map,getLayer}=window.__dragReview,original=map.fire;
  window.__pointerFrames=[];
  map.fire=function(type,...args){const before=getLayer().getStats().renderedFrames;const result=original.call(this,type,...args);if(type==='move')window.__pointerFrames.push(getLayer().getStats().renderedFrames>before);return result;};
 });
 const box=await page.locator('#campaign-map').boundingBox();assert.ok(box);
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
 for(const [x,y] of [[.8,.6],[.3,.4],[.7,.7],[.45,.45]])await page.mouse.move(box.x+box.width*x,box.y+box.height*y,{steps:5});
 await page.mouse.up();await page.waitForTimeout(500);
 await page.mouse.wheel(0,-180);await page.waitForTimeout(900);
 report.pointer=await page.evaluate(()=>({moves:window.__pointerFrames.length,lateFrames:window.__pointerFrames.filter(v=>!v).length}));
 await page.setViewportSize({width:1100,height:760});await page.waitForTimeout(200);
 report.suspension=await page.evaluate(async()=>{
  const {map,getLayer}=window.__dragReview,layer=getLayer();layer.setSuspended(true);const before=layer.getStats().renderedFrames;
  map.panBy([30,10],{animate:false});const paused=layer.getStats().renderedFrames===before;
  layer.setSuspended(false);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return {paused,resumed:layer.getStats().renderedFrames>before};
 });
 await page.evaluate(()=>{window.__dragReview.map.setView([48,10],4,{animate:false});});await page.waitForTimeout(300);
 await page.screenshot({path:out+'/after-pointer.png'});
 fs.writeFileSync(out+'/report.json',JSON.stringify({...report,errors},null,2));console.log(JSON.stringify({...report,observations:undefined,errors}));
 assert.deepEqual(errors,[]);assert.ok(report.moves>=24);if(baseline)assert.ok(report.lateFrames>0);else {assert.equal(report.lateFrames,0);assert.ok(report.pointer.moves>5);assert.equal(report.pointer.lateFrames,0);assert.deepEqual(report.suspension,{paused:true,resumed:true});}
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
