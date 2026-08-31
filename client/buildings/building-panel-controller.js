const goldFormatter = new Intl.NumberFormat("zh-CN");

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
  escapeHtml = String,
} = {}) {
  if (!view) return `<div class="building-panel-loading"><i></i><span>正在读取地块设施…</span></div>`;
  if (view.error) return `<div class="building-panel-empty"><strong>设施信息读取失败</strong><span>${escapeHtml(view.error)}</span></div>`;
  const definitions = definitionMap(catalog);
  const buildings = Array.isArray(view.buildings) ? view.buildings : [];
  const currentMarkup = buildings.length
    ? buildings.map((building) => {
      const definition = definitions.get(building.type) ?? building;
      const name = building.name || definition.label || building.type || "未知设施";
      const constructing = building.status === "constructing" && Number(building.completesAt) > now;
      const start = Number(building.constructionStartedAt ?? now);
      const end = Number(building.completesAt ?? now);
      const progress = constructing && end > start
        ? Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
        : 100;
      const status = constructing
        ? `<span class="building-card-status is-building">施工中 · ${formatConstructionTime(end - now)}</span>
           <span class="building-card-progress"><i style="width:${progress.toFixed(1)}%"></i></span>`
        : `<span class="building-card-status is-active">已建成</span>`;
      return `<article class="building-preview-card ${constructing ? "is-constructing" : ""}" data-building-card="${escapeHtml(building.id)}">
        <img src="${escapeHtml(definition.iconPath || building.iconPath || "")}" alt="" loading="lazy" decoding="async" />
        <div class="building-preview-identity"><small>${escapeHtml(definition.label || building.type)}</small><strong>${escapeHtml(name)}</strong></div>
        <div class="building-preview-meta"><b>LV.${Number(building.level ?? 1)}</b>${status}</div>
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
    buildMarkup = `<div class="building-panel-empty is-compact"><strong>建筑槽位已满</strong><span>普通地块最多一座设施，首都可容纳多座设施。</span></div>`;
  } else {
    const options = catalog.filter((entry) => entry.buildable && available.has(entry.type));
    buildMarkup = options.length
      ? options.map((entry) => {
        const cost = Number(entry.buildCostGold ?? entry.costsGold?.[0] ?? 0);
        const disabled = buildPending || Number(walletGold) < cost;
        return `<article class="building-build-option">
          <img src="${escapeHtml(entry.iconPath || "")}" alt="" loading="lazy" decoding="async" />
          <div><strong>${escapeHtml(entry.label)}</strong><span>${entry.coastalOnly ? "仅限沿海地块 · " : ""}工期 ${formatConstructionTime(entry.constructionDurationMs)}</span></div>
          <button type="button" data-build-type="${escapeHtml(entry.type)}" ${disabled ? "disabled" : ""}><b>${goldFormatter.format(cost)}</b><small>金币 · 建造</small></button>
        </article>`;
      }).join("")
      : `<div class="building-panel-empty is-compact"><strong>暂无可建设施</strong><span>地块条件不满足，或所有可建设施均已存在。</span></div>`;
  }

  return `<div class="building-panel-summary">
      <div><small>TERRITORY FACILITIES</small><strong>${escapeHtml(territoryLabel)}</strong></div>
      <span><small>建筑槽位</small><b>${escapeHtml(slots)}</b></span>
    </div>
    <section class="building-panel-section"><header><strong>地块建筑预览</strong><span>${buildings.length} 座设施</span></header><div class="building-preview-list">${currentMarkup}</div></section>
    <section class="building-panel-section"><header><strong>可建造建筑</strong><span>统一工期 01:00 · 暂不开放升级</span></header><div class="building-build-list">${buildMarkup}</div></section>`;
}

export function createBuildingPanelController({
  documentRef = globalThis.document,
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
  const closeButton = documentRef.querySelector("#building-panel-close");
  if (!panel || !content || !closeButton) throw new Error("Building panel elements are missing");
  let openTerritoryId = null;
  let currentView = null;
  let buildPending = false;
  let refreshPending = false;
  let timer = null;

  function catalog() {
    return getCampaignState()?.buildings?.catalog ?? [];
  }

  function territoryLabel(territoryId) {
    const metadata = getTerritoryMetadata(territoryId);
    return metadata ? `${metadata.country} - ${metadata.name}` : territoryId;
  }

  function render() {
    if (!openTerritoryId) return;
    content.innerHTML = buildingPanelMarkup({
      view: currentView,
      catalog: catalog(),
      territoryLabel: territoryLabel(openTerritoryId),
      walletGold: getCampaignState()?.wallet?.gold ?? 0,
      now: now(),
      buildPending,
      escapeHtml,
    });
  }

  async function refresh() {
    if (!openTerritoryId || refreshPending) return;
    const territoryId = openTerritoryId;
    refreshPending = true;
    try {
      const campaignRequest = getCampaignRequest();
      currentView = await campaignRequest(`/api/campaign/territory/buildings?id=${encodeURIComponent(territoryId)}`);
      if (openTerritoryId === territoryId) render();
    } catch (error) {
      if (openTerritoryId === territoryId) {
        currentView = { error: error.message || "请求失败" };
        render();
      }
    } finally {
      refreshPending = false;
    }
  }

  async function build(type) {
    if (!openTerritoryId || buildPending) return;
    buildPending = true;
    render();
    try {
      const campaignRequest = getCampaignRequest();
      const value = await campaignRequest("/api/campaign/territory/buildings/build", {
        method: "POST",
        body: { territoryId: openTerritoryId, type },
      });
      campaignStore.setState(value.state, { source: "building-build" });
      applyCampaignWorldSnapshot(value.state.world);
      currentView = value.territory;
      updateTopbarWallet(value.state);
      refreshTerritoryDisplay();
      renderTerritoryInspector(openTerritoryId);
      render();
      const entry = catalog().find((candidate) => candidate.type === type);
      showToast(`${entry?.label || "设施"}已开工，预计 1 分钟后建成`);
    } catch (error) {
      showToast(error.message || "设施建造失败");
      await refresh();
    } finally {
      buildPending = false;
      render();
    }
  }

  function open(territoryId) {
    if (!territoryId) return;
    openTerritoryId = territoryId;
    currentView = getCampaignState()?.buildings?.territories?.[territoryId] ?? null;
    panel.hidden = false;
    panel.classList.add("is-open");
    render();
    refresh();
    if (!timer && setIntervalImpl) {
      timer = setIntervalImpl(() => {
        if (!openTerritoryId || !currentView) return;
        render();
        const due = currentView.buildings?.some((building) => building.status === "constructing" && Number(building.completesAt) <= now());
        if (due) refresh();
      }, 1_000);
    }
  }

  function close() {
    if (!openTerritoryId && panel.hidden) return false;
    openTerritoryId = null;
    currentView = null;
    panel.hidden = true;
    panel.classList.remove("is-open");
    if (timer && clearIntervalImpl) clearIntervalImpl(timer);
    timer = null;
    return true;
  }

  function refreshFromState() {
    if (!openTerritoryId) return;
    const view = getCampaignState()?.buildings?.territories?.[openTerritoryId];
    if (view) currentView = view;
    render();
  }

  closeButton.addEventListener("click", close);
  content.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-build-type]");
    if (button && !button.disabled) build(button.dataset.buildType);
  });

  return Object.freeze({
    close,
    getOpenTerritoryId: () => openTerritoryId,
    open,
    refresh,
    refreshFromState,
  });
}
