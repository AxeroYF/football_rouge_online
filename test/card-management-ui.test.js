import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createCardManagementController, filterManagedCards } from "../client/cards/card-management-controller.js";
import { createCampaignStore } from "../client/core/campaign-store.js";
import { createMarketState, warehouseCards, marketEntries, listingPrice } from "../client/cards/card-market-view.js";
import { tradeUpHistory, tradeUpResultMarkup } from "../client/cards/card-trade-up-view.js";
import { CardManagementService } from "../server/application/card-management-service.mjs";
import { CARD_MANAGEMENT_DEFAULTS, recycleValue } from "../shared/config/card-management.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const cards = Array.from({ length: 7 }, (_, i) => ({ id: "c" + i, playerId: "c" + i, cardDefinitionId: i < 2 ? "same-player" : "c" + i,
  name: i < 2 ? "同名球员" : "球员" + i, sourceName: "Player " + i, grade: i === 6 ? "B" : "C", upgradeLevel: 0, overall: 70, role: "ST", pool: "ATT",
  nationality: "法国", club: "里昂", squad: "garrison", trainingBonuses: {}, recycleValue: i === 6 ? 400 : 80, attributes: {}, blocked: i === 5 ? "训练中" : null }));
const baseView = { cards, listings: [], history: [], config: structuredClone(CARD_MANAGEMENT_DEFAULTS) };
function quote(selected, config = CARD_MANAGEMENT_DEFAULTS) {
  return { cards: selected, cardIds: selected.map(card => card.id), quote: "quote-1", amount: selected.reduce((sum, card) => sum + recycleValue(card, config), 0), lineupAffected: [],
    recycle: { ratioBps: config.recycleRatioBps, upgradeBonusBps: config.upgradeBonusBps,
      lines: selected.map(card => ({ cardId: card.id, valuation: config.valuations[card.grade === "X" ? "S" : card.grade], amount: recycleValue(card, config) })) } };
}

// Minimal event/DOM facade: exercises production controller state without a browser.
function node(document, html = "") {
  let markup = html;
  const classes = new Set(), attributes = new Map();
  const value = { ownerDocument: document, dataset: {}, hidden: false, isConnected: true, events: {}, children: [], queries: new Map(), scrollTop: 0, style: {},
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); }, toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    setAttribute(name, value) { attributes.set(name, String(value)); }, getAttribute(name) { return attributes.get(name); },
    closest(selector) { if (selector === ".cm-card") return this.cardArticle ?? null; if (selector === "[data-cmm-select]" && this.dataset.cmmSelect) return this; return null; },
    contains(other) { for (let current = other; current; current = current.parent) if (current === this) return true; return false; },
    getBoundingClientRect() { return { left: 1000, top: 300, width: 180, height: 242 }; },
    addEventListener(type, callback) { (this.events[type] ??= []).push(callback); },
    fire(type, event) { for (const callback of this.events[type] ?? []) callback({ type, ...event }); },
    querySelector(selector) {
      const attribute = selector.match(/^\[([^=\]]+)/)?.[1];
      if (attribute && !markup.includes(attribute)) return null;
      if (!this.queries.has(selector)) {
        const child = node(document); child.parent = this; this.queries.set(selector, child);
        const selectedId = selector.match(/^\[data-cmm-select="([^"]+)"\]$/)?.[1];
        if (selectedId) { child.dataset.cmmSelect = selectedId; child.cardArticle = node(document); child.innerHTML = '<span data-cmm-selection></span>'; }
        if (selector === "[data-cmm-price]") child.dataset.cmmPrice = "";
        if (selector === "[data-cmu-history-scroll]") child.dataset.cmuHistoryLatest = markup.match(/data-cmu-history-latest="([^"]*)"/)?.[1] ?? "";
        if (selector === "[data-cm-content]" && document.layout) { child.clientHeight = document.layout.height; child.scrollHeight = document.layout.scrollHeight; document.scrollContainer = child; }
        if (selector === "[data-cm-grid]" && document.layout) child.afterInsert = () => { document.scrollContainer.scrollHeight += document.layout.step; };
      }
      return this.queries.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === "[data-cm-dialog-close]") return [this.querySelector(selector)].filter(Boolean);
      if (selector === "[data-cmm-select]" || selector === ".is-dragging") {
        const buttons = [...markup.matchAll(/data-cmm-select="([^"]+)"/g)].map(match => this.querySelector('[data-cmm-select="' + match[1] + '"]'));
        return selector === ".is-dragging" ? buttons.filter(button => button.classList.contains("is-dragging")) : buttons;
      }
      if (selector === "button,input") return ["[data-cm-dialog-close]", "[data-cm-confirm]", "[data-cmm-price]"].map(key => this.querySelector(key)).filter(Boolean);
      return [];
    },
    insertAdjacentHTML(position, content) { assert.equal(position, "beforeend"); markup += content; this.afterInsert?.(); },
    append(child) { this.children.push(child); child.parent = this; child.isConnected = true; },
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
    focus() { document.activeElement = this; }, setSelectionRange() {}, showModal() { this.open = true; }, close() { this.open = false; },
  };
  Object.defineProperty(value, "innerHTML", { get: () => markup, set(next) { markup = next; for (const child of value.children) child.isConnected = false; value.children = []; value.queries.clear(); } });
  return value;
}
function fixture(initialView = baseView) {
  const document = { activeElement: null, events: {},
    addEventListener(type, callback) { (this.events[type] ??= []).push(callback); },
    fire(type, event) { for (const callback of this.events[type] ?? []) callback(event); },
    createElement(tagName) { const value = node(document); value.tagName = tagName.toUpperCase(); return value; } };
  document.body = node(document);
  const root = node(document); root.hidden = true;
  const store = createCampaignStore({ playerId: "p", setupComplete: true, wallet: { gold: 1000 }, draft: { roster: initialView.cards } });
  const requests = [], toasts = [];
  const request = (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
  const controller = createCardManagementController({ root, getCampaignState: store.getState, campaignStore: store, getCampaignRequest: () => request, showToast: message => toasts.push(message) });
  const click = dataset => root.fire("click", { target: { closest: () => ({ dataset }) } });
  const select = id => click({ cmCard: id });
  const filter = (key, value) => root.fire(key === "search" ? "input" : "change", { target: { dataset: { cmFilter: key }, value, checked: value } });
  const open = async () => { controller.open(); requests.at(-1).resolve(structuredClone(initialView)); await flush(); };
  const recycle = async () => { await open(); click({ cmScreen: "recycle" }); };
  const batch = async () => { await recycle(); click({ cmAction: "start-batch" }); };
  const preview = async (response = quote([cards[0]])) => { click({ cmAction: "recycle" }); requests.at(-1).resolve(response); await flush(); return root.children[0]; };
  const scroll = () => {
    const container = root.querySelector("[data-cm-content]"), grid = root.querySelector("[data-cm-grid]");
    container.clientHeight = 600; container.scrollHeight = 2000; container.scrollTop = 1400;
    grid.afterInsert = () => { container.scrollHeight += 1000; };
    container.fire("scroll", { target: container });
    return { container, grid };
  };
  return { root, store, requests, controller, click, select, filter, open, recycle, batch, preview, scroll, toasts };
}

test("card filters preserve equal-level duplicate copies and support the squad filters", () => {
  assert.equal(filterManagedCards(cards).length, 7);
  assert.deepEqual(filterManagedCards(cards, { search: "同名球员" }).map(card => card.id), ["c0", "c1"]);
  assert.equal(filterManagedCards(cards, { usable: true, grade: "C", search: "法国" }).length, 5);
  assert.equal(filterManagedCards(cards, { position: "ATT", nationality: "法国", squad: "garrison", upgradeLevel: "0" }).length, 7);
  assert.equal(filterManagedCards(cards, { position: "GK" }).length, 0);
  assert.equal(filterManagedCards(cards, { search: "Player 0" })[0].id, "c0");
});

test("management opens with recycle, market and trade-up workflows", async () => {
  const f = fixture(); await f.open();
  assert.equal((f.root.innerHTML.match(/class="cm-menu-option"/g) ?? []).length, 3);
  assert.match(f.root.innerHTML, /<strong class="cm-option-title">回收<\/strong>/);
  assert.match(f.root.innerHTML, /class="cm-menu-option" data-cm-kind="sell" data-cm-screen="sell">/);
  assert.match(f.root.innerHTML, /class="cm-menu-option" data-cm-kind="trade-up" data-cm-screen="trade-up">/);
  assert.doesNotMatch(f.root.innerHTML, /cm-tabs|我的挂牌|交易市场|汰换合同/);
  f.click({ cmScreen: "recycle" });
  assert.match(f.root.innerHTML, /<header[^>]*>[\s\S]*?data-cm-action="start-batch"[\s\S]*?<\/header>/);
  assert.doesNotMatch(f.root.innerHTML, /cm-overall|minOverall|maxOverall|全部评级|全部位置|上一页|下一页|cm-footer|同名球员不会合并/);
  assert.match(f.root.innerHTML, /data-cm-filter="grade" aria-label="评级"/);
  assert.equal((f.root.innerHTML.match(/data-cm-card=/g) ?? []).length, 7);
  assert.doesNotMatch(f.root.innerHTML, /aria-pressed=/);
  f.select("c0");
  assert.ok(f.root.children[0].open, "normal card clicks still show details before batch mode");
  f.root.children[0].querySelector("[data-cm-dialog-close]").onclick();
  f.click({ cmAction: "recycle" });
  assert.equal(f.requests.length, 1, "no cards are recycled before batch selection");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="topbar-card-management" type="button">球员卡管理<\/button>/);
});

