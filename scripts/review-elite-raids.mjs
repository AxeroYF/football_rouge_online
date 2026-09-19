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
const out='outputs/elite-raids-20260918';fs.mkdirSync(out,{recursive:true});
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),index=read('assets/data/territory-index.json');let at=Date.parse('2026-09-18T12:00:00Z'),saved;
const s=new CampaignService({developmentTools:true,catalog:read('assets/data/s4-player-catalog.json'),territoryIndex:index,territoryGeoJson:read('assets/data/campaign-territories.geojson'),territoryResources:read('assets/data/territory-resources.json'),repository:{load:()=>saved,save:v=>{saved=JSON.parse(JSON.stringify(v));}},now:()=>at});
const f=coalitionFixture(),players=[structuredClone(f.a),structuredClone(f.b)];
for(const [i,a]of players.entries()){
 const cells=index.territories.filter(t=>t.spawnAllowed&&t.countryCode===(i?'BRA':'FRA')).slice(0,2);assert.equal(cells.length,2);a.homeTerritoryId=cells[0].territoryId;a.gold=100000;
 a.expeditionPiece={schemaVersion:1,territoryId:a.homeTerritoryId,tokenId:'default',movement:null};a.developmentFogDisabled=true;a.mapColor=i?'#cf6f9f':'#4f83d8';a.draft.teamName=i?'南美守卫者':'欧洲守卫者';a.token='raid-review-'+i;
 for(const p of a.draft.roster){p.name=s.playerDatabase.find(x=>x.role===p.role)?.name??p.name;}
 s.accounts.set(a.id,a);s.world.players[a.id]={playerId:a.id,territoryIds:cells.map(t=>t.territoryId),capitalTerritoryId:a.homeTerritoryId};
 for(const [n,t]of cells.entries())Object.assign(s.world.territories[t.territoryId],{ownerType:'player',ownerId:a.id,capitalOf:n===0?a.id:null,protectedUntil:0,buildings:[]});s.eliteRaids.touch(a,{foreground:true});
}
s.save();s.eliteRaids.advance(at);s.save();const leader=s.accounts.get(s.eliteRaids.day().candidateId),other=players.find(a=>a.id!==leader.id),day=s.eliteRaids.day();
const command=(a,action,extra={})=>s.eliteRaids.mutate(a,{action,requestId:crypto.randomUUID(),armyId:day.army.id,revision:day.army.revision,...extra});
const serve=createStaticHandler(process.cwd()),api=createCampaignApiHandler({campaign:s}),serverErrors=[];
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');if(url.pathname.startsWith('/api/'))return await api(req,res,url.pathname,req.url);return await serve(req,res);}catch(e){serverErrors.push(e.message);res.writeHead(e.statusCode??500,{'content-type':'application/json'});res.end(JSON.stringify({message:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser;const report={checks:[],errors:[],serverErrors};
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(token=>{localStorage.setItem('yellowdogs-chronicles-token',token);localStorage.setItem('ydl-tactics-piece-display','cards');},leader.token);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/game',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});report.checks.push('full game boots and map loads');
 await page.locator('.raid-map-token').first().waitFor();assert.equal(await page.locator('.raid-map-token').count(),2);await page.screenshot({path:out+'/map.png'});report.checks.push('two crest tokens appear on the real map');
 await page.locator('#topbar-raids').click();await page.locator('[data-raid-action="accept-command"]').waitFor();await page.locator('[data-raid-action="accept-command"]').click();await page.waitForFunction(()=>document.querySelector('[data-raid-action="decline-command"]')?.textContent.includes('辞任'));
 assert.equal(day.army.commanderId,leader.id);report.checks.push('rotating candidate accepts through real API');
 for(const p of leader.draft.roster.slice(0,6))command(leader,'lend',{playerId:p.id});for(const p of other.draft.roster.slice(6,11))command(other,'lend',{playerId:p.id});command(leader,'auto-lineup');
 await page.locator('[data-raid-action="close"]').click();await page.locator('#topbar-raids').click();await page.waitForFunction(()=>document.querySelector('.raid-window')?.textContent.includes('11/18'));
 await page.screenshot({path:out+'/activity.png'});report.checks.push('activity displays 2 opponents and 11 borrowed players');
 await page.locator('[data-raid-action="tactics"]').click();await page.locator('[data-lineup-squad="raid"]').waitFor();await page.waitForFunction(()=>document.querySelector('#campaign-tactics')?.textContent.includes('全服活动联军'));
 assert.equal(await page.locator('[data-league-magnet]').count(),11);await page.screenshot({path:out+'/tactics.png'});report.checks.push('existing tactics board opens activity lineup with 11 players');
 await page.locator('[data-lineup-squad="garrison"]').click();await page.locator('[data-lineup-squad="raid"]').click();assert.equal(await page.locator('[data-league-magnet]').count(),11);report.checks.push('garrison and activity schemes switch independently');
 await page.keyboard.press('Escape');await page.locator('#topbar-raids').click();await page.locator('[data-raid-action="challenge"]').first().click();await page.waitForFunction(()=>document.querySelector('#campaign-broadcast')&&!document.querySelector('#campaign-broadcast').hidden,null,{timeout:20000}).catch(()=>{});
 const match=Object.values(s.eliteRaids.data.matches).find(m=>m.kind==='interception');assert.ok(match);report.checks.push('commander starts real interception match');
 match.leg.match.score=[2,0];match.leg.match.finished=true;match.leg.extraTimePlayed=true;s.eliteRaids.transaction(()=>s.eliteRaids.finish(match,at));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});
 await page.locator('#topbar-inventory').click();const pack=page.locator('[data-select-pack="'+raidPackType(match.clubId)+'"]');await pack.waitFor();await pack.click();await page.locator('[data-open-pack="'+raidPackType(match.clubId)+'"]').click();await page.locator('[data-player-card-action="pack-choice"]').first().waitFor();
 assert.equal(await page.locator('[data-player-card-action="pack-choice"]').count(),3);assert.ok(await page.locator('.inventory-opening-stage').count());
 await page.waitForTimeout(1800);assert.equal(await page.locator('.inventory-opening-meteors i').count(),16);await page.screenshot({path:out+'/reward.png'});const before=leader.draft.roster.length;await page.locator('[data-player-card-action="pack-choice"]').first().click();await page.locator('.inventory-acquired-card').waitFor();assert.equal(leader.draft.roster.length,before+1);assert.equal(leader.draft.roster.at(-1).upgradeLevel,1);report.checks.push('club pack shows three choices then grants a unique +1 card');
 assert.deepEqual(report.errors,[]);assert.deepEqual(serverErrors,[]);report.passed=true;
}finally{fs.writeFileSync(out+'/browser.json',JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
