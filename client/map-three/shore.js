import * as THREE from "three";
import { simplifyCoastlineSegment } from "../map/coastline-lod.js";
import { MAP_THREE_PALETTE } from "./settings.js";

// Rounded coverage, rather than independent translucent rectangles. The stencil
// material below unions overlapping primitives, so bays/islets do not grow spikes
// or get brighter with every short source segment.
export function shoreBandGeometry(segments, width) {
  const positions = [];
  const triangle = (a, b, c) => positions.push(a.x, 0, a.z, b.x, 0, b.z, c.x, 0, c.z);
  const steps = 12;
  for (const segment of segments) {
    const points = simplifyCoastlineSegment(
      segment.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z)).map((p) => [p.x, p.z]),
      width / 8,
    ).map(([x, z]) => ({ x, z }));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-9) continue;
      const dx = -(b.z - a.z) / length * width, dz = (b.x - a.x) / length * width;
      const p = { x: a.x - dx, z: a.z - dz }, q = { x: b.x - dx, z: b.z - dz };
      const r = { x: b.x + dx, z: b.z + dz }, s = { x: a.x + dx, z: a.z + dz };
      triangle(p, q, r); triangle(p, r, s);
    }
    for (const p of points) {
      for (let i = 0; i < steps; i++) {
        const a = i / steps * Math.PI * 2, b = (i + 1) / steps * Math.PI * 2;
        triangle(p, { x: p.x + Math.cos(a) * width, z: p.z + Math.sin(a) * width },
          { x: p.x + Math.cos(b) * width, z: p.z + Math.sin(b) * width });
      }
    }
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
}

export function shoreBandMaterial(index) {
  const bit = 1 << index;
  return new THREE.MeshBasicMaterial({
    color: index ? MAP_THREE_PALETTE.innerShore : MAP_THREE_PALETTE.outerShore, transparent: true,
    toneMapped: false,
    opacity: index ? 0.18 : 0.26, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    // A separate bit for each band. Each pixel blends at most once per band,
    // independent of triangle ordering, crossings, or coastline vertex density.
    stencilWrite: true, stencilRef: bit, stencilFuncMask: bit, stencilWriteMask: bit,
    stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
}
