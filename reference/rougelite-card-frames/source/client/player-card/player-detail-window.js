import {playerHourlyWage} from '../../shared/config/operating-costs.mjs';
import { presentPlayerTraits, playerTraitDefinitions } from "../../shared/config/player-trait-presentation.mjs";
import { playerCardMarkup } from "./player-card.js";

const ROLE_LABELS = { GK:"门将", CB:"中后卫", LB:"左后卫", RB:"右后卫", LWB:"左翼卫", RWB:"右翼卫", DM:"后腰", AM:"前腰", LM:"左中场", RM:"右中场", ST:"中锋", LW:"左边锋", RW:"右边锋" };
const FOOT_LABELS = { left:"左脚", right:"右脚", both:"双足" };

import { PLAYER_ATTRIBUTE_LABELS } from "../../shared/config/player-attributes.mjs";
export { PLAYER_ATTRIBUTE_LABELS };

const CORE_ATTRIBUTES = Object.freeze({
  GK:new Set(["goalkeeping", "reflexes", "positioning", "composure"]),
  DEF:new Set(["tackling", "marking", "positioning", "strength", "pace"]),
  MID:new Set(["passing", "vision", "decisions", "firstTouch", "stamina"]),
  ATT:new Set(["finishing", "offBall", "pace", "dribbling", "composure"]),
});

function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function roleGroup(role) { return role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "DEF" : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID"; }
function valueOrDash(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number) : "—"; }
function effectiveAttributes(player) {
  const effective = player.effectiveAttributes ?? player.displayAttributes ?? {};
  const base = player.attributes ?? {};
  return Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map((key) => [key, effective[key] ?? base[key]]));
}

export function playerDetailBodyMarkup(player, {
  showCardStatus = true,
  showProfileHeading = false,
  cardInteractive = false,
  cardAction = "",
  compact = false,
} = {}) {
  if (!player) return "";
  player = presentPlayerTraits(player);
  const attributes = effectiveAttributes(player);
  const core = CORE_ATTRIBUTES[roleGroup(player.role)];
  const attributeMarkup = Object.entries(PLAYER_ATTRIBUTE_LABELS).map(([key, label]) => {
    const value = valueOrDash(attributes[key]);
    return `<div class="${core.has(key) ? "core" : ""}"><dt>${label}</dt><dd>${value}</dd></div>`;
  }).join("");
  const secondary = player.secondaryRole && player.secondaryRole !== player.role ? ` / ${ROLE_LABELS[player.secondaryRole] ?? player.secondaryRole}` : "";
  const role = `${ROLE_LABELS[player.role] ?? player.role ?? "未知"}${secondary}`;
  const level = Math.max(0, Number(player.upgradeLevel ?? 0));
  const overall = valueOrDash(player.effectiveOverall ?? player.overall);
  const baseOverall = valueOrDash(player.baseOverall ?? player.overall);
  const state = player.state ?? {};
  const injury = state.injury?.matchesRemaining > 0 ? `伤停 ${state.injury.matchesRemaining} 场` : state.suspension?.matchesRemaining > 0 ? `停赛 ${state.suspension.matchesRemaining} 场` : "可出场";
  const fullFacts = [
    ["基础工资", `${playerHourlyWage(player)} 金币/小时`], ["当前综合能力", overall], ["基础能力", baseOverall], ["强化等级", level ? `+${level}` : "未强化"],
    ["评级", player.grade ?? "—"], ["位置", role], ["身高", Number(player.heightCm) ? `${player.heightCm} cm` : "—"],
    ["惯用脚", FOOT_LABELS[player.preferredFoot] ?? "未知"], ["俱乐部", player.club || "—"], ["国家队", player.nationality || "—"],
    ["体能", Number.isFinite(Number(state.fitness)) ? state.fitness : "—"], ["状态", Number.isFinite(Number(state.form)) ? state.form : "—"], ["可用性", injury],
  ];
  const compactFacts = [
    ["评级", player.grade ?? "—"], ["位置", role], ["身高", Number(player.heightCm) ? `${player.heightCm} cm` : "—"],
    ["惯用脚", FOOT_LABELS[player.preferredFoot] ?? "未知"], ["基础工资", `${playerHourlyWage(player)} 金币/小时`],
  ];
  const facts = compact ? compactFacts : fullFacts;
  const factMarkup = facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("");
  const traits = playerTraitDefinitions(player);
  const cardStatusMarkup = showCardStatus ? `<div class="team-player-detail-level"><span>当前球员卡</span><b>${level ? `强化 +${level}` : "未强化"}</b><small>有效能力 ${overall} · 基础 ${baseOverall}</small></div>` : "";
  const profileHeadingMarkup = showProfileHeading ? compact
    ? `<header class="player-detail-inline-header is-compact"><div class="player-detail-inline-identity"><h2>${esc(player.name)}</h2><p>${esc(player.club || "未知俱乐部")} · ${esc(player.nationality || "未知国家队")}</p></div><dl class="player-detail-inline-facts">${factMarkup}</dl><strong><small>综合</small>${overall}</strong></header>`
    : `<header class="player-detail-inline-header"><div><small>YDL PLAYER PROFILE</small><h2>${esc(player.name)}</h2><p>${esc(player.club || "未知俱乐部")} · ${esc(player.nationality || "未知国家队")}</p></div><strong><small>综合能力</small>${overall}</strong></header>`
    : "";
  const standaloneFactsMarkup = compact && showProfileHeading ? "" : `<dl class="team-player-detail-facts">${factMarkup}</dl>`;
  const cardMarkup = playerCardMarkup(player, { variant:"detail", interactive:cardInteractive, action:cardAction, ariaPrefix:"查看" });
  const traitsMarkup = compact ? "" : `<section class="team-player-detail-traits"><small>球员特性</small><p>${traits.length ? traits.map((trait) => `${esc(trait.name)}${trait.summary ? `：${esc(trait.summary)}` : ""}`).join("<br>") : "暂无强化特性"}</p></section>`;
  const attributeHeaderMarkup = compact ? "" : `<header><div><h3>当前 26 项能力值</h3><span>浅金色项目为该位置的关键属性</span></div><b>${esc(role)}</b></header>`;
  return `<div class="team-player-detail-body${compact ? " is-compact" : ""}"><aside class="team-player-detail-card">${cardMarkup}${cardStatusMarkup}</aside><main class="team-player-detail-profile">${profileHeadingMarkup}${standaloneFactsMarkup}<section class="team-player-attributes">${attributeHeaderMarkup}<dl>${attributeMarkup}</dl></section>${traitsMarkup}</main></div>`;
}

export function playerDetailWindowMarkup(player) {
  if (!player) return "";
  return `<div class="team-player-detail-overlay" tabindex="-1"><section class="team-player-detail-dialog" data-team-player-dialog role="dialog" aria-modal="true" aria-labelledby="player-detail-window-title" tabindex="-1"><header><div><small>YDL PLAYER PROFILE</small><h2 id="player-detail-window-title">${esc(player.name)}</h2><p>球员详细信息与当前 26 项能力值</p></div><button type="button" data-small-window-close aria-label="关闭球员详情">×</button></header>${playerDetailBodyMarkup(player)}</section></div>`;
}
