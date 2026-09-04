import { createTerritoryWorld, OWNER_TYPES } from "./territory-model.js";
import { createTacticsController } from "./tactics-page.js?v=20260901-tactics-autosave-v16";
import { createTeamController } from "./client/team/team-controller-ydl.js?v=20260901-two-state-squads-v14";
import { createYoogleController } from "./client/yoogle/yoogle-controller.js?v=20260901-english-search-v15";
import { showCampaignBroadcast, startCampaignBroadcastBackground } from "./campaign-broadcast.js?v=20260830-broadcast-map-fill";
import { createCampaignStore } from "./client/core/campaign-store.js";
import {
  CAMPAIGN_BOUNDS,
  displayPointToTerritory,
  isEuropeanFeature,
  isSouthAmericanFeature,
  territoryPointToDisplay,
  transformSouthAmericaFeature,
  transformSouthAmericaPoint,
} from "./client/map/campaign-map-geometry.js";
import { createTerritoryPresentation } from "./client/map/territory-presentation.js";
import { loadCampaignMapData } from "./client/map/campaign-map-data.js";
import { createInertialWheelZoom } from "./client/map/inertial-wheel-zoom.js?v=20260903-tile-viewreset-v2";
import { createCampaignMinimap } from "./client/map/campaign-minimap-controller.js?v=20260829-minimap";
import { createTerritoryWeatherLayerController } from "./client/map/territory-weather-layer-controller.js?v=20260831-weather-layer-v3";
import { buildCoastlineLods, coastlineLodKeyForZoom } from "./client/map/coastline-lod.js?v=20260903-coastline-lod-v1";
import { createExpeditionPieceController } from "./client/map/expedition-piece-controller.js?v=20260901-expedition-zoom-scale-v19";
import { createTerritoryController } from "./client/territory/territory-controller.js?v=20260901-territory-card-v20";
import { createMaritimeController } from "./client/maritime/maritime-controller.js";
import { createChallengeController } from "./client/challenge/challenge-controller.js";
import { createBuildingMarkerController } from "./client/buildings/building-marker-controller.js?v=20260829-building-type-scale";
import { createBuildingPanelController } from "./client/buildings/building-panel-controller.js?v=20260829-building-type-scale";
import { createInventoryController } from "./client/inventory/inventory-controller.js?v=20260902-inventory-natural-v1";
const mapElement = document.querySelector("#campaign-map");
const mapLoader = document.querySelector("#map-loader");
const mapZoomIndicator = document.querySelector("#map-zoom-indicator");
const mapZoomValue = document.querySelector("#map-zoom-value");
const mapZoomDetail = document.querySelector("#map-zoom-detail");
const ZOOM_STAGE_LABELS = Object.freeze(["全景", "洲际", "国家", "地区", "最大细节"]);
const countryLabelMarkers = [];
const cityMarkers = new Map();
const clubsByCity = new Map();
let expandedCityId = null;
let toastTimer = null;
let cityData = [];
let clubData = [];
let territoryLayer = null;
let provinceOutlineLayer = null;

let countryBorderLayer = null;
let reliefLayers = [];
let oceanDepthLayer = null;
let oceanDepthBands = [];
let landDepthLayer = null;
let landDepthStrokes = [];
let coastlineLayer = null;
let coastlineStrokes = [];
let campaignCoastlineLods = null;
let activeCoastlineLodKey = null;
let territoryIndex = null;
let territoryWorld = null;
let countryBordersVisible = false;
let majorCitiesVisible = false;
let weatherLayerVisible = false;
const campaignStore = createCampaignStore();
let campaignState = campaignStore.getState();
campaignStore.subscribe((change) => { campaignState = change.state; });
let campaignRequest = null;
let campaignClearSession = null;
let campaignWorldPlayers = {};
let mapLoadingStarted = false;
let campaignStatePollTimer = null;
let campaignStateSyncPending = false;
let coastlineData = null;
const territoryLayersById = new Map();
const territoryMetadataById = new Map();
const attackableTerritoryIds = new Set();
let territoryController = null;
let maritimeController = null;
let challengeController = null;
let buildingMarkerController = null;
let buildingPanelController = null;
let campaignMinimapController = null;
let weatherLayerController = null;
let expeditionPieceController = null;
const EMPTY_TERRITORY_IDS = new Set();

const map = L.map(mapElement, {
  preferCanvas: true,
  zoomAnimation: true,
  fadeAnimation: false,
  markerZoomAnimation: true,
  zoomControl: false,
  attributionControl: false,
  minZoom: 3,
  maxZoom: 7,
  zoomSnap: 0,
  zoomDelta: 0.5,
  scrollWheelZoom: false,
  maxBounds: [[-60, -70], [85, 125]],
  maxBoundsViscosity: 0.35,
}).setView([52, 12], 3.25);

createInertialWheelZoom({
  map,
  element: mapElement,
  friction: 9,
  pixelsPerZoom: 240,
  maxVelocity: 6.25,
});


