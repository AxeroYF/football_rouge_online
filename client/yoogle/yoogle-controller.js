import { playerCardMarkup } from "../player-card/player-card.js";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";
import {
  playerDetailBodyMarkup,
  playerDetailWindowMarkup,
} from "../player-card/player-detail-window.js";
import { bindSmallWindow } from "../ui/small-window.js";
import {
  activateStandardWindow,
  deactivateStandardWindow,
  registerStandardWindow,
} from "../ui/standard-window.js";

export const YOOGLE_ATTRIBUTE_LABELS = Object.freeze({
  passing:"传球", firstTouch:"停球", dribbling:"盘带", crossing:"传中", finishing:"射门", longShots:"远射",
  heading:"头球", setPieces:"定位球", tackling:"抢断", marking:"盯人", positioning:"站位", vision:"视野",
  decisions:"决策", composure:"冷静", offBall:"无球", discipline:"纪律", pace:"速度", acceleration:"加速",
  strength:"力量", stamina:"耐力", agility:"灵活", jumping:"弹跳", workRate:"投入", aggression:"侵略性",
  goalkeeping:"守门", reflexes:"反应",
});

const ROLE_CODES = new Set(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
export const YOOGLE_RESULT_LIMIT = 10;
const ROLE_LABELS = Object.freeze({
  GK:"门将", CB:"中后卫", LB:"左后卫", RB:"右后卫", LWB:"左翼卫", RWB:"右翼卫",
  DM:"后腰", AM:"前腰", LM:"左中场", RM:"右中场", ST:"中锋", LW:"左边锋", RW:"右边锋",
});
const FOOT_LABELS = Object.freeze({ left:"左脚", right:"右脚", both:"双足" });
const CORE_ATTRIBUTES = Object.freeze({
  GK:new Set(["goalkeeping", "reflexes", "positioning", "composure"]),
  DEF:new Set(["tackling", "marking", "positioning", "strength", "pace"]),
  MID:new Set(["passing", "vision", "decisions", "firstTouch", "stamina"]),
  ATT:new Set(["finishing", "offBall", "pace", "dribbling", "composure"]),
});

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roleGroup(player) {
  const pool = String(player?.pool ?? "").toUpperCase();
  if (["GK", "DEF", "MID", "ATT"].includes(pool)) return pool;
  const role = String(player?.role ?? "").toUpperCase();
  if (role === "GK") return "GK";
  if (["CB", "LB", "RB", "LWB", "RWB"].includes(role)) return "DEF";
  if (["ST", "LW", "RW"].includes(role)) return "ATT";
  return "MID";
}

function numberOrDash(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : "—";
}

function normalizedQuery(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function hasPlayerCardArt(player) {
  try {
    return Boolean(createPlayerCardViewModel(player).art?.url);
  } catch {
    return false;
  }
}

export function sortYooglePlayers(players) {
  return (Array.isArray(players) ? players : [])
    .map((player, index) => ({
      player,
      index,
      hasArt:hasPlayerCardArt(player),
      overall:Number.isFinite(Number(player?.effectiveOverall ?? player?.overall))
        ? Number(player.effectiveOverall ?? player.overall)
        : -1,
    }))
    .sort((left, right) => Number(right.hasArt) - Number(left.hasArt)
      || right.overall - left.overall
      || String(left.player?.name ?? "").localeCompare(String(right.player?.name ?? ""), "zh-CN")
      || left.index - right.index)
    .map(({ player }) => player);
}

export function filterYooglePlayers(players, search) {
  const query = normalizedQuery(search);
  if (!query) return sortYooglePlayers(players);
  const roleQuery = ROLE_CODES.has(query.toUpperCase()) ? query.toUpperCase() : null;
  const matches = (Array.isArray(players) ? players : []).filter((player) => {
    if (roleQuery) return [player.role, player.secondaryRole].map((value) => String(value ?? "").toUpperCase()).includes(roleQuery);
    return [player.name, player.sourceName ?? player.card?.sourceName, player.club, player.nationality]
      .some((value) => normalizedQuery(value).includes(query));
  });
  return sortYooglePlayers(matches);
}

function roleText(player) {
  const primary = String(player?.role ?? "").toUpperCase();
  const secondary = String(player?.secondaryRole ?? "").toUpperCase();
  const first = ROLE_LABELS[primary] ? ROLE_LABELS[primary] + " · " + primary : primary || "未知";
  if (!secondary || secondary === primary) return first;
  return first + " / " + (ROLE_LABELS[secondary] ?? secondary) + " · " + secondary;
}

export function yooglePlayerPreviewMarkup(player) {
  if (!player) return "";
  const core = CORE_ATTRIBUTES[roleGroup(player)];
  const attributes = player.attributes ?? {};
  const attributeMarkup = Object.entries(YOOGLE_ATTRIBUTE_LABELS).map(([key, label]) => {
    const className = core.has(key) ? ' class="core"' : "";
    return "<div" + className + "><dt>" + esc(label) + "</dt><dd>" + esc(numberOrDash(attributes[key])) + "</dd></div>";
  }).join("");
  const facts = [
    ["综合能力", numberOrDash(player.overall)],
    ["评级", player.grade || "—"],
    ["位置", roleText(player)],
    ["身高", Number(player.heightCm) ? String(player.heightCm) + " cm" : "—"],
    ["惯用脚", FOOT_LABELS[player.preferredFoot] ?? "未知"],
    ["俱乐部", player.club || "—"],
    ["国家队", player.nationality || "—"],
    ["球员库", "YDL 引入球员库"],
    ["我的球队", player.inRoster ? "已在队中" : "未持有"],
  ];
  const factMarkup = facts.map(([label, value]) => "<div><dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>").join("");
  return '<section class="yoogle-preview" data-yoogle-preview>'
    + '<header class="yoogle-preview-head"><button type="button" data-yoogle-back aria-label="返回搜索结果">‹</button><div><h2>' + esc(player.name) + '</h2><p>球员档案与 26 项基础能力</p></div><button type="button" data-yoogle-close aria-label="关闭 YOOGLE">×</button></header>'
    + '<div class="yoogle-preview-body"><aside class="yoogle-preview-card">' + playerCardMarkup(player, { variant:"detail" }) + (player.inRoster ? '<strong>我的球队球员</strong>' : '<span>YDL 公共球员库</span>') + '</aside>'
    + '<main class="yoogle-preview-profile"><dl class="yoogle-preview-facts">' + factMarkup + '</dl><section class="yoogle-preview-attributes"><header><div><h3>26 项基础能力值</h3><span>浅金色为该位置的关键属性</span></div><b>' + esc(roleText(player)) + '</b></header><dl>' + attributeMarkup + '</dl></section></main></div></section>';
}

function resultRowsMarkup(results, activeIndex) {
  return results.map((player, index) => {
    const secondary = player.secondaryRole && player.secondaryRole !== player.role ? " / " + player.secondaryRole : "";
    const roster = player.inRoster ? '<em>我的球队</em>' : "";
    return '<button type="button" class="yoogle-result grade-' + esc(String(player.grade ?? "C").toLowerCase()) + (index === activeIndex ? " is-active" : "") + '" data-yoogle-player="' + esc(player.id ?? player.playerId) + '" data-yoogle-result-index="' + index + '" role="option" aria-selected="' + String(index === activeIndex) + '">'
      + '<i>' + esc(player.grade) + '</i><span><b>' + esc(player.name) + '</b><small>' + esc(player.club) + ' · ' + esc(player.nationality) + '</small></span>'
      + '<strong>' + esc(numberOrDash(player.overall)) + '<small>' + esc(player.role) + esc(secondary) + '</small></strong>' + roster + '</button>';
  }).join("");
}

function windowResultRowsMarkup(results, activeIndex) {
  return results.map((player, index) => {
    return '<article class="yoogle-full-result' + (index === activeIndex ? " is-active" : "") + '" data-yoogle-window-result-index="' + index + '" role="option" aria-selected="' + String(index === activeIndex) + '">'
      + playerDetailBodyMarkup(player, { showCardStatus:false, showProfileHeading:true, cardInteractive:true, cardAction:"yoogle-detail", compact:true }) + '</article>';
  }).join("");
}

export function createYoogleController({ mount, windowRoot, getRequest, documentRef = globalThis.document } = {}) {
  if (!mount || !windowRoot || typeof getRequest !== "function") throw new TypeError("YOOGLE requires topbar, window and request provider");
  const input = mount.querySelector("#yoogle-search-input");
  const panel = mount.querySelector("#yoogle-search-panel");
  const trigger = mount.querySelector("#yoogle-window-trigger");
  const windowInput = windowRoot.querySelector("#yoogle-window-input");
  const windowPanel = windowRoot.querySelector("#yoogle-window-panel");
  const windowDetailLayer = windowRoot.querySelector("#yoogle-window-detail-layer");
  if (!input || !panel || !trigger || !windowInput || !windowPanel || !windowDetailLayer) throw new TypeError("YOOGLE mount is incomplete");
  let players = [];
  let loaded = false;
  let loading = false;
  let errorMessage = "";
  let topOpen = false;
  let topSelectedPlayerId = null;
  let topActiveIndex = 0;
  let topComposing = false;
  let windowOpen = false;
  let windowSubmittedQuery = "";
  let windowSelectedPlayerId = null;
  let windowActiveIndex = 0;
  let windowComposing = false;
  let unbindWindowDetail = () => {};
  let initialized = false;

  const matchesFor = (searchInput) => filterYooglePlayers(players, searchInput.value);
  const visibleTopMatches = () => matchesFor(input).slice(0, YOOGLE_RESULT_LIMIT);
  const playerById = (id) => players.find((player) => String(player.id ?? player.playerId) === String(id));

  function setTopOpen(value) {
    topOpen = Boolean(value);
    if (!topOpen) topSelectedPlayerId = null;
    mount.classList.toggle("is-open", topOpen);
    input.setAttribute("aria-expanded", String(topOpen));
    panel.hidden = !topOpen;
  }

  function renderTop() {
    if (topComposing) {
      topOpen = false;
      panel.innerHTML = "";
    }
    setTopOpen(topOpen);
    if (!topOpen) return;
    const selected = playerById(topSelectedPlayerId);
    if (selected) {
      panel.innerHTML = yooglePlayerPreviewMarkup(selected);
      return;
    }
    if (loading) {
      panel.innerHTML = '<div class="yoogle-state"><span class="yoogle-spinner"></span><strong>正在载入 YDL 球员库</strong><small>同步球员档案与 26 项数值…</small></div>';
      return;
    }
    if (errorMessage) {
      panel.innerHTML = '<div class="yoogle-state is-error"><strong>球员库载入失败</strong><small>' + esc(errorMessage) + '</small><button type="button" data-yoogle-retry>重新载入</button></div>';
      return;
    }
    if (!input.value.trim()) {
      topOpen = false;
      panel.innerHTML = "";
      setTopOpen(false);
      return;
    }
    const matches = matchesFor(input);
    const visible = matches.slice(0, YOOGLE_RESULT_LIMIT);
    topActiveIndex = Math.max(0, Math.min(topActiveIndex, Math.max(0, visible.length - 1)));
    panel.innerHTML = '<div class="yoogle-results-head"><strong>搜索结果</strong><span>' + esc(matches.length) + ' 名球员' + (matches.length > YOOGLE_RESULT_LIMIT ? " · 显示前 10 名" : "") + '</span></div>'
      + '<div class="yoogle-results" role="listbox">' + (visible.length ? resultRowsMarkup(visible, topActiveIndex) : '<p>没有找到符合条件的球员</p>') + '</div>';
  }

  function renderWindowDetail(selected) {
    unbindWindowDetail();
    unbindWindowDetail = () => {};
    windowDetailLayer.innerHTML = selected ? playerDetailWindowMarkup(selected) : "";
    const overlay = windowDetailLayer.querySelector(".team-player-detail-overlay");
    if (!overlay) return;
    unbindWindowDetail = bindSmallWindow(overlay, {
      onRequestClose:() => {
        windowSelectedPlayerId = null;
        renderWindow();
        windowInput.focus();
      },
    });
  }

  function renderWindow() {
    if (!windowOpen) return;
    const selected = playerById(windowSelectedPlayerId);
    const query = windowSubmittedQuery;
    windowRoot.classList.toggle("has-query", Boolean(query || selected));
    if (windowComposing) {
      windowPanel.innerHTML = "";
      renderWindowDetail(null);
      return;
    }
    if (!query) {
      windowPanel.innerHTML = "";
      renderWindowDetail(selected);
      return;
    }
    if (loading) {
      windowPanel.innerHTML = '<div class="yoogle-page-state"><span class="yoogle-spinner"></span><strong>正在载入 YDL 球员库</strong></div>';
      renderWindowDetail(selected);
      return;
    }
    if (errorMessage) {
      windowPanel.innerHTML = '<div class="yoogle-page-state is-error"><strong>球员库载入失败</strong><small>' + esc(errorMessage) + '</small><button type="button" data-yoogle-window-retry>重新载入</button></div>';
      renderWindowDetail(selected);
      return;
    }
    const matches = filterYooglePlayers(players, query);
    windowActiveIndex = Math.max(0, Math.min(windowActiveIndex, Math.max(0, matches.length - 1)));
    windowPanel.innerHTML = '<header class="yoogle-page-summary"><span>找到约 ' + esc(matches.length) + ' 名球员</span></header>'
      + '<div class="yoogle-page-results">' + (matches.length ? windowResultRowsMarkup(matches, windowActiveIndex) : '<div class="yoogle-page-empty"><strong>没有找到符合条件的球员</strong><small>可尝试球员姓名、俱乐部、国家队或准确位置代码</small></div>') + '</div>';
    renderWindowDetail(selected);
  }

  function render() {
    renderTop();
    renderWindow();
  }

  async function ensureLoaded(force = false) {
    if (loading || loaded && !force) return;
    loading = true;
    errorMessage = "";
    render();
    try {
      const request = getRequest();
      if (typeof request !== "function") throw new Error("登录会话尚未准备完成");
      const value = await request("/api/campaign/player-directory");
      const nextPlayers = value?.playerDirectory?.players;
      if (!Array.isArray(nextPlayers)) throw new Error("球员库返回格式无效");
      players = nextPlayers;
      loaded = true;
    } catch (error) {
      errorMessage = error?.message || "未知错误";
    } finally {
      loading = false;
      render();
    }
  }

  function openSearch() {
    if (!input.value.trim()) return;
    topOpen = true;
    renderTop();
    void ensureLoaded();
  }

  function closeSearch() {
    topOpen = false;
    renderTop();
  }

  function showTopConfirmation(playerId) {
    const selected = playerById(playerId);
    if (!selected) return false;
    topSelectedPlayerId = selected.id ?? selected.playerId;
    topOpen = true;
    renderTop();
    panel.scrollTop = 0;
    return true;
  }

  function openWindow({ query = "", selectedPlayerId = null } = {}) {
    closeSearch();
    windowOpen = true;
    windowSelectedPlayerId = selectedPlayerId;
    windowSubmittedQuery = String(query ?? "").trim();
    windowActiveIndex = 0;
    windowInput.value = query;
    activateStandardWindow(windowRoot);
    renderWindow();
    void ensureLoaded();
  }

  function closeWindow() {
    windowOpen = false;
    windowSubmittedQuery = "";
    windowSelectedPlayerId = null;
    unbindWindowDetail();
    unbindWindowDetail = () => {};
    windowDetailLayer.innerHTML = "";
    windowRoot.classList.remove("has-query");
    windowRoot.hidden = true;
    deactivateStandardWindow(windowRoot);
  }

  function updateTopInput() {
    topSelectedPlayerId = null;
    topActiveIndex = 0;
    if (!input.value.trim()) {
      topOpen = false;
      renderTop();
      return;
    }
    topOpen = true;
    renderTop();
    void ensureLoaded();
  }

  input.addEventListener("focus", openSearch);
  input.addEventListener("compositionstart", () => {
    topComposing = true;
    topSelectedPlayerId = null;
    closeSearch();
  });
  input.addEventListener("compositionend", () => {
    topComposing = false;
    updateTopInput();
  });
  input.addEventListener("input", (event) => {
    if (event.isComposing || topComposing) return;
    updateTopInput();
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || topComposing) return;
    if (event.key === "Escape") {
      if (!topOpen) return;
      event.preventDefault();
      closeSearch();
      input.blur();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const results = visibleTopMatches();
    if (!input.value.trim()) return;
    if (!topOpen) topOpen = true;
    if (event.key === "Enter") {
      if (!input.value.trim() || !results.length) return;
      event.preventDefault();
      const playerId = results[topActiveIndex]?.id ?? results[topActiveIndex]?.playerId;
      showTopConfirmation(playerId);
      return;
    }
    event.preventDefault();
    if (!results.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    topActiveIndex = (topActiveIndex + direction + results.length) % results.length;
    renderTop();
    panel.querySelector(".yoogle-result.is-active")?.scrollIntoView({ block:"nearest" });
  });
  panel.addEventListener("pointerdown", (event) => {
    const playerButton = event.target.closest("[data-yoogle-player]");
    if (!playerButton) return;
    event.preventDefault();
    event.stopPropagation();
    showTopConfirmation(playerButton.dataset.yooglePlayer);
  });
  panel.addEventListener("click", (event) => {
    const playerButton = event.target.closest("[data-yoogle-player]");
    if (playerButton) {
      event.preventDefault();
      event.stopPropagation();
      showTopConfirmation(playerButton.dataset.yooglePlayer);
      return;
    }
    if (event.target.closest("[data-yoogle-back]")) {
      topSelectedPlayerId = null;
      renderTop();
      input.focus();
      return;
    }
    if (event.target.closest("[data-yoogle-close]")) {
      closeSearch();
      input.blur();
      return;
    }
    if (event.target.closest("[data-yoogle-retry]")) {
      loaded = false;
      void ensureLoaded(true);
    }
  });
  panel.addEventListener("mousemove", (event) => {
    const row = event.target.closest("[data-yoogle-result-index]");
    if (!row) return;
    const nextIndex = Number(row.dataset.yoogleResultIndex);
    if (Number.isInteger(nextIndex) && nextIndex !== topActiveIndex) {
      topActiveIndex = nextIndex;
      panel.querySelectorAll("[data-yoogle-result-index]").forEach((entry, index) => {
        entry.classList.toggle("is-active", index === topActiveIndex);
        entry.setAttribute("aria-selected", String(index === topActiveIndex));
      });
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (topSelectedPlayerId) {
      topSelectedPlayerId = null;
      renderTop();
      input.focus();
    } else closeSearch();
  });

  trigger.addEventListener("click", () => openWindow());
  function updateWindowInput() {
    windowSubmittedQuery = "";
    windowSelectedPlayerId = null;
    windowActiveIndex = 0;
    renderWindow();
  }

  windowInput.addEventListener("compositionstart", () => {
    windowComposing = true;
    windowSelectedPlayerId = null;
    renderWindow();
  });
  windowInput.addEventListener("compositionend", () => {
    windowComposing = false;
    updateWindowInput();
  });
  windowInput.addEventListener("input", (event) => {
    if (event.isComposing || windowComposing) return;
    updateWindowInput();
  });
  windowInput.addEventListener("keydown", (event) => {
    if (event.isComposing || windowComposing) return;
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    if (event.key === "Enter") {
      if (!windowInput.value.trim()) return;
      event.preventDefault();
      windowSubmittedQuery = windowInput.value.trim();
      windowSelectedPlayerId = null;
      windowActiveIndex = 0;
      renderWindow();
      void ensureLoaded();
      return;
    }
    const results = filterYooglePlayers(players, windowSubmittedQuery);
    if (!windowSubmittedQuery || !results.length) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    windowActiveIndex = (windowActiveIndex + direction + results.length) % results.length;
    renderWindow();
    windowPanel.querySelector(".yoogle-full-result.is-active")?.scrollIntoView({ block:"nearest" });
  });
  windowPanel.addEventListener("click", (event) => {
    const playerButton = event.target.closest('[data-player-card-action="yoogle-detail"]');
    if (playerButton) {
      windowSelectedPlayerId = playerButton.dataset.playerCardId;
      renderWindow();
      return;
    }
    if (event.target.closest("[data-yoogle-window-retry]")) {
      loaded = false;
      void ensureLoaded(true);
    }
  });
  windowPanel.addEventListener("mousemove", (event) => {
    const row = event.target.closest("[data-yoogle-window-result-index]");
    if (!row) return;
    const nextIndex = Number(row.dataset.yoogleWindowResultIndex);
    if (Number.isInteger(nextIndex) && nextIndex !== windowActiveIndex) {
      windowActiveIndex = nextIndex;
      windowPanel.querySelectorAll("[data-yoogle-window-result-index]").forEach((entry, index) => {
        entry.classList.toggle("is-active", index === windowActiveIndex);
        entry.setAttribute("aria-selected", String(index === windowActiveIndex));
      });
    }
  });
  documentRef.addEventListener("click", (event) => {
    if (topOpen && !mount.contains(event.target)) closeSearch();
  });

  function initialize() {
    if (initialized) return;
    initialized = true;
    mount.hidden = false;
  }

  registerStandardWindow(windowRoot, { onRequestClose:closeWindow, documentRef });
  return { initialize, close:closeSearch, openWindow, closeWindow, ensureLoaded, render };
}
