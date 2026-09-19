import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let req=createRequire(import.meta.url),chromium,sharp;
try{({chromium}=req('playwright'));sharp=req('sharp');}catch{
  req=createRequire(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'));
  ({chromium}=req('playwright'));sharp=req('sharp');
}
const output=path.join(root,'outputs/wonder-model-review');await fs.mkdir(output,{recursive:true});
const server=http.createServer(createStaticHandler(root));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1480,height:1080},deviceScaleFactor:1});
const report={url:base,models:[],interactionChecks:[],errors:[],failedResources:[]};
page.on('response',r=>{if(r.status()>=400)report.failedResources.push({url:r.url(),status:r.status()});});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
try{
  await page.goto(base+'/wonder-preview.html');await page.waitForFunction(()=>window.wonderPreview?.ready,{timeout:30000});
  const catalog=await page.evaluate(()=>window.wonderPreview.catalog);report.materialVersion=catalog.version;
  await fs.mkdir(path.join(root,'assets/wonders/thumbnails'),{recursive:true});await fs.mkdir(path.join(root,'assets/wonders/icons'),{recursive:true});
  for(const item of catalog.items){
    const uri=await page.evaluate(id=>window.wonderPreview.capture(id,{size:512,transparent:true}),item.assetId);
    const png=Buffer.from(uri.split(',')[1],'base64');
    await fs.writeFile(path.join(root,'assets/wonders/thumbnails',item.assetId+'.png'),png);
    await sharp(png).flatten({background:'#f8f7f0'}).webp({quality:88}).toFile(path.join(root,'assets/wonders/thumbnails',item.assetId+'.webp'));
    await sharp(png).resize(256,256).png().toFile(path.join(root,'assets/wonders/icons',item.assetId+'.png'));
    const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let visible=0;for(let i=3;i<data.length;i+=4)if(data[i]>40)visible++;
    if(visible<800)throw new Error(item.assetId+' rendered empty');
    for(const level of [1,2])await page.evaluate(({id,level})=>window.wonderPreview.select(id,{level}),{id:item.assetId,level});
    report.models.push({assetId:item.assetId,visiblePixels:visible,width:info.width,height:info.height,glbLevelsLoaded:3});
    console.log(item.id+' rendered '+item.name);
  }
  await page.reload();await page.waitForFunction(()=>window.wonderPreview?.ready);
  await page.getByRole('button',{name:'欧洲 16',exact:true}).click();
  if(await page.locator('.model-card').count()!==16)throw new Error('Europe filter');report.interactionChecks.push('Europe filter: 16');
  await page.getByRole('button',{name:'南美洲 8',exact:true}).click();
  if(await page.locator('.model-card').count()!==8)throw new Error('South America filter');report.interactionChecks.push('South America filter: 8');
  await page.getByRole('button',{name:'全部 24',exact:true}).click();
  await page.locator('[data-asset-id="santiago-bernabeu"]').click();
  await page.waitForFunction(()=>window.wonderPreview.state.assetId==='santiago-bernabeu'&&document.querySelector('#loading').hidden);
  await page.locator('#lod').selectOption('2');await page.waitForFunction(()=>window.wonderPreview.state.lod===2&&document.querySelector('#loading').hidden);report.interactionChecks.push('LOD selection');
  await page.locator('#wireframe').check();await page.locator('#wireframe').uncheck();report.interactionChecks.push('Wireframe toggle');
  await page.getByRole('button',{name:'俯视',exact:true}).click();await page.getByRole('button',{name:'正面',exact:true}).click();await page.getByRole('button',{name:'立体',exact:true}).click();report.interactionChecks.push('Three view presets');
  await page.locator('#lod').selectOption('0');await page.waitForFunction(()=>window.wonderPreview.state.lod===0&&document.querySelector('#loading').hidden);
  await page.screenshot({path:path.join(output,'gallery-desktop.png'),fullPage:true});
  await page.locator('.inspector').screenshot({path:path.join(output,'bernabeu-viewer.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'gallery-mobile.png'),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw new Error('Mobile horizontal overflow');report.interactionChecks.push('390px responsive layout');
  const cards=catalog.items.map(i=>'<article><span>'+i.id+' · '+i.region+'</span><img src="'+base+'/assets/wonders/thumbnails/'+i.assetId+'.webp"><h2>'+i.name+'</h2><p>'+i.location+'</p></article>').join('');
  const sheet='<!doctype html><html lang="zh"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:48px;background:#edece5;color:#284237;font-family:"Microsoft YaHei",sans-serif}header{display:flex;align-items:end;justify-content:space-between;border-bottom:1px solid #becbbb;padding-bottom:24px;margin-bottom:26px}h1{font-size:32px;letter-spacing:3px;font-weight:500;margin:0}header p{font-size:12px;letter-spacing:2px;color:#85937a;margin:8px 0 0}.tag{font:14px Georgia;color:#627659}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:17px}article{background:#f8f7f0;border:1px solid #d7dccd;position:relative}article span{position:absolute;top:13px;left:14px;font-size:10px;color:#8c9a82}img{display:block;width:100%;aspect-ratio:1.10;object-fit:contain}h2{font-size:16px;font-weight:500;margin:0 17px 7px}article p{font-size:11px;color:#87947c;margin:0 17px 18px}footer{font-size:11px;color:#85917b;margin-top:24px;letter-spacing:2px}</style><header><div><h1>世界奇观 · 彩色模型</h1><p>黄狗风云 / WORLD LANDMARKS COLLECTION</p></div><span class="tag">EUROPE 16 + SOUTH AMERICA 8</span></header><section class="grid">'+cards+'</section><footer>24 座实际三维模型 · 配色与材质 v2 · GLB 渲染</footer></html>';
  await fs.writeFile(path.join(output,'contact-sheet.html'),sheet);await page.setViewportSize({width:1440,height:1100});await page.setContent(sheet);await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
  await page.screenshot({path:path.join(output,'contact-sheet.png'),fullPage:true});
  report.renderer=await browser.version();report.ok=report.errors.length===0&&report.failedResources.length===0;
  await fs.writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
  if(!report.ok)throw new Error(report.errors.join('\n'));console.log('72 GLB loads, 24 rendered models and gallery checks passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}

