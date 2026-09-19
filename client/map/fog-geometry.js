export function polygonRings(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

export function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygonRings(geometry)) for (const [lng, lat] of polygon[0] ?? []) {
    bounds[0] = Math.min(bounds[0], lng); bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng); bounds[3] = Math.max(bounds[3], lat);
  }
  return bounds.every(Number.isFinite) ? bounds : null;
}

function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInFogGeometry(point, geometry) {
  return polygonRings(geometry).some((rings) => inRing(point, rings[0]) && !rings.slice(1).some((hole) => inRing(point, hole)));
}

export function exploredBounds(features, ids) {
  const included = new Set(ids);
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features) {
    if (!included.has(feature.properties.territoryId)) continue;
    const box = geometryBounds(feature.geometry);
    if (!box) continue;
    bounds[0] = Math.min(bounds[0], box[0]); bounds[1] = Math.min(bounds[1], box[1]);
    bounds[2] = Math.max(bounds[2], box[2]); bounds[3] = Math.max(bounds[3], box[3]);
  }
  if (!bounds.every(Number.isFinite)) return null;
  // Even an isolated tiny island needs a usable viewport at the 30x cap.
  const dx = Math.max(0, (0.4 - (bounds[2] - bounds[0])) / 2);
  const dy = Math.max(0, (0.4 - (bounds[3] - bounds[1])) / 2);
  return [[bounds[1] - dy, bounds[0] - dx], [bounds[3] + dy, bounds[2] + dx]];
}
