export function createTerritoryController({
  documentRef = globalThis.document,
  mapElement,
  ownerTypes,
  territoryMetadataById,
  territoryLayersById,
  attackableTerritoryIds,
  getTerritoryWorld,
  getCampaignState,
  getCityData,
  getClubData,
  getBuildingCatalog = () => [],
  getCampaignRequest,
  getMaritimeMode,
  getMaritimeTargetIds,
  getTerritoryChallengePending,
  campaignStore,
  applyCampaignWorldSnapshot,
  territoryStyle,
  territoryTooltipMarkup,
  territoryOwnerLabel,
  challengeSummary,
  ownActiveChallenge,
  showToast,
  onSelectionChange = () => {},
}) {
  let selectedTerritoryId = null;
  let homeSelectionMode = false;
  let homeClaimPending = false;
  const territoryIntelCache = new Map();

  function homeSelectionPermission(territoryId) {
    const metadata = territoryMetadataById.get(territoryId);
    const territoryWorld = getTerritoryWorld();
    const state = territoryWorld?.territories[territoryId];
    if (!metadata || !state) return { allowed: false, reason: "无法读取该地块" };
    if (!metadata.playable || !metadata.spawnAllowed || state.ownerType === ownerTypes.CLUB) {
      return { allowed: false, reason: "豪门中立区域不能作为主场" };
    }
    if (state.ownerType === ownerTypes.PLAYER) {
      return { allowed: false, reason: "该地块已被其他玩家占据" };
    }
    const adjacentClubId = (metadata.landNeighbors ?? []).find(
      (neighborId) => territoryWorld.territories[neighborId]?.ownerType === ownerTypes.CLUB,
    );
    if (adjacentClubId) {
      const adjacent = territoryMetadataById.get(adjacentClubId);
      return {
        allowed: false,
        reason: `与黄色豪门区域${adjacent?.name ? `“${adjacent.name}”` : ""}直接接壤`,
      };
    }
    return { allowed: true, reason: "可以在这里建立永久主场" };
  }

  function renderHomeSelectionPanel(territoryId = selectedTerritoryId) {
    const panel = documentRef.querySelector("#home-selection-panel");
    panel.hidden = !homeSelectionMode;
    if (!homeSelectionMode) return;
    const metadata = territoryMetadataById.get(territoryId);
    const permission = territoryId
      ? homeSelectionPermission(territoryId)
      : { allowed: false, reason: "请在地图上选择一个省级地块" };
    documentRef.querySelector("#home-selection-name").textContent = metadata
      ? `${metadata.country} · ${metadata.name}`
      : "尚未选择区域";
    documentRef.querySelector("#home-selection-status").textContent = permission.reason;
    panel.classList.toggle("is-valid", permission.allowed);
    panel.classList.toggle("is-invalid", Boolean(territoryId) && !permission.allowed);
    documentRef.querySelector("#confirm-home-selection").disabled = !permission.allowed || homeClaimPending;
  }

  function refreshTerritoryDisplay() {
    const territoryWorld = getTerritoryWorld();
    if (!territoryWorld) return;
    territoryLayersById.forEach((layer, territoryId) => {
      const metadata = territoryMetadataById.get(territoryId);
      const state = territoryWorld.territories[territoryId];
      layer.setStyle(territoryStyle(layer.feature));
      if (metadata && state) layer.setTooltipContent(territoryTooltipMarkup(metadata, state));
    });
  }

  function enterHomeSelectionMode() {
    homeSelectionMode = true;
    mapElement.classList.add("is-choosing-home");
    renderHomeSelectionPanel(null);
    refreshTerritoryDisplay();
  }

  async function confirmHomeSelection() {
    if (!homeSelectionMode || !selectedTerritoryId || homeClaimPending) return;
    const permission = homeSelectionPermission(selectedTerritoryId);
    if (!permission.allowed) return renderHomeSelectionPanel(selectedTerritoryId);
    homeClaimPending = true;
    renderHomeSelectionPanel(selectedTerritoryId);
    const campaignRequest = getCampaignRequest();
    try {
      const value = await campaignRequest("/api/campaign/home/claim", {
        method: "POST",
        body: { territoryId: selectedTerritoryId },
      });
      campaignStore.setState(value.state, { source: "home-claim" });
      const campaignState = getCampaignState();
      applyCampaignWorldSnapshot(campaignState.world);
      homeSelectionMode = false;
      mapElement.classList.remove("is-choosing-home");
      documentRef.querySelector("#home-selection-panel").hidden = true;
      refreshTerritoryDisplay();
      selectTerritory(campaignState.homeTerritoryId);
      showToast("主场建立成功，今后无法更改");
    } catch (error) {
      try {
        const latest = await campaignRequest("/api/campaign/state");
        campaignStore.setState(latest.state, { source: "home-claim-refresh" });
        applyCampaignWorldSnapshot(getCampaignState().world);
        refreshTerritoryDisplay();
      } catch {}
      showToast(error.message || "主场建立失败");
    } finally {
      homeClaimPending = false;
      renderHomeSelectionPanel(selectedTerritoryId);
    }
  }

  function renderTerritoryInspector(territoryId) {
    const territoryWorld = getTerritoryWorld();
    const campaignState = getCampaignState();
    const maritimeMode = getMaritimeMode();
    const maritimeTargetIds = getMaritimeTargetIds();
    const inspector = documentRef.querySelector("#territory-inspector");
    const actions = documentRef.querySelector("#territory-challenge-actions");
    const challengeButton = documentRef.querySelector("#territory-challenge-button");
    const buildingButton = documentRef.querySelector("#territory-building-button");
    const cancelButton = documentRef.querySelector("#territory-maritime-cancel-button");
    const challengeStatus = documentRef.querySelector("#territory-challenge-status");
    challengeButton.hidden = false;
    cancelButton.hidden = !maritimeMode;
    const metadata = territoryMetadataById.get(territoryId);
    const state = territoryWorld?.territories[territoryId];
    if (!metadata || !state) {
      inspector.hidden = true;
      inspector.classList.remove("has-selection");
      documentRef.querySelector("#territory-name").textContent = "选择一个省级区块";
      documentRef.querySelector("#territory-country").textContent = "查看归属与相邻进攻通路";
      documentRef.querySelector("#territory-owner").textContent = "未选择";
      const weatherElement = documentRef.querySelector("#territory-weather");
      weatherElement.textContent = "—";
      weatherElement.removeAttribute("title");
      documentRef.querySelector("#territory-links").textContent = "—";
      documentRef.querySelector("#territory-assets").textContent = "—";
      documentRef.querySelector("#territory-id").textContent = "—";
      for (const id of ["territory-ai-difficulty", "territory-ai-overall", "territory-ai-formation", "territory-ai-style"]) {
        documentRef.querySelector(`#${id}`).textContent = "—";
      }
      actions.hidden = true;
      buildingButton.hidden = true;
      cancelButton.hidden = true;
      return;
    }

    const cityData = getCityData();
    const clubData = getClubData();
    const cityNames = metadata.cityIds
      .map((id) => cityData.find((city) => city.id === id)?.name)
      .filter(Boolean);
    const garrisonClubIds = metadata.garrisonClubIds ?? metadata.clubIds;
    const clubNames = garrisonClubIds
      .map((id) => clubData.find((club) => club.id === id)?.name)
      .filter(Boolean);
    const buildingDefinitions = new Map(getBuildingCatalog().map((entry) => [entry.type, entry]));
    const buildingNames = (Array.isArray(state.buildings) ? state.buildings : [])
      .map((building) => {
        const definition = buildingDefinitions.get(building.type);
        return building.status === "constructing"
          ? `${building.name || definition?.label || building.type}（施工中）`
          : `${building.name || definition?.label || building.type} LV.${Number(building.level ?? 1)}`;
      });
    const assets = [
      cityNames.length ? "城市 " + cityNames.join("、") : null,
      clubNames.length ? "豪门 " + clubNames.join("、") : null,
      buildingNames.length ? "设施 " + buildingNames.join("、") : null,
    ].filter(Boolean).join(" · ") || "暂无城市、豪门或设施";

    inspector.hidden = false;
    inspector.classList.add("has-selection");
    documentRef.querySelector("#territory-name").textContent = `${metadata.country} - ${metadata.name}`;
    documentRef.querySelector("#territory-country").textContent = metadata.type || "省级地块";
    documentRef.querySelector("#territory-owner").textContent = territoryOwnerLabel(metadata, state);
    const weather = campaignState?.world?.weather?.territories?.[territoryId] ?? null;
    const weatherElement = documentRef.querySelector("#territory-weather");
    weatherElement.textContent = weather ? `${weather.icon} ${weather.label}` : "—";
    if (weather) weatherElement.title = `降水强度 ${weather.precipitation}% · 每个整点刷新`;
    else weatherElement.removeAttribute("title");
    documentRef.querySelector("#territory-links").textContent = metadata.landNeighbors.length + " 个陆地相邻区块";
    documentRef.querySelector("#territory-assets").textContent = assets;
    documentRef.querySelector("#territory-id").textContent = metadata.territoryId;
    const ownTerritory = state.ownerType === ownerTypes.PLAYER && state.ownerId === campaignState.playerId;
    buildingButton.hidden = homeSelectionMode || !campaignState?.setupComplete;
    buildingButton.textContent = ownTerritory ? "管理地块建筑" : "查看地块建筑";
    const ai = territoryIntelCache.get(territoryId)?.ai;
    const aiLoading = !territoryIntelCache.has(territoryId) && state.ownerType !== ownerTypes.PLAYER;
    documentRef.querySelector("#territory-ai-difficulty").textContent = aiLoading
      ? "侦察中…"
      : ai ? `${"★".repeat(ai.difficulty)}${ai.coreCountry ? " · 核心国家" : ""}` : "非 AI 驻守";
    documentRef.querySelector("#territory-ai-overall").textContent = aiLoading
      ? "侦察中…"
      : ai ? `${ai.averageOverall}（目标 ${ai.targetAverageOverall}）` : "—";
    documentRef.querySelector("#territory-ai-formation").textContent = aiLoading
      ? "侦察中…"
      : ai ? `${ai.formation} · ${ai.mentality}` : "—";
    documentRef.querySelector("#territory-ai-style").textContent = aiLoading
      ? "侦察中…"
      : ai?.playStyle ?? "—";

    actions.hidden = homeSelectionMode || !campaignState?.homeTerritoryId;
    const activeChallenge = campaignState?.world?.activeChallenges?.[territoryId] ?? null;
    const playerChallenge = ownActiveChallenge();
    if (!actions.hidden && activeChallenge) {
      challengeButton.hidden = false;
      challengeButton.disabled = true;
      challengeButton.dataset.action = "challenge";
      challengeButton.textContent = "该板块正在争夺中";
      challengeStatus.textContent = `${challengeSummary(activeChallenge)} · ${activeChallenge.attackerTeamName} 对阵 ${activeChallenge.defenderName}`;
      return;
    }
    if (!actions.hidden && playerChallenge) {
      challengeButton.hidden = false;
      challengeButton.disabled = true;
      challengeButton.dataset.action = "challenge";
      challengeButton.textContent = "已有挑战进行中";
      challengeStatus.textContent = `${playerChallenge.attackerTeamName} 正在挑战 ${playerChallenge.defenderName}，结束前不能发起新挑战`;
      return;
    }
    if (!actions.hidden) {
      const attackable = attackableTerritoryIds.has(territoryId);
      const coastal = campaignState?.coastalTerritoryIds?.includes(territoryId);
      const maritimeTarget = maritimeTargetIds.has(territoryId);
      if (ownTerritory) {
        actions.hidden = !coastal;
        if (!actions.hidden) {
          challengeButton.disabled = getTerritoryChallengePending();
          challengeButton.dataset.action = "maritime";
          challengeButton.textContent = maritimeMode?.sourceTerritoryId === territoryId
            ? "重新选择海岸出发点"
            : "出海征战";
          challengeStatus.textContent = maritimeMode?.sourceTerritoryId === territoryId && maritimeMode.routes
            ? maritimeMode.routes.length
              ? `已生成 ${maritimeMode.routes.length} 条航线；点击绿色登陆点或虚线选择目标`
              : "该出发点没有可用航线，请重新选择"
            : "从该地块海岸选择一个直线航线出发点";
        }
      } else {
        actions.hidden = !attackable && !maritimeTarget;
        challengeButton.dataset.action = "challenge";
        challengeButton.disabled = getTerritoryChallengePending() || (!attackable && !maritimeTarget);
        challengeButton.textContent = getTerritoryChallengePending()
          ? "比赛结算中…"
          : maritimeTarget ? "发起跨海挑战（两回合）" : "挑战（两回合）";
        const route = maritimeMode?.routes?.find((item) => item.targetTerritoryId === territoryId);
        challengeStatus.textContent = maritimeTarget
          ? `直线航线可达 · ${route?.distanceKm ?? "—"} 公里`
          : attackable ? "" : "仅可挑战陆地相邻区块";
      }
    }
    if (maritimeMode && actions.hidden && !homeSelectionMode) {
      actions.hidden = false;
      challengeButton.hidden = true;
      challengeStatus.textContent = "海岸测绘仍在进行；可返回航线目标或取消测绘";
    }
  }

  function selectTerritory(territoryId) {
    const previousId = selectedTerritoryId;
    if (previousId === territoryId) {
      clearTerritorySelection();
      return;
    }
    selectedTerritoryId = territoryId;
    onSelectionChange(territoryId, previousId);
    if (previousId && previousId !== territoryId) {
      const previousLayer = territoryLayersById.get(previousId);
      if (previousLayer) previousLayer.setStyle(territoryStyle(previousLayer.feature));
    }
    const layer = territoryLayersById.get(territoryId);
    if (layer) layer.setStyle(territoryStyle(layer.feature));
    renderTerritoryInspector(territoryId);
    renderHomeSelectionPanel(territoryId);
    const campaignRequest = getCampaignRequest();
    if (campaignRequest && getCampaignState()?.setupComplete && !territoryIntelCache.has(territoryId)) {
      campaignRequest(`/api/campaign/territory/intel?id=${encodeURIComponent(territoryId)}`)
        .then((intel) => {
          territoryIntelCache.set(territoryId, intel);
          if (selectedTerritoryId === territoryId) renderTerritoryInspector(territoryId);
        })
        .catch(() => {
          territoryIntelCache.set(territoryId, { ai: null });
          if (selectedTerritoryId === territoryId) renderTerritoryInspector(territoryId);
        });
    }
  }

  function clearTerritorySelection() {
    if (!selectedTerritoryId) return;
    const previousId = selectedTerritoryId;
    const previousLayer = territoryLayersById.get(selectedTerritoryId);
    selectedTerritoryId = null;
    onSelectionChange(null, previousId);
    if (previousLayer) previousLayer.setStyle(territoryStyle(previousLayer.feature));
    renderTerritoryInspector(null);
    renderHomeSelectionPanel(null);
  }

  return Object.freeze({
    clearTerritorySelection,
    confirmHomeSelection,
    enterHomeSelectionMode,
    getSelectedTerritoryId: () => selectedTerritoryId,
    homeSelectionPermission,
    isHomeSelectionMode: () => homeSelectionMode,
    refreshTerritoryDisplay,
    renderHomeSelectionPanel,
    renderTerritoryInspector,
    selectTerritory,
  });
}
