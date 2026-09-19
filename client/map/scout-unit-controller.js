import { unitTeamBadge, compactUnitBadge } from './map-unit-color.js';
import { mapObjectDetailScale, mapObjectDetailProgress } from '../../shared/map/object-display-scale.mjs';
import { unitTravelFrame, interpolateMapTravel } from '../../shared/map/unit-travel.mjs';
import { SCOUT_TOKEN_URL } from "../../shared/scouting/scout-units.mjs";

export function scoutTokenMetrics(zoom) {
  const scale = Math.max(.32, Math.min(1, 2 ** ((Number(zoom) || 5) - 6.2))) * mapObjectDetailScale(zoom);
  return { width: Math.round(64 * scale), height: Math.round(82 * scale), scale };
}
export function scoutTokenAnchor(zoom,index=0){
 const m=scoutTokenMetrics(zoom),spacing=44+28*mapObjectDetailProgress(zoom);
 const offset=(index%2?-1:1)*(spacing+72*Math.floor(index/2))*m.scale;
 return [m.width/2-offset,m.height-6*m.scale];
}
export function createScoutUnitController({
  Leaflet, map, mapElement, layer, territoryMetadataById, sourcePointToDisplay,
  getDisplayMetrics = (_unit, fallback) => fallback,
  getCampaignState, getServerNow = Date.now, onOpen = () => {}, onPlanMove = () => {},
  beforeBegin = () => {}, refreshTerritoryDisplay = () => {}, showToast = () => {},
  documentRef = globalThis.document, escapeHtml = String,
  requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
}) {
  const markers = new Map(), routes = new Map(), targetIds = new Set();
  let selectedId = null, frameId = null, destroyed = false;
  const scouts = () => getCampaignState()?.scouting?.scouts ?? [];
  const point = id => {
    const metadata = territoryMetadataById.get(id);
    return metadata?.centroid ? sourcePointToDisplay(id, metadata.centroid) : null;
  };
  function location(unit) {
    const frame = unitTravelFrame(unit.movement, getServerNow());
    if (!frame) return point(unit.territoryId);
    const from = point(frame.fromTerritoryId), to = point(frame.toTerritoryId);
    if (!from || !to) return point(unit.territoryId);
    return interpolateMapTravel(map,from,to,frame.progress);
  }
  function displayMetrics(unit,index){
    const base=scoutTokenMetrics(map.getZoom());
    const value=getDisplayMetrics(unit,{iconSize:[base.width,base.height],iconAnchor:scoutTokenAnchor(map.getZoom(),index)});
    return {width:value.iconSize[0],height:value.iconSize[1],anchor:value.iconAnchor};
  }
  function icon(unit, index) {
    const m = displayMetrics(unit,index);
    const status = ({ idle:"待命", moving:"移动中", working:"发掘中", ready:"待选球员", stranded:"等待驻扎" })[unit.status] ?? "待命";
    return Leaflet.divIcon({
      className: "scout-unit-map-icon",
      iconSize: [m.width, m.height],
      // Reserve the center for the expedition; every scout gets its own lateral slot.
      iconAnchor: m.anchor,
      html: `<button type="button" class="scout-map-token is-${escapeHtml(unit.status)} ${selectedId === unit.id ? "is-selected" : ""}" aria-label="${escapeHtml(unit.name)} · ${status}" title="${escapeHtml(unit.name)} · ${status}">${unitTeamBadge({color:getCampaignState()?.world?.players?.[getCampaignState()?.playerId]?.color,ownerName:getCampaignState()?.world?.players?.[getCampaignState()?.playerId]?.teamName,kind:'scout',own:true,compact:compactUnitBadge(map)})}<img src="${SCOUT_TOKEN_URL}" alt="" draggable="false"><span class="scout-map-badge">${unit.status === "ready" ? "✓" : unit.status === "working" ? "⌕" : unit.status === "moving" ? "›" : ""}</span><span class="scout-map-name">${escapeHtml(unit.name)}</span></button>`,
    });
  }

  function clearRoute(id) {
    const route = routes.get(id);
    if (!route) return;
    for (const item of route.layers) layer.removeLayer(item);
    routes.delete(id);
  }
  function updateRoutes(units) {
    const active = new Set();
    for (const unit of units) {
      if (!unit.movement) continue;
      const frame = unitTravelFrame(unit.movement,getServerNow());
      if(!frame)continue;
      const path = [frame.fromTerritoryId,frame.toTerritoryId];
      const points = path.map(point);
      if (points.length < 2 || points.some(position => !position)) continue;
      active.add(unit.id);
      const key = JSON.stringify([unit.movement.id, path]);
      if (routes.get(unit.id)?.key === key) continue;
      clearRoute(unit.id);
      const style = {pane:"expeditionPane", color:"#77dfc0", weight:2, interactive:false};
      const line = Leaflet.polyline(points, {...style,dashArray:"7 8",opacity:.8}).addTo(layer);
      const source = Leaflet.circleMarker(points[0], {...style,radius:4,fillColor:"#172920",fillOpacity:1}).addTo(layer);
      const destination = Leaflet.circleMarker(points.at(-1), {...style,radius:5,fillColor:"#77dfc0",fillOpacity:1}).addTo(layer);
      routes.set(unit.id, {key, layers:[line,source,destination]});
    }
    for (const id of routes.keys()) if (!active.has(id)) clearRoute(id);
  }
  function updateZoom() {
    for (const [id,{ marker, index }] of markers) {
      const unit=scouts().find(u=>u.id===id);
      const m = displayMetrics(unit,index), element = marker.getElement?.(),anchor=m.anchor;
      if (element?.style) Object.assign(element.style, { width:m.width+"px", height:m.height+"px", marginLeft:-anchor[0]+"px", marginTop:-anchor[1]+"px" });
      if (marker.options?.icon?.options) Object.assign(marker.options.icon.options, { iconSize:[m.width,m.height], iconAnchor:anchor });
    }
  }
  function animate() {
    frameId = null;
    if (destroyed || documentRef?.hidden) return;
    let moving = false;
    for (const unit of scouts()) {
      const entry = markers.get(unit.id), position = location(unit);
      if (entry && position && unit.movement) entry.marker.setLatLng(position);
      if (entry && unit.movement && getServerNow() < unit.movement.arrivesAt) moving = true;
    }
    if (moving) frameId = requestFrame(animate);
  }
  function wake() {
    if (frameId != null) cancelFrame(frameId);
    frameId = null;
    animate();
  }
  function cancelMoveMode() {
    if (!selectedId) return false;
    selectedId = null; targetIds.clear();
    mapElement?.classList.toggle("is-scout-move-mode", false);
    refreshTerritoryDisplay(); refresh();
    return true;
  }
  function refresh() {
    if (destroyed) return;
    const units = scouts(), ids = new Set(units.map(unit => unit.id));
    for (const [id, entry] of markers) if (!ids.has(id)) { layer.removeLayer(entry.marker); markers.delete(id); }
    if (selectedId) {
      const selected = units.find(unit => unit.id === selectedId);
      if (!selected || selected.status !== "idle") {
        selectedId = null; targetIds.clear(); mapElement?.classList.toggle("is-scout-move-mode", false); refreshTerritoryDisplay();
      } else {
        const next = selected.movableTerritoryIds ?? [];
        const changed = next.length !== targetIds.size || next.some(id => !targetIds.has(id));
        targetIds.clear(); next.forEach(id => targetIds.add(id));
        if (changed) refreshTerritoryDisplay();
      }
    }
    units.forEach((unit, index) => {
      const position = location(unit);
      if (!position) { const old = markers.get(unit.id); if (old) layer.removeLayer(old.marker); markers.delete(unit.id); return; }
      const key = [unit.name, getCampaignState()?.world?.players?.[getCampaignState()?.playerId]?.color, getCampaignState()?.world?.players?.[getCampaignState()?.playerId]?.teamName, unit.status, selectedId === unit.id, index].join("|");
      let entry = markers.get(unit.id);
      if (!entry) {
        const marker = Leaflet.marker(position, { pane:"expeditionPane", icon:icon(unit,index), bubblingMouseEvents:false, keyboard:false, zIndexOffset:200 }).addTo(layer);
        marker.on("click", () => {
          const current = scouts().find(item => item.id === unit.id);
          if (current) { cancelMoveMode(); onOpen(current.id, {showResults:current.status === "ready"}); }
        });
        entry = { marker, key, index }; markers.set(unit.id, entry);
      } else {
        entry.marker.setLatLng(position);
        if (entry.key !== key) { entry.marker.setIcon(icon(unit,index)); entry.key = key; }
        entry.index = index;
      }
    });
    updateRoutes(units); updateZoom(); wake();
  }
  function beginMoveMode(id) {
    const unit = scouts().find(item => item.id === id);
    if (!unit || unit.status !== "idle" || !unit.movableTerritoryIds?.length) { showToast("当前没有其他可移动的己方、盟友或可见的中立地块"); return false; }
    beforeBegin(); selectedId = id; targetIds.clear();
    unit.movableTerritoryIds.forEach(id => targetIds.add(id));
    mapElement?.classList.toggle("is-scout-move-mode", true);
    refreshTerritoryDisplay(); refresh();
    showToast("选择球探目的地 · Esc 取消");
    return true;
  }
  function handleTerritoryClick(id) {
    if (!selectedId) return false;
    if (!targetIds.has(id)) { showToast("请选择己方或盟友领土地块"); return true; }
    const scoutId = selectedId;
    cancelMoveMode(); onPlanMove(scoutId, id); return true;
  }
  documentRef?.addEventListener?.("visibilitychange", wake);
  return {
    refresh, updateZoom, beginMoveMode, cancelMoveMode, handleTerritoryClick,
    getTargetIds: () => targetIds, isSelectingDestination: () => Boolean(selectedId),
    destroy() {
      destroyed = true;
      if (frameId != null) cancelFrame(frameId);
      documentRef?.removeEventListener?.("visibilitychange", wake);
      for (const entry of markers.values()) layer.removeLayer(entry.marker);
      markers.clear();
      for (const id of routes.keys()) clearRoute(id);
      targetIds.clear(); selectedId = null;
      mapElement?.classList.toggle("is-scout-move-mode", false); refreshTerritoryDisplay();
    },
  };
}
