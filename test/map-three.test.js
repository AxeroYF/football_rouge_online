import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import {
  project, unproject, projectTerritoryPoint, boundsFromGeo, tileBounds,
  intersectBounds, reliefRegions, visibleTiles, planVisibleTiles, createProvinceIndex,
} from "../client/map-three/projection.js";
import { buildLand, provinceGeometry } from "../client/map-three/geometry.js";
import { TerrainTiles } from "../client/map-three/tiles.js";
import { MAP_THREE_LAND } from "../client/map-three/settings.js";

const config = JSON.parse(await readFile(new URL("../shared/config/map-relief-regions.json", import.meta.url)));
const regions = reliefRegions(config);
const whole = { minX: -512, minZ: -512, maxX: 512, maxZ: 512 };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, a + " != " + b);

test("Three projection round-trips Europe, high latitudes and relocated South America", () => {
  for (const [lng, lat] of [[12, 52], [-4, 54], [20, 78.5], [20, 7], [-84.5, -56.5]]) {
    const p = project(lng, lat), inverse = unproject(p.x, p.z);
    close(inverse.lng, lng);
    close(inverse.lat, lat);
  }
  assert.deepEqual(projectTerritoryPoint([-57.5, -21.5], "south-america"), project(20, 7));
  assert.deepEqual(projectTerritoryPoint([20, 78], "europe"), project(20, 78));
  assert.ok(Number.isFinite(project(0, 90).z));
});

test("tile placement follows the existing Mercator pyramid and clips region borders", () => {
  const bounds = tileBounds(3, 4, 4);
  assert.deepEqual(bounds, { minX: 0, minZ: 0, maxX: 128, maxZ: 128 });
  const tiles = visibleTiles(whole, regions, 3);
  assert.equal(tiles.length, 20);
  for (const tile of tiles) {
    const region = regions.find((item) => item.id === tile.region);
    assert.deepEqual(tile.bounds, intersectBounds(tile.fullBounds, region.bounds));
    assert.ok(tile.url.includes("/3/"));
    assert.ok(tile.url.includes("soft-relief-v1"));
  }
  assert.equal(intersectBounds(bounds, { minX: -20, minZ: -20, maxX: -1, maxZ: -1 }), null);
});

test("terrain switch retains cached tiles and shares its state with late arrivals", async () => {
  const scene = new THREE.Scene();
  const tiles = new TerrainTiles(scene, regions);
  tiles.loader.loadAsync = async () => new THREE.Texture();
  tiles.setTerrainVisible(false);
  tiles.update(boundsFromGeo({ west: -6, east: -5, north: 54, south: 53 }), 3);
  for (let i = 0; i < 20 && tiles.pending.size; i++) await tick();
  try {
    assert.ok(tiles.records.size > 0);
    const record = tiles.records.values().next().value;
    const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    record.mesh.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.terrainVisible.value, 0);
    assert.equal(record.mesh.visible, true, "Keep snow, alpha and coast clipping available");
    const count = tiles.records.size, version = record.mesh.material.version;
    tiles.setTerrainVisible(true);
    assert.equal(shader.uniforms.terrainVisible.value, 1);
    assert.equal(tiles.records.size, count);
    assert.equal(record.mesh.material.version, version, "No shader recompile on toggle");
    assert.equal(tiles.pending.size, 0);
  } finally { tiles.dispose(); }
});

test("visible tile planning reduces LOD to respect the draw and request budget", () => {
  const plan = planVisibleTiles(whole, regions, 7, 100);
  assert.ok(plan.tiles.length <= 100);
  assert.ok(plan.zoom < 7);
  const small = boundsFromGeo({ west: -6, east: -5, north: 54, south: 53 });
  assert.equal(planVisibleTiles(small, regions, 7).zoom, 7);
  assert.equal(visibleTiles({ minX: 450, maxX: 460, minZ: 400, maxZ: 410 }, regions, 7).length, 0);
});

