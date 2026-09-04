import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInventoryController } from "../client/inventory/inventory-controller.js";

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
  assert.match(inventorySource,/Array\.from\(\{ length:48 \}/);
  assert.match(inventorySource,/class="inventory-opening-meteors"/);
  assert.match(inventoryStyles,/@keyframes inventory-opening-meteor/);
  assert.match(inventoryStyles,/\.inventory-opening-surface\{position:absolute;inset:0/);
  assert.match(inventoryStyles,/\.inventory-opening-surface\{[^}]*grid-template-rows:1fr!important[^}]*border:0[^}]*border-radius:0/);
  assert.match(inventoryStyles,/\.inventory-opening-stage\{position:absolute;[^}]*inset:0;[^}]*place-items:center;[^}]*overflow:visible/);
  assert.match(inventorySource,/selectedPlayer && windowRoot\.querySelector\("\.inventory-acquired-card"\)\) return/);
});

test("pack shelf uses 4:3 item slots and quality framing for all four pack tiers", () => {
  assert.match(inventoryStyles,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(inventoryStyles,/aspect-ratio:4\/3/);
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
  assert.match(teamSource,/<header class="team-management-header"><div class="team-management-title"><h2>球队管理<\/h2>/);
  assert.match(inventorySource,/<header class="inventory-window-header"><h2>/);
  assert.doesNotMatch(inventorySource,/YELLOWDOGS CHRONICLES|INVENTORY|管理你在征程/);
});
