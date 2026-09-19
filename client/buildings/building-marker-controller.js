import { mapObjectDetailScale, mapObjectDetailProgress } from '../../shared/map/object-display-scale.mjs';
import { portMapAnchor } from "./port-map-anchor.js";
import { facilityArtIcon } from '../../shared/config/facility-art.mjs';
function catalogByType(catalog = []) {
  return new Map(catalog.map((entry) => [entry.type, entry]));
}

export function buildingMarkerScale(zoom) {
  const value = Number.isFinite(Number(zoom)) ? Number(zoom) : 5.8;
  return Math.max(.2, Math.min(1.8, 2 ** (value - 5.8))) * mapObjectDetailScale(value) * (1-.15*mapObjectDetailProgress(value));
}

export function buildingMarkerMarkup({territoryId, territoryLabel, buildings = [], catalog = [], scoutingTasks = [], trainingTasks = [], escapeHtml = String} = {}) {
  const definitions = catalogByType(catalog);
  const items = buildings.map((building) => {
    const definition = definitions.get(building.type) ?? {};
    const name = building.name || definition.label || building.label || building.type || "未知设施";
    const task = building.type === "scout-center" ? scoutingTasks.find((entry) => entry.buildingId === building.id && entry.territoryId === territoryId && ["working", "ready"].includes(entry.status)) : null;
    const completedTraining = building.type === "training-center" ? trainingTasks.filter((entry) => entry.buildingId === building.id && entry.territoryId === territoryId && entry.status === "completed").length : 0;
    const status = completedTraining ? `训练完成 · ${completedTraining} 名待查看` : task?.status === "ready" ? "发掘完成 · 待选择" : task ? "球员发掘中" : building.upgradeTo ? `升级至 LV${building.upgradeTo}` : building.status === "constructing" ? "施工中" : "已建成";
    const level = Number(building.level ?? 1);
    const icon = facilityArtIcon(building.type, level) || definition.iconPath || building.iconPath;
    return `<button class="building-map-item ${building.status === "constructing" ? "is-constructing" : ""}" type="button" data-building-id="${escapeHtml(building.id)}" aria-label="${escapeHtml(name)}，LV.${level}，${status}">
      ${icon ? `<img src="${escapeHtml(icon)}" alt="" decoding="async">` : `<span class="building-map-fallback" aria-hidden="true">${escapeHtml(name)}</span>`}
      <small class="building-map-level">${building.upgradeTo ? `LV${level}→${building.upgradeTo}` : building.status === "constructing" ? "施工中" : building.wonder?"奇观":`LV.${level}`}</small>
      ${task?.status === "working" ? `<span class="building-scout-progress" data-building-scout-progress="${escapeHtml(task.id)}" role="progressbar" aria-label="球探发掘进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></span>` : ""}
      ${task?.status === "ready" ? `<span class="building-scout-ready" aria-label="发掘完成，待选择球员" title="发掘完成 · 待选择">✓</span>` : ""}
      ${completedTraining ? `<span class="building-training-ready" aria-label="${completedTraining} 名球员训练完成，待查看" title="训练完成 · ${completedTraining} 名待查看">✓</span>` : ""}
      <span class="building-map-tooltip"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(territoryLabel)} · ${status}</span></span>
    </button>`;
  }).join("");
  return `<span class="building-direct-items" data-building-territory="${escapeHtml(territoryId)}" style="--building-columns:${Math.max(1,Math.min(3,buildings.length))}">${items}</span>`;
}

export function createBuildingMarkerController({
  Leaflet, map, layer, territoryLayersById, territoryMetadataById, getTerritoryWorld, getBuildingCatalog,
  getScoutingTasks = () => [], getScoutingTime = Date.now, getTrainingTasks = () => [],
  isPointVisible = () => true, getCoastlines = () => [],
  selectTerritory, escapeHtml = String, onBuildingSelect = null, beforeSelect = () => {}, minimumZoom = 3,
  requestAnimationFrameImpl = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((callback) => callback()),
} = {}) {
  if (!Leaflet || !map || !layer) throw new Error("Building marker controller requires Leaflet map resources");
  const markers = new Map(), renderedMarkupByTerritory = new Map();
  const boundButtons = new WeakSet(), placementGroups=new Map();
  function territoryBuildings(id) {
    const buildings = getTerritoryWorld()?.territories?.[id]?.buildings;
    return Array.isArray(buildings) ? buildings : [];
  }
  function territoryLabel(id) {
    const metadata = territoryMetadataById.get(id);
    return metadata ? `${metadata.country} - ${metadata.name}` : id;
  }
  function markerMarkup(id, buildings = territoryBuildings(id)) {
    return buildingMarkerMarkup({territoryId:id,territoryLabel:territoryLabel(id),buildings,catalog:getBuildingCatalog() ?? [],scoutingTasks:getScoutingTasks(),trainingTasks:getTrainingTasks(),escapeHtml});
  }
  function iconFor(id,html) {
    return Leaflet.divIcon({className:"building-marker",html,iconSize:[1,1],iconAnchor:[0,0]});
  }
  function bindItems(marker,id) {
    requestAnimationFrameImpl(() => {
      const element=marker.getElement?.();
      if (!element) return;
      updateScoutingProgress();
      Leaflet.DomEvent.disableClickPropagation(element);
      Leaflet.DomEvent.disableScrollPropagation(element);
      element.querySelectorAll?.("[data-building-id]").forEach((button) => {
        if (boundButtons.has(button)) return;
        boundButtons.add(button);
        button.addEventListener("click",(event) => {
          Leaflet.DomEvent.stop(event);
          const building=territoryBuildings(id).find((entry)=>entry.id === button.dataset.buildingId);
          if (!building || !isPointVisible(marker.getLatLng?.())) return;
          beforeSelect(id);
          if (onBuildingSelect) onBuildingSelect({territoryId:id,buildingId:building.id});
          else selectTerritory(id);
        });
      });
    });
  }
  function ensureMarker(id, buildings, anchor = null, key = id) {
    const bounds=territoryLayersById.get(id)?.getBounds?.();
    const position=anchor ?? (bounds?.isValid?.() === false ? null : bounds?.getCenter?.());
    if (!position) return;
    placementGroups.set(key,{territoryId:id,position,count:buildings.length});
    const html=markerMarkup(id, buildings);
    let marker=markers.get(key);
    if (!marker) {
      marker=Leaflet.marker(position,{pane:"buildingPane",icon:iconFor(id,html),keyboard:false,bubblingMouseEvents:false});
      markers.set(key,marker);
      renderedMarkupByTerritory.set(key,html);
    } else {
      marker.setLatLng(position);
      if (renderedMarkupByTerritory.get(key) !== html) {
        marker.setIcon(iconFor(id,html));
        renderedMarkupByTerritory.set(key,html);
        if (layer.hasLayer(marker)) bindItems(marker,id);
      }
    }
  }
  function updateVisibility() {
    const zoom=map.getZoom(),scale=buildingMarkerScale(zoom);
    for (const [id,marker] of markers) {
      const visible=zoom >= minimumZoom && isPointVisible(marker.getLatLng?.());
      if (visible && !layer.hasLayer(marker)) { marker.addTo(layer);bindItems(marker,id); }
      if (!visible && layer.hasLayer(marker)) layer.removeLayer(marker);
      marker.getElement?.()?.style?.setProperty("--building-scale",String(scale));
    }
  }
  function updateScoutingProgress(nowValue = getScoutingTime()) {
    const tasks = new Map(getScoutingTasks().map((task) => [task.id, task]));
    for (const marker of markers.values()) {
      marker.getElement?.()?.querySelectorAll?.("[data-building-scout-progress]").forEach((element) => {
        const task = tasks.get(element.dataset?.buildingScoutProgress);
        if (!task) return;
        const percent = Math.max(0, Math.min(100, (nowValue - task.startedAt) / Math.max(1, task.completesAt - task.startedAt) * 100));
        element.setAttribute("aria-valuenow", String(Math.round(percent)));
        const fill = element.querySelector("i");
        if (fill) fill.style.width = `${percent}%`;
      });
    }
  }
  function refresh() {
    const active=new Set();
    for (const [id,territory] of Object.entries(getTerritoryWorld()?.territories ?? {})) {
      if (!territory.buildings?.length) continue;
      const anchor=portMapAnchor(territoryMetadataById.get(id),getCoastlines(id));
      const group=territory.buildings.filter(building=>building.type!=="port" || !anchor);
      if(group.length) { active.add(id); ensureMarker(id,group); }
      if(anchor) for(const port of territory.buildings.filter(building=>building.type==="port")) {
        const key=id+":port:"+port.id; active.add(key); ensureMarker(id,[port],anchor,key);
      }
    }
    for (const [id,marker] of markers) {
      if (active.has(id)) continue;
      layer.removeLayer(marker);markers.delete(id);renderedMarkupByTerritory.delete(id);placementGroups.delete(id);
    }
    updateVisibility();
    updateScoutingProgress();
  }
  function getUnitObstacles(territoryId,origin,zoom){
    const center=map.project(origin,zoom);
    // Reserve the largest detail-view footprint in geographic coordinates.
    // This avoids measuring CSS transforms from the previous animation frame.
    let scale=0;
    for(let z=5.8;z<=8.01;z+=.05)scale=Math.max(scale,buildingMarkerScale(z)/2**(z-zoom));
    return [...placementGroups.values()].filter(g=>g.territoryId===territoryId).map(g=>{
      const p=map.project(g.position,zoom),columns=Math.min(3,g.count),rows=Math.ceil(g.count/3);
      const width=(columns*52+(columns-1)*6)*scale,height=(rows*60+(rows-1)*6)*scale;
      return {x:p.x-center.x-width/2,y:p.y-center.y-height/2,width,height};
    });
  }
  return Object.freeze({refresh,updateVisibility,updateScoutingProgress,getUnitObstacles});
}
