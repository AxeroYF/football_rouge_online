import * as THREE from "three";
import { visibleTiles, planVisibleTiles, intersectBounds } from "./projection.js";
import { LAND_STENCIL_BIT, MAP_THREE_SETTINGS } from "./settings.js";
import { applyTerrainGrade } from "./terrain-material.js";

export class TerrainTiles {
  constructor(scene, regions, { onChange = () => {}, anisotropy = 1, environment = null } = {}) {
    this.scene = scene;
    this.regions = regions;
    this.onChange = onChange;
    this.environment = environment;
    this.terrainVisibility = { value: 1 };
    this.anisotropy = Math.min(4, anisotropy);
    this.loader = new THREE.TextureLoader();
    this.records = new Map();
    this.pending = new Set();
    this.failed = new Set();
    this.queue = [];
    this.desired = new Set();
    this.height = MAP_THREE_SETTINGS.thickness;
    this.enabled = true;
    this.disposed = false;
    this.zoom = 3;
    this.base = visibleTiles({ minX: -512, minZ: -512, maxX: 512, maxZ: 512 }, regions, 3);
    this.baseKeys = new Set(this.base.map((tile) => tile.key));
  }

  update(view, requestedZoom) {
    if (this.disposed) return;
    this.view = view;
    const plan = planVisibleTiles(view, this.regions, requestedZoom, 100);
    this.zoom = plan.zoom;
    this.desired = new Set(plan.tiles.map((tile) => tile.key));
    const wanted = new Map([...this.base, ...plan.tiles].map((tile) => [tile.key, tile]));
    this.queue = [...wanted.values()]
      .filter((tile) => !this.records.has(tile.key) && !this.pending.has(tile.key) && !this.failed.has(tile.key))
      .sort((a, b) => a.zoom - b.zoom || a.distance - b.distance);
    this.refreshVisibility();
    this.pump();
  }

  refreshVisibility() {
    const waiting = [...this.desired].some((key) => !this.records.has(key));
    for (const [key, record] of this.records) {
      const fallback = waiting && record.tile.zoom < this.zoom
        && intersectBounds(record.tile.bounds, this.view);
      record.mesh.visible = this.enabled && (this.baseKeys.has(key) || this.desired.has(key) || !!fallback);
      if (record.mesh.visible) record.used = performance.now();
    }
    const evictable = [...this.records.entries()]
      .filter(([key]) => !this.baseKeys.has(key) && !this.desired.has(key))
      .sort((a, b) => Number(a[1].mesh.visible) - Number(b[1].mesh.visible) || a[1].used - b[1].used);
    while (this.records.size > 160 && evictable.length) this.remove(evictable.shift()[0]);
    this.onChange(this.stats());
  }

  pump() {
    if (!this.enabled || this.disposed) return;
    while (this.pending.size < 6 && this.queue.length) {
      const tile = this.queue.shift();
      this.pending.add(tile.key);
      this.loader.loadAsync(tile.url).then((texture) => {
        if (this.disposed || (!this.baseKeys.has(tile.key) && !this.desired.has(tile.key))) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.anisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        const { bounds, fullBounds } = tile;
        const span = fullBounds.maxX - fullBounds.minX;
        const geometry = new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i,
            (bounds.minX - fullBounds.minX + uv.getX(i) * (bounds.maxX - bounds.minX)) / span,
            (fullBounds.maxZ - bounds.maxZ + uv.getY(i) * (bounds.maxZ - bounds.minZ)) / span);
        }
        geometry.rotateX(-Math.PI / 2);
        const material = applyTerrainGrade(new THREE.MeshStandardMaterial({
          map: texture, transparent: true, alphaTest: 0.01, depthWrite: false,
          roughness: 1, metalness: 0,
          stencilWrite: true, stencilRef: LAND_STENCIL_BIT, stencilFuncMask: LAND_STENCIL_BIT,
          stencilWriteMask: 0, stencilFunc: THREE.EqualStencilFunc,
        }), this.terrainVisibility);
        this.environment?.applyTo(material, tile.region);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((bounds.minX + bounds.maxX) / 2,
          this.height + 0.025 + tile.zoom * 0.001, (bounds.minZ + bounds.maxZ) / 2);
        mesh.receiveShadow = true;
        mesh.renderOrder = 2 + tile.zoom;
        this.scene.add(mesh);
        this.records.set(tile.key, { tile, mesh, texture, used: performance.now() });
      }).catch(() => {
        if (!this.disposed) this.failed.add(tile.key);
      }).finally(() => {
        this.pending.delete(tile.key);
        if (!this.disposed) {
          this.refreshVisibility();
          this.pump();
        }
      });
    }
  }

  setThickness(height) {
    this.height = height;
    for (const record of this.records.values()) record.mesh.position.y = height + 0.025 + record.tile.zoom * 0.001;
  }

  setEnvironment(environment) {
    this.environment = environment;
    for (const { mesh, tile } of this.records.values()) environment?.applyTo(mesh.material, tile.region);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.view) this.refreshVisibility();
    this.pump();
  }

  // Keep alpha/coast clipping and snow available when terrain detail is off.
  // A shared uniform also applies to tiles arriving after the user toggled it.
  setTerrainVisible(visible) {
    this.terrainVisibility.value = visible ? 1 : 0;
  }

  retry() {
    this.failed.clear();
    if (this.view) this.update(this.view, this.zoom);
  }

  stats() {
    const wanted = new Set([...this.baseKeys, ...this.desired]);
    return {
      loaded: [...this.desired].filter((key) => this.records.has(key)).length,
      total: this.desired.size, cached: this.records.size, active: this.pending.size,
      failed: [...this.failed].filter((key) => wanted.has(key)).length, zoom: this.zoom,
    };
  }

  remove(key) {
    const record = this.records.get(key);
    if (!record) return;
    this.scene.remove(record.mesh);
    record.mesh.geometry.dispose();
    record.mesh.material.dispose();
    record.texture.dispose();
    this.records.delete(key);
  }

  dispose() {
    this.disposed = true;
    this.queue.length = 0;
    for (const key of this.records.keys()) this.remove(key);
  }
}