test("province index respects holes and does not confuse opposite sides of the map", () => {
  const ring = (a, b) => [{ x: a, z: a }, { x: b, z: a }, { x: b, z: b }, { x: a, z: b }];
  const entry = { id: "island", polygons: [[ring(0, 10), ring(3, 5)]] };
  const index = createProvinceIndex([entry], 2);
  assert.equal(index.pick(1, 1), entry);
  assert.equal(index.pick(4, 4), null);
  assert.equal(index.pick(12, 12), null);
});

test("triangulated top faces preserve holes and point upward on the XZ plane", () => {
  const ring = (a, b) => [{ x: a, z: a }, { x: b, z: a }, { x: b, z: b }, { x: a, z: b }];
  const geometry = provinceGeometry({ polygons: [[ring(0, 10), ring(3, 5)]] });
  const indexed = geometry.toNonIndexed();
  const p = indexed.attributes.position;
  let area = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i);
    const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    area += new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).length() / 2;
  }
  close(area, 96);
  close(geometry.attributes.normal.getY(0), 1);
  indexed.dispose();
  geometry.dispose();
});

test("land builder merges actual campaign geometry and includes Svalbard and South America", async (t) => {
  const territories = JSON.parse(await readFile(new URL("../assets/data/campaign-territories.geojson", import.meta.url)));
  const coastlines = JSON.parse(await readFile(new URL("../assets/data/campaign-coastlines.json", import.meta.url)));
  const before = JSON.stringify(territories.features[0]);
  const land = await buildLand(territories, coastlines);
  assert.equal(land.entries.length, territories.features.length);
  assert.equal(land.group.children.length, 6);
  assert.ok(land.entries.some((entry) => entry.id === "adm1:nor-901"));
  assert.ok(land.entries.some((entry) => entry.properties.region === "south-america"));
  for (const entry of land.entries) {
    assert.ok(entry.polygons.every((polygon) => polygon[0].length >= 3));
  }
  const top = land.group.children[0];
  land.setTerrainVisible(false);
  const tinted = new THREE.Color().fromBufferAttribute(top.geometry.attributes.color, 0).multiply(top.material.color);
  const flat = new THREE.Color(MAP_THREE_LAND.flat);
  close(tinted.r, flat.r);
  close(tinted.g, flat.g);
  close(tinted.b, flat.b);
  land.setTerrainVisible(true);
  assert.equal(top.material.color.getHex(), 0xffffff, "Restore unchanged terrain fallback");
  top.geometry.computeBoundingBox();
  const box = top.geometry.boundingBox;
  assert.ok(Number.isFinite(box.min.x) && Number.isFinite(box.max.z));
  assert.ok(box.min.z < project(20, 78).z);
  assert.ok(box.max.z > project(20, 7).z);
  land.setThickness(1.2);
  close(top.position.y, 1.2);
  close(land.group.children[1].scale.y, 1.2);
  assert.equal(JSON.stringify(territories.features[0]), before);
  t.diagnostic(land.entries.length + " provinces; " + top.geometry.index.count / 3 + " top triangles; 6 merged scene objects");
  land.dispose();
});

function fixtureManager() {
  const scene = new THREE.Scene();
  const manager = new TerrainTiles(scene, regions);
  const jobs = [];
  manager.loader = {
    loadAsync(url) {
      return new Promise((resolve, reject) => jobs.push({ url, resolve, reject, done: false }));
    },
  };
  return { scene, manager, jobs };
}

async function finishJobs(manager, jobs, shouldFail = () => false) {
  for (let step = 0; step < 100; step++) {
    for (const job of jobs.filter((entry) => !entry.done)) {
      job.done = true;
      if (shouldFail(job.url)) job.reject(new Error("missing"));
      else job.resolve(new THREE.Texture());
    }
    await tick();
    if (manager.pending.size === 0 && manager.queue.length === 0) return;
    assert.ok(manager.pending.size <= 6);
  }
  assert.fail("Tile queue did not settle");
}

