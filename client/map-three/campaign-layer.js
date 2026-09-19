import * as THREE from "three";
import { buildLand } from "./geometry.js";
import { TerrainTiles } from "./tiles.js";
import { project, reliefRegions, WORLD_SIZE } from "./projection.js";
import { MAP_THREE_SETTINGS, MAP_THREE_LIGHTING, MAP_THREE_PALETTE } from "./settings.js";
import { MapEnvironment, loadMapEnvironment } from "./environment.js";
import { loadReliefFields } from "./relief-field.js";
import { ReliefTerrain } from "./relief-terrain.js";
import { loadMapNature } from "./atlas-nature-model.js";
import { AtlasTerrain } from "./atlas-terrain.js";
import { AtlasEnvironment } from "./atlas-environment.js";
import { ATLAS_LIGHTING, createAtlasOcean } from "./atlas-style.js";

// Leaflet remains the input/business-overlay coordinator. Its tilted CRS and
// this north-up orthographic camera describe the SAME elevated land plane.
export function syncCampaignCamera(camera, map, settings = MAP_THREE_SETTINGS) {
  const size = map.getSize();
  // Read the real container center, including Leaflet's rounded pixel origin
  // and transient drag translation, instead of the nominal stored center.
  const center = map.containerPointToLatLng(size.divideBy(2));
  const point = project(center.lng, center.lat);
  const pixelsPerUnit = map.options.crs.scale(map.getZoom()) / WORLD_SIZE;
  const halfWidth = size.x / pixelsPerUnit / 2;
  const halfHeight = size.y / pixelsPerUnit / 2;
  const pitch = settings.pitch * Math.PI / 180;
  Object.assign(camera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight, zoom: 1 });
  camera.position.set(point.x, settings.thickness + Math.cos(pitch) * 600, point.z + Math.sin(pitch) * 600);
  camera.up.set(0, 1, 0);
  camera.lookAt(point.x, settings.thickness, point.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return {
    pixelsPerUnit,
    bounds: {
      minX: point.x - halfWidth - 3, maxX: point.x + halfWidth + 3,
      minZ: point.z - halfHeight / Math.cos(pitch) - 3,
      maxZ: point.z + halfHeight / Math.cos(pitch) + 3,
    },
  };
}

