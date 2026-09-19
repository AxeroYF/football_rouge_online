import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enhancementCardEntries, createEnhancementController } from "../client/enhancement/enhancement-controller.js";
import { createCampaignStore } from "../client/core/campaign-store.js";
import { S4_ENHANCEMENT } from "../shared/config/enhancement.mjs";
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const cards=[{playerId:"one",cardDefinitionId:"henry",name:"亨利",overall:90,baseOverall:90,grade:"S",role:"ST",pool:"ATT",upgradeLevel:0,traits:[],labels:["训练中","远征首发"]},{playerId:"two",cardDefinitionId:"henry",name:"亨利",overall:90,baseOverall:90,grade:"S",role:"ST",pool:"ATT",upgradeLevel:0,traits:[],labels:["留守首发"]},{playerId:"single",cardDefinitionId:"other",name:"单卡",overall:80,grade:"A",role:"CM",pool:"MID",upgradeLevel:0,traits:[]}];
const view={...S4_ENHANCEMENT,cards,history:[],traitOffers:[]};
function fixture(){
 const requests=[],events={},toasts=[];
 const content={innerHTML:"",querySelector:()=>null,querySelectorAll:()=>[]};
 const classes=new Set();
 const root={hidden:true,dataset:{},classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},ownerDocument:{addEventListener(){},activeElement:null},setAttribute(){},closest:()=>null,innerHTML:"",querySelector:s=>s==='[data-enhancement-content]'?content:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>events[name]=fn};
 const store=createCampaignStore({playerId:"p",setupComplete:true,wallet:{gold:10000},draft:{roster:cards}});
 const controller=createEnhancementController({root,getCampaignState:store.getState,getCampaignRequest:()=>(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),campaignStore:store,showToast:v=>toasts.push(v),delay:async()=>{}});
 const click=(selector,dataset={})=>events.click({target:{closest:s=>s===selector?{dataset}:null}});
 return {root,store,requests,content,controller,click,toasts,events};
}
test("warehouse contains only independently identified duplicate families, never merges names with different definitions",()=>{
 const copy=structuredClone(cards);assert.deepEqual(enhancementCardEntries(copy).map(e=>e.card.id),["one","two"]);assert.deepEqual(copy,cards);
 assert.equal(enhancementCardEntries([{...cards[0]},{...cards[1],cardDefinitionId:"different-person"}]).length,0);
});
test("S4 window renders duplicate warehouse, training/lineup markers, compositor and history",async()=>{
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 assert.match(f.content.innerHTML,/enhancement-composer/);assert.match(f.content.innerHTML,/enhancement-history-mini/);assert.match(f.content.innerHTML,/批量合卡/);
 assert.match(f.content.innerHTML,/训练中/);assert.match(f.content.innerHTML,/远征首发/);assert.match(f.content.innerHTML,/留守首发/);assert.doesNotMatch(f.content.innerHTML,/单卡/);
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});
 assert.match(f.content.innerHTML,/100%/);assert.match(f.content.innerHTML,/能力 90 → 91/);
 assert.match(f.content.innerHTML,/data-enhancement-submit >强化/);f.controller.close();
});
test("single enhancement locks duplicate submissions, keeps retry identity and removes the consumed card",async()=>{
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});
 f.click('[data-enhancement-submit]');f.click('[data-enhancement-submit]');assert.equal(f.requests.length,2);
 const requestId=f.requests[1].options.body.requestId;f.requests[1].reject(new Error('temporary failure'));await flush();
 f.click('[data-enhancement-submit]');assert.equal(f.requests[2].options.body.requestId,requestId);
 const nextCard={...cards[0],upgradeLevel:1,overall:91};
 f.requests[2].resolve({result:{id:'result',success:true,beforeLevel:0,afterLevel:1,card:nextCard},state:{...f.store.getState(),draft:{roster:[nextCard,cards[2]]}},view:{...view,cards:[nextCard,cards[2]]}});await flush();
 assert.match(f.content.innerHTML,/强化成功/);assert.doesNotMatch(f.content.innerHTML,/data-enhancement-card="two"/);
 assert.match(f.content.innerHTML,/没有符合条件的同名重复卡/);f.controller.close();
});
test("closing and account switches discard stale reads and mutation results",async()=>{
 const f=fixture();f.controller.open();f.controller.close();f.requests[0].resolve(structuredClone(view));await flush();assert.equal(f.root.hidden,true);
 f.controller.open();f.requests[1].resolve(structuredClone(view));await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});f.click('[data-enhancement-submit]');
 f.store.setState({playerId:'other',setupComplete:true,wallet:{gold:1}});
 f.requests[2].resolve({result:{},state:{playerId:'p'},view});await flush();assert.equal(f.store.getState().playerId,'other');assert.equal(f.root.hidden,true);
});
test("topbar replacement and wide window retain S4 success and trait selection styling",()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="topbar-enhancement"[^>]*>强化/);assert.doesNotMatch(html,/<button[^>]*>球探<\/button>/);assert.match(html,/data-wide-window="enhancement"/);
 const css=readFileSync(new URL('../styles/enhancement.css',import.meta.url),'utf8');assert.match(css,/traits-open \.enhancement-celebration-traits/);assert.match(css,/var\(--wide-window-max-width\)/);
});


