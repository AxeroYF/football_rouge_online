import {oilMovementText,oilMovementChoiceMarkup,applyMovementOilChoice} from '../resources/oil-movement.js';
import {canUseTerritory} from '../../shared/config/diplomacy.mjs';
import { unitTravelProgress } from '../../shared/map/unit-travel.mjs';
import { facilityArtIcon } from '../../shared/config/facility-art.mjs';
import { facilityActionsMarkup } from "./facility-actions-controller.js?v=20260909-infrastructure-v1";
import { createRequestId } from "../core/request-id.js?v=20260906-release-v01";
import { goldAmountMarkup } from "../ui/currency.js";
import { SCOUTING_RULES, scoutingLevel, scoutingGradeProbabilities } from "../../shared/config/scouting.mjs";
import { CORE_COUNTRY_CODES, coreCountryName } from "../../shared/config/countries.mjs";
import { SCOUT_TOKEN_URL, SCOUT_NAME_MAX_LENGTH, normalizeScoutName } from "../../shared/scouting/scout-units.mjs";
import { meteorLayer } from "../ui/meteor-background.js";
import { playerCardMarkup, escapePlayerCardHtml as esc } from "../player-card/player-card.js?v=20260905-shield-v1";
import { registerStageWindow, activateStageWindow, deactivateStageWindow } from "../ui/stage-window-manager.js";

