import { territoryPointToDisplay } from "../map/campaign-map-geometry.js";
import { TERRAIN_PROFILES } from "./terrain-profile.js";

export const WORLD_SIZE = 1024;
export const MAX_MERCATOR_LATITUDE = 85.05112878;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Match the existing Web Mercator tiles: +x east, +z south, +y up.
export function project(lng, lat) {
  const latitude = clamp(lat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  return {
    x: lng / 360 * WORLD_SIZE,
    z: -Math.asinh(Math.tan(latitude * Math.PI / 180)) / (2 * Math.PI) * WORLD_SIZE,
  };
}

export function unproject(x, z) {
  return {
    lng: x / WORLD_SIZE * 360,
    lat: Math.atan(Math.sinh(-z / WORLD_SIZE * 2 * Math.PI)) * 180 / Math.PI,
  };
}

export function projectTerritoryPoint(point, region) {
  const [lat, lng] = territoryPointToDisplay(point, region);
  return project(lng, lat);
}

export function boundsFromGeo(bounds) {
  const nw = project(bounds.west, bounds.north);
  const se = project(bounds.east, bounds.south);
  return { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z };
}

export function intersectBounds(a, b) {
  const result = {
    minX: Math.max(a.minX, b.minX), minZ: Math.max(a.minZ, b.minZ),
    maxX: Math.min(a.maxX, b.maxX), maxZ: Math.min(a.maxZ, b.maxZ),
  };
  return result.minX < result.maxX && result.minZ < result.maxZ ? result : null;
}

export function tileBounds(zoom, x, y) {
  const span = WORLD_SIZE / 2 ** zoom;
  return {
    minX: x * span - WORLD_SIZE / 2, minZ: y * span - WORLD_SIZE / 2,
    maxX: (x + 1) * span - WORLD_SIZE / 2, maxZ: (y + 1) * span - WORLD_SIZE / 2,
  };
}

export function reliefRegions(config, profile = "soft") {
  const selected = profile === "classic" ? TERRAIN_PROFILES.classic : TERRAIN_PROFILES.soft;
  return [
    {
      id: "europe",
      template: "assets/map-relief/europe-dem-overview/{z}/{x}/{y}.webp",
      bounds: boundsFromGeo({ west: -25, south: 25, east: 100, north: 74 }),
    },
    ...Object.entries(config.regions).map(([id, region]) => ({
      id, template: region.output.overview, bounds: boundsFromGeo(region.displayBounds),
    })),
  ].map((region) => ({
    ...region, profile: selected.id, version: selected.version,
    template: selected.id === "classic" ? region.template
      : "assets/map-relief/" + region.id + "-soft-relief/{z}/{x}/{y}.webp",
  }));
}

export function visibleTiles(view, regions, zoom) {
  const span = WORLD_SIZE / 2 ** zoom;
  const centerX = (view.minX + view.maxX) / 2;
  const centerZ = (view.minZ + view.maxZ) / 2;
  const result = [];
  for (const region of regions) {
    const visible = intersectBounds(view, region.bounds);
    if (!visible) continue;
    const limit = 2 ** zoom - 1;
    const x0 = clamp(Math.floor((visible.minX + WORLD_SIZE / 2) / span), 0, limit);
    const x1 = clamp(Math.ceil((visible.maxX + WORLD_SIZE / 2) / span) - 1, 0, limit);
    const y0 = clamp(Math.floor((visible.minZ + WORLD_SIZE / 2) / span), 0, limit);
    const y1 = clamp(Math.ceil((visible.maxZ + WORLD_SIZE / 2) / span) - 1, 0, limit);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const fullBounds = tileBounds(zoom, x, y);
        const bounds = intersectBounds(fullBounds, region.bounds);
        if (!bounds) continue;
        result.push({
          key: (region.profile ?? "classic") + "/" + region.id + "/" + zoom + "/" + x + "/" + y,
          region: region.id, zoom, x, y, bounds, fullBounds,
          url: "./" + region.template.replace("{z}", zoom).replace("{x}", x).replace("{y}", y)
            + "?v=" + (region.version ?? TERRAIN_PROFILES.classic.version),
          distance: ((bounds.minX + bounds.maxX) / 2 - centerX) ** 2
            + ((bounds.minZ + bounds.maxZ) / 2 - centerZ) ** 2,
        });
      }
    }
  }
  return result.sort((a, b) => a.distance - b.distance);
}

// Bound requests and GPU memory even at steep viewing angles or large screens.
export function planVisibleTiles(view, regions, requestedZoom, maximumTiles = 100) {
  let zoom = clamp(Math.round(requestedZoom), 3, 7);
  let tiles = visibleTiles(view, regions, zoom);
  while (tiles.length > maximumTiles && zoom > 3) {
    zoom -= 1;
    tiles = visibleTiles(view, regions, zoom);
  }
  return { zoom, tiles };
}

export function geometryPolygons(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z)
      && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function containsPoint(polygon, x, z) {
  return inRing(x, z, polygon[0]) && !polygon.slice(1).some((ring) => inRing(x, z, ring));
}

export function createProvinceIndex(entries, cellSize = 8) {
  const cells = new Map();
  for (const entry of entries) {
    for (const polygon of entry.polygons) {
      if (!polygon[0]?.length) continue;
      const xs = polygon[0].map((p) => p.x), zs = polygon[0].map((p) => p.z);
      const bounds = {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minZ: Math.min(...zs), maxZ: Math.max(...zs),
      };
      for (let x = Math.floor(bounds.minX / cellSize); x <= Math.floor(bounds.maxX / cellSize); x++) {
        for (let z = Math.floor(bounds.minZ / cellSize); z <= Math.floor(bounds.maxZ / cellSize); z++) {
          const key = x + ":" + z;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push({ entry, polygon, bounds });
        }
      }
    }
  }
  return {
    pick(x, z) {
      const candidates = cells.get(Math.floor(x / cellSize) + ":" + Math.floor(z / cellSize)) ?? [];
      return candidates.find(({ polygon, bounds }) => x >= bounds.minX && x <= bounds.maxX
        && z >= bounds.minZ && z <= bounds.maxZ && containsPoint(polygon, x, z))?.entry ?? null;
    },
  };
}
