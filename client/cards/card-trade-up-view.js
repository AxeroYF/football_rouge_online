import { playerCardMarkup, escapePlayerCardHtml as esc } from "../player-card/player-card.js?v=20260906-card-scroll-v1";
import { TRADE_UP_GRADES, TRADE_UP_HISTORY_LIMIT } from "../../shared/config/card-management.mjs";
import { warehouseCards } from "./card-market-view.js?v=20260906-card-scroll-v1";

const shield = (card, deferred = false) => playerCardMarkup(card, { variant: "standard", animated: false, deferred });
const name = card => esc(card.name) + ' <span>+' + Number(card.upgradeLevel ?? 0) + '</span>';
export const tradeUpFilters = () => ({ search: "", grade: "all", position: "all", nationality: "all", squad: "all", upgradeLevel: "all", usable: false });
export const createTradeUpState = () => ({ filters: tradeUpFilters(), selected: [], count: 24, error: "" });
const tradeUpWarehouse = view => warehouseCards(view).filter(card => !!TRADE_UP_GRADES[card.grade] && !card.isX);
export function tradeUpCards(view, state) {
  const cards = new Map(tradeUpWarehouse(view).map(card => [card.id, card]));
  return state.selected.map(id => cards.get(id)).filter(Boolean);
}
export function tradeUpBlocked(card, selected = []) {
  if (!card) return "球员卡已转出";
  if (card.blocked) return card.blocked;
  if (!TRADE_UP_GRADES[card.grade] || card.isX) return "传奇卡不可汰换";
  if (selected.length && selected[0].grade !== card.grade) return "需 " + selected[0].grade + " 级素材";
  if (selected.length === 5 && !selected.some(item => item.id === card.id)) return "已满 5 张";
  return "";
}
export function tradeUpEntries(view, state) {
  const f = state.filters, search = f.search.trim().toLowerCase(), selected = tradeUpCards(view, state);
  return tradeUpWarehouse(view).filter(card => (f.grade === "all" || card.grade === f.grade) &&
    (f.position === "all" || card.pool === f.position || card.role === f.position) &&
    (f.nationality === "all" || card.nationality === f.nationality) && (f.squad === "all" || card.squad === f.squad) &&
    (f.upgradeLevel === "all" || Number(card.upgradeLevel) === Number(f.upgradeLevel)) &&
    (!f.usable || !tradeUpBlocked(card, selected)) &&
    (!search || [card.name, card.sourceName, card.club, card.nationality, card.role].join(" ").toLowerCase().includes(search)))
    .sort((a, b) => ["X", "S", "A", "B", "C"].indexOf(a.grade) - ["X", "S", "A", "B", "C"].indexOf(b.grade) ||
      b.upgradeLevel - a.upgradeLevel || Number(b.effectiveOverall ?? b.overall) - Number(a.effectiveOverall ?? a.overall) || a.id.localeCompare(b.id));
}
const shortReason = reason => reason.includes("比赛") ? "比赛中" : reason.includes("训练") ? "训练中" : reason.includes("锁定") ? "已锁定" : reason.includes("特性") ? "待选特性" : reason.includes("传奇") ? "不可汰换" : reason;
const slotShape = '<svg viewBox="0 0 130 175" aria-hidden="true"><path d="M8 20 19 10 65 3 111 10 122 20V150L111 164 65 173 19 164 8 150Z"/></svg>';
function filtersMarkup(view, state) {
  const f = state.filters;
  const countries = [...new Set(tradeUpWarehouse(view).map(card => card.nationality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const select = (key, label, values) => '<select data-cmu-filter="' + key + '" aria-label="' + label + '">' + values.map(([value, label]) =>
    '<option value="' + esc(value) + '"' + (String(f[key]) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select>';
  return '<div class="cmm-filters cmu-filters"><div class="cm-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" data-cmu-filter="search" aria-label="搜索汰换球员" placeholder="搜索球员" value="' + esc(f.search) + '"></div>' +
    select("grade", "评级", [["all", "评级"], ...["A", "B", "C"].map(value => [value, value])]) +
    select("position", "位置", [["all", "位置"], ["GK", "门将"], ["DEF", "后卫"], ["MID", "中场"], ["ATT", "前锋"]]) +
    select("squad", "编队", [["all", "编队"], ["expedition", "远征"], ["garrison", "留守"]]) +
    select("nationality", "国家", [["all", "国家"], ...countries.map(value => [value, value])]) +
    select("upgradeLevel", "强化", [["all", "强化"], ...Array.from({ length: 9 }, (_, i) => [i, "+" + i])]) +
    '<label class="cmm-usable"><input type="checkbox" data-cmu-filter="usable"' + (f.usable ? ' checked' : '') + '>仅可汰换</label><button type="button" data-cmu-action="reset">重置</button></div>';
}
export function tradeUpCardMarkup(card, view, state) {
  const chosen = state.selected.includes(card.id), reason = tradeUpBlocked(card, tradeUpCards(view, state));
  return '<article class="cm-card cmm-card' + (chosen ? ' is-selected' : '') + '"><button type="button" class="cm-card-art" data-cmu-select="' + esc(card.id) + '" aria-pressed="' + chosen + '" aria-label="' +
    esc((chosen ? "移除素材 " : "加入素材 ") + card.name + " +" + card.upgradeLevel + (reason ? "，" + reason : "")) + '"' + (reason ? ' disabled' : '') + '>' + shield(card, true) +
    '<span class="cm-selection-mark" aria-hidden="true"' + (chosen ? '' : ' hidden') + '>✓</span>' + (card.listingId ? '<span class="cmm-listed-badge">已挂牌</span>' : '') + '</button>' +
    '<button type="button" class="cmm-card-name" data-cmu-detail="' + esc(card.id) + '" title="查看详情">' + name(card) + '</button>' +
    (reason && !card.listingId ? '<span class="cm-card-status" title="' + esc(reason) + '">' + esc(shortReason(reason)) + '</span>' : '') + '</article>';
}
function materialsMarkup(cards, removable = false) {
  return '<div class="cmu-materials">' + Array.from({ length: 5 }, (_, i) => {
    const card = cards[i];
    if (!card) return '<div class="cmu-slot-empty" aria-label="素材槽 ' + (i + 1) + '">' + slotShape + '<span>' + (i + 1) + '</span></div>';
    return '<article class="cm-card cmu-material">' + (removable ? '<button type="button" class="cm-card-art" data-cmu-remove="' + esc(card.id) + '" aria-label="移除素材 ' + esc(card.name) + '" title="移除素材">' : '<div class="cmu-material-art">') +
      shield(card) + (removable ? '<span class="cmu-remove" aria-hidden="true">×</span></button>' : '</div>') + '<strong>' + name(card) + '</strong></article>';
  }).join('') + '</div>';
}
export function tradeUpPageMarkup(view, state, { loadError = "" } = {}) {
  const selected = tradeUpCards(view, state), items = tradeUpEntries(view, state), target = TRADE_UP_GRADES[selected[0]?.grade];
  let warehouse = items.length ? '<div class="cm-card-grid cmm-grid" data-cmu-grid>' + items.slice(0, state.count).map(card => tradeUpCardMarkup(card, view, state)).join('') + '</div>' : '<p class="cm-empty">' + (tradeUpWarehouse(view).length ? '没有符合条件的球员卡' : '暂无可用评级的球员卡') + '</p>';
  if (!view) warehouse = '<p class="cm-empty">正在读取球员卡…</p>';
  if (loadError) warehouse = '<p class="cm-empty" role="alert">' + esc(loadError) + '</p><button type="button" data-cm-action="refresh">重新加载</button>';
  return '<div class="cmu-layout"><section class="cmm-pane cmu-contract" aria-labelledby="cmu-contract-title"><header class="cmm-pane-header"><h3 id="cmu-contract-title">汰换合同</h3><span class="cmm-count" role="status">' + selected.length + ' / 5</span><button type="button" class="cm-primary" data-cmu-action="preview"' + (selected.length !== 5 || loadError ? ' disabled' : '') + '>预览汰换</button></header>' +
    '<div class="cmu-contract-scroll" data-cmu-contract-scroll><div class="cmu-material-heading"><strong>' + (selected.length ? selected[0].grade + ' 级素材' : '5 张同评级球员卡') + '</strong><button type="button" data-cmu-action="clear"' + (!selected.length ? ' disabled' : '') + '>清空</button></div>' + materialsMarkup(selected, true) +
    '<div class="cmu-output"><svg class="cmu-flow-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18m-6-6 6 6 6-6"/></svg><div class="cmu-output-shield' + (target ? ' grade-' + target.toLowerCase() : '') + '" aria-hidden="true">' + slotShape + '<b>' + (target ?? '?') + '</b></div><strong>' + (target ? '随机 ' + target + ' 级球员' : '高一级球员') + '</strong></div>' +
    (state.error ? '<p class="cmu-error" role="alert">' + esc(state.error) + '</p>' : '') + tradeUpHistoryMarkup(view) + '</div></section>' +
    '<section class="cmm-pane cmm-warehouse cmu-warehouse" aria-labelledby="cmu-warehouse-title"><header class="cmm-pane-header"><h3 id="cmu-warehouse-title">仓库</h3><span class="cmm-count">' + items.length + '</span></header>' + filtersMarkup(view, state) + '<div class="cmm-scroll" data-cmu-scroll tabindex="0" aria-label="汰换球员仓库">' + warehouse + '</div></section></div>';
}
export function validateTradeUpQuote(value, ids, grade) {
  const matches = values => Array.isArray(values) && values.length === 5 && new Set(values).size === 5 && values.every(id => ids.includes(id));
  if (value.kind !== "trade-up" || !value.quote || !matches(value.cardIds) || !matches(value.cards?.map(card => card.id)) ||
      value.cards.some(card => card.grade !== grade || card.isX) || value.targetGrade !== TRADE_UP_GRADES[grade] ||
      !Array.isArray(value.candidates) || !value.candidates.length || value.candidates.some(card => card.grade !== value.targetGrade || card.isX)) throw Error("汰换预览已变化，请重新预览");
}
export const tradeUpCandidateMarkup = card => '<article class="cm-card cmu-candidate">' + shield({ ...card, upgradeLevel: 0, trainingBonuses: {} }, true) + '<strong>' + esc(card.name) + '</strong><span>' + esc([card.nationality, card.club].filter(Boolean).join(' · ')) + '</span></article>';
export function tradeUpConfirmationMarkup(value) {
  return '<div class="cmu-confirm-summary"><strong>5 张 ' + esc(value.cards[0].grade) + ' 级 → 1 张 ' + esc(value.targetGrade) + ' 级</strong><span>强化 +0 · 无训练成长 · 加入留守编队</span></div>' + materialsMarkup(value.cards) +
    '<p class="cm-warning">确认后消耗以上 5 张卡及其强化、训练成长。</p>' + (value.lineupAffected?.length ? '<p class="cm-warning">含首发球员，汰换后原编队自动补位；替补不足时保留空位。</p>' : '') +
    '<div class="cmu-pool-heading"><h4>国家／俱乐部候选池 <span>' + value.candidates.length + '</span></h4><span>每位概率 1 / ' + value.candidates.length + '</span></div>' +
    '<div class="cmu-pool-scroll" data-cmu-pool-scroll tabindex="0" aria-label="汰换候选池"><div class="cm-card-grid cmu-pool-grid" data-cmu-pool-grid>' + value.candidates.slice(0, 24).map(tradeUpCandidateMarkup).join('') + '</div></div><button type="button" class="cmu-requote" data-cmu-action="requote">重新预览</button>';
}
export function tradeUpResultMarkup(card, { materials = [] } = {}) {
  const result = '<div class="cmu-result' + (materials.length === 5 ? ' cmu-reveal-result" data-cmu-reveal-result aria-hidden="true" inert' : '"') + '>' + shield(card) + '<h4>' + name(card) + '</h4><p>' + esc(card.grade) + ' 级 · 已加入留守编队</p></div>';
  if (materials.length !== 5) return result;
  const cards = materials.map((material, index) => '<div class="cmu-reveal-material" style="--fan-x:' + ((index - 2) * 18) + 'cqw;--fan-angle:' + ((index - 2) * 7) + 'deg;--fan-delay:' + (index * 45) + 'ms">' + shield(material) + '</div>').join('');
  return '<div class="cmu-reveal is-animating" data-cmu-reveal aria-busy="true"><div class="cmu-reveal-materials" aria-hidden="true">' + cards +
    '</div><div class="cmu-reveal-glow" aria-hidden="true"></div>' + result + '<strong class="cmu-reveal-status" data-cmu-reveal-status role="status">汰换中</strong></div>';
}

const historyDate = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; };
export function tradeUpHistory(view) {
  return (view?.history ?? []).filter(entry => entry.kind === "trade-up" && entry.id && entry.card && Array.isArray(entry.cards) && entry.cards.length === 5)
    .sort((a, b) => (historyDate(b.createdAt)?.getTime() ?? 0) - (historyDate(a.createdAt)?.getTime() ?? 0)).slice(0, TRADE_UP_HISTORY_LIMIT);
}
function historyTime(entry) {
  const date = historyDate(entry.createdAt);
  return '<time' + (date ? ' datetime="' + date.toISOString() + '"' : '') + '>' + (date ? esc(date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })) : '—') + '</time>';
}
export function tradeUpHistoryMarkup(view, { expanded = false } = {}) {
  const entries = tradeUpHistory(view);
  const rows = entries.map(entry => '<li><button type="button" class="cmu-history-row" data-cmu-history="' + esc(entry.id) + '" aria-label="查看汰换记录：' + esc(entry.card.name) + '">' +
    historyTime(entry) + '<span class="cmu-history-source">5 × ' + esc(entry.cards[0].grade) + '</span><span class="cmu-history-arrow" aria-hidden="true">→</span><strong>' + name(entry.card) + '</strong><span class="cmu-history-grade grade-' + esc(entry.card.grade.toLowerCase()) + '">' + esc(entry.card.grade) + '</span></button></li>').join('');
  return '<section class="cmu-history' + (expanded ? ' is-expanded' : '') + '">' + (expanded ? '' : '<header><h3>汰换记录</h3><button type="button" data-cmu-action="history"' + (!entries.length ? ' disabled' : '') + '>放大查看</button></header>') +
    '<ol class="cmu-history-list" data-cmu-history-scroll data-cmu-history-latest="' + esc(entries[0]?.id ?? '') + '" tabindex="0" aria-label="汰换记录">' + (rows || '<li class="cmu-history-empty">暂无汰换记录</li>') + '</ol></section>';
}
export function tradeUpHistoryDetailMarkup(entry) {
  return '<div class="cmu-history-detail"><div class="cmu-history-detail-heading">' + historyTime(entry) + '<strong>5 张 ' + esc(entry.cards[0].grade) + ' 级 → 1 张 ' + esc(entry.card.grade) + ' 级</strong></div>' +
    materialsMarkup(entry.cards) + '<div class="cmu-history-result">' + shield(entry.card) + '<strong>' + name(entry.card) + '</strong></div></div>';
}