map.createPane("reliefPane");
map.getPane("reliefPane").style.zIndex = "218";
map.getPane("reliefPane").style.pointerEvents = "none";
map.createPane("provinceOutlinePane");
map.getPane("provinceOutlinePane").style.zIndex = "219";
map.getPane("provinceOutlinePane").style.pointerEvents = "none";
map.createPane("oceanPane");
map.getPane("oceanPane").style.zIndex = "212";
map.getPane("oceanPane").style.pointerEvents = "none";
map.createPane("landShadowPane");
map.getPane("landShadowPane").style.zIndex = "213";
map.getPane("landShadowPane").style.pointerEvents = "none";
map.createPane("landShelfPane");
map.getPane("landShelfPane").style.zIndex = "214";
map.getPane("landShelfPane").style.pointerEvents = "none";
map.createPane("coastPane");
map.getPane("coastPane").style.zIndex = "222";
map.getPane("coastPane").style.pointerEvents = "none";
map.createPane("countryPane");
map.getPane("countryPane").style.zIndex = "225";
map.getPane("countryPane").style.pointerEvents = "none";
map.createPane("territoryPane");
map.getPane("territoryPane").style.zIndex = "215";
map.createPane("maritimePane");
map.getPane("maritimePane").style.zIndex = "625";
map.createPane("weatherPane");
map.getPane("weatherPane").style.zIndex = "620";
map.getPane("weatherPane").style.pointerEvents = "none";
map.createPane("cityPane");
map.getPane("cityPane").style.zIndex = "640";
map.createPane("buildingPane");
map.getPane("buildingPane").style.zIndex = "645";
map.createPane("expeditionPane");
map.getPane("expeditionPane").style.zIndex = "655";
map.getPane("expeditionPane").style.pointerEvents = "none";

const countryRenderer = L.svg({ pane: "countryPane", padding: 0.5 });
const coastRenderer = L.canvas({ pane: "coastPane", padding: 0.5 });
const oceanRenderer = L.canvas({ pane: "oceanPane", padding: 0.5 });
const landShadowRenderer = L.canvas({ pane: "landShadowPane", padding: 0.5 });
const landShelfRenderer = L.canvas({ pane: "landShelfPane", padding: 0.5 });
const territoryRenderer = L.canvas({ pane: "territoryPane", padding: 0.5, tolerance: 2 });
const provinceOutlineRenderer = L.canvas({ pane: "provinceOutlinePane", padding: 0.5 });
const maritimeRenderer = L.svg({ pane: "maritimePane", padding: 0.5 });
const weatherRenderer = L.svg({ pane: "weatherPane", padding: 0.5 });

const countryLabelLayer = L.layerGroup().addTo(map);
const cityLayer = L.layerGroup();
const buildingLayer = L.layerGroup().addTo(map);
const expeditionLayer = L.layerGroup().addTo(map);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const {
  challengeSummary,
  territoryHoverStyle,
  territoryOwnerLabel,
  territoryStyle,
  territoryTooltipMarkup,
} = createTerritoryPresentation({
  ownerTypes: OWNER_TYPES,
  escapeHtml,
  getContext: () => ({
    territoryWorld,
    campaignState,
    campaignWorldPlayers,
    selectedTerritoryId: territoryController?.getSelectedTerritoryId() ?? null,
    homeSelectionMode: territoryController?.isHomeSelectionMode() ?? false,
    homeSelectionPermission: territoryController?.homeSelectionPermission,
    maritimeTargetIds: maritimeController?.getTargetIds() ?? EMPTY_TERRITORY_IDS,
    expeditionMoveTargetIds: expeditionPieceController?.getTargetIds() ?? EMPTY_TERRITORY_IDS,
  }),
});

function ownActiveChallenge() {
  return Object.values(campaignState?.world?.activeChallenges ?? {}).find((challenge)=>challenge.attackerId===campaignState?.playerId) ?? null;
}

function sourcePointToDisplay(territoryId, point) {
  const metadata = territoryMetadataById.get(territoryId);
  return territoryPointToDisplay(point, metadata?.region);
}

function displayPointToSource(territoryId, latlng) {
  const metadata = territoryMetadataById.get(territoryId);
  return displayPointToTerritory(latlng, metadata?.region);
}

function applyCampaignWorldSnapshot(snapshot) {
  campaignWorldPlayers = snapshot?.players ?? {};
  attackableTerritoryIds.clear();
  for (const territoryId of campaignState?.attackableTerritoryIds ?? []) attackableTerritoryIds.add(territoryId);
  for (const [territoryId, savedState] of Object.entries(snapshot?.territories ?? {})) {
    if (territoryWorld?.territories[territoryId]) Object.assign(territoryWorld.territories[territoryId], savedState);
  }
  buildingMarkerController?.refresh();
  campaignMinimapController?.refresh();
  weatherLayerController?.refresh();
  expeditionPieceController?.refresh();
}

territoryController = createTerritoryController({
  documentRef: document,
  mapElement,
  ownerTypes: OWNER_TYPES,
  territoryMetadataById,
  territoryLayersById,
  attackableTerritoryIds,
  getTerritoryWorld: () => territoryWorld,
  getCampaignState: () => campaignState,
  getCampaignRequest: () => campaignRequest,
  getMaritimeMode: () => maritimeController?.getMode() ?? null,
  getMaritimeTargetIds: () => maritimeController?.getTargetIds() ?? EMPTY_TERRITORY_IDS,
  getTerritoryChallengePending: () => challengeController?.isPending() ?? false,
  campaignStore,
  applyCampaignWorldSnapshot,
  territoryStyle,
  territoryTooltipMarkup,
  territoryOwnerLabel,
  challengeSummary,
  ownActiveChallenge,
  showToast,
  onSelectionChange: () => buildingPanelController?.close(),
});

const {
  clearTerritorySelection,
  confirmHomeSelection,
  enterHomeSelectionMode,
  getSelectedTerritoryId,
  refreshTerritoryDisplay,
  renderTerritoryInspector,
  selectTerritory,
} = territoryController;

buildingMarkerController = createBuildingMarkerController({
  Leaflet: L,
  map,
  layer: buildingLayer,
  territoryLayersById,
  territoryMetadataById,
  getTerritoryWorld: () => territoryWorld,
  getBuildingCatalog: () => campaignState?.buildings?.catalog ?? [],
  selectTerritory,
  escapeHtml,
  showToast,
  onBuildingSelect: ({ territoryId }) => buildingPanelController?.open(territoryId),
  beforeExpand: () => closeExpandedCity(),
});