test("selected copies leave the warehouse without hiding the remaining matching material", async () => {
 const f=fixture();f.controller.open();
 f.requests[0].resolve({...structuredClone(view),cards:[{...cards[0],upgradeLevel:1},cards[1]]});await flush();
 const warehouse=()=>f.content.innerHTML.split('<section class="enhancement-warehouse"')[1];
 assert.match(warehouse(),/data-enhancement-card="one"/);assert.match(warehouse(),/data-enhancement-card="two"/);
 f.click('[data-enhancement-card]',{enhancementCard:'one'});
 assert.doesNotMatch(warehouse(),/data-enhancement-card="one"/);assert.match(warehouse(),/data-enhancement-card="two"/);
 f.click('[data-enhancement-card]',{enhancementCard:'two'});
 assert.doesNotMatch(warehouse(),/data-enhancement-card="one"|data-enhancement-card="two"/);assert.match(f.content.innerHTML,/data-enhancement-submit >强化/);
 f.click('[data-enhancement-submit]');assert.equal(f.requests[1].options.body.mainCardId,'one');assert.equal(f.requests[1].options.body.materialCardId,'two');
 f.requests[1].reject(new Error('fixture'));await flush();f.controller.close();
});

test("pending trait card occupies the result frame and is not also shown in warehouse", async () => {
 const f=fixture();f.controller.open();
 f.requests[0].resolve({...structuredClone(view),cards:[{...cards[0],upgradeLevel:4,mainBlocked:'请先为主卡绑定强化特性'},{...cards[1],upgradeLevel:4}],traitOffers:[{cardId:'one',traits:[]}]});await flush();
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-card="one"/);assert.match(f.content.innerHTML,/data-enhancement-card="two"/);
 f.click('[data-enhancement-card]',{enhancementCard:'one'});assert.match(f.toasts.at(-1),/绑定强化特性/);
 f.click('[data-enhancement-card]',{enhancementCard:'two'});f.click('[data-enhancement-card]',{enhancementCard:'one'});
 assert.match(f.content.innerHTML,/data-enhancement-submit >强化/);f.controller.close();
});

test("result is held outside warehouse until explicitly returned, then can be used again", async () => {
 const f=fixture(),third={...cards[1],playerId:'third'};f.controller.open();
 f.requests[0].resolve({...structuredClone(view),cards:[cards[0],cards[1],third]});await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});f.click('[data-enhancement-submit]');
 const resultCard={...cards[0],upgradeLevel:1};
 f.requests[1].resolve({result:{id:'result',success:true,beforeLevel:0,afterLevel:1,card:resultCard},state:{...f.store.getState(),draft:{roster:[resultCard,third]}},view:{...view,cards:[resultCard,third]}});await flush();
 assert.match(f.content.innerHTML,/强化成功/);assert.doesNotMatch(f.content.innerHTML,/data-enhancement-card="one"/);assert.match(f.content.innerHTML,/data-enhancement-card="third"/);assert.doesNotMatch(f.content.innerHTML,/data-enhancement-card="two"/);
 f.click('[data-enhancement-card]',{enhancementCard:'third'});
 assert.match(f.content.innerHTML,/data-enhancement-result-card="one"/);
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-card="one"/);
 f.click('[data-enhancement-slot-card]',{enhancementSlotCard:'main'});
 assert.match(f.content.innerHTML,/data-enhancement-result-card="one"/);
 f.events.dblclick({preventDefault(){},target:{closest:s=>s==='[data-enhancement-result-card]'?{dataset:{enhancementResultCard:'one'}}:null}});
 assert.match(f.content.innerHTML,/data-enhancement-card="one"/);
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'third'});
 assert.match(f.content.innerHTML,/data-enhancement-submit >强化/);f.controller.close();
});


