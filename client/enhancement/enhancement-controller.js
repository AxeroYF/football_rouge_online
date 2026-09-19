import {researchedEnhancementChance} from '../../shared/config/advanced-research.mjs';
import { createRequestId } from "../core/request-id.js?v=20260906-release-v01";
import { playerCardMarkup, escapePlayerCardHtml as escapeHtml } from "../player-card/player-card.js?v=20260906-card-scroll-v1";
import { duplicateEnhancementCards, enhancementFamily, s4EnhancementChanceForLevels } from "../../shared/config/enhancement.mjs";
import { goldAmountMarkup } from "../ui/currency.js";
import { registerWideWindow, activateWideWindow, deactivateWideWindow } from "../ui/wide-window.js";

export function enhancementCardEntries(cards = []) {
  return duplicateEnhancementCards(cards).map((card) => ({ player: { ...card, id: enhancementFamily(card) }, card: { ...card, id: card.playerId } }));
}
export function createEnhancementController({ root, getCampaignState, getCampaignRequest, campaignStore, onState = () => {}, onOpen = () => {}, onClose = () => {}, showToast = () => {}, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let view = null, league = { enhancement: {}, wallet: { balance: 0 } }, pending = false, version = 0, readVersion = 0;
  let leagueEnhancementMainCardId = null, leagueEnhancementMaterialCardId = null, leagueEnhancementResult = null;
  let leagueEnhancementPhase = "idle", leagueEnhancementUseProtection = false, leagueEnhancementTraitSelectionOpen = false;
  let leagueBackpackSearch = "", leagueBackpackPosition = "ALL", leagueBackpackUpgrade = "ALL", leagueBackpackSort = "upgrade", leagueEnhancementListingFilter = "ALL";
  let draggedCardId = null, refreshAfterDrag = false;
  const retryIds = new Map();
  const comparePlayerGrade = (a,b) => ["X","S","A","B","C"].indexOf(a.player.grade) - ["X","S","A","B","C"].indexOf(b.player.grade);
  const leagueEnhancementCardEntries = () => enhancementCardEntries(view?.cards);
  const leagueEnhancementCardEntry = (id) => {
    const card = view?.cards.find((card) => card.playerId === id);
    return card ? { player: { ...card, id: enhancementFamily(card) }, card: { ...card, id: card.playerId } } : null;
  };
  function s4PlayerCardMarkup(player, { card = player, attributes = "", deferred = false } = {}) {
    return playerCardMarkup({ ...player, ...card, playerId: card.id ?? card.playerId }, { variant: "compact", deferred, animated: !deferred })
      .replace('class="s4-player-card', `class="s4-player-card upgrade-${card.upgradeLevel ?? 0}`)
      .replace(' role="img"', attributes ? ` role="button" tabindex="0" ${attributes}` : ' role="img"')
      .replace(/<\/div>$/, `${card.labels?.length ? `<span class="enhancement-card-badges">${card.labels.map(escapeHtml).join(' · ')}</span>` : ''}</div>`);
  }
  function syncView(next) {
    view = next;
    league = { wallet: { balance: getCampaignState()?.wallet?.gold ?? 0 }, enhancement: { ...next,
      traitOffer: next.traitOffers?.[0] ?? null,
      history: (next.history ?? []).map((r) => ({ ...r, mainPlayer: r.mainCard, materialPlayer: r.materialCard, resultPlayer: r.card, resultCard: r.card })) } };
    for (const [slot, id] of [["main", leagueEnhancementMainCardId], ["material", leagueEnhancementMaterialCardId]]) {
      if (id && !leagueEnhancementCardEntry(id)) { if (slot === "main") leagueEnhancementMainCardId = null; else leagueEnhancementMaterialCardId = null; }
    }
    if (leagueEnhancementResult) {
      const card = leagueEnhancementCardEntry(leagueEnhancementResult.card?.id);
      if (!card) leagueEnhancementResult = null;
      else leagueEnhancementResult = { ...leagueEnhancementResult, ...card, traitOffer: next.traitOffers?.find((offer) => offer.cardId === card.card.id) ?? null };
    }
  }
  function renderLeagueEnhancementInPlace() {
    if (root.hidden) return;
    if (draggedCardId) { refreshAfterDrag = true; return; }
    const area = root.querySelector('[data-enhancement-content]');
    const scroll = area.querySelector('.enhancement-card-grid')?.scrollTop ?? 0;
    const historyList = area.querySelector('[data-enhancement-history-list]');
    const historyScroll = historyList?.scrollTop ?? 0;
    const latestHistoryId = historyList?.dataset.enhancementHistoryLatest;
    area.innerHTML = view ? leagueEnhancementMarkup() : '<p class="enhancement-loading">正在读取球员卡…</p>';
    const grid = area.querySelector('.enhancement-card-grid'); if (grid) grid.scrollTop = scroll;
    const nextHistory = area.querySelector('[data-enhancement-history-list]');
    if (nextHistory && nextHistory.dataset.enhancementHistoryLatest === latestHistoryId) nextHistory.scrollTop = historyScroll;
    if (pending) area.querySelectorAll('button,input,select').forEach((node) => { node.disabled = true; });
  }
  async function load() {
    if (draggedCardId) { refreshAfterDrag = true; return; }
    if (pending) return;
    const current = ++readVersion, opened = version;
    try { const next = await getCampaignRequest()('/api/campaign/enhancement');
      if (current !== readVersion || opened !== version || root.hidden || pending) return;
      if (draggedCardId) { refreshAfterDrag = true; return; }
      syncView(next); renderLeagueEnhancementInPlace();
    } catch (error) { if (current === readVersion && opened === version && !root.hidden) showToast(error.message); }
  }
  function close() {
    version++; readVersion++; root.hidden = true; clearDrag(false);
    root.querySelectorAll('.enhancement-celebration,.enhancement-dialog-overlay').forEach((node) => node.remove());
    deactivateWideWindow(root); onClose();
  }
  function open() {
    if (!getCampaignState()?.setupComplete) return showToast('请先完成初始建队');
    onOpen(); version++; view = null; leagueEnhancementMainCardId = null; leagueEnhancementMaterialCardId = null; leagueEnhancementResult = null; leagueEnhancementPhase = 'idle';
    root.innerHTML = '<div class="enhancement-window-surface"><header class="enhancement-window-header"><h2>强化</h2><button type="button" data-stage-window-close aria-label="关闭强化">×</button></header><div data-enhancement-content></div></div>';
    activateWideWindow(root); renderLeagueEnhancementInPlace(); load();
  }
  function openLeagueDialog(markup, className) {
    root.querySelectorAll('.enhancement-dialog-overlay').forEach((node) => node.remove());
    const overlay = document.createElement('div'); overlay.className = 'enhancement-dialog-overlay';
    overlay.innerHTML = `<section role="dialog" aria-modal="true" class="enhancement-dialog ${className}">${markup}</section>`;
    overlay.addEventListener('click', (event) => { if (!pending && (event.target === overlay || event.target.closest('[data-close-league-dialog]'))) overlay.remove(); });
    root.append(overlay); return overlay;
  }
  function assign(cardId, slot = null) {
    if (pending || !duplicateEnhancementCards(view?.cards).some((card) => card.playerId === cardId)) return;
    const entry = leagueEnhancementCardEntry(cardId); if (!entry) return;
    slot ??= leagueEnhancementMainCardId ? 'material' : 'main';
    const reason = slot === 'main' ? entry.card.mainBlocked : entry.card.materialBlocked;
    if (reason) return showToast(reason);
    const main = leagueEnhancementCardEntry(leagueEnhancementMainCardId);
    if (slot === 'material') {
      if (main?.card.id === cardId) return showToast('主卡和副卡不能是同一张卡');
      if (main && main.player.id !== entry.player.id) return showToast('副卡必须是同名球员卡');
      leagueEnhancementMaterialCardId = cardId;
    } else {
      if (entry.card.upgradeLevel >= 8) return showToast('主卡已经达到最高强化等级');
      leagueEnhancementMainCardId = cardId;
      const material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
      if (material?.card.id === cardId || material?.player.id !== entry.player.id) leagueEnhancementMaterialCardId = null;
    }
    if (leagueEnhancementResult?.card.id === cardId) leagueEnhancementResult = null;
    leagueEnhancementTraitSelectionOpen = false; if (!leagueEnhancementResult) leagueEnhancementPhase = 'idle'; renderLeagueEnhancementInPlace();
  }
  function returnResultToWarehouse(cardId) {
    if (!leagueEnhancementResult?.card || leagueEnhancementResult.card.id !== cardId) return;
    const offer = leagueEnhancementResult.traitOffer ?? view?.traitOffers?.find((entry) => entry.cardId === cardId);
    if (offer) return showToast('请先为这张强化卡绑定特性');
    leagueEnhancementResult = null; leagueEnhancementPhase = 'idle'; renderLeagueEnhancementInPlace();
  }
  async function mutate(action, body, { requestId = true } = {}) {
    // An older inventory GET must never resurrect a consumed material card.
    readVersion++;
    const accountId = getCampaignState()?.playerId;
    const key = JSON.stringify([accountId, action, body]);
    if (requestId && !retryIds.has(key)) retryIds.set(key, createRequestId());
    const response = await getCampaignRequest()(`/api/campaign/enhancement/${action}`, { method: 'POST', body: { ...body, ...(requestId ? { requestId: retryIds.get(key) } : {}) } });
    if (getCampaignState()?.playerId !== accountId) return null;
    retryIds.delete(key); readVersion++;
    campaignStore.setState(response.state, { source: 'enhancement' }); onState(response.state);
    syncView(response.view); return response.result;
  }
  async function perform() {
    if (pending) return;
    const main = leagueEnhancementCardEntry(leagueEnhancementMainCardId), material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
    if (!main || !material) return;
    if (leagueEnhancementResult) return showToast("请先双击结果卡移回仓库，再开始下一次强化");
    if (main.card.upgradeLevel < material.card.upgradeLevel) return showToast('主卡等级不能低于副卡等级，请交换主副卡');
    const opened = version; pending = true; leagueEnhancementPhase = 'scanning'; renderLeagueEnhancementInPlace();
    try {
      const result = await mutate('enhance', { mainCardId: main.card.id, materialCardId: material.card.id, useProtection: leagueEnhancementUseProtection });
      if (!result || opened !== version || root.hidden) return;
      await delay(result.afterLevel < 4 ? 420 : 1440 + Math.min(4, result.afterLevel - 4) * 360);
      if (opened !== version || root.hidden) return;
      leagueEnhancementResult = { ...result, player: result.card, card: { ...result.card, id: result.card.playerId } };
      leagueEnhancementMainCardId = null; leagueEnhancementMaterialCardId = null;
      leagueEnhancementPhase = result.success ? 'success' : 'failure';
      showLeagueEnhancementCelebration(leagueEnhancementResult);
    } catch (error) { if (opened === version) { leagueEnhancementPhase = 'idle'; showToast(error.message); } }
    finally { pending = false; renderLeagueEnhancementInPlace(); }
  }
  async function bindTrait(offerId, traitId) {
    if (pending) return null;
    pending = true;
    try { const card = await mutate('trait', { offerId, traitId }, { requestId: false });
      return card ? { offerId, player: card, card: { ...card, id: card.playerId }, trait: { name: card.traits.at(-1) } } : null;
    } finally { pending = false; }
  }
function leagueEnhancementChance(mainLevel, materialLevel) {
  return researchedEnhancementChance({formationResearch:{topicLevels:league.enhancement?.researchLevels}},mainLevel,materialLevel);
}

function leagueEnhancementSlotMarkup(slot, entry) {
  if (!entry) return `<div class="enhancement-card-slot empty" data-enhancement-drop="${slot}"><b>${slot === "main" ? "主卡" : "副卡"}</b><span>+</span></div>`;
  return `<div class="enhancement-card-slot filled" data-enhancement-drop="${slot}"><b>${slot === "main" ? "主卡" : "副卡"}</b>${s4PlayerCardMarkup(entry.player, { card:entry.card, compact:true, attributes:`draggable="true" data-enhancement-slot-card="${slot}" data-enhancement-card-id="${entry.card.id}" title="点击移回仓库"` })}<small class="enhancement-card-status">${(entry.card.labels ?? []).map(escapeHtml).join(" · ")}</small></div>`;
}

function leagueEnhancementCardListed() { return false; }
function enhancementHistoryResultText(entry) {
  if (entry.batchQuantity) return `批量完成 · ${entry.batchSuccessCount}成功 / ${entry.batchFailureCount}失败`;
  if (entry.success) return `成功 · +${entry.afterLevel}`;
  return entry.afterLevel < entry.beforeLevel ? `失败 · 降至+${entry.afterLevel}` : `失败 · 保持+${entry.afterLevel}`;
}

function leagueEnhancementHistoryMarkup() {
  const history = (league.enhancement?.history ?? []).slice(0, 50);
  const rows = history.map((entry) => {
    const time = new Date(entry.createdAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
    const materialLevel = Number(entry.materialCard?.upgradeLevel ?? 0);
    const protection = `<span class="enhancement-history-protection ${entry.protectionUsed ? "is-protected" : "is-unprotected"}"><small>${entry.protectionUsed ? "已保卡" : "未保卡"}</small><b>${goldAmountMarkup(entry.protectionUsed ? entry.protectionCost ?? 0 : 0)}</b></span>`;
    return `<li class="${entry.success ? "success" : "failure"}"><time>${escapeHtml(time)}</time><div><b>${escapeHtml(entry.mainPlayer.name)} +${entry.beforeLevel}</b><small>副卡 ${escapeHtml(entry.materialPlayer.name)} +${materialLevel}</small></div>${protection}<span class="enhancement-history-chance">${entry.chance}%</span><strong>${escapeHtml(enhancementHistoryResultText(entry))}</strong></li>`;
  }).join("");
  return `<section class="enhancement-mini-ranking enhancement-history-mini"><header><div><h3>强化记录</h3></div><button type="button" data-enhancement-history-open ${history.length ? "" : "disabled"}>放大查看</button></header><ol data-enhancement-history-list data-enhancement-history-latest="${escapeHtml(history[0]?.id ?? "")}" tabindex="0" aria-label="最近50条强化记录">${rows || '<li class="empty">暂无强化记录</li>'}</ol></section>`;
}

function openLeagueEnhancementHistory() {
  const history = (league.enhancement?.history ?? []).slice(0, 50);
  if (!history.length) return showToast("还没有强化记录");
  const entries = history.map((entry) => {
    const time = new Date(entry.createdAt).toLocaleString("zh-CN", { year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false });
    const materialLevel = Number(entry.materialCard?.upgradeLevel ?? 0);
    const protection = `<span class="enhancement-history-protection ${entry.protectionUsed ? "is-protected" : "is-unprotected"}"><small>${entry.protectionUsed ? "已保卡" : "未保卡"}</small><b>花费 ${goldAmountMarkup(entry.protectionUsed ? entry.protectionCost ?? 0 : 0)}</b></span>`;
    return `<article class="enhancement-history-entry ${entry.success ? "success" : "failure"}"><header><div><small>${escapeHtml(time)}</small><h3>${escapeHtml(enhancementHistoryResultText(entry))}</h3></div><strong>${entry.chance}%<small>预期成功率</small></strong></header><div class="enhancement-history-card-pair"><section><b>主卡 · 强化前 +${entry.beforeLevel}</b>${s4PlayerCardMarkup(entry.mainPlayer, { card:entry.mainCard, deferred:true })}</section><i>+</i><section><b>副卡 · +${materialLevel}</b>${s4PlayerCardMarkup(entry.materialPlayer, { card:entry.materialCard, deferred:true })}</section><i>=</i><section class="result-card"><b>结果卡 · +${entry.afterLevel}</b>${s4PlayerCardMarkup(entry.resultPlayer ?? entry.mainPlayer, { card:entry.resultCard ?? { ...entry.mainCard, upgradeLevel:entry.afterLevel }, deferred:true })}</section></div><footer>${protection}<span><small>最终结果</small><b>${escapeHtml(enhancementHistoryResultText(entry))}</b></span></footer></article>`;
  }).join("");
  const overlay = openLeagueDialog(`<header><div><h2>强化记录</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="enhancement-history-scroll">${entries}</div>`, "enhancement-history-dialog");
  overlay.classList.add("enhancement-history-overlay");
}

function leagueEnhancementMarkup() {
  const allCards = leagueEnhancementCardEntries();
  let main = leagueEnhancementCardEntry(leagueEnhancementMainCardId);
  let material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
  if (main && leagueEnhancementCardListed(main.player.id, main.card.id)) main = null;
  if (material && leagueEnhancementCardListed(material.player.id, material.card.id)) material = null;
  if (!main) leagueEnhancementMainCardId = null;
  if (!material) leagueEnhancementMaterialCardId = null;
  const search = leagueBackpackSearch.trim().toLocaleLowerCase("zh-CN");
  const heldIds = new Set([leagueEnhancementMainCardId, leagueEnhancementMaterialCardId, leagueEnhancementResult?.card.id ?? league.enhancement?.traitOffer?.cardId]);
  const warehouseCards = allCards.filter(({ player, card }) => {
    if (heldIds.has(card.id)) return false;
    const matchesSearch = !search || [player.name, player.club, player.nationality].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(search));
    const matchesPosition = leagueBackpackPosition === "ALL" || player.pool === leagueBackpackPosition;
    const level = Number(card.upgradeLevel ?? 0);
    const matchesUpgrade = leagueBackpackUpgrade === "ALL"
      || leagueBackpackUpgrade === "BASE" && level === 0
      || leagueBackpackUpgrade === "MID" && level >= 1 && level <= 4
      || leagueBackpackUpgrade === "HIGH" && level >= 5 && level <= 7
      || leagueBackpackUpgrade === "MAX" && level >= 8;
    const listed = leagueEnhancementCardListed(player.id, card.id);
    const matchesListing = leagueEnhancementListingFilter === "ALL" || !listed;
    return matchesSearch && matchesPosition && matchesUpgrade && matchesListing;
  }).sort((left, right) => {
    if (leagueBackpackSort === "upgrade") {
      const gradeDifference = comparePlayerGrade(left, right);
      if (gradeDifference) return gradeDifference;
    }
    const upgradeDifference = right.card.upgradeLevel - left.card.upgradeLevel;
    if (upgradeDifference) return upgradeDifference;
    if (leagueBackpackSort === "overall") return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
    if (leagueBackpackSort === "name") return left.player.name.localeCompare(right.player.name, "zh-CN") || right.player.overall - left.player.overall;
    return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
  });
  const mainLevel = Number(main?.card.upgradeLevel ?? 0);
  const materialLevel = Number(material?.card.upgradeLevel ?? 0);
  const compatibleCards = Boolean(main && material && main.card.id !== material.card.id && main.player.id === material.player.id);
  const materialLevelTooHigh = compatibleCards && materialLevel > mainLevel;
  const chance = compatibleCards ? leagueEnhancementChance(mainLevel, materialLevel) : 0;
  const protectionAvailable = Boolean(main && compatibleCards && !materialLevelTooHigh && chance < 100 && mainLevel < Number(league.enhancement?.maxLevel ?? 8));
  if (!protectionAvailable) leagueEnhancementUseProtection = false;
  const failureChance = Math.max(0, 100 - chance);
  const protectionUnit = Number(league.enhancement?.protectionCostUnit ?? 100);
  const protectionBaseCost = protectionAvailable ? Math.ceil((failureChance * failureChance * Number(league.enhancement?.protectionCostFactor ?? .7)) / protectionUnit) * protectionUnit : 0;
  const protectionCost = Math.ceil(Math.ceil(protectionBaseCost * Number(league.enhancement?.protectionCostDiscount ?? .75)) * Number(league.enhancement?.protectionCostMultiplier ?? 1));
  const abilityBonuses = league.enhancement?.abilityBonuses ?? [0, 1, 2, 3, 5, 7, 9, 11, 13];
  const currentOverall = main ? Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel] ?? mainLevel) : null;
  const targetOverall = main ? Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel + 1] ?? mainLevel + 1) : null;
  const insufficientCoins = leagueEnhancementUseProtection && protectionAvailable && league.wallet.balance < protectionCost;
  const canEnhance = !leagueEnhancementResult && !main?.card.mainBlocked && !material?.card.materialBlocked && compatibleCards && !materialLevelTooHigh && mainLevel < Number(league.enhancement?.maxLevel ?? 8) && !insufficientCoins && leagueEnhancementPhase !== "scanning";
  const enhancementHint = materialLevelTooHigh ? "" : main ? `能力 ${currentOverall} → ${targetOverall}` : "选择主卡后显示能力成长";
  const result = leagueEnhancementResult;
  const traitOffer = result ? result.traitOffer ?? null : league.enhancement?.traitOffer ?? null;
  const traitOfferEntry = traitOffer ? leagueEnhancementCardEntry(traitOffer.cardId) : null;
  const traitPlayer = result?.player ?? traitOfferEntry?.player ?? null;
  const traitRoleLabels = { ANY:"全位置", ATT:"前场", MID:"中场", DEF:"后场", GK:"门将" };
  const traitPicker = "";
  const bindTraitButton = traitOffer ? `<button type="button" class="enhancement-bind-trait" data-enhancement-open-traits>绑定特性</button>` : "";
  const resultCardAttributes = result
    ? traitOffer
      ? `draggable="false" aria-disabled="true" data-enhancement-result-card="${result.card.id}" data-enhancement-result-pending title="请先绑定强化特性"`
      : `draggable="true" data-enhancement-result-card="${result.card.id}" title="双击或拖回球员卡仓库"`
    : "";
  const resultMarkup = result
    ? s4PlayerCardMarkup(result.player, { card:result.card, compact:true, attributes:resultCardAttributes })
    : traitOffer && traitOfferEntry
      ? s4PlayerCardMarkup(traitOfferEntry.player, { card:traitOfferEntry.card, compact:true })
      : `<div class="enhancement-result-empty"><span>+</span><b>结果</b></div>`;
  const resultStatus = result
    ? `<h3>${result.success ? "强化成功" : result.afterLevel < result.beforeLevel ? "强化失败 · 降级" : "强化失败 · 保级"}</h3><b>+${result.beforeLevel} → +${result.afterLevel}</b>${bindTraitButton}`
    : traitOffer && traitOfferEntry ? `<h3>等待绑定特性</h3>${bindTraitButton}` : "";
  const warehouseMarkup = warehouseCards.length
    ? warehouseCards.map(({ player, card }) => {
      const pendingTrait = view.traitOffers?.some((offer) => offer.cardId === card.id);
      const attributes = `draggable="true" data-enhancement-card="${escapeHtml(card.id)}" data-enhancement-player="${escapeHtml(player.id)}"`;
      const status = [pendingTrait ? "待绑定特性" : "", card.mainBlocked || card.materialBlocked || ""].filter(Boolean).join(" · ");
      return `<div class="enhancement-warehouse-card">${s4PlayerCardMarkup(player, { card, compact:true, attributes, deferred:true })}${status ? `<span class="enhancement-card-status">${escapeHtml(status)}</span>` : ""}</div>`;
    }).join("")
    : `<div class="enhancement-warehouse-empty">没有符合条件的同名重复卡</div>`;
  return `<section class="league-enhancement phase-${leagueEnhancementPhase}">
    <div class="enhancement-left-column"><section class="enhancement-composer">
      <header><h2>球员强化</h2><b>${goldAmountMarkup(league.wallet.balance)}</b></header>
      <div class="enhancement-flow">
        ${leagueEnhancementSlotMarkup("main", main)}
        ${leagueEnhancementSlotMarkup("material", material)}
        <div class="enhancement-action">
          <strong>${materialLevelTooHigh ? "" : compatibleCards ? `${chance}%` : "—"}</strong>
          <small>${enhancementHint}</small>
          <button type="button" class="enhancement-trigger" data-enhancement-submit ${canEnhance ? "" : "disabled"}>${leagueEnhancementPhase === "scanning" ? "合成中" : "强化"}</button>
          <label class="${protectionAvailable ? "" : "disabled"}"><input type="checkbox" data-enhancement-protection ${leagueEnhancementUseProtection ? "checked" : ""} ${protectionAvailable ? "" : "disabled"}><span>使用保卡道具</span><b>${goldAmountMarkup(protectionCost)}</b></label>
        </div>
        <div class="enhancement-result-column"><div class="enhancement-result-frame">${resultMarkup}</div><div class="enhancement-result-status" aria-live="polite">${resultStatus}</div></div>
      </div>
      ${traitPicker}
    </section>${leagueEnhancementHistoryMarkup()}</div>
    <section class="enhancement-warehouse" data-enhancement-warehouse>
      <header><h2>同名球员卡仓库</h2><div class="enhancement-warehouse-header-actions"><button type="button" class="button secondary" data-enhancement-batch-open>批量合卡</button><b>${warehouseCards.length}/${allCards.length}</b></div></header>
      <div class="backpack-card-tools enhancement-tools"><input type="search" value="${escapeHtml(leagueBackpackSearch)}" placeholder="输入后按回车搜索球员、俱乐部或国家队" data-backpack-search><select data-backpack-position><option value="ALL" ${leagueBackpackPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueBackpackPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueBackpackPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueBackpackPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueBackpackPosition === "GK" ? "selected" : ""}>门将</option></select><select data-backpack-upgrade><option value="ALL" ${leagueBackpackUpgrade === "ALL" ? "selected" : ""}>全部强化</option><option value="BASE" ${leagueBackpackUpgrade === "BASE" ? "selected" : ""}>未强化</option><option value="MID" ${leagueBackpackUpgrade === "MID" ? "selected" : ""}>+1 ～ +4</option><option value="HIGH" ${leagueBackpackUpgrade === "HIGH" ? "selected" : ""}>+5 ～ +7</option><option value="MAX" ${leagueBackpackUpgrade === "MAX" ? "selected" : ""}>+8</option></select><select data-backpack-sort><option value="upgrade" ${leagueBackpackSort === "upgrade" ? "selected" : ""}>强化等级</option><option value="overall" ${leagueBackpackSort === "overall" ? "selected" : ""}>能力值</option><option value="name" ${leagueBackpackSort === "name" ? "selected" : ""}>姓名</option></select></div>
      <div class="backpack-card-grid compact enhancement-card-grid">${warehouseMarkup}</div>
    </section>
  </section>`;
}

