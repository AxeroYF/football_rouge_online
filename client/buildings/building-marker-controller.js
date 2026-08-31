function catalogByType(catalog = []) {
  return new Map(catalog.map((entry) => [entry.type, entry]));
}

export function buildingOrbitLayout(countValue) {
  const count = Math.max(0, Number(countValue) || 0);
  if (!count) return [];
  const radius = count >= 6 ? 142 : count >= 4 ? 124 : count >= 2 ? 108 : 92;
  return Array.from({ length: count }, (_, index) => {
    const angle = -90 + (360 / count) * index;
    const radians = angle * Math.PI / 180;
    return {
      angle,
      radius,
      x: Math.cos(radians) * radius,
      y: Math.sin(radians) * radius,
      delayMs: index * 38,
    };
  });
}

function publicBuilding(building, definitions) {
  const definition = definitions.get(building.type) ?? {};
  return {
    ...building,
    label: definition.label ?? building.type ?? "未知设施",
    iconPath: definition.iconPath ?? "",
    maxLevel: Number(definition.maxLevel ?? building.level ?? 1),
    displayName: building.name || definition.label || building.type || "未知设施",
  };
}

export function buildingMarkerMarkup({
  territoryId,
  territoryLabel,
  buildings = [],
  catalog = [],
  expanded = false,
  escapeHtml = String,
} = {}) {
  const definitions = catalogByType(catalog);
  const entries = buildings.map((building) => publicBuilding(building, definitions));
  const listText = entries.map((building) => building.status === "constructing"
    ? `${building.label} 施工中`
    : `${building.label} LV.${Number(building.level ?? 1)}`).join(" · ");
  const nodeClasses = ["building-node", expanded ? "is-expanded" : ""].filter(Boolean).join(" ");
  const node = `<span class="${nodeClasses}" data-building-node="${escapeHtml(territoryId)}">
    <i aria-hidden="true"></i><b>设施</b><small>${entries.length}</small>
    <span class="building-list-tooltip"><strong>${escapeHtml(territoryLabel)}</strong><span>${escapeHtml(listText)}</span><em>点击展开设施</em></span>
  </span>`;
  if (!expanded) return node;
  const layout = buildingOrbitLayout(entries.length);
  const orbit = entries.map((building, index) => {
    const position = layout[index];
    const image = building.iconPath
      ? `<img src="${escapeHtml(building.iconPath)}" alt="" loading="lazy" decoding="async" />`
      : `<span class="building-orbit-fallback" aria-hidden="true"></span>`;
    return `<span class="building-orbit-ray" style="--building-ray-angle:${position.angle}deg;--building-ray-length:${position.radius - 25}px"></span>
      <button class="building-orbit-item ${building.status === "constructing" ? "is-constructing" : ""}" type="button" data-building-id="${escapeHtml(building.id)}" style="--building-orbit-x:${position.x.toFixed(1)}px;--building-orbit-y:${position.y.toFixed(1)}px;--building-orbit-delay:${position.delayMs}ms" aria-label="${escapeHtml(building.displayName)}，LV.${Number(building.level ?? 1)}，${building.status === "constructing" ? "施工中" : "已建成"}">
        ${image}
        <span class="building-orbit-tooltip"><span class="building-orbit-tooltip-copy"><strong>${escapeHtml(building.displayName)}</strong><small>${escapeHtml(building.label)} · ${escapeHtml(territoryLabel)}</small></span><span class="building-orbit-tooltip-meta"><b>LV.${Number(building.level ?? 1)}</b><em>${building.status === "constructing" ? "施工中" : "已建成"}</em></span></span>
      </button>`;
  }).join("");
  return `${node}<span class="building-orbit" data-building-orbit="${escapeHtml(territoryId)}">${orbit}</span>`;
}

