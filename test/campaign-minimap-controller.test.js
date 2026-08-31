import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OWNER_TYPES } from "../territory-model.js";
import {
  createCampaignMinimap,
  createMinimapTerritoryStyle,
} from "../client/map/campaign-minimap-controller.js";

class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  subtract(other) { return new Point(this.x - other.x, this.y - other.y); }
}

function createHarness() {
  const listeners = new Map();
  const classNames = new Set();
  const mainHandlers = new Map();
  const viewport = {
    bounds: null,
    addTo() { return this; },
    setBounds(bounds) { this.bounds = bounds; },
    bringToFront() {},
  };
  const territoryLayer = {
    styleUpdates: 0,
    addTo() { return this; },
    setStyle() { this.styleUpdates += 1; },
  };
  const minimap = {
    fitBoundsCalls: 0,
    fitBounds() { this.fitBoundsCalls += 1; return this; },
    latLngToContainerPoint(latlng) { return new Point(latlng.lng, latlng.lat); },
    containerPointToLatLng(point) { return { lat: point.y, lng: point.x }; },
    invalidateSize() {},
    remove() {},
  };
  const mainMap = {
    center: { lat: 30, lng: 40 },
    bounds: [[10, 20], [50, 60]],
    panCalls: [],
    getCenter() { return this.center; },
    getBounds() { return this.bounds; },
    panTo(center, options) { this.center = center; this.panCalls.push({ center, options }); },
    on(events, callback) { mainHandlers.set(events, callback); },
    off(events) { mainHandlers.delete(events); },
  };
  const container = {
    ownerDocument: null,
    classList: {
      add(value) { classNames.add(value); },
      remove(value) { classNames.delete(value); },
    },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
  };
  const viewListeners = new Map();
  const view = {
    addEventListener(type, callback) { viewListeners.set(type, callback); },
    removeEventListener(type) { viewListeners.delete(type); },
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {},
  };
  const Leaflet = {
    map: () => minimap,
    canvas: () => ({}),
    svg: () => ({}),
    geoJSON: () => territoryLayer,
    rectangle: () => viewport,
    point: (x, y) => new Point(x, y),
    DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {} },
  };
  const state = {
    world: { territories: { player: { ownerType: OWNER_TYPES.PLAYER, ownerId: "p1", capitalOf: "p1" } } },
    players: { p1: { color: "#123456" } },
  };
  const controller = createCampaignMinimap({
    Leaflet,
    container,
    mainMap,
    campaignBounds: [[-20, -25], [75, 100]],
    displayTerritories: { type: "FeatureCollection", features: [] },
    ownerTypes: OWNER_TYPES,
    getWorld: () => state.world,
    getPlayers: () => state.players,
    view,
  });
  return { classNames, controller, listeners, mainMap, territoryLayer, viewport };
}

test("minimap territory styling mirrors player, club, and neutral ownership", () => {
  const world = {
    territories: {
      player: { ownerType: OWNER_TYPES.PLAYER, ownerId: "p1", capitalOf: "p1" },
      club: { ownerType: OWNER_TYPES.CLUB },
      neutral: { ownerType: OWNER_TYPES.NEUTRAL },
    },
  };
  const style = createMinimapTerritoryStyle({
    ownerTypes: OWNER_TYPES,
    getWorld: () => world,
    getPlayers: () => ({ p1: { color: "#123456" } }),
  });
  assert.equal(style({ properties: { territoryId: "player" } }).fillColor, "#123456");
  assert.equal(style({ properties: { territoryId: "player" } }).color, "#f1eddf");
  assert.equal(style({ properties: { territoryId: "club" } }).fillColor, "#75613a");
  assert.equal(style({ properties: { territoryId: "neutral" } }).fillColor, "#31473b");
});

test("dragging the minimap viewport pans the main map without changing zoom", () => {
  const harness = createHarness();
  const viewportTarget = { closest: (selector) => selector === ".minimap-viewport" ? viewportTarget : null };
  const event = (type, x, y) => harness.listeners.get(type)({
    target: viewportTarget,
    pointerId: 7,
    clientX: x,
    clientY: y,
    preventDefault() {},
    stopPropagation() {},
  });
  event("pointerdown", 50, 40);
  assert.equal(harness.classNames.has("is-dragging-viewport"), true);
  event("pointermove", 80, 70);
  assert.deepEqual(harness.mainMap.panCalls.at(-1), {
    center: { lat: 60, lng: 70 },
    options: { animate: false },
  });
  event("pointerup", 80, 70);
  assert.equal(harness.classNames.has("is-dragging-viewport"), false);
  assert.deepEqual(harness.viewport.bounds, harness.mainMap.bounds);

  harness.controller.refresh();
  assert.equal(harness.territoryLayer.styleUpdates, 1);
});

test("campaign shell places map toggles above the bottom-left minimap", async () => {
  const [appSource, indexSource, stylesSource] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);
  const panelStart = indexSource.indexOf('class="campaign-minimap-panel"');
  const toggles = indexSource.indexOf('class="map-layer-toggles"', panelStart);
  const minimap = indexSource.indexOf('id="campaign-minimap"', panelStart);
  assert.ok(panelStart >= 0 && toggles > panelStart && minimap > toggles);
  assert.match(indexSource, /id="weather-layer-toggle" type="checkbox" \/>/);
  assert.match(appSource, /createCampaignMinimap\(\{/);
  assert.match(appSource, /campaignMinimapController\?\.refresh\(\)/);
  assert.match(stylesSource, /\.campaign-minimap-panel\s*\{[^}]*bottom:\s*14px;[^}]*left:\s*14px;/s);
  assert.match(stylesSource, /\.campaign-minimap\s*\{[^}]*width:\s*100%;[^}]*height:\s*160px;/s);
});
