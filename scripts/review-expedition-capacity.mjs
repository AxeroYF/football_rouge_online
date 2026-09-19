import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire("C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs")("playwright");
const root=process.cwd(),out=path.join(root,"outputs/expedition-capacity-20260909");
const links=[...fs.readFileSync("index.html","utf8").matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join("");
const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${links}</head><body><div class="map-stage" style="position:relative;width:100vw;height:100vh"><div id="panel" class="campaign-team"></div></div><script type="module">
import { createTeamController } from '/client/team/team-controller-ydl.js';
const roster=Array.from({length:34},(_,i)=>({id:'p'+i,name:'球员 '+(i+1),pool:['GK','DEF','MID','ATT'][i%4],role:['GK','CB','DM','ST'][i%4],grade:'A',overall:75,club:'黄狗俱乐部',nationality:'中国',attributes:{passing:70}}));
window.state={draft:{roster},playerSquads:{assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))}};
window.controller=createTeamController({panel:document.querySelector('#panel'),mapElement:document.querySelector('.map-stage'),getCampaignState:()=>state,getCampaignRequest:()=>async (url,{body})=>{state.playerSquads.assignments[body.playerId]=body.squadId;return {state};},campaignStore:{setState(next){window.state=next;}}});
controller.open();window.ready=true;</script></body></html>`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]??'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.ready);
 assert.match(await page.locator('.team-squad-summary').innerText(),/22 \/ 22/);
 assert.equal(await page.locator('[data-team-squad-player="p22"] option[value="expedition"]').isDisabled(),true);
 await page.locator('[data-team-filter="squad"]').selectOption('garrison');
 assert.equal(await page.locator('[data-team-squad-player="p22"] option[value="expedition"]').isDisabled(),true);
 await page.locator('[data-team-filter="squad"]').selectOption('all');
 await page.locator('[data-team-squad-player="p0"]').selectOption('garrison');
 assert.equal(await page.locator('[data-team-squad-player="p22"] option[value="expedition"]').isDisabled(),false);
 await page.locator('[data-team-squad-player="p22"]').selectOption('expedition');
 assert.match(await page.locator('.team-squad-summary').innerText(),/22 \/ 22/);
 const layout=async()=>page.evaluate(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height};};return {notice:r('.team-squad-limit'),list:r('.team-player-list'),shell:r('.team-management-shell')};});
 for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]){
  await page.setViewportSize({width,height});const b=await layout();assert.ok(b.notice.left>=0 && b.notice.right<=width);assert.ok(b.list.height>100);assert.ok(b.list.top>=b.notice.bottom-1);assert.ok(b.list.bottom<=b.shell.bottom+1);await page.screenshot({path:path.join(out,name+'.png')});
 }
 await page.evaluate(()=>{state.playerSquads.assignments.p23='expedition';controller.render();});
 assert.match(await page.locator('.team-squad-limit').innerText(),/当前超出 1 人/);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({passed:true,checks:['22人计数','满员禁用','筛选不能绕过','调出后可调入','重新满员','桌面布局','移动布局','超员提示','无页面异常'],errors},null,2));console.log('Browser checks passed');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
