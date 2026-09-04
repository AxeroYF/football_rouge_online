import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  displayPointToTerritory,
  transformSouthAmericaPoint,
} from "../client/map/campaign-map-geometry.js";

const config = JSON.parse(await readFile(
  new URL("../shared/config/map-relief-regions.json", import.meta.url),
  "utf8",
));
const territories = JSON.parse(await readFile(
  new URL("../assets/data/campaign-territories.geojson", import.meta.url),
  "utf8",
));

test("South America relief plan matches the runtime axis-swapped coordinate transform", () => {
  const region = config.regions["south-america"];
  const source = region.transform.sourceCenter;
  const display = region.transform.displayCenter;
  assert.deepEqual(transformSouthAmericaPoint(source.lat, source.lng), [display.lat, display.lng]);

  const displayCorners = [
    { lat: region.displayBounds.south, lng: region.displayBounds.west },
    { lat: region.displayBounds.north, lng: region.displayBounds.east },
  ];
  assert.deepEqual(
    displayPointToTerritory(displayCorners[0], "south-america"),
    [-84.5, -56.5],
  );
  assert.deepEqual(
    displayPointToTerritory(displayCorners[1], "south-america"),
    [-28.5, 16.5],
  );
});

test("Svalbard relief plan targets the existing territory and expands the future north bound", () => {
  const region = config.regions.svalbard;
  const territoryIds = new Set(territories.features.map((feature) => feature.properties?.territoryId));
  assert.deepEqual(region.geometryFilter.territoryIds, ["adm1:nor-901"]);
  assert.equal(territoryIds.has("adm1:nor-901"), true);
  assert.equal(config.futureCampaignBounds.north, 82);
  assert.ok(region.displayBounds.north <= config.futureCampaignBounds.north);
  assert.ok(region.displayBounds.south >= 74);
});

test("campaign bounds include the completed Svalbard relief range", async () => {
  const geometrySource = await readFile(
    new URL("../client/map/campaign-map-geometry.js", import.meta.url),
    "utf8",
  );
  assert.match(geometrySource, /Object\.freeze\(\[82, 100\]\)/);
  assert.equal(config.futureCampaignBounds.north, 82);
});

test("native detail outputs remain build sources for the unified runtime pyramid", async () => {
  const builderSource = await readFile(
    new URL("../scripts/build-unified-relief-pyramid.py", import.meta.url),
    "utf8",
  );
  assert.equal(config.nativeZoom, 8);
  assert.equal(config.maxNativeZoom, 9);
  for (const region of Object.values(config.regions)) {
    assert.match(region.output.overview, /-dem-overview\/\{z\}\/\{x\}\/\{y\}\.webp$/);
    assert.match(region.output.detail, /-dem-z8\/\{z\}\/\{x\}\/\{y\}\.webp$/);
  }
  assert.match(builderSource, /SOURCE_ZOOM = 8/);
  assert.match(builderSource, /MAX_RUNTIME_ZOOM = 7/);
  assert.match(builderSource, /Image\.Resampling\.LANCZOS/);
  assert.match(builderSource, /Do not add another UnsharpMask/);
});

test("DEM builders share a deep olive elevation palette without parent-tile oversharpening", async () => {
  const builders = await Promise.all([
    "../scripts/build-europe-dem-tiles.py",
    "../scripts/build-map-relief-regions.py",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of builders) {
    assert.ok(source.includes("low = np.array([14.0, 42.0, 36.0])"));
    assert.ok(source.includes("mid = np.array([49.0, 77.0, 52.0])"));
    assert.ok(source.includes("high = np.array([146.0, 137.0, 86.0])"));
    assert.ok(source.includes("color *= 0.84 + elevation_mix[..., None] * 0.16"));
    assert.ok(source.includes("UnsharpMask(radius=0.75, percent=40, threshold=3)"));
    assert.ok(!source.includes("percent=105"));
  }
  for (const region of Object.values(config.regions)) {
    assert.equal(region.render.hillshadeContrast, 1.32);
    assert.ok(region.render.detailBrightness <= 1.08);
    assert.ok(region.render.detailContrast <= 1.08);
  }
});
