import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { MAP_THREE_SETTINGS, MAP_THREE_LIGHTING, MAP_THREE_PALETTE, MAP_THREE_LAND, LAND_STENCIL_BIT, createTiltedCRS } from "../client/map-three/settings.js";
import { syncCampaignCamera } from "../client/map-three/campaign-layer.js";
import { shoreBandGeometry, shoreBandMaterial } from "../client/map-three/shore.js";
import { project, projectTerritoryPoint, unproject } from "../client/map-three/projection.js";
import { createTerritoryPresentation } from "../client/map/territory-presentation.js";
import { OWNER_TYPES } from "../territory-model.js";
import { applyTerrainGrade } from "../client/map-three/terrain-material.js";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, a + " != " + b);
const point = (x, y) => ({ x, y, divideBy: (n) => point(x / n, y / n) });
// Exercise the CRS's real coefficients independently of the Three camera.
const leaflet = {
  CRS: { EPSG3857: { projection: { R: 6378137 }, scale: (z) => 256 * 2 ** z } },
  extend: Object.assign,
  Transformation: class {
    constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); }
    transform({ x, y }, scale) { return point(scale * (this.a * x + this.b), scale * (this.c * y + this.d)); }
  },
};
const crs = createTiltedCRS(leaflet);
test("removed city miniatures stay out of both renderers while original city labels remain", async () => {
  for (const path of ["client/map-three/campaign-layer.js", "client/map-three/preview.js"]) {
    const source = await read(path);
    assert.doesNotMatch(source, /MapCities|cityModels/);
    assert.ok(!source.includes("./cities.js"));
    assert.match(source, /new MapEnvironment/);
  }
  const app = await read("app.js");
  assert.match(app, /let majorCitiesVisible = false/);
  assert.ok(app.includes("addCityMarkers()"));
});
test("three map switches default on and synchronize both immediate and delayed layers", async () => {
  const html = await read("index.html"), app = await read("app.js");
  const live = await read("client/map-three/campaign-layer.js");
  const preview = await read("client/map-three/preview.js");
  for (const name of ["rivers", "terrain", "snow"]) {
    const input = html.split("<input").find((part) => part.includes('data-three-layer="' + name + '"')).split("/>")[0];
    assert.ok(input.includes("checked") && input.includes("disabled"));
  }
  assert.ok(app.includes("campaignThreeLayer.setLayerVisible(input.dataset.threeLayer, input.checked)"));
  assert.ok(app.includes('input.addEventListener("change"'));
  assert.ok(app.includes("input.disabled = false"));
  assert.ok(live.includes("environment.setRiversVisible(layerVisibility.rivers)"));
  assert.ok(live.includes("environment.setSnowVisible(layerVisibility.snow)"));
  assert.ok(live.includes('if (name === "terrain") tiles?.setTerrainVisible(visible)'));
  assert.ok(preview.includes('environment.setSnowVisible($("#snow-visible").checked)'));
  assert.ok(preview.includes('environment.setRiversVisible($("#rivers-visible").checked)'));
  assert.ok(!preview.includes('tiles?.setEnabled(event.target.checked)'));
});

test("live and preview share brighter diffuse lighting and a deep-blue ocean palette", async () => {
  assert.ok(MAP_THREE_LIGHTING.sunIntensity > 2.1);
  assert.ok(MAP_THREE_LIGHTING.ambientIntensity > 1.3);
  for (const hex of Object.values(MAP_THREE_PALETTE)) {
    const rgb = new THREE.Color(hex);
    assert.ok(rgb.b > rgb.g && rgb.g > rgb.r, "Sea and shore stay blue, not green");
  }
  for (const path of ["client/map-three/campaign-layer.js", "client/map-three/preview.js"]) {
    const source = await read(path);
    assert.match(source, /color: MAP_THREE_PALETTE.sea/);
    assert.match(source, /HemisphereLight\(light.skyColor, light.groundColor, light.ambientIntensity\)/);
    assert.match(source, /DirectionalLight\(light.sunColor, light.sunIntensity\)/);
  }
});
function crsPoint(lng, lat, zoom) {
  const rad = Math.PI / 180, r = crs.projection.R;
  return crs.transformation.transform({ x: r * lng * rad, y: r * Math.asinh(Math.tan(lat * rad)) }, crs.scale(zoom));
}

