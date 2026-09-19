import {advancedResearchTopic} from '../../shared/config/advanced-research.mjs';
import { researchProgress, researchRemainingTime, FORMATION_RESEARCH_DIRECTIONS } from '../../shared/config/formation-research.mjs';
import { productionConstructionProgress } from '../../shared/buildings/construction-production.mjs';
import { facilityArtIcon } from '../../shared/config/facility-art.mjs';
import { escapePlayerCardHtml as esc } from "../player-card/player-card.js?v=20260905-shield-v1";

export function constructionProgress(building, now) {
  const production = productionConstructionProgress(building, now);
  if (production) return production;
  const end = Number(building.completesAt);
  const start = Number(building.constructionStartedAt);
  if (!Number.isFinite(end) || end <= 0) return { percent: 0, remaining: null };
  return {
    percent: Number.isFinite(start) && start > 0 && start < end
      ? Math.max(0, Math.min(100, 100 * (now - start) / (end - start))) : now >= end ? 100 : 0,
    remaining: Math.max(0, end - now),
  };
}

function ownedBuildings(state, getTerritoryLabel) {
  if (!state?.playerId) return [];
  const catalog = new Map((state.buildings?.catalog ?? []).map(entry => [entry.type, entry]));
  return Object.entries(state.buildings?.territories ?? {}).flatMap(([territoryId, territory]) => {
    if (!territory.canManage || territory.ownerId !== state.playerId) return [];
    return (territory.buildings ?? []).filter(b => ["constructing", "active"].includes(b.status)).map(b => {
      const definition = catalog.get(b.type) ?? {};
      return { ...b, status:b.upgradeTo?"constructing":b.status,isUpgrade:Boolean(b.upgradeTo||b.upgradeCompletedAt),level:b.upgradeTo??b.level, territoryId, territoryLabel: getTerritoryLabel(territoryId),
        label: b.name || b.label || definition.label || "设施",
        iconPath: facilityArtIcon(b.type, b.level) || b.iconPath || definition.iconPath || "" };
    });
  });
}

export function constructionNotificationsMarkup(items = []) {
  return items.map(item => `<article class="construction-notice ${item.status === "active" ? "is-complete" : ""}">
    <header><span>${item.isUpgrade?(item.status==="active"?"设施升级完成":"设施升级中"):(item.status === "active" ? "设施建成" : "设施施工中")}</span><small>LV.${Number(item.level) || 1}</small></header>
    ${item.iconPath ? `<img class="construction-notice-icon" src="${esc(item.iconPath)}" alt="" decoding="async">` : '<span class="construction-notice-icon" aria-hidden="true"></span>'}
    <div class="construction-notice-identity"><strong>${esc(item.label)}</strong><small>${esc(item.territoryLabel)}</small></div>
    <button type="button" data-construction-locate="${esc(item.id)}" aria-label="查看${esc(item.label)}所在的${esc(item.territoryLabel)}" title="定位到地块">↗</button>
    <span class="construction-progress" data-construction-progress="${esc(item.id)}" role="progressbar" aria-label="${esc(item.label)}施工进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></span>
    <footer><span data-construction-time="${esc(item.id)}"></span><b data-construction-percent="${esc(item.id)}"></b></footer>
  </article>`).join("");
}

export function wonderCompetitionNoticesMarkup(notices=[]){
 const number=value=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(value);
 return notices.map(n=>`<article class="construction-notice wonder-race-notice" role="status"><header><span>奇观建造已中止</span></header><div class="wonder-race-message"><strong>${esc(n.label)}</strong><p>${esc(n.winnerName)}已率先建成，该奇观全服唯一。</p><p>已返还 ${number(n.refundProduction)} 一次性生产力（已投入的 50%）。</p></div><footer>${n.rewardAvailable?`<button type="button" data-wonder-race-reward="${esc(n.rewardId)}">使用生产力</button>`:'<span></span>'}<button type="button" data-wonder-race-dismiss="${esc(n.id)}">已读</button></footer></article>`).join('');
}

export function researchNoticeMarkup(research){
 const job=research?.active;if(!job)return '';
 const topic=advancedResearchTopic(job.topicId);
 const slot=research.slots.find(s=>s.id===job.slotId),direction=FORMATION_RESEARCH_DIRECTIONS.find(d=>d.id===job.direction);
 return `<article class="construction-notice research-notice"><header><span>${topic?(topic.branch==='biology'?'生物研究中':'强化研究中'):'阵型研究中'}</span><b>Lv.${job.level}</b></header><strong class="research-notice-title">${topic?esc(topic.label):`${esc(slot?.name)} · ${esc(direction?.label)}`}</strong><span class="construction-progress" data-research-notice-progress role="progressbar" aria-label="研究进度" aria-valuemin="0" aria-valuemax="100"><i></i></span><footer><span data-research-notice-time></span><b data-research-notice-percent></b><button type="button" data-cancel-research="${esc(job.id)}">中止</button></footer></article>`;
}