test("S4 clicks select main then material; only clicking the slot returns its card", async () => {
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});
 f.click('[data-enhancement-card]',{enhancementCard:'one'});
 assert.equal(f.toasts.at(-1),'主卡和副卡不能是同一张卡');
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="main" data-enhancement-card-id="one"/);
 f.click('[data-enhancement-card]',{enhancementCard:'two'});
 f.click('[data-enhancement-card]',{enhancementCard:'two'});
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="material" data-enhancement-card-id="two"/);
 f.click('[data-enhancement-slot-card]',{enhancementSlotCard:'main'});
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-slot-card="main"/);
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="material" data-enhancement-card-id="two"/);
 f.click('[data-enhancement-card]',{enhancementCard:'two'});
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="main" data-enhancement-card-id="two"/);
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-slot-card="material"/);f.controller.close();
});

test("S4 drag can fill material before main; selecting a different family clears the incompatible material", async () => {
 const f=fixture();f.controller.open();f.requests[0].resolve({...structuredClone(view),cards:[...cards,{...cards[2],playerId:'other-copy'}]});await flush();
 f.events.drop({preventDefault(){},dataTransfer:{getData:()=> 'two'},target:{closest:s=>s==='[data-enhancement-drop]'?{dataset:{enhancementDrop:'material'}}:null}});
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="material" data-enhancement-card-id="two"/);
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-slot-card="main"/);
 f.click('[data-enhancement-card]',{enhancementCard:'single'});
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="main" data-enhancement-card-id="single"/);
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-slot-card="material"/);f.controller.close();
});

test("S4 result stays on a single click and returns on double click", async () => {
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});f.click('[data-enhancement-submit]');
 const next={...cards[0],upgradeLevel:1};
 f.requests[1].resolve({result:{id:'result',success:true,beforeLevel:0,afterLevel:1,card:next},state:{...f.store.getState(),draft:{roster:[next]}},view:{...view,cards:[next]}});await flush();
 f.click('[data-enhancement-result-card]',{enhancementResultCard:'one'});
 assert.match(f.content.innerHTML,/data-enhancement-result-card="one"/);
 f.events.dblclick({preventDefault(){},target:{closest:s=>s==='[data-enhancement-result-card]'?{dataset:{enhancementResultCard:'one'}}:null}});
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-result-card="one"/);assert.match(f.content.innerHTML,/phase-idle/);f.controller.close();
});


test("held result can move straight to the main slot without duplicating it in warehouse",async()=>{
 const f=fixture(),third={...cards[1],playerId:'third'};f.controller.open();
 f.requests[0].resolve({...structuredClone(view),cards:[cards[0],cards[1],third]});await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});f.click('[data-enhancement-submit]');
 const next={...cards[0],upgradeLevel:1};
 f.requests[1].resolve({result:{id:'result',success:true,beforeLevel:0,afterLevel:1,card:next},state:{...f.store.getState(),draft:{roster:[next,third]}},view:{...view,cards:[next,third]}});await flush();
 const frame=f.content.innerHTML.split('<div class="enhancement-result-frame">')[1].split('<div class="enhancement-result-status"')[0];
 assert.doesNotMatch(frame,/强化成功/);
 assert.match(f.content.innerHTML,/<div class="enhancement-result-status" aria-live="polite"><h3>强化成功/);
 f.events.drop({preventDefault(){},dataTransfer:{getData:()=> 'one'},target:{closest:s=>s==='[data-enhancement-drop]'?{dataset:{enhancementDrop:'main'}}:null}});
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="main" data-enhancement-card-id="one"/);
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-result-card="one"|data-enhancement-card="one"/);
 f.click('[data-enhancement-card]',{enhancementCard:'third'});
 assert.match(f.content.innerHTML,/data-enhancement-submit >强化/);
 f.controller.close();
});


function historyEntry(index) {
 return {id:'history-'+index,createdAt:new Date(Date.UTC(2026,8,5,0,index)).toISOString(),
  mainCard:{...cards[0],name:'记录球员-'+index},materialCard:cards[1],card:{...cards[0],upgradeLevel:1},
  beforeLevel:0,afterLevel:1,success:true,chance:100};
}

test("compact history renders the latest 50 entries, newest first, inside the focusable list",async()=>{
 const f=fixture();f.controller.open();
 f.requests[0].resolve({...structuredClone(view),history:Array.from({length:60},(_,i)=>historyEntry(60-i))});await flush();
 const list=f.content.innerHTML.match(/<ol data-enhancement-history-list[^>]*>([\s\S]*?)<\/ol>/)?.[1];
 assert.ok(list);assert.equal((list.match(/<li class=/g)??[]).length,50);
 const names=[...list.matchAll(/<b>记录球员-(\d+) \+0<\/b>/g)].map(match=>Number(match[1]));
 assert.deepEqual(names,Array.from({length:50},(_,i)=>60-i));
 assert.doesNotMatch(f.content.innerHTML,/最近 50 条 · 最多 50 条/);
 assert.match(f.content.innerHTML,/data-enhancement-history-latest="history-60" tabindex="0" aria-label="最近50条强化记录"/);
 f.controller.close();
});