test("texture streaming caps concurrent requests and keeps coarse fallback while detail fails", async () => {
  const { manager, jobs, scene } = fixtureManager();
  manager.update(boundsFromGeo({ west: -7, east: 0, south: 50, north: 56 }), 6);
  assert.equal(manager.pending.size, 6);
  await finishJobs(manager, jobs, (url) => url.includes("/6/"));
  assert.ok(manager.failed.size > 0);
  assert.ok([...manager.records.values()].some((record) => record.tile.zoom === 3 && record.mesh.visible));
  assert.equal(manager.stats().loaded, 0);
  assert.ok(scene.children.length <= 160);
  manager.dispose();
  assert.equal(scene.children.length, 0);
});

test("late textures are disposed after teardown and do not restart the queue", async () => {
  const { manager, jobs, scene } = fixtureManager();
  manager.update(boundsFromGeo({ west: -7, east: 0, south: 50, north: 56 }), 7);
  const texture = new THREE.Texture();
  let disposed = false;
  texture.addEventListener("dispose", () => { disposed = true; });
  manager.dispose();
  jobs[0].resolve(texture);
  for (const job of jobs.slice(1)) job.resolve(new THREE.Texture());
  await tick();
  assert.equal(disposed, true);
  assert.equal(manager.pending.size, 0);
  assert.equal(manager.queue.length, 0);
  assert.equal(scene.children.length, 0);
});

test("texture cache also evicts stale detail fallbacks when the GPU budget is exceeded", () => {
  const { manager, scene } = fixtureManager();
  manager.view = whole;
  manager.zoom = 7;
  manager.desired = new Set(["not-yet-loaded"]);
  let disposed = 0;
  for (let i = 0; i < 180; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const texture = new THREE.Texture();
    texture.addEventListener("dispose", () => { disposed += 1; });
    scene.add(mesh);
    manager.records.set("stale-" + i, {
      mesh, texture, used: i, tile: { zoom: 4, bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } },
    });
  }
  manager.refreshVisibility();
  assert.equal(manager.records.size, 160);
  assert.equal(disposed, 20);
  manager.dispose();
  assert.equal(disposed, 180);
});

test("loaded tile UVs and height stay aligned when clipped to regional bounds", async () => {
  const { manager, jobs } = fixtureManager();
  manager.update(regions[2].bounds, 3);
  manager.setThickness(1.4);
  await finishJobs(manager, jobs);
  for (const record of manager.records.values()) {
    close(record.mesh.position.y, 1.4 + 0.025 + record.tile.zoom * 0.001);
    const uv = record.mesh.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      assert.ok(uv.getX(i) >= -1e-6 && uv.getX(i) <= 1 + 1e-6);
      assert.ok(uv.getY(i) >= -1e-6 && uv.getY(i) <= 1 + 1e-6);
    }
  }
  manager.setEnabled(false);
  assert.ok([...manager.records.values()].every((record) => !record.mesh.visible));
  manager.dispose();
});

test("preview is a separate read-only page with local pinned imports and explicit limits", async () => {
  const html = await readFile(new URL("../three-preview.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../client/map-three/preview.js", import.meta.url), "utf8");
  assert.match(html, /assets\/vendor\/three\/three\.module\.js/);
  assert.doesNotMatch(html, /https:\/\/.*(?:cdn|unpkg)/);
  assert.doesNotMatch(app, /\/api\/|localStorage|sessionStorage|method:\s*["']POST/);
  assert.match(app, /minZoom: 0, maxZoom: Math\.log2\(30\)/);
  assert.match(app, /renderer\.setPixelRatio\(Math\.min\(window\.devicePixelRatio \|\| 1, 1\.5\)\)/);
  assert.match(app, /if \(dirty\)/);
  assert.match(app, /controls\?\.dispose\(\)/);
  assert.match(app, /tiles\?\.dispose\(\)/);
});