function showLeagueEnhancementCelebration(result) {
  const celebrationVersion = version;
  const level = Number(result?.afterLevel ?? 0);
  if (!result?.success || level < 4) return;
  document.querySelector(".enhancement-celebration")?.remove();
  const celebration = document.createElement("div");
  celebration.className = `enhancement-celebration ${level >= 8 ? "is-max" : "is-high"}`;
  celebration.setAttribute("role", "status");
  celebration.setAttribute("aria-live", "polite");
  const meteors = Array.from({ length:48 }, (_, index) => {
    const startX = (index * 47) % 142 - 21;
    const startY = (index * 31) % 136 - 52;
    const delay = -((index * 37) % 120) / 10;
    const duration = 2.5 + (index % 7) * .3;
    const length = 62 + (index % 6) * 22;
    return `<i style="--meteor-x:${startX}vw;--meteor-y:${startY}vh;--meteor-delay:${delay}s;--meteor-duration:${duration}s;--meteor-length:${length}px;--meteor-opacity:${.38 + index % 5 * .12}"></i>`;
  }).join("");
  const cardMarkup = s4PlayerCardMarkup(result.player, { card:result.card });
  const traitOffer = result.traitOffer ?? null;
  const traitRoleLabels = { ANY:"全位置", ATT:"前场", MID:"中场", DEF:"后场", GK:"门将" };
  const traitCards = traitOffer ? traitOffer.traits.map((trait, index) => {
    const roles = (trait.eligibleRoleGroups ?? ["ANY"]).map((role) => traitRoleLabels[role] ?? role).join(" · ");
    return `<button type="button" class="enhancement-celebration-trait tone-${index + 1}" style="--trait-index:${index}" data-celebration-trait="${escapeHtml(trait.id)}"><span>0${index + 1}</span><i></i><h3>${escapeHtml(trait.name)}</h3><p>${escapeHtml(trait.summary ?? "特性效果由联赛后台配置。")}</p><b>${escapeHtml(roles)}</b><strong>选择并绑定</strong></button>`;
  }).join("") : "";
  const bindButton = traitOffer ? `<button type="button" class="enhancement-celebration-bind" data-celebration-bind><span>✦</span><b>绑定强化特性</b><small>从三张特性卡中选择一张</small></button>` : "";
  celebration.innerHTML = `<div class="enhancement-celebration-aurora"></div><div class="enhancement-celebration-meteors">${meteors}</div><div class="enhancement-celebration-flare"></div><div class="enhancement-celebration-stage"><small>${level >= 8 ? "ULTIMATE ENHANCEMENT" : "ENHANCEMENT SUCCESS"}</small><div class="enhancement-celebration-card"><div class="enhancement-celebration-card-glint"></div>${cardMarkup}</div><h2>${escapeHtml(result.player?.name ?? "球员")} 强化成功</h2>${bindButton}</div>${traitOffer ? `<section class="enhancement-celebration-traits"><header><small>SELECT ONE TRAIT</small><h2>选择强化特性</h2></header><div>${traitCards}</div></section>` : ""}`;
  celebration.addEventListener("click", (event) => {
    if (event.target.closest("[data-celebration-bind], [data-celebration-trait]") || celebration.classList.contains("traits-open") || celebration.classList.contains("trait-resolving")) return;
    celebration.classList.add("closing");
    celebration.classList.remove("show");
    setTimeout(() => celebration.remove(), 320);
  });
  celebration.querySelector("[data-celebration-bind]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    celebration.classList.add("traits-open");
  });
  celebration.querySelectorAll("[data-celebration-trait]").forEach((traitCard) => {
    traitCard.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (celebration.classList.contains("trait-resolving")) return;
      celebration.classList.add("trait-resolving");
      traitCard.classList.add("is-selected");
      celebration.querySelectorAll("[data-celebration-trait]").forEach((card) => { if (card !== traitCard) card.classList.add("is-dismissed"); });
      try {
        const chosen = await bindTrait(traitOffer.id, traitCard.dataset.celebrationTrait);
        if (!chosen || root.hidden || celebrationVersion !== version) { celebration.remove(); return; }
        leagueEnhancementResult = chosen ? { id:chosen.offerId, success:true, beforeLevel:chosen.card.upgradeLevel, afterLevel:chosen.card.upgradeLevel, player:chosen.player, card:chosen.card } : null;
        leagueEnhancementTraitSelectionOpen = false;
        leagueEnhancementPhase = "success";
        renderLeagueEnhancementInPlace();
        const nextCard = chosen ? s4PlayerCardMarkup(chosen.player, { card:chosen.card }) : cardMarkup;
        const cardShell = celebration.querySelector(".enhancement-celebration-card");
        if (cardShell) cardShell.innerHTML = `<div class="enhancement-celebration-card-glint"></div>${nextCard}`;
        celebration.querySelector(".enhancement-celebration-traits")?.remove();
        celebration.querySelector("[data-celebration-bind]")?.remove();
        celebration.classList.remove("traits-open", "trait-resolving");
        celebration.classList.add("trait-bound");
        showToast(chosen ? `已绑定特性：${chosen.trait.name}` : "特性绑定完成");
      } catch (error) {
        celebration.classList.remove("trait-resolving");
        traitCard.classList.remove("is-selected");
        celebration.querySelectorAll("[data-celebration-trait]").forEach((card) => card.classList.remove("is-dismissed"));
        showToast(error.message);
      }
    });
  });
  root.append(celebration);
  requestAnimationFrame(() => celebration.classList.add("show"));
}


  function batchDialog() {
    if (pending) return;
    if (leagueEnhancementMainCardId || leagueEnhancementMaterialCardId || leagueEnhancementResult) return showToast('请先将槽位中的卡片移回仓库，再进行批量合卡');
    const families = [...new Map(leagueEnhancementCardEntries().map(({ player }) => [player.id, player])).values()];
    if (!families.length) return showToast('暂无同名重复卡');
    const levels = Array.from({ length: 3 }, (_, n) => `<option value="${n}">+${n}</option>`).join('');
    const overlay = openLeagueDialog(`<header><h2>批量合卡</h2><button data-close-league-dialog>×</button></header><div class="batch-enhancement-form"><label>选择球员<select data-batch-player>${families.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}</select></label><div class="batch-enhancement-distribution" data-batch-distribution></div><div class="batch-enhancement-levels"><label>主卡等级<select data-batch-main>${levels}</select></label><label>副卡等级<select data-batch-material>${levels}</select></label></div><p data-batch-preview></p><label>合成数量<input type="number" min="1" value="1" data-batch-quantity></label><p>成功卡升一级，失败按现有规则处理。达到 +4 及以上请逐张强化并绑定特性。</p></div><footer class="batch-enhancement-footer"><button data-close-league-dialog>取消</button><button data-batch-submit>开始合成</button></footer>`, 'batch-enhancement-dialog');
    const values = () => ({ playerId: overlay.querySelector('[data-batch-player]').value, mainLevel: Number(overlay.querySelector('[data-batch-main]').value), materialLevel: Number(overlay.querySelector('[data-batch-material]').value), quantity: Number(overlay.querySelector('[data-batch-quantity]').value) });
    const preview = () => {
      const v = values(), counts = {};
      (view.cards ?? []).filter((p) => enhancementFamily(p) === v.playerId).forEach((p) => { counts[p.upgradeLevel] = (counts[p.upgradeLevel] ?? 0) + 1; });
      overlay.querySelector('[data-batch-distribution]').innerHTML = `<header>强化等级分布</header><div class="batch-result-levels">${Array.from({ length: 9 }, (_, n) => `<span>+${n}<b>${counts[n] ?? 0}</b></span>`).join('')}</div>`;
      overlay.querySelector('[data-batch-preview]').textContent = v.materialLevel > v.mainLevel ? '副卡等级不能高于主卡' : `每次成功率 ${leagueEnhancementChance(v.mainLevel, v.materialLevel)}%；自动跳过锁定卡；作为副卡消耗的球员会结束训练，并处理其首发位置。`;
    };
    overlay.addEventListener('change', preview); preview();
    overlay.querySelector('[data-batch-submit]').addEventListener('click', async () => {
      if (pending) return;
      const opened = version; pending = true; overlay.querySelectorAll('button,input,select').forEach((node) => { node.disabled = true; });
      try {
        const result = await mutate('batch', values());
        if (!result || opened !== version || root.hidden) return;
        overlay.remove(); leagueEnhancementMainCardId = null; leagueEnhancementMaterialCardId = null;
        openLeagueDialog(`<header><h2>批量合卡完成</h2><button data-close-league-dialog>×</button></header><div class="batch-enhancement-result"><div class="batch-result-hero"><strong class="is-success">${result.successCount} 成功</strong><strong class="is-failure">${result.failureCount} 失败</strong></div><p>实际合成 ${result.quantity} 次 · 成功率 ${result.chance}%</p><h3>最终库存</h3><div class="batch-result-levels">${Object.entries(result.finalLevelCounts).map(([n,c]) => `<span>+${n}<b>${c} 张</b></span>`).join('')}</div></div>`, 'batch-enhancement-result-dialog');
      } catch (error) { if (opened === version) showToast(error.message); }
      finally { pending = false; overlay.querySelectorAll('button,input,select').forEach((node) => { node.disabled = false; }); if (opened === version) renderLeagueEnhancementInPlace(); }
    });
  }
  root.addEventListener('click', (event) => {
    if (pending) return;
    const target = event.target;
    if (target.closest('[data-enhancement-submit]')) return perform();
    if (target.closest('[data-enhancement-batch-open]')) return batchDialog();
    if (target.closest('[data-enhancement-history-open]')) return openLeagueEnhancementHistory();
    if (target.closest('[data-enhancement-open-traits]')) {
      const offer = leagueEnhancementResult?.traitOffer ?? league.enhancement.traitOffer;
      const entry = leagueEnhancementCardEntry(offer?.cardId);
      if (entry) showLeagueEnhancementCelebration({ success: true, afterLevel: entry.card.upgradeLevel, ...entry, traitOffer: offer });
      return;
    }
    const slot = target.closest('[data-enhancement-slot-card]');
    if (slot) { if (slot.dataset.enhancementSlotCard === 'main') leagueEnhancementMainCardId = null; else leagueEnhancementMaterialCardId = null; if (!leagueEnhancementResult) leagueEnhancementPhase = 'idle'; renderLeagueEnhancementInPlace(); return; }
    const card = target.closest('[data-enhancement-card]'); if (card) assign(card.dataset.enhancementCard);
  });
  root.addEventListener('dblclick', (event) => {
    if (pending) return;
    const result = event.target.closest('[data-enhancement-result-card]');
    if (result) { event.preventDefault(); returnResultToWarehouse(result.dataset.enhancementResultCard); }
  });
  root.addEventListener('change', (event) => {
    if (pending) return;
    const el = event.target;
    if (el.matches('[data-enhancement-protection]')) leagueEnhancementUseProtection = el.checked;
    else if (el.matches('[data-backpack-position]')) leagueBackpackPosition = el.value;
    else if (el.matches('[data-backpack-upgrade]')) leagueBackpackUpgrade = el.value;
    else if (el.matches('[data-backpack-sort]')) leagueBackpackSort = el.value;
    else if (el.matches('[data-backpack-search]')) leagueBackpackSearch = el.value;
    else return;
    renderLeagueEnhancementInPlace();
  });
  root.addEventListener('keydown', (event) => {
    if (pending) return;
    if (event.key === 'Enter' && event.target.matches('[data-backpack-search]')) { leagueBackpackSearch = event.target.value; renderLeagueEnhancementInPlace(); }
    else if (['Enter', ' '].includes(event.key) && event.target.matches('[data-enhancement-card],[data-enhancement-slot-card]')) { event.preventDefault(); event.target.click(); }
  });
  function clearDrag(refresh = true) {
    draggedCardId = null;
    root.querySelectorAll('.is-dragging,.is-dragover').forEach(node=>node.classList.remove('is-dragging','is-dragover'));
    const needed=refreshAfterDrag;refreshAfterDrag=false;
    if(refresh&&needed&&!root.hidden&&!pending)void load();
  }
  function moveToSlot(id, slot) {
    const from=id===leagueEnhancementMainCardId?'main':id===leagueEnhancementMaterialCardId?'material':null;
    if(!from)return assign(id,slot);
    if(from===slot)return;
    // Moving between occupied slots is an atomic swap; validate both roles first.
    const nextMain=slot==='main'?id:leagueEnhancementMaterialCardId;
    const nextMaterial=slot==='material'?id:leagueEnhancementMainCardId;
    for(const [role,cardId] of [['main',nextMain],['material',nextMaterial]]){
      if(!cardId)continue;
      const entry=leagueEnhancementCardEntry(cardId);if(!entry)return;
      const reason=role==='main'?entry.card.mainBlocked:entry.card.materialBlocked;
      if(reason)return showToast(reason);
      if(role==='main'&&entry.card.upgradeLevel>=8)return showToast('主卡已经达到最高强化等级');
    }
    leagueEnhancementMainCardId=nextMain;leagueEnhancementMaterialCardId=nextMaterial;
    if(!leagueEnhancementResult)leagueEnhancementPhase='idle';
    renderLeagueEnhancementInPlace();
  }
  root.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-enhancement-card],[data-enhancement-card-id],[data-enhancement-result-card]');
    if (pending || !card || card.hasAttribute('data-enhancement-result-pending')) return event.preventDefault();
    draggedCardId=card.dataset.enhancementCard ?? card.dataset.enhancementCardId ?? card.dataset.enhancementResultCard;
    event.dataTransfer.setData('text/plain',draggedCardId);event.dataTransfer.effectAllowed='move';
    card.classList?.add('is-dragging');
  });
  root.addEventListener('dragover', (event) => {
    const target=event.target.closest('[data-enhancement-drop],[data-enhancement-warehouse]');
    if(pending||!target)return;
    event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    root.querySelectorAll('.is-dragover').forEach(node=>{if(node!==target)node.classList.remove('is-dragover');});
    target.classList?.add('is-dragover');
  });
  // Listen on the document too: dropping replaces the source node in the grid.
  root.addEventListener('dragend',()=>clearDrag());
  root.ownerDocument.addEventListener('dragend',()=>{if(draggedCardId)clearDrag();},true);
  root.addEventListener('drop', (event) => {
    if (pending) return; event.preventDefault();
    const id = event.dataTransfer.getData('text/plain'), slot = event.target.closest('[data-enhancement-drop]');
    clearDrag();
    if (slot) return moveToSlot(id, slot.dataset.enhancementDrop);
    if (event.target.closest('[data-enhancement-warehouse]')) {
      if (leagueEnhancementMainCardId === id) leagueEnhancementMainCardId = null;
      if (leagueEnhancementMaterialCardId === id) leagueEnhancementMaterialCardId = null;
      if (leagueEnhancementResult?.card.id === id) return returnResultToWarehouse(id);
      if(!leagueEnhancementResult)leagueEnhancementPhase = 'idle'; renderLeagueEnhancementInPlace();
    }
  });
  campaignStore.subscribe(({ state, previousState }) => {
    if (state?.playerId !== previousState?.playerId) { close(); retryIds.clear(); view = null; return; }
    if (!root.hidden && !pending && JSON.stringify([state?.draft?.roster,state?.enhancement,state?.wallet,state?.playerSquads,state?.tactics]) !== JSON.stringify([previousState?.draft?.roster,previousState?.enhancement,previousState?.wallet,previousState?.playerSquads,previousState?.tactics])) load();
  });
  registerWideWindow(root, { onRequestClose: close });
  return { open, close };
}
