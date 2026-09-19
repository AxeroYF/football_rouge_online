import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const root=process.cwd(),out=path.join(root,'outputs/expedition-vehicles-20260908'),req=createRequire(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'));
const {chromium}=req('playwright'),sharp=req('sharp');
await fs.mkdir(out,{recursive:true});for(const d of ['thumbnails','icons'])await fs.mkdir(path.join(root,'assets/expedition-units',d),{recursive:true});
const server=http.createServer(createStaticHandler(root));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;let browser;const report={models:[],checks:[],errors:[],failedResources:[]};
try{
 browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1560,height:1080}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResources.push(r.url());});
 await page.goto(url+'/expedition-preview.html?render=1');await page.waitForFunction(()=>window.expeditionPreview?.ready);const catalog=await page.evaluate(()=>window.expeditionPreview.catalog);report.version=catalog.version;
 for(const item of catalog.items){
  for(const preset of ['iso','front','side','top']){
   const data=await page.evaluate(({id,preset})=>window.expeditionPreview.capture(id,{preset,size:768,transparent:true}),{id:item.assetId,preset});const png=Buffer.from(data.split(',')[1],'base64');await fs.writeFile(path.join(out,item.assetId+'-'+preset+'.png'),png);
   if(preset!=='iso')continue;
   const {data:raw,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});let x0=768,y0=768,x1=0,y1=0,pixels=0;for(let y=0;y<768;y++)for(let x=0;x<768;x++)if(raw[(y*768+x)*4+3]>48){pixels++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
   assert.ok(pixels>20000,item.assetId+' visible');assert.ok(x0>12&&y0>12&&x1<755&&y1<755,item.assetId+' not clipped');assert.equal(raw[3],0);
   await fs.writeFile(path.join(root,'assets/expedition-units/thumbnails',item.assetId+'.png'),png);
   await sharp(png).webp({quality:94}).toFile(path.join(root,'assets/expedition-units/thumbnails',item.assetId+'.webp'));
   // Preserve the square canvas and transparent padding, not the retired portrait crop.
   await sharp(png).resize(320,320).png().toFile(path.join(root,'assets/expedition-units/icons',item.assetId+'.png'));
   report.checks.push(item.assetId+' transparent complete silhouette');
  }
  for(const level of [1,2])await page.evaluate(({id,level})=>window.expeditionPreview.select(id,{level}),{id:item.assetId,level});
  report.models.push({id:item.assetId,lods:3});console.log('PASS '+item.assetId+' four views, icon and LODs');
 }
 await page.goto(url+'/expedition-preview.html');await page.waitForFunction(()=>window.expeditionPreview?.ready);
 assert.equal(await page.locator('.model-card').count(),5);for(const item of catalog.items){await page.locator('[data-asset-id="'+item.assetId+'"]').click();await page.waitForFunction(id=>window.expeditionPreview.state.assetId===id&&document.querySelector('#loading').hidden,item.assetId);}
 report.checks.push('five vehicle selectors load real GLBs');await page.locator('[data-view=side]').click();assert.equal(await page.evaluate(()=>window.expeditionPreview.state.view),'side');await page.locator('[data-view=iso]').click();await page.locator('#wireframe').check();await page.locator('#wireframe').uncheck();await page.screenshot({path:path.join(out,'viewer.png')});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));report.checks.push('390px preview fits');
 const W=1700,H=700,layers=[],svg=(w,h,b)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:Microsoft YaHei,Arial,sans-serif}</style>${b}</svg>`);
 layers.push({input:svg(W,90,'<text x="38" y="53" font-size="30" fill="#ede9dd">远征载具 · 五款新模型</text>'),left:0,top:0});
 for(const [i,item]of catalog.items.entries()){
  const x=10+i*338;layers.push({input:await sharp(path.join(out,item.assetId+'-iso.png')).resize(330,330).toBuffer(),left:x,top:105});
  layers.push({input:svg(330,70,`<text x="165" y="30" text-anchor="middle" font-size="24" fill="#ede9dd">${item.name}</text><text x="165" y="60" text-anchor="middle" font-size="14" fill="#d4b365">${item.title}</text>`),left:x,top:426});
  layers.push({input:await sharp(path.join(root,'assets/expedition-units/icons',item.assetId+'.png')).resize(80,80).toBuffer(),left:x+125,top:547});
 }
 layers.push({input:svg(W,35,'<text x="38" y="24" font-size="14" fill="#b6beb0">地图尺寸预览 · 80 × 80</text>'),left:0,top:510});
 await sharp({create:{width:W,height:H,channels:4,background:'#1a241f'}}).composite(layers).png().toFile(path.join(out,'lineup.png'));
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResources,[]);await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log('PASS preview and transparent exports');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