export function createConstructionNotifications({
  notifications, campaignStore, getCampaignState = campaignStore.getState,
  getTerritoryLabel = id => id, onLocate = () => {}, onDismissWonder = () => {}, onUseProduction = () => {}, onCancelResearch = () => {}, now = Date.now,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
} = {}) {
  let playerId = null, offset = 0, serverSample = null, timer = null, renderKey = null, destroyed = false;
  let items = [], previous = new Map();
  const completed = new Map();
  const clock = () => now() + offset;
  function paintProgress() {
    const job=getCampaignState()?.formationResearch?.active,researchValue=researchProgress(job,clock()),bar=job?notifications.querySelector('[data-research-notice-progress]'):null;
    if(researchValue&&bar){bar.setAttribute('aria-valuenow',String(Math.floor(researchValue.percent)));bar.querySelector('i').style.width=researchValue.percent+'%';notifications.querySelector('[data-research-notice-percent]').textContent=Math.floor(researchValue.percent)+'%';notifications.querySelector('[data-research-notice-time]').textContent=researchRemainingTime(researchValue.remaining);}

    const byId = new Map(items.map(item => [item.id, item]));
    const progress = item => item.status === "active" ? { percent: 100, remaining: 0 } : constructionProgress(item, clock());
    for (const node of notifications.querySelectorAll("[data-construction-progress]")) {
      const item = byId.get(node.dataset.constructionProgress); if (!item) continue;
      const value = progress(item);
      node.setAttribute("aria-valuenow", String(Math.round(value.percent)));
      node.querySelector("i").style.width = `${value.percent}%`;
    }
    for (const node of notifications.querySelectorAll("[data-construction-time]")) {
      const item = byId.get(node.dataset.constructionTime); if (!item) continue;
      const { remaining } = progress(item);
      const seconds = Math.ceil((remaining ?? 0) / 1000);
      node.textContent = item.status === "active" ? "已完成" : remaining === null ? "等待生产力" : remaining === 0 ? "等待完工确认…"
        : `剩余 ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }
    for (const node of notifications.querySelectorAll("[data-construction-percent]")) {
      const item = byId.get(node.dataset.constructionPercent);
      if (item) node.textContent = `${Math.round(progress(item).percent)}%`;
    }
  }
  function refresh({ syncClock = false } = {}) {
    if (destroyed) return;
    const state = getCampaignState();
    if (playerId !== (state?.playerId ?? null)) {
      playerId = state?.playerId ?? null; previous.clear(); completed.clear(); offset = 0; serverSample = null;
    }
    if (syncClock) {
      const serverNow = Number(state?.formationResearch?.serverNow ?? state?.scouting?.serverNow ?? state?.training?.serverNow);
      if (Number.isFinite(serverNow) && serverNow > 0 && serverNow !== serverSample) { offset = serverNow - now(); serverSample = serverNow; }
    }
    const buildings = ownedBuildings(state, getTerritoryLabel);
    const current = new Map(buildings.map(item => [item.id, item]));
    for (const item of buildings) {
      if (item.status === "active" && previous.get(item.id)?.status === "constructing") completed.set(item.id, now() + 8000);
    }
    for (const [id, expiresAt] of completed) if (!current.has(id) || expiresAt <= now()) completed.delete(id);
    previous = current;
    items = buildings.filter(item => item.status === "constructing" || completed.has(item.id))
      .sort((a, b) => Number(a.completesAt) - Number(b.completesAt) || a.id.localeCompare(b.id));
    const pending=new Set((state?.neutralRewards?.pending??[]).map(r=>r.id));
    const notices=(state?.wonders?.competitionNotices??[]).map(n=>({...n,rewardAvailable:pending.has(n.rewardId)}));
    const research=state?.formationResearch,job=research?.active;
    const key = JSON.stringify({items,notices,job,slots:job?research.slots:undefined});
    notifications.hidden = !items.length&&!notices.length&&!job;
    if (key !== renderKey) { renderKey = key; notifications.innerHTML = researchNoticeMarkup(research)+wonderCompetitionNoticesMarkup(notices)+constructionNotificationsMarkup(items); }
    paintProgress();
    if ((items.length||job) && timer === null) timer = setIntervalImpl(refresh, 1000);
    if (!items.length && !job && timer !== null) { clearIntervalImpl(timer); timer = null; }
  }
  function locate(event) {
    const researchId=event.target.closest("[data-cancel-research]")?.dataset.cancelResearch;if(researchId){onCancelResearch(researchId);return;}
    const dismiss=event.target.closest('[data-wonder-race-dismiss]')?.dataset.wonderRaceDismiss;
    if(dismiss){onDismissWonder(dismiss);return;}
    const reward=event.target.closest('[data-wonder-race-reward]')?.dataset.wonderRaceReward;
    if(reward){onUseProduction(reward);return;}
    const id = event.target.closest("[data-construction-locate]")?.dataset.constructionLocate;
    if (!id) return;
    const item = ownedBuildings(getCampaignState(), getTerritoryLabel).find(item => item.id === id);
    if (!item) return;
    onLocate(item.territoryId);
    if (completed.delete(id)) refresh();
  }
  notifications.addEventListener("click", locate);
  const unsubscribe = campaignStore.subscribe(() => refresh({ syncClock: true }));
  refresh({ syncClock: true });
  return { refresh, destroy() {
    destroyed = true; unsubscribe();
    if (timer !== null) clearIntervalImpl(timer);
    notifications.removeEventListener("click", locate);
    notifications.innerHTML = ""; notifications.hidden = true;
  } };
}
