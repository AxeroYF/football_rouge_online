import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';
const {chromium}=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')('playwright');
const f=coalitionFixture(),api=createCampaignApiHandler({campaign:f.s}),serve=createStaticHandler(process.cwd());
const links=fs.readFileSync('index.html','utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('');
const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8">${links}</head><body><div class="topbar"><button id="topbar-research">科技</button></div><div id="map" class="map-stage" style="height:900px"></div><section id="campaign-tactics" class="campaign-tactics" hidden></section><script src="/assets/vendor/leaflet.js"></script></body></html>`;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/review.html'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);}else if(url.pathname.startsWith('/api/'))await api(req,res,url.pathname,url.href);else serve(req,res);}catch(e){res.writeHead(e.statusCode??400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const out='outputs/coalition-review';fs.mkdirSync(out,{recursive:true});const checks=[],errors=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name);};
const browser=await chromium.launch({channel:'chrome',headless:true});
async function pageFor(id){const p=await browser.newPage({viewport:{width:1600,height:1000}});p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/review.html');await p.evaluate(async id=>{
 const {createCampaignStore}=await import('/client/core/campaign-store.js');const {createCoalitionController}=await import('/client/social/coalition-controller.js');const {createTacticsController}=await import('/tactics-page.js');
 const request=async(path,options={})=>{const r=await fetch(path,{method:options.method??'GET',headers:{authorization:'Bearer '+id,'content-type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};
 window.store=createCampaignStore();window.request=request;window.toasts=[];
 store.setState((await request('/api/campaign/state')).state);
 window.map=L.map('map').setView([48,2],6);map.createPane('expeditionPane');
 window.tactics=createTacticsController({panel:document.getElementById('campaign-tactics'),mapElement:document.getElementById('map'),getCampaignState:()=>store.getState(),setCampaignState:s=>store.setState(s),request,showToast:m=>toasts.push(m)});
 window.controller=createCoalitionController({getState:()=>store.getState(),getRequest:()=>request,campaignStore:store,mapElement:document.getElementById('map'),metadata:new Map(['a','b','c'].map((id,i)=>[id,{name:id,country:'法国',centroid:[2+i,48]}])),onOpenTactics:()=>tactics.open({squadId:'coalition'}),showToast:m=>toasts.push(m),displayPointToSource:(id,p)=>[p.lng,p.lat]});
 const {createForeignUnitController}=await import('/client/map/foreign-unit-controller.js');window.markers=createForeignUnitController({Leaflet:L,map,layer:L.layerGroup().addTo(map),getState:()=>store.getState(),onInspect:()=>controller.openActions()});store.subscribe(()=>markers.refresh());
 await controller.open();
 },id);return p;}
try{
 const a=await pageFor('a');await a.locator('[data-coalition-action="create"]').click();await a.locator('[data-coalition-action="lend"]').first().waitFor();
 for(let i=0;i<6;i++){await a.locator(`[data-coalition-action="lend"][data-player-id="a-expedition-${i}"]`).click();await a.waitForFunction(i=>store.getState().coalition.army.revision>=i+2,i);}
 const b=await pageFor('b');for(let i=6;i<11;i++){await b.locator(`[data-coalition-action="lend"][data-player-id="b-expedition-${i}"]`).click();await b.waitForFunction(i=>store.getState().coalition.army.revision>=i+2,i);}
 await a.evaluate(()=>controller.open());await a.locator('[data-coalition-action="tactics"]:not([disabled])').waitFor();
 check('two players assemble one shared roster through real API',f.s.coalitions.find(f.a).loans.length===11);
 await a.screenshot({path:out+'/roster.png'});
 await a.locator('[data-coalition-action="tactics"]').click();await a.locator('#campaign-tactics [data-league-magnet]').first().waitFor();
 check('complete tactics editor opens with eleven starters',await a.locator('#campaign-tactics [data-league-magnet]').count()===11);
 check('one shared board offers expedition, garrison and coalition',await a.locator('#campaign-tactics [data-lineup-squad]').count()===3&&await a.locator('.coalition-tactics').count()===0);
 await a.waitForFunction(()=>document.querySelector('[data-league-autosave-status]')?.dataset.state==='saved');
 const dimension=a.locator('#campaign-tactics [data-dimension]').first();await dimension.fill('61');await dimension.dispatchEvent('input');
 await a.waitForFunction(()=>document.querySelector('#campaign-tactics [data-league-autosave-status]')?.dataset.state==='saved');
 check('full tactics save is restricted to coalition',JSON.stringify(f.s.coalitions.find(f.a).tactics).includes('61'));
 await a.mouse.move(5,5);
 check('tactics workspace columns fit the desktop viewport',await a.evaluate(()=>[...document.querySelector('#campaign-tactics .league-lineup-workspace').children].every(e=>e.getBoundingClientRect().right<=innerWidth)));
 await a.screenshot({path:out+'/tactics.png'});
 const personal=JSON.stringify(f.a.tactics.squads);
 await a.locator('[data-lineup-squad="garrison"]').click();await a.locator('[data-lineup-squad="garrison"].active').waitFor();
 await a.locator('[data-lineup-squad="coalition"]').click();await a.locator('[data-lineup-squad="coalition"].active').waitFor();
 check('switching squads keeps personal lineups unchanged',JSON.stringify(f.a.tactics.squads)===personal);
 await b.evaluate(()=>tactics.open({squadId:'coalition'}));await b.locator('#campaign-tactics [data-lineup-squad="coalition"].active').waitFor();
 check('allied player can view coalition but cannot edit it',await b.locator('#campaign-tactics [data-dimension]').first().isDisabled());
 await a.evaluate(()=>tactics.close());await a.locator('.foreign-map-token img[src*="coalition.svg"]').click();
 await a.locator('.coalition-action-window').waitFor();
 check('map piece opens action controls directly',await a.locator('.coalition-action-window [data-coalition-action="select-move"]').isEnabled()&&await a.locator('.coalition-action-window [data-tab]').count()===0);
 await a.locator('[data-coalition-action="select-move"]').click();
 await a.evaluate(()=>controller.handleTerritoryClick('b',{}));await a.locator('[data-coalition-action="confirm-order"]').waitFor();
 check('move preview shows both allies and shared oil',await a.locator('.coalition-shares span').count()===2);
 await a.screenshot({path:out+'/oil-preview.png'});await a.locator('[data-coalition-action="confirm-order"]').click();await a.waitForFunction(()=>Boolean(store.getState().coalition.army.movement));
 check('separate coalition map marker is present',await a.locator('.foreign-map-token img[src*="coalition.svg"]').count()===1);
 check('no browser runtime errors',errors.length===0);
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({checks,errors}));
