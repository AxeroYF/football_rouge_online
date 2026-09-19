import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildLand, provinceGeometry } from "./geometry.js";
import { TerrainTiles } from "./tiles.js";
import { project, reliefRegions, clamp } from "./projection.js";
import { MAP_THREE_SETTINGS, MAP_THREE_LIGHTING, MAP_THREE_PALETTE } from "./settings.js";
import { MapEnvironment, loadMapEnvironment } from "./environment.js";
import { setupTerrainProfileLinks } from "./terrain-profile.js";
import { loadReliefFields } from "./relief-field.js";
import { ReliefTerrain, drapeReliefLines } from "./relief-terrain.js";
import { loadMapNature } from "./atlas-nature-model.js";
import { AtlasTerrain } from "./atlas-terrain.js";
import { AtlasEnvironment } from "./atlas-environment.js";
import { ATLAS_LIGHTING, createAtlasOcean } from "./atlas-style.js";
import { addWheelImpulse, advanceInertialZoom, normalizeWheelPixels } from "../map/inertial-wheel-zoom.js";

const $ = (selector) => document.querySelector(selector);
const terrainProfile = setupTerrainProfileLinks(document, window.location);
const isMeshTerrain = terrainProfile === "relief" || terrainProfile === "atlas";
const canvas = $("#three-canvas");
const host = $("#three-map");
const loading = $("#three-loading");
const loadingMessage = $("#loading-message");
const BASE_VIEW_HEIGHT = 300;
const presets = {
  europe: { lng: 12, lat: 51, zoom: 1.5 },
  alps: { lng: 9, lat: 46.7, zoom: 10 },
  andes: { lng: 29.5, lat: -10.5, zoom: 9 },
  britain: { lng: -4, lat: 54, zoom: 5 },
  "south-america": { lng: 20, lat: 7, zoom: 1.8 },
  svalbard: { lng: 20, lat: 78, zoom: 5 },
};

let renderer, controls, land, tiles, selectedMesh, selectedLines;
let environment = null, environmentError = "", environmentLoading = false;
let frameId = null, disposed = false, contextLost = false;
let thickness = MAP_THREE_SETTINGS.thickness, dirty = true, viewDirty = true;
let selected = null, displayed = null, hovering = null;
let pointer = new THREE.Vector2(), pointerDirty = false, pointerDown = null;
let velocity = 0, wheelAnchor = new THREE.Vector2();
let lastFrame = performance.now(), lastTileUpdate = 0, lastMetricUpdate = lastFrame, renderedFrames = 0;
const events = new AbortController();
const scene = new THREE.Scene();
scene.background = new THREE.Color(MAP_THREE_PALETTE.background);
const camera = new THREE.OrthographicCamera(-200, 200, 150, -150, 0.1, 1800);
const raycaster = new THREE.Raycaster();
const surfacePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -thickness);
const light = terrainProfile === "atlas" ? ATLAS_LIGHTING : MAP_THREE_LIGHTING;
const sun = new THREE.DirectionalLight(light.sunColor, light.sunIntensity);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.045;
sun.shadow.radius = 3;
sun.shadow.intensity = light.shadowIntensity ?? 1;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 1100;
scene.add(new THREE.HemisphereLight(light.skyColor, light.groundColor, light.ambientIntensity), sun, sun.target);

function invalidate(view = false) {
  dirty = true;
  if (view) viewDirty = true;
}

function atSurface(ndc) {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(surfacePlane, new THREE.Vector3());
}

function pointerNdc(event) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
    -(event.clientY - rect.top) / rect.height * 2 + 1);
}

function viewportBounds() {
  const corners = [[-1.06, -1.06], [1.06, -1.06], [1.06, 1.06], [-1.06, 1.06]]
    .map(([x, y]) => atSurface(new THREE.Vector2(x, y))).filter(Boolean);
  if (!corners.length) return null;
  return {
    minX: Math.min(...corners.map((p) => p.x)), maxX: Math.max(...corners.map((p) => p.x)),
    minZ: Math.min(...corners.map((p) => p.z)), maxZ: Math.max(...corners.map((p) => p.z)),
  };
}

function updateSun(bounds) {
  const x = (bounds.minX + bounds.maxX) / 2;
  const z = (bounds.minZ + bounds.maxZ) / 2;
  sun.target.position.set(x, 0, z);
  sun.position.set(x - 150, 300, z - 100);
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.7 + 5;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

function applyPitch(degrees) {
  const polar = THREE.MathUtils.degToRad(clamp(degrees, 0.1, 60));
  const azimuth = controls.getAzimuthalAngle();
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(450, polar, azimuth));
  controls.update();
  invalidate(true);
}

