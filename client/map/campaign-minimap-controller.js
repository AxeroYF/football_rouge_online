function ownerStyle(feature, ownerTypes, world, players) {
  const territoryId = feature?.properties?.territoryId;
  const state = world?.territories?.[territoryId];
  if (state?.ownerType === ownerTypes.PLAYER) {
    return {
      fillColor: players?.[state.ownerId]?.color ?? "#41694d",
      fillOpacity: 0.96,
      color: state.capitalOf ? "#f1eddf" : "rgba(241, 237, 223, 0.48)",
      weight: state.capitalOf ? 1.35 : 0.45,
    };
  }
  if (state?.ownerType === ownerTypes.CLUB) {
    return {
      fillColor: "#75613a",
      fillOpacity: 0.94,
      color: "rgba(234, 190, 89, 0.68)",
      weight: 0.55,
    };
  }
  return {
    fillColor: "#31473b",
    fillOpacity: 0.94,
    color: "rgba(225, 217, 192, 0.18)",
    weight: 0.35,
  };
}

export function createMinimapTerritoryStyle({ ownerTypes, getWorld, getPlayers }) {
  return (feature) => ownerStyle(feature, ownerTypes, getWorld(), getPlayers());
}

export function createCampaignMinimap({
  Leaflet,
  container,
  mainMap,
  campaignBounds,
  displayTerritories,
  ownerTypes,
  getWorld,
  getPlayers,
  view = container?.ownerDocument?.defaultView ?? globalThis,
} = {}) {
  if (!Leaflet || !container || !mainMap || !campaignBounds || !displayTerritories || !ownerTypes) {
    throw new TypeError("Campaign minimap dependencies are required");
  }
  if (typeof getWorld !== "function" || typeof getPlayers !== "function") {
    throw new TypeError("Campaign minimap state readers are required");
  }

  const minimap = Leaflet.map(container, {
    preferCanvas: true,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    tapHold: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
  });
  const territoryStyle = createMinimapTerritoryStyle({ ownerTypes, getWorld, getPlayers });
  const territoryRenderer = Leaflet.canvas({ padding: 0.05, tolerance: 0 });
  const viewportRenderer = Leaflet.svg({ padding: 0.15 });
  const territoryLayer = Leaflet.geoJSON(displayTerritories, {
    renderer: territoryRenderer,
    interactive: false,
    style: territoryStyle,
  }).addTo(minimap);
  const viewport = Leaflet.rectangle(mainMap.getBounds(), {
    renderer: viewportRenderer,
    className: "minimap-viewport",
    interactive: true,
    color: "#f4efe0",
    weight: 2,
    opacity: 1,
    fillColor: "#f4efe0",
    fillOpacity: 0.08,
  }).addTo(minimap);
  minimap.fitBounds(campaignBounds, { padding: [5, 5], animate: false });
  viewport.bringToFront?.();

  let draggingViewport = false;
  let dragPointerId = null;
  let dragOffset = null;
  let resizeFrame = null;

  function syncViewport() {
    viewport.setBounds(mainMap.getBounds());
    viewport.bringToFront?.();
  }

  function pointerPoint(event) {
    const bounds = container.getBoundingClientRect();
    return Leaflet.point(event.clientX - bounds.left, event.clientY - bounds.top);
  }

  function beginViewportDrag(event) {
    if (!event.target?.closest?.(".minimap-viewport")) return;
    event.preventDefault();
    event.stopPropagation();
    draggingViewport = true;
    dragPointerId = event.pointerId;
    const pointer = pointerPoint(event);
    dragOffset = pointer.subtract(minimap.latLngToContainerPoint(mainMap.getCenter()));
    container.classList.add("is-dragging-viewport");
    container.setPointerCapture?.(event.pointerId);
  }

  function moveViewport(event) {
    if (!draggingViewport || event.pointerId !== dragPointerId) return;
    event.preventDefault();
    const centerPoint = pointerPoint(event).subtract(dragOffset);
    mainMap.panTo(minimap.containerPointToLatLng(centerPoint), { animate: false });
  }

  function endViewportDrag(event) {
    if (!draggingViewport || event.pointerId !== dragPointerId) return;
    draggingViewport = false;
    dragPointerId = null;
    dragOffset = null;
    container.classList.remove("is-dragging-viewport");
    if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId);
  }

  function handleResize() {
    if (resizeFrame !== null) view.cancelAnimationFrame(resizeFrame);
    resizeFrame = view.requestAnimationFrame(() => {
      resizeFrame = null;
      minimap.invalidateSize({ pan: false });
      minimap.fitBounds(campaignBounds, { padding: [5, 5], animate: false });
      syncViewport();
    });
  }

  function refresh() {
    territoryLayer.setStyle(territoryStyle);
    syncViewport();
  }

  function destroy() {
    mainMap.off("move zoom resize", syncViewport);
    container.removeEventListener("pointerdown", beginViewportDrag);
    container.removeEventListener("pointermove", moveViewport);
    container.removeEventListener("pointerup", endViewportDrag);
    container.removeEventListener("pointercancel", endViewportDrag);
    view.removeEventListener("resize", handleResize);
    if (resizeFrame !== null) view.cancelAnimationFrame(resizeFrame);
    minimap.remove();
  }

  mainMap.on("move zoom resize", syncViewport);
  container.addEventListener("pointerdown", beginViewportDrag);
  container.addEventListener("pointermove", moveViewport);
  container.addEventListener("pointerup", endViewportDrag);
  container.addEventListener("pointercancel", endViewportDrag);
  view.addEventListener("resize", handleResize);
  Leaflet.DomEvent.disableClickPropagation(container);
  Leaflet.DomEvent.disableScrollPropagation(container);
  syncViewport();

  return Object.freeze({ destroy, refresh, syncViewport });
}
