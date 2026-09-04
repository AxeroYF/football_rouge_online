import { playerCardMarkup } from "../player-card/player-card.js";
import {
  PLAYER_ATTRIBUTE_LABELS,
  playerDetailWindowMarkup,
} from "../player-card/player-detail-window.js";
import {
  activateStandardWindow,
  deactivateStandardWindow,
  registerStandardWindow,
} from "../ui/standard-window.js";
import { bindSmallWindow } from "../ui/small-window.js";
import { PLAYER_SQUAD_DEFINITIONS, PLAYER_SQUAD_IDS } from "../../shared/config/player-squads.mjs";

const FILTER_POSITION_ORDER = ["GK", "DEF", "MID", "ATT"];
const FILTER_POSITION_LABELS = { GK:"门将", DEF:"后卫", MID:"中场", ATT:"前锋" };
const PRIMARY_POSITION_ORDER = ["ST", "LW", "RW", "AM", "LM", "RM", "DM", "LB", "RB", "CB", "GK"];
const HIDDEN_PRIMARY_POSITIONS = new Set(["CM", "LWB", "RWB"]);
const LIST_KEY_ATTRIBUTES = Object.freeze({
  GK:["goalkeeping", "reflexes", "positioning", "composure"],
  LB:["pace", "tackling", "crossing", "stamina", "positioning"],
  RB:["pace", "tackling", "crossing", "stamina", "positioning"],
  LWB:["pace", "crossing", "dribbling", "stamina", "tackling"],
  RWB:["pace", "crossing", "dribbling", "stamina", "tackling"],
  CB:["tackling", "marking", "positioning", "strength", "heading"],
  DM:["tackling", "marking", "passing", "positioning", "stamina"],
  CM:["passing", "vision", "firstTouch", "decisions", "stamina"],
  LM:["pace", "crossing", "dribbling", "passing", "stamina"],
  RM:["pace", "crossing", "dribbling", "passing", "stamina"],
  AM:["passing", "vision", "firstTouch", "dribbling", "decisions"],
  LW:["pace", "dribbling", "crossing", "finishing", "offBall"],
  RW:["pace", "dribbling", "crossing", "finishing", "offBall"],
  ST:["finishing", "offBall", "heading", "pace", "composure"],
});
function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function primaryPosition(player) { return String(player?.role ?? player?.pool ?? "其他").toUpperCase(); }
function secondaryPosition(player) {
  const role = String(player?.secondaryRole ?? player?.card?.secondaryRole ?? "").toUpperCase();
  return role && role !== primaryPosition(player) ? role : "";
}
function sourceName(player) {
  const value = String(player?.sourceName ?? player?.card?.sourceName ?? "").trim();
  return value && value !== String(player?.name ?? "").trim() ? value : "";
}
function overallValue(player) { return Number(player?.effectiveOverall ?? player?.overall ?? 0); }
function positionRank(player) {
  const rank = PRIMARY_POSITION_ORDER.indexOf(primaryPosition(player));
  return rank < 0 ? PRIMARY_POSITION_ORDER.length : rank;
}
export function sortTeamPlayers(players) {
  return [...players].sort((a, b) => positionRank(a) - positionRank(b)
    || primaryPosition(a).localeCompare(primaryPosition(b))
    || overallValue(b) - overallValue(a)
    || String(a.name).localeCompare(String(b.name), "zh-CN"));
}
function attributeValue(player, key) {
  const value = player?.effectiveAttributes?.[key] ?? player?.displayAttributes?.[key] ?? player?.attributes?.[key];
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : "—";
}
function listAttributes(player) {
  const keys = LIST_KEY_ATTRIBUTES[primaryPosition(player)] ?? ["pace", "passing", "dribbling", "decisions"];
  return keys.map((key) => `<span><i>${esc(PLAYER_ATTRIBUTE_LABELS[key] ?? key)}</i><b>${attributeValue(player,key)}</b></span>`).join("");
}
function squadSelectMarkup(player, assignments) {
  const playerId = String(player.playerId ?? player.id);
  const assigned = String(assignments?.[playerId]) === PLAYER_SQUAD_IDS.EXPEDITION
    ? PLAYER_SQUAD_IDS.EXPEDITION
    : PLAYER_SQUAD_IDS.GARRISON;
  const options = PLAYER_SQUAD_DEFINITIONS.map((squad) => `<option value="${esc(squad.id)}" ${assigned === squad.id ? "selected" : ""}>${esc(squad.name)}</option>`).join("");
  return `<select class="team-list-squad" data-team-squad-player="${esc(playerId)}" aria-label="设置${esc(player.name)}的编队">${options}</select>`;
}
export function teamPlayerListMarkup(players, assignments = {}) {
  const sorted = sortTeamPlayers(players);
  const extraRoles = [...new Set(sorted.map(primaryPosition).filter((role) => !PRIMARY_POSITION_ORDER.includes(role) && !HIDDEN_PRIMARY_POSITIONS.has(role)))];
  const roles = [...PRIMARY_POSITION_ORDER, ...extraRoles];
  const rows = roles.map((role) => {
    const group = sorted.filter((player) => primaryPosition(player) === role);
    const playerRows = group.map((player) => {
      const english = sourceName(player);
      const secondary = secondaryPosition(player);
      const playerId = String(player.playerId ?? player.id);
      const assignedSquad = String(assignments?.[playerId]) === PLAYER_SQUAD_IDS.EXPEDITION
        ? PLAYER_SQUAD_IDS.EXPEDITION
        : PLAYER_SQUAD_IDS.GARRISON;
      const squadClass = assignedSquad === PLAYER_SQUAD_IDS.EXPEDITION ? " is-squad-expedition" : "";
      return `<div class="team-player-list-row${squadClass}"><button type="button" class="team-list-name" data-player-card-action="team-detail" data-player-card-id="${esc(playerId)}" aria-label="查看${esc(player.name)}"><strong>${esc(player.name)}</strong>${english ? `<em>${esc(english)}</em>` : ""}</button>${squadSelectMarkup(player,assignments)}<span class="team-list-rating"><b>${esc(player.grade ?? "—")}</b><strong>${overallValue(player)}</strong></span><span class="team-list-positions"><b>${esc(primaryPosition(player))}</b><i>/</i><span>${esc(secondary || "—")}</span></span><span>${esc(player.club || "—")}</span><span>${esc(player.nationality || "—")}</span><span class="team-list-attributes">${listAttributes(player)}</span></div>`;
    }).join("");
    return `<div class="team-position-row" role="heading" aria-level="3"><h3>${esc(role)}</h3></div>${playerRows || '<div class="team-position-empty">暂无球员</div>'}`;
  }).join("");
  return `<div class="team-player-list"><div class="team-player-list-table"><div class="team-list-columns" aria-hidden="true"><span>球员</span><span>编队</span><span>评级 / 能力</span><span>主 / 副位置</span><span>俱乐部</span><span>国籍</span><span>关键属性</span></div>${rows}</div></div>`;
}
export function teamPlayerDetailMarkup(player) {
  return playerDetailWindowMarkup(player);
}

