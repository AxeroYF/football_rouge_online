import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildingMarkerMarkup,
  buildingOrbitLayout,
  createBuildingMarkerController,
} from "../client/buildings/building-marker-controller.js";

const catalog = [
  { type: "main-stadium", label: "主体育场", iconPath: "/assets/building-icons-v2/main-stadium.png", maxLevel: 5 },
  { type: "port", label: "港口", iconPath: "/assets/building-icons-v2/port.png", maxLevel: 5 },
];
const buildings = [
  { id: "stadium", type: "main-stadium", name: "黄狗竞技场", level: 1 },
  { id: "port", type: "port", name: null, level: 2 },
];

test("collapsed building hubs show a text summary without decoding icon images", () => {
  const markup = buildingMarkerMarkup({
    territoryId: "home",
    territoryLabel: "英国 - 高地",
    buildings,
    catalog,
    expanded: false,
  });
  assert.match(markup, /building-node/);
  assert.match(markup, /主体育场 LV\.1 · 港口 LV\.2/);
  assert.match(markup, /<small>2<\/small>/);
  assert.doesNotMatch(markup, /<img|building-orbit-item/);
});

test("expanded building hubs lazily load icons and distribute them around the territory", () => {
  const markup = buildingMarkerMarkup({
    territoryId: "home",
    territoryLabel: "英国 - 高地",
    buildings,
    catalog,
    expanded: true,
  });
  assert.equal((markup.match(/building-orbit-item/g) ?? []).length, 2);
  assert.equal((markup.match(/loading="lazy"/g) ?? []).length, 2);
  assert.match(markup, /building-icons-v2\/main-stadium\.png/);
  assert.match(markup, /黄狗竞技场/);
  assert.match(markup, /building-orbit-tooltip-meta/);
  assert.match(markup, /LV\.1/);
  assert.match(markup, /已建成/);
  assert.doesNotMatch(markup, /等级 1 \/ 5|LV\.1 \/ 5/);
  const layout = buildingOrbitLayout(7);
  assert.equal(layout.length, 7);
  assert.equal(new Set(layout.map((entry) => entry.radius)).size, 1);
  assert.ok(layout.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y)));
});

test("app wires building hubs to world refresh, map close events and territory summaries", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const territorySource = await readFile(new URL("../client/territory/territory-controller.js", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(appSource, /createBuildingMarkerController/);
  assert.match(appSource, /buildingMarkerController\?\.refresh\(\)/);
  assert.match(appSource, /buildingMarkerController\.closeExpanded\(\)/);
  assert.match(territorySource, /buildingNames\.length \? "设施 "/);
  assert.match(stylesSource, /@keyframes building-orbit-in/);
  assert.match(stylesSource, /width: 96px/);
  assert.match(stylesSource, /--building-accent: #a18cff/);
});

test("unchanged world polling does not rebuild an expanded building marker", () => {
  const marker = {
    setIconCalls: 0,
    on() {},
    setIcon() { this.setIconCalls += 1; },
    setZIndexOffset() {},
    setLatLng() {},
    addTo(target) { target.items.add(this); return this; },
    getElement() { return null; },
  };
  const layer = {
    items: new Set(),
    hasLayer(value) { return this.items.has(value); },
    removeLayer(value) { this.items.delete(value); },
  };
  const world = { territories: { home: { buildings: [{ id: "one", type: "main-stadium", level: 1, status: "active" }] } } };
  const controller = createBuildingMarkerController({
    Leaflet: {
      divIcon: (value) => value,
      marker: () => marker,
      DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {} },
    },
    map: { getZoom: () => 5, panTo() {} },
    layer,
    territoryLayersById: new Map([["home", { getBounds: () => ({ isValid: () => true, getCenter: () => [1, 2] }) }]]),
    territoryMetadataById: new Map([["home", { country: "英国", name: "高地" }]]),
    getTerritoryWorld: () => world,
    getBuildingCatalog: () => catalog,
    selectTerritory() {},
  });
  controller.refresh();
  controller.toggle("home");
  assert.equal(marker.setIconCalls, 1);
  controller.refresh();
  controller.refresh();
  assert.equal(marker.setIconCalls, 1);
  world.territories.home.buildings[0].level = 2;
  controller.refresh();
  assert.equal(marker.setIconCalls, 2);
});

test("expanded building markers stay visible below the collapsed zoom threshold", () => {
  let zoom = 5;
  const marker = {
    on() {}, setIcon() {}, setZIndexOffset() {}, setLatLng() {}, getElement() { return null; },
    addTo(target) { target.items.add(this); return this; },
  };
  const layer = {
    items: new Set(),
    hasLayer(value) { return this.items.has(value); },
    removeLayer(value) { this.items.delete(value); },
  };
  const controller = createBuildingMarkerController({
    Leaflet: {
      divIcon: (value) => value,
      marker: () => marker,
      DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {} },
    },
    map: { getZoom: () => zoom, panTo() {} },
    layer,
    territoryLayersById: new Map([["home", { getBounds: () => ({ isValid: () => true, getCenter: () => [1, 2] }) }]]),
    territoryMetadataById: new Map([["home", { country: "英国", name: "高地" }]]),
    getTerritoryWorld: () => ({ territories: { home: { buildings: [{ id: "one", type: "main-stadium", level: 1 }] } } }),
    getBuildingCatalog: () => catalog,
    selectTerritory() {},
  });
  controller.refresh();
  controller.toggle("home");
  zoom = 3;
  controller.updateVisibility();
  assert.equal(controller.getExpandedTerritoryId(), "home");
  assert.equal(layer.hasLayer(marker), true);
  controller.closeExpanded();
  controller.updateVisibility();
  assert.equal(layer.hasLayer(marker), false);
});
