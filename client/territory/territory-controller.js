import { canUseTerritory, canConquerFromTerritory } from '../../shared/config/diplomacy.mjs';
import { conquestAttackBlock } from '../../shared/config/conquest.mjs';
import { neutralRewardMarkup } from '../resources/neutral-reward-markup.js';
import { campaignFog, fogTerritoryStatus } from "../../shared/config/fog.mjs";
import { territoryResourceMarkup, territoryResourceProfile } from "../resources/resource-markup.js?v=20260908-fans-v1";

export function createTerritoryController({
  documentRef = globalThis.document,
  mapElement,
  ownerTypes,
  territoryMetadataById,
  territoryLayersById,
  attackableTerritoryIds,
  getTerritoryWorld,
  getCampaignState,
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
  refreshTerritoryInteraction = null,
  onSelectionChange = () => {},
  onBuildingsChange = () => {},
  onInspectorOpen = () => {},
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
    return { allowed: true, reason: "可以在这里建立俱乐部总部" };
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

  function isVisible(territoryId) {
    return fogTerritoryStatus(campaignFog(getCampaignState()), territoryId) === "visible";
  }

  function refreshTerritoryDisplay() {
    const territoryWorld = getTerritoryWorld();
    if (!territoryWorld) return;
    territoryLayersById.forEach((layer, territoryId) => {
      const metadata = territoryMetadataById.get(territoryId);
      const state = territoryWorld.territories[territoryId];
      const visible = isVisible(territoryId);
      layer.setStyle(territoryStyle(layer.feature));
      if (!visible) territoryIntelCache.delete(territoryId);
      if (refreshTerritoryInteraction) refreshTerritoryInteraction(layer,territoryId,visible);
      else {
        if (layer.options) layer.options.interactive = visible;
        if (!visible) { layer.closeTooltip?.(); layer.unbindTooltip?.(); }
        else if (layer.getTooltip && !layer.getTooltip()) layer.bindTooltip(territoryTooltipMarkup(metadata, state), { sticky:true, direction:"top", offset:[0,-8], opacity:1, className:"territory-tooltip" });
        if (visible && metadata && state) layer.setTooltipContent(territoryTooltipMarkup(metadata, state));
      }
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
      showToast("俱乐部总部建立成功，所在地今后无法更改");
    } catch (error) {
      try {
        const latest = await campaignRequest("/api/campaign/state");
        campaignStore.setState(latest.state, { source: "home-claim-refresh" });
        applyCampaignWorldSnapshot(getCampaignState().world);
        refreshTerritoryDisplay();
      } catch {}
      showToast(error.message || "总部建立失败");
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
    const cancelButton = documentRef.querySelector("#territory-maritime-cancel-button");
    const challengeStatus = documentRef.querySelector("#territory-challenge-status");
    challengeButton.hidden = false;
    cancelButton.hidden = !maritimeMode;
    const metadata = territoryMetadataById.get(territoryId);
    const state = territoryWorld?.territories[territoryId];
    const ownTerritory = Boolean(metadata && state?.ownerType === ownerTypes.PLAYER
      && campaignState?.playerId != null && state.ownerId === campaignState.playerId);
    inspector.classList.toggle("is-own-territory",ownTerritory);
    for (const row of documentRef.querySelectorAll("[data-territory-ai-row]")) row.hidden = ownTerritory;
    if (!metadata || !state || !isVisible(territoryId)) {
      inspector.hidden = true;
      onBuildingsChange(null);
      inspector.classList.remove("has-selection");
      documentRef.querySelector("#territory-name").textContent = "选择一个省级区块";
      documentRef.querySelector("#territory-owner").textContent = "未选择";
      const weatherElement = documentRef.querySelector("#territory-weather");
      weatherElement.textContent = "—";
      weatherElement.removeAttribute("title");
      for (const id of ["territory-ai-difficulty", "territory-ai-overall", "territory-ai-formation", "territory-ai-style"]) {
        documentRef.querySelector(`#${id}`).textContent = "—";
      }
      actions.hidden = true;
      cancelButton.hidden = true;
      return;
    }

    onInspectorOpen(territoryId);
    inspector.hidden = false;
    inspector.classList.add("has-selection");
    documentRef.querySelector("#territory-name").textContent = `${metadata.country} - ${metadata.name}`;
    documentRef.querySelector("#territory-owner").textContent = territoryOwnerLabel(metadata, state);
    const resourceElement = documentRef.querySelector("#territory-resources");
    if (resourceElement) { resourceElement.innerHTML = territoryResourceMarkup(territoryResourceProfile(metadata,campaignState)); resourceElement.hidden = !resourceElement.innerHTML; }
    const sponsorReward = documentRef.querySelector("#territory-sponsor-reward");
    if (sponsorReward) { sponsorReward.innerHTML = state.ownerType === ownerTypes.NEUTRAL && !homeSelectionMode ? neutralRewardMarkup(campaignState?.world?.territories?.[territoryId]?.neutralReward) : ""; sponsorReward.hidden = !sponsorReward.innerHTML; }
    const weather = campaignState?.world?.weather?.territories?.[territoryId] ?? null;
    const weatherElement = documentRef.querySelector("#territory-weather");
    weatherElement.textContent = weather ? `${weather.icon} ${weather.label}` : "—";
    if (weather) weatherElement.title = `降水强度 ${weather.precipitation}% · 每个整点刷新`;
    else weatherElement.removeAttribute("title");

    const expeditionPiece = campaignState?.expeditionPiece;
    const buildingEntryVisible = !homeSelectionMode
      && Boolean(campaignState?.setupComplete)
      && state.ownerType !== ownerTypes.NEUTRAL;
    onBuildingsChange(buildingEntryVisible ? territoryId : null);
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
    if(!actions.hidden&&metadata.eliteClubIds?.length){challengeButton.disabled=false;challengeButton.dataset.action='elite';challengeButton.textContent='查看豪门挑战';challengeStatus.textContent='不可占领 · 无需接壤 · 单场挑战 5,000 金币';cancelButton.hidden=true;return;}
    if(!actions.hidden&&campaignState?.eliteChallenge?.activeId){challengeButton.disabled=true;challengeButton.dataset.action='challenge';challengeButton.textContent='豪门挑战进行中';challengeStatus.textContent='本场结束后可再次发起地块挑战';return;}
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
    if(!actions.hidden && state.ownerType==='player' && !canUseTerritory(campaignState.world,campaignState.playerId,territoryId) && campaignState.interactions?.players?.find(p=>p.id===state.ownerId)?.state!=='war') {
      challengeButton.disabled=true;challengeButton.dataset.action='challenge';challengeButton.textContent='需要先宣战';challengeStatus.textContent='在服务器玩家列表中选择该玩家，宣战后才可进攻其领土。';return;
    }
    if (!actions.hidden) {
      const attackable = attackableTerritoryIds.has(territoryId);
      const coastal = campaignState?.coastalTerritoryIds?.includes(territoryId);
      const maritimeTarget = maritimeTargetIds.has(territoryId);
      if (ownTerritory || canUseTerritory(campaignState.world,campaignState.playerId,territoryId)) {
        const expeditionReadyHere = !expeditionPiece?.moving && expeditionPiece?.territoryId === territoryId;
        actions.hidden = !coastal || !expeditionReadyHere;
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
        if(!actions.hidden&&state.ownerType==='neutral'&&!canConquerFromTerritory(campaignState.world,campaignState.playerId,expeditionPiece?.territoryId)){challengeButton.disabled=true;challengeButton.textContent='需要盟友授权';challengeStatus.textContent='请在该盟友的俱乐部主页申请借地征服，对方同意后可持续使用，直至撤销。';}
        const blocked = conquestAttackBlock(campaignState?.conquest, state.ownerType);
        if (blocked && !actions.hidden) {
          challengeButton.disabled = true;
          challengeButton.textContent = blocked.code === 'expedition-cooldown' ? '远征队休整中' : '今日征服次数已用完';
          challengeStatus.textContent = blocked.message;
        }
      }
    }
    if (maritimeMode && actions.hidden && !homeSelectionMode) {
      actions.hidden = false;
      challengeButton.hidden = true;
      challengeStatus.textContent = "海岸测绘仍在进行；可返回航线目标或取消测绘";
    }
  }

  function selectTerritory(territoryId) {
    if (!isVisible(territoryId)) return;
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
          if (!isVisible(territoryId)) return;
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
