import { goldAmountMarkup } from "../ui/currency.js";
import { facilityArtIcon } from '../../shared/config/facility-art.mjs';
import { facilityActionsMarkup } from "./facility-actions-controller.js?v=20260909-infrastructure-v1";
import { createRequestId } from "../core/request-id.js?v=20260906-release-v01";
import { TRAINING_POOLS, TRAINING_RULES, trainingCapacity, trainingCostGold } from "../../shared/config/training.mjs";
import { PLAYER_ATTRIBUTE_LABELS } from "../../shared/config/player-attributes.mjs";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";
import { playerCardMarkup, escapePlayerCardHtml as esc } from "../player-card/player-card.js?v=20260906-card-scroll-v1";

export function trainingProgress(task, now) {
  now = Math.max(now, task.raidPause?.until ?? 0);
  return { percent: Math.max(0, Math.min(100, 100 * (now - task.startedAt) / Math.max(1, task.completesAt - task.startedAt))), remaining: Math.max(0, task.completesAt - now) };
}
function timeLabel(ms) { const seconds = Math.ceil(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function trainingProgressMarkup(task) {
  return `<span class="training-progress" data-training-progress="${esc(task.id)}" role="progressbar" aria-label="${esc(task.playerName)}训练进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></span><small data-training-countdown="${esc(task.id)}">训练中</small>`;
}
export function trainingNotificationsMarkup(tasks = [], { pending = false } = {}) {
  return tasks.filter((task) => task.status === "working").map((task) => `<article class="training-notice"><header><span>球员训练中</span><small>${esc(TRAINING_POOLS[task.pool])}</small></header><strong>${esc(task.playerName)}</strong>${trainingProgressMarkup(task)}<button type="button" data-training-cancel="${esc(task.id)}" ${pending ? "disabled" : ""} aria-label="取消${esc(task.playerName)}的训练">${task.costGold > 0 ? "取消并退款" : "取消"}</button></article>`).join("");
}
export function trainingResultMarkup(player, gains = {}, task = {}) {
  const rating = task.overallBefore != null && task.overallAfter != null
    ? `总评 ${esc(task.overallBefore)} → ${esc(task.overallAfter)}${task.overallAfter > task.overallBefore ? `（+${esc(task.overallAfter - task.overallBefore)}）` : "（本次未升档）"}` : "";
  return `<div class="training-result-card">${playerCardMarkup(player)}</div><section class="training-attributes" aria-label="26项能力及本次训练提升"><header><h3>26 项能力</h3><span>本次训练 +${Object.values(gains).reduce((sum, value) => sum + value, 0)}</span></header>${rating ? `<p class="training-overall">${rating}</p>` : ""}<p class="training-growth-hint">总评按本职核心能力计算，训练成长持续累计。</p>${task.refundedGold > 0 ? `<p class="training-growth-hint">属性达到上限，未生效点数已退还 ${goldAmountMarkup(task.refundedGold)}</p>` : ""}<dl>${Object.entries(PLAYER_ATTRIBUTE_LABELS).map(([key, label]) => {
    const value = player.attributes?.[key], gain = gains[key] ?? 0;
    return `<div class="${gain ? "is-improved" : ""}"><dt>${label}</dt><dd>${value == null ? "—" : esc(value)}${gain ? `<em>+${gain}</em>` : ""}</dd></div>`;
  }).join("")}</dl></section>`;
}
export function trainingPanelMarkup(view, { pending = false } = {}) {
  if (!view) return '<p class="training-empty">正在读取训练中心…</p>';
  if (view.error) return `<p class="training-empty">${esc(view.error)}</p>`;
  return `<div class="training-overview"><img src="${facilityArtIcon("training-center", view.building.level)}" alt=""><div><small>LV.${view.building.level}</small><strong>${esc(view.territoryLabel)}</strong></div></div><p class="training-rule">每次 10 分钟 · 能力总计 +${Number(view.rules?.attributePoints??5)}${view.rules?.canSelectAttribute?" · 可指定 1 点属性":" · 随机分配"}</p><div class="training-groups">${Object.entries(TRAINING_POOLS).map(([pool, label]) => `<section class="training-group"><header><h3>${label}</h3><small>${view.tasks.filter((task) => task.buildingId === view.building.id && task.pool === pool && task.status === "working").length} / ${view.capacity}</small></header><div class="training-seats">${Array.from({ length: view.capacity }, (_, slot) => {
    const task = view.tasks.find((entry) => entry.buildingId === view.building.id && entry.pool === pool && entry.slot === slot);
    const working = task?.status === "working";
    const player = task && view.players?.find((entry) => entry.playerId === task.playerId);
    return `<button type="button" class="training-seat ${task ? "is-occupied" : "is-empty"} ${task?.status === "completed" ? "is-completed" : ""}" data-training-pool="${pool}" data-training-slot="${slot}" ${pending || view.building.status !== "active" || working ? "disabled" : ""}>${task ? `${player ? playerCardMarkup(player, { variant: "mini", className: "training-seat-card" }) : `<strong>${esc(task.playerName)}</strong>`}${working ? trainingProgressMarkup(task) : '<span class="training-completed">✓ 训练完成</span><small>查看能力提升</small>'}` : '<b class="training-plus">＋</b><span>选择球员</span>'}</button>`;
  }).join("")}</div></section>`).join("")}</div>`;
}
const TRAINING_SQUAD_FILTERS = { all: "全部", expedition: "远征", garrison: "留守" };
export function trainingPickerMarkup(players, pool, { pending = false, squadFilter = "all" } = {}) {
  const ability = (player) => Number(player.effectiveOverall ?? player.overall) || 0;
  const eligible = players.filter((player) => player.pool === pool && (squadFilter === "all" || (squadFilter === "expedition" ? player.expedition === true : player.expedition !== true)))
    .sort((left, right) => ability(right) - ability(left) || String(left.playerId).localeCompare(String(right.playerId)));
  const filters = `<div class="training-squad-filters" role="group" aria-label="按编队筛选训练球员">${Object.entries(TRAINING_SQUAD_FILTERS).map(([id, label]) => `<button type="button" data-training-squad="${id}" class="${id === squadFilter ? "is-active" : ""}" aria-pressed="${id === squadFilter}" ${pending ? "disabled" : ""}>${label}</button>`).join("")}</div>`;
  return `${filters}<p class="training-picker-hint">点击球员支付下方费用开训，总评越高费用越高。未完成取消全额退款；远征球员训练期间比赛自动替补。</p><div class="training-card-list"><div class="training-player-grid">${eligible.map((player) => `<button type="button" class="training-player" data-training-player="${esc(player.playerId)}" ${pending || player.training || !player.canTrain || player.canAfford === false ? "disabled" : ""}>${playerCardMarkup(player, { deferred: true })}<span class="training-price">${goldAmountMarkup(player.costGold ?? trainingCostGold(player))}</span><span>${player.training ? "训练中" : !player.canTrain ? "暂不可训练" : player.canAfford === false ? "金币不足" : player.expedition ? "远征 · 比赛时自动替补" : "留守"}</span></button>`).join("") || '<p class="training-empty">当前筛选下暂无该位置球员</p>'}</div></div>`;
}

export function createTrainingController({ windowRoot, pickerRoot, notifications = null, getCampaignState, getCampaignRequest, campaignStore, onOpen = () => {}, onState = () => {}, onDemolish = () => {}, onUpgrade = () => {}, showToast = () => {}, now = Date.now, setIntervalImpl = setInterval }) {
  let target = null, view = null, selection = null, pending = false, version = 0, offset = 0;
  let squadFilter = "all";
  let pickerRenderKey = null, pickerHtml = null;
  const requestIds = new Map();
  const content = windowRoot.querySelector("[data-training-content]");
  const facilityActions = windowRoot.querySelector("[data-facility-actions]");
  const pickerContent = pickerRoot.querySelector("[data-training-picker-content]");
  const pickerTitle = pickerRoot.querySelector("[data-training-picker-title]");
  const clock = () => now() + offset;
  function tick() {
    const tasks = new Map([...(getCampaignState()?.training?.tasks ?? []), ...(view?.tasks ?? [])].map((task) => [task.id, task]));
    for (const root of [windowRoot, notifications].filter(Boolean)) {
      for (const element of root.querySelectorAll("[data-training-progress]")) {
        const task = tasks.get(element.dataset.trainingProgress);
        if (!task) continue;
        const progress = trainingProgress(task, clock());
        element.setAttribute("aria-valuenow", String(Math.round(progress.percent)));
        element.querySelector("i").style.width = `${progress.percent}%`;
      }
      for (const element of root.querySelectorAll("[data-training-countdown]")) {
        const task = tasks.get(element.dataset.trainingCountdown);
        if (task) element.textContent = task.raidPause?.until > clock() ? "豪门压制 · 已暂停" : clock() >= task.completesAt ? "正在结算…" : `剩余 ${timeLabel(task.completesAt - clock())}`;
      }
    }
  }
  function updateNotices() {
    if (!notifications) return;
    const html = trainingNotificationsMarkup(getCampaignState()?.training?.tasks, { pending });
    notifications.hidden = !html;
    if (notifications.innerHTML !== html) notifications.innerHTML = html;
    tick();
  }
  function render() {
    updateNotices();
    if (!target) return;
    windowRoot.hidden = false;
    const panelScroll = content.scrollTop;
    content.innerHTML = trainingPanelMarkup(view, { pending });
    content.scrollTop = panelScroll;
    if (facilityActions) {
      facilityActions.hidden = !view || Boolean(view.error);
      const actions = facilityActionsMarkup({ pending });
      if (facilityActions.innerHTML !== actions) facilityActions.innerHTML = actions;
    }
    pickerRoot.hidden = !selection || !view || Boolean(view.error);
    if (!pickerRoot.hidden) {
      const task = view.tasks.find((entry) => entry.id === selection.taskId);
      const player = task && view.players.find((entry) => entry.playerId === task.playerId);
      const result = task?.status === "completed" && player;
      pickerTitle.textContent = result ? `${player.name} · 训练提升` : `${TRAINING_POOLS[selection.pool]} · 选择训练球员`;
      const renderKey = JSON.stringify([target.territoryId, target.buildingId, selection.pool, selection.slot, result ? task.id : "pick", squadFilter]);
      const html = result ? `<div class="training-result-body">${trainingResultMarkup(player, task.gains, task)}</div><footer class="training-result-actions"><button class="training-again" data-training-again type="button" ${pending ? "disabled" : ""}>安排下一次训练</button><button class="training-finish" data-training-finish type="button" ${pending ? "disabled" : ""}>训练完成</button></footer>` : `${view.rules?.canSelectAttribute?`<label class="wonder-training-attribute">阿尔罕布拉宫 · 指定 1 点属性<select data-training-attribute ${pending?"disabled":""}><option value="">随机分配</option>${Object.entries(PLAYER_ATTRIBUTE_LABELS).map(([key,label])=>`<option value="${key}" ${selection.attribute===key?"selected":""}>${esc(label)}</option>`).join("")}</select></label>`:""}${trainingPickerMarkup(view.players, selection.pool, { pending, squadFilter })}`;
      // Deferred card rendering mutates the DOM, so compare generated markup
      // against the last render, not against the hydrated element.innerHTML.
      if (html !== pickerHtml || renderKey !== pickerRenderKey) {
        const sameSelection = renderKey === pickerRenderKey;
        const scrollerSelector = result ? ".training-result-body" : ".training-card-list";
        const scrollTop = sameSelection ? pickerContent.querySelector?.(scrollerSelector)?.scrollTop ?? 0 : 0;
        const outerScroll = sameSelection ? pickerContent.scrollTop : 0;
        const focusedPlayer = sameSelection && pickerRoot.ownerDocument?.activeElement?.closest?.("[data-training-player]")?.dataset.trainingPlayer;
        pickerContent.innerHTML = html;
        pickerHtml = html; pickerRenderKey = renderKey;
        const scroller = pickerContent.querySelector?.(scrollerSelector);
        if (scroller) scroller.scrollTop = scrollTop;
        pickerContent.scrollTop = outerScroll;
        if (focusedPlayer) [...(pickerContent.querySelectorAll?.("[data-training-player]") ?? [])].find(node => node.dataset.trainingPlayer === focusedPlayer)?.focus({preventScroll:true});
      }
      if(view.rules?.canSelectAttribute){const attribute=pickerContent.querySelector("[data-training-attribute]");if(attribute)attribute.onchange=()=>{selection.attribute=attribute.value||null;};}
    } else {
      pickerRenderKey = null; pickerHtml = null;
    }
    tick();
  }
  function close() { pickerRenderKey = null; pickerHtml = null; version += 1; target = null; view = null; selection = null; windowRoot.hidden = true; pickerRoot.hidden = true; }
  async function load() {
    if (!target) return;
    const requestVersion = ++version, current = { ...target };
    try {
      const result = await getCampaignRequest()(`/api/campaign/training/center?territoryId=${encodeURIComponent(current.territoryId)}&buildingId=${encodeURIComponent(current.buildingId)}`);
      if (requestVersion !== version || !target) return;
      view = result; offset = result.serverNow - now();
    } catch (error) {
      if (requestVersion !== version || !target) return;
      view = { error: error.message || "读取训练中心失败" };
    }
    render();
  }
  function open(value) {
    if (!getCampaignState()?.setupComplete) return;
    onOpen(); squadFilter = "all"; target = { ...value }; view = null; selection = null; render(); load();
  }
  async function start(playerId) {
    if (pending || !target || !selection || !view || view.error) return;
    const player = view.players.find((entry) => entry.playerId === playerId && entry.pool === selection.pool);
    if (!player || player.training || !player.canTrain || player.canAfford === false) return;
    const accountId = getCampaignState()?.playerId, current = { ...target }, selected = { ...selection };
    const key = `${accountId}:${current.buildingId}:${selected.pool}:${selected.slot}:${playerId}:${selected.attribute??"random"}`;
    if (!requestIds.has(key)) requestIds.set(key, createRequestId());
    const requestVersion = ++version;
    pending = true; render();
    try {
      const result = await getCampaignRequest()("/api/campaign/training/start", { method: "POST", body: { ...current, pool: selected.pool, slot: selected.slot, playerId, attribute:selected.attribute??null, requestId: requestIds.get(key) } });
      if (getCampaignState()?.playerId !== accountId) return;
      requestIds.delete(key);
      if (version === requestVersion) selection = null;
      campaignStore.setState(result.state, { source: "training-start" }); onState(result.state);
      showToast(`${player.name} 已开始训练`);
      if (version === requestVersion) await load();
    } catch (error) {
      if (getCampaignState()?.playerId === accountId) { showToast(error.message || "训练开始失败，请重试"); if (version === requestVersion) await load(); }
    } finally { pending = false; render(); }
  }
  async function finish() {
    if (pending || !target || !selection || !view || view.error) return;
    const task = view.tasks.find((entry) => entry.id === selection.taskId && entry.status === "completed");
    if (!task) return;
    const accountId = getCampaignState()?.playerId, requestVersion = ++version;
    pending = true; render();
    try {
      const result = await getCampaignRequest()("/api/campaign/training/finish", { method: "POST", body: { taskId: task.id } });
      if (getCampaignState()?.playerId !== accountId) return;
      if (version === requestVersion && selection?.taskId === task.id) selection = null;
      campaignStore.setState(result.state, { source: "training-finish" }); onState(result.state);
      showToast(`${task.playerName} 的训练已完成，席位已腾空`);
      if (target && version === requestVersion) await load();
    } catch (error) {
      if (getCampaignState()?.playerId === accountId) {
        showToast(error.message || "收起训练结果失败，请重试");
        if (target && version === requestVersion) await load();
      }
    } finally { pending = false; render(); }
  }
  async function cancel(taskId) {
    if (pending) return;
    const task = getCampaignState()?.training?.tasks?.find((entry) => entry.id === taskId && entry.status === "working");
    if (!task) return;
    const accountId = getCampaignState()?.playerId, requestVersion = ++version;
    pending = true; render();
    try {
      const result = await getCampaignRequest()("/api/campaign/training/cancel", { method: "POST", body: { taskId } });
      if (getCampaignState()?.playerId !== accountId) return;
      campaignStore.setState(result.state, { source: "training-cancel" }); onState(result.state);
      showToast(result.task.status === "completed" ? `${task.playerName} 的训练已完成` : `${task.playerName} 的训练已取消${result.task.refundedGold > 0 ? `，退还 ${result.task.refundedGold.toLocaleString("zh-CN")} 金币` : ""}`);
      if (target && version === requestVersion) await load();
    } catch (error) {
      if (getCampaignState()?.playerId === accountId) {
        showToast(error.message || "取消训练失败，请重试");
        if (target && version === requestVersion) await load();
      }
    } finally { pending = false; render(); }
  }
  notifications?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-training-cancel]");
    if (button && !button.disabled) cancel(button.dataset.trainingCancel);
  });
  windowRoot.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-training-close]")) return close();
    const upgrade=event.target.closest?.('[data-facility-upgrade]');
    if(upgrade&&!upgrade.disabled&&!pending&&target)return onUpgrade({territoryId:target.territoryId,buildingId:target.buildingId});
    const demolish = event.target.closest?.("[data-facility-demolish]");
    if (demolish && !demolish.disabled && !pending && view && !view.error) return onDemolish({ territoryId: target.territoryId, buildingId: target.buildingId }, demolish);
    const button = event.target.closest?.("[data-training-pool]");
    if (!button || button.disabled || pending || !view || view.error) return;
    const pool = button.dataset.trainingPool, slot = Number(button.dataset.trainingSlot);
    const task = view.tasks.find((entry) => entry.buildingId === target.buildingId && entry.pool === pool && entry.slot === slot);
    if (task?.status === "working") return;
    selection = { pool, slot, taskId: task?.id }; render();
  });
  pickerRoot.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-training-picker-close]")) { selection = null; render(); return; }
    if (event.target.closest?.("[data-training-finish]")) { finish(); return; }
    if (event.target.closest?.("[data-training-again]")) { if (!pending && selection) { selection.taskId = null; render(); } return; }
    const filter = event.target.closest?.("[data-training-squad]");
    if (filter && !pending && Object.hasOwn(TRAINING_SQUAD_FILTERS, filter.dataset.trainingSquad)) {
      squadFilter = filter.dataset.trainingSquad; render(); return;
    }
    const button = event.target.closest?.("[data-training-player]");
    if (button && !button.disabled) start(button.dataset.trainingPlayer);
  });
  windowRoot.ownerDocument?.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.key !== "Escape" || !target) return;
    if (selection) { selection = null; render(); } else close();
    event.preventDefault();
  });
  campaignStore.subscribe(({ state, previousState }) => {
    if (state?.playerId !== previousState?.playerId) { close(); requestIds.clear(); }
    if (state?.training?.serverNow) offset = state.training.serverNow - now();
    updateNotices();
    if (!target || !view || view.error) return;
    const building = state.buildings?.territories?.[target.territoryId]?.buildings?.find((entry) => entry.id === target.buildingId);
    if (!building) { close(); return; }
    view.building = building; view.capacity = trainingCapacity(building.level);
    view.tasks = state.training?.tasks ?? [];
    view.rules = state.training?.rules ?? view.rules;
    view.gold = state.wallet?.gold ?? view.gold;
    if (selection?.taskId && !view.tasks.some((task) => task.id === selection.taskId)) selection = null;
    view.players = (state.draft?.roster ?? []).map((player) => {
      const card = createPlayerCardViewModel(player);
      const headroom = Object.keys(PLAYER_ATTRIBUTE_LABELS).reduce((sum, key) => sum + (Number.isFinite(card.attributes[key]) ? Math.max(0, Math.floor(TRAINING_RULES.attributeMaximum - card.attributes[key])) : 0), 0);
      return { ...card, costGold: trainingCostGold(card), canAfford: view.gold == null || view.gold >= trainingCostGold(card), training: player.training, expedition: state.playerSquads?.assignments?.[card.playerId] === "expedition", canTrain: !player.medical && headroom >= (view.rules?.attributePoints ?? TRAINING_RULES.attributePoints) };
    });
    render();
  });
  offset = (getCampaignState()?.training?.serverNow ?? now()) - now();
  updateNotices();
  setIntervalImpl(tick, 1000);
  return { open, close };
}
