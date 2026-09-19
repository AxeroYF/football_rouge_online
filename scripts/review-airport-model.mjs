import {PLAYER_MAP_COLORS} from '../shared/config/map.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const req=createRequire(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')),{chromium}=req('playwright'),sharp=req('sharp');
const root=process.cwd(),out=path.join(root,'outputs/airport-design-20260918');await fs.mkdir(out,{recursive:true});
const server=http.createServer(createStaticHandler(root));await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
const report={errors:[],failedResources:[],checks:[],variants:[]};
const variants=PLAYER_MAP_COLORS.map((color,i)=>({id:i===1?'blue':'map-'+(i+1),clubName:i===1?'蓝港竞技':'示例俱乐部'+(i+1),territoryName:i===1?'里斯本':'地块'+(i+1),playerColor:color,playerId:'preview-'+i}));
try{
 browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-swiftshader','--disable-dev-shm-usage']});const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResources.push({url:r.url(),status:r.status()});});
 await page.goto('http://127.0.0.1:'+server.address().port+'/facility-preview.html?filter=airport&model=airport-lv1&render=1');await page.waitForFunction(()=>window.facilityPreview?.ready,{},{timeout:45000});
 assert.equal(await page.locator('.model-card').count(),1);assert.equal(await page.locator('#level-strip button').innerText(),'单等级');
 for(const identity of variants){
  await page.evaluate(o=>window.facilityPreview.setAirportIdentity(o),identity);
  const png=Buffer.from((await page.evaluate(()=>window.facilityPreview.capture('airport-lv1',{size:1024,transparent:true}))).split(',')[1],'base64');
  const file=path.join(out,'airport-'+identity.id+'.png');await fs.writeFile(file,png);
  const trimmed=await sharp(png).trim().png().toBuffer();
  await sharp(trimmed).resize(256,256,{fit:'contain',background:'#00000000'}).png().toFile(path.join(root,'assets/facilities/icons','airport-lv1-'+identity.id+'.png'));
  if(identity.id==='blue'){
   await sharp(png).resize(512,512).png().toFile(path.join(root,'assets/facilities/thumbnails/airport-lv1.png'));
   await sharp(png).resize(512,512).flatten({background:'#f8f7f0'}).webp({quality:90}).toFile(path.join(root,'assets/facilities/thumbnails/airport-lv1.webp'));
   await sharp(trimmed).resize(256,256,{fit:'contain',background:'#00000000'}).png().toFile(path.join(root,'assets/facilities/icons/airport-lv1.png'));
  }
  const state=await page.evaluate(()=>window.facilityPreview.state);assert.equal(state.airportIdentity.color,identity.playerColor);assert.ok(state.airportIdentity.name.includes(identity.clubName));report.variants.push(state.airportIdentity);
 }
 report.checks.push('all 12 map-palette colors derive from simulated territory ownership; no skin list');
 await page.evaluate(o=>window.facilityPreview.setAirportIdentity(o),variants[1]);await page.locator('#airport-club').fill('测试 <竞技> 俱乐部');await page.locator('#airport-place').fill('里斯本');
 assert.equal(await page.locator('#model-name').innerText(),'测试 <竞技> 俱乐部 · 里斯本机场');assert.equal(await page.locator('#model-name *').count(),0);report.checks.push('club name input updates sign and heading safely');await page.locator('#airport-color').fill('#123abc');assert.equal((await page.evaluate(()=>window.facilityPreview.state)).airportIdentity.color,'#123abc');report.checks.push('arbitrary territory color outside the palette works');
 for(const lod of ['1','2','0']){await page.locator('#lod').selectOption(lod);await page.waitForFunction(l=>window.facilityPreview.state.lod===Number(l)&&document.querySelector('#loading').hidden,lod);}
 report.checks.push('all three LODs load and retain identity');
 await page.evaluate(o=>window.facilityPreview.setAirportIdentity(o),variants[1]);
 const top=Buffer.from((await page.evaluate(()=>window.facilityPreview.capture('airport-lv1',{size:1024,preset:'top',transparent:true}))).split(',')[1],'base64');await fs.writeFile(path.join(out,'airport-top.png'),top);
 await page.evaluate(()=>window.facilityPreview.select('airport-lv1',{preset:'iso'}));await page.screenshot({path:path.join(out,'airport-preview.png')});
 report.checks.push('isometric, top view, runway, terminal and tower preview');
 const svg=(w,h,text)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:Microsoft YaHei,Arial,sans-serif}</style>${text}</svg>`);
 const layers=[];
 layers.push({input:svg(1600,108,'<text x="52" y="48" fill="#243f36" font-size="30" font-weight="600">俱乐部机场 · 继承所属玩家领土颜色</text><text x="54" y="83" fill="#63796b" font-size="17">任意玩家均按自己的地图颜色着色，下方仅展示领土调色板，不限制玩家人数</text>'),left:0,top:0});
 for(let i=0;i<variants.length;i++){
  const identity=variants[i],x=(i%4)*400,y=120+Math.floor(i/4)*340;
  layers.push({input:await sharp(path.join(out,'airport-'+identity.id+'.png')).trim().resize(364,244,{fit:'contain',background:'#00000000'}).png().toBuffer(),left:x+18,top:y});
  layers.push({input:svg(380,72,`<rect x="12" y="17" width="10" height="40" rx="3" fill="${identity.playerColor}"/><text x="38" y="39" fill="#264236" font-size="17">${identity.clubName} · ${identity.territoryName}机场</text><text x="38" y="63" fill="#728575" font-size="12">${report.variants[i].code} / 实际领土色：${identity.playerColor}</text>`),left:x+12,top:y+248});
 }
 await sharp({create:{width:1600,height:1160,channels:4,background:'#f5f4ed'}}).composite(layers).png().toFile(path.join(out,'airport-club-variants.png'));
 await sharp(path.join(out,'airport-club-variants.png')).resize(1100).jpeg({quality:84}).toFile(path.join(out,'airport-review.jpg'));
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResources,[]);report.passed=true;
}finally{await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
