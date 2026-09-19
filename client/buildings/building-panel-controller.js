import {facilityHourlyMaintenance} from '../../shared/config/operating-costs.mjs';
import {districtYieldMarkup,districtUpgradeText} from './district-yield-markup.js';
import { HEADQUARTERS_FANS, facilityUpgradeText } from '../../shared/config/facility-levels.mjs';
import { createRequestId } from '../core/request-id.js';
import { createWonderHoverController } from "./wonder-hover-controller.js?v=20260909-facilities-v1";
import { constructionProgress } from "./construction-notifications.js?v=20260909-infrastructure-v1";
import { facilityArtIcon } from '../../shared/config/facility-art.mjs';
import { goldAmountMarkup } from "../ui/currency.js";
import { resourceAmountMarkup } from "../resources/resource-markup.js?v=20260907-resource-hover-v1";

function definitionMap(catalog = []) {
  return new Map(catalog.map((entry) => [entry.type, entry]));
}

export function formatConstructionTime(millisecondsValue) {
  const seconds = Math.max(0, Math.ceil((Number(millisecondsValue) || 0) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function buildingPanelMarkup({
  view,
  catalog = [],
  territoryLabel = "地块建筑",
  walletGold = 0,
  now = Date.now(),
  buildPending = false,
  cancelWonderId = null,
  escapeHtml = String,
} = {}) {
  if (!view) return `<div class="building-panel-loading"><i></i><span>正在读取地块设施…</span></div>`;
  if (view.error) return `<div class="building-panel-empty"><strong>设施信息读取失败</strong><span>${escapeHtml(view.error)}</span></div>`;
  const projectFull=Boolean(view.production&&view.production.activeProjects>=(view.production.projectLimit??5));
  const definitions = definitionMap(catalog);
  const buildings = Array.isArray(view.buildings) ? view.buildings : [];
  const currentMarkup = buildings.length
    ? buildings.map((building) => {
      const definition = definitions.get(building.type) ?? building;
      const name = building.name || definition.label || building.type || "未知设施";
      const constructing = building.status === "constructing" || Boolean(building.upgradeTo);
      const { percent: progress, remaining } = constructing ? constructionProgress(building, now) : { percent: 100, remaining: 0 };
      const status = building.raidSuppressed ? '<span class="raid-suppression-label">压制中</span>' : constructing && building.progressHidden ? `<span class="building-card-status is-building">施工中 · 进度未公开</span>` : constructing
        ? `<span class="building-card-status is-building">${building.blockedReason?escapeHtml(building.blockedReason):remaining === null ? "等待生产力" : remaining === 0 ? "等待完工确认" : "施工中 · " + formatConstructionTime(remaining)}</span>
           <span class="building-card-progress"><i style="width:${progress.toFixed(1)}%"></i></span>`
        : `<span class="building-card-status is-active">已建成</span>`;
      const requiredFans=building.type==='club-headquarters'?(HEADQUARTERS_FANS[building.level]??0):0;
      const requirement=requiredFans?`需要 ${requiredFans.toLocaleString('zh-CN')} 球迷`:`需要总部 LV${Number(building.level)+1}`;
      const eligible=building.type==='club-headquarters'?Number(view.fans)>=requiredFans:Number(view.headquartersLevel)>=Number(building.level)+1;
      const upgrade= !view.canManage || building.wonder ? '' : building.upgradeTo
        ? `<p class="building-panel-notice">正在升至 LV${building.upgradeTo}，原等级效果继续生效</p><button type="button" data-cancel-upgrade="${escapeHtml(building.id)}" ${buildPending?'disabled':''}>中止升级（已投入生产力不返还）</button>`
        : building.level>=(building.maxLevel??5) ? `<p class="building-panel-notice">${building.maxLevel===1?'单等级设施，不可升级':'LV'+building.maxLevel+' 已满级'}</p>` : building.status!=='active' ? ''
        : `<div class="facility-upgrade-panel"><p>${escapeHtml(districtUpgradeText(building.siteYield,building.nextSiteYield)||facilityUpgradeText(building.type,building.level))}</p><small>${requirement}${eligible?' · 已满足':''}</small><div class="building-build-actions"><button type="button" data-upgrade-building="${escapeHtml(building.id)}" data-upgrade-method="gold" ${buildPending||!eligible||walletGold<building.nextUpgradeCostGold?'disabled':''}>金币升级 ${goldAmountMarkup(building.nextUpgradeCostGold)}</button><button type="button" data-upgrade-building="${escapeHtml(building.id)}" data-upgrade-method="production" ${buildPending||!eligible||!view.production||projectFull?'disabled':''}>生产力升级 ${resourceAmountMarkup('production',building.nextUpgradeCostProduction)}</button></div><small>${view.production?.nextProjectAllocation>0?'预计 '+formatConstructionTime(building.nextUpgradeCostProduction/view.production.nextProjectAllocation*60000):'开工后等待生产力'} · 金币升级立即完成</small></div>`;
      const medical=building.medical;
      const medicalMarkup=medical?`<div class="facility-medical"><p>治疗仅减少伤停，同一次受伤最多一次；红牌停赛不能治疗。</p>${medical.tasks.map(t=>`<p>${escapeHtml(t.playerName)} · ${formatConstructionTime(t.completesAt-now)} <button type="button" data-cancel-medical="${escapeHtml(t.id)}" ${buildPending?'disabled':''}>取消（不退款）</button></p>`).join('')}<select ${medical.players.some(p=>p.eligible)?"":"disabled"} data-medical-player="${escapeHtml(building.id)}" aria-label="选择治疗球员">${!medical.players.some(p=>p.eligible)?'<option value="">暂无可治疗球员</option>':""}${medical.players.filter(p=>p.eligible).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${p.injury} → ${Math.max(0,p.injury-1)} 回合</option>`).join('')}</select><button type="button" data-start-medical="${escapeHtml(building.id)}" ${buildPending||!medical.canTreat||!medical.players.some(p=>p.eligible)||walletGold<medical.rules.costGold?'disabled':''}>治疗 ${goldAmountMarkup(medical.rules.costGold)}</button></div>`:'';
      return `<article class="building-preview-card ${constructing ? "is-constructing" : ""}" data-building-card="${escapeHtml(building.id)}">
        <img src="${escapeHtml(facilityArtIcon(building.type, building.level) || definition.iconPath || building.iconPath || "")}" alt="" loading="lazy" decoding="async" />
        <div class="building-preview-identity"><small>${escapeHtml(definition.label || building.type)}</small><strong>${escapeHtml(name)}</strong></div>
        <div class="building-preview-meta"><b>${building.wonder?"奇观":`LV.${Number(building.level ?? 1)}`}</b>${status}</div>
        ${building.wonder?`<p class="wonder-built-effect">${escapeHtml(building.effectText)}${building.dependency?`<small>待${escapeHtml(building.dependency)}开放后生效</small>`:""}</p>`:""}
        ${view.canManage && building.wonder && constructing ? `<div class="wonder-cancel-actions">${cancelWonderId===building.id?`<p>中止后，已投入的生产力不返还。</p><button type="button" data-keep-wonder ${buildPending?'disabled':''}>继续建造</button><button type="button" data-confirm-cancel-wonder="${escapeHtml(building.id)}" ${buildPending?'disabled':''}>${buildPending?'中止中…':'确认中止'}</button>`:`<button type="button" data-cancel-wonder="${escapeHtml(building.id)}" ${buildPending?'disabled':''}>中止建造</button>`}</div>`:""}
        ${!building.wonder?`<p class="building-panel-notice">${escapeHtml(building.effectText??"")}</p>`:""}${building.runtimeEffectText?`<p class="building-panel-notice">${escapeHtml(building.runtimeEffectText)}</p>`:""}${building.siteYield?districtYieldMarkup(building.siteYield,{escapeHtml,constructing}):''}${upgrade}${medicalMarkup}${view.canManage?`<p class="building-panel-notice">基础养护 ${facilityHourlyMaintenance(building)}${!building.wonder&&building.level<(building.maxLevel??5)?' → '+facilityHourlyMaintenance({...building,level:building.level+1}):''} 金币/小时${building.status==='constructing'?' · 完工后开始收费':''}${building.maxLevel===1?'。':'，升级期间按原等级。'}</p>`:''}
        ${view.canManage && building.type === "scout-center" ? `<button class="building-scout-open" type="button" data-open-scout="${escapeHtml(building.id)}">打开球探中心</button>` : ""}
        ${building.canUseAirport ? `<button class="building-scout-open" type="button" data-open-airport>机场运输</button>` : ""}
        ${view.canManage && building.type === "training-center" ? `<button class="building-scout-open" type="button" data-open-training="${escapeHtml(building.id)}">打开训练中心</button>` : ""}
        ${view.canManage && definition.buildable && !building.wonder ? `<button class="facility-demolish" type="button" data-demolish-building="${escapeHtml(building.id)}" ${buildPending?'disabled':''}>拆除设施</button>` : ""}
      </article>`;
    }).join("")
    : `<div class="building-panel-empty is-compact"><strong>该地块尚无设施</strong><span>从下方列表选择一座设施开始建造。</span></div>`;

  const slots = view.slotLimit === null
    ? "不可管理"
    : `${Number(view.occupiedSlots ?? 0)} / ${Number(view.slotLimit ?? 0)}`;
  const available = new Set(view.availableTypes ?? []);
  let buildMarkup = "";
  if (!view.canManage) {
    buildMarkup = `<div class="building-panel-empty is-compact"><strong>仅可预览</strong><span>只有领地所有者可以建造设施。</span></div>`;
  } else if (Number(view.availableSlots ?? 0) <= 0) {
    buildMarkup = `<div class="building-panel-empty is-compact"><strong>建筑槽位已满</strong><span>普通地块 1 个槽位；首都共 3 个，总部占用 1 个。</span></div>`;
  } else {
    const options = catalog.filter((entry) => entry.buildable && available.has(entry.type));
    buildMarkup = options.length
      ? options.map((entry) => {
        const cost = Number(entry.buildCostGold ?? entry.costsGold?.[0] ?? 0);
        const productionCost = Number(entry.buildCostProduction);
        const goldDisabled = buildPending || Number(walletGold) < cost;
        const productionDisabled = buildPending || projectFull || !view.production || !(productionCost > 0);
        return `<article class="building-build-option" data-wonder-id="facility:${escapeHtml(entry.type)}">
          <button type="button" class="facility-build-info" data-wonder-info aria-controls="wonder-hover" aria-expanded="false" aria-label="查看${escapeHtml(entry.label)}的用途和升级效果"><img src="${escapeHtml(facilityArtIcon(entry.type, 1) || entry.iconPath || "")}" alt="" loading="lazy" decoding="async" />
          <div class="building-build-identity"><strong>${escapeHtml(entry.label)}</strong>${entry.coastalOnly ? "<span>仅限沿海地块</span>" : entry.oilOnly?"<span>仅限含油地块 · 每小时 +3 石油</span>":""}</div></button>
          ${districtYieldMarkup(view.buildPreviews?.[entry.type],{escapeHtml})}<small class="building-upkeep-preview">建成后基础养护 ${facilityHourlyMaintenance({...entry,level:1})} 金币/小时</small>
          <div class="building-build-actions">
            <button class="building-build-gold" type="button" data-build-type="${escapeHtml(entry.type)}" data-build-method="gold" aria-busy="${buildPending}" aria-label="${escapeHtml(`金币建造 ${entry.label}，${cost.toLocaleString("zh-CN")} 金币，立即建成${Number(walletGold) < cost ? "，余额不足" : ""}`)}" ${goldDisabled ? "disabled" : ""}>${goldAmountMarkup(cost)}</button>
            <button class="building-build-production" type="button" data-build-type="${escapeHtml(entry.type)}" data-build-method="production" aria-busy="${buildPending}" aria-label="${escapeHtml(`生产力建造 ${entry.label}，需要 ${productionCost.toLocaleString("zh-CN")} 生产力${view.production?.capacity === 0 ? "，当前无生产力，开工后等待产能" : ""}`)}" ${productionDisabled ? "disabled" : ""}>${resourceAmountMarkup("production", productionCost)}</button>
          </div>
        </article>`;
      }).join("")
      : `<div class="building-panel-empty is-compact"><strong>暂无可建设施</strong><span>地块条件不满足，或所有可建设施均已存在。</span></div>`;
  }

  const wonders=view.canManage?(view.availableWonders??[]).filter(w=>w.canBuild):[];
  const wonderMarkup=wonders.map(w=>`<article class="wonder-build-option" data-wonder-id="${escapeHtml(w.wonderId || w.type)}"><button type="button" class="wonder-build-info" data-wonder-info aria-label="查看${escapeHtml(w.label)}的要求和效果" aria-controls="wonder-hover" aria-expanded="false"><img src="${escapeHtml(w.iconPath)}" alt=""><strong>${escapeHtml(w.label)}</strong></button><button type="button" class="building-build-production" data-build-type="${escapeHtml(w.type)}" data-build-method="production" ${buildPending||projectFull?"disabled":""} aria-label="建造${escapeHtml(w.label)}">${resourceAmountMarkup("production",w.construction.totalProduction??0)}</button></article>`).join("");
  return `<div class="building-panel-summary">
      <div><strong>地块建筑</strong></div>
      <span><small>建筑槽位</small><b>${escapeHtml(slots)}</b></span>
    </div>
    ${view.production ? `<p class="building-production-summary">当前生产力 ${view.production.capacity} · 施工 ${view.production.activeProjects}/${view.production.projectLimit??5}${projectFull?' · 名额已满':' · 生产力平均分配'}</p>` : ""}
    ${view.raidSuppression?`<p class="raid-suppression-label">豪门压制 · 基础收益 −30%，设施暂停<br>恢复：${escapeHtml(new Date(view.raidSuppression.until).toLocaleString("zh-CN"))}</p>`:""}<section class="building-panel-section"><header><strong>已建建筑</strong><span>${buildings.length} 座设施</span></header><div class="building-preview-list">${currentMarkup}</div></section>
    <section class="building-panel-section"><header><strong>可建造建筑</strong></header><div class="building-build-list">${buildMarkup}</div></section>${view.canManage?`<section class="building-panel-section"><header><strong>奇观建筑</strong><span>${wonders.length} 座可建造</span></header><div class="wonder-build-list">${wonderMarkup || '<p class="wonder-build-empty">当前地块暂无满足建造条件的奇观</p>'}</div></section>`:""}`;
}

export function createBuildingPanelController({
  documentRef = globalThis.document,
  onOpenScouting = () => {},
  onOpenTraining = () => {},
  onOpenAirport = () => {},
  onDemolish = () => {},
  getCampaignRequest,
  getCampaignState,
  getTerritoryMetadata,
  campaignStore,
  applyCampaignWorldSnapshot,
  refreshTerritoryDisplay,
  renderTerritoryInspector,
  updateTopbarWallet,
  showToast = () => {},
  escapeHtml = String,
  now = Date.now,
  setIntervalImpl = globalThis.setInterval?.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval?.bind(globalThis),
} = {}) {
  const panel = documentRef.querySelector("#building-panel");
  const content = documentRef.querySelector("#building-panel-content");
  if (!panel || !content) throw new Error("Building panel elements are missing");
  let openTerritoryId = null;
  let currentView = null;
  let buildPending = false;
  let cancelWonderId = null;
  let refreshPending = null;
  let selectionVersion = 0;
  let timer = null;
  const wonderHover = createWonderHoverController({documentRef, content,
    getWonders:()=>currentView?.canManage ? [...(currentView.availableWonders ?? []).filter(w=>w.canBuild),...catalog().filter(e=>e.buildable&&(currentView.availableTypes??[]).includes(e.type)).map(e=>({...e,wonderId:'facility:'+e.type,hoverKind:'facility',iconPath:facilityArtIcon(e.type,1)||e.iconPath}))] : [], escapeHtml});

  function catalog() {
    return getCampaignState()?.buildings?.catalog ?? [];
  }

  function territoryLabel(territoryId) {
    const metadata = getTerritoryMetadata(territoryId);
    return metadata ? `${metadata.country} - ${metadata.name}` : territoryId;
  }

  function render(preserveInteraction = true) {
    if (!openTerritoryId) return;
    const scroller = documentRef.querySelector("#territory-inspector") ?? content;
    const scrollTop = preserveInteraction ? scroller.scrollTop : 0;
    const focused = preserveInteraction && documentRef.activeElement?.closest?.("[data-wonder-id]");
    const focusSelector = focused && (documentRef.activeElement?.hasAttribute("data-wonder-info") ? "[data-wonder-info]" : "[data-build-type]");
    const cancelFocus=preserveInteraction&&documentRef.activeElement?.closest?.('.wonder-cancel-actions');
    const cancelFocusId=cancelFocus?.closest?.('[data-building-card]')?.dataset?.buildingCard;
    const cancelFocusAction=cancelFocus&&['data-cancel-wonder','data-keep-wonder','data-confirm-cancel-wonder'].find(key=>documentRef.activeElement?.hasAttribute?.(key));
    wonderHover.beforeRender();
    content.innerHTML = buildingPanelMarkup({
      view: currentView,
      catalog: catalog(),
      territoryLabel: territoryLabel(openTerritoryId),
      walletGold: getCampaignState()?.wallet?.gold ?? 0,
      now: now(),
      buildPending,
      cancelWonderId,
      escapeHtml,
    });
    for (const node of content.querySelectorAll?.("[data-wonder-id]") ?? []) {
      if (focusSelector && node.dataset.wonderId === focused.dataset.wonderId) node.querySelector(focusSelector)?.focus({preventScroll:true});
    }
    if(cancelFocusAction){for(const card of content.querySelectorAll?.('[data-building-card]')??[])if(card.dataset.buildingCard===cancelFocusId)card.querySelector(`[${cancelFocusAction}]`)?.focus({preventScroll:true});}
    scroller.scrollTop = scrollTop;
    if (preserveInteraction) wonderHover.update(); else wonderHover.close();
  }

  async function refresh() {
    if (!openTerritoryId || refreshPending?.version === selectionVersion) return;
    const request = {territoryId:openTerritoryId,version:selectionVersion};
    refreshPending = request;
    try {
      const view = await getCampaignRequest()(`/api/campaign/territory/buildings?id=${encodeURIComponent(request.territoryId)}`);
      if (selectionVersion === request.version && openTerritoryId === request.territoryId) {
        currentView = view;
        render();
      }
    } catch (error) {
      if (selectionVersion === request.version && openTerritoryId === request.territoryId && !currentView?.buildings) {
        currentView = {error:error.message || "请求失败"};
        render();
      }
    } finally {
      if (refreshPending === request) refreshPending = null;
    }
  }

  async function build(type, buildMethod) {
    if (!openTerritoryId || buildPending || !currentView?.canManage) return;
    const territoryId = openTerritoryId;
    // Invalidate a read started before this construction request.
    selectionVersion += 1;
    buildPending = true;
    render();
    try {
      const campaignRequest = getCampaignRequest();
      const value = await campaignRequest("/api/campaign/territory/buildings/build", {
        method: "POST",
        body: { territoryId, type, buildMethod },
      });
      campaignStore.setState(value.state, { source: "building-build" });
      applyCampaignWorldSnapshot(value.state.world);
      if (openTerritoryId === territoryId) {
        selectionVersion += 1;
        currentView = value.territory;
      }
      updateTopbarWallet(value.state);
      refreshTerritoryDisplay();
      if (openTerritoryId) renderTerritoryInspector(openTerritoryId);
      render();
      const entry = catalog().find((candidate) => candidate.type === type);
      const timing = value.building?.status === "active" ? "已建成"
        : value.building?.remainingConstructionMs == null ? "已开工，等待生产力"
        : "已开工，预计 " + formatConstructionTime(value.building.remainingConstructionMs) + " 后建成";
      showToast(`${entry?.label || "设施"}${timing}`);
    } catch (error) {
      showToast(error.message || "设施建造失败");
      await refresh();
    } finally {
      buildPending = false;
      render();
    }
  }

  async function operate(path,body){
    if(!openTerritoryId||buildPending||!currentView?.canManage)return;
    const territoryId=openTerritoryId;selectionVersion++;buildPending=true;render();
    try{const value=await getCampaignRequest()(path,{method:'POST',body:{territoryId,...body}});campaignStore.setState(value.state,{source:'facility-operation'});applyCampaignWorldSnapshot(value.state.world);if(openTerritoryId===territoryId){selectionVersion++;currentView=value.territory;}updateTopbarWallet(value.state);refreshTerritoryDisplay();if(openTerritoryId)renderTerritoryInspector(openTerritoryId);}
    catch(error){showToast(error.message||'设施操作失败');await refresh();}
    finally{buildPending=false;render();}
  }

  async function cancelWonder(buildingId) {
    if(!openTerritoryId||buildPending||!currentView?.canManage||buildingId!==cancelWonderId)return;
    const territoryId=openTerritoryId;selectionVersion++;buildPending=true;render();
    try{
      const value=await getCampaignRequest()('/api/campaign/wonders/cancel',{method:'POST',body:{territoryId,buildingId}});
      campaignStore.setState(value.state,{source:'wonder-cancel'});applyCampaignWorldSnapshot(value.state.world);
      if(openTerritoryId===territoryId){selectionVersion++;currentView=value.territory;cancelWonderId=null;}
      updateTopbarWallet(value.state);refreshTerritoryDisplay();
      if(openTerritoryId)renderTerritoryInspector(openTerritoryId);
      showToast('奇观建造已中止，已投入的生产力不返还');
    }catch(error){showToast(error.message||'中止建造失败');await refresh();}
    finally{buildPending=false;render();}
  }

  function open(territoryId) {
    if (!territoryId || territoryId === openTerritoryId) return;
    selectionVersion += 1;
    openTerritoryId = territoryId;
    cancelWonderId = null;
    currentView = getCampaignState()?.buildings?.territories?.[territoryId] ?? null;
    panel.hidden = false;
    panel.classList.add("is-open");
    render(false);
    refresh();
    if (!timer && setIntervalImpl) {
      timer = setIntervalImpl(() => {
        if (!openTerritoryId || !currentView?.buildings?.some((building) => (building.status === "constructing" || building.upgradeTo || building.medical?.tasks?.length))) return;
        render();
        const due = currentView.buildings?.some((building) => (building.status === "constructing" || building.upgradeTo) && building.completesAt != null && Number(building.completesAt) <= now());
        if (due || currentView.buildings.some(b=>b.medical?.tasks?.some(t=>t.completesAt<=now()))) refresh();
      }, 1_000);
    }
  }

  function close() {
    if (!openTerritoryId && panel.hidden) return false;
    selectionVersion += 1;
    openTerritoryId = null;
    cancelWonderId = null;
    currentView = null;
    wonderHover.close();
    panel.hidden = true;
    panel.classList.remove("is-open");
    if (timer && clearIntervalImpl) clearIntervalImpl(timer);
    timer = null;
    return true;
  }

  function refreshFromState() {
    if (!openTerritoryId) return;
    const view = getCampaignState()?.buildings?.territories?.[openTerritoryId];
    // World polling deliberately omits expensive wonder requirements. Keep the
    // full list visible while fetching fresh conditions for this territory.
    if (view) {
      const previous=new Map((currentView?.buildings??[]).map(b=>[b.id,b]));
      currentView={...view,buildPreviews:view.canManage?(view.buildPreviews??currentView?.buildPreviews):undefined,buildings:(view.buildings??[]).map(b=>{const old=previous.get(b.id);return view.canManage&&old?.level===b.level?{...b,siteYield:b.siteYield??old.siteYield,nextSiteYield:b.nextSiteYield??old.nextSiteYield}:b;}),availableWonders:view.canManage?(view.availableWonders??currentView?.availableWonders):[]};
    }
    render();
    if (!buildPending) refresh();
  }

  content.addEventListener("click", (event) => {
    const demolish=event.target.closest?.('[data-demolish-building]');
    if(demolish && !demolish.disabled && !buildPending && currentView?.canManage && openTerritoryId) return onDemolish({territoryId:openTerritoryId,buildingId:demolish.dataset.demolishBuilding},demolish);
    const upgrade=event.target.closest?.('[data-upgrade-building]');
    if(upgrade&&!upgrade.disabled){const building=currentView.buildings.find(b=>b.id===upgrade.dataset.upgradeBuilding);return operate('/api/campaign/territory/buildings/upgrade',{buildingId:building.id,buildMethod:upgrade.dataset.upgradeMethod,expectedLevel:building.level,requestId:createRequestId()});}
    const cancelUpgrade=event.target.closest?.('[data-cancel-upgrade]');
    if(cancelUpgrade&&!cancelUpgrade.disabled)return operate('/api/campaign/territory/buildings/cancel-upgrade',{buildingId:cancelUpgrade.dataset.cancelUpgrade});
    const medical=event.target.closest?.('[data-start-medical]');
    if(medical&&!medical.disabled){const id=medical.dataset.startMedical,select=[...content.querySelectorAll('[data-medical-player]')].find(s=>s.dataset.medicalPlayer===id);return operate('/api/campaign/medical/start',{buildingId:id,playerId:select?.value,requestId:createRequestId()});}
    const cancelMedical=event.target.closest?.('[data-cancel-medical]');
    if(cancelMedical&&!cancelMedical.disabled)return operate('/api/campaign/medical/cancel',{taskId:cancelMedical.dataset.cancelMedical});

    const cancel=event.target.closest?.('[data-cancel-wonder]');
    if(cancel&&!buildPending){cancelWonderId=cancel.dataset.cancelWonder;render();return;}
    if(event.target.closest?.('[data-keep-wonder]')&&!buildPending){cancelWonderId=null;render();return;}
    const confirm=event.target.closest?.('[data-confirm-cancel-wonder]');
    if(confirm&&!confirm.disabled)return cancelWonder(confirm.dataset.confirmCancelWonder);

    if(event.target.closest?.("[data-open-airport]")&&openTerritoryId)return onOpenAirport({territoryId:openTerritoryId});
    const training = event.target.closest?.("[data-open-training]");
    if (training?.dataset?.openTraining && openTerritoryId) return onOpenTraining({ territoryId: openTerritoryId, buildingId: training.dataset.openTraining });
    const scout = event.target.closest?.("[data-open-scout]");
    if (scout?.dataset?.openScout && openTerritoryId) return onOpenScouting({ territoryId: openTerritoryId, buildingId: scout.dataset.openScout });
    const button = event.target.closest?.("[data-build-type]");
    if (button && !button.disabled) return build(button.dataset.buildType, button.dataset.buildMethod);
  });

  return Object.freeze({
    close,
    getOpenTerritoryId: () => openTerritoryId,
    open,
    refresh,
    refreshFromState,
  });
}