buildingPanelController = createBuildingPanelController({
  documentRef: document,
  getCampaignRequest: () => campaignRequest,
  getCampaignState: () => campaignState,
  getTerritoryMetadata: (territoryId) => territoryMetadataById.get(territoryId),
  campaignStore,
  applyCampaignWorldSnapshot,
  refreshTerritoryDisplay,
  renderTerritoryInspector,
  updateTopbarWallet,
  showToast,
  escapeHtml,
});

maritimeController = createMaritimeController({
  Leaflet: L,
  map,
  mapElement,
  maritimeRenderer,
  territoryMetadataById,
  getCoastlineData: () => coastlineData,
  getTerritoryWorld: () => territoryWorld,
  getCampaignState: () => campaignState,
  getCampaignRequest: () => campaignRequest,
  getSelectedTerritoryId,
  ownActiveChallenge,
  sourcePointToDisplay,
  displayPointToSource,
  selectTerritory,
  refreshTerritoryDisplay,
  renderTerritoryInspector,
  showToast,
});

const {
  beginMaritimeCampaign,
  cancelMaritimeCampaign,
  confirmMaritimePoint,
  updateMaritimeSnap,
} = maritimeController;

challengeController = createChallengeController({
  documentRef: document,
  territoryMetadataById,
  attackableTerritoryIds,
  getCampaignRequest: () => campaignRequest,
  getCampaignState: () => campaignState,
  getSelectedTerritoryId,
  ownActiveChallenge,
  maritimeController,
  campaignStore,
  applyCampaignWorldSnapshot,
  refreshTerritoryDisplay,
  renderTerritoryInspector,
  syncCampaignWorldState: () => syncCampaignWorldState(),
  startCampaignBroadcastBackground,
  showCampaignBroadcast,
  showToast,
});

const {
  challengeSelectedTerritory,
  resumeOwnActiveChallenge,
} = challengeController;

function addReliefTileSet({ tiles, bounds }, version) {
  const leafletBounds = [[bounds.south, bounds.west], [bounds.north, bounds.east]];
  return L.tileLayer(`./${tiles}?v=${version}`, {
    pane: "reliefPane",
    opacity: 0.46,
    minZoom: 3,
    maxZoom: 7,
    maxNativeZoom: 7,
    bounds: leafletBounds,
    noWrap: true,
    keepBuffer: 2,
    // Request entering tiles during dragging, not only after mouse release.
    updateWhenIdle: false,
    updateWhenZooming: true,
    updateInterval: 120,
  }).addTo(map);
}

function addCampaignReliefLayers(reliefConfig) {
  for (const layer of reliefLayers) {
    if (map.hasLayer(layer)) layer.removeFrom(map);
  }
  reliefLayers = [];

  const tileSets = [
    {
      tiles: "assets/map-relief/europe-dem-overview/{z}/{x}/{y}.webp",
      bounds: { west: -25, south: 25, east: 100, north: 74 },
    },
    ...Object.values(reliefConfig?.regions ?? {}).map((region) => ({
      tiles: region.output.overview,
      bounds: region.displayBounds,
    })),
  ];
  for (const tileSet of tileSets) {
    reliefLayers.push(addReliefTileSet(tileSet, "20260904-deep-olive-relief-v3"));
  }
}

function oceanDepthWeights(zoom = map.getZoom()) {
  const progress = Math.max(0, Math.min(1, (zoom - 3) / 6));
  return [
    20 + progress * 44,
    11 + progress * 27,
    5 + progress * 13,
  ];
}

function collectCampaignCoastlineSegments(territories) {
  const segments = [];
  for (const feature of territories.features ?? []) {
    const region = feature.properties?.region;
    if (!["europe", "south-america"].includes(region)) continue;
    for (const segment of coastlineData?.territories?.[feature.properties.territoryId]?.coastlines ?? []) {
      const points = segment.map((point) => territoryPointToDisplay(point, region));
      if (points.length >= 2) segments.push(points);
    }
  }
  return segments;
}

function coastlineSegmentsForZoom(zoom = map.getZoom()) {
  const key = coastlineLodKeyForZoom(zoom);
  return campaignCoastlineLods?.[key] ?? [];
}

function updateCoastlineLod(zoom = map.getZoom()) {
  const key = coastlineLodKeyForZoom(zoom);
  if (key === activeCoastlineLodKey) return;
  const segments = campaignCoastlineLods?.[key] ?? [];
  oceanDepthBands.forEach((band) => band.setLatLngs(segments));
  landDepthStrokes.forEach((stroke) => stroke.setLatLngs(segments));
  coastlineStrokes.forEach((stroke) => stroke.setLatLngs(segments));
  activeCoastlineLodKey = key;
}

function updateOceanDepthStyle(zoom = map.getZoom()) {
  const weights = oceanDepthWeights(zoom);
  oceanDepthBands.forEach((band, index) => band.setStyle({ weight: weights[index] }));
}