test("production defaults match the accepted 35 degree / 1.1 / 1.3 preview", async () => {
  assert.deepEqual(MAP_THREE_SETTINGS, { pitch: 35, thickness: 1.1, exposure: 1.3 });
  const html = await read("three-preview.html");
  assert.match(html, /id="pitch"[^>]*value="35"/);
  assert.match(html, /id="land-height"[^>]*value="1.1"/);
  assert.match(html, /id="exposure"[^>]*value="1.30"/);
  assert.equal(leaflet.CRS.EPSG3857.transformation, undefined, "Do not mutate the minimap's standard CRS");
});

test("3D land and business overlay projections coincide during fractional zoom and drag", () => {
  for (const center of [{ lng: -4, lat: 54 }, { lng: 20, lat: 78 }, { lng: 20, lat: 7 }]) {
    for (const zoom of [3, 3.71, 5.21, 7]) {
      for (const size of [point(2514, 1250), point(880, 720)]) {
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2200);
        const map = { options: { crs }, getSize: () => size, getZoom: () => zoom,
          containerPointToLatLng: () => center,
          getCenter: () => { throw new Error("Must use actual screen center, not stale center while dragging"); } };
        syncCampaignCamera(camera, map);
        const origin = crsPoint(center.lng, center.lat, zoom);
        for (const location of [center, { lng: center.lng + 0.6, lat: center.lat - 0.4 }]) {
          const p = project(location.lng, location.lat);
          const ndc = new THREE.Vector3(p.x, MAP_THREE_SETTINGS.thickness, p.z).project(camera);
          const overlay = crsPoint(location.lng, location.lat, zoom);
          near((ndc.x + 1) * size.x / 2, size.x / 2 + overlay.x - origin.x);
          near((1 - ndc.y) * size.y / 2, size.y / 2 + overlay.y - origin.y);
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -MAP_THREE_SETTINGS.thickness), new THREE.Vector3());
          const inverse = unproject(hit.x, hit.z);
          near(inverse.lng, location.lng); near(inverse.lat, location.lat);
        }
      }
    }
  }
  const relocated = projectTerritoryPoint([-57.5, -21.5], "south-america");
  assert.deepEqual(relocated, project(20, 7));
});

test("rounded shoreline primitives stay within their bounded coast envelope", () => {
  const width = 0.7;
  const geometry = shoreBandGeometry([[
    { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 },
    { x: 0.01, z: 0.01 }, { x: 10, z: 10 },
  ]], width);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  assert.ok(box.min.x >= -width - 1e-6 && box.max.x <= 10 + width + 1e-6);
  assert.ok(box.min.z >= -width - 1e-6 && box.max.z <= 10 + width + 1e-6);
  const positions = geometry.attributes.position;
  assert.ok(positions.count > 0 && positions.count % 3 === 0);
  for (const value of positions.array) assert.ok(Number.isFinite(value));
  geometry.dispose();
});

test("flat map uses darker neutral ground while textured grading stays unchanged", () => {
  const base = new THREE.Color(MAP_THREE_LAND.base), flat = new THREE.Color(MAP_THREE_LAND.flat);
  const luma = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  assert.ok(luma(flat) < luma(base) * 0.3);
  assert.ok(flat.b > flat.r, "Remove the yellow-green cast");
  assert.equal(MAP_THREE_LAND.base, "#839765");
  assert.equal(MAP_THREE_LAND.saturation, 0.58);
  assert.equal(MAP_THREE_LAND.brightness, 1.65);
  const visibility = { value: 0 };
  const material = applyTerrainGrade(new THREE.MeshStandardMaterial(), visibility);
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.terrainBase.value.getHexString(), flat.getHexString());
  assert.equal(shader.uniforms.terrainVisible, visibility);
  visibility.value = 1;
  assert.equal(shader.uniforms.terrainVisible.value, 1);
  material.dispose();
});