function showPreset(name) {
  velocity = 0;
  const preset = presets[name] ?? presets.europe;
  const point = project(preset.lng, preset.lat);
  controls.target.set(point.x, thickness, point.z);
  camera.zoom = preset.zoom;
  const pitch = THREE.MathUtils.degToRad(Number($("#pitch").value));
  camera.position.copy(controls.target).add(new THREE.Vector3(0, Math.cos(pitch) * 450, Math.sin(pitch) * 450));
  camera.updateProjectionMatrix();
  controls.update();
  updateSelection(null);
  invalidate(true);
}

function setThickness(value) {
  const previous = thickness;
  thickness = value;
  surfacePlane.constant = -value;
  land?.setThickness(value);
  scene.traverse(object => object.userData.setThickness?.(value));
  tiles?.setThickness(value);
  environment?.setHeight(value);
  controls.target.y = value;
  camera.position.y += value - previous;
  if (selectedMesh) selectedMesh.position.y = value + 0.085;
  if (selectedLines) selectedLines.position.y = value + 0.095;
  controls.update();
  invalidate(true);
}

function displayProvince(entry) {
  if (entry === displayed) return;
  displayed = entry;
  for (const mesh of [selectedMesh, selectedLines]) {
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
  selectedMesh = selectedLines = null;
  $("#province-card").hidden = !entry;
  if (!entry) { invalidate(); return; }
  selectedMesh = new THREE.Mesh(provinceGeometry(entry), new THREE.MeshBasicMaterial({
    color: "#eed39a", transparent: true, opacity: 0.14, depthWrite: false,
  }));
  selectedMesh.position.y = thickness + 0.085;
  if (isMeshTerrain) selectedMesh.visible = false;
  selectedMesh.renderOrder = 15;
  const positions = [];
  for (const polygon of entry.polygons) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        positions.push(a.x, 0, a.z, b.x, 0, b.z);
      }
    }
  }
  selectedLines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)),
    new THREE.LineBasicMaterial({ color: "#f5e7bb", transparent: true, opacity: 0.95, depthWrite: false }),
  );
  selectedLines.position.y = thickness + 0.095;
  selectedLines.renderOrder = 16;
  if (isMeshTerrain && tiles) drapeReliefLines(selectedLines.geometry, (x,z) => tiles.sample(x,z), .095);
  scene.add(selectedMesh, selectedLines);
  $("#province-country").textContent = entry.properties.country ?? "";
  $("#province-name").textContent = entry.properties.name ?? entry.id;
  $("#province-type").textContent = (entry.properties.clubCount > 0 ? "俱乐部初始地块" : "省级地块")
    + " · " + (selected ? "已选中" : "悬停");
  invalidate();
}

function updateSelection(entry) {
  selected = entry;
  // Refresh the card even if a hovered province becomes the selected one.
  if (displayed === entry && entry) $("#province-type").textContent =
    (entry.properties.clubCount > 0 ? "俱乐部初始地块" : "省级地块") + " · 已选中";
  else displayProvince(entry);
}

function pick(ndc) {
  let point;
  if (isMeshTerrain && tiles) {
    camera.updateMatrixWorld(); raycaster.setFromCamera(ndc,camera);
    point = tiles.pick(raycaster);
  } else point = atSurface(ndc);
  return point && land ? land.index.pick(point.x, point.z) : null;
}

function createOcean() {
  if (terrainProfile === "atlas") { scene.add(createAtlasOcean()); return; }
  const material = new THREE.MeshStandardMaterial({ color: MAP_THREE_PALETTE.sea, roughness: 0.86, metalness: 0, toneMapped: false });
  // Tiny world-space surface variation, not large painted current lines.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec2 vSeaPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\nvSeaPosition = (modelMatrix * vec4(position, 1.0)).xz;");
    shader.fragmentShader = "varying vec2 vSeaPosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\nfloat ripple = sin(vSeaPosition.x * 3.1 + sin(vSeaPosition.y * 2.7))"
      + " * sin(vSeaPosition.y * 4.4 + vSeaPosition.x * 0.8);"
      + "\ndiffuseColor.rgb *= 0.98 + ripple * 0.025;");
  };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), material);
  sea.rotation.x = -Math.PI / 2;
  sea.receiveShadow = true;
  scene.add(sea);
}

