import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { MapEnvironment, decodeSnowMask, environmentVisibility, loadMapEnvironment } from "../client/map-three/environment.js";
import { applyTerrainGrade } from "../client/map-three/terrain-material.js";
import { projectTerritoryPoint } from "../client/map-three/projection.js";
import { MAP_THREE_SETTINGS, LAND_STENCIL_BIT } from "../client/map-three/settings.js";

const json = async (path) => JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const data = await json("assets/data/map-environment.json");
function sampleSnow(key, source) {
  const p = projectTerritoryPoint(source, key === "south-america" ? key : "europe");
  const mask = data.regions[key].snow, pixels = decodeSnowMask(mask);
  const c = Math.round((p.x - mask.origin[0]) / mask.step), r = Math.round((p.z - mask.origin[1]) / mask.step);
  return pixels[r * mask.width + c] ?? 0;
}

test("environment uses provenance-tracked rivers and cached elevation across all three regions", () => {
  assert.equal(data.schemaVersion, 1);
  assert.match(data.source.rivers, /natural-earth-vector/);
  assert.match(data.source.riverSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(data.regions).sort(), ["europe", "south-america", "svalbard"]);
  for (const region of Object.values(data.regions)) {
    assert.ok(region.demSamples > 0);
    assert.ok(region.demMissing / region.demSamples < .002);
    assert.ok(decodeSnowMask(region.snow).some((value) => value > 0));
  }
  assert.ok(data.regions.europe.rivers.length > 100);
  assert.ok(data.regions["south-america"].rivers.length > 100);
  for (const region of Object.values(data.regions)) assert.equal("forests" in region, false);
});

test("snow mask decoder rejects overflow, missing data and unsafe allocation", () => {
  assert.throws(() => decodeSnowMask({ width: 1, height: 1, rle: "AgD/" }), /overflow/);
  assert.throws(() => decodeSnowMask({ width: 2, height: 2, rle: "AQD/" }), /truncated/);
  assert.throws(() => decodeSnowMask({ width: 99999, height: 99999, rle: "" }), /dimensions/);
});

test("snow stays off temperate cities and tropical lowlands", () => {
  for (const point of [[2.35, 48.86], [-0.12, 51.5], [13.4, 52.5]]) assert.equal(sampleSnow("europe", point), 0);
  assert.equal(sampleSnow("south-america", [-60, -3.1]), 0, "Relocated Amazon is still tropical, not display-latitude snow");
});

test("minor river visibility blend continuously with scale", () => {
  const overview = environmentVisibility(2), middle = environmentVisibility(8), detail = environmentVisibility(32);
  assert.equal(overview.minorRiver, 0);
  assert.ok(overview.majorRiver > 0);
  assert.ok(middle.minorRiver > 0 && middle.minorRiver < detail.minorRiver);
  assert.ok(Math.abs(environmentVisibility(8.001).minorRiver - middle.minorRiver) < .001);
});

test("Alps and Andes retain visible high-altitude snow after display transformation", () => {
  for (const [region, coordinates] of [["europe", [6.865, 45.832]], ["south-america", [-70.01, -32.65]]]) {
    const snow = data.regions[region].snow, pixels = decodeSnowMask(snow);
    const p = projectTerritoryPoint(coordinates, region);
    const col = Math.round((p.x - snow.origin[0]) / snow.step), row = Math.round((p.z - snow.origin[1]) / snow.step);
    let maximum = 0;
    for (let z = row - 2; z <= row + 2; z++) for (let x = col - 2; x <= col + 2; x++) maximum = Math.max(maximum, pixels[z * snow.width + x] ?? 0);
    assert.ok(maximum > 128, region + " peak snow should not disappear");
  }
});

