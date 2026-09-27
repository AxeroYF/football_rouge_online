import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStaticHandler} from '../server/http/static-handler.mjs';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const {chromium}=require('playwright'),serve=createStaticHandler(process.cwd());
const server=http.createServer((req,res)=>{if(req.url==='/__review'){res.setHeader('Content-Type','text/html');res.end('<html><body><nav id="primary-navigation"></nav></body></html>');}else serve(req,res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],report={};page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://127.0.0.1:'+server.address().port+'/__review');
 for(const path of ['styles.css','styles/enhancement.css','styles/campaign-broadcast.css','styles/standard-window.css'])await page.addStyleTag({url:'/'+path});
 report.team=await page.evaluate(async()=>{
  const {createTeamController}=await import('/client/team/team-controller-ydl.js');
  const {createCampaignStore}=await import('/client/core/campaign-store.js');
  const cards=Array.from({length:120},(_,i)=>({id:'p'+i,playerId:'p'+i,cardDefinitionId:'f'+i,name:'球员'+i,role:'ST',pool:'ATT',grade:'C',overall:70,attributes:{pace:70,finishing:75},traits:[]}));
  const store=createCampaignStore({playerId:'owner',draft:{roster:cards},playerSquads:{assignments:Object.fromEntries(cards.map(p=>[p.id,'garrison']))}});
  const panel=document.createElement('section');document.body.append(panel);let calls=0,fail=false;
  const c=createTeamController({panel,mapElement:document.body,getCampaignState:store.getState,campaignStore:store,getCampaignRequest:()=>async(path,{body})=>{calls++;if(!body.compact)throw Error('missing compact');if(fail)throw Error('server rejected');return {statePatch:{playerSquads:{assignments:{...store.getState().playerSquads.assignments,[body.playerId]:body.squadId}}}};}});
  c.open();const list=panel.querySelector('.team-player-list');list.style.height='250px';list.style.overflow='auto';list.scrollTop=200;const before=list.scrollTop;
  const row=panel.querySelector('[data-ui-key="team-player-p30"]'),select=panel.querySelector('[data-team-squad-player="p30"]');
  const t=performance.now();select.value='expedition';await select.onchange();const elapsed=performance.now()-t;
  const retained=row===panel.querySelector('[data-ui-key="team-player-p30"]')&&list===panel.querySelector('.team-player-list'),after=list.scrollTop;
  select.value='garrison';await select.onchange();fail=true;select.value='expedition';await select.onchange();
  const reverted=select.value==='garrison';c.close();return {before,after,retained,reverted,calls,elapsed};
 });
 assert.equal(report.team.retained,true);assert.equal(report.team.before,report.team.after);assert.equal(report.team.reverted,true);assert.equal(report.team.calls,3);
 report.enhancement=await page.evaluate(async()=>{
  const {createEnhancementController}=await import('/client/enhancement/enhancement-controller.js');const {createCampaignStore}=await import('/client/core/campaign-store.js');const {S4_ENHANCEMENT}=await import('/shared/config/enhancement.mjs');
  let cards=Array.from({length:40},(_,i)=>({id:'c'+i,playerId:'c'+i,cardDefinitionId:'family',name:'球员'+i,grade:'C',overall:70,baseOverall:70,role:'ST',pool:'ATT',upgradeLevel:3,traits:[],labels:[],attributes:{},squad:'garrison'}));
  const store=createCampaignStore({playerId:'p',setupComplete:true,wallet:{gold:100000},draft:{roster:cards}});const root=document.createElement('section');root.hidden=true;document.body.append(root);let delayCalls=0,mutations=0,compact=false;
  const view=()=>({...S4_ENHANCEMENT,cards,history:[],traitOffers:[]});
  const c=createEnhancementController({root,getCampaignState:store.getState,campaignStore:store,delay:async()=>{delayCalls++;},onState:(state,options)=>{compact=options.compact;},getCampaignRequest:()=>async(path,options)=>{
    if(!options)return view();mutations++;if(!options.body.compact)throw Error('missing compact');
    const card={...cards[0],upgradeLevel:4};cards=[card,...cards.slice(2)];return {result:{success:true,beforeLevel:3,afterLevel:4,card},statePatch:{draft:{roster:cards},wallet:{gold:99900}},view:view()};
  }});
  c.open();await new Promise(r=>setTimeout(r,50));root.querySelector('[data-enhancement-card="c0"]').click();root.querySelector('[data-enhancement-card="c1"]').click();
  const at=performance.now();root.querySelector('[data-enhancement-submit]').click();await new Promise(r=>setTimeout(r,50));
  const shown=root.textContent.includes('强化成功'),materialGone=!store.getState().draft.roster.some(p=>p.id==='c1');const elapsed=performance.now()-at;
  c.close();return {shown,materialGone,delayCalls,mutations,compact,elapsed};
 });
 assert.equal(report.enhancement.shown,true);assert.equal(report.enhancement.materialGone,true);assert.equal(report.enhancement.delayCalls,0);assert.equal(report.enhancement.mutations,1);assert.equal(report.enhancement.compact,true);
 report.television=await page.evaluate(async()=>{
  const {showCampaignBroadcast,startCampaignBroadcastBackground}=await import('/campaign-broadcast.js');
  const overlay=document.createElement('div');overlay.id='campaign-broadcast';document.body.append(overlay);
  const widget=document.createElement('aside');widget.id='campaign-live-widget';document.body.append(widget);
  const snapshot={completed:false,challenge:{id:'tv',phase:'second-leg',firstLeg:{teams:[{name:'A'},{name:'B'}],score:[2,1]}},live:{key:'tv:2',legNumber:2,phase:'second-leg',broadcast:{legNumber:2,finished:false,minute:4,score:[0,1],teams:[{id:'b',name:'B',players:[]},{id:'a',name:'A',players:[]}],events:[]}}};
  const controller=startCampaignBroadcastBackground(snapshot,{});showCampaignBroadcast(controller);
  const television=overlay.textContent.includes('首回合：A 2 : 1 B'),notification=widget.textContent.includes('首回合：A 2 : 1 B');
  const other={snapshot,opened:true};showCampaignBroadcast(other);const oldDetached=controller.renderOverlay===null&&!controller.opened;
  overlay.querySelector('[data-leave-broadcast]').click();controller.stop();return {television,notification,oldDetached};
 });
 for(const value of Object.values(report.television))assert.equal(value,true);
 report.defence=await page.evaluate(async()=>{
  const {createDefenceNotifications}=await import('/client/challenge/defence-notifications.js');const {createCampaignStore}=await import('/client/core/campaign-store.js');
  const center=document.createElement('div');center.id='campaign-notifications';center.className='is-collapsed';center.innerHTML='<button data-notification-toggle>展开</button><div><section id="probe-defence"></section></div>';document.body.append(center);
  center.querySelector('button').onclick=()=>center.classList.remove('is-collapsed');const root=center.querySelector('section'),store=createCampaignStore({playerId:'b',world:{activeChallenges:{}},battleHistory:[]});let toasts=0,opened=0;
  createDefenceNotifications({root,getState:store.getState,store,request:()=>async()=>({completed:true,battle:{}}),territoryName:()=>'<测试地块>',showToast:()=>toasts++,showBroadcast:()=>opened++});
  const state={...store.getState(),world:{activeChallenges:{t:{id:'c',defenderId:'b',attackerTeamName:'A',territoryId:'t',phase:'second-leg',firstLeg:{teams:[{name:'A'},{name:'B'}],score:[2,1]}}}}};store.setState(state);store.setState({...state});
  const node=root.querySelector('button');node.click();await new Promise(r=>setTimeout(r,10));
  const result={toasts,opened,expanded:!center.classList.contains('is-collapsed'),score:root.textContent.includes('首回合：A 2 : 1 B'),escaped:root.textContent.includes('<测试地块>')&&!root.querySelector('测试地块')};
  store.setState({playerId:'c',world:{activeChallenges:{}},battleHistory:[]});result.cleared=root.hidden;return result;
 });
 for(const key of ['expanded','score','escaped','cleared'])assert.equal(report.defence[key],true);assert.equal(report.defence.toasts,1);assert.equal(report.defence.opened,1);
 assert.deepEqual(errors,[]);report.errors=errors;
 fs.writeFileSync('outputs/performance-20260919/interaction-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