function resize() {
  const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
  const aspect = width / height;
  camera.left = -BASE_VIEW_HEIGHT * aspect / 2;
  camera.right = BASE_VIEW_HEIGHT * aspect / 2;
  camera.top = BASE_VIEW_HEIGHT / 2;
  camera.bottom = -BASE_VIEW_HEIGHT / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  invalidate(true);
}

function installInputs() {
  const options = { signal: events.signal };
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    wheelAnchor = pointerNdc(event);
    velocity = addWheelImpulse(velocity, normalizeWheelPixels(event, host.clientHeight), {
      pixelsPerZoom: 430, friction: 9, maxVelocity: 4.5,
    });
    invalidate(true);
  }, { ...options, passive: false });
  canvas.addEventListener("pointerdown", (event) => {
    velocity = 0;
    pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button };
    canvas.focus({ preventScroll: true });
  }, options);
  canvas.addEventListener("pointermove", (event) => {
    pointer = pointerNdc(event);
    pointerDirty = true;
  }, options);
  canvas.addEventListener("pointerup", (event) => {
    if (pointerDown?.button === 0 && pointerDown.id === event.pointerId
      && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 5) {
      updateSelection(pick(pointerNdc(event)));
    }
    pointerDown = null;
    pointerDirty = true;
  }, options);
  window.addEventListener("pointerup", () => { pointerDown = null; }, options);
  window.addEventListener("pointercancel", () => { pointerDown = null; }, options);
  canvas.addEventListener("pointerleave", () => {
    pointerDirty = false;
    if (!selected) displayProvince(null);
  }, options);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") updateSelection(null);
  }, options);
  $("#pitch").addEventListener("input", (event) => {
    $("#pitch-value").textContent = event.target.value + "°";
    applyPitch(Number(event.target.value));
  }, options);
  $("#land-height").addEventListener("input", (event) => {
    $("#height-value").textContent = Number(event.target.value).toFixed(2);
    setThickness(Number(event.target.value));
  }, options);
  $("#exposure").addEventListener("input", (event) => {
    renderer.toneMappingExposure = Number(event.target.value);
    $("#exposure-value").textContent = Number(event.target.value).toFixed(2);
    invalidate();
  }, options);
  $("#province-lines").addEventListener("change", (event) => {
    if (land) {
      land.provinceLines.visible = event.target.checked;
      if (event.target.checked && isMeshTerrain && tiles) drapeReliefLines(land.provinceLines.geometry,(x,z)=>tiles.sample(x,z),.055);
    }
    invalidate();
  }, options);
  $("#terrain-visible").addEventListener("change", (event) => {
    tiles?.setTerrainVisible(event.target.checked);
    land?.setTerrainVisible(isMeshTerrain ? false : event.target.checked);
    if (isMeshTerrain && tiles) {
      environment?.setSurface(tiles);
      drapeReliefLines(land.provinceLines.geometry,(x,z) => tiles.sample(x,z),.055);
      if (selectedLines) drapeReliefLines(selectedLines.geometry,(x,z) => tiles.sample(x,z),.095);
      renderer.shadowMap.needsUpdate = true;
    }
    invalidate();
  }, options);
  $("#rivers-visible").addEventListener("change", (event) => {
    environment?.setRiversVisible(event.target.checked);
    tiles?.nature?.setRiversVisible(event.target.checked);
    invalidate();
  }, options);
  $("#snow-visible").addEventListener("change", (event) => {
    environment?.setSnowVisible(event.target.checked);
    invalidate();
  }, options);
  $("#shadows").addEventListener("change", (event) => {
    renderer.shadowMap.enabled = event.target.checked;
    scene.traverse((object) => { if (object.material) object.material.needsUpdate = true; });
    renderer.shadowMap.needsUpdate = true;
    invalidate(true);
  }, options);
  $("#retry-tiles").addEventListener("click", () => { tiles?.retry(); void loadEnvironment(); }, options);
  $("#reset-view").addEventListener("click", () => {
    $("#pitch").value = MAP_THREE_SETTINGS.pitch;
    $("#pitch-value").textContent = MAP_THREE_SETTINGS.pitch + "°";
    showPreset("europe");
  }, options);
  document.querySelectorAll("[data-region]").forEach((button) => button.addEventListener("click",
    () => showPreset(button.dataset.region), options));
  document.addEventListener("visibilitychange", () => { lastFrame = performance.now(); invalidate(true); }, options);
}

