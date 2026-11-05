import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {startLocalServer} from '../test/helpers/local-server.js';

const require=createRequire(import.meta.url);
const {chromium}=process.env.PLAYWRIGHT_REQUIRE_FROM?createRequire(path.resolve(process.env.PLAYWRIGHT_REQUIRE_FROM,'package.json'))('playwright'):require('playwright');
const output=path.resolve('outputs/performance');await fs.mkdir(output,{recursive:true});
const baselinePath=process.env.RENDER_BASELINE_PATH??'.assessment/performance-baseline-app.js';
const sources={baseline:await fs.readFile(baselinePath,'utf8'),optimized:await fs.readFile('versus/public/app.js','utf8')};
// Injected into the module response by Playwright, never included in shipped code.
const instrument=`\nwindow.__renderProbe={renderLeague,renderBroadcast,refreshBroadcasts,refreshLeagueSilently,refreshYellowDogsTv,tv:async()=>{yellowDogsTvMode=true;await refreshYellowDogsTv();},assignLeagueEnhancementCard,refreshLeagueSquadPositionUi,read:()=>league,tab:(value)=>{leagueTab=value;if(value==='backpack'){leagueBackpackPage='cards';leagueBackpackStacked=false;}renderLeague();},nudge:()=>{const id=leagueStartingIds.find(id=>league.ownTeam.roster.find(p=>p.id===id)?.role!=='GK');leaguePositions[id]={...leaguePositions[id],x:leaguePositions[id].x+1};refreshLeagueSquadPositionUi();},sort:(value)=>{leagueBackpackSort=value;renderLeague();},load:(value)=>{league=value;renderLeague();}};`;
const server=await startLocalServer({publicOnly:false});let browser;
try{
 const post=async(route,body={},token)=>{
  const response=await fetch(server.url+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const value=await response.json();if(!value.ok)throw new Error(route+': '+JSON.stringify(value));return value;
 };
 const user=await post('/api/versus/register',{nickname:'Render Review',password:'render-review-password'});
 const identity={playerId:user.profile.id,accountToken:user.accountToken};
 await post('/api/versus/league/draft/start',{...identity,teamName:'Render Review FC'});
 await post('/api/versus/league/draft/auto',identity);
 let {league}=await post('/api/versus/league/draft/finish',identity);
 const admin=await post('/api/admin/login',{password:'isolated-test-password-only'});
 const player=league.ownTeam.roster.find(p=>!p.xPlayer);
 for(let i=0;i<5;i++)await post('/api/admin/league/s4-cards/grant',{accountId:user.profile.id,playerId:player.id,upgradeLevel:i%3,quantity:100},admin.token);
 ({league}=await post('/api/versus/league',identity));
 const {broadcast}=await post('/api/versus/league/ai-training/start',{...identity,formation:'4-3-3',averageOverall:80});
 const {live}=await post('/api/versus/live',identity);
 // Deterministic commentary on an actual engine-produced team snapshot.
 broadcast.match.events=Array.from({length:80},(_,i)=>({id:'probe-'+i,type:i%8===0?'goal':'save',importance:i%8===0?'major':'minor',minute:i,text:'测试赛况 '+i,detail:'用于检验刷新后的显示一致性',xg:0.2}));
 broadcast.match.minute=80;
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 const reports=[];const reference=new Map();
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}])for(const [mode,source] of Object.entries(sources)){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'});
  await context.addInitScript(user=>{
   localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(user));
   window.setInterval=()=>0; // No unrelated recurring refreshes during samples.
  },{accountToken:user.accountToken,profile:user.profile});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/versus/app.js*',route=>route.fulfill({contentType:'text/javascript',body:source+instrument}));
  await page.route('**/api/versus/broadcasts',route=>route.fulfill({json:{ok:true,broadcasts:[],upcomingBroadcasts:[]}}));
  await page.route('**/api/versus/league',route=>route.fulfill({json:{ok:true,league}}));
  await page.route('**/api/versus/live',route=>route.fulfill({json:{ok:true,live}}));
  await page.goto(server.url+'/versus/');await page.locator('#open-league').click();
  await page.waitForFunction(()=>!!window.__renderProbe?.read()?.ownTeam);
  await page.evaluate(()=>document.fonts.ready);
  const results=await page.evaluate(async({league,broadcast,seedPlayerId})=>{
   const probe=window.__renderProbe;probe.load(league);
   const samples=[];
   const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const serialize=node=>{
    if(node.nodeType===3)return node.textContent.trim()?node.textContent:null;
    if(node.nodeType!==1)return null;
    const attributes=[...node.attributes].filter(a=>a.name!=='data-render-key').map(a=>[a.name,a.value]).sort(([a],[b])=>a.localeCompare(b));
    return [node.tagName,attributes,[...node.childNodes].map(serialize).filter(n=>n!==null)];
   };
   const snapshots={};
   async function measure(name,action,root=document.querySelector('.league-page-content')){
    await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));await frame();
    const original=[...root.querySelectorAll('*')];let removed=0,added=0;const longTasks=[];
    const tasks=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));tasks.observe({type:'longtask'});
    const observer=new MutationObserver(records=>{for(const record of records){removed+=record.removedNodes.length;added+=record.addedNodes.length;}});
    observer.observe(root,{subtree:true,childList:true});
    const start=performance.now();await action();const scriptMs=performance.now()-start;
    await frame();const elapsedMs=performance.now()-start;observer.disconnect();tasks.disconnect();
    samples.push({name,scriptMs,elapsedMs,removed,added,elements:original.length,retained:original.filter(node=>node.isConnected).length,longTasks});
    snapshots[name]=JSON.stringify({dom:serialize(root),controls:[...root.querySelectorAll('input,select,textarea')].map(e=>[e.tagName,e.value,e.checked??null])});
   }
   probe.tab('squad');
   await measure('squad-repeat-render',()=>probe.renderLeague());
   await measure('squad-drop-refresh',()=>probe.nudge());
   probe.tab('enhancement');
   const warehouse=document.querySelector('.enhancement-card-grid');warehouse.scrollTop=200;
   const ids=[...document.querySelectorAll('[data-enhancement-card]')].filter(e=>e.dataset.enhancementPlayer===seedPlayerId).map(e=>e.dataset.enhancementCard);
   if(ids.length<100)throw new Error('Missing seeded duplicate cards');
   const selectCard=(id,slot)=>{
    const before=document.querySelector('.enhancement-card-grid').scrollTop;
    probe.assignLeagueEnhancementCard(id,slot);
    if(document.querySelector('.enhancement-card-grid').scrollTop!==before)throw new Error('Warehouse scroll changed');
   };
   await measure('enhancement-select-main',()=>selectCard(ids[10],'main'));
   await measure('enhancement-select-material',()=>selectCard(ids[11],'material'));
   if(!document.querySelector('[data-enhancement-slot-card="material"]'))throw new Error('Material selection failed');
   await measure('enhancement-repeat-render',()=>probe.renderLeague());
   probe.tab('backpack');
   await measure('backpack-repeat-render',()=>probe.renderLeague());
   await measure('backpack-wallet-only',()=>{probe.read().wallet.balance+=1;probe.renderLeague();});
   await measure('backpack-sort',()=>probe.sort('name'));
   for(const tab of ['overview','cup','seasonFinal','predictions','schedule','coach','inbox','x-growth','players','stats','club','shop','market']){
    probe.tab(tab);
    await measure(tab+'-repeat-render',()=>probe.renderLeague());
   }
   probe.tab('television');await probe.refreshBroadcasts();
   await measure('broadcast-list-unchanged',()=>probe.refreshBroadcasts());
   await probe.tv();
   await measure('ydtv-unchanged-refresh',()=>probe.refreshYellowDogsTv(true),document.querySelector('.ydtv-shell'));
   probe.renderBroadcast(broadcast);
   const liveRoot=document.querySelector('.broadcast-v2-content');liveRoot.querySelector('.event-feed').scrollTop=200;
   await measure('broadcast-next-minute',()=>{
    broadcast.match.minute+=1;broadcast.match.teams[0].players[0].fitness=72;broadcast.match.score[0]+=1;
    broadcast.match.events.push({id:'probe-new',minute:81,type:'goal',importance:'major',text:'测试进球',detail:'保留既有赛况节点',xg:0.3});
    probe.renderBroadcast(broadcast);
   },liveRoot);
   samples.at(-1).feedScrollTop=liveRoot.querySelector('.event-feed').scrollTop;
   return {samples,snapshots};
  },{league,broadcast,seedPlayerId:player.id});
  const key=String(viewport.width);
  for(const [name,snapshot] of Object.entries(results.snapshots)){
   if(mode==='baseline')reference.set(key+name,snapshot);
   else if(reference.get(key+name)!==snapshot){
    await fs.writeFile(path.join(output,key+'-'+name+'-expected.json'),reference.get(key+name));
    await fs.writeFile(path.join(output,key+'-'+name+'-actual.json'),snapshot);
    throw new Error('Display/controls differ: '+key+' '+name);
   }
  }
  const screenshot=await page.screenshot({animations:'disabled',path:path.join(output,key+'-'+mode+'-broadcast.png')});
  let screenshotCheck;
  if(mode==='baseline')reference.set(key+'screenshot',screenshot);
  else {
   const actual=await sharp(screenshot).raw().toBuffer();
   const expected=await sharp(reference.get(key+'screenshot')).raw().toBuffer();
   assert.equal(actual.length,expected.length);
   let maxChannelDifference=0;
   for(let i=0;i<actual.length;i++)maxChannelDifference=Math.max(maxChannelDifference,Math.abs(actual[i]-expected[i]));
   // Composited text/shadows can vary by one 8-bit shade between Chrome contexts.
   assert.ok(maxChannelDifference<=1,'Broadcast pixels differ: '+key+' (see outputs/performance screenshots)');
   screenshotCheck={maxChannelDifference,tolerance:1};
  }
  assert.equal(errors.length,0,errors.join('\n'));
  let reconciliationChecks;
  if(mode==='optimized'){
   reconciliationChecks=await page.evaluate(async()=>{
    const {patchHtmlChildren,htmlChildrenMatch}=await import('/versus/dom-patch.js');
    const current=document.createElement('section'),expected=document.createElement('section');
    let seed=12345;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
    for(let step=0;step<200;step++){
     const oldNodes=new Map([...current.querySelectorAll('[data-render-key]')].map(node=>[node.dataset.renderKey,node]));
     const keys=['a','b','c','d','e','f'].filter(()=>random()>.25);
     for(let i=keys.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[keys[i],keys[j]]=[keys[j],keys[i]];}
     const html=`<p>${step%3}</p>${keys.map(key=>`<div data-render-key="${key}" class="tone-${step%2}"><span>${key}</span></div>`).join('')}<label><input name="amount" value="${step}" type="number"><input type="checkbox" ${step%2?'checked':''}></label><textarea>${step}</textarea><select><option value="a" ${step%2?'selected':''}>A</option><option value="b" ${step%2?'':'selected'}>B</option></select><svg viewBox="0 0 10 10"><path d="M0 0 L${step%10} 10"/></svg>`;
     if(step){current.querySelector('input').value='999';current.querySelector('textarea').value='dirty';current.querySelector('select').value=step%2?'b':'a';}
     patchHtmlChildren(current,html);expected.innerHTML=html;
     if(!current.isEqualNode(expected))throw new Error('Reconciliation structure differs at '+step);
     const controls=[...current.querySelectorAll('input,textarea,select')];
     const desired=[...expected.querySelectorAll('input,textarea,select')];
     if(controls.some((node,i)=>node.value!==desired[i].value||node.checked!==desired[i].checked))throw new Error('Form state differs at '+step);
     if(!htmlChildrenMatch(current,html))throw new Error('Equality check differs at '+step);
     for(const node of current.querySelectorAll('[data-render-key]'))if(oldNodes.has(node.dataset.renderKey)&&oldNodes.get(node.dataset.renderKey)!==node)throw new Error('Stable keyed node replaced');
     const observer=new MutationObserver(()=>{});observer.observe(current,{subtree:true,childList:true,attributes:true,characterData:true});
     patchHtmlChildren(current,html);const count=observer.takeRecords().length;observer.disconnect();
     if(count)throw new Error('Unchanged HTML mutated the DOM at '+step);
    }
    return {randomizedTransitions:200,unchangedDomMutations:0};
   });
   let requests=0;
   await page.route('**/api/versus/broadcasts',async route=>{requests++;await new Promise(resolve=>setTimeout(resolve,30));await route.fulfill({json:{ok:true,broadcasts:[],upcomingBroadcasts:[]}});});
   await page.evaluate(()=>Promise.all([window.__renderProbe.refreshBroadcasts(),window.__renderProbe.refreshBroadcasts()]));
   assert.equal(requests,1,'Concurrent refreshes must share one request');
   await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});try{await window.__renderProbe.refreshBroadcasts();}finally{delete document.hidden;}});
   assert.equal(requests,1,'Hidden pages must skip broadcast list polling');
   reconciliationChecks.concurrentRefreshRequests=requests;
  }
  const report={mode,viewport,errors,reconciliationChecks,screenshotCheck,results:results.samples,snapshotHashes:Object.fromEntries(Object.entries(results.snapshots).map(([name,snapshot])=>[name,createHash('sha256').update(snapshot).digest('hex')]))};
  reports.push(report);console.log(JSON.stringify({mode,viewport,results:results.samples}));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({cardCount:league.ownTeam.roster.reduce((n,p)=>n+(p.cards?.length??0),0),reports},null,2));
  await context.close();
 }
 console.log('Desktop and mobile DOM, controls and broadcast pixels match the baseline.');
}finally{await browser?.close();await server.stop();}