export { PLAYER_ATTRIBUTE_LABELS };

export function createTeamController({ panel, getCampaignState, mapElement, getCampaignRequest, campaignStore, showToast = () => {} } = {}) {
  let openState = false;
  let selectedPlayerId = null;
  let viewMode = "list";
  let filters = { squad:"all", position:"all", nationality:"all", minOverall:"", maxOverall:"", upgradeLevel:"all", search:"" };
  const roster = () => getCampaignState()?.draft?.roster ?? [];
  const filtered = () => sortTeamPlayers(roster().filter((player) => {
    const text = filters.search.trim().toLowerCase();
    const playerId = String(player.playerId ?? player.id);
    const assignedSquad = String(getCampaignState()?.playerSquads?.assignments?.[playerId]) === PLAYER_SQUAD_IDS.EXPEDITION
      ? PLAYER_SQUAD_IDS.EXPEDITION
      : PLAYER_SQUAD_IDS.GARRISON;
    if (filters.squad !== "all" && assignedSquad !== filters.squad) return false;
    if (filters.position !== "all" && player.pool !== filters.position && player.role !== filters.position) return false;
    if (filters.nationality !== "all" && player.nationality !== filters.nationality) return false;
    if (filters.minOverall !== "" && Number(player.effectiveOverall ?? player.overall) < Number(filters.minOverall)) return false;
    if (filters.maxOverall !== "" && Number(player.effectiveOverall ?? player.overall) > Number(filters.maxOverall)) return false;
    if (filters.upgradeLevel !== "all" && Number(player.upgradeLevel ?? 0) !== Number(filters.upgradeLevel)) return false;
    return !text || `${player.name} ${sourceName(player)} ${player.club ?? ""} ${player.nationality ?? ""}`.toLowerCase().includes(text);
  }));
  function closeDetail() { selectedPlayerId = null; render(); }
  function render({ scrollTop = null, scrollLeft = null } = {}) {
    const players = filtered();
    const currentRoster = roster();
    const assignments = getCampaignState()?.playerSquads?.assignments ?? {};
    const squadCounts = Object.fromEntries(PLAYER_SQUAD_DEFINITIONS.map((squad) => [squad.id,0]));
    currentRoster.forEach((player) => {
      const squadId = String(assignments[String(player.playerId ?? player.id)]) === PLAYER_SQUAD_IDS.EXPEDITION
        ? PLAYER_SQUAD_IDS.EXPEDITION
        : PLAYER_SQUAD_IDS.GARRISON;
      if (Object.hasOwn(squadCounts,squadId)) squadCounts[squadId] += 1;
    });
    const selected = currentRoster.find((player) => String(player.id) === String(selectedPlayerId));
    const nationalities = [...new Set(currentRoster.map((player) => player.nationality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const content = viewMode === "list"
      ? teamPlayerListMarkup(players,assignments)
      : players.length ? `<div class="team-player-grid">${players.map((player) => `<article class="team-player-item">${playerCardMarkup(player, { interactive:true, variant:"standard", action:"team-detail", ariaPrefix:"查看" })}</article>`).join("")}</div>` : `<div class="team-empty">没有符合筛选条件的球员</div>`;
    const squadSummary = PLAYER_SQUAD_DEFINITIONS.map((squad) => `<span class="is-${esc(squad.id)}"><b>${esc(squad.name)}</b><strong>${squadCounts[squad.id]}</strong></span>`).join("");
    panel.innerHTML = `<div class="team-management-shell"><header class="team-management-header"><div class="team-management-title"><h2>球队管理</h2><div class="team-view-switch" role="group" aria-label="切换球队视图"><button type="button" data-team-view="list" class="${viewMode === "list" ? "is-active" : ""}" aria-pressed="${viewMode === "list"}">列表</button><button type="button" data-team-view="cards" class="${viewMode === "cards" ? "is-active" : ""}" aria-pressed="${viewMode === "cards"}">球员卡</button></div></div><button type="button" data-team-close aria-label="关闭球队管理">×</button></header><div class="team-management-toolbar"><label class="team-search"><span>搜索球员</span><input data-team-filter="search" value="${esc(filters.search)}" placeholder="中文名、英文名、俱乐部或国籍"></label><label class="team-squad-filter"><span>编队</span><select data-team-filter="squad"><option value="all">全部编队</option>${PLAYER_SQUAD_DEFINITIONS.map((squad) => `<option value="${esc(squad.id)}" ${filters.squad === squad.id ? "selected" : ""}>${esc(squad.name)}</option>`).join("")}</select></label><label><span>位置</span><select data-team-filter="position"><option value="all">全部位置</option>${FILTER_POSITION_ORDER.map((key) => `<option value="${key}" ${filters.position === key ? "selected" : ""}>${FILTER_POSITION_LABELS[key]}</option>`).join("")}</select></label><label><span>国家</span><select data-team-filter="nationality"><option value="all">全部国家</option>${nationalities.map((name) => `<option value="${esc(name)}" ${filters.nationality === name ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label><label><span>能力值</span><span class="team-range"><input data-team-filter="minOverall" type="number" min="0" max="99" value="${esc(filters.minOverall)}" placeholder="最低"><i>—</i><input data-team-filter="maxOverall" type="number" min="0" max="99" value="${esc(filters.maxOverall)}" placeholder="最高"></span></label><label><span>强化等级</span><select data-team-filter="upgradeLevel"><option value="all">全部等级</option>${[0,1,2,3,4,5].map((level) => `<option value="${level}" ${String(filters.upgradeLevel) === String(level) ? "selected" : ""}>${level === 0 ? "未强化" : `+${level}`}</option>`).join("")}</select></label><div class="team-squad-summary" aria-label="编队人数">${squadSummary}</div></div>${content}${teamPlayerDetailMarkup(selected)}</div>`;
    panel.querySelectorAll("[data-team-filter]").forEach((input) => { input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { filters[input.dataset.teamFilter] = input.value; render(); }); });
    panel.querySelectorAll("[data-team-view]").forEach((button) => button.addEventListener("click", () => { viewMode = button.dataset.teamView; render(); }));
    panel.querySelectorAll("[data-team-squad-player]").forEach((select) => select.addEventListener("change", async () => {
      const request = getCampaignRequest?.();
      if (typeof request !== "function") return showToast("登录会话尚未准备完成");
      const scrollContainer = panel.querySelector(".team-player-list, .team-player-grid");
      const preservedScroll = { scrollTop:scrollContainer?.scrollTop ?? 0, scrollLeft:scrollContainer?.scrollLeft ?? 0 };
      select.disabled = true;
      try {
        const value = await request("/api/campaign/squads/assign", { method:"POST", body:{ playerId:select.dataset.teamSquadPlayer, squadId:select.value } });
        campaignStore?.setState(value.state,{source:"player-squad-assignment"});
      } catch (error) {
        showToast(error?.message || "编队设置失败");
      }
      render(preservedScroll);
    }));
    panel.querySelectorAll('[data-player-card-action="team-detail"]').forEach((button) => button.addEventListener("click", () => { selectedPlayerId = button.dataset.playerCardId; render(); }));
    panel.querySelector("[data-team-close]")?.addEventListener("click", close);
    bindSmallWindow(panel.querySelector(".team-player-detail-overlay"), { onRequestClose:closeDetail });
    if (scrollTop !== null || scrollLeft !== null) {
      const scrollContainer = panel.querySelector(".team-player-list, .team-player-grid");
      if (scrollContainer) {
        if (scrollTop !== null) scrollContainer.scrollTop = scrollTop;
        if (scrollLeft !== null) scrollContainer.scrollLeft = scrollLeft;
      }
    }
  }
  function open() { openState = true; selectedPlayerId = null; activateStandardWindow(panel); mapElement.classList.add("is-team-open"); render(); }
  function close() { openState = false; selectedPlayerId = null; panel.hidden = true; deactivateStandardWindow(panel); mapElement.classList.remove("is-team-open"); }
  function toggle() { openState ? close() : open(); }
  function isOpen() { return openState; }
  registerStandardWindow(panel, { onRequestClose:close });
  return { open, close, toggle, isOpen, render };
}