test("pale-green grade reaches DEM textures without flattening alpha, normals or shadows", async () => {
  const material = applyTerrainGrade(new THREE.MeshStandardMaterial());
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.ok(shader.uniforms.terrainBrightness.value > 1);
  assert.ok(shader.uniforms.terrainSaturation.value < 1);
  assert.match(shader.fragmentShader, /mix\(terrainLuma \* terrainTint, diffuseColor.rgb/);
  assert.match(shader.fragmentShader, /#include <normal_fragment_begin>/);
  assert.doesNotMatch(shader.fragmentShader, /diffuseColor\.a\s*=/);
  const textureSource = await read("client/map-three/tiles.js");
  assert.match(textureSource, /applyTerrainGrade\(new THREE.MeshStandardMaterial/);
  for (const path of ["client/map-three/campaign-layer.js", "client/map-three/preview.js"]) {
    assert.match(await read(path), /color: MAP_THREE_PALETTE.sea[^}]*toneMapped: false/);
  }
  material.dispose();
});

test("each shore band blends once per pixel and does not erase the terrain mask", () => {
  let stencil = LAND_STENCIL_BIT;
  for (let band = 0; band < 2; band++) {
    const material = shoreBandMaterial(band);
    assert.equal(material.stencilFunc, THREE.NotEqualStencilFunc);
    assert.equal(material.stencilZPass, THREE.ReplaceStencilOp);
    assert.equal(material.stencilWriteMask & LAND_STENCIL_BIT, 0);
    let passes = 0;
    for (let overlap = 0; overlap < 300; overlap++) {
      if ((stencil & material.stencilFuncMask) !== (material.stencilRef & material.stencilFuncMask)) {
        passes += 1;
        stencil = (stencil & ~material.stencilWriteMask) | (material.stencilRef & material.stencilWriteMask);
      }
    }
    assert.equal(passes, 1, "Dense coast vertices must not multiply opacity");
    assert.equal(stencil & LAND_STENCIL_BIT, LAND_STENCIL_BIT);
    material.dispose();
  }
});

test("live ownership and hover preserve terrain while gameplay borders retain their meaning", () => {
  const context = { mapRenderer: "three", territoryWorld: { territories: {
    neutral: { ownerType: OWNER_TYPES.NEUTRAL }, club: { ownerType: OWNER_TYPES.CLUB },
    player: { ownerType: OWNER_TYPES.PLAYER, ownerId: "one", capitalOf: "one" },
  } }, campaignWorldPlayers: { one: { color: "#ab2345" } } };
  const presentation = createTerritoryPresentation({ ownerTypes: OWNER_TYPES, escapeHtml: String, getContext: () => context });
  const feature = (id) => ({ properties: { territoryId: id } });
  assert.equal(presentation.territoryStyle(feature("neutral")).fillOpacity, 0);
  assert.equal(presentation.territoryStyle(feature("club")).fillOpacity, 0.30);
  assert.equal(presentation.territoryStyle(feature("player")).fillColor, "#ab2345");
  assert.equal(presentation.territoryStyle(feature("player")).fillOpacity, 0.38);
  context.terrainProfile = "atlas";
  assert.equal(presentation.territoryStyle(feature("player")).fillOpacity, 0.38);
  assert.equal(presentation.territoryStyle(feature("club")).fillOpacity, 0.30);
  assert.equal(presentation.territoryHoverStyle(feature("neutral")).fillOpacity, 0.12);
  context.selectedTerritoryId = "neutral";
  assert.equal(presentation.territoryStyle(feature("neutral")).color, "#f1eddf");
  context.campaignState = { world: { activeChallenges: { neutral: {} } } };
  assert.equal(presentation.territoryStyle(feature("neutral")).dashArray, "8 5");
  context.mapRenderer = "leaflet";
  assert.equal(presentation.territoryStyle(feature("neutral")).fillOpacity, 0.96);
});

test("formal game enables Three by default without replacing campaign bootstrap and controls", async () => {
  const [app, html, layer, tiles] = await Promise.all([
    read("app.js"), read("index.html"), read("client/map-three/campaign-layer.js"), read("client/map-three/tiles.js"),
  ]);
  assert.match(app, /get\("renderer"\) !== "leaflet"/);
  assert.match(app, /crs: useThreeMap \? createTiltedCRS\(L\) : L.CRS.EPSG3857/);
  assert.match(app, /await createCampaignThreeLayer/);
  assert.match(html, /type="importmap"/);
  assert.match(html, /campaign-entry.js/);
  assert.match(html, /<script type="module" src="\.\/app\.js\?v=[a-zA-Z0-9-]+"><\/script>/);
  for (const controller of ["createTerritoryController", "createExpeditionPieceController", "createMaritimeController",
    "createBuildingMarkerController", "createCampaignMinimap", "createTerritoryWeatherLayerController"]) assert.match(app, new RegExp(controller));
  assert.match(layer, /element.prepend\(canvas\)/);
  assert.match(layer, /if \(viewChanged\) scheduleTiles\(\)/, "Texture completion must not create an idle loading/render loop");
  assert.match(layer, /map.off\("move zoom resize viewreset", invalidate\)/);
  assert.match(layer, /tiles\?\.dispose\(\)/);
  assert.match(tiles, /stencilFunc: THREE.EqualStencilFunc/);
  assert.doesNotMatch(layer, /\/api\/campaign|localStorage/);
});