function frame(timestamp) {
  if (disposed) return;
  frameId = requestAnimationFrame(frame);
  const elapsed = Math.min(0.05, Math.max(0.001, (timestamp - lastFrame) / 1000));
  lastFrame = timestamp;
  if (document.hidden || contextLost) return;
  controls.update();
  if (Math.abs(velocity) > 0.015) {
    const anchor = atSurface(wheelAnchor);
    const next = advanceInertialZoom({
      zoom: Math.log2(camera.zoom), velocity, elapsedSeconds: elapsed, minZoom: 0, maxZoom: Math.log2(30),
    });
    velocity = next.velocity;
    camera.zoom = 2 ** next.zoom;
    camera.updateProjectionMatrix();
    const after = atSurface(wheelAnchor);
    if (anchor && after) {
      const offset = anchor.sub(after);
      controls.target.add(offset);
      camera.position.add(offset);
    }
    controls.update();
    invalidate(true);
  } else velocity = 0;
  if (pointerDirty && !pointerDown) {
    pointerDirty = false;
    hovering = pick(pointer);
    canvas.style.cursor = hovering ? "pointer" : "grab";
    if (!selected) displayProvince(hovering);
  }
  if (viewDirty && timestamp - lastTileUpdate >= 100) {
    lastTileUpdate = timestamp;
    viewDirty = false;
    const view = viewportBounds();
    if (view) {
      const pixelsPerUnit = host.clientHeight / BASE_VIEW_HEIGHT * camera.zoom;
      const oldRevision = tiles?.revision;
      tiles?.update(view, Math.ceil(Math.log2(pixelsPerUnit) + 2), pixelsPerUnit);
      environment?.update(pixelsPerUnit, view);
      if (terrainProfile === "atlas" && oldRevision !== tiles?.revision) {
        if (land.provinceLines.visible) drapeReliefLines(land.provinceLines.geometry,(x,z)=>tiles.sample(x,z),.055);
        if (selectedLines) drapeReliefLines(selectedLines.geometry,(x,z)=>tiles.sample(x,z),.095);
      }
      updateSun(view);
    }
    $("#three-zoom").textContent = "×" + camera.zoom.toFixed(1);
    const pitch = Math.round(THREE.MathUtils.radToDeg(controls.getPolarAngle()));
    $("#pitch").value = pitch;
    $("#pitch-value").textContent = pitch + "°";
    dirty = true;
  }
  if (dirty) {
    renderer.render(scene, camera);
    dirty = false;
    renderedFrames += 1;
  }
  if (timestamp - lastMetricUpdate >= 1000) {
    const fps = Math.round(renderedFrames * 1000 / (timestamp - lastMetricUpdate));
    $("#three-performance").textContent = (fps ? fps + " fps" : "静止")
      + " · " + renderer.info.render.calls + " 次绘制"
      + " · " + Math.round(renderer.info.render.triangles / 1000) + "k 三角形";
    renderedFrames = 0;
    lastMetricUpdate = timestamp;
  }
}

let resizeObserver;
function dispose() {
  if (disposed) return;
  disposed = true;
  if (frameId !== null) cancelAnimationFrame(frameId);
  events.abort();
  resizeObserver?.disconnect();
  tiles?.dispose();
  environment?.dispose();
  land?.dispose();
  controls?.dispose();
  scene.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  sun.shadow.map?.dispose();
  renderer?.dispose();
}

async function loadEnvironment() {
  if (disposed || environment || environmentLoading || !land) return;
  environmentLoading = true;
  try {
    const data = await loadMapEnvironment({ signal: events.signal });
    if (disposed) return;
    environment = terrainProfile === "atlas" ? new AtlasEnvironment(data, { height: thickness, surface: tiles })
      : new MapEnvironment(data, { height: thickness, surface: isMeshTerrain ? tiles : null });
    environment.setRiversVisible($("#rivers-visible").checked);
    environment.setSnowVisible($("#snow-visible").checked);
    scene.add(environment.group);
    tiles?.setEnvironment(environment);
    environmentError = "";
    invalidate(true);
  } catch {
    if (!disposed) environmentError = "自然地貌暂未加载，可点击重试。";
  } finally {
    environmentLoading = false;
    if (!disposed) showAssetStatus(tiles?.stats());
  }
}

