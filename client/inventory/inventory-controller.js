import { PLAYER_PACK_DEFINITIONS } from "../../shared/config/player-packs.mjs";
import { meteorLayer } from "../ui/meteor-background.js";
import { playerCardMarkup } from "../player-card/player-card.js?v=20260905-shield-v1";
import {
  activateStageWindow,
  deactivateStageWindow,
  registerStageWindow,
} from "../ui/stage-window-manager.js";
import { bindSmallWindow } from "../ui/small-window.js";

const PACK_ARTWORK_BY_TYPE = Object.freeze({
  ...Object.fromEntries(Object.values(PLAYER_PACK_DEFINITIONS).filter(p=>p.clubId).map(p=>[p.type,p.artwork])),
  "legendary-player-pack":"./assets/player-packs/player-pack-icon-red-gold-v4-cutout.png",
  "exotic-player-pack":"./assets/player-packs/player-pack-icon-purple-green-v5-cutout.png",
  "rare-player-pack":"./assets/player-packs/player-pack-icon-white-blue-v4-cutout.png",
  "common-player-pack":"./assets/player-packs/player-pack-icon-black-v4-cutout.png",
});

const PACK_META = Object.freeze({
  ...Object.fromEntries(Object.values(PLAYER_PACK_DEFINITIONS).filter(p=>p.clubId).map(p=>[p.type,{name:p.name,quality:"豪门首发 +1",className:"is-legendary"}])),
  "legendary-player-pack": { name:"传奇球员卡包", quality:"传奇", className:"is-legendary" },
  "exotic-player-pack": { name:"珍奇球员卡包", quality:"珍奇", className:"is-exotic" },
  "rare-player-pack": { name:"稀有球员卡包", quality:"稀有", className:"is-rare" },
  "common-player-pack": { name:"普通球员卡包", quality:"普通", className:"is-common" },
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function header(title) {
  return `<header class="inventory-window-header"><h2>${escapeHtml(title)}</h2><button type="button" data-inventory-close data-stage-window-close data-small-window-close aria-label="关闭背包">×</button></header>`;
}

export function inventoryShelfPacks(value) {
  const stored = new Map((value?.packs ?? []).map(pack => [pack.type, pack]));
  return Object.entries(PACK_META).filter(([type])=>!PLAYER_PACK_DEFINITIONS[type]?.clubId||(stored.get(type)?.count??0)>0).map(([type, meta]) => {
    const pack = stored.get(type);
    const count = Number(pack?.count ?? 0);
    return { ...PLAYER_PACK_DEFINITIONS[type], ...pack, type, name: pack?.name || meta.name,
      count: Number.isSafeInteger(count) && count >= 0 ? count : 0 };
  }).sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
}

export function inventoryPackDetailsMarkup(selected, { pending = false } = {}) {
  if (!selected) return '<p class="inventory-empty-state">请选择一个物品</p>';
  const meta = PACK_META[selected.type];
  const weights = selected.gradeWeights ?? PLAYER_PACK_DEFINITIONS[selected.type]?.gradeWeights ?? {};
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const odds = ["S", "A", "B", "C"].map(grade => {
    const percent = total > 0 ? 100 * Math.max(0, Number(weights[grade]) || 0) / total : 0;
    return `<div class="inventory-grade-chance is-grade-${grade.toLowerCase()}"><dt>${grade}</dt><dd>${Number(percent.toFixed(1))}%</dd></div>`;
  }).join("");
  return `<div class="inventory-showcase-content">
      <div class="inventory-showcase-meta"><span class="inventory-showcase-quality">${escapeHtml(meta?.quality ?? "卡包")}</span><span>球员卡包</span></div>
      <div class="inventory-showcase-art"><img src="${PACK_ARTWORK_BY_TYPE[selected.type] ?? ""}" alt="" decoding="async" draggable="false"></div>
      <h3 data-inventory-detail-name>${escapeHtml(selected.name)}</h3>
      <p class="inventory-showcase-rule">获得球员 <b>${Number(selected.choiceCount) || 3} 选 1</b></p>
      <dl class="inventory-grade-chances" aria-label="基础评级概率">${selected.clubId?"<div>从该豪门 11 名首发中抽取 3 名不同球员，选择 1 名，强化 +1。</div>":odds}</dl>
    </div>
    <div class="inventory-showcase-use">
      <p class="inventory-showcase-owned"><span>拥有数量</span><strong data-inventory-detail-count>×${Number(selected.count)}</strong></p>
      <button type="button" class="inventory-showcase-action" data-open-pack="${escapeHtml(selected.type)}" aria-busy="${pending}" ${pending || Number(selected.count) < 1 ? "disabled" : ""}>${pending ? "开启中…" : Number(selected.count) > 0 ? "开启" : "数量不足"}</button>
    </div>`;
}

export function inventoryShelfMarkup(value, { activeTab = "all", selectedPackType = null, pending = false } = {}) {
  const packs = inventoryShelfPacks(value);
  const visiblePacks = activeTab === "all" || activeTab === "packs" ? packs : [];
  const selected = visiblePacks.find(pack => pack.type === selectedPackType) ?? visiblePacks[0] ?? null;
  const meta = selected ? PACK_META[selected.type] : null;
  return `${header("背包")}
    <div class="inventory-filter-bar" role="group" aria-label="背包分类">
      ${[["all","全部",false],["packs","卡包",false],["items","道具",true]].map(([id,label,disabled]) => `<button type="button" class="inventory-filter-tab ${activeTab === id ? "is-active" : ""}" data-inventory-tab="${id}" aria-pressed="${activeTab === id}" ${disabled || pending ? "disabled" : ""}>${label}</button>`).join("")}
    </div>
    <main class="inventory-window-main">
      <div class="inventory-content-layout">
        <div class="inventory-storage">
          <div class="inventory-pack-grid" role="group" aria-label="背包物品">
            ${visiblePacks.map(pack => {
              const packMeta = PACK_META[pack.type];
              return `<button type="button" class="inventory-pack-card ${packMeta.className} ${pack.count < 1 ? "is-empty-stock" : ""} ${pack.type === selected?.type ? "is-selected" : ""}" data-select-pack="${escapeHtml(pack.type)}" aria-pressed="${pack.type === selected?.type}" aria-label="${escapeHtml(pack.name)}，拥有 ${pack.count} 个" title="${escapeHtml(pack.name)}" ${pending ? "disabled" : ""}>
                <span class="inventory-pack-slot"><span class="inventory-pack-selected-mark" aria-hidden="true">◆</span><span class="inventory-pack-art" aria-hidden="true">${PACK_ARTWORK_BY_TYPE[pack.type] ? `<img src="${PACK_ARTWORK_BY_TYPE[pack.type]}" alt="" draggable="false" decoding="async">` : ""}</span><strong class="inventory-pack-count">×${pack.count}</strong></span>
              </button>`;
            }).join("")}
            ${Array.from({length:12}, () => '<div class="inventory-vacant-slot" aria-hidden="true"></div>').join("")}
          </div>
        </div>
        <aside class="inventory-showcase ${meta?.className ?? "is-common"}" data-inventory-showcase aria-live="polite">${inventoryPackDetailsMarkup(selected, { pending })}</aside>
      </div>
    </main>`;
}

export function createInventoryController({
  trigger,
  windowRoot,
  getCampaignRequest,
  getCampaignState,
  campaignStore,
  showToast = () => {},
  documentRef = globalThis.document,
} = {}) {
  if (!trigger || !windowRoot) throw new TypeError("背包需要顶部入口和小型窗口");
  let opened = false;
  let pending = false;
  let selectedPlayer = null;
  let selectedPackType = null;
  let activeTab = "all";
  let revealedOpeningId = null;
  let externalReward = null, choiceEpoch = 0;
  let unbindSmallWindow = () => {};

  function inventory() {
    return getCampaignState()?.inventory ?? null;
  }

  function updateTrigger() {
    const value = inventory();
    const total = Number(value?.totalPacks);
    const count = trigger.querySelector("[data-inventory-count]");
    if (!value || !Number.isSafeInteger(total) || total < 0) {
      trigger.hidden = true;
      return;
    }
    count.textContent = String(total);
    trigger.title = `背包 · ${total} 个球员卡包`;
    trigger.hidden = false;
  }

  function selectPack(packType) {
    const meta = PACK_META[packType];
    if (pending || !meta) return;
    selectedPackType = packType;
    // Preserve shelf nodes so the browser can recognize a native double click.
    for (const card of windowRoot.querySelectorAll("[data-select-pack]")) {
      const selected = card.dataset.selectPack === packType;
      card.classList.toggle("is-selected",selected);
      card.setAttribute("aria-pressed",String(selected));
    }
    const showcase = windowRoot.querySelector("[data-inventory-showcase]");
    if (showcase) {
      showcase.className = "inventory-showcase " + meta.className;
      showcase.innerHTML = inventoryPackDetailsMarkup(inventoryShelfPacks(inventory()).find(pack => pack.type === packType), { pending });
    }
  }

  function renderPackShelf(value) {
    const packs = inventoryShelfPacks(value);
    selectedPackType = packs.find(pack => pack.type === selectedPackType)?.type ?? packs[0]?.type ?? null;
    return inventoryShelfMarkup(value, { activeTab, selectedPackType, pending });
  }


  function renderOpening(opening, reveal) {
    return `${meteorLayer()}
      <main class="inventory-opening-stage">
        <div class="inventory-choice-grid" data-choice-count="${opening.cards.length}">${opening.cards.map((card,index) => `
          <article class="inventory-choice-card ${reveal ? "is-revealing" : "is-revealed"}" style="--reveal-index:${index}" data-choice-player="${escapeHtml(card.playerId ?? card.id)}">${playerCardMarkup(card,{interactive:true,variant:"standard",action:"pack-choice",ariaPrefix:"选择",eager:true})}</article>`).join("")}</div>
      </main>`;
  }

  function renderSelected(player) {
    return `${meteorLayer()}
      <main class="inventory-opening-stage inventory-acquired">
        <div class="inventory-acquired-card">${playerCardMarkup(player,{variant:"standard",eager:true})}</div>
      </main>`;
  }

  function render() {
    updateTrigger();
    if (!opened) return;
    const value = inventory();
    const opening = externalReward?.opening ?? value?.pendingOpening;
    if (selectedPlayer && windowRoot.querySelector(".inventory-acquired-card")) return;
    if (!selectedPlayer && opening && windowRoot.dataset.inventoryOpeningId === opening.id && windowRoot.querySelector(".inventory-opening-stage")) return;
    const reveal = Boolean(opening && opening.id !== revealedOpeningId);
    const smallShelf = !selectedPlayer && !opening;
    unbindSmallWindow();
    windowRoot.classList.toggle("small-window",smallShelf);
    windowRoot.classList.remove("standard-window");
    windowRoot.classList.toggle("inventory-opening-stage-root",!smallShelf);
    if (smallShelf) {
      windowRoot.dataset.smallWindow = "inventory";
      delete windowRoot.dataset.standardWindow;
    } else {
      delete windowRoot.dataset.smallWindow;
      delete windowRoot.dataset.standardWindow;
    }
    const surfaceClass = smallShelf ? "small-window__dialog" : "inventory-opening-surface";
    const surfaceHook = smallShelf ? "data-small-window-dialog" : "";
    const label = smallShelf ? 'aria-labelledby="inventory-window-title"' : `aria-label="${selectedPlayer ? "获得球员" : "球员卡包候选选择"}"`;
    windowRoot.innerHTML = `<div class="inventory-window-surface ${surfaceClass}" ${surfaceHook} role="dialog" aria-modal="true" ${label} tabindex="-1">${selectedPlayer ? renderSelected(selectedPlayer) : opening ? renderOpening(opening,reveal) : renderPackShelf(value)}</div>`;
    if (smallShelf) unbindSmallWindow = bindSmallWindow(windowRoot,{onRequestClose:closeWindow});
    windowRoot.dataset.inventoryOpeningId = opening?.id ?? "";
    if (opening) revealedOpeningId = opening.id;
    const title = windowRoot.querySelector("h2");
    if (title) title.id = "inventory-window-title";
  }

  function openWindow() {
    if (pending) return;
    externalReward = null;
    choiceEpoch++;
    opened = true;
    selectedPlayer = null;
    selectedPackType = null;
    activateStageWindow(windowRoot);
    render();
  }

  function openReward({id,cards,claim,onClose}={}) {
    if(pending||!id||!cards?.length||typeof claim!=='function')return false;
    externalReward={opening:{id:'reward:'+id,cards},claim,onClose};
    choiceEpoch++;opened=true;selectedPlayer=null;
    activateStageWindow(windowRoot);render();return true;
  }

  function closeWindow(reason) {
    const back=externalReward?.onClose;
    externalReward=null;choiceEpoch++;
    windowRoot.dataset.inventoryOpeningId="";
    opened = false;
    selectedPlayer = null;
    windowRoot.hidden = true;
    deactivateStageWindow(windowRoot);
    if(back&&reason!=="superseded"&&reason!=="account")queueMicrotask(back);
  }

  async function openPack(packType) {
    const value = inventory();
    const pack = value?.packs?.find((item) => item.type === packType);
    if (pending || value?.pendingOpening || !PACK_META[packType] || !(Number(pack?.count) > 0)) return;
    pending = true;
    render();
    try {
      const value = await getCampaignRequest()("/api/campaign/inventory/packs/open", { method:"POST", body:{ packType } });
      pending = false;
      campaignStore.setState(value.state,{source:"pack-open"});
    } catch (error) {
      showToast(error.message || "卡包开启失败");
    } finally {
      if (pending) { pending = false; render(); }
    }
  }

  function animateChoice(playerId) {
    const cards = [...windowRoot.querySelectorAll(".inventory-choice-card")];
    for (const card of cards) card.classList.add(card.dataset.choicePlayer === String(playerId) ? "is-selected" : "is-dismissed");
    return new Promise((resolve) => globalThis.setTimeout(resolve,520));
  }

  async function choosePlayer(playerId) {
    if (pending) return;
    const reward=externalReward,opening=reward?.opening??inventory()?.pendingOpening;
    if (!opening || !opening.cards.some(c => String(c.playerId ?? c.id) === String(playerId))) return;
    const epoch=choiceEpoch,account=getCampaignState()?.playerId;
    pending = true;
    try {
      const claim = reward ? reward.claim(playerId) : getCampaignRequest()("/api/campaign/inventory/packs/choose", { method:"POST", body:{ openingId:opening.id, playerId } });
      const [value] = await Promise.all([claim, animateChoice(playerId)]);
      if(account!==getCampaignState()?.playerId)return;
      if(epoch===choiceEpoch&&opened)selectedPlayer=value.player;
      pending=false;
      campaignStore.setState(value.state,{source:reward?"reward-choose":"pack-choose"});
      render();
    } catch (error) {
      if(epoch===choiceEpoch){
        showToast(error.message || "球员选择失败");
        // Restore all candidates after a failed request; retry the same reward.
        windowRoot.dataset.inventoryOpeningId="";
      }
    } finally {
      pending=false;
      if(epoch===choiceEpoch)render();
    }
  }

  trigger.addEventListener("click",openWindow);
  windowRoot.addEventListener("click",(event)=>{
    const close = event.target.closest("[data-inventory-close]");
    if (close) return closeWindow();
    const tab = event.target.closest("[data-inventory-tab]");
    if (tab && !tab.disabled && !pending) { activeTab = tab.dataset.inventoryTab || "all"; selectedPackType = null; return render(); }
    if (selectedPlayer) {
      if (event.target.closest(".inventory-acquired-card")) return;
      if(externalReward)return closeWindow("complete");
      selectedPlayer = null;
      render();
      return;
    }
    const select = event.target.closest("[data-select-pack]");
    if (select) return selectPack(select.dataset.selectPack);
    const open = event.target.closest("[data-open-pack]");
    if (open) return openPack(open.dataset.openPack);
    const choice = event.target.closest('[data-player-card-action="pack-choice"]');
    if (choice) return choosePlayer(choice.dataset.playerCardId);
  });
  windowRoot.addEventListener("dblclick",(event)=>{
    const pack = event.target.closest("[data-select-pack]");
    if (!pack || pack.disabled) return;
    event.preventDefault();
    return openPack(pack.dataset.selectPack);
  });
  registerStageWindow(windowRoot,{kind:"inventory",onRequestClose:closeWindow,documentRef});
  campaignStore.subscribe(({ state, previousState, source }) => {
    if(source!=="subscribe"&&state?.playerId!==previousState?.playerId){closeWindow("account");}
    if (source === "subscribe" || state?.playerId !== previousState?.playerId ||
        JSON.stringify(state?.inventory) !== JSON.stringify(previousState?.inventory)) render();
  }, {emitCurrent:true});

  return Object.freeze({ open:openWindow, openReward, close:closeWindow, render, updateTrigger });
}