test("batch selection survives every filter, reset, home navigation and zero visible results", async () => {
  const f = fixture(); await f.batch(); f.select("c0"); f.select("c1");
  for (const [key, value] of [["search", "找不到"], ["grade", "B"], ["position", "GK"], ["nationality", "德国"], ["squad", "expedition"], ["upgradeLevel", "8"], ["usable", true]]) {
    f.filter(key, value); assert.match(f.root.innerHTML, /已选 2 张/);
  }
  assert.match(f.root.innerHTML, /筛选外 2 张/);
  f.click({ cmScreen: "home" }); f.click({ cmScreen: "recycle" }); assert.match(f.root.innerHTML, /已选 2 张/);
  f.click({ cmAction: "reset-filters" }); assert.match(f.root.innerHTML, /data-cm-card="c0"[^>]*aria-pressed="true"/);
  f.filter("search", "球员6"); f.select("c6");
  f.click({ cmAction: "recycle" });
  assert.deepEqual(f.requests.at(-1).options.body.cardIds, ["c0", "c1", "c6"]);
  f.requests.at(-1).reject(Error("测试取消")); await flush();
});

test("scroll appends cards in place and selection survives loading and filtering", async () => {
  const many = Array.from({ length: 55 }, (_, i) => ({ ...cards[0], id: "s" + String(i).padStart(2, "0"), playerId: "s" + String(i).padStart(2, "0") }));
  const f = fixture({ ...baseView, cards: many }); await f.batch();
  assert.equal((f.root.innerHTML.match(/data-cm-card=/g) ?? []).length, 24);
  f.select("s00");
  const before = f.root.innerHTML, first = f.scroll(); await flush();
  assert.equal(f.root.innerHTML, before, "scrolling does not replace the existing DOM");
  assert.equal(f.root.querySelector("[data-cm-grid]"), first.grid);
  assert.equal(first.container.scrollTop, 1400);
  assert.equal((first.grid.innerHTML.match(/data-cm-card=/g) ?? []).length, 24);
  assert.match(first.grid.innerHTML, /data-cm-card="s30"/);
  f.select("s30");
  assert.match(f.root.innerHTML, /data-cm-card="s00"[^>]*aria-pressed="true"/);
  assert.match(f.root.innerHTML, /data-cm-card="s30"[^>]*aria-pressed="true"/);
  const last = f.scroll(); await flush();
  assert.equal((last.grid.innerHTML.match(/data-cm-card=/g) ?? []).length, 7);
  f.scroll(); await flush();
  assert.equal((last.grid.innerHTML.match(/data-cm-card=/g) ?? []).length, 7, "end of collection cannot append duplicates");
  f.filter("search", "无匹配"); assert.match(f.root.innerHTML, /已选 2 张/);
  f.click({ cmAction: "reset-filters" });
  assert.equal((f.root.innerHTML.match(/data-cm-card=/g) ?? []).length, 24);
  assert.match(f.root.innerHTML, /已选 2 张/);
  f.click({ cmAction: "recycle" });
  assert.deepEqual(f.requests.at(-1).options.body.cardIds, ["s00", "s30"]);
  f.requests.at(-1).reject(Error("测试取消")); await flush();
});

test("tall windows fill automatically and queued loading stops when the window closes", async () => {
  const many = Array.from({ length: 78 }, (_, i) => ({ ...cards[0], id: "x" + i, playerId: "x" + i }));
  const f = fixture({ ...baseView, cards: many }); await f.recycle();
  f.root.ownerDocument.layout = { height: 1200, scrollHeight: 200, step: 600 };
  f.click({ cmAction: "start-batch" }); await flush();
  const grid = f.root.querySelector("[data-cm-grid]");
  assert.equal((grid.innerHTML.match(/data-cm-card=/g) ?? []).length, 54);
  f.filter("search", "同名球员");
  const closedGrid = f.root.querySelector("[data-cm-grid]");
  f.controller.close(); await flush();
  assert.equal(closedGrid.innerHTML, "");
});

test("shared restrictions appear once while card metadata only shows proceeds", async () => {
  const reason = "球队比赛进行中，结束后才能转出球员卡";
  const f = fixture({ ...baseView, cards: cards.map(card => ({ ...card, blocked: reason })) }); await f.recycle();
  assert.equal((f.root.innerHTML.match(/class="cm-availability"/g) ?? []).length, 1);
  assert.equal((f.root.innerHTML.match(/>比赛进行中，暂不可回收</g) ?? []).length, 1);
  assert.doesNotMatch(f.root.innerHTML, /cm-card-status|>预计回收</);
  f.click({ cmAction: "start-batch" }); f.select("c0");
  assert.match(f.root.innerHTML, /已选 0 张/);
});

test("blocked cards cannot be selected; clearing and cancelling are explicit", async () => {
  const f = fixture(); await f.batch();
  f.select("c5"); assert.match(f.root.innerHTML, /已选 0 张/);
  assert.match(f.root.innerHTML, /data-cm-card="c5"[^>]*disabled/);
  f.select("c0"); f.select("c0"); assert.match(f.root.innerHTML, /已选 0 张/);
  f.select("c0"); f.click({ cmAction: "clear" }); assert.match(f.root.innerHTML, /已选 0 张/);
  f.select("c1"); f.click({ cmAction: "cancel-batch" }); assert.match(f.root.innerHTML, /批量回收/); assert.doesNotMatch(f.root.innerHTML, /aria-pressed=/);
  const disabled = fixture({ ...baseView, config: { ...baseView.config, recycleEnabled: false } }); await disabled.recycle();
  disabled.click({ cmAction: "start-batch" }); assert.match(disabled.root.innerHTML, /回收暂未开放/); assert.doesNotMatch(disabled.root.innerHTML, /aria-pressed=/);
});

test("refresh preserves selection except cards that actually became unavailable", async () => {
  const f = fixture(); await f.batch(); f.select("c0"); f.select("c1");
  f.click({ cmAction: "refresh" }); f.requests.at(-1).resolve(structuredClone(baseView)); await flush();
  assert.match(f.root.innerHTML, /已选 2 张/);
  f.click({ cmAction: "refresh" });
  f.requests.at(-1).resolve({ ...baseView, cards: cards.map(card => card.id === "c1" ? { ...card, blocked: "训练中" } : card) }); await flush();
  assert.match(f.root.innerHTML, /已选 1 张/); assert.match(f.toasts.at(-1), /其他选择已保留/);
});

test("confirmation displays authoritative ratios, per-copy proceeds, training loss and affected lineups", async () => {
  const f = fixture(); await f.batch(); f.select("c0"); f.select("c1");
  const selected = [{ ...cards[0], name: "<img onerror=bad>" }, { ...cards[1], upgradeLevel: 4, trainingBonuses: { passing: 8 } }];
  const config = { ...CARD_MANAGEMENT_DEFAULTS, recycleRatioBps: 2500 };
  const q = { ...quote(selected, config), lineupAffected: ["garrison"] };
  const dialog = await f.preview(q);
  assert.ok(dialog.open); assert.match(dialog.innerHTML, /基础回收比例/); assert.match(dialog.innerHTML, /25%/); assert.match(dialog.innerHTML, /35%/);
  assert.match(dialog.innerHTML, /预计总收益/); assert.match(dialog.innerHTML, /240/); assert.match(dialog.innerHTML, /140/);
  assert.equal((dialog.innerHTML.match(/class="cm-preview-card"/g) ?? []).length, 2);
  assert.match(dialog.innerHTML, /训练成长不加价/); assert.match(dialog.innerHTML, /替补不足/); assert.doesNotMatch(dialog.innerHTML, /<img onerror=bad>/);
  dialog.querySelector("[data-cm-dialog-close]").onclick();
  assert.equal(f.root.children.length, 0); assert.match(f.root.innerHTML, /已选 2 张/);
});

test("failed mutation retries the same request ID and double-click cannot submit twice", async () => {
  const f = fixture(); await f.batch(); f.select("c0");
  const dialog = await f.preview(), button = dialog.querySelector("[data-cm-confirm]");
  button.fire("click", {}); const first = f.requests.at(-1), count = f.requests.length;
  button.fire("click", {}); assert.equal(f.requests.length, count);
  first.reject(Error("网络中断")); await flush();
  assert.equal(dialog.querySelector("[data-cm-dialog-error]").textContent, "网络中断");
  button.fire("click", {}); assert.equal(f.requests.at(-1).options.body.requestId, first.options.body.requestId);
  f.requests.at(-1).resolve({ state: { ...f.store.getState(), wallet: { gold: 1080 } }, view: { ...baseView, cards: cards.slice(1) }, result: { amount: 80 } }); await flush();
  assert.equal(f.store.getState().wallet.gold, 1080); assert.equal(f.root.children.length, 0);
  assert.match(f.root.innerHTML, /批量回收/); assert.doesNotMatch(f.root.innerHTML, /data-cm-card="c0"/); assert.match(f.root.innerHTML, /data-cm-card="c1"/);
  assert.match(f.toasts.at(-1), /获得 80 金币/);
});

test("a rejected quote returns to selection and requests a fresh confirmation", async () => {
  const f = fixture(); await f.batch(); f.select("c0");
  const dialog = await f.preview(); dialog.querySelector("[data-cm-confirm]").fire("click", {});
  f.requests.at(-1).reject(Error("卡片、阵容或价格已变化，请重新预览后确认")); await flush();
  dialog.querySelector("[data-cm-dialog-close]").onclick(); assert.match(f.root.innerHTML, /已选 1 张/);
  f.click({ cmAction: "recycle" }); assert.equal(f.requests.at(-1).path, "/api/campaign/cards/preview");
  f.requests.at(-1).reject(Error("测试取消")); await flush();
});

test("late reads and previews cannot reopen a closed or superseded window", async () => {
  const f = fixture(); f.controller.open(); const read = f.requests.at(-1); f.controller.close(); read.resolve(baseView); await flush(); assert.equal(f.root.hidden, true);
  await f.batch(); f.select("c0"); f.click({ cmAction: "recycle" }); const oldPreview = f.requests.at(-1);
  f.controller.close(); await f.batch(); f.select("c1"); f.click({ cmAction: "recycle" }); const currentPreview = f.requests.at(-1);
  oldPreview.resolve(quote([cards[0]])); await flush(); assert.equal(f.root.children.length, 0);
  currentPreview.resolve(quote([cards[1]])); await flush(); assert.equal(f.root.children.length, 1);
});

