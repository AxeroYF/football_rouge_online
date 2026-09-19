import { playerCardMarkup, escapePlayerCardHtml as esc } from "../player-card/player-card.js?v=20260906-card-scroll-v1";
import { goldAmountMarkup as gold } from "../ui/currency.js";
import { MAX_CARD_PRICE } from "../../shared/config/card-management.mjs";

const shield = (card, deferred = false) => playerCardMarkup(card, { variant: "standard", animated: false, deferred });
export const marketFilters = () => ({ search: "", grade: "all", position: "all", nationality: "all", upgradeLevel: "all", squad: "all", usable: false, scope: "all", sort: "newest" });
export const createMarketState = () => ({ market: marketFilters(), warehouse: marketFilters(), counts: { market: 24, warehouse: 24 }, selectedId: "", price: "" });
export function listingPrice(value, maxPrice = MAX_CARD_PRICE, minimumPrice = 1) {
  const text = String(value).trim(), price = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(price) && price >= minimumPrice && price <= maxPrice ? price : null;
}
// Escrow stays out of the playable roster; only the warehouse display includes own active listings.
export function warehouseCards(view) {
  const cards = new Map((view?.cards ?? []).map(card => [card.id, card]));
  for (const listing of view?.listings ?? []) {
    if (listing.mine && listing.status === "active") cards.set(listing.card.id, {
      ...listing.card, squad: listing.sourceSquad === "expedition" ? "expedition" : "garrison",
      listingId: listing.id, blocked: "已挂牌",
    });
  }
  return [...cards.values()];
}
export function marketEntries(view, state, pane) {
  const f = state[pane], search = f.search.trim().toLowerCase();
  const items = pane === "market" ? (view?.listings ?? []).filter(item => item.status === "active" && (f.scope !== "mine" || item.mine)) : warehouseCards(view);
  return items.filter(item => {
    const card = pane === "market" ? item.card : item;
    return (f.grade === "all" || card.grade === f.grade) && (f.position === "all" || card.pool === f.position || card.role === f.position) &&
      (f.nationality === "all" || card.nationality === f.nationality) && (f.upgradeLevel === "all" || Number(card.upgradeLevel) === Number(f.upgradeLevel)) &&
      (pane !== "warehouse" || f.squad === "all" || card.squad === f.squad) &&
      (pane !== "warehouse" || !f.usable || !card.blocked) &&
      (!search || [card.name, card.sourceName, card.nationality, card.club, card.role].join(" ").toLowerCase().includes(search));
  }).sort((a, b) => {
    if (pane === "market") {
      const priceOrder = f.sort === "price-asc" ? a.price - b.price : f.sort === "price-desc" ? b.price - a.price : 0;
      return priceOrder || Number(b.createdAt) - Number(a.createdAt) || a.id.localeCompare(b.id);
    }
    const grades = ["X", "S", "A", "B", "C"];
    return grades.indexOf(a.grade) - grades.indexOf(b.grade) || b.upgradeLevel - a.upgradeLevel || Number(b.effectiveOverall ?? b.overall) - Number(a.effectiveOverall ?? a.overall) || a.id.localeCompare(b.id);
  });
}
export function selectedMarketCard(view, state) { return warehouseCards(view).find(card => card.id === state.selectedId && !card.blocked); }
export function canListCard(view, state) { return !!selectedMarketCard(view, state); }

const shortReason = reason => reason.includes("比赛") ? "比赛中" : reason.includes("训练") ? "训练中" : reason.includes("锁定") ? "已锁定" : reason.includes("特性") ? "待选特性" : "不可挂牌";
const sharedReason = view => view?.cards.length && view.cards[0].blocked && view.cards.every(card => card.blocked === view.cards[0].blocked) ? view.cards[0].blocked : "";
const cardName = card => esc(card.name) + ' <span>+' + Number(card.upgradeLevel ?? 0) + '</span>';
const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
const tagIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h8l10 10-7 7L3 10Z"/><circle cx="7.5" cy="8" r="1"/></svg>';

