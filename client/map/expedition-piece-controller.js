function countdownLabel(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function movementProgress(piece,nowValue) {
  const movement=piece?.movement;
  if (!movement) return 0;
  const duration=Math.max(1,Number(movement.durationMs)||Number(movement.arrivesAt)-Number(movement.startedAt)||1);
  return Math.max(0,Math.min(1,(Number(nowValue)-Number(movement.startedAt))/duration));
}

export function expeditionTokenMetrics(zoomValue) {
  const zoom = Number.isFinite(Number(zoomValue)) ? Number(zoomValue) : 5.8;
  const zoomProgress = Math.max(0, Math.min(1, (zoom - 3) / 2.8));
  const scale = 0.58 + (0.42 * zoomProgress);
  return {
    iconSize: [Math.round(76 * scale), Math.round(80 * scale)],
    iconAnchor: [Math.round(38 * scale), Math.round(64 * scale)],
  };
}

export function createExpeditionPieceController({
  documentRef=globalThis.document,
  Leaflet,
  map,
  mapElement,
  layer,
  territoryMetadataById,
  getCampaignState,
  getCampaignRequest,
  sourcePointToDisplay,
  campaignStore,
  applyCampaignWorldSnapshot,
  refreshTerritoryDisplay,
  beforeBegin=()=>{},
  showToast=()=>{},
  escapeHtml=String,
  now = Date.now,
}) {
  let marker = null;
  let movementLine = null;
  let timer = null;
  let selectingDestination=false;
  let pendingEstimate=null;
  let requestPending=false;
  const targetIds=new Set();
  const confirmPanel=documentRef.querySelector("#expedition-move-confirm");
  const movementWidget=documentRef.querySelector("#expedition-movement-widget");
  const confirmButton=confirmPanel?.querySelector("[data-expedition-move-confirm]");
  const cancelConfirmButton=confirmPanel?.querySelector("[data-expedition-move-back]");
  if (confirmPanel) Leaflet.DomEvent.disableClickPropagation(confirmPanel);
  if (movementWidget) Leaflet.DomEvent.disableClickPropagation(movementWidget);

  function position(territoryId) {
    const metadata = territoryMetadataById.get(territoryId);
    return metadata?.centroid ? sourcePointToDisplay(territoryId, metadata.centroid) : null;
  }

  function currentPosition(piece) {
    const source=position(piece?.movement?.fromTerritoryId ?? piece?.territoryId);
    const destination=position(piece?.movement?.toTerritoryId);
    if (!piece?.movement||!source||!destination) return source;
    const progress=movementProgress(piece,now());
    return [source[0]+(destination[0]-source[0])*progress,source[1]+(destination[1]-source[1])*progress];
  }

  function territoryName(territoryId) {
    return territoryMetadataById.get(territoryId)?.name ?? territoryId ?? "未知地块";
  }

  function closeConfirmation() {
    pendingEstimate=null;
    if (confirmPanel) confirmPanel.hidden=true;
  }

  function updateTargets() {
    targetIds.clear();
    const state=getCampaignState();
    for (const territoryId of state?.world?.players?.[state.playerId]?.territoryIds ?? []) targetIds.add(territoryId);
  }

  function setSelectingDestination(value,{keepConfirmation=false}={}) {
    selectingDestination=Boolean(value);
    if (selectingDestination) updateTargets();
    else targetIds.clear();
    if (!keepConfirmation) closeConfirmation();
    mapElement?.classList.toggle("is-expedition-move-mode",selectingDestination);
    refreshTerritoryDisplay?.();
    refresh();
  }

  function icon(piece) {
    const { iconSize, iconAnchor } = expeditionTokenMetrics(map.getZoom());
    return Leaflet.divIcon({
      className: "expedition-piece-map-icon",
      html: `<button type="button" class="expedition-piece-token ${piece.moving ? "is-moving" : ""} ${selectingDestination ? "is-selecting" : ""}" style="--expedition-piece-width:${iconSize[0]}px;--expedition-piece-height:${iconSize[1]}px" aria-label="${piece.moving ? "远征队移动中" : "调动远征队"}"><img src="${piece.tokenUrl}" alt=""></button>`,
      iconSize,
      iconAnchor,
    });
  }

  function updateZoom() {
    const piece = getCampaignState()?.expeditionPiece;
    if (piece && marker) marker.setIcon(icon(piece));
  }

  function renderMovementWidget() {
    const piece = getCampaignState()?.expeditionPiece;
    if (!movementWidget) return;
    if (!piece?.movement) {
      movementWidget.hidden=true;
      movementWidget.replaceChildren();
      return;
    }
    const progress=movementProgress(piece,now());
    const remaining=Math.max(0,Number(piece.movement.arrivesAt)-Number(now()));
    movementWidget.hidden=false;
    movementWidget.innerHTML=`<div class="campaign-expedition-card"><span class="campaign-expedition-kicker">远征队移动中</span><strong><b>${escapeHtml(territoryName(piece.movement.fromTerritoryId))}</b><i>→</i><b>${escapeHtml(territoryName(piece.movement.toTerritoryId))}</b></strong><div class="campaign-expedition-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress*100)}"><i style="width:${(progress*100).toFixed(1)}%"></i></div><div class="campaign-expedition-footer"><span>${countdownLabel(remaining)}</span><button type="button" data-expedition-abort ${requestPending?"disabled":""}>中止</button></div></div>`;
    movementWidget.querySelector("[data-expedition-abort]")?.addEventListener("click",abortMovement);
  }

  function updateMovementDisplay() {
    const piece=getCampaignState()?.expeditionPiece;
    if (piece?.movement&&marker) marker.setLatLng(currentPosition(piece));
    renderMovementWidget();
  }

  function refresh() {
    const piece = getCampaignState()?.expeditionPiece;
    if (piece?.moving&&selectingDestination) setSelectingDestination(false);
    const point = piece?.territoryId ? currentPosition(piece) : null;
    if (!piece || !point) {
      marker?.remove();
      marker = null;
      movementLine?.remove();
      movementLine = null;
      renderMovementWidget();
      return;
    }
    if (!marker) {
      marker = Leaflet.marker(point, {
        pane: "expeditionPane",
        icon: icon(piece),
        interactive: true,
        bubblingMouseEvents: false,
        zIndexOffset: 1000,
      }).on("click", (event) => { Leaflet.DomEvent.stop(event);beginMoveMode(); }).addTo(layer);
    } else {
      marker.setLatLng(point);
      marker.setIcon(icon(piece));
    }
    movementLine?.remove();
    movementLine = null;
    const destination = piece.movement?.toTerritoryId ? position(piece.movement.toTerritoryId) : null;
    if (destination) {
      movementLine = Leaflet.polyline([point, destination], {
        pane: "expeditionPane",
        color: "#f1cb62",
        weight: 2,
        dashArray: "7 8",
        opacity: 0.86,
        interactive: false,
      }).addTo(layer);
    }
    if (!timer) timer = setInterval(updateMovementDisplay, 1000);
    updateMovementDisplay();
  }

  function beginMoveMode() {
    const state=getCampaignState();
    if (state?.expeditionPiece?.moving) { showToast("远征队正在移动中");return false; }
    if (state?.activeChallengeId) { showToast("板块挑战进行中，远征队暂时不能调动");return false; }
    beforeBegin();
    setSelectingDestination(true);
    showToast("请选择任意本方领土地块");
    return true;
  }

  function cancelMoveMode() {
    if (!selectingDestination&&!pendingEstimate) return false;
    setSelectingDestination(false);
    showToast("已退出远征队移动模式");
    return true;
  }

  async function chooseDestination(territoryId) {
    if (!selectingDestination||requestPending) return;
    if (!targetIds.has(territoryId)) return showToast("远征队只能在本方领土内移动");
    if (territoryId===getCampaignState()?.expeditionPiece?.territoryId) return showToast("远征队已经驻扎在该地块");
    requestPending=true;
    try {
      const value=await getCampaignRequest()("/api/campaign/expedition/estimate",{method:"POST",body:{territoryId}});
      if (!selectingDestination) return;
      pendingEstimate={territoryId,...value.estimate};
      confirmPanel.querySelector("[data-expedition-from]").textContent=territoryName(value.estimate.fromTerritoryId);
      confirmPanel.querySelector("[data-expedition-to]").textContent=territoryName(value.estimate.toTerritoryId);
      confirmPanel.querySelector("[data-expedition-duration]").textContent=`预计 ${Math.ceil(Number(value.estimate.durationMs)/60_000)} 分钟`;
      confirmPanel.hidden=false;
    } catch(error) {
      showToast(error.message||"无法估算移动时间");
    } finally {
      requestPending=false;
    }
  }

  function handleTerritoryClick(territoryId) {
    if (!selectingDestination) return false;
    chooseDestination(territoryId);
    return true;
  }

  async function confirmMovement() {
    if (!pendingEstimate||requestPending) return;
    requestPending=true;
    if (confirmButton) confirmButton.disabled=true;
    try {
      const value=await getCampaignRequest()("/api/campaign/expedition/move",{method:"POST",body:{territoryId:pendingEstimate.territoryId}});
      campaignStore.setState(value.state,{source:"expedition-move"});
      setSelectingDestination(false);
      applyCampaignWorldSnapshot(value.state.world);
      showToast(`远征队开始移动，预计 ${Math.ceil(Number(value.expeditionPiece?.movement?.durationMs)/60_000)} 分钟抵达`);
    } catch(error) {
      showToast(error.message||"远征队移动失败");
    } finally {
      requestPending=false;
      if (confirmButton) confirmButton.disabled=false;
    }
  }

  async function abortMovement() {
    if (requestPending||!getCampaignState()?.expeditionPiece?.moving) return;
    requestPending=true;
    renderMovementWidget();
    try {
      const value=await getCampaignRequest()("/api/campaign/expedition/cancel",{method:"POST"});
      campaignStore.setState(value.state,{source:"expedition-cancel"});
      applyCampaignWorldSnapshot(value.state.world);
      showToast(`远征队已中止移动，返回 ${territoryName(value.expeditionPiece?.territoryId)}`);
    } catch(error) {
      showToast(error.message||"无法中止远征队移动");
    } finally {
      requestPending=false;
      refresh();
    }
  }

  function destroy() {
    if (timer) clearInterval(timer);
    timer = null;
    layer.clearLayers();
    marker = null;
    movementLine = null;
    selectingDestination=false;
    targetIds.clear();
    closeConfirmation();
    mapElement?.classList.remove("is-expedition-move-mode");
    refreshTerritoryDisplay?.();
    if (movementWidget) movementWidget.hidden=true;
  }

  confirmButton?.addEventListener("click",confirmMovement);
  cancelConfirmButton?.addEventListener("click",closeConfirmation);

  return Object.freeze({
    beginMoveMode,
    cancelMoveMode,
    destroy,
    getTargetIds:()=>targetIds,
    handleTerritoryClick,
    isSelectingDestination:()=>selectingDestination,
    refresh,
    updateZoom,
  });
}
