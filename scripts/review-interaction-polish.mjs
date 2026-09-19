import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {createCampaignApiHandler,sendJson} from '../server/http/campaign-api-handler.mjs';
import {createStaticHandler} from '../server/http/static-handler.mjs';
import {createRequire} from 'node:module';
import {CampaignService} from '../campaign-service.mjs';
import {DRAFT_VERSION} from '../shared/config/draft.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.join(root,'outputs/interaction-polish-20260909'),data=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-interactions-'));
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),resources=read('assets/data/territory-resources.json'),catalog=read('assets/data/s4-player-catalog.json');
const byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const has=(id,terrain)=>resources.territories[id].terrain.includes(terrain);
const home=index.territories.find(t=>t.countryCode==='FRA'&&has(t.territoryId,'plains')&&t.landNeighbors.some(id=>has(id,'hills')||has(id,'mountain'))&&t.landNeighbors.some(id=>has(id,'plains'))&&t.landNeighbors.length>=3);
assert.ok(home);
const hill=home.landNeighbors.find(id=>has(id,'hills')||has(id,'mountain')),plain=home.landNeighbors.find(id=>id!==hill&&has(id,'plains'));
const owned=[home.territoryId,...home.landNeighbors];
let clock=Date.now();
const s=new CampaignService({now:()=>clock,dataPath:path.join(data,'campaign-accounts.json'),catalog,territoryIndex:index,territoryGeoJson:geo,territoryResources:resources});
const roles=['GK','LB','CB','CB','RB','DM','AM','AM','LW','RW','ST'];
const roster=[];for(let group=0;group<4;group++)for(const role of roles){const p=catalog.find(p=>p.role===role&&!p.isX&&!roster.some(q=>q.id===p.id));assert.ok(p);roster.push(p);}
const actor={id:'wonder-browser',nickname:'黄狗经理',token:'isolated-wonder-token',createdAt:Date.now(),setupComplete:true,homeTerritoryId:home.territoryId,gold:100000,mapColor:'#5d7d9e',draft:{version:DRAFT_VERSION,teamName:'黄狗俱乐部',totalPicks:roster.length,roster},resources:{fans:50000}};
actor.playerSquads={schemaVersion:2,assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))};actor.tactics={squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};
s.accounts.set(actor.id,actor);s.world.players[actor.id]={playerId:actor.id,territoryIds:owned,capitalTerritoryId:home.territoryId};
for(const id of owned)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:actor.id,capitalOf:id===home.territoryId?actor.id:null,buildings:[]});
s.buildings.ensureCapitalStadium(actor,s.world,home.territoryId);s.world.territories[home.territoryId].buildings.push(s.buildings.createRecord('club-shop'));
const trainingBuilding=s.buildings.createRecord('training-center');s.world.territories[hill].buildings.push(trainingBuilding);s.save();

