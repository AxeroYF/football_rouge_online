// Exercise the real admin UI against an in-memory API; never write game data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium} = require('playwright');
const root = process.cwd(), out = path.join(root, 'outputs/studio-interactions-20261116');
fs.mkdirSync(out, {recursive:true});
const records = JSON.parse(fs.readFileSync('outputs/card-art-library-20261116/inventory.json')).players.slice(0,3);
const players = records.map((p, i) => ({...p, id:`test-${i}`, grade:i === 2 ? 'B' : 'A', cardProfile:{...p.position,imageUrl:p.imageUrl}}));
const fixture = () => ({profilePlayers:players, players:[], playerDrafts:[], traits:[], roleGroups:[], attributeNames:[], overview:{totalPlayers:3,draftCount:0,profileCount:3,averageOverall:93,activeTraitCount:0}});
const calls = [], errors = [];
let failNext = false, delayNext = 0;
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page = await browser.newPage({viewport:{width:1500,height:1050}});
 page.on('pageerror', error => errors.push(error.message));
 await page.route('http://studio.test/**', async route => {
  const url = new URL(route.request().url()), pathname = decodeURIComponent(url.pathname);
  const json = (data, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if (pathname === '/api/versus/config') return json({environment:'test'});
  if (pathname.startsWith('/api/admin/content/player-profiles/')) {
   const id = pathname.split('/')[5], upload = pathname.endsWith('/image');
   const headers = route.request().headers();
   const body = upload ? {xPercent:Number(headers['x-ydl-profile-x']),yPercent:Number(headers['x-ydl-profile-y']),widthPercent:Number(headers['x-ydl-profile-width']),manuallyAdjusted:headers['x-ydl-profile-manually-adjusted'] === 'true'} : route.request().postDataJSON();
   calls.push({id,body,upload});
   const fail = failNext, delay = delayNext; failNext = false; delayNext = 0;
   if (delay) await new Promise(resolve => setTimeout(resolve, delay));
   if (fail) return json({error:'模拟断网'},503);
   const player = players.find(p => p.id === id);
   player.cardProfile = {...player.cardProfile,...body,manuallyAdjustedAt:body.manuallyAdjusted ? new Date().toISOString() : upload ? null : player.cardProfile.manuallyAdjustedAt};
   return json({profile:player.cardProfile,summary:{}});
  }
  let relative = pathname === '/admin/' ? 'admin/public/index.html' : pathname.startsWith('/admin/') ? `admin/public/${pathname.slice(7)}` : pathname.startsWith('/versus/') ? `versus/public/${pathname.slice(8)}` : pathname.slice(1);
  if (!fs.existsSync(relative) && pathname.startsWith('/versus/')) relative = pathname.slice(8);
  if (!fs.existsSync(relative)) return route.fulfill({status:404,body:''});
  let body = fs.readFileSync(relative);
  if (pathname === '/admin/app.js') body = Buffer.from(body.toString()+`\ncontentData=${JSON.stringify(fixture())}; contentLoadedSections.add('studio'); setStudioSelection('test-0'); renderContentAdmin();`);
  const type = {'.js':'text/javascript','.html':'text/html','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'}[path.extname(relative)] ?? 'application/octet-stream';
  return route.fulfill({contentType:type,body});
 });
 await page.goto('http://studio.test/admin/');
 const card = page.locator('#studio-card-preview'), status = page.locator('#studio-profile-status');
 const x = page.locator('[data-studio-position="xPercent"]');
 const saved = () => status.filter({hasText:'已自动保存'}).waitFor();
 const selected = () => page.locator('.studio-player-row.active button').getAttribute('data-studio-player');
 await card.focus();
 const initial = Number(await x.inputValue());
 await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
 assert.equal(Number(await x.inputValue()),initial+6);
 await saved(); assert.equal(calls.length,1); assert.equal(calls[0].body.manuallyAdjusted,true);
 assert.match(await page.locator('[data-studio-player="test-0"] strong').textContent(),/已调整/);
 assert.equal(await card.evaluate(el=>el===document.activeElement),true);
 // Switch before debounce: each player retains its own last position.
 await page.keyboard.press('ArrowRight'); await page.keyboard.press('PageDown');
 assert.equal(await selected(),'test-1');
 const second = Number(await x.inputValue());
 await page.keyboard.press('ArrowLeft'); await page.keyboard.press('PageUp');
 assert.equal(Number(await x.inputValue()),initial+7);
 await page.waitForFunction(()=>document.querySelector('#studio-save-summary').textContent==='全部调整已保存');
 assert.equal(players[1].cardProfile.xPercent,second-1);
 // Continue editing while the previous response is slow.
 delayNext = 1000;
 await card.focus(); await page.keyboard.press('ArrowRight');
 await status.filter({hasText:'正在保存'}).waitFor();
 await page.keyboard.press('ArrowRight'); await saved();
 assert.equal(Number(await x.inputValue()),initial+9);
 assert.equal(players[0].cardProfile.xPercent,initial+9);
 // Error on the previous player remains visible; global retry restores it.
 failNext = true;
 await page.keyboard.press('ArrowRight'); await page.keyboard.press('PageDown');
 await page.locator('#studio-retry-saves').waitFor({state:'visible'});
 await page.locator('#studio-retry-saves').click();
 await page.waitForFunction(()=>document.querySelector('#studio-save-summary').textContent==='全部调整已保存');
 assert.equal(players[0].cardProfile.xPercent,initial+10);
 // List arrows select players; search arrows don't move the card or selection.
 await page.locator('[data-studio-player="test-0"]').click(); await page.keyboard.press('ArrowDown');
 assert.equal(await selected(),'test-1');
 await page.locator('#studio-player-search').fill(''); await page.keyboard.press('ArrowUp');
 assert.equal(await selected(),'test-1');
 await page.locator('#studio-player-grade').selectOption('A');
 await card.focus(); await page.keyboard.press('PageDown'); assert.equal(await selected(),'test-1');
 await page.locator('#studio-player-adjusted').selectOption('yes'); assert.equal(await page.locator('[data-studio-player]').count(),2);
 await page.locator('#studio-player-grade').selectOption('all');
 await page.locator('#studio-player-adjusted').selectOption('no'); assert.equal(await page.locator('[data-studio-player]').count(),1);
 // Slider, reset and wheel all save without the manual button.
 await page.locator('[data-studio-player="test-2"]').click();
 await x.fill('65'); await saved(); assert.equal(players[2].cardProfile.xPercent,65);
 await page.locator('#studio-reset-position').click(); await saved(); assert.equal(players[2].cardProfile.xPercent,50);
 await card.hover(); await page.mouse.wheel(0,100); await saved(); assert.equal(players[2].cardProfile.widthPercent,198);
 const box = await card.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+10,{steps:3}); await page.mouse.up();
 await saved(); assert.notEqual(players[2].cardProfile.xPercent,50);
 // Upload and further adjustment during upload must upload the image only once.
 delayNext = 1000;
 await page.locator('#studio-image-input').setInputFiles({name:'test.webp',mimeType:'image/webp',buffer:fs.readFileSync(records[0].imageFile)});
 await status.filter({hasText:'正在保存'}).waitFor(); await card.focus(); await page.keyboard.press('ArrowRight');
 await saved(); assert.equal(calls.filter(c=>c.upload).length,1);
 assert.ok(players[2].cardProfile.manuallyAdjustedAt);
 await page.reload();
 await page.locator('#studio-player-adjusted').selectOption('yes');
 assert.equal(await page.locator('[data-studio-player]').count(),3);
 await page.screenshot({path:path.join(out,'admin-studio.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,requests:calls.length,keyboard:true,debounce:true,switchWhileSaving:true,slowResponse:true,retry:true,filters:true,sliderWheelDragReset:true,uploadOnce:true,markersAfterReload:true,errors},null,2));
 console.log('PASS: real admin UI keyboard, autosave, races, retry, uploads, manual markers and filters');
} finally { await browser.close(); }
