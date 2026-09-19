import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInventoryController, inventoryShelfPacks, inventoryShelfMarkup, inventoryPackDetailsMarkup } from "../client/inventory/inventory-controller.js";

const meteorSource = await readFile(new URL("../client/ui/meteor-background.js",import.meta.url),"utf8");
const inventorySource = await readFile(new URL("../client/inventory/inventory-controller.js",import.meta.url),"utf8");
const inventoryStyles = await readFile(new URL("../styles/inventory.css",import.meta.url),"utf8");
const teamSource = await readFile(new URL("../client/team/team-controller-ydl.js",import.meta.url),"utf8");

function fixtureElement(documentRef, countNode = null) {
  const dialog = {
    dataset:{},
    classList:{ add(){}, remove(){}, toggle(){} },
    addEventListener(){},
    removeEventListener(){},
    getAttribute(){ return null; },
    setAttribute(){},
    focus(){},
  };
  return {
    hidden:true,
    dataset:{},
    ownerDocument:documentRef,
    classList:{ add(){}, remove(){}, toggle(){} },
    attributes:{},
    addEventListener(){},
    removeEventListener(){},
    closest(){ return null; },
    querySelector(selector) {
      if (selector === "[data-inventory-count]") return countNode;
      if (selector.includes("data-small-window-dialog")) return dialog;
      return null;
    },
    setAttribute(name,value) { this.attributes[name]=value; },
  };
}