test("account changes discard late mutation results even after returning to the same account", async () => {
  const f = fixture(); await f.batch(); f.select("c0");
  const dialog = await f.preview(); dialog.querySelector("[data-cm-confirm]").fire("click", {}); const mutation = f.requests.at(-1);
  f.store.setState({ playerId: "different", setupComplete: true, wallet: { gold: 42 } });
  f.store.setState({ playerId: "p", setupComplete: true, wallet: { gold: 55 } });
  mutation.resolve({ state: { playerId: "p", wallet: { gold: 1080 } }, view: baseView, result: { amount: 80 } }); await flush();
  assert.equal(f.store.getState().wallet.gold, 55); assert.equal(f.root.hidden, true);
});

test("closing during a mutation still updates its account and reopening waits for fresh state", async () => {
  const f = fixture(); await f.batch(); f.select("c0");
  const dialog = await f.preview(); dialog.querySelector("[data-cm-confirm]").fire("click", {}); const mutation = f.requests.at(-1);
  f.controller.close(); f.controller.open(); const count = f.requests.length;
  f.click({ cmScreen: "recycle" }); assert.equal(f.requests.length, count);
  mutation.resolve({ state: { ...f.store.getState(), wallet: { gold: 1080 } }, view: { ...baseView, cards: cards.slice(1) }, result: { amount: 80 } }); await flush();
  assert.equal(f.store.getState().wallet.gold, 1080);
  assert.equal(f.requests.at(-1).path, "/api/campaign/cards");
  f.requests.at(-1).resolve({ ...baseView, cards: cards.slice(1) }); await flush();
  f.click({ cmScreen: "recycle" }); assert.doesNotMatch(f.root.innerHTML, /data-cm-card="c0"/);
});

test("missing detailed quotes cannot enable a destructive confirmation", async () => {
  const f = fixture(); await f.batch(); f.select("c0");
  await f.preview({ ...quote([cards[0]]), recycle: null });
  assert.equal(f.root.children.length, 0); assert.match(f.toasts.at(-1), /报价信息不完整/); assert.match(f.root.innerHTML, /已选 1 张/);
});

test("render offline fixtures for the menu, collection, selection and quote", async () => {
  const f = fixture(); await f.open();
  const output = process.env.CARD_MANAGEMENT_REVIEW_OUTPUT;
  const shell = content => '<!doctype html><html lang="zh-CN" data-ui-theme="club"><body><main class="map-stage"><section class="card-management-window standard-window">' + content + "</section></main></body></html>";
  const save = (name, content) => { if (output) { mkdirSync(output, { recursive: true }); writeFileSync(output + "/" + name + ".html", shell(content)); } };
  save("menu", f.root.innerHTML);
  f.click({ cmScreen: "recycle" }); save("collection", f.root.innerHTML);
  f.click({ cmAction: "start-batch" }); f.select("c0"); f.select("c1"); save("batch", f.root.innerHTML);
  const dialog = await f.preview(quote([cards[0], cards[1]])); save("confirmation", '<dialog open class="cm-dialog">' + dialog.innerHTML + "</dialog>");
  assert.match(f.root.innerHTML, /已选 2 张/);
  const blocked = fixture({ ...baseView, cards: cards.map(card => ({ ...card, blocked: "球队比赛进行中，结束后才能转出球员卡" })) });
  await blocked.recycle(); save("blocked", blocked.root.innerHTML);
});


const marketView = { ...baseView, maxPrice: 1_000_000_000,
  cards: cards.map((card, index) => ({ ...card, squad: index < 2 ? "expedition" : "garrison", minimumListingPrice: index === 6 ? 1000 : 200 })),
  listings: Array.from({ length: 4 }, (_, i) => ({ id: "listing-" + i, status: "active", createdAt: i + 100,
    price: [200, 400, 500, 2000][i], sellerName: i === 2 ? "我的球队" : "卖家" + i, mine: i === 2, sourceSquad: "expedition",
    card: { ...cards[0], id: "listed-card-" + i, playerId: "listed-card-" + i, name: "市场球员" + i, grade: i === 1 ? "B" : "C" } })) };
function marketFixture(initialView = marketView) {
  const f = fixture(initialView);
  f.market = async () => { await f.open(); f.click({ cmScreen: "sell" }); };
  f.marketFilter = (pane, key, value) => f.root.fire(key === "search" ? "input" : "change", { target: { dataset: { cmmPane: pane, cmmFilter: key }, value, checked: value } });
  f.price = value => { const input = f.root.children[0].querySelector("[data-cmm-price]"); input.value = value; f.root.fire("input", { target: input }); };
  f.pick = id => f.click({ cmmSelect: id });
  f.target = id => f.root.querySelector('[data-cmm-select="' + id + '"]');
  f.quote = (id = "c0", amount = 200, more = {}) => {
    const card = initialView.cards.find(card => card.id === id);
    return { kind: "list", cards: [card], cardIds: [id], quote: "quote-" + id + "-" + amount, amount, minimumPrice: card.minimumListingPrice ?? 200,
      sourceSquad: card.squad ?? "garrison", listingTerms: "terms-" + id, lineupAffected: ["expedition"], ...more };
  };
  f.resolveEditor = async (response = f.quote()) => { f.requests.at(-1).resolve(response); await flush(); return f.root.children[0]; };
  f.editor = async (id = "c0", price) => {
    f.pick(id); f.click({ cmmList: "" }); const dialog = await f.resolveEditor(f.quote(id));
    if (price !== undefined) f.price(price); return dialog;
  };
  f.confirmListing = async (response = f.quote("c0", 750)) => {
    f.root.children[0].querySelector("[data-cm-confirm]").fire("click", {});
    f.requests.at(-1).resolve(response); await flush(); return f.requests.at(-1);
  };
  f.zone = () => { const zone = f.root.querySelector("[data-cmm-dropzone]"); zone.closest = selector => selector === "[data-cmm-dropzone]" ? zone : null; return zone; };
  f.transfer = () => {
    const values = new Map();
    return { setData(key, value) { values.set(key, value); }, getData(key) { return values.get(key) ?? ""; }, clearData() { values.clear(); }, setDragImage(image, x, y) { this.dragImage = { image, x, y }; } };
  };
  f.gesture = (type, target, transfer) => {
    const event = { target, dataTransfer: transfer, clientX: 1100, clientY: 400, prevented: false, preventDefault() { event.prevented = true; }, stopPropagation() {} };
    f.root.fire(type, event); if (type === "dragover") f.root.ownerDocument.fire(type, event); return event;
  };
  return f;
}

test("market filters retain duplicate copies, sort prices and include both squads regardless of recycle prices", () => {
  const state = createMarketState();
  assert.equal(marketEntries(marketView, state, "warehouse").length, 8);
  state.warehouse.squad = "expedition";
  assert.deepEqual(marketEntries(marketView, state, "warehouse").map(card => card.id), ["c0", "c1", "listed-card-2"]);
  state.market.scope = "mine"; assert.deepEqual(marketEntries(marketView, state, "market").map(item => item.id), ["listing-2"]);
  state.market.scope = "all"; state.market.sort = "price-asc";
  assert.deepEqual(marketEntries(marketView, state, "market").map(item => item.price), [200, 400, 500, 2000]);
  state.market.sort = "price-desc";
  assert.deepEqual(marketEntries(marketView, state, "market").map(item => item.price), [2000, 500, 400, 200]);
  state.market.grade = "B"; assert.deepEqual(marketEntries(marketView, state, "market").map(item => item.id), ["listing-1"]);
  state.warehouse.usable = true;
  assert.equal(marketEntries({ ...marketView, cards: marketView.cards.map(card => ({ ...card, recycleValue: 0 })) }, state, "warehouse").length, 2);
  for (const bad of ["", "0", "-1", "1.5", "1e3", "NaN", "1000000001", "99999999999999999999"]) assert.equal(listingPrice(bad), null);
  assert.equal(listingPrice("199", 1000000000, 200), null);
  assert.equal(listingPrice("200", 1000000000, 200), 200);
});