export function scoutingProgress(task, now = Date.now()) {
  now = Math.max(now, task.raidPause?.until ?? 0);
  const remaining = Math.max(0, task.completesAt - now);
  return { remaining, percent: Math.max(0, Math.min(100, 100 * (now - task.startedAt) / Math.max(1, task.completesAt - task.startedAt))) };
}
function timeLabel(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function progressMarkup(task) {
  return `<div class="scout-progress" data-scout-progress="${esc(task.id)}" role="progressbar" aria-label="球员发掘进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><span class="scout-countdown" data-scout-countdown="${esc(task.id)}"></span>`;
}

export { scoutingGradeProbabilities } from '../../shared/config/scouting.mjs';

export function scoutingPoolMarkup(level, levelRules) {
  const colors = { C: "#839b92", B: "#bc8cab", A: "#57c7ba", S: "#e9c550" };
  const entries = scoutingGradeProbabilities(levelRules);
  const label = (entry) => `${entry.grade} 级${entry.grade === "S" ? " · 传奇" : ""}`;
  const percent = (entry) => `${entry.percent.toFixed(1)}%`;
  let cursor = 0;
  const slices = entries.map((entry) => { const start = cursor; cursor += entry.percent; return `${colors[entry.grade]} ${start}% ${cursor}%`; });
  return `<section class="scout-pool" aria-label="当前等级球员池，每名候选概率"><header><h3>球员池 · LV.${level}</h3></header><div class="scout-pool-body"><div class="scout-pool-pie" role="img" aria-label="${esc(entries.map((entry) => `${label(entry)} ${percent(entry)}`).join('，'))}" style="background:conic-gradient(${slices.join(',')})"></div><ul>${entries.map((entry) => `<li><span><i style="background:${colors[entry.grade]}"></i>${label(entry)}</span><strong>${percent(entry)}</strong></li>`).join('')}</ul></div></section>`;
}


export function scoutingCountryProbabilities({ countryCode, coreCountry, rules = SCOUTING_RULES } = {}) {
  if (!countryCode && typeof coreCountry !== "boolean") return [];
  const core = countryCode ? CORE_COUNTRY_CODES.includes(countryCode) : coreCountry;
  const bias = Math.max(0, Math.min(1, Number(rules.regionalBias ?? SCOUTING_RULES.regionalBias)));
  return [
    { label: core ? coreCountryName(countryCode) ?? "本国球员" : "非核心国家", percent: bias * 100, color: "#64baa8" },
    { label: core ? "其他国家" : "核心国家", percent: (1 - bias) * 100, color: "#d1b66e" },
  ];
}
export function scoutingCountryPoolMarkup(context) {
  const entries = scoutingCountryProbabilities(context);
  if (!entries.length) return "";
  const percentage = value => Number(value.toFixed(1)) + "%";
  let cursor = 0;
  const slices = entries.map(entry => { const start = cursor; cursor += entry.percent; return `${entry.color} ${start}% ${cursor}%`; });
  return `<section class="scout-pool scout-country-pool" aria-label="预计国家分布，按每名候选的地区倾向"><header><h3>预计国家分布</h3></header><div class="scout-pool-body"><div class="scout-pool-pie" role="img" aria-label="${esc(entries.map(entry => entry.label + ' ' + percentage(entry.percent)).join('，'))}" style="background:conic-gradient(${slices.join(',')})"></div><ul>${entries.map(entry => `<li><span><i style="background:${entry.color}"></i>${esc(entry.label)}</span><strong>${percentage(entry.percent)}</strong></li>`).join("")}</ul></div></section>`;
}
export function scoutMovementProgress(movement, now = Date.now()) {
  const arrivesAt = Number(movement.arrivesAt);
  return { percent: unitTravelProgress(movement,now) * 100, remaining: Math.max(0, arrivesAt - Number(now)) };
}
function movementRouteMarkup(fromLabel, toLabel) {
  return `<strong class="scout-move-route"><b title="${esc(fromLabel)}" aria-label="起点：${esc(fromLabel)}">${esc(fromLabel)}</b><i aria-hidden="true">→</i><b title="${esc(toLabel)}" aria-label="终点：${esc(toLabel)}">${esc(toLabel)}</b></strong>`;
}
export function scoutMovementMarkup(scout, { fromLabel, toLabel, pending = false } = {}) {
  const id = esc(scout.id), movementId = esc(scout.movement.id ?? "");
  return `${movementRouteMarkup(fromLabel ?? scout.movement.fromTerritoryId, toLabel ?? scout.movement.toTerritoryId)}
    <div class="campaign-expedition-progress scout-move-progress" data-scout-move-progress="${id}" data-scout-movement-id="${movementId}" role="progressbar" aria-label="球探移动进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
    <div class="campaign-expedition-footer scout-move-footer"><span data-scout-move-countdown="${id}" data-scout-movement-id="${movementId}"></span><button type="button" data-scout-cancel-move="${id}" data-scout-movement-id="${movementId}" ${pending ? "disabled" : ""}>中止</button></div>`;
}


export function scoutStatusLabel(status) {
  return ({ idle: "待命", moving: "移动中", working: "发掘中", ready: "待选球员", stranded: "等待驻扎" })[status] ?? "待命";
}
function centerMarkup(view, pending, gold) {
  const scouts = view.scouts ?? [], capacity = view.capacity ?? 2, free = Math.max(0, capacity - scouts.length);
  const cost = view.rules.recruitCostGold ?? 0;
  const unavailable = pending || view.building?.status !== "active" || Boolean(view.error);
  const slots = Array.from({ length: capacity }, (_, index) => {
    const unit = scouts[index];
    if (!unit) return '<div class="scout-unit-slot is-empty" role="img" aria-label="空闲球探槽位"><svg viewBox="0 0 40 48" aria-hidden="true"><circle cx="20" cy="14" r="7"/><path d="M7 40v-5a13 13 0 0 1 26 0v5"/></svg></div>';
    return `<article class="scout-unit-slot scout-unit-row"><img src="${SCOUT_TOKEN_URL}" alt=""><div><strong>${esc(unit.name)}</strong><span>${esc(unit.territoryLabel)}</span><b class="is-${esc(unit.status)}">${scoutStatusLabel(unit.status)}</b></div><button type="button" data-scout-open-unit="${esc(unit.id)}">查看</button></article>`;
  }).join("");
  return `<div class="scout-center-identity"><img src="${facilityArtIcon("scout-center", view.building.level)}" alt=""><div><strong>${esc(view.territoryLabel)}</strong><span>LV.${view.building.level}</span></div></div>
    <div class="scout-roster-heading"><h3>球探</h3></div>
    <div class="scout-unit-roster">${slots}</div>
    ${view.error ? `<p class="scout-error">${esc(view.error)}</p>` : ""}
    <div class="scout-recruit-actions"><button type="button" class="scout-primary" data-scout-recruit="1" ${unavailable || free < 1 || gold < cost ? "disabled" : ""}>招募球探</button></div>
    ${(view.legacyTasks ?? []).length ? `<div class="scout-legacy-tasks">${view.legacyTasks.map(task => `<button type="button" data-scout-legacy-task="${esc(task.id)}">${esc(task.territoryLabel)} · ${scoutStatusLabel(task.status)}</button>`).join("")}</div>` : ""}`;
}

function scoutNameMarkup(scout,task,pending,renameDraft){
 const name=scout?.name??task?.scoutName??"发掘结果";
 const editing=scout&&renameDraft?.scoutId===scout.id;
 return `<div class="scout-name-row"><h3>${esc(name)}</h3>${scout&&!editing?`<button type="button" data-scout-rename ${pending?"disabled":""}>改名</button>`:""}</div>${editing?`<form class="scout-rename-form" data-scout-rename-form><label for="scout-name-input">球探名字</label><input id="scout-name-input" data-scout-name-input value="${esc(renameDraft.value)}" maxlength="${SCOUT_NAME_MAX_LENGTH*2}" autocomplete="off" ${pending?"disabled":""} aria-describedby="scout-name-error"><p id="scout-name-error" class="scout-error" role="status" ${renameDraft.error?"":"hidden"}>${esc(renameDraft.error??"")}</p><div><button type="submit" ${pending?"disabled":""}>${pending?"保存中…":"保存"}</button><button type="button" data-scout-rename-cancel ${pending?"disabled":""}>取消</button></div></form>`:""}`;
}

export function scoutingDetailMarkup(view, { selectedCardId = null, pending = false, gold = 0, showSelection = false, reveal = false, movementPlan = null, renameDraft = null, queueRounds = 1, roundIndex = 0, roundChoices = {} } = {}) {
  if (!view) return '<p class="scout-empty">加载中…</p>';
  if (view.kind === "center") return centerMarkup(view, pending, gold);
  const task = view.task, scout = view.scout;
  if (view.error && !task && !scout) return `<p class="scout-empty">${esc(view.error)}</p>`;
  const level = scout?.level ?? task?.level ?? 1;
  const working = task?.status === "working", ready = task?.status === "ready";
  let action;
  if (ready && showSelection) {
    const cards=task.roundCount>1?task.rounds[roundIndex].cards:task.cards;
    if(task.roundCount>1)selectedCardId=roundChoices[roundIndex];
    const queue=task.roundCount>1?`<div class="scout-queue-navigation"><strong>第 ${roundIndex+1} / ${task.roundCount} 轮 · 已选 ${Object.keys(roundChoices).length} 名</strong><span>每轮选一，最后统一领取</span><div>${Array.from({length:task.roundCount},(_,i)=>`<button type="button" data-scout-round="${i}" class="${i===roundIndex?'is-current':''}" ${pending?'disabled':''}>${i+1}${roundChoices[i]?' ✓':''}</button>`).join('')}</div><button type="button" class="scout-primary" data-scout-claim-queue ${pending||Object.keys(roundChoices).length!==task.roundCount?'disabled':''}>统一领取 ${task.roundCount} 名球员</button></div>`:'';
    return `${queue}<div class="inventory-choice-grid" data-choice-count="${cards.length}" aria-busy="${pending}">${cards.map((card,index) => `<article class="inventory-choice-card ${reveal ? "is-revealing" : "is-revealed"}" style="--reveal-index:${index}"><button type="button" class="scout-candidate ${card.playerId === selectedCardId ? "is-selected" : ""}" data-scout-select="${esc(card.playerId)}" ${pending ? "disabled" : ""} aria-label="领取${esc(card.name)}${card.upgradeLevel ? `，强化加${card.upgradeLevel}` : ""}">${playerCardMarkup(card,{eager:true,animated:false})}</button></article>`).join("")}</div>`;
  }
  if (ready) {
    action = `<div class="scout-ready"><h3>发掘完成${task.roundCount>1?` · ${task.roundCount} 轮`:""}</h3><button type="button" class="scout-primary" data-scout-results>查看结果 · ${task.cards?.length??view.rules.choiceCount??3} 选 1</button></div>`;
  } else if (working) {
    action = `<div class="scout-working"><h3>发掘中${task.roundCount>1?` · 已完成 ${task.completedRounds} / ${task.roundCount} 轮`:""}</h3>${progressMarkup(task)}</div>`;
  } else if (movementPlan) {
    action = `<div class="scout-move-plan">${movementRouteMarkup(movementPlan.fromLabel ?? view.territoryLabel, movementPlan.territoryLabel)}<span>${timeLabel(movementPlan.durationMs)}</span><small>${oilMovementText(movementPlan)}</small>${oilMovementChoiceMarkup(movementPlan,"data-scout-use-oil",pending)}<button type="button" class="scout-primary" data-scout-confirm-move ${pending ? "disabled" : ""}>确认移动</button><button type="button" data-scout-dismiss-plan ${pending ? "disabled" : ""}>取消</button></div>`;
  } else if (scout?.movement) {
    action = `<div class="scout-moving"><h3>移动中</h3>${scoutMovementMarkup(scout, { fromLabel:view.sourceLabel, toLabel:view.destinationLabel, pending })}</div>`;
  } else if (view.kind === "legacy") {
    action = '<div class="scout-ready"><h3>球员已加入球队</h3></div>';
  } else {
    const unavailable = pending || !scout || !view.canDiscover || Boolean(view.error);
    action = `<div class="scout-start"><div class="scout-cost"><span>发掘费用<strong>${goldAmountMarkup(view.rules.costGold*queueRounds)}</strong></span><span>时间<strong>${view.rules.durationMs*queueRounds / 60_000} 分钟</strong></span></div><label class="scout-queue-input">连续发掘轮数<select data-scout-rounds ${pending?"disabled":""}>${Array.from({length:20},(_,i)=>`<option value="${i+1}" ${queueRounds===i+1?"selected":""}>${i+1} 轮</option>`).join("")}</select></label><div class="scout-unit-actions"><button type="button" class="scout-primary" data-scout-start ${unavailable || gold < view.rules.costGold*queueRounds ? "disabled" : ""}>${view.neutralTerritory ? "中立地块不可发掘" : gold < view.rules.costGold*queueRounds ? "金币不足" : "开始发掘"}</button><button type="button" data-scout-move ${pending || !scout?.movableTerritoryIds?.length ? "disabled" : ""}>移动</button></div></div>`;
  }
  const countryContext = working || ready || view.kind === "legacy" ? { ...task, rules: view.rules } : view;
  const pools = scout?.movement || movementPlan ? "" : `<div class="scout-pools">${scoutingPoolMarkup(level, view.levelRules ?? scoutingLevel(level))}${scoutingCountryPoolMarkup(countryContext)}</div>`;
  return `<div class="scout-overview scout-unit-overview"><div class="scout-building-art"><img src="${SCOUT_TOKEN_URL}" alt=""></div><div class="scout-unit-identity">${scoutNameMarkup(scout,task,pending||Boolean(view.error),renameDraft)}<span>${esc(view.territoryLabel ?? task?.territoryLabel)}</span>${view.error ? `<p class="scout-error">${esc(view.error)}</p>` : ""}</div></div>${pools}<div class="scout-work-area">${action}</div>`;
}

function keyFor(target) {
  if (!target) return "";
  return target.scoutId ? "unit:" + target.scoutId : target.taskId ? "task:" + target.taskId : `center:${target.territoryId}:${target.buildingId}`;
}
export function createScoutingController({ windowRoot, selectionRoot, notifications, onOpen = () => {}, onMove = () => {}, onDemolish = () => {}, onUpgrade = () => {}, getTerritoryLabel = id => id, getTerritoryInfo = () => null, getCampaignState, getCampaignRequest, campaignStore, onState = () => {}, onProgress = () => {}, showToast = () => {}, now = Date.now, setIntervalImpl = setInterval }) {
  let target = null, view = null, selectedCardId = null, pending = false, version = 0;
  let timeOffset = 0, renderKey = "", noticeKey = "", movementPlan = null;
  let selectionRequested = false, selectionOpened = false, revealedTaskId = null, renameDraft = null;
  let queueRounds=1,roundIndex=0;const queueChoices=new Map();
  const requestIds = new Map();
  const panelContent = windowRoot.querySelector("[data-scout-content]");
  const facilityActions = windowRoot.querySelector("[data-facility-actions]");
  const selectionContent = selectionRoot.querySelector("[data-scout-content]");
  const clock = () => now() + timeOffset;
  const tasks = () => getCampaignState()?.scouting?.tasks ?? [];
  const scouts = () => getCampaignState()?.scouting?.scouts ?? [];
  function render() {
    updateNotices();
    if (!target) return;
    if (view?.task?.status === "claimed") selectionRequested = false;
    const showSelection = selectionRequested && view?.task?.status === "ready";
    if (showSelection !== selectionOpened) {
      selectionOpened = showSelection; renderKey = "";
      if (showSelection) activateStageWindow(selectionRoot);
      else { selectionRoot.hidden = true; deactivateStageWindow(selectionRoot); }
    }
    selectionRoot.classList.toggle('has-scout-queue',showSelection&&view?.task?.roundCount>1);
    windowRoot.hidden = showSelection;
    const heading = windowRoot.querySelector(".scouting-header h2");
    if (heading) heading.textContent = target.buildingId ? "球探中心" : "球探";
    windowRoot.setAttribute("aria-label", target.buildingId ? "球探中心" : "球探");
    windowRoot.classList.toggle("is-scout-center", view?.kind === "center");
    const moving = Boolean(view?.scout?.movement || movementPlan);
    windowRoot.classList.toggle("is-scout-moving", moving);
    windowRoot.classList.toggle("has-scout-pools", Boolean(view && view.kind !== "center" && !moving));
    if (facilityActions) {
      facilityActions.hidden = view?.kind !== "center" || Boolean(view?.error);
      const actions = facilityActionsMarkup({ pending });
      if (facilityActions.innerHTML !== actions) facilityActions.innerHTML = actions;
    }
    const content = showSelection ? selectionContent : panelContent;
    const options = { selectedCardId, pending, gold: getCampaignState()?.wallet?.gold ?? 0, showSelection, movementPlan, renameDraft,queueRounds,roundIndex,roundChoices:queueChoices.get(view?.task?.id)??{} };
    const html = scoutingDetailMarkup(view, options);
    const background = selectionRoot.querySelector("[data-scout-meteors]");
    if (showSelection && background && !background.firstElementChild) background.innerHTML = meteorLayer();
    if (!showSelection) background?.replaceChildren();
    if (html !== renderKey) {
      const input=windowRoot.ownerDocument?.activeElement;
      const editing=input?.matches?.('[data-scout-name-input]');
      const selection=editing?[input.selectionStart,input.selectionEnd]:null;
      const scroll=content.scrollTop??0;
      const offerKey=showSelection?`${view.task.id}:${roundIndex}`:null;
      const reveal = showSelection && !pending && offerKey !== revealedTaskId;
      content.innerHTML = reveal ? scoutingDetailMarkup(view, { ...options, reveal: true }) : html;
      renderKey = html;content.scrollTop=scroll;
      if(editing){const next=content.querySelector?.('[data-scout-name-input]');next?.focus({preventScroll:true});if(next&&selection)next.setSelectionRange(...selection);}
      if (showSelection && !pending) revealedTaskId = offerKey;
    }
    tick();
  }
  function tick() {
    onProgress(clock());
    const items = [...tasks(), ...(view?.task ? [view.task] : [])];
    for (const root of [windowRoot, selectionRoot, notifications]) {
      root.querySelectorAll("[data-scout-progress]").forEach(element => {
        const task = items.find(entry => entry.id === element.dataset.scoutProgress);
        if (!task) return;
        const value = scoutingProgress(task, clock());
        element.setAttribute("aria-valuenow", String(Math.round(value.percent)));
        element.querySelector("i").style.width = `${value.percent}%`;
      });
      root.querySelectorAll("[data-scout-countdown]").forEach(element => {
        const task = items.find(entry => entry.id === element.dataset.scoutCountdown);
        if (task) element.textContent = task.raidPause?.until > clock() ? "豪门压制 · 已暂停" : task.status === "ready" ? "待选球员" : clock() >= task.completesAt ? "正在同步结果…" : timeLabel(task.completesAt - clock());
      });
    }
    const units = new Map(scouts().map(unit => [unit.id, unit]));
    if (view?.scout) units.set(view.scout.id, view.scout);
    for (const root of [windowRoot, notifications]) {
      for (const [selector, attribute] of [["[data-scout-move-progress]", "scoutMoveProgress"], ["[data-scout-move-countdown]", "scoutMoveCountdown"]]) {
        root.querySelectorAll(selector).forEach(element => {
          const movement = units.get(element.dataset[attribute])?.movement;
          if (!movement || String(movement.id ?? "") !== element.dataset.scoutMovementId) return;
          const value = scoutMovementProgress(movement, clock());
          if (attribute === "scoutMoveProgress") {
            element.setAttribute("aria-valuenow", String(Math.round(value.percent)));
            element.querySelector("i").style.width = value.percent.toFixed(1) + "%";
          } else element.textContent = value.remaining > 0 ? timeLabel(value.remaining) : "正在同步位置…";
        });
      }
    }
  }
  function updateNotices() {
    const active = tasks(), moving = scouts().filter(unit => unit.movement);
    notifications.hidden = !active.length && !moving.length;
    const key = JSON.stringify([pending, active.map(({ id, status, territoryLabel, scoutName,completedRounds }) => [id, status, territoryLabel, scoutName,completedRounds]),
      moving.map(unit => [unit.id, unit.name, unit.movement, getTerritoryLabel(unit.movement.fromTerritoryId), getTerritoryLabel(unit.movement.toTerritoryId)])]);
    if (key !== noticeKey) {
      noticeKey = key;
      const movementNotices = moving.map(unit => `<article class="campaign-expedition-card scout-movement-notice"><button type="button" class="campaign-expedition-kicker scout-movement-heading" data-scout-open-moving="${esc(unit.id)}" title="查看 ${esc(unit.name)} 的行程">球探移动中 · ${esc(unit.name)}</button>${scoutMovementMarkup(unit, { fromLabel:getTerritoryLabel(unit.movement.fromTerritoryId), toLabel:getTerritoryLabel(unit.movement.toTerritoryId), pending })}</article>`).join("");
      const taskNotices = active.map(task => `<article class="scout-notice"><span class="scout-eyebrow">${task.status === "ready" ? "球探发掘完成" : "球探发掘中"}</span><strong>${esc(task.scoutName ? task.scoutName + " · " + task.territoryLabel : task.territoryLabel)}</strong>${task.roundCount>1?`<span>队列 ${task.completedRounds} / ${task.roundCount} 轮</span>`:""}${progressMarkup(task)}${task.status === "ready" ? `<button type="button" data-scout-open-task="${esc(task.id)}">打开 · 选择球员</button>` : ""}</article>`).join("");
      notifications.innerHTML = movementNotices + taskNotices;
    }
    tick();
  }
  function close() {
    version += 1; target = null; view = null; selectedCardId = null; renderKey = ""; movementPlan = null; renameDraft = null;
    windowRoot.hidden = true; selectionRoot.hidden = true; selectionRequested = false; selectionOpened = false;
    selectionRoot.querySelector("[data-scout-meteors]")?.replaceChildren();
    deactivateStageWindow(selectionRoot);
  }
  function closeSelection() { selectionRequested = false; render(); }
  registerStageWindow(selectionRoot, { kind: "scouting-selection", onRequestClose: reason => reason === "superseded" ? close() : closeSelection() });
  windowRoot.ownerDocument?.addEventListener("keydown", event => {
    if (!event.defaultPrevented && event.key === "Escape" && target && !selectionOpened) { if(renameDraft&&!pending)cancelRename();else close(); event.preventDefault(); }
  });
  async function load() {
    if (!target) return;
    const current = { ...target }, requestVersion = ++version;
    const route = current.scoutId ? `unit?scoutId=${encodeURIComponent(current.scoutId)}`
      : current.taskId ? `task?taskId=${encodeURIComponent(current.taskId)}`
      : `center?territoryId=${encodeURIComponent(current.territoryId)}&buildingId=${encodeURIComponent(current.buildingId)}`;
    try {
      const result = await getCampaignRequest()("/api/campaign/scouting/" + route);
      if (version !== requestVersion || !target) return;
      timeOffset = (result.serverNow ?? now()) - now(); view = result;
      if (view.scout?.movement) {
        view.sourceLabel = getTerritoryLabel(view.scout.movement.fromTerritoryId);
        view.destinationLabel = getTerritoryLabel(view.scout.movement.toTerritoryId);
      }
      for (const [key, entry] of requestIds) {
        if (entry.target !== keyFor(current)) continue;
        if (entry.kind === "recruit" && (view.scouts?.length ?? 0) >= entry.beforeCount + entry.count) requestIds.delete(key);
        if (entry.kind === "start" && view.task?.id && view.task.id !== entry.beforeTaskId) requestIds.delete(key);
        if (entry.kind === "move" && (view.scout?.movement?.id === entry.id || view.scout?.territoryId === entry.destinationId)) requestIds.delete(key);
      }
    } catch (error) {
      if (version !== requestVersion || !target) return;
      const task = tasks().find(entry => current.scoutId ? entry.scoutId === current.scoutId : entry.id === current.taskId);
      view = { ...view, kind: view?.kind ?? "legacy", task, rules: getCampaignState()?.scouting?.rules, error: error.message || "读取失败" };
    }
    render();
  }
  function open(next, { showResults = false } = {}) {
    if (!getCampaignState()?.setupComplete) return Promise.resolve();
    onOpen();
    target = next.scoutId ? { scoutId: next.scoutId } : next.taskId || next.id ? { taskId: next.taskId ?? next.id } : { territoryId: next.territoryId, buildingId: next.buildingId };
    view = null; selectedCardId = null; renderKey = ""; movementPlan = null; renameDraft = null; selectionRequested = showResults;roundIndex=0;
    render(); return load();
  }
  function openUnit(scoutId, options) { return open({ scoutId }, options); }
  async function planMove(scoutId, territoryId) {
    await openUnit(scoutId);
    const currentKey = keyFor({ scoutId }), accountId = getCampaignState()?.playerId, requestVersion = version;
    if (keyFor(target) !== currentKey || !view?.scout || pending) return;
    pending = true; render();
    try {
      const result = await getCampaignRequest()("/api/campaign/scouting/estimate", { method: "POST", body: { scoutId, territoryId } });
      if (keyFor(target) !== currentKey || getCampaignState()?.playerId !== accountId || version !== requestVersion) return;
      movementPlan = { ...result.estimate, fromLabel:getTerritoryLabel(result.estimate.fromTerritoryId), territoryLabel: getTerritoryLabel(territoryId) };
    } catch (error) { if (getCampaignState()?.playerId === accountId) showToast(error.message || "无法移动"); }
    finally { pending = false; render(); }
  }
  async function perform(kind, count) {
    if (pending || !target || !view) return;
    const current = { ...target }, accountId = getCampaignState()?.playerId, currentKey = keyFor(current);
    const operationKey = `${accountId}:${currentKey}:${kind}:${kind === "start" ? queueRounds : kind === "recruit" ? count : kind === "move" ? `${movementPlan?.toTerritoryId}:${movementPlan?.useOil!==false}` : view.territoryId ?? ""}`;
    let body;
    if(kind==='claim-queue'){
      const selections=queueChoices.get(view.task?.id)??{};
      if(view.task?.status!=='ready'||Object.keys(selections).length!==view.task.roundCount)return;
      body={taskId:view.task.id,cardIds:Array.from({length:view.task.roundCount},(_,i)=>selections[i])};
    }else if (kind === "choose") {
      if (view.task?.status !== "ready" || !view.task.cards.some(card => card.playerId === selectedCardId)) return;
      body = { taskId: view.task.id, cardId: selectedCardId };
    } else {
      if (kind === "start" && (!current.scoutId || !view.canDiscover || view.scout?.status !== "idle")) return;
      if (kind === "recruit" && (!current.buildingId || count > view.recruitAvailable || view.building?.status !== "active")) return;
      if (kind === "move" && !movementPlan) return;
      if (!requestIds.has(operationKey)) requestIds.set(operationKey, { id: createRequestId(), kind, target: currentKey, beforeCount: view.scouts?.length ?? 0, beforeTaskId: view.task?.id, destinationId: movementPlan?.toTerritoryId, count });
      const requestId = requestIds.get(operationKey).id;
      body = kind === "recruit" ? { ...current, count, requestId }
        : { ...(kind==="start"?{rounds:queueRounds}:kind==="move"?{useOil:movementPlan.useOil!==false}:{}),scoutId: current.scoutId, territoryId: kind === "move" ? movementPlan.toTerritoryId : view.territoryId, requestId };
    }
    pending = true; render();
    try {
      const result = await getCampaignRequest()(`/api/campaign/scouting/${kind}`, { method: "POST", body });
      if (getCampaignState()?.playerId !== accountId) return;
      requestIds.delete(operationKey);
      campaignStore.setState(result.state, { source: `scouting-${kind}` }); onState(result.state);
      showToast(kind === "claim-queue" ? `${result.players.length} 名球员已加入球队` : kind === "choose" ? `${result.player.name} 已加入球队`
        : ({ start: "已开始发掘", recruit: "球探已招募", move: "球探开始移动", "cancel-move": "球探已停止移动" })[kind]);
      if (keyFor(target) === currentKey) { selectedCardId = null; movementPlan = null; await load(); }
    } catch (error) {
      if (getCampaignState()?.playerId === accountId) { showToast(error.message || "操作失败，请重试"); if (keyFor(target) === currentKey) await load(); }
    } finally { pending = false; render(); }
  }

  function cancelRename(){renameDraft=null;render();panelContent.querySelector?.('[data-scout-rename]')?.focus({preventScroll:true});}
  async function saveRename(){
    if(pending||!renameDraft||!target?.scoutId||view?.scout?.id!==renameDraft.scoutId)return;
    const draft=renameDraft,currentKey=keyFor(target),accountId=getCampaignState()?.playerId;
    let name;
    try{name=normalizeScoutName(draft.value);}catch(error){draft.error=error.message;render();panelContent.querySelector?.('[data-scout-name-input]')?.focus();return;}
    if(name===view.scout.name){cancelRename();return;}
    draft.error='';pending=true;render();
    try{
      const result=await getCampaignRequest()('/api/campaign/scouting/rename',{method:'POST',body:{scoutId:draft.scoutId,name}});
      if(getCampaignState()?.playerId!==accountId)return;
      if(renameDraft===draft&&keyFor(target)===currentKey)renameDraft=null;
      campaignStore.setState(result.state,{source:'scouting-rename'});onState(result.state);showToast('球探已改名');
    }catch(error){
      if(getCampaignState()?.playerId===accountId&&renameDraft===draft&&keyFor(target)===currentKey)draft.error=error.message||'改名失败，请重试';
    }finally{pending=false;render();}
  }
  windowRoot.addEventListener('input',event=>{if(renameDraft&&event.target.matches?.('[data-scout-name-input]'))renameDraft.value=event.target.value;});
  windowRoot.addEventListener('submit',event=>{if(event.target.matches?.('[data-scout-rename-form]')){event.preventDefault();saveRename();}});

  async function cancelMovement(scoutId, movementId) {
    if (pending || !scoutId || !movementId) return;
    const unit = scouts().find(entry => entry.id === scoutId) ?? (view?.scout?.id === scoutId ? view.scout : null);
    if (!unit?.movement || unit.movement.id !== movementId) return;
    const accountId = getCampaignState()?.playerId;
    pending = true; render();
    try {
      const result = await getCampaignRequest()("/api/campaign/scouting/cancel-move", { method:"POST", body:{scoutId, movementId} });
      if (getCampaignState()?.playerId !== accountId) return;
      campaignStore.setState(result.state, {source:"scouting-cancel-move"}); onState(result.state);
      showToast("球探已停止移动");
      if (target?.scoutId === scoutId) await load();
    } catch (error) {
      if (getCampaignState()?.playerId === accountId) {
        showToast(error.message || "停止移动失败，请重试");
        if (target?.scoutId === scoutId) await load();
      }
    } finally { pending = false; render(); }
  }
  for (const root of [windowRoot, selectionRoot]) root.addEventListener("click", event => {
    if (event.target.closest?.("[data-scout-close]")) return close();
    if(event.target.closest?.('[data-scout-rename]')&&!pending&&view?.scout&&!view.error){renameDraft={scoutId:view.scout.id,value:view.scout.name,error:''};render();const input=panelContent.querySelector?.('[data-scout-name-input]');input?.focus({preventScroll:true});input?.select();return;}
    if(event.target.closest?.('[data-scout-rename-cancel]')&&!pending){cancelRename();return;}
    const upgrade=event.target.closest?.('[data-facility-upgrade]');
    if(upgrade&&!upgrade.disabled&&!pending&&target)return onUpgrade({territoryId:target.territoryId,buildingId:target.buildingId});
    const demolish = event.target.closest?.("[data-facility-demolish]");
    if (demolish && !demolish.disabled && !pending && view?.kind === "center" && !view.error) return onDemolish({ territoryId: target.territoryId, buildingId: target.buildingId }, demolish);
    if (event.target.closest?.("[data-scout-results]")) { selectionRequested = true; render(); return; }
    const select = event.target.closest?.("[data-scout-select]");
    const round=event.target.closest?.('[data-scout-round]');if(round&&!pending){roundIndex=Number(round.dataset.scoutRound);render();return;}
    if(event.target.closest?.('[data-scout-claim-queue]')){perform('claim-queue');return;}
    if (select && !pending) {
      selectedCardId=select.dataset.scoutSelect;
      if(view.task?.roundCount>1){const choices=queueChoices.get(view.task.id)??{};choices[roundIndex]=selectedCardId;queueChoices.set(view.task.id,choices);const next=Array.from({length:view.task.roundCount},(_,i)=>i).find(i=>!choices[i]);if(next!=null)roundIndex=next;render();}
      else perform("choose");return;
    }
    const recruit = event.target.closest?.("[data-scout-recruit]");
    if (recruit && !recruit.disabled) { perform("recruit", Number(recruit.dataset.scoutRecruit)); return; }
    const unit = event.target.closest?.("[data-scout-open-unit]");
    if (unit && !pending) { openUnit(unit.dataset.scoutOpenUnit); return; }
    const legacy = event.target.closest?.("[data-scout-legacy-task]");
    if (legacy && !pending) { open({ taskId: legacy.dataset.scoutLegacyTask }, { showResults: true }); return; }
    if (event.target.closest?.("[data-scout-start]")) { perform("start"); return; }
    if (event.target.closest?.("[data-scout-move]") && !pending && target?.scoutId) { onMove(target.scoutId); return; }
    if (event.target.closest?.("[data-scout-confirm-move]")) { perform("move"); return; }
    const abort = event.target.closest?.("[data-scout-cancel-move]");
    if (abort) { cancelMovement(abort.dataset.scoutCancelMove, abort.dataset.scoutMovementId); return; }
    if (event.target.closest?.("[data-scout-dismiss-plan]") && !pending) { movementPlan = null; render(); return; }
    if (root === selectionRoot && !select && !pending) closeSelection();
  });
  windowRoot.addEventListener("change",event=>{
    if(event.target.matches?.("[data-scout-use-oil]")&&!pending&&movementPlan){movementPlan=applyMovementOilChoice(movementPlan,event.target.value!=="slow","scout");render();return;}
    if(event.target.matches?.("[data-scout-rounds]")&&!pending){queueRounds=Math.max(1,Math.min(20,Number(event.target.value)||1));render();}});
  notifications.addEventListener("click", event => {
    const abort = event.target.closest?.("[data-scout-cancel-move]");
    if (abort) { cancelMovement(abort.dataset.scoutCancelMove, abort.dataset.scoutMovementId); return; }
    const moving = event.target.closest?.("[data-scout-open-moving]");
    if (moving) { openUnit(moving.dataset.scoutOpenMoving); return; }
    const button = event.target.closest?.("[data-scout-open-task]");
    const task = tasks().find(entry => entry.id === button?.dataset.scoutOpenTask);
    if (task?.status === "ready") open(task, { showResults: true });
  });
  campaignStore.subscribe(({ state, previousState }) => {
    if (previousState?.playerId !== state?.playerId) { queueChoices.clear();close(); requestIds.clear(); revealedTaskId = null; }
    if (state?.scouting?.serverNow) timeOffset = state.scouting.serverNow - now();
    if (target && view) {
      if (target.scoutId) {
        const scout = state?.scouting?.scouts?.find(entry => entry.id === target.scoutId);
        if (scout) {
          if (view.territoryId !== scout.territoryId) {
            const metadata = getTerritoryInfo(scout.territoryId);
            view.countryCode = metadata?.countryCode ?? null;
            view.coreCountry = metadata ? CORE_COUNTRY_CODES.includes(metadata.countryCode) : null;
          }
          view.scout = scout; view.territoryId = scout.territoryId; view.territoryLabel = scout.territoryLabel;
          view.canDiscover = canUseTerritory(state.world,state.playerId,scout.territoryId);
          view.sourceLabel = getTerritoryLabel(scout.movement?.fromTerritoryId);
          view.destinationLabel = getTerritoryLabel(scout.movement?.toTerritoryId);
          const task = tasks().find(entry => entry.scoutId === target.scoutId);
          if (task) view.task = task;
          else if (view.task) view.task = { ...view.task, status: "claimed", cards: [] };
          if (scout.status !== "idle") movementPlan = null;
        } else { view.error = "球探已不可用"; view.canDiscover = false; renameDraft=null; }
      } else if (target.taskId) {
        const task = tasks().find(entry => entry.id === target.taskId);
        if (task) view.task = task;
        else if (view.task) view.task = { ...view.task, status: "claimed", cards: [] };
      } else if (view.kind === "center") {
        const building = state.buildings?.territories?.[target.territoryId]?.buildings?.find(entry => entry.id === target.buildingId);
        if (building) { view.building = building; view.error = null; }
        else { close(); updateNotices(); return; }
        view.scouts = state.scouting?.scouts ?? [];
        view.capacity = state.scouting?.capacity ?? 2;
        view.recruitAvailable = Math.max(0, view.capacity - view.scouts.length);
        view.legacyTasks = tasks().filter(task => !task.scoutId);
      }
      render();
    }
    updateNotices();
  });
  setIntervalImpl(tick, 1000); updateNotices();
  return { open, openUnit, planMove, close, refresh:render, getServerNow: clock };
}
