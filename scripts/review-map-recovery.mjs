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
const out='outputs/map-loading-r10/recovery-browser';fs.mkdirSync(out,{recursive:true});
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
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 async function context(){const c=await browser.newContext({viewport:{width:1440,height:900}});await c.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),leader.token);return c;}
 let c=await context();page=await c.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base+'/versus/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#map-loader').classList.contains('is-ready'),null,{timeout:60000});report.checks.push('normal /versus/ map renders');await c.close();
 c=await context();await c.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:original.call(this,type,...args)}});
 page=await c.newPage();await page.goto(base+'/versus/',{waitUntil:'domcontentloaded'});await page.locator('#map-loader.is-error .map-loader-actions:not([hidden])').waitFor();
 const fallback=page.getByRole('link',{name:'打开兼容地图',exact:true});assert.equal(new URL(await fallback.getAttribute('href')).pathname,'/versus/');
 await page.screenshot({path:out+'/recovery.png'});await fallback.click();await page.waitForFunction(()=>document.querySelector('#map-loader').classList.contains('is-ready'),null,{timeout:60000});
 assert.ok(page.url().includes('renderer=leaflet'));assert.equal(await page.evaluate(()=>localStorage.getItem('yellowdogs-chronicles-token')),leader.token);report.checks.push('WebGL failure shows recovery; clicking it renders compatible map and retains login');await c.close();
 c=await context();await c.addInitScript(()=>{const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===25000?50:ms,...args)});
 page=await c.newPage();await page.route('**/app.js?*',route=>route.abort());await page.goto(base+'/versus/',{waitUntil:'domcontentloaded'});
 await page.locator('.map-loader-actions:not([hidden])').waitFor({timeout:10000});report.checks.push('recovery is available even when main app module download fails');await page.screenshot({path:out+'/module-failure.png'});
 assert.deepEqual(report.errors,[]);assert.deepEqual(serverErrors,[]);report.passed=true;
}finally{fs.writeFileSync(out+'/browser.json',JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