test("history scrolling survives card selection and returns to the newest row after enhancement",async()=>{
 const f=fixture();let markup='',list=null;
 Object.defineProperty(f.content,'innerHTML',{get:()=>markup,set(value){
  markup=value;
  const latest=value.match(/data-enhancement-history-latest="([^"]*)"/);
  list=latest?{scrollTop:0,dataset:{enhancementHistoryLatest:latest[1]}}:null;
 }});
 f.content.querySelector=selector=>selector==='[data-enhancement-history-list]'?list:null;
 f.controller.open();f.requests[0].resolve({...structuredClone(view),history:[historyEntry(1)]});await flush();
 list.scrollTop=240;
 f.click('[data-enhancement-card]',{enhancementCard:'one'});assert.equal(list.scrollTop,240);
 f.click('[data-enhancement-card]',{enhancementCard:'two'});assert.equal(list.scrollTop,240);
 f.click('[data-enhancement-submit]');assert.equal(list.scrollTop,240);
 const next={...cards[0],upgradeLevel:1},latest=historyEntry(2);
 f.requests[1].resolve({result:latest,state:{...f.store.getState(),draft:{roster:[next]}},view:{...view,cards:[next],history:[latest,historyEntry(1)]}});await flush();
 assert.equal(list.dataset.enhancementHistoryLatest,'history-2');assert.equal(list.scrollTop,0);
 assert.match(f.content.innerHTML,/强化成功/);f.controller.close();
});

test("history exposes actual protection use and price separately from natural level retention", async () => {
 const f=fixture();f.controller.open();
 const history=[
  {...historyEntry(3),beforeLevel:4,afterLevel:4,success:false,chance:70,protectionUsed:true,protectionCost:525},
  {...historyEntry(2),beforeLevel:2,afterLevel:2,success:false,chance:34,protectionUsed:false,protectionCost:0},
  {...historyEntry(1),beforeLevel:3,afterLevel:4,success:true,chance:85,protectionUsed:true,protectionCost:150},
 ];
 f.requests[0].resolve({...structuredClone(view),history});await flush();
 const list=f.content.innerHTML.match(/<ol data-enhancement-history-list[^>]*>([\s\S]*?)<\/ol>/)[1];
 const rows=[...list.matchAll(/<li class=[\s\S]*?<\/li>/g)].map(m=>m[0]);
 assert.match(rows[0],/已保卡/);assert.match(rows[0],/525 金币/);assert.match(rows[0],/失败 · 保持\+4/);
 assert.match(rows[1],/未保卡/);assert.match(rows[1],/0 金币/);assert.match(rows[1],/失败 · 保持\+2/);
 assert.match(rows[2],/已保卡/);assert.match(rows[2],/150 金币/);
 assert.doesNotMatch(list,/enhancement-history-protection empty/);
 assert.doesNotMatch(f.content.innerHTML,/最多 50 条/);
 const warehouse=f.content.innerHTML.split('<section class="enhancement-warehouse"')[1];
 assert.match(warehouse,/data-card-render=/);assert.doesNotMatch(warehouse,/<canvas|<svg/);
 const previousDocument=globalThis.document,overlays=[];
 globalThis.document={createElement:()=>({innerHTML:"",classList:{add(){}},addEventListener(){}})};
 f.root.append=overlay=>overlays.push(overlay);
 try{
  f.click('[data-enhancement-history-open]');
  assert.match(overlays[0].innerHTML,/已保卡/);assert.match(overlays[0].innerHTML,/未保卡/);
  assert.match(overlays[0].innerHTML,/花费/);assert.match(overlays[0].innerHTML,/525 金币/);
  assert.doesNotMatch(overlays[0].innerHTML,/ENHANCEMENT HISTORY|使用鼠标滚轮浏览|<canvas|<svg/);
  if(process.env.CARD_SCROLL_REVIEW_OUTPUT){
   const {mkdirSync,writeFileSync}=await import('node:fs');
   const output=process.env.CARD_SCROLL_REVIEW_OUTPUT;mkdirSync(output,{recursive:true});
   const shell=content=>'<!doctype html><html lang="zh-CN" data-ui-theme="club"><body><section class="enhancement-window">'+content+'</section></body></html>';
   writeFileSync(output+'/enhancement.html',shell(f.content.innerHTML));
   writeFileSync(output+'/history.html',shell(overlays[0].innerHTML));
  }
 }finally{globalThis.document=previousDocument;f.controller.close();}
});