test("market remains left, warehouse right and the price editor is absent from the main page", async () => {
  const f = marketFixture(); await f.market();
  assert.ok(f.root.innerHTML.indexOf('class="cmm-pane cmm-market"') < f.root.innerHTML.indexOf('class="cmm-pane cmm-warehouse"'));
  assert.equal((f.root.innerHTML.match(/data-cmm-select=/g) ?? []).length, 7);
  assert.equal((f.root.innerHTML.match(/draggable="true" title="双击挂牌/g) ?? []).length, 6);
  assert.match(f.root.innerHTML, /data-cmm-select="c5"[^>]*draggable="false"[^>]*disabled/);
  assert.match(f.root.innerHTML, /data-cmm-buy="listing-3" disabled>金币不足/);
  assert.doesNotMatch(f.root.innerHTML, /data-cmm-price|cmm-order|上一页|下一页|全部评级/);
  f.click({ cmmDetail: "listing-0", cmmPane: "market" });
  assert.match(f.root.children[0].innerHTML, /市场球员0/);
});

test("single click preserves the card node so the following double click opens exactly one price editor", async () => {
  const f = marketFixture(); await f.market(); const target = f.target("c0");
  f.pick("c0"); f.pick("c0");
  assert.equal(f.target("c0"), target);
  assert.equal(target.getAttribute("aria-pressed"), "true");
  assert.equal(target.querySelector("[data-cmm-selection]").hidden, false);
  assert.equal(f.requests.length, 1);
  f.gesture("dblclick", target); const request = f.requests.at(-1);
  assert.deepEqual(request.options.body, { kind: "list", cardIds: ["c0"] });
  f.gesture("dblclick", target); assert.equal(f.requests.at(-1), request);
  const dialog = await f.resolveEditor();
  assert.match(dialog.innerHTML, /data-cmm-price/);
  assert.match(dialog.innerHTML, /最低限价/);
  assert.equal(dialog.querySelector("[data-cmm-price]").value, "200");
  assert.equal(dialog.querySelector("[data-cm-confirm]").disabled, false);
});

test("dragging a warehouse card to the market opens its editor and clears the drag state", async () => {
  const f = marketFixture(); await f.market(); const target = f.target("c1"), zone = f.zone(), transfer = f.transfer();
  f.gesture("dragstart", target, transfer);
  assert.equal(f.target("c1"), target);
  assert.equal(transfer.getData("application/x-yellowdogs-player-card"), "c1");
  assert.equal(transfer.effectAllowed, "move");
  const document = f.root.ownerDocument, [ghost, nativeImage] = document.body.children;
  assert.equal(ghost.className, "cmm-drag-preview");
  assert.equal(ghost.getAttribute("aria-hidden"), "true");
  assert.equal(ghost.style.width, "180px");
  assert.equal(ghost.style.transform, "translate3d(1000px,300px,0)");
  assert.equal((ghost.innerHTML.match(/data-player-card-id=/g) ?? []).length, 1);
  assert.match(ghost.innerHTML, /data-player-card-id="c1"/);
  assert.doesNotMatch(ghost.innerHTML, /cm-selection-mark|cmm-card-name|data-cmm-select|data-player-card-id="c0"/);
  assert.equal(nativeImage.tagName, "CANVAS");
  assert.deepEqual([nativeImage.width, nativeImage.height], [1, 1]);
  assert.deepEqual(transfer.dragImage, { image: nativeImage, x: 0, y: 0 });
  document.fire("dragover", { clientX: 500, clientY: 600 });
  assert.equal(ghost.style.transform, "translate3d(400px,500px,0)");
  assert.equal(target.classList.contains("is-dragging"), true);
  assert.equal(f.gesture("dragover", zone, transfer).prevented, true);
  assert.equal(zone.classList.contains("is-drag-over"), true);
  const child = { parent: zone, closest: () => zone };
  f.root.fire("dragleave", { target: child, relatedTarget: zone });
  assert.equal(zone.classList.contains("is-drag-over"), true, "moving between children does not flicker the drop target");
  f.gesture("drop", zone, transfer);
  assert.equal(zone.classList.contains("is-drag-over"), false);
  assert.equal(document.body.children.length, 0);
  assert.equal(target.classList.contains("is-dragging"), false);
  assert.deepEqual(f.requests.at(-1).options.body, { kind: "list", cardIds: ["c1"] });
  const dialog = await f.resolveEditor(f.quote("c1"));
  assert.match(dialog.innerHTML, /同名球员/);
  assert.equal(f.requests.length, 2, "dropping never directly lists the card");
});

test("blocked cards, external drops, mismatched payloads and cancelled drags cannot list cards", async () => {
  const f = marketFixture(); await f.market(); const blocked = f.target("c5"), zone = f.zone(), external = f.transfer();
  assert.equal(f.gesture("dragstart", blocked, external).prevented, true);
  f.gesture("dblclick", blocked); assert.equal(f.requests.length, 1);
  external.setData("application/x-yellowdogs-player-card", "c0"); f.gesture("drop", zone, external);
  assert.equal(f.requests.length, 1, "external data cannot impersonate a drag originating in this warehouse");
  const transfer = f.transfer(); f.gesture("dragstart", f.target("c0"), transfer); transfer.setData("application/x-yellowdogs-player-card", "c1");
  f.gesture("drop", zone, transfer); assert.equal(f.requests.length, 1);
  f.gesture("dragstart", f.target("c0"), transfer); f.gesture("dragover", zone, transfer); f.gesture("dragend", f.target("c0"), transfer);
  assert.equal(zone.classList.contains("is-drag-over"), false);
  f.gesture("drop", zone, transfer); assert.equal(f.requests.length, 1);
});

test("selection and a cancelled editor's price survive independent filters and scrolling", async () => {
  const f = marketFixture(); await f.market(); const dialog = await f.editor("c0", "750");
  dialog.querySelector("[data-cm-dialog-close]").onclick();
  const warehouse = f.root.querySelector('[data-cmm-scroll="warehouse"]'); warehouse.scrollTop = 321;
  f.marketFilter("market", "grade", "B");
  assert.equal(f.root.querySelector('[data-cmm-scroll="warehouse"]').scrollTop, 321);
  f.marketFilter("warehouse", "search", "无匹配"); assert.doesNotMatch(f.root.innerHTML, /data-cmm-select=/);
  f.click({ cmmReset: "warehouse" });
  assert.match(f.root.innerHTML, /data-cmm-select="c0" aria-pressed="true"/);
  assert.doesNotMatch(f.root.innerHTML, /data-cmm-buy="listing-0"/);
  f.click({ cmScreen: "home" }); f.click({ cmScreen: "sell" });
  const reopened = await f.editor("c0");
  assert.equal(reopened.querySelector("[data-cmm-price]").value, "750");
  reopened.querySelector("[data-cm-dialog-close]").onclick();
  const changed = await f.editor("c1");
  assert.equal(changed.querySelector("[data-cmm-price]").value, "200", "a different card starts at its own minimum");
});

test("each market pane appends on scroll without replacing existing card nodes", async () => {
  const many = Array.from({ length: 55 }, (_, i) => ({ ...marketView.cards[0], id: "m" + String(i).padStart(2, "0"), playerId: "m" + i }));
  const listings = many.map((card, i) => ({ ...marketView.listings[0], id: "sale" + i, card, createdAt: 100 - i }));
  const f = marketFixture({ ...marketView, cards: many, listings }); await f.market(); f.pick("m00");
  for (const pane of ["market", "warehouse"]) {
    const container = f.root.querySelector('[data-cmm-scroll="' + pane + '"]'), grid = f.root.querySelector('[data-cmm-grid="' + pane + '"]');
    container.clientHeight = 600; container.scrollTop = 1400; container.scrollHeight = 2000;
    grid.afterInsert = () => { container.scrollHeight += 1000; };
    container.fire("scroll", {}); await flush();
    assert.equal(f.root.querySelector('[data-cmm-grid="' + pane + '"]'), grid);
    assert.equal((grid.innerHTML.match(pane === "warehouse" ? /data-cmm-select=/g : /data-cmm-buy=/g) ?? []).length, 24);
    assert.equal(container.scrollTop, 1400);
  }
  f.marketFilter("market", "grade", "B");
  assert.match(f.root.innerHTML, /data-cmm-select="m00" aria-pressed="true"/);
});

test("the floating editor enforces its authoritative minimum and supports Enter to confirm", async () => {
  const f = marketFixture(); await f.market(); const dialog = await f.editor();
  assert.match(dialog.innerHTML, /撤回后返回远征编队/);
  for (const bad of ["0", "199", "-5", "1.5", "1000000001", "1e3", ""]) {
    f.price(bad); assert.equal(dialog.querySelector("[data-cm-confirm]").disabled, true);
    dialog.querySelector("[data-cm-confirm]").fire("click", {}); assert.equal(f.requests.length, 2);
  }
  f.price("750"); assert.equal(dialog.querySelector("[data-cm-dialog-error]").textContent, "");
  dialog.querySelector("[data-cmm-price]").fire("keydown", { key: "Enter", preventDefault() {} });
  assert.deepEqual(f.requests.at(-1).options.body, { kind: "list", cardIds: ["c0"], price: 750 });
  f.requests.at(-1).reject(Error("测试取消")); await flush();
});

test("confirming previews the entered price then lists once; an uncertain write retries its original receipt", async () => {
  const f = marketFixture(); await f.market(); const dialog = await f.editor("c0", "750");
  const confirm = dialog.querySelector("[data-cm-confirm]"); confirm.fire("click", {});
  const preview = f.requests.at(-1); confirm.fire("click", {}); assert.equal(f.requests.at(-1), preview);
  preview.resolve(f.quote("c0", 750)); await flush(); const first = f.requests.at(-1);
  assert.equal(first.path, "/api/campaign/cards/list"); assert.equal(first.options.body.price, 750);
  assert.equal(first.options.body.quote, "quote-c0-750"); assert.equal(dialog.querySelector("[data-cmm-price]").disabled, true);
  first.reject(Error("连接中断")); await flush();
  assert.equal(dialog.querySelector("[data-cm-dialog-error]").textContent, "连接中断");
  confirm.fire("click", {}); const retry = f.requests.at(-1);
  assert.equal(retry.path, "/api/campaign/cards/list", "retry does not try to preview an already escrowed card");
  assert.equal(retry.options.body.requestId, first.options.body.requestId);
  const nextView = { ...marketView, cards: marketView.cards.filter(card => card.id !== "c0"), listings: [...marketView.listings, { ...marketView.listings[2], id: "new-listing", card: marketView.cards[0], price: 750 }] };
  retry.resolve({ state: { ...f.store.getState(), draft: { roster: nextView.cards } }, view: nextView, result: { kind: "list" } }); await flush();
  assert.equal(f.root.children.length, 0); assert.doesNotMatch(f.root.innerHTML, /data-cmm-select="c0"|data-cmm-price/);
  assert.match(f.root.innerHTML, /data-cmm-cancel="new-listing"/);
  assert.equal((f.root.innerHTML.match(/class="cmm-listed-badge"/g) ?? []).length, 2);
  assert.equal(f.toasts.at(-1), "挂牌成功");
});

test("changed listing terms refresh the editor and require another confirmation before any write", async () => {
  const f = marketFixture(); await f.market(); const dialog = await f.editor("c0", "750");
  dialog.querySelector("[data-cm-confirm]").fire("click", {});
  f.requests.at(-1).resolve(f.quote("c0", 750, { minimumPrice: 500, listingTerms: "terms-changed", sourceSquad: "garrison" })); await flush();
  assert.equal(f.requests.at(-1).path, "/api/campaign/cards/preview");
  assert.match(dialog.querySelector("[data-cm-dialog-error]").textContent, /核对后再次确认/);
  assert.match(dialog.querySelector(".cm-dialog-body").innerHTML, /返回留守编队/);
  const write = await f.confirmListing(f.quote("c0", 750, { minimumPrice: 500, listingTerms: "terms-changed", sourceSquad: "garrison" }));
  assert.equal(write.path, "/api/campaign/cards/list");
  write.reject(Error("测试取消")); await flush();
});

test("missing floors and mismatched price responses cannot create a listing", async () => {
  const f = marketFixture(); await f.market(); f.pick("c0"); f.click({ cmmList: "" });
  await f.resolveEditor(f.quote("c0", 200, { minimumPrice: undefined }));
  assert.equal(f.root.children.length, 0); assert.match(f.toasts.at(-1), /重启服务/);
  const dialog = await f.editor("c0", "750");
  dialog.querySelector("[data-cm-confirm]").fire("click", {});
  f.requests.at(-1).resolve(f.quote("c0", 749)); await flush();
  assert.match(dialog.querySelector("[data-cm-dialog-error]").textContent, /报价已变化/);
  assert.equal(f.requests.at(-1).path, "/api/campaign/cards/preview");
});

test("buy and cancel keep explicit confirmations, exact prices, retries and the correct return squad", async () => {
  for (const kind of ["buy", "cancel"]) {
    const f = marketFixture(); await f.market(); const listing = marketView.listings[kind === "buy" ? 0 : 2];
    f.click(kind === "buy" ? { cmmBuy: listing.id } : { cmmCancel: listing.id }); const dialog = f.root.children[0];
    assert.doesNotMatch(dialog.innerHTML, /data-cmm-price/);
    assert.match(dialog.innerHTML, kind === "buy" ? /加入留守编队/ : /返回远征编队/);
    dialog.querySelector("[data-cm-confirm]").fire("click", {}); const req = f.requests.at(-1);
    assert.equal(req.path, "/api/campaign/cards/" + kind);
    assert.equal(req.options.body.expectedPrice, kind === "buy" ? listing.price : undefined);
    req.reject(Error("网络超时")); await flush(); dialog.querySelector("[data-cm-confirm]").fire("click", {});
    assert.equal(f.requests.at(-1).options.body.requestId, req.options.body.requestId);
    const nextView = { ...marketView, listings: marketView.listings.filter(item => item.id !== listing.id) };
    f.requests.at(-1).resolve({ state: f.store.getState(), view: nextView, result: { amount: listing.price, squad: "expedition" } }); await flush();
    assert.match(f.toasts.at(-1), kind === "buy" ? /留守编队/ : /远征编队/);
  }
});

test("own purchases, unauthorized cancellations and insufficient gold remain blocked", async () => {
  const f = marketFixture(); await f.market();
  f.click({ cmmBuy: "listing-2" }); f.click({ cmmCancel: "listing-0" }); f.click({ cmmBuy: "listing-3" });
  assert.equal(f.root.children.length, 0); assert.equal(f.requests.length, 1);
  f.click({ cmmBuy: "listing-0" }); const dialog = f.root.children[0]; dialog.querySelector("[data-cm-confirm]").fire("click", {});
  f.requests.at(-1).reject(Error("球员卡已被购买或下架，请刷新市场")); await flush();
  assert.match(dialog.querySelector("[data-cm-dialog-error]").textContent, /已被购买/);
  assert.equal(f.store.getState().wallet.gold, 1000);
});

test("refresh invalidates an unavailable selection and shows a shared restriction once", async () => {
  const f = marketFixture(); await f.market(); f.pick("c0"); f.click({ cmAction: "refresh" });
  f.requests.at(-1).resolve({ ...marketView, cards: marketView.cards.map(card => ({ ...card, blocked: "球队比赛进行中，结束后才能转出球员卡" })) }); await flush();
  assert.doesNotMatch(f.root.innerHTML, /data-cmm-select="[^"]+" aria-pressed="true"/);
  assert.equal((f.root.innerHTML.match(/class="cmm-restriction"/g) ?? []).length, 1);
  assert.match(f.toasts.at(-1), /不再可挂牌/);
});

test("late gesture previews and mutations cannot reopen a closed page or alter a different account", async () => {
  const f = marketFixture(); await f.market(); f.gesture("dblclick", f.target("c0"));
  const old = f.requests.at(-1); f.controller.close(); old.resolve(f.quote()); await flush(); assert.equal(f.root.children.length, 0);
  await f.market(); await f.editor("c0", "750"); const mutation = await f.confirmListing();
  f.store.setState({ ...f.store.getState(), playerId: "other-account" });
  f.store.setState({ ...f.store.getState(), playerId: "p", wallet: { gold: 123 } });
  mutation.resolve({ state: { ...f.store.getState(), wallet: { gold: 800 } }, view: marketView, result: { amount: 750 } }); await flush();
  assert.equal(f.store.getState().wallet.gold, 123); assert.equal(f.root.hidden, true);
});

test("listing removes only that card from an earlier recycle selection", async () => {
  const f = marketFixture(); await f.batch(); f.select("c0"); f.select("c1"); f.click({ cmScreen: "home" }); f.click({ cmScreen: "sell" });
  await f.editor("c0", "750"); const write = await f.confirmListing();
  const nextView = { ...marketView, cards: marketView.cards.filter(card => card.id !== "c0") };
  write.resolve({ state: { ...f.store.getState(), draft: { roster: nextView.cards } }, view: nextView, result: { kind: "list" } }); await flush();
  f.click({ cmScreen: "home" }); f.click({ cmScreen: "recycle" });
  assert.match(f.root.innerHTML, /已选 1 张/); assert.match(f.root.innerHTML, /data-cm-card="c1"[^>]*aria-pressed="true"/);
  f.click({ cmAction: "recycle" }); assert.deepEqual(f.requests.at(-1).options.body.cardIds, ["c1"]);
  f.requests.at(-1).reject(Error("测试取消")); await flush();
});

test("market fixtures cover floating pricing and a transient drag target using production markup", async () => {
  const output = process.env.CARD_MANAGEMENT_REVIEW_OUTPUT;
  const save = (name, html) => { if (output) { mkdirSync(output, { recursive: true }); writeFileSync(output + "/" + name + ".html", '<!doctype html><html lang="zh-CN" data-ui-theme="club"><body><main class="map-stage"><section class="card-management-window standard-window">' + html + '</section></main></body></html>'); } };
  const f = marketFixture(); await f.market(); save("market", f.root.innerHTML);
  f.pick("c0"); f.marketFilter("warehouse", "squad", "expedition"); save("market-selected", f.root.innerHTML);
  const transfer = f.transfer(); f.gesture("dragstart", f.target("c0"), transfer);
  const ghost = f.root.ownerDocument.body.children[0];
  save("market-drag", f.root.innerHTML.replace('cmm-pane cmm-market"', 'cmm-pane cmm-market is-drag-over"') + '<div class="' + ghost.className + '">' + ghost.innerHTML + '</div>');
  f.gesture("dragend", f.target("c0"), transfer);
  const dialog = await f.editor("c0", "750"); save("market-confirmation", '<dialog open class="' + dialog.className + '">' + dialog.innerHTML + '</dialog>');
  const empty = marketFixture({ ...marketView, cards: [], listings: [] }); await empty.market(); save("market-empty", empty.root.innerHTML);
  assert.match(empty.root.innerHTML, /市场暂无挂牌/);
});

test("warehouse keeps only own active escrow instances, with original squads and no roster mutation", () => {
  const view = structuredClone(marketView), own = view.listings[2];
  view.cards.push({ ...own.card, squad: "garrison" }); // Overlapping snapshots must prefer escrow.
  view.listings.push(
    { ...own, id: "cancelled", status: "cancelled", card: { ...own.card, id: "cancelled-card" } },
    { ...own, id: "sold", status: "sold", card: { ...own.card, id: "sold-card" } },
    { ...own, id: "legacy", sourceSquad: undefined, card: { ...own.card, id: "legacy-card" } });
  const snapshot = structuredClone(view), result = warehouseCards(view);
  assert.equal(result.length, 9);
  assert.equal(result.filter(card => card.id === own.card.id).length, 1);
  assert.equal(result.find(card => card.id === own.card.id).squad, "expedition");
  assert.equal(result.find(card => card.id === "legacy-card").squad, "garrison");
  assert.equal(result.filter(card => card.listingId).length, 2);
  assert.deepEqual(result.filter(card => card.cardDefinitionId === "same-player" && !card.listingId).map(card => card.id), ["c0", "c1"]);
  assert.deepEqual(view, snapshot, "the display merge never reintroduces escrow to the playable roster");
  assert.equal(warehouseCards({ ...view, cards: [] }).length, 2);
});

test("listed warehouse cards show a badge and details but cannot be selected, dragged or double-clicked to relist", async () => {
  const own = marketView.listings[2], f = marketFixture(); await f.market();
  const warehouse = f.root.innerHTML.split('class="cmm-pane cmm-warehouse"')[1];
  assert.match(warehouse, /class="cmm-count">8</);
  assert.match(warehouse, /class="cm-card cmm-card is-listed"/);
  assert.match(warehouse, /class="cmm-listed-badge">已挂牌</);
  assert.match(warehouse, /data-cmm-detail="listed-card-2" data-cmm-pane="warehouse" aria-haspopup="dialog" draggable="false"/);
  assert.doesNotMatch(warehouse, /data-cmm-select="listed-card-2"/);
  const forged = node(f.root.ownerDocument); forged.dataset.cmmSelect = own.card.id;
  f.pick(own.card.id); f.gesture("dblclick", forged);
  assert.equal(f.gesture("dragstart", forged, f.transfer()).prevented, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.root.ownerDocument.body.children.length, 0);
  f.click({ cmmDetail: own.card.id, cmmPane: "warehouse" });
  assert.match(f.root.children[0].innerHTML, /市场球员2/);
  f.root.children[0].querySelector("[data-cm-dialog-close]").onclick();
  f.marketFilter("warehouse", "usable", true);
  assert.doesNotMatch(f.root.innerHTML, /cmm-listed-badge/);
  f.click({ cmmReset: "warehouse" }); f.marketFilter("warehouse", "search", "市场球员2");
  assert.match(f.root.innerHTML, /cmm-listed-badge/);
});

test("cancellation restores a single selectable card to its original squad and sale refresh removes it", async () => {
  const own = marketView.listings[2], f = marketFixture(); await f.market();
  f.click({ cmmCancel: own.id }); f.root.children[0].querySelector("[data-cm-confirm]").fire("click", {});
  const restored = { ...own.card, squad: own.sourceSquad, blocked: null };
  const nextView = { ...marketView, cards: [...marketView.cards, restored], listings: marketView.listings.filter(item => item.id !== own.id) };
  f.requests.at(-1).resolve({ state: f.store.getState(), view: nextView, result: { squad: own.sourceSquad } }); await flush();
  f.marketFilter("warehouse", "squad", "expedition");
  assert.equal((f.root.innerHTML.match(/data-cmm-select="listed-card-2"/g) ?? []).length, 1);
  assert.doesNotMatch(f.root.innerHTML, /cmm-listed-badge/);
  const seller = marketFixture(); await seller.market(); seller.click({ cmAction: "refresh" });
  seller.requests.at(-1).resolve({ ...marketView, listings: marketView.listings.filter(item => item.id !== own.id) }); await flush();
  assert.doesNotMatch(seller.root.innerHTML, /listed-card-2|cmm-listed-badge/);
  assert.equal(seller.store.getState().draft.roster.length, 7);
});

test("drag previews are removed after cancellation, refresh, close and account changes", async () => {
  for (const end of ["cancel", "refresh", "close", "account"]) {
    const f = marketFixture(); await f.market(); const target = f.target("c0"), zone = f.zone(), transfer = f.transfer();
    f.gesture("dragstart", target, transfer); f.gesture("dragover", zone, transfer);
    assert.equal(f.root.ownerDocument.body.children.length, 2);
    if (end === "cancel") f.gesture("dragend", target, transfer);
    if (end === "refresh") { f.click({ cmAction: "refresh" }); f.requests.at(-1).resolve(marketView); await flush(); }
    if (end === "close") f.controller.close();
    if (end === "account") f.store.setState({ ...f.store.getState(), playerId: "different" });
    assert.equal(f.root.ownerDocument.body.children.length, 0, end);
    assert.equal(zone.classList.contains("is-drag-over"), false, end);
    const requests = f.requests.length; f.gesture("drop", zone, transfer);
    assert.equal(f.requests.length, requests, "stale drop must not start a listing");
  }
});

const tradeView = { ...marketView, cards: [
  ...marketView.cards,
  ...Array.from({ length: 2 }, (_, i) => ({ ...marketView.cards[0], id: "extra-c" + i, playerId: "extra-c" + i })),
  ...["B", "A"].flatMap(grade => Array.from({ length: 5 }, (_, i) => ({ ...marketView.cards[0], id: grade + i, playerId: grade + i, grade }))),
  ...["S", "X"].map(grade => ({ ...marketView.cards[0], id: grade, playerId: grade, grade })),
  { ...marketView.cards[0], id: "locked", blocked: "球员卡已锁定" },
] };
function tradeFixture(initialView = tradeView) {
  const f = fixture(initialView);
  f.trade = async () => { await f.open(); f.click({ cmScreen: "trade-up" }); };
  f.pickMaterial = id => f.click({ cmuSelect: id });
  f.five = (ids = ["c0", "c1", "c2", "c3", "c4"]) => ids.forEach(f.pickMaterial);
  f.tradeFilter = (key, value) => f.root.fire(key === "search" ? "input" : "change", { target: { dataset: { cmuFilter: key }, value, checked: value } });
  f.tradeQuote = (ids = ["c0", "c1", "c2", "c3", "c4"], more = {}) => {
    const selected = ids.map(id => initialView.cards.find(card => card.id === id)), targetGrade = { C: "B", B: "A", A: "S" }[selected[0].grade];
    return { kind: "trade-up", quote: "trade-quote-" + ids.join("-"), cards: selected, cardIds: ids, targetGrade, amount: 0, lineupAffected: ["expedition"],
      candidates: Array.from({ length: 3 }, (_, i) => ({ ...cards[6], id: "candidate" + i, cardDefinitionId: "candidate" + i, name: "候选球员" + i, grade: targetGrade })), ...more };
  };
  f.previewTrade = async (value = f.tradeQuote()) => {
    f.click({ cmuAction: "preview" }); f.requests.at(-1).resolve(value); await flush(); return f.root.children[0];
  };
  return f;
}

test("trade-up opens a five-slot contract and a separate warehouse without redundant help text", async () => {
  const f = tradeFixture(); await f.trade();
  assert.match(f.root.innerHTML, /<h2 id="cm-title">汰换<\/h2>/);
  assert.ok(f.root.innerHTML.indexOf('cmu-contract"') < f.root.innerHTML.indexOf('cmu-warehouse"'));
  assert.equal((f.root.innerHTML.match(/class="cmu-slot-empty"/g) ?? []).length, 5);
  assert.match(f.root.innerHTML, /data-cmu-action="preview" disabled/);
  assert.doesNotMatch(f.root.innerHTML, /上一页|下一页|全部评级|cmu-rule|cmu-pool-rule|点击.*开始|素材国家或俱乐部池内/);
  assert.doesNotMatch(f.root.innerHTML, /data-cmu-select="S"|data-cmu-select="X"|<option value="S"|<option value="X"/);
  assert.match(f.root.innerHTML, /data-cmu-select="listed-card-2"[^>]*disabled/);
  assert.match(f.root.innerHTML, /cmm-listed-badge">已挂牌/);
  f.click({ cmuDetail: "c0" }); assert.match(f.root.children[0].innerHTML, /同名球员/);
});

test("trade-up selects exactly five independent same-grade instances and accepts all three upgrade paths", async () => {
  for (const grade of ["C", "B", "A"]) {
    const f = tradeFixture(); await f.trade();
    const ids = grade === "C" ? ["c0", "c1", "c2", "c3", "c4"] : Array.from({ length: 5 }, (_, i) => grade + i);
    f.pickMaterial(ids[0]); f.pickMaterial(grade === "C" ? "B0" : "c0");
    assert.match(f.toasts.at(-1), /需.*级素材/);
    ids.slice(1).forEach(f.pickMaterial);
    assert.match(f.root.innerHTML, /5 \/ 5/);
    assert.equal((f.root.innerHTML.match(/data-cmu-remove=/g) ?? []).length, 5);
    f.pickMaterial(grade === "C" ? "extra-c0" : grade === "B" ? "c6" : "extra-c0");
    assert.equal((f.root.innerHTML.match(/data-cmu-remove=/g) ?? []).length, 5);
    const dialog = await f.previewTrade(f.tradeQuote(ids));
    assert.match(dialog.innerHTML, new RegExp("5 张 " + grade + " 级 → 1 张 " + { C: "B", B: "A", A: "S" }[grade] + " 级"));
    assert.match(dialog.innerHTML, /强化 \+0 · 无训练成长 · 加入留守编队/);
    assert.match(dialog.innerHTML, /每位概率 1 \/ 3/);
    assert.equal(f.requests.at(-1).path, "/api/campaign/cards/preview");
    assert.deepEqual(f.requests.at(-1).options.body, { kind: "trade-up", cardIds: ids });
    dialog.querySelector("[data-cm-dialog-close]").onclick();
    f.click({ cmuRemove: ids[0] }); assert.match(f.root.innerHTML, /4 \/ 5/);
    f.click({ cmuAction: "clear" }); assert.match(f.root.innerHTML, /0 \/ 5/);
  }
});

test("trade-up filters and scroll preserve materials across menu visits and do not depend on recycle prices", async () => {
  const f = tradeFixture({ ...tradeView, cards: tradeView.cards.map(card => ({ ...card, recycleValue: 0 })) }); await f.trade();
  f.pickMaterial("c0"); f.pickMaterial("c1");
  const scroll = f.root.querySelector("[data-cmu-scroll]"); scroll.scrollTop = 275;
  f.pickMaterial("c2"); assert.equal(f.root.querySelector("[data-cmu-scroll]").scrollTop, 275);
  f.tradeFilter("search", "没有匹配"); assert.match(f.root.innerHTML, /3 \/ 5/); assert.doesNotMatch(f.root.innerHTML, /data-cmu-select=/);
  f.click({ cmuAction: "reset" }); assert.match(f.root.innerHTML, /data-cmu-select="c0" aria-pressed="true"/);
  f.tradeFilter("squad", "garrison"); f.pickMaterial("c3"); f.pickMaterial("c4");
  f.click({ cmScreen: "home" }); f.click({ cmScreen: "trade-up" }); assert.match(f.root.innerHTML, /5 \/ 5/);
  assert.deepEqual(f.store.getState().draft.roster.map(card => card.id), tradeView.cards.map(card => card.id));
});

test("listed, training, locked and legendary cards cannot enter a contract even through forged clicks", async () => {
  const f = tradeFixture(); await f.trade();
  for (const id of ["listed-card-2", "c5", "locked", "S", "X", "missing"]) {
    f.pickMaterial(id); assert.match(f.root.innerHTML, /0 \/ 5/);
  }
  f.click({ cmuAction: "preview" }); assert.equal(f.requests.length, 1);
  f.tradeFilter("usable", true);
  for (const id of ["listed-card-2", "c5", "locked", "S", "X"]) assert.doesNotMatch(f.root.innerHTML, new RegExp('data-cmu-select="' + id + '"'));
  f.five();
  f.click({ cmAction: "refresh" });
  f.requests.at(-1).resolve({ ...tradeView, cards: tradeView.cards.map(card => card.id === "c0" ? { ...card, blocked: "训练中" } : card).filter(card => card.id !== "c1") }); await flush();
  assert.match(f.root.innerHTML, /3 \/ 5/); assert.match(f.toasts.at(-1), /已移出合同/);
  assert.doesNotMatch(f.root.innerHTML, /data-cmu-remove="c0"|data-cmu-remove="c1"/);
});

test("warehouse and candidate pool append on scroll without replacing existing nodes", async () => {
  const many = Array.from({ length: 65 }, (_, i) => ({ ...cards[0], id: "m" + i, playerId: "m" + i }));
  const f = tradeFixture({ ...tradeView, cards: many }); await f.trade();
  const container = f.root.querySelector("[data-cmu-scroll]"), grid = f.root.querySelector("[data-cmu-grid]");
  container.clientHeight = 600; container.scrollTop = 1400; container.scrollHeight = 2000;
  grid.afterInsert = () => { container.scrollHeight += 1000; }; container.fire("scroll", {}); await flush();
  assert.equal(f.root.querySelector("[data-cmu-grid]"), grid);
  assert.equal((grid.innerHTML.match(/data-cmu-select=/g) ?? []).length, 24);
  assert.equal(container.scrollTop, 1400);
  const ids = ["m0", "m1", "m2", "m3", "m4"]; f.five(ids);
  const quote = f.tradeQuote(ids, { candidates: many.map(card => ({ ...card, grade: "B" })) });
  const dialog = await f.previewTrade(quote), pool = dialog.querySelector("[data-cmu-pool-scroll]"), poolGrid = dialog.querySelector("[data-cmu-pool-grid]");
  pool.clientHeight = 340; pool.scrollHeight = 1500; pool.scrollTop = 1160;
  poolGrid.afterInsert = () => { pool.scrollHeight += 1000; }; pool.fire("scroll", {}); await flush();
  assert.equal(dialog.querySelector("[data-cmu-pool-grid]"), poolGrid);
  assert.equal((poolGrid.innerHTML.match(/cmu-candidate/g) ?? []).length, 24);
  const html = poolGrid.innerHTML; dialog.querySelector("[data-cm-dialog-close]").onclick();
  pool.scrollTop = 2500; pool.fire("scroll", {}); await flush(); assert.equal(poolGrid.innerHTML, html);
});

test("empty pools and invalid quotes preserve all materials without enabling a destructive confirmation", async () => {
  const f = tradeFixture(); await f.trade(); f.five(); f.click({ cmuAction: "preview" });
  f.requests.at(-1).reject(Error("这些素材的国家／俱乐部池中没有高一级球员，请更换素材")); await flush();
  assert.equal(f.root.children.length, 0); assert.match(f.root.innerHTML, /5 \/ 5/); assert.match(f.root.innerHTML, /没有高一级球员/);
  for (const change of [{ candidates: [] }, { targetGrade: "S" }, { cardIds: ["c0", "c0", "c2", "c3", "c4"] }, { cards: [] }, { quote: "" }]) {
    await f.previewTrade(f.tradeQuote(undefined, change)); assert.equal(f.root.children.length, 0);
    assert.match(f.root.innerHTML, /5 \/ 5/); assert.match(f.toasts.at(-1), /预览已变化/);
  }
});

test("trade-up confirmation submits once, retries the same receipt and shows the acquired card", async () => {
  const f = tradeFixture(); await f.trade(); f.five();
  const dialog = await f.previewTrade(), confirm = dialog.querySelector("[data-cm-confirm]");
  assert.equal(f.store.getState().draft.roster.length, tradeView.cards.length);
  confirm.fire("click", {}); const first = f.requests.at(-1);
  confirm.fire("click", {}); assert.equal(f.requests.at(-1), first);
  assert.equal(first.path, "/api/campaign/cards/trade-up");
  assert.equal(first.options.body.quote, f.tradeQuote().quote);
  first.reject(Error("网络连接中断")); await flush();
  assert.match(dialog.querySelector("[data-cm-dialog-error]").textContent, /网络连接中断/);
  confirm.fire("click", {}); const retry = f.requests.at(-1);
  assert.equal(retry.options.body.requestId, first.options.body.requestId);
  const resultCard = { ...cards[6], id: "trade-result", playerId: "trade-result", name: "汰换新球员", squad: "garrison", blocked: null };
  const nextView = { ...tradeView, cards: [...tradeView.cards.filter(card => !f.tradeQuote().cardIds.includes(card.id)), resultCard] };
  retry.resolve({ state: { ...f.store.getState(), draft: { roster: nextView.cards } }, view: nextView, result: { kind: "trade-up", card: resultCard } }); await flush();
  assert.match(f.root.children[0].innerHTML, /汰换完成/); assert.match(f.root.children[0].innerHTML, /汰换新球员/);
  assert.match(f.root.children[0].innerHTML, /已加入留守编队/); assert.equal(f.store.getState().wallet.gold, 1000);
  f.root.children[0].querySelector("[data-cm-dialog-close]").onclick();
  assert.match(f.root.innerHTML, /0 \/ 5/); assert.doesNotMatch(f.root.innerHTML, /data-cmu-select="c0"/);
});

test("changed pools allow explicit re-preview while keeping selected instances", async () => {
  const f = tradeFixture(); await f.trade(); f.five(); const dialog = await f.previewTrade();
  dialog.querySelector("[data-cm-confirm]").fire("click", {}); f.requests.at(-1).reject(Error("卡片、阵容或价格已变化，请重新预览后确认")); await flush();
  f.click({ cmuAction: "requote" });
  assert.equal(f.requests.at(-1).path, "/api/campaign/cards/preview");
  f.requests.at(-1).resolve(f.tradeQuote(undefined, { quote: "new-pool-quote" })); await flush();
  f.root.children[0].querySelector("[data-cm-confirm]").fire("click", {});
  assert.equal(f.requests.at(-1).options.body.quote, "new-pool-quote");
  f.requests.at(-1).reject(Error("测试结束")); await flush();
});

test("late trade-up previews and results cannot reopen a closed window or alter another account", async () => {
  const f = tradeFixture(); await f.trade(); f.five(); f.click({ cmuAction: "preview" }); const preview = f.requests.at(-1);
  f.controller.close(); preview.resolve(f.tradeQuote()); await flush(); assert.equal(f.root.children.length, 0);
  await f.trade(); f.five(); const dialog = await f.previewTrade(); dialog.querySelector("[data-cm-confirm]").fire("click", {});
  const mutation = f.requests.at(-1); f.store.setState({ ...f.store.getState(), playerId: "other-account", wallet: { gold: 42 } });
  mutation.resolve({ state: { ...f.store.getState(), playerId: "p", wallet: { gold: 1000 } }, view: tradeView, result: { card: cards[6] } }); await flush();
  assert.equal(f.root.hidden, true); assert.equal(f.root.children.length, 0); assert.equal(f.store.getState().wallet.gold, 42);
});

test("trade-up fixtures cover empty, partial, full, filtered, confirmation and acquired-card states", async () => {
  const output = process.env.CARD_MANAGEMENT_REVIEW_OUTPUT;
  const save = (name, html) => { if (output) { mkdirSync(output, { recursive: true }); writeFileSync(output + "/" + name + ".html", '<!doctype html><html lang="zh-CN" data-ui-theme="club"><body><main class="map-stage"><section class="card-management-window standard-window">' + html + '</section></main></body></html>'); } };
  const f = tradeFixture(); await f.trade(); save("trade-up", f.root.innerHTML);
  f.pickMaterial("c0"); f.pickMaterial("c1"); save("trade-up-partial", f.root.innerHTML);
  ["c2", "c3", "c4"].forEach(f.pickMaterial); save("trade-up-full", f.root.innerHTML);
  f.tradeFilter("search", "无匹配"); save("trade-up-filtered", f.root.innerHTML);
  f.click({ cmuAction: "reset" });
  const dialog = await f.previewTrade(); save("trade-up-confirmation", '<dialog open class="' + dialog.className + '">' + dialog.innerHTML + '</dialog>');
  dialog.querySelector("[data-cm-confirm]").fire("click", {});
  f.requests.at(-1).resolve({ state: f.store.getState(), view: { ...tradeView, cards: [] }, result: { card: { ...cards[6], name: "汰换新球员" } } }); await flush();
  const result = f.root.children[0]; save("trade-up-result", '<dialog open class="' + result.className + '">' + result.innerHTML.replace("cmu-reveal is-animating", "cmu-reveal is-revealed").replace('data-cmu-reveal-result aria-hidden="true" inert', 'data-cmu-reveal-result aria-hidden="false"').replace('data-cmu-reveal-status role="status"', 'data-cmu-reveal-status role="status" hidden') + '</dialog>');
  save("trade-up-animation", '<dialog open class="cm-dialog cmu-dialog">' + tradeUpResultMarkup(cards[6], { materials: cards.slice(0, 5) }) + '</dialog>');
  const empty = tradeFixture({ ...tradeView, cards: [], listings: [] }); await empty.trade(); save("trade-up-empty", empty.root.innerHTML);
});

test("trade-up UI uses the real service pool and consumes exactly five cards once without changing gold", async () => {
  const roster = Array.from({ length: 7 }, (_, i) => ({ ...cards[0], id: "real-c" + i, playerId: "real-c" + i, cardDefinitionId: "real-c" + i, blocked: undefined, upgradeLevel: i, trainingBonuses: { passing: i * 2 } }));
  const actor = { id: "p", gold: 1000, setupComplete: true, draft: { roster, teamName: "测试球队" }, playerSquads: { assignments: Object.fromEntries(roster.map(card => [card.id, "expedition"])) } };
  const pool = [
    { ...cards[6], id: "france", playerId: "france", cardDefinitionId: "france", club: "巴黎" },
    { ...cards[6], id: "lyon", playerId: "lyon", cardDefinitionId: "lyon", nationality: "巴西" },
    { ...cards[6], id: "outside", playerId: "outside", cardDefinitionId: "outside", nationality: "德国", club: "拜仁" },
  ];
  let saves = 0;
  const service = new CardManagementService({ accounts: new Map([["p", actor]]), world: {}, catalog: [...roster, ...pool, pool[0]], economy: {}, save() { saves++; }, random: () => .75 });
  const f = tradeFixture(service.details(actor)); await f.trade();
  const ids = roster.slice(0, 5).map(card => card.id); f.five(ids); f.click({ cmuAction: "preview" });
  const preview = service.preview(actor, f.requests.at(-1).options.body);
  assert.deepEqual(preview.candidates.map(card => card.cardDefinitionId), ["france", "lyon"]);
  assert.equal(actor.draft.roster.length, 7);
  f.requests.at(-1).resolve(preview); await flush();
  const dialog = f.root.children[0]; assert.match(dialog.innerHTML, /每位概率 1 \/ 2/);
  dialog.querySelector("[data-cm-confirm]").fire("click", {});
  const request = f.requests.at(-1), result = service.consume(actor, request.options.body, "trade-up");
  assert.deepEqual(service.consume(actor, request.options.body, "trade-up"), result);
  assert.equal(saves, 1);
  request.resolve({ state: { ...f.store.getState(), draft: actor.draft, playerSquads: actor.playerSquads }, view: service.details(actor), result }); await flush();
  assert.equal(actor.gold, 1000); assert.equal(actor.draft.roster.length, 3);
  assert.equal(result.card.cardDefinitionId, "lyon"); assert.equal(result.card.upgradeLevel, 0);
  assert.deepEqual(result.card.trainingBonuses, {});
  assert.equal(actor.playerSquads.assignments[result.card.id], "garrison");
  assert.match(f.root.children[0].innerHTML, /汰换完成/);
});

const tradeHistoryEntry = i => ({ id: "history-trade-" + i, kind: "trade-up", createdAt: Date.UTC(2026, 8, 6, 12, i),
  cards: tradeView.cards.slice(0, 5), card: { ...cards[6], id: "history-result-" + i, name: "产出球员" + i } });
test("trade-up history shows only the newest 20 records, supports expansion and shows original material snapshots", async () => {
  const history = Array.from({ length: 27 }, (_, i) => tradeHistoryEntry(i));
  const f = tradeFixture({ ...tradeView, history: [history[4], { ...history[0], id: "recycle", kind: "recycle" }, ...history.filter(entry => entry !== history[4])] });
  await f.trade();
  assert.equal((f.root.innerHTML.match(/data-cmu-history="/g) ?? []).length, 20);
  assert.deepEqual([...f.root.innerHTML.matchAll(/data-cmu-history="history-trade-(\d+)"/g)].map(match => Number(match[1])), Array.from({ length: 20 }, (_, i) => 26 - i));
  assert.match(f.root.innerHTML, /<h3>汰换记录<\/h3>/); assert.doesNotMatch(f.root.innerHTML, /最多 50|最近.*条/);
  f.click({ cmuAction: "history" }); assert.equal((f.root.children[0].innerHTML.match(/data-cmu-history="/g) ?? []).length, 20);
  f.click({ cmuHistory: "history-trade-26" });
  assert.match(f.root.children[0].innerHTML, /产出球员26/);
  assert.equal((f.root.children[0].innerHTML.match(/cmu-material-art/g) ?? []).length, 5);
  assert.doesNotMatch(f.root.children[0].innerHTML, /data-cmu-reveal|data-cm-confirm/);
  assert.equal(f.requests.length, 1, "viewing history never submits another trade-up");
});
test("history scrolling survives selection and resets only when a newer record arrives", async () => {
  const f = tradeFixture({ ...tradeView, history: [tradeHistoryEntry(1)] }); await f.trade();
  f.root.querySelector("[data-cmu-history-scroll]").scrollTop = 134;
  f.pickMaterial("c0"); assert.equal(f.root.querySelector("[data-cmu-history-scroll]").scrollTop, 134);
  f.tradeFilter("search", "同名"); assert.equal(f.root.querySelector("[data-cmu-history-scroll]").scrollTop, 134);
  f.click({ cmAction: "refresh" }); f.requests.at(-1).resolve({ ...tradeView, history: [tradeHistoryEntry(2), tradeHistoryEntry(1)] }); await flush();
  assert.equal(f.root.querySelector("[data-cmu-history-scroll]").scrollTop, 0);
});
test("legendary cards stay hidden after resets and searches while S-grade candidates and history remain visible", async () => {
  const legendary = { ...tradeView.cards[0], id: "hidden-legend", grade: "S", nationality: "仅传奇国家" };
  const disguised = { ...legendary, id: "hidden-isx", grade: "A", isX: true };
  const f = tradeFixture({ ...tradeView, cards: [...tradeView.cards, legendary, disguised], history: [{ ...tradeHistoryEntry(1), card: { ...legendary, name: "传奇产出" } }] });
  await f.trade(); assert.doesNotMatch(f.root.innerHTML, /data-cmu-select="S"|data-cmu-select="X"|data-cmu-select="hidden-|仅传奇国家/);
  f.tradeFilter("usable", true); f.click({ cmuAction: "reset" });
  assert.doesNotMatch(f.root.innerHTML, /<option value="S"|<option value="X"|data-cmu-select="hidden-/);
  assert.match(f.root.innerHTML, /传奇产出/);
  f.tradeFilter("search", "仅传奇国家"); assert.doesNotMatch(f.root.innerHTML, /data-cmu-select=/);
  f.click({ cmuAction: "reset" }); const ids = ["A0", "A1", "A2", "A3", "A4"]; f.five(ids);
  const dialog = await f.previewTrade(f.tradeQuote(ids)); assert.match(dialog.innerHTML, /1 张 S 级/); assert.match(dialog.innerHTML, /grade-s/);
});
test("animation starts only after a successful response, and closing it cancels every delayed UI effect", async () => {
  const f = tradeFixture(); await f.trade(); f.five(); const confirmation = await f.previewTrade();
  const callbacks = new Map(); let callback;
  f.root.ownerDocument.defaultView = { matchMedia: () => ({ matches: false }), setTimeout(fn) { callback = fn; callbacks.set(1, fn); return 1; }, clearTimeout: id => callbacks.delete(id) };
  confirmation.querySelector("[data-cm-confirm]").fire("click", {});
  assert.equal(callbacks.size, 0); assert.doesNotMatch(confirmation.innerHTML, /data-cmu-reveal/);
  f.requests.at(-1).reject(Error("服务器拒绝汰换")); await flush(); assert.equal(callbacks.size, 0);
  confirmation.querySelector("[data-cm-confirm]").fire("click", {});
  const card = { ...cards[6], id: "won-card", name: "动画产出" }, entry = { ...tradeHistoryEntry(30), card };
  const nextView = { ...tradeView, cards: [...tradeView.cards.slice(5), card], history: [entry] };
  f.requests.at(-1).resolve({ state: { ...f.store.getState(), draft: { roster: nextView.cards } }, view: nextView, result: entry }); await flush();
  assert.equal(callbacks.size, 1); assert.match(f.root.children[0].innerHTML, /data-cmu-reveal/);
  assert.equal(f.store.getState().draft.roster.length, nextView.cards.length);
  const messages = f.toasts.length, requests = f.requests.length;
  f.controller.close(); assert.equal(callbacks.size, 0); callback();
  assert.equal(f.toasts.length, messages); assert.equal(f.requests.length, requests); assert.equal(f.root.children.length, 0);
});
test("export populated history and detail fixtures without adding extra explanatory text", async () => {
  const output = process.env.CARD_MANAGEMENT_REVIEW_OUTPUT; if (!output) return;
  const f = tradeFixture({ ...tradeView, history: Array.from({ length: 24 }, (_, i) => tradeHistoryEntry(i)) }); await f.trade();
  const save = (name, html) => writeFileSync(output + "/" + name + ".html", '<!doctype html><html lang="zh-CN" data-ui-theme="club"><body><section class="card-management-window standard-window">' + html + '</section></body></html>');
  save("trade-up-history", f.root.innerHTML);
  f.click({ cmuAction: "history" }); const expanded = f.root.children[0];
  save("trade-up-history-expanded", '<dialog open class="' + expanded.className + '">' + expanded.innerHTML + '</dialog>');
  f.click({ cmuHistory: "history-trade-23" }); const detail = f.root.children[0];
  save("trade-up-history-detail", '<dialog open class="' + detail.className + '">' + detail.innerHTML + '</dialog>');
  assert.equal(tradeUpHistory({ history: Array.from({ length: 24 }, (_, i) => tradeHistoryEntry(i)) }).length, 20);
});

test('compact trade-up reveals its committed card while map and warehouse refreshes are still pending',async()=>{
 const f=tradeFixture();await f.trade();f.five();const dialog=await f.previewTrade();dialog.querySelector('[data-cm-confirm]').fire('click', {});
 const mutation=f.requests.at(-1);assert.equal(mutation.options.body.resultOnly,true);
 mutation.resolve({result:{card:{...cards[6],name:'立即展示的球员'},cards:tradeView.cards.slice(0,5)}});await flush();
 assert.match(f.root.children[0].innerHTML,/立即展示的球员/);
 const reads=f.requests.slice(-2);assert.deepEqual(reads.map(r=>r.path),['/api/campaign/cards','/api/campaign/state']);
 reads[0].reject(Error('temporary refresh failure'));reads[1].resolve({state:f.store.getState()});await flush();
 assert.match(f.root.children[0].innerHTML,/立即展示的球员/);assert.match(f.toasts.at(-1),/汰换已完成/);
});
