import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';

const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM || 'C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const out='outputs/enhancement-protection-review';fs.mkdirSync(out,{recursive:true});
const fixture=coalitionFixture(),api=createCampaignApiHandler({campaign:fixture.s}),serve=createStaticHandler(process.cwd());
for(const suffix of ['a','b']) {
 const card=structuredClone(fixture.a.draft.roster[0]);
 card.cardDefinitionId=card.id;card.id='protection-'+suffix;delete card.playerId;
 fixture.s.enhancement.applyLevel(card,8);fixture.a.draft.roster.push(card);
}
fixture.a.gold=100000;fixture.s.save();
const server=http.createServer(async(req,res)=>{
 try {const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))await api(req,res,url.pathname,url.href);else await serve(req,res);}
 catch(error){res.writeHead(error.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try {
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addInitScript(()=>localStorage.setItem('yellowdogs-chronicles-token','a'));
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/versus/?renderer=leaflet');
 await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 const menu=page.locator('#account-menu-trigger'),toggle=page.locator('#account-enhancement-protection');
 await menu.click();check('setting starts off',await toggle.getAttribute('aria-checked')==='false');
 await toggle.click();check('setting turns on',await toggle.getAttribute('aria-checked')==='true');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'));
 await menu.click();check('setting survives reload',await toggle.getAttribute('aria-checked')==='true');await menu.click();
 await page.locator('#topbar-enhancement').click();
 await page.locator('[data-enhancement-card="protection-a"]').click();await page.locator('[data-enhancement-card="protection-b"]').click();
 const protection=page.locator('[data-enhancement-protection]');
 check('eligible pair defaults to protection',await protection.isChecked());
 await protection.uncheck();check('manual opt-out works',!(await protection.isChecked()));
 await page.locator('[data-enhancement-slot-card="material"]').click();await page.locator('[data-enhancement-card="protection-b"]').click();
 check('next selection restores default',await protection.isChecked());
 await menu.click();await toggle.click();check('turning preference off updates selected pair',!(await protection.isChecked()));await menu.click();
 await page.locator('#enhancement-window [data-stage-window-close]').click();
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
  await page.setViewportSize(viewport);await menu.click();
  check(`${viewport.width}x${viewport.height} setting visible`,await toggle.evaluate(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.x>=0&&box.right<=innerWidth&&box.y>=0&&box.bottom<=innerHeight;}));
  await page.screenshot({path:out+`/settings-${viewport.width}.png`});await menu.click();
 }
 check('no browser errors',errors.length===0);
} finally {
 fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
 await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({passed:true,checks:checks.length,errors,out}));