test("match ticks do not reload the enhancement warehouse; roster changes still do",async()=>{
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 const state=f.store.getState();
 f.store.setState({...structuredClone(state),world:{activeChallenges:[{id:'match',minute:1}]}});
 f.store.setState({...structuredClone(state),world:{activeChallenges:[{id:'match',minute:2}]}});
 assert.equal(f.requests.length,1);
 f.store.setState({...state,draft:{roster:[...cards,{...cards[0],playerId:'new-copy'}]}});
 assert.equal(f.requests.length,2);f.controller.close();
});


function dragEvent(id){return {preventDefault(){},dataTransfer:{setData(){},effectAllowed:''},target:{closest:()=>({dataset:{enhancementCard:id},hasAttribute:()=>false,classList:{add(){}}})}};}
function dropSlot(f,id,slot){f.events.drop({preventDefault(){},dataTransfer:{getData:()=>id},target:{closest:s=>s==='[data-enhancement-drop]'?{dataset:{enhancementDrop:slot}}:null}});}

test('native slot moves and swaps keep each card in exactly one place',async()=>{
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});dropSlot(f,'one','material');
 assert.doesNotMatch(f.content.innerHTML,/data-enhancement-slot-card="main"/);assert.match(f.content.innerHTML,/data-enhancement-slot-card="material" data-enhancement-card-id="one"/);
 f.click('[data-enhancement-card]',{enhancementCard:'two'});dropSlot(f,'one','main');
 assert.match(f.content.innerHTML,/data-enhancement-slot-card="main" data-enhancement-card-id="one"/);assert.match(f.content.innerHTML,/data-enhancement-slot-card="material" data-enhancement-card-id="two"/);
 dropSlot(f,'one','main');assert.match(f.content.innerHTML,/data-enhancement-slot-card="main" data-enhancement-card-id="one"/);f.controller.close();
});

test('slot swap rejects a material that cannot be a main without partially moving cards',async()=>{
 const f=fixture();f.controller.open();f.requests[0].resolve({...structuredClone(view),cards:[cards[0],{...cards[1],mainBlocked:'请先绑定特性'}]});await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});dropSlot(f,'one','material');
 assert.equal(f.toasts.at(-1),'请先绑定特性');assert.match(f.content.innerHTML,/data-enhancement-slot-card="main" data-enhancement-card-id="one"/);assert.match(f.content.innerHTML,/data-enhancement-slot-card="material" data-enhancement-card-id="two"/);f.controller.close();
});

test('polling and an already in-flight read cannot rebuild cards during native dragging',async()=>{
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 f.store.setState({...f.store.getState(),wallet:{gold:9999}});assert.equal(f.requests.length,2);
 f.events.dragstart(dragEvent('one'));const before=f.content.innerHTML;
 f.requests[1].resolve({...structuredClone(view),cards:[...cards,{...cards[1],playerId:'third'}]});await flush();assert.equal(f.content.innerHTML,before);
 f.store.setState({...f.store.getState(),wallet:{gold:9998}});assert.equal(f.requests.length,2);
 f.events.dragend();assert.equal(f.requests.length,3);f.requests[2].resolve({...structuredClone(view),cards:[...cards,{...cards[1],playerId:'third'}]});await flush();assert.match(f.content.innerHTML,/data-enhancement-card="third"/);f.controller.close();
});

test('a stale pre-enhancement inventory read cannot resurrect a consumed material or downgrade the result',async()=>{
 const f=fixture();f.controller.open();f.requests[0].resolve(structuredClone(view));await flush();
 f.click('[data-enhancement-card]',{enhancementCard:'one'});f.click('[data-enhancement-card]',{enhancementCard:'two'});
 f.store.setState({...f.store.getState(),wallet:{gold:9999}});const stale=f.requests[1];
 f.click('[data-enhancement-submit]');const next={...cards[0],upgradeLevel:1};
 f.requests[2].resolve({result:{id:'result',success:true,beforeLevel:0,afterLevel:1,card:next},state:{...f.store.getState(),draft:{roster:[next]}},view:{...view,cards:[next]}});await flush();const result=f.content.innerHTML;
 stale.resolve(structuredClone(view));await flush();assert.equal(f.content.innerHTML,result);assert.doesNotMatch(result,/data-enhancement-card="two"/);f.controller.close();
});