function showAssetStatus(stats) {
  $("#asset-warning").hidden = !stats?.failed && !environmentError;
  $("#asset-warning-message").textContent = [
    stats?.failed ? stats.failed + " 张地形加载失败；保留底图。" : "", environmentError,
  ].filter(Boolean).join(" ");
}

async function start() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = MAP_THREE_SETTINGS.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.enableZoom = false; // Smooth, cursor-anchored wheel handler below.
    controls.screenSpacePanning = false;
    controls.minPolarAngle = 0.001;
    controls.maxPolarAngle = Math.PI / 3;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.addEventListener("change", () => invalidate(true));
    createOcean();
    showPreset(new URLSearchParams(window.location.search).get("region") || "europe");
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    installInputs();
    frameId = requestAnimationFrame(frame);
    window.addEventListener("pagehide", (event) => { if (!event.persisted) dispose(); });
    window.addEventListener("pageshow", () => { lastFrame = performance.now(); invalidate(true); });
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      contextLost = true;
      loading.hidden = false;
      loadingMessage.textContent = "显卡上下文丢失，等待恢复…";
    }, { signal: events.signal });
    canvas.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      loading.hidden = !!land;
      invalidate(true);
    }, { signal: events.signal });
    loadingMessage.textContent = "读取省份与海岸数据…";
    const paths = ["./assets/data/campaign-territories.geojson",
      "./assets/data/campaign-coastlines.json", "./shared/config/map-relief-regions.json"];
    const [territories, coastlines, config] = await Promise.all(paths.map(async (path) => {
      const response = await fetch(path + "?v=20260904-three-v1", { signal: events.signal });
      if (!response.ok) throw new Error("地图资源读取失败：" + path);
      return response.json();
    }));
    land = await buildLand(territories, coastlines, (progress) => {
      loadingMessage.textContent = "构建大陆与省界 · " + progress + "%";
    }, { style: terrainProfile });
    if (disposed) { land.dispose(); return; }
    land.setThickness(thickness);
    land.provinceLines.visible = $("#province-lines").checked;
    scene.add(land.group);
    const onTerrainChange = (stats) => {
      $("#three-tiles").textContent = isMeshTerrain
        ? "立体地形 · " + stats.cached + " 区块"
        : "纹理 z" + stats.zoom + " · " + stats.loaded + "/" + stats.total + " · 缓存 " + stats.cached;
      showAssetStatus(stats); renderer.shadowMap.needsUpdate = true; invalidate();
    };
    if (isMeshTerrain) {
      land.setTerrainVisible(false);
      loadingMessage.textContent = "构建山体与坡面…";
      const [fields,natureData] = await Promise.all([loadReliefFields({signal:events.signal}),
        terrainProfile === "atlas" ? loadMapNature({signal:events.signal}) : null]);
      if (disposed) return;
      tiles = terrainProfile === "atlas" ? new AtlasTerrain(scene,fields,{onChange:onTerrainChange,natureData})
        : new ReliefTerrain(scene,fields,{onChange:onTerrainChange});
      await tiles.build(events.signal);
      drapeReliefLines(land.provinceLines.geometry,(x,z) => tiles.sample(x,z),.055);
      $(".preview-attribution").textContent = "Natural Earth · Terrarium DEM · Three.js · 真实高程网格";
    } else {
      tiles = new TerrainTiles(scene, reliefRegions(config, terrainProfile), {
        anisotropy: renderer.capabilities.getMaxAnisotropy(), onChange:onTerrainChange,
      });
    }
    tiles.setThickness(thickness);
    tiles.nature?.setRiversVisible($("#rivers-visible").checked);
    void loadEnvironment();
    tiles.setTerrainVisible($("#terrain-visible").checked);
    if (isMeshTerrain) drapeReliefLines(land.provinceLines.geometry,(x,z) => tiles.sample(x,z),.055);
    land.setTerrainVisible(isMeshTerrain ? false : $("#terrain-visible").checked);
    loading.hidden = true;
    invalidate(true);
  } catch (error) {
    if (disposed) return;
    dispose();
    loading.hidden = false;
    loadingMessage.textContent = "三维预览未能启动";
    $("#three-loading small").textContent = "请确认浏览器支持 WebGL2，并检查本地地图资源。"
      + (error?.message ? " " + error.message : "");
    console.error(error);
  }
}

start();
