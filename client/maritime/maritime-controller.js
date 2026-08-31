export function createMaritimeController({
  Leaflet,
  map,
  mapElement,
  maritimeRenderer,
  territoryMetadataById,
  getCoastlineData,
  getTerritoryWorld,
  getCampaignState,
  getCampaignRequest,
  getSelectedTerritoryId,
  ownActiveChallenge,
  sourcePointToDisplay,
  displayPointToSource,
  selectTerritory,
  refreshTerritoryDisplay,
  renderTerritoryInspector,
  showToast,
}) {
  let maritimeMode = null;
  let maritimeRouteLayer = null;
  let maritimeSnapMarker = null;
  const maritimeTargetIds = new Set();

  function clearMaritimeMode({ keepSelection = false } = {}) {
    maritimeMode = null;
    maritimeTargetIds.clear();
    maritimeRouteLayer?.remove();
    maritimeRouteLayer = null;
    maritimeSnapMarker?.remove();
    maritimeSnapMarker = null;
    mapElement.classList.remove("is-selecting-coast");
    if (!keepSelection) refreshTerritoryDisplay();
  }

  function cancelMaritimeCampaign() {
    if (!maritimeMode) return false;
    clearMaritimeMode();
    renderTerritoryInspector(getSelectedTerritoryId());
    showToast("已取消海岸测绘");
    return true;
  }

  function nearestCoastPoint(territoryId, latlng) {
    const coastlines = getCoastlineData()?.territories?.[territoryId]?.coastlines ?? [];
    const cursor = map.latLngToLayerPoint(latlng);
    let nearest = null;
    coastlines.forEach((line) => {
      for (let index = 1; index < line.length; index += 1) {
        const startLatLng = Leaflet.latLng(...sourcePointToDisplay(territoryId, line[index - 1]));
        const endLatLng = Leaflet.latLng(...sourcePointToDisplay(territoryId, line[index]));
        const start = map.latLngToLayerPoint(startLatLng);
        const end = map.latLngToLayerPoint(endLatLng);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const ratio = lengthSquared
          ? Math.max(0, Math.min(1, ((cursor.x - start.x) * dx + (cursor.y - start.y) * dy) / lengthSquared))
          : 0;
        const snappedLayerPoint = Leaflet.point(start.x + dx * ratio, start.y + dy * ratio);
        const distance = cursor.distanceTo(snappedLayerPoint);
        if (!nearest || distance < nearest.distance) {
          const displayLatLng = map.layerPointToLatLng(snappedLayerPoint);
          nearest = {
            sourcePoint: displayPointToSource(territoryId, displayLatLng),
            displayLatLng,
            distance,
          };
        }
      }
    });
    return nearest;
  }

  function updateMaritimeSnap(latlng) {
    if (!maritimeMode || maritimeMode.routes) return;
    const nearest = nearestCoastPoint(maritimeMode.sourceTerritoryId, latlng);
    maritimeMode.pendingPoint = nearest?.distance <= 34 ? nearest : null;
    if (!maritimeMode.pendingPoint) {
      maritimeSnapMarker?.remove();
      maritimeSnapMarker = null;
      return;
    }
    if (!maritimeSnapMarker) {
      maritimeSnapMarker = Leaflet.circleMarker(nearest.displayLatLng, {
        radius: 7,
        color: "#f1eddf",
        weight: 2,
        fillColor: "#71d9d0",
        fillOpacity: 1,
        pane: "maritimePane",
        renderer: maritimeRenderer,
        interactive: false,
      }).addTo(map);
    } else {
      maritimeSnapMarker.setLatLng(nearest.displayLatLng);
    }
  }

  function drawMaritimeRoutes(result) {
    maritimeRouteLayer?.remove();
    maritimeRouteLayer = Leaflet.layerGroup().addTo(map);
    maritimeTargetIds.clear();
    result.routes.forEach((route) => {
      maritimeTargetIds.add(route.targetTerritoryId);
      const from = sourcePointToDisplay(result.sourceTerritoryId, route.sourcePoint);
      const to = sourcePointToDisplay(route.targetTerritoryId, route.targetPoint);
      const chooseTarget = () => {
        selectTerritory(route.targetTerritoryId);
        const targetName = territoryMetadataById.get(route.targetTerritoryId)?.name ?? "登陆地块";
        showToast(`已选择 ${targetName}，请点击左上角“发起跨海挑战”`);
      };
      Leaflet.polyline([from, to], {
        color: "#71d9d0",
        weight: 5,
        dashArray: "7 7",
        opacity: 0.9,
        interactive: true,
        bubblingMouseEvents: false,
        pane: "maritimePane",
        renderer: maritimeRenderer,
      }).on("click", chooseTarget).addTo(maritimeRouteLayer);
      Leaflet.circleMarker(to, {
        radius: 8,
        color: "#c9f05c",
        weight: 2,
        fillColor: "#071411",
        fillOpacity: 1,
        interactive: true,
        bubblingMouseEvents: false,
        pane: "maritimePane",
        renderer: maritimeRenderer,
      })
        .bindTooltip(
          `${territoryMetadataById.get(route.targetTerritoryId)?.name ?? "登陆地块"} · ${route.distanceKm} 公里 · 点击选择`,
          { direction: "top" },
        )
        .on("click", chooseTarget)
        .addTo(maritimeRouteLayer);
    });
    refreshTerritoryDisplay();
  }

  async function confirmMaritimePoint(latlng) {
    if (!maritimeMode || maritimeMode.routes) return;
    updateMaritimeSnap(latlng);
    const selected = maritimeMode.pendingPoint;
    if (!selected) {
      showToast("请把鼠标靠近该地块的海岸线选择出发点");
      return;
    }
    const activeMode = maritimeMode;
    try {
      const result = await getCampaignRequest()("/api/campaign/maritime/routes", {
        method: "POST",
        body: {
          sourceTerritoryId: activeMode.sourceTerritoryId,
          sourcePoint: selected.sourcePoint,
        },
      });
      if (maritimeMode !== activeMode) return;
      maritimeMode = { ...maritimeMode, sourcePoint: result.sourcePoint, routes: result.routes };
      maritimeSnapMarker?.setStyle({ color: "#c9f05c", fillColor: "#c9f05c" });
      drawMaritimeRoutes(result);
      renderTerritoryInspector(maritimeMode.sourceTerritoryId);
      showToast(
        result.routes.length
          ? `已发现 ${result.routes.length} 个直线可登陆地块，请点击目标发起挑战`
          : "该出发点没有可直线到达的登陆地块",
      );
    } catch (error) {
      showToast(error.message || "航线计算失败");
    }
  }

  function beginMaritimeCampaign() {
    if (ownActiveChallenge()) {
      showToast("已有一场板块挑战正在进行，比赛结束前不能再次出海");
      return;
    }
    const territoryId = getSelectedTerritoryId();
    const state = getTerritoryWorld()?.territories?.[territoryId];
    const campaignState = getCampaignState();
    if (
      !territoryId
      || state?.ownerId !== campaignState?.playerId
      || !campaignState?.coastalTerritoryIds?.includes(territoryId)
    ) return;
    clearMaritimeMode({ keepSelection: true });
    maritimeMode = { sourceTerritoryId: territoryId, pendingPoint: null, routes: null };
    mapElement.classList.add("is-selecting-coast");
    const lines = getCoastlineData()?.territories?.[territoryId]?.coastlines ?? [];
    maritimeRouteLayer = Leaflet.layerGroup().addTo(map);
    lines.forEach((line) => {
      Leaflet.polyline(line.map((point) => sourcePointToDisplay(territoryId, point)), {
        color: "#71d9d0",
        weight: 4,
        opacity: 0.95,
        interactive: false,
        pane: "maritimePane",
        renderer: maritimeRenderer,
      }).addTo(maritimeRouteLayer);
    });
    renderTerritoryInspector(territoryId);
    showToast("移动鼠标吸附海岸点，点击地图确认出发点");
  }

  return Object.freeze({
    beginMaritimeCampaign,
    cancelMaritimeCampaign,
    clearMaritimeMode,
    confirmMaritimePoint,
    getMode: () => maritimeMode,
    getRouteTo: (territoryId) => (
      maritimeMode?.routes?.find((route) => route.targetTerritoryId === territoryId) ?? null
    ),
    getTargetIds: () => maritimeTargetIds,
    isSelectingPoint: () => Boolean(maritimeMode && !maritimeMode.routes),
    nearestCoastPoint,
    updateMaritimeSnap,
  });
}
