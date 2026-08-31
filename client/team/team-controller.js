import { playerCardMarkup } from "../player-card/player-card.js";

const POSITION_ORDER = ["GK", "DEF", "MID", "ATT"];
const POSITION_LABELS = { GK: "门将", DEF: "后卫", MID: "中场", ATT: "前锋" };

function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

function card(player) {
  return `<article class="team-player-item">${playerCardMarkup(player, { variant:"standard" })}</article>`;
}

export function createTeamController({ panel, getCampaignState, mapElement } = {}) {
  let openState = false;
  let filters = { position: "all", nationality: "all", minOverall: "", maxOverall: "", upgradeLevel: "all", search: "" };
  const roster = () => getCampaignState()?.draft?.roster ?? [];
  const filtered = () => roster().filter((player) => {
    const text = filters.search.trim().toLowerCase();
    if (filters.position !== "all" && player.pool !== filters.position && player.role !== filters.position) return false;
    if (filters.nationality !== "all" && player.nationality !== filters.nationality) return false;
    if (filters.minOverall !== "" && Number(player.overall) < Number(filters.minOverall)) return false;
    if (filters.maxOverall !== "" && Number(player.overall) > Number(filters.maxOverall)) return false;
    if (filters.upgradeLevel !== "all" && Number(player.upgradeLevel ?? 0) !== Number(filters.upgradeLevel)) return false;
    return !text || `${player.name} ${player.nationality}`.toLowerCase().includes(text);
  }).sort((a, b) => (POSITION_ORDER.indexOf(a.pool) - POSITION_ORDER.indexOf(b.pool)) || Number(b.overall ?? 0) - Number(a.overall ?? 0) || String(a.name).localeCompare(String(b.name), "zh-CN"));
  function render() {
    const players = filtered();
    const nationalities = [...new Set(roster().map((player) => player.nationality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    panel.innerHTML = `<div class="team-management-shell"><header class="team-management-header"><div><span>YELLOWDOGS CHRONICLES · CLUB MANAGEMENT</span><h2>球队管理</h2><small>${players.length} / ${roster().length} 名球员</small></div><button type="button" data-team-close aria-label="关闭球队管理">×</button></header><div class="team-management-toolbar"><label class="team-search"><span>搜索球员</span><input data-team-filter="search" value="${esc(filters.search)}" placeholder="姓名或国籍"></label><label><span>位置</span><select data-team-filter="position"><option value="all">全部位置</option>${POSITION_ORDER.map((key) => `<option value="${key}" ${filters.position === key ? "selected" : ""}>${POSITION_LABELS[key]}</option>`).join("")}</select></label><label><span>国家</span><select data-team-filter="nationality"><option value="all">全部国家</option>${nationalities.map((name) => `<option value="${esc(name)}" ${filters.nationality === name ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label><label><span>能力值</span><span class="team-range"><input data-team-filter="minOverall" type="number" min="0" max="99" value="${esc(filters.minOverall)}" placeholder="最低"><i>—</i><input data-team-filter="maxOverall" type="number" min="0" max="99" value="${esc(filters.maxOverall)}" placeholder="最高"></span></label><label><span>强化等级</span><select data-team-filter="upgradeLevel"><option value="all">全部等级</option>${[0,1,2,3,4,5].map((level) => `<option value="${level}" ${String(filters.upgradeLevel) === String(level) ? "selected" : ""}>${level === 0 ? "未强化" : `+${level}`}</option>`).join("")}</select></label></div><div class="team-player-grid">${players.length ? players.map(card).join("") : `<div class="team-empty">没有符合筛选条件的球员</div>`}</div></div>`;
    panel.querySelectorAll("[data-team-filter]").forEach((input) => { input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { filters[input.dataset.teamFilter] = input.value; render(); }); });
    panel.querySelector("[data-team-close]")?.addEventListener("click", close);
  }
  function open() { openState = true; panel.hidden = false; mapElement.classList.add("is-team-open"); render(); }
  function close() { openState = false; panel.hidden = true; mapElement.classList.remove("is-team-open"); }
  function toggle() { openState ? close() : open(); }
  function isOpen() { return openState; }
  return { open, close, toggle, isOpen, render };
}
