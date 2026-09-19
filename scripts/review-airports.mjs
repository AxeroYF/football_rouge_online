import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {CampaignService} from '../campaign-service.mjs';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';
import {raidPackType} from '../shared/config/elite-raids.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'),{chromium}=require('playwright');
const out='outputs/airports-20260918';fs.mkdirSync(out,{recursive:true});
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),index=read('assets/data/territory-index.json');let at=Date.parse('2026-09-18T12:00:00Z'),saved;
const s=new CampaignService({developmentTools:true,catalog:read('assets/data/s4-player-catalog.json'),territoryIndex:index,territoryGeoJson:read('assets/data/campaign-territories.geojson'),territoryResources:read('assets/data/territory-resources.json'),repository:{load:()=>saved,save:v=>{saved=JSON.parse(JSON.stringify(v));}},now:()=>at});
const f=coalitionFixture(),players=[structuredClone(f.a),structuredClone(f.b)];
for(const [i,a]of players.entries()){
 const cells=index.territories.filter(t=>t.spawnAllowed&&t.countryCode===(i?'BRA':'FRA')&&(i||t.region==='europe')).slice(0,2);assert.equal(cells.length,2);a.homeTerritoryId=cells[0].territoryId;a.gold=100000;delete a.operatingCosts;
 a.expeditionPiece={schemaVersion:1,territoryId:a.homeTerritoryId,tokenId:'default',movement:null};a.developmentFogDisabled=true;a.mapColor=i?'#cf6f9f':'#4f83d8';a.draft.teamName=i?'南美守卫者':'欧洲守卫者';a.token='raid-review-'+i;
 for(const p of a.draft.roster){p.name=s.playerDatabase.find(x=>x.role===p.role)?.name??p.name;}
 s.accounts.set(a.id,a);s.world.players[a.id]={playerId:a.id,territoryIds:cells.map(t=>t.territoryId),capitalTerritoryId:a.homeTerritoryId};
 for(const [n,t]of cells.entries())Object.assign(s.world.territories[t.territoryId],{ownerType:'player',ownerId:a.id,capitalOf:n===0?a.id:null,protectedUntil:0,buildings:[]});s.eliteRaids.touch(a,{foreground:true});
}
s.save();const leader=players[0],target=index.territories.find(t=>t.spawnAllowed&&t.countryCode==='BRA').territoryId;
s.world.territories[target].ownerId=leader.id;s.world.territories[target].capitalOf=null;s.world.players[leader.id].territoryIds.push(target);
s.buildings.build(leader,s.world,target,'airport','gold');
s.buildings.ensureCapitalHeadquarters(leader,s.world,leader.homeTerritoryId);s.save();
const hq=s.world.territories[leader.homeTerritoryId].buildings.find(b=>b.type==='club-headquarters');
const serve=createStaticHandler(process.cwd()),api=createCampaignApiHandler({campaign:s}),serverErrors=[];
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');if(url.pathname.startsWith('/api/'))return await api(req,res,url.pathname,req.url);return await serve(req,res);}catch(e){serverErrors.push(e.message);res.writeHead(e.statusCode??500,{'content-type':'application/json'});res.end(JSON.stringify({message:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser,page;const report={checks:[],errors:[],serverErrors};
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),leader.token);
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/game',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});report.checks.push('game and map load');
 await page.locator(`[data-building-id="${hq.id}"]`).first().evaluate(el=>el.click());
 const build=page.locator('[data-build-type="airport"][data-build-method="gold"]');await build.waitFor();await build.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/construction.png'});await build.click();
 await page.locator('[data-open-airport]').waitFor();report.checks.push('airport construction appears and completes through game UI');await page.locator('[data-open-airport]').click();
 await page.locator('.airport-window [data-action="quote"]').waitFor();await page.locator('.airport-window [data-action="quote"]').click();await page.locator('.airport-ticket').waitFor();await page.screenshot({path:out+'/ticket.png'});
 const gold=leader.gold,oil=leader.oil.balance;await page.locator('.airport-window [data-action="depart"]').click();await page.waitForFunction(()=>document.querySelector('.airport-window').hidden);
 assert.equal(leader.expeditionPiece.movement.transport,'airport');assert.equal(leader.oil.balance,oil);assert.ok(leader.gold<gold);report.checks.push('real API starts gold-only intercontinental flight from Europe to Brazil');
 at+=60000;s.save();assert.equal(leader.expeditionPiece.territoryId,target);report.checks.push('arrives at destination after exactly one minute');assert.deepEqual(report.errors,[]);assert.deepEqual(serverErrors,[]);report.passed=true;
}finally{if(page){await page.screenshot({path:out+'/last.png'}).catch(()=>{});fs.writeFileSync(out+'/page.txt',await page.locator('body').innerText());}fs.writeFileSync(out+'/browser.json',JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
