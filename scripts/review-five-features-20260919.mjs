import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs'),{chromium}=require('playwright');
const styles=[...fs.readFileSync('index.html','utf8').matchAll(/<link[^>]*href="([^\"]+\.css[^\"]*)"/g)].map(m=>m[1]);
const serve=createStaticHandler(process.cwd()),server=http.createServer((req,res)=>{if(req.url==='/__warehouse'){res.setHeader('Content-Type','text/html');res.end('<html><head>'+styles.map(s=>`<link rel="stylesheet" href="/${s.replace(/^\.\//,'')}">`).join('')+'</head><body><nav id="primary-navigation"></nav></body></html>');}else serve(req,res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],report={};page.on('pageerror',e=>errors.push(e.message));
const catalog=JSON.parse(fs.readFileSync('assets/data/s4-player-catalog.json'));
const cards=Array.from({length:70},(_,i)=>({...catalog[i%catalog.length],id:'card-'+i,playerId:'card-'+i,cardInstanceId:'card-'+i,grade:i%2?'A':'S',role:i%3?'ST':'GK',upgradeLevel:i%4,blocked:i===0?'训练中':null}));
const boot=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/__warehouse');await page.evaluate(cards=>{window.cards=cards;window.requests=[];window.toast=[];window.tick=()=>new Promise(r=>setTimeout(r,70));},cards);};
try{
 await boot();
 await page.evaluate(async()=>{
  const {createCampaignStore}=await import('/client/core/campaign-store.js'),{createInteractionController}=await import('/client/social/interaction-controller.js'),{INTERACTION_RULES}=await import('/shared/config/diplomacy.mjs');
  const state={playerId:'p',setupComplete:true,interactions:{players:[],requests:[],events:[],news:[]}},store=createCampaignStore(state);
  const root=document.createElement('section');root.id='interaction-window';root.hidden=true;const listRoot=document.createElement('section'),notices=document.createElement('section');document.body.append(root,listRoot,notices);
  const view={selfId:'p',player:{id:'q',teamName:'对方球队'},gold:100000,oil:200,rules:INTERACTION_RULES,relationship:'peace',requests:[],events:[],myCards:cards,theirCards:cards.map(p=>({...p,id:'q-'+p.id,playerId:'q-'+p.id})),squad:{unavailable:true,roster:[],starters:[]},stats:{},matches:[]};
  window.controller=createInteractionController({root,listRoot,notices,campaignStore:store,getState:store.getState,getRequest:()=>async(url,opts)=>{if(opts)requests.push(opts.body);return {view,state};},showToast:m=>toast.push(m)});controller.open('q');await tick();
 });

 await page.locator('[data-interaction-action="trade-form"]').click();
 const give=page.locator('[data-warehouse="trade-give"]'),take=page.locator('[data-warehouse="trade-take"]');
 assert.equal(await give.locator('.social-upgrade-filter').innerText().then(t=>t.includes('强化等级')),true);
 await give.locator('[data-warehouse-filter="upgradeLevel"]').selectOption('3');
 const ids=await give.locator('[data-trade-card]').evaluateAll(nodes=>nodes.map(n=>Number(n.value.split('-').at(-1))));
 assert.ok(ids.length&&ids.every(i=>i%4===3));assert.equal(await take.locator('[data-warehouse-filter="upgradeLevel"]').inputValue(),'all');
 await give.locator('[data-warehouse-reset]').click();assert.equal(await give.locator('[data-warehouse-filter="upgradeLevel"]').inputValue(),'all');
 report.trade={upgradeFilter:true,independent:true,reset:true};
 await page.screenshot({path:'outputs/performance-20260919/five-features-trade.png'});
 await boot();
 report.team=await page.evaluate(async()=>{
  const {createTeamController}=await import('/client/team/team-controller-ydl.js');const {createCampaignStore}=await import('/client/core/campaign-store.js');
  const roster=Array.from({length:8},(_,i)=>({...cards[i],cardDefinitionId:'unique'+i,club:i%2?'曼城':'皇马',nationality:i%3?'法国':'西班牙'}));const store=createCampaignStore({draft:{roster},playerSquads:{assignments:{}}});
  const panel=document.createElement('section');document.body.append(panel);const c=createTeamController({panel,getCampaignState:store.getState,campaignStore:store,mapElement:document.body});c.open();
  let club=panel.querySelector('[data-team-filter="club"]');club.value='皇马';club.dispatchEvent(new Event('change'));const clubRows=panel.querySelectorAll('.team-player-list-row').length;
  const nation=panel.querySelector('[data-team-filter="nationality"]');nation.value='西班牙';nation.dispatchEvent(new Event('change'));const bothRows=panel.querySelectorAll('.team-player-list-row').length;
  const retained=panel.querySelector('[data-team-filter="club"]').value;return {clubRows,bothRows,retained};
 });
 assert.deepEqual(report.team,{clubRows:4,bothRows:2,retained:'皇马'});
 await page.screenshot({path:'outputs/performance-20260919/five-features-team.png'});
 await boot();
 report.research=await page.evaluate(async()=>{
  const {createTopicResearchController}=await import('/client/research/topic-research-controller.js');const {RESEARCH_TOPICS}=await import('/shared/config/research-preview.mjs');const {createCampaignStore}=await import('/client/core/campaign-store.js');
  const root=document.createElement('section');root.className='research-surface';document.body.append(root);const store=createCampaignStore({playerId:'p',formationResearch:{revision:1,topicLevels:{},sciencePerMinute:10,active:null}}),topic=RESEARCH_TOPICS.find(t=>t.branch==='biology');let calls=0;
  const c=createTopicResearchController({root,topic,getState:store.getState,campaignStore:store,getRequest:()=>async()=>{calls++;return {state:{...store.getState(),formationResearch:{...store.getState().formationResearch,active:{id:'job',topicId:topic.id,required:100,completed:0,updatedAt:Date.now(),sciencePerMinute:10}}}};}});
  const before=root.querySelector('[data-topic-start]'),cursor=getComputedStyle(before).cursor,enabled=!before.disabled;before.click();await new Promise(r=>setTimeout(r,20));const after=root.querySelector('[data-topic-start]');const result={cursor,enabled,calls,disabledAfter:after.disabled,cursorAfter:getComputedStyle(after).cursor};c.dispose();return result;
 });
 assert.deepEqual(report.research,{cursor:'pointer',enabled:true,calls:1,disabledAfter:true,cursorAfter:'not-allowed'});
 await page.screenshot({path:'outputs/performance-20260919/five-features-research.png'});
 await boot();
 report.kick=await page.evaluate(async()=>{
  const {createCoalitionController}=await import('/client/social/coalition-controller.js');const {createRaidController,raidWindowMarkup}=await import('/client/elite/raid-controller.js');const {createCampaignStore}=await import('/client/core/campaign-store.js');
  const makeArmy=()=>({id:'army',name:'联军',revision:1,canCommand:true,commanderId:'p',commanderName:'我',busy:false,contributors:['p','q'],roster:[{...cards[1],id:JSON.stringify(['q','foreign']),ownerName:'盟友'}],loans:[{ownerId:'q',playerId:'foreign'}]});
  const state={playerId:'p',setupComplete:true,coalition:{army:{revision:1}}},store=createCampaignStore(state),view={serverNow:Date.now(),members:[{id:'p',name:'我'},{id:'q',name:'盟友'}],army:makeArmy(),myCards:[]};let regularRequest,raidRequest;
  const c=createCoalitionController({getState:store.getState,campaignStore:store,metadata:new Map(),showToast:()=>{},getRequest:()=>async(url,opts)=>{if(opts){regularRequest=opts.body;view.army.loans=[];view.army.roster=[];}return {view,state};}});await c.open();document.querySelector('[data-coalition-action="kick"]').click();await new Promise(r=>setTimeout(r,20));c.close();
  const army=makeArmy(),activity={open:true,raids:[],matches:[],queue:[],history:[],coalition:{army,myCards:[]},army};
  const r=createRaidController({getState:store.getState,campaignStore:store,showToast:()=>{},getRequest:()=>async(url,opts)=>{if(opts?.body?.action==='kick'){raidRequest=opts.body;army.loans=[];army.roster=[];}return {activity,state};}});await r.open();document.querySelector('[data-raid-action="kick"]').click();await new Promise(r=>setTimeout(r,20));r.close();
  const ordinary={...activity,army:makeArmy(),coalition:{army:makeArmy(),myCards:[]}};ordinary.army.canCommand=false;ordinary.coalition.army.canCommand=false;
  return {regular:regularRequest&&[regularRequest.action,regularRequest.ownerId,regularRequest.playerId],raid:raidRequest&&[raidRequest.action,raidRequest.ownerId,raidRequest.playerId],hiddenFromMember:!raidWindowMarkup(ordinary,{playerId:'outsider'}).includes('data-raid-action="kick"')};
 });
 assert.deepEqual(report.kick,{regular:['kick','q','foreign'],raid:['kick','q','foreign'],hiddenFromMember:true});
 assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify(report));
}finally{fs.writeFileSync('outputs/performance-20260919/five-features-browser.json',JSON.stringify({...report,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