function filterMarkup(view, state, pane) {
  const f = state[pane], warehouse = pane === "warehouse";
  const cards = warehouse ? warehouseCards(view) : (view?.listings ?? []).map(item => item.card);
  const countries = [...new Set(cards.map(card => card.nationality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const select = (key, label, values) => '<select data-cmm-pane="' + pane + '" data-cmm-filter="' + key + '" aria-label="' + (warehouse ? "仓库" : "市场") + label + '">' +
    values.map(([value, name]) => '<option value="' + esc(value) + '"' + (String(f[key]) === String(value) ? " selected" : "") + '>' + esc(name) + '</option>').join("") + '</select>';
  return '<div class="cmm-filters"><div class="cm-search">' + searchIcon + '<input type="search" data-cmm-pane="' + pane + '" data-cmm-filter="search" placeholder="搜索球员" aria-label="' + (warehouse ? "搜索仓库球员" : "搜索市场球员") + '" value="' + esc(f.search) + '"></div>' +
    select("grade", "评级", [["all", "评级"], ...["S", "A", "B", "C", "X"].map(value => [value, value])]) +
    select("position", "位置", [["all", "位置"], ["GK", "门将"], ["DEF", "后卫"], ["MID", "中场"], ["ATT", "前锋"]]) +
    (warehouse ? select("squad", "编队", [["all", "编队"], ["expedition", "远征"], ["garrison", "留守"]]) : select("nationality", "国家", [["all", "国家"], ...countries.map(value => [value, value])])) +
    select("upgradeLevel", "强化", [["all", "强化"], ...Array.from({ length: 9 }, (_, i) => [i, "+" + i])]) +
    (warehouse ? '<label class="cmm-usable"><input type="checkbox" data-cmm-pane="warehouse" data-cmm-filter="usable"' + (f.usable ? " checked" : "") + '>仅可挂牌</label>' :
      select("sort", "排序", [["newest", "最新挂牌"], ["price-asc", "价格从低到高"], ["price-desc", "价格从高到低"]])) +
    '<button type="button" class="cmm-reset" data-cmm-reset="' + pane + '">重置</button></div>';
}
export function marketCardMarkup(item, pane, view, state, wallet) {
  const warehouse = pane === "warehouse", card = warehouse ? item : item.card, listed = warehouse && !!card.listingId, chosen = warehouse && !listed && state.selectedId === card.id;
  const title = esc(card.name + " +" + Number(card.upgradeLevel ?? 0));
  const identity = listed ? 'data-cmm-detail="' + esc(card.id) + '" data-cmm-pane="warehouse" aria-haspopup="dialog" draggable="false"' : warehouse ? 'data-cmm-select="' + esc(card.id) + '" aria-pressed="' + chosen + '" draggable="' + !card.blocked + '" title="双击挂牌，或拖到市场"' : 'data-cmm-detail="' + esc(item.id) + '" data-cmm-pane="market" aria-haspopup="dialog"';
  const reason = warehouse && !listed ? card.blocked : "";
  const action = warehouse ? '' : '<button type="button" class="cmm-card-action' + (item.mine ? ' is-mine' : '') + '" data-cmm-' + (item.mine ? 'cancel' : 'buy') + '="' + esc(item.id) + '"' +
    (!item.mine && wallet < item.price ? ' disabled' : '') + '>' + (item.mine ? '撤回挂牌' : wallet < item.price ? '金币不足' : '购买') + '</button>';
  return '<article class="cm-card cmm-card' + (chosen ? ' is-selected' : '') + (listed ? ' is-listed' : '') + '"><button type="button" class="cm-card-art" ' + identity + ' aria-label="' +
    (warehouse && !listed ? chosen ? '已选择' : '选择' : '查看') + title + (reason ? '，' + esc(reason) : '') + '"' + (reason ? ' disabled' : '') + '>' + shield(card, true) +
    (listed ? '<span class="cmm-listed-badge">已挂牌</span>' : warehouse ? '<span class="cm-selection-mark" data-cmm-selection aria-hidden="true"' + (!chosen ? ' hidden' : '') + '>✓</span>' : '') + '</button>' +
    '<button type="button" class="cmm-card-name" data-cmm-detail="' + esc(item.id) + '" data-cmm-pane="' + pane + '" aria-label="查看' + title + '详情" title="查看详情">' + cardName(card) + '</button>' +
    (warehouse ? reason && reason !== sharedReason(view) ? '<span class="cm-card-status" title="' + esc(reason) + '">' + esc(shortReason(reason)) + '</span>' : '' :
      '<div class="cmm-listing-meta"><strong>' + gold(item.price) + '</strong><span class="cmm-seller" title="' + esc(item.sellerName) + '">' + esc(item.mine ? '我的挂牌' : item.sellerName) + '</span></div>') + action + '</article>';
}
export function marketPageMarkup(view, state, { wallet = 0, loadError = "" } = {}) {
  const paneMarkup = pane => {
    const warehouse = pane === "warehouse", items = marketEntries(view, state, pane), common = warehouse ? sharedReason(view) : "";
    const controls = warehouse ? '<button type="button" class="cm-primary cmm-list-button" data-cmm-list' + (!canListCard(view, state) ? ' disabled' : '') + '>' + tagIcon + '挂牌</button>' :
      '<div class="cmm-scopes" aria-label="挂牌范围"><button type="button" data-cmm-scope="all" aria-pressed="' + (state.market.scope === "all") + '">全部</button><button type="button" data-cmm-scope="mine" aria-pressed="' + (state.market.scope === "mine") + '">我的挂牌</button></div>';
    let content = items.length ? '<div class="cm-card-grid cmm-grid" data-cmm-grid="' + pane + '">' + items.slice(0, state.counts[pane]).map(item => marketCardMarkup(item, pane, view, state, wallet)).join("") + '</div>' :
      '<div class="cmm-empty"><span aria-hidden="true">' + (warehouse ? tagIcon : searchIcon) + '</span><p>' + (warehouse ? warehouseCards(view).length ? '没有符合条件的球员卡' : '仓库暂无球员卡' : state.market.scope === 'mine' ? '暂无自己的挂牌' : (view?.listings.length ? '没有符合条件的挂牌' : '市场暂无挂牌')) + '</p></div>';
    if (!view) content = '<p class="cm-empty">正在加载…</p>';
    if (loadError) content = '<div class="cmm-empty"><p role="alert">' + esc(loadError) + '</p><button type="button" data-cm-action="refresh">重新加载</button></div>';
    return '<section class="cmm-pane cmm-' + pane + '" aria-labelledby="cmm-' + pane + '-title"' + (warehouse ? '' : ' data-cmm-dropzone') + '>' +
      (warehouse ? '' : '<div class="cmm-drop-hint" aria-hidden="true"><span>松开挂牌</span></div>') + '<header class="cmm-pane-header"><h3 id="cmm-' + pane + '-title">' + (warehouse ? '仓库' : '市场') +
      '</h3><span class="cmm-count">' + items.length + '</span>' + controls + '</header>' + filterMarkup(view, state, pane) +
      (common ? '<div class="cmm-restriction" role="status" title="' + esc(common) + '">' + esc(shortReason(common)) + '，暂不可挂牌</div>' : '') +
      '<div class="cmm-scroll" data-cmm-scroll="' + pane + '" tabindex="0" aria-label="' + (warehouse ? '仓库球员卡' : '市场挂牌') + '">' + content + '</div></section>';
  };
  return '<div class="cmm-layout">' + paneMarkup("market") + paneMarkup("warehouse") + '</div>';
}

export function marketConfirmationMarkup(kind, value, { priceText } = {}) {
  const listing = kind !== "list", card = listing ? value.card : value.cards[0], price = listing ? value.price : value.amount;
  const label = kind === "buy" ? "支付金币" : "挂牌价格";
  const priceMarkup = priceText === undefined ? '<div class="cmm-confirm-price"><span>' + label + '</span><strong>' + gold(price) + '</strong></div>' :
    '<label class="cmm-price-field"><span>挂牌价格</span><span class="cmm-price"><input type="text" inputmode="numeric" autocomplete="off" data-cmm-price aria-label="挂牌价格" aria-describedby="cmm-minimum-price" value="' + esc(priceText) + '"><span>金币</span></span></label>' +
    '<div class="cmm-minimum" id="cmm-minimum-price">最低限价 <strong>' + gold(value.minimumPrice) + '</strong></div>';
  const returnSquad = value.sourceSquad === "expedition" ? "远征" : value.sourceSquad === "garrison" ? "留守" : "原";
  const warning = kind === "list" ? '挂牌后暂停编队、训练、强化、回收与汰换。撤回后返回' + returnSquad + '编队。' : kind === "buy" ? '确认后扣除金币，球员卡加入留守编队。' : '撤回后，球员卡返回' + returnSquad + '编队。';
  return '<div class="cmm-confirmation"><div class="cmm-confirm-card">' + shield(card) + '</div><div class="cmm-confirm-copy"><h4>' + cardName(card) + '</h4><p>' +
    esc([card.grade + '级', card.role, card.nationality].filter(Boolean).join(' · ')) + '</p>' + priceMarkup +
    (kind === 'buy' ? '<p>卖家：' + esc(value.sellerName) + '</p>' : '') + '<p class="cm-warning">' + warning + '</p>' +
    (value.lineupAffected?.length ? '<p class="cm-warning">包含首发球员，挂牌后原编队将自动补位；替补不足保留空位。</p>' : '') + '</div></div>';
}