export function createBuildingMarkerController({
  Leaflet,
  map,
  layer,
  territoryLayersById,
  territoryMetadataById,
  getTerritoryWorld,
  getBuildingCatalog,
  selectTerritory,
  escapeHtml = String,
  showToast = () => {},
  onBuildingSelect = () => {},
  beforeExpand = () => {},
  minimumZoom = 4.05,
  requestAnimationFrameImpl = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((callback) => callback()),
} = {}) {
  if (!Leaflet || !map || !layer) throw new Error("Building marker controller requires Leaflet map resources");
  const markers = new Map();
  const renderedMarkupByTerritory = new Map();
  let expandedTerritoryId = null;

  function territoryBuildings(territoryId) {
    const buildings = getTerritoryWorld()?.territories?.[territoryId]?.buildings;
    return Array.isArray(buildings) ? buildings : [];
  }

  function territoryLabel(territoryId) {
    const metadata = territoryMetadataById.get(territoryId);
    return metadata ? `${metadata.country} - ${metadata.name}` : territoryId;
  }

  function markerPosition(territoryId) {
    const bounds = territoryLayersById.get(territoryId)?.getBounds?.();
    return bounds?.isValid?.() === false ? null : bounds?.getCenter?.() ?? null;
  }

  function markerMarkup(territoryId) {
    return buildingMarkerMarkup({
      territoryId,
      territoryLabel: territoryLabel(territoryId),
      buildings: territoryBuildings(territoryId),
      catalog: getBuildingCatalog() ?? [],
      expanded: expandedTerritoryId === territoryId,
      escapeHtml,
    });
  }

  function iconFor(territoryId, html = markerMarkup(territoryId)) {
    return Leaflet.divIcon({
      className: "building-marker",
      html,
      iconSize: [1, 1],
      iconAnchor: [0, 0],
    });
  }

  function bindOrbitItems(marker, territoryId) {
    requestAnimationFrameImpl(() => {
      const element = marker.getElement?.();
      if (!element) return;
      const orbit = element.querySelector?.("[data-building-orbit]");
      if (orbit) {
        Leaflet.DomEvent.disableClickPropagation(orbit);
        Leaflet.DomEvent.disableScrollPropagation(orbit);
      }
      element.querySelectorAll?.("[data-building-id]").forEach((button) => {
        button.addEventListener("click", (event) => {
          Leaflet.DomEvent.stop(event);
          const building = territoryBuildings(territoryId).find((candidate) => candidate.id === button.dataset.buildingId);
          const definition = catalogByType(getBuildingCatalog() ?? []).get(building?.type);
          selectTerritory(territoryId);
          showToast(`${building?.name || definition?.label || "设施"} · LV.${Number(building?.level ?? 1)}`);
          onBuildingSelect({ territoryId, buildingId: building?.id ?? null });
        });
      });
    });
  }

  function refreshMarker(territoryId) {
    const marker = markers.get(territoryId);
    if (!marker) return;
    const html = markerMarkup(territoryId);
    if (renderedMarkupByTerritory.get(territoryId) === html) {
      marker.setZIndexOffset(expandedTerritoryId === territoryId ? 2600 : 0);
      return;
    }
    marker.setIcon(iconFor(territoryId, html));
    renderedMarkupByTerritory.set(territoryId, html);
    marker.setZIndexOffset(expandedTerritoryId === territoryId ? 2600 : 0);
    bindOrbitItems(marker, territoryId);
  }

  function closeExpanded() {
    if (!expandedTerritoryId) return false;
    const previous = expandedTerritoryId;
    expandedTerritoryId = null;
    refreshMarker(previous);
    return true;
  }

  function toggle(territoryId) {
    if (!territoryBuildings(territoryId).length) return;
    const previous = expandedTerritoryId;
    if (previous !== territoryId) beforeExpand(territoryId);
    expandedTerritoryId = previous === territoryId ? null : territoryId;
    if (previous && previous !== territoryId) refreshMarker(previous);
    refreshMarker(territoryId);
    const position = markerPosition(territoryId);
    if (expandedTerritoryId && position) map.panTo(position, { animate: true, duration: 0.35 });
  }

  function ensureMarker(territoryId) {
    const position = markerPosition(territoryId);
    if (!position) return null;
    let marker = markers.get(territoryId);
    if (!marker) {
      const html = markerMarkup(territoryId);
      marker = Leaflet.marker(position, {
        pane: "buildingPane",
        icon: iconFor(territoryId, html),
        keyboard: true,
        bubblingMouseEvents: false,
        title: `${territoryLabel(territoryId)} · ${territoryBuildings(territoryId).length} 座设施`,
      });
      marker.on("click", () => toggle(territoryId));
      markers.set(territoryId, marker);
      renderedMarkupByTerritory.set(territoryId, html);
    } else {
      marker.setLatLng(position);
      refreshMarker(territoryId);
    }
    return marker;
  }

  function updateVisibility() {
    const visible = map.getZoom() >= minimumZoom;
    for (const [territoryId, marker] of markers) {
      const shouldRemainVisible = visible || expandedTerritoryId === territoryId;
      if (shouldRemainVisible && !layer.hasLayer(marker)) marker.addTo(layer);
      if (!shouldRemainVisible && layer.hasLayer(marker)) layer.removeLayer(marker);
    }
  }

  function refresh() {
    const activeTerritoryIds = new Set(
      Object.entries(getTerritoryWorld()?.territories ?? {})
        .filter(([, territory]) => Array.isArray(territory.buildings) && territory.buildings.length)
        .map(([territoryId]) => territoryId),
    );
    for (const territoryId of activeTerritoryIds) ensureMarker(territoryId);
    for (const [territoryId, marker] of markers) {
      if (activeTerritoryIds.has(territoryId)) continue;
      layer.removeLayer(marker);
      markers.delete(territoryId);
      renderedMarkupByTerritory.delete(territoryId);
      if (expandedTerritoryId === territoryId) expandedTerritoryId = null;
    }
    updateVisibility();
  }

  return Object.freeze({
    closeExpanded,
    getExpandedTerritoryId: () => expandedTerritoryId,
    refresh,
    toggle,
    updateVisibility,
  });
}
