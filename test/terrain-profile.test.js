import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { terrainProfile, terrainProfileLink, setupTerrainProfileLinks } from "../client/map-three/terrain-profile.js";
import { reliefRegions, visibleTiles, boundsFromGeo } from "../client/map-three/projection.js";
import { TerrainTiles } from "../client/map-three/tiles.js";

const config = JSON.parse(await readFile(new URL("../shared/config/map-relief-regions.json", import.meta.url)));
const whole = { minX: -512, minZ: -512, maxX: 512, maxZ: 512 };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("atlas terrain is the default; explicit relief, soft and classic remain available without storage", () => {
  assert.equal(terrainProfile(), "atlas");
  assert.equal(terrainProfile("?terrain=relief"), "relief");
  assert.equal(terrainProfile("?terrain=soft"), "soft");
  assert.equal(terrainProfile("?terrain=classic"), "classic");
  assert.equal(terrainProfile("?terrain=../../missing"), "atlas");
  const location = new URL("http://localhost:4370/game?renderer=leaflet&terrain=soft&debug=1#map");
  assert.equal(terrainProfileLink(location, "classic"), "/game?terrain=classic&debug=1#map");
  const preview = new URL("http://localhost:4370/three-preview.html?terrain=classic");
  assert.equal(terrainProfileLink(preview, "soft"), "/three-preview.html?terrain=soft");
});

test("both terrain profiles cover the same places but request isolated resources and cache keys", () => {
  const soft = visibleTiles(whole, reliefRegions(config, "soft"), 3);
  const classic = visibleTiles(whole, reliefRegions(config, "classic"), 3);
  assert.equal(soft.length, classic.length);
  assert.equal(soft.length, 20);
  for (let i = 0; i < soft.length; i++) {
    assert.deepEqual(soft[i].bounds, classic[i].bounds);
    assert.deepEqual(soft[i].fullBounds, classic[i].fullBounds);
    assert.equal(soft[i].region, classic[i].region);
    assert.notEqual(soft[i].key, classic[i].key);
    assert.ok(soft[i].url.includes("-soft-relief/"));
    assert.ok(classic[i].url.includes("-dem-overview/"));
    assert.ok(classic[i].url.endsWith("?v=20260904-deep-olive-relief-v3"));
    assert.ok(soft[i].url.endsWith("?v=20260904-soft-relief-v1"));
  }
});

test("visible links select the correct profile and do not label Leaflet as a Three profile", () => {
  const links = ["soft", "classic"].map((profile) => ({
    dataset: { terrainProfile: profile }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  }));
  const doc = { querySelectorAll: () => links };
  setupTerrainProfileLinks(doc, new URL("http://localhost/game?terrain=classic"));
  assert.equal(links[1].attributes["aria-current"], "true");
  assert.equal(links[0].attributes["aria-current"], undefined);
  assert.equal(links[0].href, "/game?terrain=soft");
  setupTerrainProfileLinks(doc, new URL("http://localhost/game?renderer=leaflet"));
  assert.ok(links.every((link) => !link.attributes["aria-current"]));
});

test("each profile streams only its own textures and preserves the accepted flat-map switch", async () => {
  for (const profile of ["soft", "classic"]) {
    const manager = new TerrainTiles(new THREE.Scene(), reliefRegions(config, profile));
    const requests = [];
    manager.loader.loadAsync = async (url) => { requests.push(url); return new THREE.Texture(); };
    manager.setTerrainVisible(false);
    manager.update(boundsFromGeo({ west: 6, east: 7, north: 47, south: 46 }), 7);
    for (let i = 0; i < 30 && (manager.pending.size || manager.queue.length); i++) await tick();
    try {
      assert.ok(requests.length > 0);
      const pathPart = profile === "soft" ? "-soft-relief/" : "-dem-overview/";
      assert.ok(requests.every((url) => url.includes(pathPart)));
      const material = manager.records.values().next().value.mesh.material;
      const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.terrainVisible.value, 0);
      assert.equal(shader.uniforms.terrainBase.value.getHexString(), "304844");
      manager.setTerrainVisible(true);
      assert.equal(shader.uniforms.terrainVisible.value, 1);
    } finally { manager.dispose(); }
  }
});
