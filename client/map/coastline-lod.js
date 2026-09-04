const COASTLINE_LOD_LEVELS = Object.freeze([
  Object.freeze({ key: "overview", maximumZoom: 4.75, tolerance: 0.08 }),
  Object.freeze({ key: "regional", maximumZoom: 6.75, tolerance: 0.025 }),
  Object.freeze({ key: "detailed", maximumZoom: Number.POSITIVE_INFINITY, tolerance: 0.004 }),
]);

function squaredDistance(left, right) {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  return dx * dx + dy * dy;
}

function squaredSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  const dx = end[0] - x;
  const dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const progress = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (progress > 1) {
      x = end[0];
      y = end[1];
    } else if (progress > 0) {
      x += dx * progress;
      y += dy * progress;
    }
  }

  return squaredDistance(point, [x, y]);
}

export function simplifyCoastlineSegment(segment, tolerance) {
  if (!Array.isArray(segment) || segment.length <= 2 || !(tolerance > 0)) {
    return Array.isArray(segment) ? segment.slice() : [];
  }

  const threshold = tolerance * tolerance;
  const kept = new Uint8Array(segment.length);
  const lastIndex = segment.length - 1;
  const stack = [0, lastIndex];
  kept[0] = 1;
  kept[lastIndex] = 1;

  while (stack.length) {
    const endIndex = stack.pop();
    const startIndex = stack.pop();
    let furthestIndex = -1;
    let furthestDistance = threshold;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = squaredSegmentDistance(segment[index], segment[startIndex], segment[endIndex]);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }

    if (furthestIndex < 0) continue;
    kept[furthestIndex] = 1;
    stack.push(startIndex, furthestIndex, furthestIndex, endIndex);
  }

  return segment.filter((_, index) => kept[index]);
}

export function coastlineLodKeyForZoom(zoom) {
  const normalizedZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 3;
  return COASTLINE_LOD_LEVELS.find((level) => normalizedZoom < level.maximumZoom)?.key ?? "detailed";
}

export function buildCoastlineLods(segments) {
  const source = Array.isArray(segments) ? segments.filter((segment) => Array.isArray(segment) && segment.length >= 2) : [];
  return Object.fromEntries(COASTLINE_LOD_LEVELS.map((level) => [
    level.key,
    source.map((segment) => simplifyCoastlineSegment(segment, level.tolerance)),
  ]));
}