test("environment contains only clipped rivers and snow, with no forest allocation", async (t) => {
  const environment = new MapEnvironment(data, { height: MAP_THREE_SETTINGS.thickness });
  assert.equal(environment.riverMeshes.length, 4);
  assert.equal(environment.group.children.length, 4);
  assert.ok(environment.group.children.every(mesh => !mesh.isInstancedMesh));
  for (const { mesh } of environment.riverMeshes) {
    const m = mesh.material;
    assert.equal(m.stencilRef, LAND_STENCIL_BIT);
    assert.equal(m.stencilWriteMask, 8);
    assert.equal(m.stencilFunc, THREE.EqualStencilFunc);
    // First river fragment succeeds on land; the second is rejected.
    const stencil = LAND_STENCIL_BIT;
    assert.equal(stencil & m.stencilFuncMask, m.stencilRef);
    assert.notEqual((stencil ^ m.stencilWriteMask) & m.stencilFuncMask, m.stencilRef);
  }
  const material = applyTerrainGrade(new THREE.MeshStandardMaterial());
  environment.applyTo(material, "europe");
  environment.applyTo(material, "europe");
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal((shader.fragmentShader.match(/uniform sampler2D environmentSnow;/g) ?? []).length, 1);
  assert.match(shader.fragmentShader, /terrainLuma/);
  assert.match(shader.fragmentShader, /snowShade/);
  assert.match(shader.fragmentShader, /#include <lights_fragment_begin>/);
  const mask = environment.masks.get("europe");
  assert.equal(shader.uniforms.environmentSnow.value, mask.texture);
  assert.equal(mask.texture.generateMipmaps, false);
  environment.setHeight(1.4);
  assert.equal(environment.group.position.y, 1.4);
  environment.update(2); assert.ok(environment.riverMeshes.filter(({major}) => !major).every(({mesh}) => !mesh.visible));
  environment.update(32); assert.ok(environment.riverMeshes.every(({mesh}) => mesh.visible));
  let disposed = 0;
  for (const { texture } of environment.masks.values()) texture.addEventListener("dispose", () => disposed++);
  t.diagnostic(environment.riverMeshes.length + " river batches; no forest objects");
  environment.dispose(); environment.dispose();
  assert.equal(disposed, 3);
  assert.equal(environment.group.children.length, 0);
  material.dispose();
});

test("river and snow switches stay independent across zoom and late material compilation", () => {
  const environment = new MapEnvironment(data);
  const terrainVisibility = { value: 1 };
  const materials = [];
  const compile = (region) => {
    const material = applyTerrainGrade(new THREE.MeshStandardMaterial(), terrainVisibility);
    materials.push(material);
    environment.applyTo(material, region);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader);
    return shader;
  };
  try {
    const first = compile("europe");
    for (const rivers of [false, true]) for (const terrain of [false, true]) for (const snow of [false, true]) {
      environment.setRiversVisible(rivers);
      environment.setSnowVisible(snow);
      terrainVisibility.value = Number(terrain);
      environment.update(32);
      assert.equal(environment.group.visible, rivers);
      assert.equal(first.uniforms.environmentSnowVisible.value, Number(snow));
      assert.equal(first.uniforms.terrainVisible.value, Number(terrain));
    }
    environment.setSnowVisible(false);
    terrainVisibility.value = 0;
    const later = compile("south-america");
    assert.equal(later.uniforms.environmentSnowVisible.value, 0);
    assert.equal(later.uniforms.terrainVisible.value, 0);
    assert.equal(later.uniforms.environmentSnowVisible, first.uniforms.environmentSnowVisible);
    environment.setSnowVisible(true);
    assert.equal(later.uniforms.environmentSnowVisible.value, 1);
    assert.equal(later.uniforms.terrainVisible.value, 0, "Snow can show over flat land");
    assert.ok(later.fragmentShader.includes("mix(terrainBase, diffuseColor.rgb, terrainVisible)"));
    assert.ok(later.fragmentShader.includes("insideSnow * environmentSnowVisible"));
    assert.ok(later.fragmentShader.includes("#include <alphatest_fragment>"), "Coast alpha remains intact");
  } finally {
    materials.forEach((material) => material.dispose());
    environment.dispose();
  }
});

test("optional decoration loading fails clearly and passes the cancellation signal", async () => {
  const controller = new AbortController();
  await assert.rejects(loadMapEnvironment({ fetchImpl: async () => ({ ok: false }) }), /资源读取失败/);
  const result = await loadMapEnvironment({ signal: controller.signal, fetchImpl: async (url, options) => {
    assert.match(url, /map-environment.json/);
    assert.equal(options.signal, controller.signal);
    return { ok: true, json: async () => data };
  } });
  assert.equal(result, data);
});