function ocean(profile) {
  if (profile === "atlas") return createAtlasOcean();
  const material = new THREE.MeshStandardMaterial({ color: MAP_THREE_PALETTE.sea, roughness: 0.86, metalness: 0, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec2 vSeaPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\nvSeaPosition = (modelMatrix * vec4(position, 1.0)).xz;");
    shader.fragmentShader = "varying vec2 vSeaPosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\nfloat ripple = sin(vSeaPosition.x * 3.1 + sin(vSeaPosition.y * 2.7))"
      + " * sin(vSeaPosition.y * 4.4 + vSeaPosition.x * 0.8);\ndiffuseColor.rgb *= 0.98 + ripple * 0.025;");
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

export async function createCampaignThreeLayer({ map, element, territories, coastlines, reliefConfig, terrainProfile = "atlas",
  onProgress = () => {}, onStatus = () => {}, isAreaVisible = () => true }) {
  const settings = MAP_THREE_SETTINGS;
  const isMeshTerrain = terrainProfile === "relief" || terrainProfile === "atlas";
  const layerVisibility = { rivers: true, terrain: true, snow: true };
  const canvas = document.createElement("canvas");
  canvas.className = "campaign-three-canvas";
  canvas.setAttribute("aria-hidden", "true");
  // Sibling of the translating Leaflet mapPane, not a child of it. Geographic
  // translation is already applied by the camera; applying both would drift.
  element.prepend(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MAP_THREE_PALETTE.background);
  const camera = new THREE.OrthographicCamera(-200, 200, 150, -150, 0.1, 2200);
  let renderer, land, tiles, observer, frameId = null, tileTimer = null;
  let environment = null, environmentLoading = false, environmentError = "";
  let suspended = false, renderedFrames = 0;
  let disposed = false, contextLost = false, lastTileUpdate = -Infinity;
  let latestView = null, width = 0, height = 0, dpr = 0;
  let lastViewSignature = null, shadowsDirty = true;
  const events = new AbortController();
  const light = terrainProfile === "atlas" ? ATLAS_LIGHTING : MAP_THREE_LIGHTING;
  const sun = new THREE.DirectionalLight(light.sunColor, light.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 3;
  sun.shadow.intensity = light.shadowIntensity ?? 1;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1400;
  scene.add(new THREE.HemisphereLight(light.skyColor, light.groundColor, light.ambientIntensity), sun, sun.target, ocean(terrainProfile));

  function updateTiles() {
    tileTimer = null;
    if (suspended || disposed || contextLost || document.hidden || !latestView || !tiles) return;
    lastTileUpdate = performance.now();
    tiles.update(latestView.bounds, Math.ceil(Math.log2(latestView.pixelsPerUnit) + 2), latestView.pixelsPerUnit);
    environment?.update(latestView.pixelsPerUnit, latestView.bounds);
  }
  function scheduleTiles() {
    if (!tiles || tileTimer !== null) return;
    const delay = Math.max(0, 100 - (performance.now() - lastTileUpdate));
    tileTimer = setTimeout(updateTiles, delay);
  }
  function draw() {
    frameId = null;
    if (suspended || disposed || contextLost || document.hidden || !renderer) return;
    const size = map.getSize();
    if (size.x < 1 || size.y < 1) return;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (size.x !== width || size.y !== height || nextDpr !== dpr) {
      width = size.x; height = size.y; dpr = nextDpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
    }
    latestView = syncCampaignCamera(camera, map, settings);
    environment?.update(latestView.pixelsPerUnit, latestView.bounds);
    const bounds = latestView.bounds;
    const signature = [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, latestView.pixelsPerUnit].join(",");
    const viewChanged = signature !== lastViewSignature;
    lastViewSignature = signature;
    const x = (bounds.minX + bounds.maxX) / 2, z = (bounds.minZ + bounds.maxZ) / 2;
    sun.target.position.set(x, 0, z);
    sun.position.set(x - 150, 300, z - 100);
    const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.7 + 5;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = viewChanged || shadowsDirty;
    shadowsDirty = false;
    if (viewChanged) scheduleTiles();
    renderer.render(scene, camera);
    renderedFrames++;
  }
  function invalidate() {
    if (!suspended && !disposed && frameId === null && !document.hidden) frameId = requestAnimationFrame(draw);
  }
  function resume() {
    lastViewSignature = null;
    invalidate();
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    events.abort();
    map.off("move zoom resize viewreset", invalidate);
    map.off("unload", destroy);
    observer?.disconnect();
    if (frameId !== null) cancelAnimationFrame(frameId);
    if (tileTimer !== null) clearTimeout(tileTimer);
    tiles?.dispose();
    environment?.dispose();
    land?.dispose();
    scene.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
    sun.shadow.map?.dispose();
    renderer?.dispose();
    canvas.remove();
    element.classList.remove("has-three-terrain");
  }
  function publishStatus(stats = tiles?.stats()) {
    if (contextLost) return;
    const tileMessage = stats?.failed ? stats.failed + " 张地形加载失败，已保留底图。" : "";
    onStatus({ failed: !!(tileMessage || environmentError), message: [tileMessage, environmentError].filter(Boolean).join(" ") });
  }
  async function loadEnvironment() {
    if (disposed || environment || environmentLoading || !land) return;
    environmentLoading = true;
    try {
      const data = await loadMapEnvironment({ signal: events.signal });
      if (disposed) return;
      environment = terrainProfile === "atlas" ? new AtlasEnvironment(data, { height: settings.thickness, surface: tiles })
        : new MapEnvironment(data, { height: settings.thickness, surface: isMeshTerrain ? tiles : null });
      environment.setRiversVisible(layerVisibility.rivers);
      environment.setSnowVisible(layerVisibility.snow);
      scene.add(environment.group);
      tiles?.setEnvironment(environment);
      environmentError = "";
      invalidate();
    } catch (error) {
      if (!disposed) environmentError = "自然地貌暂未加载，可点击重试。";
    } finally {
      environmentLoading = false;
      if (!disposed) publishStatus();
    }
  }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = settings.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    element.classList.add("has-three-terrain");
    map.on("move zoom resize viewreset", invalidate);
    map.on("unload", destroy);
    observer = new ResizeObserver(invalidate);
    observer.observe(element);
    const options = { signal: events.signal };
    window.addEventListener("pagehide", (event) => { if (!event.persisted) destroy(); }, options);
    window.addEventListener("pageshow", resume, options);
    document.addEventListener("visibilitychange", resume, options);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      contextLost = true;
      onStatus({ message: "显卡渲染暂时中断，等待恢复；可刷新或切换兼容地图。", failed: true });
    }, options);
    canvas.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      lastViewSignature = null;
      shadowsDirty = true;
      onStatus({ message: "", failed: false });
      invalidate();
    }, options);
    draw();
    // Download elevation/nature while CPU-side land geometry is being built.
    // Observe errors immediately, then surface them once land can be disposed.
    const terrainResources = isMeshTerrain ? Promise.all([
      loadReliefFields({ signal: events.signal }),
      terrainProfile === "atlas" ? loadMapNature({ signal: events.signal }) : null,
    ]).then(value => ({ value }), error => ({ error })) : null;
    land = await buildLand(territories, coastlines, onProgress, { style: terrainProfile });
    if (disposed) { land.dispose(); throw new Error("地图已关闭"); }
    land.setThickness(settings.thickness);
    // Province outlines and owner/selection colors use live campaign state on
    // the aligned business layer. Do not double-paint the static preview border.
    land.provinceLines.visible = false;
    scene.add(land.group);
    const onTerrainChange = (stats) => { publishStatus(stats); shadowsDirty = true; invalidate(); };
    if (isMeshTerrain) {
      land.setTerrainVisible(false);
      const resources = await terrainResources;
      if (resources.error) throw resources.error;
      const [fields, natureData] = resources.value;
      if (disposed) throw new Error("地图已关闭");
      tiles = terrainProfile === "atlas" ? new AtlasTerrain(scene, fields, { onChange: onTerrainChange, natureData, isAreaVisible, territories })
        : new ReliefTerrain(scene, fields, { onChange: onTerrainChange });
      await tiles.build(events.signal);
    } else {
      tiles = new TerrainTiles(scene, reliefRegions(reliefConfig, terrainProfile), {
        anisotropy: renderer.capabilities.getMaxAnisotropy(), onChange: onTerrainChange,
      });
    }
    tiles.setThickness(settings.thickness);
    tiles.nature?.setRiversVisible(layerVisibility.rivers);
    // Decorations are optional and never delay login or the playable map.
    void loadEnvironment();
    lastViewSignature = null;
    shadowsDirty = true;
    invalidate();
    return {
      setSuspended(value) {
        suspended=Boolean(value);
        if(suspended){if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;if(tileTimer!==null)clearTimeout(tileTimer);tileTimer=null;}
        else resume();
      },
      refreshVisibility() { if (!disposed) { updateTiles(); invalidate(); } },
      destroy, retry: () => { tiles?.retry(); void loadEnvironment(); }, getStats: () => ({...tiles?.stats(),renderedFrames,suspended}),
      setLayerVisible(name, visible) {
        if (disposed || !Object.hasOwn(layerVisibility, name)) return;
        layerVisibility[name] = Boolean(visible);
        if (name === "terrain") tiles?.setTerrainVisible(visible);
        if (name === "terrain") {
          land?.setTerrainVisible(isMeshTerrain ? false : visible);
          if (isMeshTerrain) environment?.setSurface(tiles);
          shadowsDirty = true;
        }
        if (name === "rivers") { environment?.setRiversVisible(visible); tiles?.nature?.setRiversVisible(visible); }
        if (name === "snow") environment?.setSnowVisible(visible);
        invalidate();
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
