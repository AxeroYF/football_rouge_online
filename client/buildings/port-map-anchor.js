import { territoryPointToDisplay } from "../map/campaign-map-geometry.js";

export function portMapAnchor(metadata, coastlines = []) {
  const origin = metadata?.buildAnchor ?? metadata?.centroid;
  if (!origin) return null;
  const center = territoryPointToDisplay(origin, metadata.region);
  let best = null, distance = Infinity;
  for (const line of coastlines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    if (![...a, ...b].every(Number.isFinite) || (a[0] === b[0] && a[1] === b[1])) continue;
    const point = territoryPointToDisplay([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], metadata.region);
    const score = (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2;
    if (score < distance) { best = point; distance = score; }
  }
  return best;
}
