import { createRequestId } from "../core/request-id.js?v=20260906-release-v01";
import { playerCardMarkup, escapePlayerCardHtml as esc } from "../player-card/player-card.js?v=20260906-card-scroll-v1";
import { playerDetailBodyMarkup } from "../player-card/player-detail-window.js";
import { goldAmountMarkup as gold } from "../ui/currency.js";
import { registerStandardWindow, activateStandardWindow, deactivateStandardWindow } from "../ui/standard-window.js";

import { createMarketState, marketFilters, warehouseCards, marketEntries, marketPageMarkup, marketCardMarkup, selectedMarketCard, canListCard, listingPrice, marketConfirmationMarkup } from "./card-market-view.js?v=20260906-card-scroll-v1";

import { createTradeUpState, tradeUpFilters, tradeUpCards, tradeUpBlocked, tradeUpEntries, tradeUpCardMarkup, tradeUpPageMarkup, validateTradeUpQuote, tradeUpConfirmationMarkup, tradeUpCandidateMarkup, tradeUpResultMarkup, tradeUpHistory, tradeUpHistoryMarkup, tradeUpHistoryDetailMarkup } from "./card-trade-up-view.js?v=20260906-card-scroll-v1";
import { playTradeUpReveal } from "./card-trade-up-animation.js?v=20260906-trade-up-v2";

const cardMarkup = (card, deferred = false) => playerCardMarkup(card, { variant: "standard", animated: false, deferred });
const defaultFilters = () => ({ search: "", grade: "all", position: "all", nationality: "all", squad: "all", upgradeLevel: "all", usable: false });
const percent = basisPoints => Number((basisPoints / 100).toFixed(2)).toLocaleString("zh-CN") + "%";
const unavailable = card => card.blocked || (card.recycleValue <= 0 ? "暂无回收价格" : "");
export function filterManagedCards(cards, filters = {}) {
  const f = { ...defaultFilters(), ...filters }, text = f.search.trim().toLowerCase();
  return cards.filter(card => (f.grade === "all" || card.grade === f.grade) &&
    (f.position === "all" || card.pool === f.position || card.role === f.position) &&
    (f.nationality === "all" || card.nationality === f.nationality) &&
    (f.squad === "all" || card.squad === f.squad) &&
    (f.upgradeLevel === "all" || Number(card.upgradeLevel) === Number(f.upgradeLevel)) &&
    (!f.usable || !unavailable(card)) &&
    (!text || [card.name, card.sourceName, card.nationality, card.club, card.role].join(" ").toLowerCase().includes(text)))
    .sort((a, b) => ["X", "S", "A", "B", "C"].indexOf(a.grade) - ["X", "S", "A", "B", "C"].indexOf(b.grade) ||
      b.upgradeLevel - a.upgradeLevel || Number(b.effectiveOverall ?? b.overall) - Number(a.effectiveOverall ?? a.overall) || a.id.localeCompare(b.id));
}