function addCampaignOceanDepthLayer() {
  if (oceanDepthLayer && map.hasLayer(oceanDepthLayer)) oceanDepthLayer.removeFrom(map);
  const segments = coastlineSegmentsForZoom();
  oceanDepthLayer = L.layerGroup().addTo(map);
  const weights = oceanDepthWeights();
  oceanDepthBands = [
    L.polyline(segments, {
      pane: "oceanPane",
      renderer: oceanRenderer,
      color: "#173f50",
      weight: weights[0],
      opacity: 0.42,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(oceanDepthLayer),
    L.polyline(segments, {
      pane: "oceanPane",
      renderer: oceanRenderer,
      color: "#24606b",
      weight: weights[1],
      opacity: 0.32,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(oceanDepthLayer),
    L.polyline(segments, {
      pane: "oceanPane",
      renderer: oceanRenderer,
      color: "#438783",
      weight: weights[2],
      opacity: 0.22,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(oceanDepthLayer),
  ];
}

function updateLandDepthPerspective(zoom = map.getZoom()) {
  const progress = Math.max(0, Math.min(1, (zoom - map.getMinZoom()) / (map.getMaxZoom() - map.getMinZoom())));
  const depth = 4.5 + progress * 3.5;
  const shadowPane = map.getPane("landShadowPane");
  const shelfPane = map.getPane("landShelfPane");
  shadowPane.style.transform = `translate3d(${(depth * 0.48).toFixed(2)}px, ${depth.toFixed(2)}px, 0)`;
  shelfPane.style.transform = `translate3d(${(depth * 0.22).toFixed(2)}px, ${(depth * 0.54).toFixed(2)}px, 0)`;
}

function addCampaignLandDepthLayer() {
  if (landDepthLayer && map.hasLayer(landDepthLayer)) landDepthLayer.removeFrom(map);
  const segments = coastlineSegmentsForZoom();
  landDepthLayer = L.layerGroup().addTo(map);
  landDepthStrokes = [
    L.polyline(segments, {
      pane: "landShadowPane",
      renderer: landShadowRenderer,
      color: "rgba(1,12,19,.94)",
      weight: 22,
      opacity: 0.52,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(landDepthLayer),
    L.polyline(segments, {
      pane: "landShelfPane",
      renderer: landShelfRenderer,
      color: "rgba(119,103,62,.88)",
      weight: 11,
      opacity: 0.46,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(landDepthLayer),
  ];
  updateLandDepthPerspective();
}

const COASTLINE_STROKE_STYLES = Object.freeze([
  Object.freeze({ color: "rgba(2,20,29,.55)", weight: 24, opacity: 0.28 }),
  Object.freeze({ color: "rgba(8,37,43,.78)", weight: 12, opacity: 0.48 }),
  Object.freeze({ color: "rgba(18,48,39,.72)", weight: 5.4, opacity: 0.68 }),
  Object.freeze({ color: "rgba(218,223,179,.42)", weight: 1.45, opacity: 0.78 }),
]);

function addCampaignCoastlineLayer() {
  if (coastlineLayer && map.hasLayer(coastlineLayer)) coastlineLayer.removeFrom(map);
  const segments = coastlineSegmentsForZoom();
  coastlineLayer = L.layerGroup().addTo(map);
  coastlineStrokes = COASTLINE_STROKE_STYLES.map((style) => L.polyline(segments, {
    pane: "coastPane",
    renderer: coastRenderer,
    ...style,
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
  }).addTo(coastlineLayer));
}

function addProvinceOutlineLayer(displayTerritories) {
  if (provinceOutlineLayer) provinceOutlineLayer.removeFrom(map);
  // One non-interactive Canvas path, not another interactive layer per province.
  // Geometry is already in display coordinates, including relocated South America.
  const boundaries = displayTerritories.features.flatMap(({ geometry }) => {
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    return polygons.flatMap((polygon) => polygon.map((ring) => (
      ring.map(([lng, lat]) => [lat, lng])
    )));
  });
  provinceOutlineLayer = L.polyline(boundaries, {
    pane: "provinceOutlinePane",
    renderer: provinceOutlineRenderer,
    interactive: false,
    bubblingMouseEvents: false,
    fill: false,
    color: "#d2cdb0",
    opacity: 0.22,
    weight: 0.7,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(map);
}

function addTerritoryLayer(territories) {
  const displayTerritories = {
    type: "FeatureCollection",
    features: territories.features.map((feature) => (
      feature.properties.region === "south-america" ? transformSouthAmericaFeature(feature) : feature
    )),
  };
  territoryLayer = L.geoJSON(displayTerritories, {
    pane: "territoryPane",
    renderer: territoryRenderer,
    bubblingMouseEvents: false,
    style: territoryStyle,
    onEachFeature(feature, layer) {
      const territoryId = feature.properties.territoryId;
      const metadata = territoryMetadataById.get(territoryId);
      const state = territoryWorld.territories[territoryId];
      const tooltip = territoryTooltipMarkup(metadata, state);
      territoryLayersById.set(territoryId, layer);
      layer.bindTooltip(tooltip, {
        sticky: true,
        direction: "top",
        offset: [0, -8],
        opacity: 1,
        className: "territory-tooltip",
      });
      layer.on({
        mouseover() {
          layer.setStyle(territoryHoverStyle(feature));
          layer.bringToFront();
          mapElement.classList.add("is-hovering-territory");
        },
        mouseout() {
          layer.setStyle(territoryStyle(feature));
          mapElement.classList.remove("is-hovering-territory");
        },
        click(event) {
          closeExpandedCity();
          buildingMarkerController.closeExpanded();
          if(maritimeController.isSelectingPoint()){confirmMaritimePoint(event.latlng);return;}
          if(expeditionPieceController?.handleTerritoryClick(territoryId))return;
          selectTerritory(territoryId);
        },
      });
    },
  }).addTo(map);
  return displayTerritories;
}

function fitCampaign(animate = true) {
  closeExpandedCity();
  buildingMarkerController?.closeExpanded();
  map.fitBounds(CAMPAIGN_BOUNDS, {
    paddingTopLeft: [30, 30],
    paddingBottomRight: [30, 30],
    animate,
    duration: 0.75,
  });
}

function addCountryBorders(campaignCountries) {
  countryBorderLayer = L.geoJSON(campaignCountries, { pane: "countryPane", renderer: countryRenderer, interactive: false, style: { color: "rgba(236, 228, 190, 0.78)", weight: 1.8, opacity: 0.95, fill: false } });
  if (countryBordersVisible) countryBorderLayer.addTo(map);
}

function setCountryBordersVisible(visible) {
  countryBordersVisible = visible;
  if (countryBorderLayer) {
    if (visible && !map.hasLayer(countryBorderLayer)) countryBorderLayer.addTo(map);
    if (!visible && map.hasLayer(countryBorderLayer)) countryBorderLayer.removeFrom(map);
  }
  document.querySelector("#country-borders-toggle").checked = visible;
}

function setMajorCitiesVisible(visible) {
  majorCitiesVisible = visible;
  if (!visible) closeExpandedCity();
  if (visible && !map.hasLayer(cityLayer)) {
    updateCityVisibility();
    cityLayer.addTo(map);
  }
  if (!visible && map.hasLayer(cityLayer)) cityLayer.removeFrom(map);
  document.querySelector("#major-cities-toggle").checked = visible;
}

function setWeatherLayerVisible(visible) {
  weatherLayerVisible = Boolean(visible);
  weatherLayerController?.setEnabled(weatherLayerVisible);
  document.querySelector("#weather-layer-toggle").checked = weatherLayerVisible;
}

function makeCountryLabel(feature) {
  const properties = feature.properties;
  const lat = Number(properties.LABEL_Y);
  const lng = Number(properties.LABEL_X);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const marker = L.marker([lat, lng], {
    pane: "cityPane",
    interactive: false,
    icon: L.divIcon({
      className: "country-label",
      html: `<span>${escapeHtml(properties.NAME_ZH || properties.NAME_EN)}</span>`,
      iconSize: [0, 0],
    }),
  });
  countryLabelMarkers.push({ marker, minZoom: Number(properties.MIN_LABEL ?? 3.4) });
}

function updateCountryLabels() {
  const zoom = map.getZoom();
  countryLabelMarkers.forEach(({ marker, minZoom }) => {
    const visible = zoom < 5.35 && zoom + 0.35 >= minZoom;
    if (visible && !countryLabelLayer.hasLayer(marker)) marker.addTo(countryLabelLayer);
    if (!visible && countryLabelLayer.hasLayer(marker)) countryLabelLayer.removeLayer(marker);
  });
}

function orbitMarkup(city, clubs) {
  if (expandedCityId !== city.id) return "";
  const radius = clubs.length >= 5 ? 112 : clubs.length >= 3 ? 96 : 82;
  const buttons = clubs.map((club, index) => {
    const angle = -90 + (360 / clubs.length) * index;
    const radians = angle * Math.PI / 180;
    const x = Math.cos(radians) * radius;
    const y = Math.sin(radians) * radius;
    const stars = "★".repeat(club.reputation) + "☆".repeat(5 - club.reputation);
    return `<span class="orbit-ray" style="--ray-angle:${angle}deg;--ray-length:${radius - 26}px"></span>
      <button class="orbit-club" type="button" data-orbit-club="${escapeHtml(club.id)}" style="--orbit-x:${x.toFixed(1)}px;--orbit-y:${y.toFixed(1)}px;--orbit-delay:${index * 35}ms" aria-label="${escapeHtml(club.name)}，${escapeHtml(club.style)}">
        <img src="./assets/club-badges/${escapeHtml(club.id)}.webp" alt="" loading="lazy" decoding="async" />
        <span class="orbit-tooltip"><strong>${escapeHtml(club.name)}</strong><small>${escapeHtml(city.country)} · ${escapeHtml(city.name)}</small><small>${escapeHtml(club.stadium)}</small><b>${stars} · ${escapeHtml(club.style)}</b></span>
      </button>`;
  }).join("");
  return `<span class="city-orbit" data-city-orbit="${escapeHtml(city.id)}">${buttons}</span>`;
}

function cityIcon(city) {
  const clubs = clubsByCity.get(city.id) ?? [];
  const hasClubs = clubs.length > 0;
  const expanded = expandedCityId === city.id;
  const classNames = ["city-node", hasClubs ? "has-clubs" : "", expanded ? "is-expanded" : ""].filter(Boolean).join(" ");
  const count = hasClubs ? `<small>${clubs.length}</small>` : "";
  return L.divIcon({
    className: "city-label",
    html: `<span class="${classNames}"><i aria-hidden="true"></i><b>${escapeHtml(city.name)}</b>${count}</span>${orbitMarkup(city, clubs)}`,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

function bindOrbitButtons(marker) {
  window.requestAnimationFrame(() => {
    const element = marker.getElement();
    if (!element) return;
    const orbit = element.querySelector("[data-city-orbit]");
    if (orbit) {
      L.DomEvent.disableClickPropagation(orbit);
      L.DomEvent.disableScrollPropagation(orbit);
    }
    element.querySelectorAll("[data-orbit-club]").forEach((button) => {
      button.addEventListener("click", (event) => {
        L.DomEvent.stop(event);
        const club = clubData.find((item) => item.id === button.dataset.orbitClub);
        if (club) setObjective(club);
      });
    });
  });
}

function refreshCity(cityId) {
  const marker = cityMarkers.get(cityId);
  const city = cityData.find((item) => item.id === cityId);
  if (!marker || !city) return;
  marker.setIcon(cityIcon(city));
  marker.setZIndexOffset(expandedCityId === cityId ? 2000 : 0);
  bindOrbitButtons(marker);
}

function closeExpandedCity() {
  if (!expandedCityId) return;
  const previous = expandedCityId;
  expandedCityId = null;
  refreshCity(previous);
}

function toggleCity(city) {
  if (!(clubsByCity.get(city.id)?.length)) return;
  buildingMarkerController?.closeExpanded();
  const previous = expandedCityId;
  expandedCityId = previous === city.id ? null : city.id;
  if (expandedCityId) map.panTo([city.displayLat ?? city.lat, city.displayLng ?? city.lng], { animate: true, duration: 0.35 });
  if (previous && previous !== city.id) refreshCity(previous);
  refreshCity(city.id);
}

function addCityMarkers() {
  cityData.forEach((city) => {
    const position = city.region === "south-america" ? transformSouthAmericaPoint(city.lat, city.lng) : [city.lat, city.lng];
    city.displayLat = position[0];
    city.displayLng = position[1];
    const marker = L.marker(position, {
      pane: "cityPane",
      icon: cityIcon(city),
      keyboard: true,
      bubblingMouseEvents: false,
      title: clubsByCity.has(city.id) ? `${city.name} · ${clubsByCity.get(city.id).length} 家俱乐部` : city.name,
    });
    marker.on("click", () => toggleCity(city));
    cityMarkers.set(city.id, marker);
  });
}

function updateCityVisibility() {
  const zoom = map.getZoom();
  cityData.forEach((city) => {
    const marker = cityMarkers.get(city.id);
    const hasClubs = clubsByCity.has(city.id);
    const visible = expandedCityId === city.id
      || (zoom >= 3.65 && (city.tier === 1 || zoom >= 4.65 || (hasClubs && zoom >= 4.05)));
    if (visible && !cityLayer.hasLayer(marker)) marker.addTo(cityLayer);
    if (!visible && cityLayer.hasLayer(marker)) cityLayer.removeLayer(marker);
  });
}

function setObjective(club) {
  showToast(`${club.name}已设为下一站`);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function updateReliefVisibility(zoom = map.getZoom()) {
  const progress = Math.max(0, Math.min(1, (zoom - map.getMinZoom()) / (map.getMaxZoom() - map.getMinZoom())));
  const opacity = 0.46 + progress * 0.22;
  reliefLayers.forEach((layer) => layer.setOpacity(opacity));
}

function updateZoomIndicator() {
  if (!mapZoomIndicator || !mapZoomValue || !mapZoomDetail) return;
  const minimumZoom = map.getMinZoom();
  const maximumZoom = map.getMaxZoom();
  const zoom = Math.max(minimumZoom, Math.min(maximumZoom, map.getZoom()));
  const maximumStageIndex = Math.max(0, Math.round(maximumZoom - minimumZoom));
  const stageIndex = Math.max(0, Math.min(maximumStageIndex, Math.round(zoom - minimumZoom)));
  const relativeScale = 2 ** (zoom - minimumZoom);
  const scaleText = relativeScale < 10 ? relativeScale.toFixed(1) : relativeScale.toFixed(0);
  const stageLabel = ZOOM_STAGE_LABELS[stageIndex] ?? `Z${Math.round(zoom)}`;
  mapZoomValue.textContent = `×${scaleText}`;
  mapZoomDetail.textContent = `Z ${zoom.toFixed(2)} · 挡位 ${stageIndex + 1}/${maximumStageIndex + 1} · ${stageLabel}`;
  mapZoomIndicator.dataset.zoomStage = String(stageIndex + 1);
}

function updateLiveZoomState() {
  updateZoomIndicator();
  updateReliefVisibility();
  updateLandDepthPerspective();
}

function updateZoomState() {
  const zoom = map.getZoom();
  updateLiveZoomState();
  updateCoastlineLod(zoom);
  updateOceanDepthStyle(zoom);
  updateCountryLabels();
  updateCityVisibility();
  buildingMarkerController?.updateVisibility();
  expeditionPieceController?.updateZoom();
  mapElement.classList.toggle("zoom-detailed", zoom >= 5.8);
}

async function syncCampaignWorldState() {
  if (!campaignRequest || !territoryWorld || campaignStateSyncPending) return;
  campaignStateSyncPending = true;
  try {
    const value = await campaignRequest("/api/campaign/state");
    campaignStore.setState(value.state, { source: "world-poll" });
    updateTopbarWallet(campaignState);
    applyCampaignWorldSnapshot(campaignState.world);
    refreshTerritoryDisplay();
    const selectedTerritoryId=getSelectedTerritoryId();
    if (selectedTerritoryId) renderTerritoryInspector(selectedTerritoryId);
    buildingPanelController?.refreshFromState();
    resumeOwnActiveChallenge();
  } catch {
    // 临时网络错误不打断地图操作，下个轮询周期自动重试。
  } finally {
    campaignStateSyncPending = false;
  }
}

function startCampaignStatePolling() {
  if (campaignStatePollTimer) return;
  campaignStatePollTimer = setInterval(syncCampaignWorldState, 5000);
}

function finishMapLoading() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      mapElement.classList.remove("is-loading");
      mapLoader.classList.add("is-ready");
    });
  });
}

async function loadMap() {
  const data = await loadCampaignMapData();
  const countries = data.countries;
  const territories = data.territories;
  territoryIndex = data.territoryIndex;
  coastlineData = data.coastlines;
  territoryWorld = createTerritoryWorld(territoryIndex);
  applyCampaignWorldSnapshot(campaignState?.world);
  territoryIndex.territories.forEach((metadata) => territoryMetadataById.set(metadata.territoryId, metadata));
  cityData = data.cities;
  clubData = data.clubs;
  clubData.forEach((club) => {
    const list = clubsByCity.get(club.city) ?? [];
    list.push(club);
    clubsByCity.set(club.city, list);
  });

  const campaignCountries = {
    type: "FeatureCollection",
    features: [
      ...countries.features.filter(isEuropeanFeature),
      ...countries.features.filter(isSouthAmericanFeature).map(transformSouthAmericaFeature),
    ],
  };

  campaignCountries.features.forEach(makeCountryLabel);
  campaignCoastlineLods = buildCoastlineLods(collectCampaignCoastlineSegments(territories));
  activeCoastlineLodKey = coastlineLodKeyForZoom(map.getZoom());
  addCampaignOceanDepthLayer();
  addCampaignLandDepthLayer();
  addCampaignCoastlineLayer();
  addCountryBorders(campaignCountries);

  addCampaignReliefLayers(data.reliefRegions);
  const displayTerritories = addTerritoryLayer(territories);
  addProvinceOutlineLayer(displayTerritories);
  weatherLayerController = createTerritoryWeatherLayerController({
    Leaflet:L,
    map,
    renderer:weatherRenderer,
    displayTerritories,
    getWeatherSnapshot:() => campaignState?.world?.weather ?? null,
  });
  weatherLayerController.setEnabled(weatherLayerVisible);
  buildingMarkerController.refresh();
  expeditionPieceController = createExpeditionPieceController({
    documentRef:document,
    Leaflet: L,
    map,
    mapElement,
    layer: expeditionLayer,
    territoryMetadataById,
    getCampaignState: () => campaignState,
    getCampaignRequest:()=>campaignRequest,
    sourcePointToDisplay,
    campaignStore,
    applyCampaignWorldSnapshot,
    refreshTerritoryDisplay,
    beforeBegin:()=>{
      if(maritimeController?.getMode())maritimeController.clearMaritimeMode({keepSelection:true});
      buildingPanelController?.close();
    },
    showToast,
    escapeHtml,
  });
  expeditionPieceController.refresh();

  addCityMarkers();
  setMajorCitiesVisible(majorCitiesVisible);
  updateZoomState();
  fitCampaign(false);
  campaignMinimapController = createCampaignMinimap({
    Leaflet: L,
    container: document.querySelector("#campaign-minimap"),
    mainMap: map,
    campaignBounds: CAMPAIGN_BOUNDS,
    displayTerritories,
    ownerTypes: OWNER_TYPES,
    getWorld: () => territoryWorld,
    getPlayers: () => campaignWorldPlayers,
  });
  finishMapLoading();
  if (campaignState?.homeSelectionRequired) enterHomeSelectionMode();
  startCampaignStatePolling();
  resumeOwnActiveChallenge();
}

document.querySelector("#country-borders-toggle").addEventListener("change", (event) => setCountryBordersVisible(event.currentTarget.checked));
document.querySelector("#major-cities-toggle").addEventListener("change", (event) => setMajorCitiesVisible(event.currentTarget.checked));
document.querySelector("#weather-layer-toggle").addEventListener("change", (event) => setWeatherLayerVisible(event.currentTarget.checked));
L.DomEvent.disableClickPropagation(document.querySelector(".map-layer-toggles"));
document.querySelector("#confirm-home-selection").addEventListener("click", confirmHomeSelection);
L.DomEvent.disableClickPropagation(document.querySelector("#home-selection-panel"));
document.querySelector("#territory-challenge-button").addEventListener("click", (event) => event.currentTarget.dataset.action === "maritime" ? beginMaritimeCampaign() : challengeSelectedTerritory());
document.querySelector("#territory-maritime-cancel-button").addEventListener("click", cancelMaritimeCampaign);
document.querySelector("#territory-building-button").addEventListener("click", () => buildingPanelController.open(getSelectedTerritoryId()));
document.querySelector("#battle-result-close").addEventListener("click", () => { document.querySelector("#battle-result-panel").hidden = true; });
const accountMenu = document.querySelector("#account-menu");
const accountTrigger = document.querySelector("#account-menu-trigger");
const accountPopover = document.querySelector("#account-menu-popover");
const accountNickname = document.querySelector("#account-nickname");
const accountMenuName = document.querySelector("#account-menu-name");
const topbarWallet = document.querySelector("#topbar-wallet");
const goldBalance = document.querySelector("#gold-balance");
const goldFormatter = new Intl.NumberFormat("zh-CN");
const yoogleController = createYoogleController({
  mount: document.querySelector("#yoogle-search"),
  windowRoot: document.querySelector("#yoogle-window"),
  getRequest: () => campaignRequest,
});
const inventoryController = createInventoryController({
  trigger:document.querySelector("#topbar-inventory"),
  windowRoot:document.querySelector("#inventory-window"),
  getCampaignRequest:()=>campaignRequest,
  getCampaignState:()=>campaignState,
  campaignStore,
  showToast,
  documentRef:document,
});
function updateTopbarWallet(stateValue=campaignState) {
  const gold=Number(stateValue?.wallet?.gold);
  if (!Number.isSafeInteger(gold)||gold<0) {
    topbarWallet.hidden=true;
    return;
  }
  goldBalance.textContent=goldFormatter.format(gold);
  topbarWallet.title=`金币余额：${goldFormatter.format(gold)}`;
  topbarWallet.hidden=false;
}
function initializeAccountMenu(detail) {
  const nickname = detail?.state?.nickname;
  if (!nickname) return;
  accountNickname.textContent = nickname;
  accountMenuName.textContent = nickname;
  accountMenu.hidden = false;
  updateTopbarWallet(detail.state);
  yoogleController.initialize();
}
window.addEventListener("campaign-ready", (event) => initializeAccountMenu(event.detail));
if (window.campaignBootstrap) initializeAccountMenu(window.campaignBootstrap);
accountTrigger.addEventListener("click", () => {
  const expanded = accountTrigger.getAttribute("aria-expanded") === "true";
  accountTrigger.setAttribute("aria-expanded", String(!expanded));
  accountPopover.hidden = expanded;
});
document.addEventListener("click", (event) => {
  if (!accountMenu.contains(event.target)) { accountTrigger.setAttribute("aria-expanded", "false"); accountPopover.hidden = true; }
});
document.querySelector("#account-logout").addEventListener("click", () => {
  campaignClearSession?.();
  window.location.reload();
});
L.DomEvent.disableClickPropagation(accountMenu);
L.DomEvent.disableClickPropagation(document.querySelector("#territory-inspector"));
L.DomEvent.disableClickPropagation(document.querySelector("#building-panel"));
L.DomEvent.disableClickPropagation(document.querySelector("#battle-result-panel"));
const PAN_STEP = 70;
const PAN_INTERVAL_MS = 120;
const pressedPanKeys = new Set();
let panTimer = null;

function panFromPressedKeys() {
  let x = Number(pressedPanKeys.has("d")) - Number(pressedPanKeys.has("a"));
  let y = Number(pressedPanKeys.has("s")) - Number(pressedPanKeys.has("w"));
  if (!x && !y) return;
  if (x && y) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  map.panBy([x * PAN_STEP, y * PAN_STEP], { animate: false });
}

function stopPanTimerIfIdle() {
  if (pressedPanKeys.size || panTimer === null) return;
  window.clearInterval(panTimer);
  panTimer = null;
}

function clearPressedPanKeys() {
  pressedPanKeys.clear();
  stopPanTimerIfIdle();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && buildingPanelController.close()) {
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && cancelMaritimeCampaign()) {
    event.preventDefault();
    return;
  }
  if (event.key === "Escape" && expeditionPieceController?.cancelMoveMode()) {
    event.preventDefault();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
  const key = event.key.toLowerCase();
  if (!["w", "a", "s", "d"].includes(key)) return;
  event.preventDefault();
  if (pressedPanKeys.has(key)) return;
  pressedPanKeys.add(key);
  closeExpandedCity();
  buildingMarkerController.closeExpanded();
  panFromPressedKeys();
  if (panTimer === null) panTimer = window.setInterval(panFromPressedKeys, PAN_INTERVAL_MS);
});

document.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (!pressedPanKeys.delete(key)) return;
  event.preventDefault();
  stopPanTimerIfIdle();
});
window.addEventListener("blur", clearPressedPanKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearPressedPanKeys();
});
map.on("zoom", updateLiveZoomState);
map.on("zoomend", updateZoomState);
map.on("mousemove", (event) => { if(maritimeController.isSelectingPoint())updateMaritimeSnap(event.latlng); });
map.on("click", (event) => {
  if(maritimeController.isSelectingPoint()){confirmMaritimePoint(event.latlng);return;}
  if(expeditionPieceController?.isSelectingDestination()){showToast("请选择本方领土地块");return;}
  const maritimeMode=maritimeController.getMode();
  if(maritimeMode?.routes){
    closeExpandedCity();
    buildingMarkerController.closeExpanded();
    const sourceTerritoryId=maritimeMode.sourceTerritoryId;
    if(getSelectedTerritoryId()!==sourceTerritoryId)selectTerritory(sourceTerritoryId);
    else renderTerritoryInspector(sourceTerritoryId);
    showToast("测绘线路仍保留，可选择登陆点、点击取消测绘或按 Esc 退出");
    return;
  }
  closeExpandedCity();
  buildingMarkerController.closeExpanded();
  clearTerritorySelection();
});

function startMapLoading(event) {
  if (mapLoadingStarted) return Promise.resolve();
  const detail = event?.detail ?? window.campaignBootstrap;
  if (!detail?.state || typeof detail.request !== "function") return Promise.resolve();
  mapLoadingStarted = true;
  campaignStore.setState(detail.state, { source: "bootstrap" });
  campaignRequest = detail.request;
  campaignClearSession = typeof detail.clearSession === "function" ? detail.clearSession : null;
  return loadMap().catch((error) => {
  console.error(error);
  mapLoader.classList.add("is-error");
  mapLoader.querySelector("strong").textContent = "欧洲地图载入失败";
  mapLoader.querySelector("small").textContent = "请刷新页面后重试（" + (error?.message || "未知错误") + "）";
  showToast("欧洲地图数据载入失败，请刷新页面");
});
}
window.addEventListener("campaign-ready", startMapLoading, { once: true });
if (window.campaignBootstrap) startMapLoading({ detail: window.campaignBootstrap });

const teamPanel = document.querySelector("#campaign-team");
const teamController = createTeamController({ panel:teamPanel, getCampaignState:() => campaignState, mapElement, getCampaignRequest:() => campaignRequest, campaignStore, showToast });
const tacticsPanel = document.querySelector("#campaign-tactics");
const fullTacticsController = createTacticsController({
  panel:tacticsPanel,
  mapElement,
  getCampaignState:() => campaignState,
  setCampaignState:(value) => { campaignStore.setState(value, { source: "tactics" }); },
  request:(path, options) => campaignRequest(path, options),
  showToast,
});
const navItems = [...document.querySelectorAll(".nav-item")];
navItems[0]?.addEventListener("click", () => { inventoryController.close(); fullTacticsController.close(); teamController.close(); navItems.forEach((x) => x.classList.remove("is-active")); navItems[0].classList.add("is-active"); });
navItems[1]?.addEventListener("click", () => { fullTacticsController.close(); teamController.open(); navItems.forEach((x) => x.classList.remove("is-active")); navItems[1].classList.add("is-active"); });
navItems[2]?.addEventListener("click", () => { fullTacticsController.open(); navItems.forEach((x) => x.classList.remove("is-active")); navItems[2].classList.add("is-active"); });
navItems[4]?.addEventListener("click", () => { fullTacticsController.close(); teamController.close(); navItems.forEach((x) => x.classList.remove("is-active")); navItems[4].classList.add("is-active"); });
document.querySelector("#tactics-save")?.addEventListener("click", saveTactics);
document.querySelector("#tactics-formation")?.addEventListener("change", (e) => { tacticsState.formation = e.target.value; });
document.querySelector("#tactics-attack")?.addEventListener("change", (e) => { tacticsState.attackStyle = e.target.value; });
document.querySelector("#tactics-defense")?.addEventListener("change", (e) => { tacticsState.defenseStyle = e.target.value; });
