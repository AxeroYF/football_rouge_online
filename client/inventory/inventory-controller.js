import { playerCardMarkup } from "../player-card/player-card.js";
import {
  activateStageWindow,
  deactivateStageWindow,
  registerStageWindow,
} from "../ui/stage-window-manager.js";
import { bindSmallWindow } from "../ui/small-window.js";

const PACK_ARTWORK_BY_TYPE = Object.freeze({
  "legendary-player-pack":"./assets/player-packs/player-pack-icon-red-gold-v4-cutout.png",
  "exotic-player-pack":"./assets/player-packs/player-pack-icon-purple-green-v5-cutout.png",
  "rare-player-pack":"./assets/player-packs/player-pack-icon-white-blue-v4-cutout.png",
  "common-player-pack":"./assets/player-packs/player-pack-icon-black-v4-cutout.png",
});

const PACK_META = Object.freeze({
  "legendary-player-pack": { name:"传奇球员卡包", quality:"传奇", className:"is-legendary", description:"高概率获得顶级球员，适合冲击阵容上限。" },
  "exotic-player-pack": { name:"珍奇球员卡包", quality:"珍奇", className:"is-exotic", description:"从三名高质量候选球员中选择一名加入球队。" },
  "rare-player-pack": { name:"稀有球员卡包", quality:"稀有", className:"is-rare", description:"稳定获得稀有级别球员，补强阵容核心位置。" },
  "common-player-pack": { name:"普通球员卡包", quality:"普通", className:"is-common", description:"基础球员来源，适合扩充球队与培养素材。" },
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function meteorMarkup() {
  return Array.from({ length:48 },(_,index) => {
    const startX = (index * 47) % 142 - 21;
    const startY = (index * 31) % 136 - 52;
    const delay = -((index * 37) % 120) / 10;
    const duration = 2.5 + (index % 7) * .3;
    const length = 62 + (index % 6) * 22;
    const opacity = .38 + index % 5 * .12;
    return `<i style="--meteor-x:${startX}vw;--meteor-y:${startY}vh;--meteor-delay:${delay}s;--meteor-duration:${duration}s;--meteor-length:${length}px;--meteor-opacity:${opacity}"></i>`;
  }).join("");
}

function meteorLayer() {
  return `<div class="inventory-opening-meteors" aria-hidden="true">${meteorMarkup()}</div>`;
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

  function header(title) {
    return `<header class="inventory-window-header"><h2>${escapeHtml(title)}</h2><button type="button" data-inventory-close data-stage-window-close data-small-window-close aria-label="关闭背包">×</button></header>`;
  }

  function renderPackShelf(value) {
    const storedPacks = new Map((value?.packs ?? []).map((pack) => [pack.type, pack]));
    const packs = Object.entries(PACK_META).map(([type, meta]) => ({
      type,
      name: storedPacks.get(type)?.name ?? meta.name,
      count: Number(storedPacks.get(type)?.count ?? 0),
    }));
    const visiblePacks = activeTab === "all" || activeTab === "packs" ? packs : [];
    const selected = visiblePacks.find((pack) => pack.type === selectedPackType) ?? visiblePacks[0] ?? null;
    selectedPackType = selected?.type ?? null;
    const meta = selected ? PACK_META[selected.type] : null;
    return `${header("背包")}
      <div class="inventory-filter-bar" role="tablist" aria-label="背包分类">
        ${[["all","全部",false],["packs","卡包",false],["items","道具",true]].map(([id,label,disabled]) => `<button type="button" role="tab" class="inventory-filter-tab ${activeTab === id ? "is-active" : ""}" data-inventory-tab="${id}" aria-selected="${activeTab === id}" ${disabled ? "disabled" : ""}>${label}</button>`).join("")}
      </div>
      <main class="inventory-window-main">
        <div class="inventory-content-layout">
          <div class="inventory-pack-grid" role="list">${visiblePacks.length ? visiblePacks.map((pack) => {
            const packMeta = PACK_META[pack.type] ?? { className:"is-common" };
            return `<button type="button" role="listitem" class="inventory-pack-card ${packMeta.className} ${pack.type === selectedPackType ? "is-selected" : ""}" data-select-pack="${escapeHtml(pack.type)}" aria-label="选择${escapeHtml(pack.name)}，拥有${Number(pack.count)}个">
              <span class="inventory-pack-slot"><span class="inventory-pack-art" aria-hidden="true">${PACK_ARTWORK_BY_TYPE[pack.type] ? `<img src="${PACK_ARTWORK_BY_TYPE[pack.type]}" alt="">` : ""}</span><strong class="inventory-pack-count">×${Number(pack.count)}</strong></span>
              <span class="inventory-pack-name">${escapeHtml(pack.name)}</span>
            </button>`;
          }).join("") : `<div class="inventory-empty-state">背包为空</div>`}</div>
          <aside class="inventory-showcase ${meta?.className ?? "is-common"}" data-inventory-showcase aria-live="polite">${selected ? `<div class="inventory-showcase-art"><img src="${PACK_ARTWORK_BY_TYPE[selected.type] ?? ""}" alt=""></div><div class="inventory-showcase-heading"><h3 data-inventory-detail-name>${escapeHtml(selected.name)}</h3><span class="inventory-showcase-quality">${escapeHtml(meta?.quality ?? "卡包")}</span></div><p class="inventory-showcase-description" data-inventory-detail-description>${escapeHtml(meta?.description ?? "开启后获得一名球员。")}</p><p class="inventory-showcase-owned"><span>拥有数量</span><strong data-inventory-detail-count>×${Number(selected.count)}</strong></p><button type="button" class="inventory-showcase-action" data-open-pack="${escapeHtml(selected.type)}" ${(pending || Number(selected.count) < 1) ? "disabled" : ""}>${Number(selected.count) > 0 ? "开启" : "数量不足"}</button>` : `<p class="inventory-empty-state">请选择一个物品</p>`}</aside>
        </div>
      </main>`;
  }

  function renderOpening(opening, reveal) {
    return `${meteorLayer()}
      <main class="inventory-opening-stage">
        <div class="inventory-choice-grid">${opening.cards.map((card,index) => `
          <article class="inventory-choice-card ${reveal ? "is-revealing" : "is-revealed"}" style="--reveal-index:${index}" data-choice-player="${escapeHtml(card.playerId ?? card.id)}">${playerCardMarkup(card,{interactive:true,variant:"standard",action:"pack-choice",ariaPrefix:"选择"})}</article>`).join("")}</div>
      </main>`;
  }

  function renderSelected(player) {
    return `${meteorLayer()}
      <main class="inventory-opening-stage inventory-acquired">
        <div class="inventory-acquired-card">${playerCardMarkup(player,{variant:"standard"})}</div>
      </main>`;
  }

  function render() {
    updateTrigger();
    if (!opened) return;
    const value = inventory();
    const opening = value?.pendingOpening;
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
    const label = smallShelf ? 'aria-labelledby="inventory-window-title"' : `aria-label="${selectedPlayer ? "获得球员" : "球员卡包三选一"}"`;
    windowRoot.innerHTML = `<div class="inventory-window-surface ${surfaceClass}" ${surfaceHook} role="dialog" aria-modal="true" ${label} tabindex="-1">${selectedPlayer ? renderSelected(selectedPlayer) : opening ? renderOpening(opening,reveal) : renderPackShelf(value)}</div>`;
    if (smallShelf) unbindSmallWindow = bindSmallWindow(windowRoot,{onRequestClose:closeWindow});
    windowRoot.dataset.inventoryOpeningId = opening?.id ?? "";
    if (opening) revealedOpeningId = opening.id;
    const title = windowRoot.querySelector("h2");
    if (title) title.id = "inventory-window-title";
  }

  function openWindow() {
    opened = true;
    selectedPlayer = null;
    activateStageWindow(windowRoot);
    render();
  }

  function closeWindow() {
    opened = false;
    selectedPlayer = null;
    windowRoot.hidden = true;
    deactivateStageWindow(windowRoot);
  }

  async function openPack(packType) {
    if (pending) return;
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
    const opening = inventory()?.pendingOpening;
    if (!opening) return;
    pending = true;
    await animateChoice(playerId);
    try {
      const value = await getCampaignRequest()("/api/campaign/inventory/packs/choose", { method:"POST", body:{ openingId:opening.id, playerId } });
      selectedPlayer = value.player;
      pending = false;
      campaignStore.setState(value.state,{source:"pack-choose"});
    } catch (error) {
      showToast(error.message || "球员选择失败");
    } finally {
      if (pending) { pending = false; render(); }
    }
  }

  trigger.addEventListener("click",openWindow);
  windowRoot.addEventListener("click",(event)=>{
    const close = event.target.closest("[data-inventory-close]");
    if (close) return closeWindow();
    const tab = event.target.closest("[data-inventory-tab]");
    if (tab && !tab.disabled) { activeTab = tab.dataset.inventoryTab || "all"; selectedPackType = null; return render(); }
    if (selectedPlayer) {
      if (event.target.closest(".inventory-acquired-card")) return;
      selectedPlayer = null;
      render();
      return;
    }
    const select = event.target.closest("[data-select-pack]");
    if (select) { selectedPackType = select.dataset.selectPack; return render(); }
    const open = event.target.closest("[data-open-pack]");
    if (open) return openPack(open.dataset.openPack);
    const choice = event.target.closest('[data-player-card-action="pack-choice"]');
    if (choice) return choosePlayer(choice.dataset.playerCardId);
  });
  registerStageWindow(windowRoot,{kind:"inventory",onRequestClose:closeWindow,documentRef});
  campaignStore.subscribe(()=>render(),{emitCurrent:true});

  return Object.freeze({ open:openWindow, close:closeWindow, render, updateTrigger });
}