export function createCardManagementController({ root, getCampaignState, getCampaignRequest, campaignStore, showToast = () => {}, onOpen = () => {}, onClose = () => {}, onState = () => {} }) {
  let view = null, screen = "home", filters = defaultFilters(), visibleCount = 24, batch = false, selected = new Set();
  let pending = null, version = 0, readVersion = 0, session = 0, activeDialog = null, loadError = "";
  const retries = new Map(), batchSize = 24;
  let tradeUp = createTradeUpState(), tradeUpRevealCleanup = null;
  let scrollResizeObserver = null, market = createMarketState(), listingEditor = null, draggedMarketCard = "", marketDragPreview = null;
  const request = (path, options) => getCampaignRequest()(path, options);
  const owned = () => view?.cards ?? [];
  const selectedCards = () => owned().filter(card => selected.has(card.id));
  const entries = () => filterManagedCards(owned(), filters);
  const currentOperation = operation => operation.session === session && operation.opened === version && !root.hidden;

  function closeDialog({ redraw = true } = {}) {
    tradeUpRevealCleanup?.(); tradeUpRevealCleanup = null;
    activeDialog?.close?.(); activeDialog?.remove(); activeDialog = null; listingEditor = null;
    if (redraw && !root.hidden) render();
  }
  function close() {
    version++; readVersion++; scrollResizeObserver?.disconnect(); clearMarketDrag();
    if (pending?.kind === "preview") pending = null;
    root.hidden = true; closeDialog({ redraw: false });
    deactivateStandardWindow(root); onClose();
  }
  function open() {
    if (!getCampaignState()?.setupComplete) return showToast("请先完成初始建队");
    onOpen(); version++; view = null; selected.clear(); visibleCount = batchSize; batch = false; screen = "home"; filters = defaultFilters(); market = createMarketState(); tradeUp = createTradeUpState(); loadError = "";
    activateStandardWindow(root); render();
    if (!pending) load();
  }
  async function load() {
    const current = ++readVersion, opened = version, accountSession = session;
    loadError = "";
    try {
      const next = await request("/api/campaign/cards");
      if (current !== readVersion || opened !== version || accountSession !== session || root.hidden) return;
      view = next;
      reconcileMarketSelection();
      reconcileRecycleSelection(); reconcileTradeUpSelection();
      render();
    } catch (error) {
      if (current !== readVersion || opened !== version || accountSession !== session || root.hidden) return;
      loadError = error.message; showToast(error.message); render();
    }
  }
  function selectFilter(key, label, options) {
    return '<select data-cm-filter="' + key + '" aria-label="' + label + '">' +
      options.map(([value, name]) => '<option value="' + esc(value) + '"' + (String(filters[key]) === String(value) ? " selected" : "") + ">" + esc(name) + "</option>").join("") + "</select>";
  }
  function filterMarkup() {
    const countries = [...new Set(owned().map(card => card.nationality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    return '<div class="cm-filters"><div class="cm-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input data-cm-filter="search" type="search" aria-label="搜索球员" placeholder="搜索球员" value="' + esc(filters.search) + '"></div>' +
      selectFilter("grade", "评级", [["all", "评级"], ...["S", "A", "B", "C", "X"].map(value => [value, value])]) +
      selectFilter("position", "位置", [["all", "位置"], ["GK", "门将"], ["DEF", "后卫"], ["MID", "中场"], ["ATT", "前锋"]]) +
      selectFilter("nationality", "国家", [["all", "国家"], ...countries.map(value => [value, value])]) +
      selectFilter("squad", "编队", [["all", "编队"], ["expedition", "远征"], ["garrison", "留守"]]) +
      selectFilter("upgradeLevel", "强化等级", [["all", "强化"], ...Array.from({ length: 9 }, (_, level) => [level, "+" + level])]) +
      '<label class="cm-usable"><input type="checkbox" data-cm-filter="usable"' + (filters.usable ? " checked" : "") + '>仅可回收</label><button type="button" data-cm-action="reset-filters">重置</button><button type="button" class="cm-refresh" data-cm-action="refresh" aria-label="刷新" title="刷新"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.4 7a8 8 0 0 1 13.2-1L20 8M4 16l1.4 2A8 8 0 0 0 18.6 17"/></svg></button></div>';
  }
  function homeMarkup() {
    const options = [
      { kind: "recycle", name: "回收", action: "进入回收" },
      { kind: "sell", name: "出售", action: "进入市场" },
      { kind: "trade-up", name: "汰换", action: "进入汰换" },
    ];
    const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
    const lock = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="10" rx="2"/><path d="M9 10V7a3 3 0 0 1 6 0v3m-3 4v2"/></svg>';
    return '<div class="cm-menu-layout"><div class="cm-menu" aria-label="球员卡管理功能">' + options.map(option =>
      '<button type="button" class="cm-menu-option" data-cm-kind="' + option.kind + '"' + (option.action ? ' data-cm-screen="' + option.kind + '"' : ' disabled') + '>' +
      '<span class="cm-option-art" aria-hidden="true"><img src="./assets/ui/card-management/' + option.kind + '.svg?v=20260906-menu-v3" alt="" width="320" height="190" draggable="false"></span>' +
      '<strong class="cm-option-title">' + option.name + '</strong>' +
      '<span class="cm-option-footer"><b>' + (option.action ?? "待开放") + '</b>' + (option.action ? arrow : lock) + '</span></button>'
    ).join("") + '</div></div>';
  }
  function commonRestriction() {
    const cards = owned(), reason = cards.length ? unavailable(cards[0]) : "";
    return reason && cards.every(card => unavailable(card) === reason) ? reason : "";
  }
  function shortRestriction(reason) {
    if (reason.includes("比赛")) return "比赛中";
    if (reason.includes("训练")) return "训练中";
    if (reason.includes("锁定")) return "已锁定";
    if (reason.includes("特性")) return "待选特性";
    if (reason.includes("价格")) return "暂无价格";
    return "不可回收";
  }
  function restrictionMarkup() {
    const reason = commonRestriction();
    if (!reason) return "";
    const label = reason.includes("比赛") ? "比赛进行中，暂不可回收" : reason.includes("训练") ? "球员训练中，暂不可回收" : reason.includes("锁定") ? "球员卡已锁定" : shortRestriction(reason);
    return '<div class="cm-availability" role="status" title="' + esc(reason) + '">' + esc(label) + '</div>';
  }
  function managedCardMarkup(card, common = commonRestriction()) {
    const reason = unavailable(card), checked = selected.has(card.id);
    return '<article class="cm-card' + (checked ? " is-selected" : "") + (batch && reason ? " is-unavailable" : "") + '"><button class="cm-card-art" type="button" data-cm-card="' + esc(card.id) +
      '" aria-label="' + esc((batch ? (checked ? "取消选择" : "选择") : "查看") + card.name + " +" + card.upgradeLevel + (reason ? "，" + reason : "")) + '"' +
      (batch ? ' aria-pressed="' + checked + '"' + (reason ? " disabled" : "") : ' aria-haspopup="dialog"') + ">" + cardMarkup(card, true) +
      (batch ? '<span class="cm-selection-mark" aria-hidden="true">' + (checked ? "✓" : "") + "</span>" : "") +
      '</button><div class="cm-card-meta"><strong title="回收收益">' + gold(card.recycleValue) + "</strong>" +
      (reason && reason !== common ? '<span class="cm-card-status" title="' + esc(reason) + '" aria-label="' + esc(reason) + '">' + esc(shortRestriction(reason)) + "</span>" : "") + "</div></article>";
  }
  function content() {
    if (screen === "home") return homeMarkup();
    if (screen === "trade-up") return tradeUpPageMarkup(view, tradeUp, { loadError });
    if (screen === "sell") return marketPageMarkup(view, market, { wallet: getCampaignState()?.wallet?.gold ?? 0, loadError });
    if (loadError) return '<p class="cm-empty">' + esc(loadError) + '</p><button type="button" data-cm-action="refresh">重新加载</button>';
    if (!view) return '<p class="cm-empty">正在读取球员卡…</p>';
    const items = entries(), common = commonRestriction();
    return items.length ? '<div class="cm-card-grid" data-cm-grid>' + items.slice(0, visibleCount).map(card => managedCardMarkup(card, common)).join("") +
      '</div>' : '<p class="cm-empty">没有符合条件的球员卡' + (selected.size ? "，已选 " + selected.size + " 张仍保留" : "") + "</p>";
  }
  function actionsMarkup() {
    if (screen === "sell" || screen === "trade-up") return '<button type="button" class="cm-refresh" data-cm-action="refresh" aria-label="刷新球员卡" title="刷新"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.4 7a8 8 0 0 1 13.2-1L20 8M4 16l1.4 2A8 8 0 0 0 18.6 17"/></svg></button>';
    if (screen !== "recycle") return "";
    const items = entries(), amount = selectedCards().reduce((sum, card) => sum + card.recycleValue, 0);
    const hidden = selectedCards().filter(card => !items.some(item => item.id === card.id)).length;
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="12" height="15" rx="2"/><path d="M16 21H6a2 2 0 0 1-2-2V7m7 4 2 2 4-4"/></svg>';
    return '<div class="cm-actions">' + (batch ? '<span class="cm-selection-total" role="status">已选 ' + selected.size + " 张" + (hidden ? "（筛选外 " + hidden + " 张）" : "") + " · " + gold(amount) +
      '</span><button type="button" data-cm-action="cancel-batch">取消</button><button type="button" data-cm-action="clear"' + (!selected.size ? " disabled" : "") +
      '>清空</button><button type="button" class="cm-primary" data-cm-action="recycle"' + (!selected.size || !view?.config.recycleEnabled ? " disabled" : "") + '>确定</button>' :
      '<button type="button" class="cm-primary cm-batch-start" data-cm-action="start-batch"' + (!view?.config.recycleEnabled ? " disabled" : "") + ">" + icon +
      (view && !view.config.recycleEnabled ? "回收暂未开放" : "批量回收") + "</button>") + "</div>";
  }
  function loadMore(container) {
    if (root.hidden || screen !== "recycle" || !view || loadError || pending || activeDialog ||
        container !== root.querySelector("[data-cm-content]") || !container.clientHeight ||
        container.scrollHeight - container.scrollTop - container.clientHeight > 320) return;
    const items = entries(), grid = root.querySelector("[data-cm-grid]");
    if (!grid || visibleCount >= items.length) return;
    const next = items.slice(visibleCount, visibleCount + batchSize), common = commonRestriction();
    grid.insertAdjacentHTML("beforeend", next.map(card => managedCardMarkup(card, common)).join(""));
    visibleCount += next.length;
    // Tall windows can need more than one initial batch before there is enough to scroll.
    queueMicrotask(() => loadMore(container));
  }
  function bindScroll(container) {
    scrollResizeObserver?.disconnect(); scrollResizeObserver = null;
    if (screen !== "recycle") return;
    container.addEventListener("scroll", () => loadMore(container), { passive: true });
    const Observer = root.ownerDocument.defaultView?.ResizeObserver;
    if (Observer) { scrollResizeObserver = new Observer(() => loadMore(container)); scrollResizeObserver.observe(container); }
    queueMicrotask(() => loadMore(container));
  }
  function render({ resetScroll = false, resetPane = "" } = {}) {
    if (root.hidden || activeDialog?.isConnected) return;
    clearMarketDrag();
    const focused = root.ownerDocument.activeElement, focusKey = focused?.dataset?.cmFilter, caret = focused?.selectionStart;
    const scroll = resetScroll ? 0 : root.querySelector("[data-cm-content]")?.scrollTop ?? 0;
    const paneScroll = Object.fromEntries(["market", "warehouse"].map(pane => [pane, resetPane === pane ? 0 : root.querySelector('[data-cmm-scroll="' + pane + '"]')?.scrollTop ?? 0]));
    const marketFocus = focused?.dataset?.cmmFilter, marketPane = focused?.dataset?.cmmPane;
    const tradeFocus = focused?.dataset?.cmuFilter;
    const tradeScroll = resetPane === "trade-up" ? 0 : root.querySelector("[data-cmu-scroll]")?.scrollTop ?? 0;
    const contractScroll = root.querySelector("[data-cmu-contract-scroll]")?.scrollTop ?? 0;
    const historyList = root.querySelector("[data-cmu-history-scroll]");
    const historyScroll = historyList?.scrollTop ?? 0, historyLatest = historyList?.dataset.cmuHistoryLatest;
    root.innerHTML = '<div class="cm-surface standard-window__surface' + (screen === "home" ? ' is-menu' : screen === "sell" ? ' is-market' : screen === "trade-up" ? ' is-trade-up' : '') + '" role="dialog" aria-modal="true" aria-labelledby="cm-title"><header class="cm-header">' +
      (screen !== "home" ? '<button type="button" class="cm-back" data-cm-screen="home">返回</button>' : "") +
      '<div class="cm-heading"><h2 id="cm-title">' + (screen === "home" ? "球员卡管理" : screen === "sell" ? "出售" : screen === "trade-up" ? "汰换" : "回收") + '</h2></div><span class="cm-wallet">' +
      gold(getCampaignState()?.wallet?.gold ?? 0) + '</span>' + actionsMarkup() + '<button type="button" class="cm-close" data-stage-window-close aria-label="关闭球员卡管理">×</button></header>' +
      (screen === "recycle" ? filterMarkup() + restrictionMarkup() : "") + '<div class="cm-content" data-cm-content>' + content() + "</div></div>";
    if (pending) root.querySelectorAll("button:not([data-stage-window-close]),input,select").forEach(node => { node.disabled = true; });
    const container = root.querySelector("[data-cm-content]"); container.scrollTop = scroll; bindScroll(container);
    if (screen === "sell") bindMarketScroll(paneScroll);
    if (screen === "trade-up") {
      bindTradeUpScroll(tradeScroll);
      root.querySelector("[data-cmu-contract-scroll]").scrollTop = contractScroll;
      const history = root.querySelector("[data-cmu-history-scroll]");
      if (history && history.dataset.cmuHistoryLatest === historyLatest) history.scrollTop = historyScroll;
    }
    if (tradeFocus) {
      const node = root.querySelector('[data-cmu-filter="' + tradeFocus + '"]'); node?.focus();
      if (tradeFocus === "search" && caret != null) node?.setSelectionRange?.(caret, caret);
    }
    if (marketFocus) {
      const selector = '[data-cmm-pane="' + marketPane + '"][data-cmm-filter="' + marketFocus + '"]';
      const node = root.querySelector(selector); node?.focus();
      if (marketFocus === "search" && caret != null) node?.setSelectionRange?.(caret, caret);
    }
    if (focusKey) {
      const node = root.querySelector('[data-cm-filter="' + focusKey + '"]'); node?.focus();
      if (focusKey === "search" && caret != null) node?.setSelectionRange?.(caret, caret);
    }
  }
  function dialog(title, body, buttonText, callback) {
    closeDialog({ redraw: false });
    const node = root.ownerDocument.createElement("dialog"); node.className = "cm-dialog" + (screen === "sell" && buttonText ? " cmm-dialog" : screen === "trade-up" ? " cmu-dialog" : "");
    node.setAttribute("aria-labelledby", "cm-dialog-title");
    node.innerHTML = '<header><h3 id="cm-dialog-title">' + esc(title) + '</h3><button type="button" data-cm-dialog-close aria-label="关闭">×</button></header><div class="cm-dialog-body">' +
      body + '</div><p class="cm-dialog-error" data-cm-dialog-error role="alert"></p><footer><button type="button" data-cm-dialog-close>返回</button>' +
      (buttonText ? '<button type="button" class="cm-primary" data-cm-confirm>' + esc(buttonText) + "</button>" : "") + "</footer>";
    root.append(node); activeDialog = node;
    node.querySelectorAll("[data-cm-dialog-close]").forEach(button => button.onclick = () => { if (!pending) closeDialog(); });
    node.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); if (pending) event.preventDefault(); } });
    node.addEventListener("cancel", event => { event.preventDefault(); if (!pending) closeDialog(); });
    node.querySelector("[data-cm-confirm]")?.addEventListener("click", () => callback(node));
    node.showModal();
    return node;
  }
  function confirmationMarkup(value) {
    const quote = value.recycle;
    if (!quote?.lines || !Number.isFinite(quote.ratioBps)) throw Error("回收报价信息不完整，请重启服务后刷新页面");
    const lines = new Map(quote.lines.map(line => [line.cardId, line]));
    const summary = '<div class="cm-quote-summary"><div><span>已选球员卡</span><strong>' + value.cards.length +
      ' 张</strong></div><div><span>基础回收比例</span><strong>' + percent(quote.ratioBps) +
      '</strong></div><div><span>预计总收益</span><strong>' + gold(value.amount) + '</strong></div></div><p class="cm-note">回收收益＝评级估值 × ' +
      percent(quote.ratioBps) + " ×（1＋强化等级 × " + percent(quote.upgradeBonusBps) + "），每张向下取整。训练成长不加价。</p>";
    const previewCards = '<div class="cm-preview-cards">' + value.cards.map(card => {
      const line = lines.get(card.id);
      if (!line) throw Error("部分球员卡缺少回收报价，请重新确认");
      const effectiveRatio = quote.ratioBps * (1 + Number(card.upgradeLevel) * quote.upgradeBonusBps / 10000);
      return '<article class="cm-preview-card">' + cardMarkup(card, true) + '<strong>' + esc(card.name) + " +" + card.upgradeLevel + '</strong><span>评级估值 ' +
        gold(line.valuation) + '</span><span>强化后回收比例 ' + percent(effectiveRatio) + '</span><strong>收益 ' + gold(line.amount) + "</strong></article>";
    }).join("") + "</div>";
    const warning = value.lineupAffected?.length ? '<p class="cm-warning">包含首发球员。回收后仅在原编队补位，替补不足将保留空位。</p>' : "";
    return summary + previewCards + warning + '<p class="cm-warning">确认后，以上球员卡及其强化、训练成长将被消耗，金币立即入账。</p>';
  }
  async function preview() {
    if (pending || !batch || !selected.size || !view?.config.recycleEnabled) return;
    const operation = { kind: "preview", opened: version, session };
    readVersion++; pending = operation; render();
    try {
      const value = await request("/api/campaign/cards/preview", { method: "POST", body: { kind: "recycle", cardIds: [...selected] } });
      if (!currentOperation(operation)) return;
      const body = confirmationMarkup(value);
      pending = null; render();
      dialog("回收确认", body, "确认回收", () => mutate({ cardIds: value.cardIds, quote: value.quote }));
    } catch (error) { if (currentOperation(operation)) showToast(error.message); }
    finally { if (pending === operation) pending = null; if (currentOperation(operation)) render(); }
  }
  async function mutate(body, kind = "recycle") {
    if (pending) return;
    const operation = { kind, opened: version, session };
    const tradeMaterials = kind === "trade-up" ? tradeUpCards(view, tradeUp) : [];
    const retryKey = JSON.stringify([session, getCampaignState()?.playerId, kind, body]);
    if (!retries.has(retryKey)) retries.set(retryKey, createRequestId());
    readVersion++; pending = operation;
    activeDialog?.querySelectorAll("button,input").forEach(node => { node.disabled = true; });
    const errorNode = activeDialog?.querySelector("[data-cm-dialog-error]"); if (errorNode) errorNode.textContent = "";
    try {
      const response = await request("/api/campaign/cards/" + kind, { method: "POST", body: { ...body, ...(kind === "trade-up" ? {resultOnly:true} : {}), requestId: retries.get(retryKey) } });
      if (operation.session !== session) return;
      retries.delete(retryKey);
      if (kind === "trade-up" && !response.state) {
        if (!currentOperation(operation)) { load(); return; }
        tradeUp.selected = []; tradeUp.count = batchSize; tradeUp.error = "";
        view = null; loadError = ""; pending = null;
        closeDialog({ redraw: false });
        const node = dialog("汰换完成", tradeUpResultMarkup(response.result.card, { materials: response.result.cards ?? tradeMaterials }));
        tradeUpRevealCleanup = playTradeUpReveal(node, () => showToast("汰换成功，获得 " + response.result.card.name));
        // Keep the committed result visible even if refreshing ancillary state fails.
        try {
          const [cards, snapshot] = await Promise.all([request("/api/campaign/cards"), request("/api/campaign/state")]);
          if (operation.session !== session) return;
          await new Promise(resolve => setTimeout(resolve, 0));
          campaignStore.setState(snapshot.state, { source: "card-management" }); onState(snapshot.state);
          if (currentOperation(operation)) { view = cards; loadError = ""; reconcileMarketSelection(); reconcileRecycleSelection(); reconcileTradeUpSelection(); }
        } catch (error) { if (operation.session === session) { loadError = "汰换已完成，列表同步失败，请刷新"; showToast(loadError); } }
        return;
      }
      campaignStore.setState(response.state, { source: "card-management" }); onState(response.state);
      if (!currentOperation(operation)) return;
      if (kind === "recycle") { selected.clear(); batch = false; }
      if (kind === "list") { market.selectedId = ""; market.price = ""; }
      if (kind === "trade-up") { tradeUp.selected = []; tradeUp.count = batchSize; tradeUp.error = ""; }
      view = response.view; loadError = ""; reconcileMarketSelection(); reconcileRecycleSelection(); reconcileTradeUpSelection();
      closeDialog({ redraw: false });
      if (kind === "trade-up") {
        const node = dialog("汰换完成", tradeUpResultMarkup(response.result.card, { materials: response.result.cards ?? tradeMaterials }));
        tradeUpRevealCleanup = playTradeUpReveal(node, () => showToast("汰换成功，获得 " + response.result.card.name));
      }
      if (kind !== "trade-up") showToast(kind === "recycle" ? "回收成功，获得 " + Number(response.result.amount).toLocaleString("zh-CN") + " 金币" : kind === "list" ? "挂牌成功" : kind === "buy" ? "购买成功，球员卡已加入留守编队" : "已撤回挂牌，球员卡已返回" + (response.result.squad === "expedition" ? "远征" : response.result.squad === "garrison" ? "留守" : "原") + "编队");
    } catch (error) {
      if (currentOperation(operation)) {
        showToast(error.message);
        if (errorNode) errorNode.textContent = error.message;
      }
    } finally {
      if (pending === operation) pending = null;
      if (operation.session === session && !root.hidden) {
        if (activeDialog) { activeDialog.querySelectorAll("button,input").forEach(node => { node.disabled = false; }); syncListingInput(); }
        else render();
        if (operation.opened !== version) load();
      }
    }
  }
  function reconcileRecycleSelection() {
    const before = selected.size;
    selected = new Set([...selected].filter(id => owned().some(card => card.id === id && !unavailable(card))));
    if (selected.size < before) showToast("部分已选卡已不可回收，已移出选择；其他选择已保留");
  }
  function reconcileMarketSelection() {
    if (market.selectedId && !selectedMarketCard(view, market)) {
      market.selectedId = ""; market.price = "";
      showToast("已选球员卡不再可挂牌，请重新选择");
    }
  }
  function loadMarketMore(container, pane) {
    if (root.hidden || screen !== "sell" || !view || loadError || pending || activeDialog ||
        container !== root.querySelector('[data-cmm-scroll="' + pane + '"]') || !container.clientHeight ||
        container.scrollHeight - container.scrollTop - container.clientHeight > 320) return;
    const items = marketEntries(view, market, pane), grid = root.querySelector('[data-cmm-grid="' + pane + '"]');
    if (!grid || market.counts[pane] >= items.length) return;
    const next = items.slice(market.counts[pane], market.counts[pane] + batchSize);
    grid.insertAdjacentHTML("beforeend", next.map(item => marketCardMarkup(item, pane, view, market, getCampaignState()?.wallet?.gold ?? 0)).join(""));
    market.counts[pane] += next.length;
    queueMicrotask(() => loadMarketMore(container, pane));
  }
  function bindMarketScroll(scrolls) {
    const Observer = root.ownerDocument.defaultView?.ResizeObserver;
    const containers = ["market", "warehouse"].map(pane => [pane, root.querySelector('[data-cmm-scroll="' + pane + '"]')]);
    if (Observer) scrollResizeObserver = new Observer(() => containers.forEach(([pane, container]) => loadMarketMore(container, pane)));
    for (const [pane, container] of containers) {
      container.scrollTop = scrolls[pane];
      container.addEventListener("scroll", () => loadMarketMore(container, pane), { passive: true });
      scrollResizeObserver?.observe(container);
      queueMicrotask(() => loadMarketMore(container, pane));
    }
  }
  function marketFilterChanged(event) {
    const node = event.target;
    if (Object.hasOwn(node.dataset, "cmmPrice")) {
      if (event.type !== "input" || !listingEditor || node !== activeDialog?.querySelector("[data-cmm-price]")) return;
      market.price = node.value; listingEditor.submission = null; syncListingInput({ showError: true });
      return;
    }
    const pane = node.dataset.cmmPane, key = node.dataset.cmmFilter;
    if (!["market", "warehouse"].includes(pane) || !Object.hasOwn(market[pane], key)) return;
    if ((event.type === "input") !== (key === "search")) return;
    market[pane][key] = key === "usable" ? node.checked : node.value;
    market.counts[pane] = batchSize; render({ resetPane: pane });
  }
  function marketClick(data) {
    if (["all", "mine"].includes(data.cmmScope)) {
      market.market.scope = data.cmmScope; market.counts.market = batchSize; render({ resetPane: "market" }); return true;
    }
    if (["market", "warehouse"].includes(data.cmmReset)) {
      const pane = data.cmmReset, scope = market[pane].scope;
      market[pane] = { ...marketFilters(), scope }; market.counts[pane] = batchSize; render({ resetPane: pane }); return true;
    }
    if (data.cmmSelect) { selectMarketCard(data.cmmSelect); return true; }
    if (data.cmmDetail) {
      const card = data.cmmPane === "market" ? view?.listings.find(item => item.id === data.cmmDetail)?.card : warehouseCards(view).find(card => card.id === data.cmmDetail);
      if (card) dialog(card.name, playerDetailBodyMarkup(card, { showCardStatus: true }));
      return true;
    }
    if (Object.hasOwn(data, "cmmList")) { openListingEditor(market.selectedId); return true; }
    if (data.cmmBuy || data.cmmCancel) {
      const listing = view?.listings.find(item => item.id === (data.cmmBuy || data.cmmCancel) && item.status === "active");
      if (!listing) { showToast("该挂牌已变化，请刷新市场"); return true; }
      const kind = data.cmmBuy ? "buy" : "cancel";
      if (kind === "buy" && listing.mine || kind === "cancel" && !listing.mine) return true;
      if (kind === "buy" && Number(getCampaignState()?.wallet?.gold ?? 0) < listing.price) { showToast("金币不足"); return true; }
      const body = kind === "buy" ? { listingId: listing.id, expectedPrice: listing.price } : { listingId: listing.id };
      dialog(kind === "buy" ? "购买确认" : "撤回挂牌", marketConfirmationMarkup(kind, listing), kind === "buy" ? "确认购买" : "确认撤回", () => mutate(body, kind));
      return true;
    }
    return false;
  }
  function reconcileTradeUpSelection() {
    const before = tradeUp.selected.length, remaining = [];
    for (const card of tradeUpCards(view, tradeUp)) if (!tradeUpBlocked(card, remaining)) remaining.push(card);
    tradeUp.selected = remaining.map(card => card.id);
    if (remaining.length < before) { tradeUp.error = "部分素材已不可汰换，已移出合同"; showToast(tradeUp.error); }
  }
  function tradeUpClick(data) {
    if (data.cmuAction === "history") {
      if (tradeUpHistory(view).length) dialog("汰换记录", tradeUpHistoryMarkup(view, { expanded: true }));
      return true;
    }
    if (data.cmuHistory) {
      const entry = tradeUpHistory(view).find(entry => entry.id === data.cmuHistory);
      if (entry) dialog("汰换记录", tradeUpHistoryDetailMarkup(entry));
      return true;
    }
    if (data.cmuAction === "requote") { closeDialog(); previewTradeUp(); return true; }
    if (activeDialog) return false;
    if (data.cmuDetail) {
      const card = warehouseCards(view).find(card => card.id === data.cmuDetail);
      if (card) dialog(card.name, playerDetailBodyMarkup(card, { showCardStatus: true }));
      return true;
    }
    if (data.cmuSelect || data.cmuRemove) {
      const id = data.cmuSelect || data.cmuRemove;
      if (tradeUp.selected.includes(id)) tradeUp.selected = tradeUp.selected.filter(value => value !== id);
      else if (data.cmuSelect) {
        const card = warehouseCards(view).find(card => card.id === id), reason = tradeUpBlocked(card, tradeUpCards(view, tradeUp));
        if (reason) { showToast(reason); return true; }
        tradeUp.selected.push(id);
      }
      tradeUp.error = ""; render(); return true;
    }
    if (data.cmuAction === "clear") { tradeUp.selected = []; tradeUp.error = ""; render(); return true; }
    if (data.cmuAction === "reset") { tradeUp.filters = tradeUpFilters(); tradeUp.count = batchSize; render({ resetPane: "trade-up" }); return true; }
    if (data.cmuAction === "preview") { previewTradeUp(); return true; }
    return false;
  }
  function tradeUpFilterChanged(event) {
    if (activeDialog) return;
    const node = event.target, key = node.dataset.cmuFilter;
    if (!Object.hasOwn(tradeUp.filters, key) || (event.type === "input") !== (key === "search")) return;
    tradeUp.filters[key] = key === "usable" ? node.checked : node.value;
    tradeUp.count = batchSize; render({ resetPane: "trade-up" });
  }
  function loadTradeUpMore(container) {
    if (root.hidden || screen !== "trade-up" || pending || activeDialog || !view || loadError ||
        container !== root.querySelector("[data-cmu-scroll]") || !container.clientHeight ||
        container.scrollHeight - container.scrollTop - container.clientHeight > 320) return;
    const items = tradeUpEntries(view, tradeUp), grid = root.querySelector("[data-cmu-grid]");
    if (!grid || tradeUp.count >= items.length) return;
    const next = items.slice(tradeUp.count, tradeUp.count + batchSize);
    grid.insertAdjacentHTML("beforeend", next.map(card => tradeUpCardMarkup(card, view, tradeUp)).join(""));
    tradeUp.count += next.length; queueMicrotask(() => loadTradeUpMore(container));
  }
  function bindTradeUpScroll(scrollTop) {
    const container = root.querySelector("[data-cmu-scroll]");
    container.scrollTop = scrollTop;
    container.addEventListener("scroll", () => loadTradeUpMore(container), { passive: true });
    const Observer = root.ownerDocument.defaultView?.ResizeObserver;
    if (Observer) { scrollResizeObserver = new Observer(() => loadTradeUpMore(container)); scrollResizeObserver.observe(container); }
    queueMicrotask(() => loadTradeUpMore(container));
  }
  function bindTradeUpPool(node, candidates) {
    const container = node.querySelector("[data-cmu-pool-scroll]"), grid = node.querySelector("[data-cmu-pool-grid]");
    let count = 24;
    const more = () => {
      if (root.hidden || pending || activeDialog !== node || !node.isConnected || !container.clientHeight ||
          container.scrollHeight - container.scrollTop - container.clientHeight > 240 || count >= candidates.length) return;
      const next = candidates.slice(count, count + batchSize);
      grid.insertAdjacentHTML("beforeend", next.map(tradeUpCandidateMarkup).join(""));
      count += next.length; queueMicrotask(more);
    };
    container.addEventListener("scroll", more, { passive: true }); queueMicrotask(more);
  }
  async function previewTradeUp() {
    if (pending || activeDialog || loadError || tradeUp.selected.length !== 5) return;
    const cards = tradeUpCards(view, tradeUp);
    if (cards.length !== 5 || cards.some(card => tradeUpBlocked(card, cards))) { reconcileTradeUpSelection(); render(); return; }
    const ids = [...tradeUp.selected], operation = { kind: "preview", opened: version, session };
    tradeUp.error = ""; readVersion++; pending = operation; render();
    try {
      const value = await request("/api/campaign/cards/preview", { method: "POST", body: { kind: "trade-up", cardIds: ids } });
      if (!currentOperation(operation)) return;
      validateTradeUpQuote(value, ids, cards[0].grade);
      pending = null; render();
      const node = dialog("汰换确认", tradeUpConfirmationMarkup(value), "确认汰换", () => mutate({ cardIds: value.cardIds, quote: value.quote }, "trade-up"));
      bindTradeUpPool(node, value.candidates);
    } catch (error) { if (currentOperation(operation)) { tradeUp.error = error.message; showToast(error.message); } }
    finally { if (pending === operation) pending = null; if (currentOperation(operation)) render(); }
  }
  function selectMarketCard(id) {
    const card = selectedMarketCard(view, { selectedId: id });
    if (!card || card.blocked) return false;
    if (market.selectedId !== id) { market.selectedId = id; market.price = ""; }
    // Keep the card DOM stable between the two clicks of a native dblclick and throughout a drag.
    root.querySelectorAll("[data-cmm-select]").forEach(button => {
      const checked = button.dataset.cmmSelect === id;
      button.setAttribute("aria-pressed", String(checked));
      button.closest(".cm-card")?.classList.toggle("is-selected", checked);
      const mark = button.querySelector("[data-cmm-selection]"); if (mark) mark.hidden = !checked;
    });
    const submit = root.querySelector("[data-cmm-list]"); if (submit) submit.disabled = !canListCard(view, market);
    return true;
  }
  function moveMarketDrag(event) {
    if (!marketDragPreview || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const { node, offsetX, offsetY } = marketDragPreview;
    node.style.transform = "translate3d(" + (event.clientX - offsetX) + "px," + (event.clientY - offsetY) + "px,0)";
  }
  function startMarketDragPreview(event, target) {
    const document = root.ownerDocument, rect = target.getBoundingClientRect();
    const node = document.createElement("div"), nativeImage = document.createElement("canvas");
    node.className = "cmm-drag-preview";
    node.setAttribute("aria-hidden", "true");
    node.style.width = rect.width + "px";
    node.innerHTML = cardMarkup(selectedMarketCard(view, market));
    // A transparent native bitmap avoids Chromium capturing neighboring composited shield layers.
    // The visible preview is a separate, single shield rendered normally, with no selection UI.
    nativeImage.width = 1; nativeImage.height = 1;
    nativeImage.className = "cmm-native-drag-image";
    nativeImage.setAttribute("aria-hidden", "true");
    document.body.append(node); document.body.append(nativeImage);
    marketDragPreview = { node, nativeImage,
      offsetX: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      offsetY: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
    moveMarketDrag(event);
    event.dataTransfer.setDragImage(nativeImage, 0, 0);
  }
  function clearMarketDrag() {
    marketDragPreview?.node.remove(); marketDragPreview?.nativeImage.remove(); marketDragPreview = null;
    draggedMarketCard = "";
    root.querySelector("[data-cmm-dropzone]")?.classList.remove("is-drag-over");
    root.querySelectorAll(".is-dragging").forEach(node => node.classList.remove("is-dragging"));
  }
  function validListingQuote(value, cardId, expectedPrice) {
    if (!["expedition", "garrison"].includes(value.sourceSquad) || !Number.isSafeInteger(value.minimumPrice) || value.minimumPrice < 1 ||
        typeof value.listingTerms !== "string" || !value.listingTerms) throw Error("挂牌限价信息缺失，请重启服务后刷新页面");
    if (!value.quote || value.cardIds?.length !== 1 || value.cardIds[0] !== cardId || value.cards?.length !== 1 ||
        value.cards[0].id !== cardId || !Number.isSafeInteger(value.amount) || value.amount < value.minimumPrice ||
        (expectedPrice !== undefined && value.amount !== expectedPrice)) throw Error("挂牌报价已变化，请重新确认");
  }
  function syncListingInput({ showError = false } = {}) {
    if (!listingEditor || activeDialog !== listingEditor.node) return;
    const minimum = listingEditor.value.minimumPrice, maximum = view?.maxPrice ?? 1000000000;
    const valid = listingPrice(market.price, maximum, minimum) !== null;
    const input = activeDialog.querySelector("[data-cmm-price]"), confirm = activeDialog.querySelector("[data-cm-confirm]");
    if (input) { input.disabled = !!pending; input.setAttribute("aria-invalid", String(!valid)); }
    if (confirm) confirm.disabled = !!pending || !valid;
    if (showError) {
      const error = activeDialog.querySelector("[data-cm-dialog-error]");
      if (error) error.textContent = valid ? "" : "请输入 " + minimum.toLocaleString("zh-CN") + " 至 " + maximum.toLocaleString("zh-CN") + " 的整数价格";
    }
  }
  function bindListingInput(node) {
    const input = node.querySelector("[data-cmm-price]");
    input.value = market.price;
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submitListing(); }
    });
    input.focus(); input.select?.();
    syncListingInput({ showError: true });
  }
  async function openListingEditor(cardId) {
    if (pending || activeDialog || !selectMarketCard(cardId)) return;
    const operation = { kind: "preview", opened: version, session };
    readVersion++; pending = operation; render();
    try {
      const value = await request("/api/campaign/cards/preview", { method: "POST", body: { kind: "list", cardIds: [cardId] } });
      if (!currentOperation(operation)) return;
      validListingQuote(value, cardId);
      if (!market.price) market.price = String(value.minimumPrice);
      pending = null; render();
      const node = dialog("挂牌确认", marketConfirmationMarkup("list", value, { priceText: market.price }), "确认挂牌", submitListing);
      listingEditor = { node, value, submission: null };
      bindListingInput(node);
    } catch (error) { if (currentOperation(operation)) showToast(error.message); }
    finally { if (pending === operation) pending = null; if (currentOperation(operation)) render(); }
  }
  async function submitListing() {
    const editor = listingEditor;
    if (pending || !editor || activeDialog !== editor.node) return;
    const price = listingPrice(market.price, view?.maxPrice, editor.value.minimumPrice);
    if (price === null) { syncListingInput({ showError: true }); return; }
    // A lost response may already have placed the card in escrow. Retry the original write, not a fresh preview of a missing card.
    if (editor.submission) { await mutate(editor.submission, "list"); return; }
    const operation = { kind: "preview", opened: version, session }, cardId = editor.value.cardIds[0];
    readVersion++; pending = operation;
    activeDialog.querySelectorAll("button,input").forEach(node => { node.disabled = true; });
    const errorNode = activeDialog.querySelector("[data-cm-dialog-error]"); errorNode.textContent = "";
    syncListingInput();
    try {
      const value = await request("/api/campaign/cards/preview", { method: "POST", body: { kind: "list", cardIds: [cardId], price } });
      if (!currentOperation(operation) || listingEditor !== editor) return;
      validListingQuote(value, cardId, price);
      if (value.listingTerms !== editor.value.listingTerms) {
        editor.value = value; pending = null;
        editor.node.querySelector(".cm-dialog-body").innerHTML = marketConfirmationMarkup("list", value, { priceText: market.price });
        bindListingInput(editor.node);
        errorNode.textContent = "球员卡、编队或最低限价已变化，请核对后再次确认";
        return;
      }
      editor.submission = { cardIds: value.cardIds, price: value.amount, quote: value.quote };
      pending = null;
      await mutate(editor.submission, "list");
    } catch (error) {
      if (currentOperation(operation) && listingEditor === editor) { errorNode.textContent = error.message; showToast(error.message); }
    } finally {
      if (pending === operation) pending = null;
      if (currentOperation(operation) && listingEditor === editor && !pending) {
        activeDialog.querySelectorAll("button,input").forEach(node => { node.disabled = false; });
        syncListingInput();
      }
    }
  }
  root.addEventListener("dblclick", event => {
    if (root.hidden || screen !== "sell" || pending || activeDialog) return;
    const target = event.target.closest("[data-cmm-select]");
    if (!target || target.disabled) return;
    event.preventDefault(); event.stopPropagation(); openListingEditor(target.dataset.cmmSelect);
  });
  root.addEventListener("dragstart", event => {
    const target = event.target.closest("[data-cmm-select]");
    if (!target) return;
    if (root.hidden || screen !== "sell" || pending || activeDialog || target.disabled || !event.dataTransfer || !selectMarketCard(target.dataset.cmmSelect)) {
      event.preventDefault(); return;
    }
    clearMarketDrag();
    draggedMarketCard = target.dataset.cmmSelect;
    event.dataTransfer.clearData();
    event.dataTransfer.setData("application/x-yellowdogs-player-card", draggedMarketCard);
    event.dataTransfer.effectAllowed = "move";
    target.classList.add("is-dragging");
    startMarketDragPreview(event, target);
  });
  root.addEventListener("dragover", event => {
    const zone = event.target.closest("[data-cmm-dropzone]");
    if (!zone || !draggedMarketCard || root.hidden || screen !== "sell" || pending || activeDialog) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    zone.classList.add("is-drag-over");
  });
  root.addEventListener("dragleave", event => {
    const zone = event.target.closest("[data-cmm-dropzone]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-drag-over");
  });
  root.addEventListener("drop", event => {
    const zone = event.target.closest("[data-cmm-dropzone]");
    if (!zone || !draggedMarketCard || root.hidden || screen !== "sell" || pending || activeDialog) return;
    event.preventDefault(); event.stopPropagation();
    const id = draggedMarketCard, payload = event.dataTransfer?.getData("application/x-yellowdogs-player-card");
    clearMarketDrag();
    if (payload === id) openListingEditor(id);
  });
  root.addEventListener("dragend", clearMarketDrag);
  root.ownerDocument.addEventListener("dragover", moveMarketDrag);

  function toggleCard(id) {
    const card = owned().find(card => card.id === id);
    if (!card || !batch || unavailable(card)) return;
    if (selected.has(id)) selected.delete(id);
    else {
      if (selected.size >= 100) return showToast("单次最多回收 100 张，请先完成本批回收");
      selected.add(id);
    }
    render();
  }
  root.addEventListener("click", event => {
    if (pending || root.hidden) return;
    const target = event.target.closest("button"); if (!target || target.disabled) return;
    if (target.dataset.cmScreen && ["home", "recycle", "sell", "trade-up"].includes(target.dataset.cmScreen)) { screen = target.dataset.cmScreen; render(); return; }
    if (screen === "sell" && marketClick(target.dataset)) return;
    if (screen === "trade-up" && tradeUpClick(target.dataset)) return;
    const action = target.dataset.cmAction;
    if (action === "refresh") load();
    if (action === "reset-filters") { filters = defaultFilters(); visibleCount = batchSize; render({ resetScroll: true }); }
    if (action === "start-batch" && view?.config.recycleEnabled) { batch = true; render(); }
    if (action === "cancel-batch") { batch = false; selected.clear(); render(); }
    if (action === "clear") { selected.clear(); render(); }
    if (action === "recycle") preview();
    if (target.dataset.cmCard) {
      if (batch) toggleCard(target.dataset.cmCard);
      else {
        const card = owned().find(card => card.id === target.dataset.cmCard);
        if (card) dialog(card.name, playerDetailBodyMarkup(card, { showCardStatus: true }));
      }
    }
  });
  function filterChanged(event) {
    if (pending) return;
    if (screen === "sell") { marketFilterChanged(event); return; }
    if (screen === "trade-up") { tradeUpFilterChanged(event); return; }
    if (screen !== "recycle") return;
    const node = event.target, key = node.dataset.cmFilter;
    if (!Object.hasOwn(filters, key)) return;
    const liveInput = key === "search";
    if ((event.type === "input") !== liveInput) return;
    filters[key] = key === "usable" ? node.checked : node.value; visibleCount = batchSize; render({ resetScroll: true });
  }
  root.addEventListener("change", filterChanged);
  root.addEventListener("input", filterChanged);
  campaignStore.subscribe(({ state, previousState }) => {
    if (state?.playerId !== previousState?.playerId) { session++; close(); pending = null; retries.clear(); selected.clear(); view = null; return; }
    if (!root.hidden && !pending && !activeDialog && JSON.stringify([state?.draft?.roster, state?.wallet, state?.tactics, state?.playerSquads]) !== JSON.stringify([previousState?.draft?.roster, previousState?.wallet, previousState?.tactics, previousState?.playerSquads])) load();
  });
  registerStandardWindow(root, { onRequestClose: close });
  return { open, close };
}