const remote=index.territories.find(t=>t.countryCode==='GBR'&&t.spawnAllowed&&!t.eliteClubIds?.length);
const second=structuredClone(actor);Object.assign(second,{id:'social-rival',nickname:'北海经理',token:'isolated-rival-token',homeTerritoryId:remote.territoryId,mapColor:'#cf806b'});second.draft.teamName='北海联队';
second.draft.roster=second.draft.roster.map(p=>({...p,id:'rival:'+p.id,playerId:'rival:'+p.id,cardDefinitionId:p.cardDefinitionId??p.id,cardInstanceId:'rival:'+p.id}));
second.playerSquads={schemaVersion:2,assignments:Object.fromEntries(second.draft.roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))};second.tactics={squads:{expedition:{starters:second.draft.roster.slice(0,11).map(p=>p.id),formation:'4-3-3'}}};
s.accounts.set(second.id,second);s.world.players[second.id]={playerId:second.id,territoryIds:[remote.territoryId,hill],capitalTerritoryId:remote.territoryId};
s.world.players[actor.id].territoryIds=s.world.players[actor.id].territoryIds.filter(id=>id!==hill);
Object.assign(s.world.territories[hill],{ownerType:'player',ownerId:second.id,capitalOf:null,buildings:[]});Object.assign(s.world.territories[remote.territoryId],{ownerType:'player',ownerId:second.id,capitalOf:second.id,buildings:[]});s.buildings.ensureCapitalStadium(second,s.world,remote.territoryId);
for(const [i,title]of ['南方星辰','港湾竞技','高原之光','新月俱乐部'].entries()){const a={id:'social-observer-'+i,nickname:'经理'+i,token:'observer-'+i,setupComplete:false,gold:1000,draft:{teamName:title,roster:[]}};s.accounts.set(a.id,a);}
s.state(actor);s.state(second);s.save();
const checks=[],errors=[];const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
fs.mkdirSync(out,{recursive:true});
const handler=createCampaignApiHandler({campaign:s}),staticHandler=createStaticHandler(root);
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p.startsWith('/api/campaign/'))await handler(req,res,p,req.url);else await staticHandler(req,res);}catch(e){sendJson(res,e.statusCode??400,{error:e.message});}});
let browser,pageA,pageB;
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const open=async token=>{const context=await browser.newContext({viewport:{width:1920,height:1080}});await context.addInitScript(token=>localStorage.setItem('yellowdogs-chronicles-token',token),token);await context.route('**/app.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__socialReview={selectTerritory,buildings:buildingPanelController};'});});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/game');await page.waitForFunction(()=>document.querySelector('#map-loader')?.classList.contains('is-ready'),null,{timeout:60000});return page;};
 pageA=await open(actor.token);pageB=await open(second.token);
 const send=(from,to,action,extra={})=>{clock+=1;return s.diplomacy.mutate(from,{targetId:to.id,action,requestId:crypto.randomUUID(),...extra});};
 const response=async(id,action='accept',double=false)=>{const selector='#interaction-notifications [data-proposal="'+id+'"][data-notice-action="'+action+'"]';await pageB.locator(selector).waitFor({timeout:20000});const req=pageB.waitForResponse(r=>r.url().endsWith('/api/campaign/interactions')&&r.request().method()==='POST'&&JSON.parse(r.request().postData()).action===action);if(double)await pageB.locator(selector).dblclick();else await pageB.locator(selector).click();const r=await req,v=await r.json();assert.equal(r.status(),200,JSON.stringify(v));return v;};
 check('player list contains names without avatar tiles',await pageA.locator('.server-player>i').count()===0);await pageA.screenshot({path:path.join(out,'player-list.png')});
 const location=send(actor,second,'location');await response(location.proposalId,'reject');check('location rejected directly from notices',s.diplomacy.data().requests[location.proposalId].status==='rejected');check('notification response leaves profile closed',await pageB.locator('#interaction-window').evaluate(e=>e.hidden));
 const location2=send(actor,second,'location'),friendship=send(actor,second,'friendship');await response(location2.proposalId);await response(friendship.proposalId);check('location and friendship accepted from notices',s.diplomacy.details(actor,second.id).location&&s.diplomacy.relationship(actor.id,second.id).state==='friendship');
 const give=actor.draft.roster[30],take=second.draft.roster[30];const trade=send(actor,second,'trade',{trade:{giveGold:150,takeGold:50,giveCardIds:[give.id],takeCardIds:[take.id]}});await pageB.locator('[data-notice-proposal="'+trade.proposalId+'"]').waitFor({timeout:20000});const tradeNotice=pageB.locator('[data-notice-proposal="'+trade.proposalId+'"]');await tradeNotice.locator('summary').click();check('notice shows both trade sides and named cards',(await tradeNotice.innerText()).includes(give.name)&&(await tradeNotice.innerText()).includes(take.name));await pageB.screenshot({path:path.join(out,'trade-notification.png')});
 // A rejected HTTP attempt keeps the notification and its offer available.
 await pageB.route('**/api/campaign/interactions',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'验收重试'})}):route.continue(),{times:1});await tradeNotice.locator('[data-notice-action="accept"]').click();await pageB.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('验收重试'));await pageB.waitForFunction(id=>!document.querySelector('[data-notice-proposal="'+id+'"] button')?.disabled,trade.proposalId);check('failed response retains actionable notice',await tradeNotice.count()===1);
 const before=[actor.gold,second.gold];await response(trade.proposalId,'accept',true);check('retry and double click complete trade once',actor.gold===before[0]-100&&second.gold===before[1]+100);check('trade swaps both cards',actor.draft.roster.at(-1).cardDefinitionId===(take.cardDefinitionId??take.id)&&second.draft.roster.at(-1).cardDefinitionId===(give.cardDefinitionId??give.id)&&!actor.draft.roster.some(p=>p.id===give.id)&&!second.draft.roster.some(p=>p.id===take.id));
 send(actor,second,'condemn');send(actor,second,'withdraw-condemnation');await pageB.waitForFunction(()=>document.querySelectorAll('[data-notice-event]').length>=2);const notices=pageB.locator('[data-notice-event]'),beforeCount=await notices.count();await notices.first().locator('[data-notice-action="read"]').click();await pageB.waitForFunction(n=>document.querySelectorAll('[data-notice-event]').length===n-1,beforeCount);check('reading one event keeps other unread notices');
 send(actor,second,'war');await pageB.getByText('已向你宣战',{exact:true}).waitFor({timeout:20000});const peace=send(actor,second,'peace');await response(peace.proposalId);check('peace can be accepted from notification',s.diplomacy.relationship(actor.id,second.id).state==='neutral');
 const friendly=send(actor,second,'friendly');await response(friendly.proposalId);await pageB.locator('#campaign-broadcast:not([hidden])').waitFor();check('friendly acceptance launches existing match flow');await pageB.keyboard.press('Escape');await pageB.locator('#interaction-window:not([hidden])').waitFor();
 const rootB=pageB.locator('#interaction-window');await pageB.waitForFunction(()=>{const e=document.querySelector('#interaction-window .interaction-action b');return e&&parseFloat(getComputedStyle(e).fontSize)>=16;});check('profile readable type size');await pageB.waitForFunction(()=>[...document.querySelectorAll('#interaction-window .interaction-player img[data-player-card-art]')].every(i=>i.complete));await pageB.screenshot({path:path.join(out,'profile-desktop.png')});await pageB.setViewportSize({width:390,height:844});await rootB.locator('.interaction-scroll').evaluate(e=>e.scrollTop=0);await pageB.screenshot({path:path.join(out,'profile-mobile.png')});check('mobile profile stays in viewport',await pageB.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await pageA.evaluate(id=>{window.__socialReview.selectTerritory(id);window.__socialReview.buildings.open(id);},home.territoryId);const info=pageA.locator('[data-wonder-id="facility:training-center"] [data-wonder-info]');await info.waitFor();const goldBefore=actor.gold;await info.hover();await pageA.locator('#wonder-hover:not([hidden])').waitFor();check('facility info remains transparent',await info.evaluate(e=>getComputedStyle(e).backgroundColor)==='rgba(0, 0, 0, 0)');check('facility hover shows all five levels',(await pageA.locator('#wonder-hover').innerText()).includes('LV5'));check('facility info does not construct anything',actor.gold===goldBefore);await pageA.screenshot({path:path.join(out,'facility-hover-desktop.png')});await pageA.keyboard.press('Escape');check('Escape closes facility explanation',await pageA.locator('#wonder-hover').evaluate(e=>e.hidden));
 await pageA.setViewportSize({width:390,height:844});await info.click();await pageA.locator('#wonder-hover:not([hidden])').waitFor();const box=await pageA.locator('#wonder-hover').boundingBox();check('tap explanation fits mobile screen',box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);await pageA.screenshot({path:path.join(out,'facility-hover-mobile.png')});
 check('no JavaScript errors',errors.length===0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log('Interaction polish review passed');
}catch(e){await pageA?.screenshot({path:path.join(out,'failure-a.png')}).catch(()=>{});await pageB?.screenshot({path:path.join(out,'failure-b.png')}).catch(()=>{});throw e;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