test("inventory uses the small window lifecycle and truly hides when closed", () => {
  const documentRef = { activeElement:null, addEventListener(){} };
  const countNode = { textContent:"" };
  const trigger = fixtureElement(documentRef,countNode);
  const windowRoot = fixtureElement(documentRef);
  const state = {
    inventory:{
      totalPacks:2,
      packs:[{ type:"exotic-player-pack", name:"珍奇球员卡包", count:2 }],
      pendingOpening:null,
    },
  };
  const campaignStore = {
    subscribe(listener,{emitCurrent}={}) { if (emitCurrent) listener({state}); return () => {}; },
    setState() {},
  };
  const controller = createInventoryController({
    trigger,
    windowRoot,
    getCampaignRequest:() => null,
    getCampaignState:() => state,
    campaignStore,
    documentRef,
  });

  assert.equal(trigger.hidden,false);
  assert.equal(countNode.textContent,"2");
  controller.open();
  assert.equal(windowRoot.hidden,false);
  controller.close();
  assert.equal(windowRoot.hidden,true);
  assert.equal(windowRoot.attributes["aria-hidden"],"true");
  assert.match(inventorySource,/bindSmallWindow\(windowRoot/);
  assert.match(inventorySource,/kind:"inventory"/);
  assert.match(inventorySource,/const smallShelf = !selectedPlayer && !opening/);
  assert.match(inventorySource,/smallShelf \? "small-window__dialog" : "inventory-opening-surface"/);
  assert.match(inventorySource,/classList\.toggle\("inventory-opening-stage-root",!smallShelf\)/);
  assert.doesNotMatch(inventorySource,/classList\.toggle\("standard-window"/);
});

test("inventory shows all pack tiers with selected details before opening", () => {
  assert.match(inventorySource,/Object\.entries\(PACK_META\)/);
  assert.doesNotMatch(inventorySource,/\.flatMap\(\(pack\) => Array\.from/);
  assert.match(inventorySource,/data-select-pack/);
  assert.match(inventorySource,/inventory-pack-count/);
  assert.match(inventorySource,/Number\(selected\.count\) < 1/);
  assert.match(inventorySource,/inventory-filter-tab|inventory-showcase|data-open-pack/);
  assert.doesNotMatch(inventorySource,/PLAYER PACKS|NEW LAND|CONQUEST PACK|CHOOSE ONE PLAYER|PLAYER ACQUIRED/);
});

test("pack opening and card choice show cards only with reveal and selection motion", () => {
  assert.match(inventorySource,/--reveal-index:\$\{index\}/);
  assert.match(inventorySource,/let revealedOpeningId = null/);
  assert.match(inventorySource,/windowRoot\.dataset\.inventoryOpeningId === opening\.id/);
  assert.match(inventorySource,/opening\.id !== revealedOpeningId/);
  assert.match(inventorySource,/is-revealing" : "is-revealed/);
  assert.match(inventorySource,/function animateChoice/);
  assert.match(inventorySource,/"is-selected" : "is-dismissed"/);
  assert.match(inventorySource,/if \(selectedPlayer\)[\s\S]*?closest\("\.inventory-acquired-card"\)[\s\S]*?selectedPlayer = null/);
  assert.doesNotMatch(inventorySource,/selectedTimer|setTimeout\(\(\) => \{\s*selectedPlayer = null/);
  assert.doesNotMatch(inventorySource,/inventory-choice-note|点击选择|选择后该球员|data-inventory-back|已加入球队/);
  assert.match(inventoryStyles,/@keyframes inventory-card-reveal/);
  assert.match(inventoryStyles,/\.inventory-choice-card\.is-revealing\{[^}]*animation:inventory-card-reveal/);
  assert.match(inventoryStyles,/\.inventory-choice-card\.is-revealed\{opacity:1\}/);
  assert.match(inventoryStyles,/@keyframes inventory-choice-selected/);
  assert.match(inventoryStyles,/@keyframes inventory-choice-dismissed/);
  assert.match(inventoryStyles,/@keyframes inventory-acquired-card/);
  assert.match(meteorSource,/Array\.from\(\{ length:16 \}/);
  assert.match(meteorSource,/class="inventory-opening-meteors"/);
  assert.match(inventoryStyles,/@keyframes inventory-opening-meteor/);
  assert.match(inventoryStyles,/\.inventory-opening-surface\{position:absolute;inset:0/);
  assert.match(inventoryStyles,/\.inventory-opening-surface\{[^}]*grid-template-rows:1fr!important[^}]*border:0[^}]*border-radius:0/);
  assert.match(inventoryStyles,/\.inventory-opening-stage\{position:absolute;[^}]*inset:0;[^}]*place-items:center;[^}]*overflow:visible/);
  assert.match(inventorySource,/selectedPlayer && windowRoot\.querySelector\("\.inventory-acquired-card"\)\) return/);
});

test("pack shelf uses item slots and quality framing for all four pack tiers", () => {
  assert.match(inventoryStyles,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(inventoryStyles,/inventory-pack-slot/);
  assert.match(inventorySource,/legendary-player-pack[^\n]*player-pack-icon-red-gold-v4-cutout\.png/);
  assert.match(inventorySource,/exotic-player-pack[^\n]*player-pack-icon-purple-green-v5-cutout\.png/);
  assert.match(inventorySource,/rare-player-pack[^\n]*player-pack-icon-white-blue-v4-cutout\.png/);
  assert.match(inventorySource,/common-player-pack[^\n]*player-pack-icon-black-v4-cutout\.png/);
  assert.match(inventorySource,/<span class="inventory-pack-art"[^>]*>\$\{PACK_ARTWORK_BY_TYPE\[pack\.type\] \? `<img/);
  assert.match(inventoryStyles,/\.inventory-pack-art img\{[^}]*object-fit:contain/);
  assert.match(inventoryStyles,/\.inventory-showcase/);
  assert.match(inventoryStyles,/\.inventory-pack-grid::\-webkit-scrollbar/);
  assert.doesNotMatch(inventorySource,/inventory-pack-emblem|NEW LAND|CONQUEST PACK|YDL/);
  assert.doesNotMatch(inventorySource,/inventory-pack-art[^\n]*pack\.name/);
});

test("team and inventory window headers contain only their Chinese titles", () => {
  assert.doesNotMatch(teamSource,/YELLOWDOGS CHRONICLES|CLUB MANAGEMENT|点击球员卡查看详细数值/);
  assert.match(teamSource,/<header class="team-management-header"><div class="team-management-title"><h2>编队<\/h2>/);
  assert.match(inventorySource,/<header class="inventory-window-header"><h2>/);
  assert.doesNotMatch(inventorySource,/YELLOWDOGS CHRONICLES|INVENTORY|管理你在征程/);
});


function doubleClickFixture() {
  const documentRef = {activeElement:null,addEventListener(){}};
  const trigger = fixtureElement(documentRef,{textContent:""});
  const windowRoot = fixtureElement(documentRef), listeners = {};
  windowRoot.addEventListener = (type,listener) => (listeners[type] ??= []).push(listener);
  const showcase = {className:"",innerHTML:""};
  const types = ["legendary-player-pack","exotic-player-pack"];
  const cards = types.map((type)=>({dataset:{selectPack:type},disabled:false,setAttribute(){},classList:{toggle(){}}}));
  windowRoot.querySelectorAll = () => cards;
  const originalQuery = windowRoot.querySelector.bind(windowRoot);
  windowRoot.querySelector = (selector) => selector === "[data-inventory-showcase]" ? showcase : originalQuery(selector);
  let state = {inventory:{totalPacks:2,packs:[{type:types[1],name:"珍奇球员卡包",count:2}],pendingOpening:null}};
  const requests = [];
  let complete;
  const controller = createInventoryController({trigger,windowRoot,documentRef,
    getCampaignState:()=>state,
    getCampaignRequest:()=>async(path,options)=>{requests.push({path,options});return new Promise(resolve=>{complete=resolve;});},
    campaignStore:{subscribe(){return ()=>{};},setState(next){state=next;}},
  });
  controller.open();
  const event = (type,index=1)=>listeners[type][0]({target:{closest:selector=>selector === "[data-select-pack]" ? cards[index] : null},preventDefault(){}});
  return {event,requests,windowRoot,showcase,get state(){return state;},finish(){complete({state:{inventory:{...state.inventory,pendingOpening:{id:"opening-1"}}}});}};
}

test("single clicks preserve shelf nodes; double click opens selected pack once while pending",async()=>{
  const fixture=doubleClickFixture(),shelf=fixture.windowRoot.innerHTML;
  fixture.event("click");
  fixture.event("click");
  assert.equal(fixture.windowRoot.innerHTML,shelf,"Selection must not replace the double-click target");
  assert.match(fixture.showcase.innerHTML,/珍奇球员卡包/);
  assert.equal(fixture.requests.length,0);
  const pending=fixture.event("dblclick");
  await fixture.event("dblclick");
  assert.equal(fixture.requests.length,1);
  assert.deepEqual(fixture.requests[0],{path:"/api/campaign/inventory/packs/open",options:{method:"POST",body:{packType:"exotic-player-pack"}}});
  fixture.finish();await pending;
  await fixture.event("dblclick");
  assert.equal(fixture.requests.length,1,"An existing opening cannot consume another pack");
});

test("double clicking an empty pack or with a pending opening sends no request",async()=>{
  const fixture=doubleClickFixture();
  fixture.event("click",0);
  await fixture.event("dblclick",0);
  assert.equal(fixture.requests.length,0);
  fixture.state.inventory.pendingOpening={id:"existing"};
  await fixture.event("dblclick",1);
  assert.equal(fixture.requests.length,0);
});

test("unrelated campaign updates preserve the backpack shelf while inventory changes refresh it",async()=>{
 const {createCampaignStore}=await import('../client/core/campaign-store.js');
 const documentRef={activeElement:null,addEventListener(){}};
 const count={textContent:''},trigger=fixtureElement(documentRef,count),windowRoot=fixtureElement(documentRef);
 let renders=0,markup='';Object.defineProperty(windowRoot,'innerHTML',{get:()=>markup,set:value=>{renders++;markup=value;}});
 const initial={playerId:'p',inventory:{totalPacks:2,packs:[{type:'exotic-player-pack',name:'珍奇球员卡包',count:2}]}};
 const campaignStore=createCampaignStore(initial);
 const controller=createInventoryController({trigger,windowRoot,documentRef,getCampaignState:campaignStore.getState,getCampaignRequest:()=>null,campaignStore});
 controller.open();const before=renders;
 campaignStore.setState({...structuredClone(initial),world:{activeChallenges:[{minute:2}]},wallet:{gold:500}});
 assert.equal(renders,before);
 campaignStore.setState({...initial,inventory:{...initial.inventory,totalPacks:3,packs:[{...initial.inventory.packs[0],count:3}]}});
 assert.equal(renders,before+1);assert.equal(count.textContent,'3');
 controller.close();
});

test("backpack prioritizes owned packs, keeps all tiers and displays authoritative grade weights", () => {
  const value = {packs:[{type:"exotic-player-pack",count:46,gradeWeights:{S:20,A:60,B:15,C:5}}]};
  const packs = inventoryShelfPacks(value);
  assert.equal(packs.length,4);
  assert.equal(packs[0].type,"exotic-player-pack");
  assert.equal(packs[0].count,46);
  const html = inventoryShelfMarkup(value);
  assert.match(html,/is-selected" data-select-pack="exotic-player-pack"/);
  assert.match(html,/<dd>20%<\/dd>/);
  assert.match(html,/<dd>60%<\/dd>/);
  assert.match(html,/aria-label="基础评级概率"/);
  assert.equal((html.match(/data-select-pack=/g) ?? []).length,4);
  assert.equal((html.match(/class="inventory-vacant-slot" aria-hidden="true"/g) ?? []).length,12);
  assert.doesNotMatch(html,/inventory-pack-name|inventory-showcase-description|适合|冲击|backpack|data-lucide/);
  assert.match(inventoryPackDetailsMarkup(packs[0],{pending:true}),/aria-busy="true" disabled>开启中/);
});
test("an explicitly inspected empty pack stays selectable and cannot be opened", () => {
  const value={packs:[{type:"exotic-player-pack",count:46}]};
  const html=inventoryShelfMarkup(value,{selectedPackType:"legendary-player-pack"});
  assert.match(html,/is-empty-stock is-selected" data-select-pack="legendary-player-pack"/);
  assert.match(html,/data-open-pack="legendary-player-pack" aria-busy="false" disabled>数量不足/);
  assert.match(html,/<dd>35%<\/dd>/);
  const pending=inventoryShelfMarkup(value,{pending:true});
  assert.equal((pending.match(/aria-pressed="(?:true|false)"[^>]*disabled>/g) ?? []).length,7);
});


test('external elite reward shares reveal/choice/acquired flow and never consumes a pending pack',async()=>{
 const documentRef={activeElement:null,addEventListener(){}},trigger=fixtureElement(documentRef,{textContent:''}),root=fixtureElement(documentRef),listeners={};
 root.addEventListener=(type,fn)=>listeners[type]=fn;root.querySelectorAll=()=>[];
 let state={playerId:'p',inventory:{totalPacks:1,packs:[],pendingOpening:{id:'pack-waiting',cards:[{id:'pack',name:'背包球员'}]}}};
 let claims=0,packRequests=0,returned=0;
 const controller=createInventoryController({trigger,windowRoot:root,documentRef,getCampaignState:()=>state,getCampaignRequest:()=>async()=>{packRequests++;},campaignStore:{subscribe(){},setState(next){state=next;}}});
 assert.equal(controller.openReward({id:'elite-win',cards:[{id:'elite-a',name:'奖励球员'},{id:'elite-b',name:'另一个'},{id:'elite-c',name:'第三个'}],claim:async id=>{claims++;return {player:{id:'received',name:'获得球员'},state:{...state}};},onClose:()=>returned++}),true);
 assert.match(root.innerHTML,/data-choice-count="3"/);assert.ok(!root.innerHTML.includes('背包球员'));
 const event={target:{closest:s=>s==='[data-player-card-action="pack-choice"]'?{dataset:{playerCardId:'elite-a'}}:null}};
 assert.doesNotMatch(root.innerHTML,/data-confirm-pack-choice/);
 const first=listeners.click(event);assert.equal(claims,1,'clicking the chosen card starts the original selection flow');await listeners.click(event);await first;
 assert.equal(claims,1);assert.equal(packRequests,0);assert.equal(state.inventory.pendingOpening.id,'pack-waiting');assert.match(root.innerHTML,/inventory-acquired-card/);
 listeners.click({target:{closest:()=>null}});await Promise.resolve();assert.equal(returned,1);assert.equal(root.hidden,true);
 controller.open();assert.match(root.innerHTML,/背包球员/);controller.close();
});
