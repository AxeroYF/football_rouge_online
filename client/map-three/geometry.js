import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { geometryPolygons, projectTerritoryPoint, createProvinceIndex } from "./projection.js";
import { simplifyCoastlineSegment } from "../map/coastline-lod.js";
import { shoreBandGeometry, shoreBandMaterial } from "./shore.js";
import { LAND_STENCIL_BIT, MAP_THREE_LAND } from "./settings.js";
import { buildAtlasShores } from "./atlas-shore.js";
import { WATER_STENCIL_BIT } from "./atlas-nature-model.js";
import { atlasWaterHeight } from "./atlas-style.js";

function cleanRing(ring, region) {
  const points = ring.map((point) => {
    const p = projectTerritoryPoint(point, region);
    return [p.x, p.z];
  }).filter((p) => p.every(Number.isFinite));
  let simplified = simplifyCoastlineSegment(points, 0.012);
  if (simplified.length > 1 && simplified[0][0] === simplified.at(-1)[0]
    && simplified[0][1] === simplified.at(-1)[1]) simplified.pop();
  // Tiny playable states (e.g. Vatican City) must not disappear under simplification.
  if (simplified.length < 3) {
    simplified = points.slice();
    if (simplified.length > 1 && simplified[0][0] === simplified.at(-1)[0]
      && simplified[0][1] === simplified.at(-1)[1]) simplified.pop();
  }
  return simplified.map(([x, z]) => ({ x, z }));
}

export function polygonShape(polygon) {
  // Shape's local y points north; rotate it into Three's XZ ground plane.
  let outer = polygon[0].map(({ x, z }) => new THREE.Vector2(x, -z));
  if (!THREE.ShapeUtils.isClockWise(outer)) outer = outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const ring of polygon.slice(1)) {
    let hole = ring.map(({ x, z }) => new THREE.Vector2(x, -z));
    if (THREE.ShapeUtils.isClockWise(hole)) hole = hole.reverse();
    shape.holes.push(new THREE.Path(hole));
  }
  return shape;
}

export function provinceGeometry(entry) {
  const geometry = new THREE.ShapeGeometry(entry.polygons.map(polygonShape));
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function lineGeometry(segments) {
  const positions = [];
  for (const ring of segments) {
    for (let i = 1; i < ring.length; i++) {
      positions.push(ring[i - 1].x, 0, ring[i - 1].z, ring[i].x, 0, ring[i].z);
    }
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
}

function shoreGeometry(segments) {
  const positions = [];
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1], b = segment[i];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-9) continue;
      positions.push(a.x, 0, a.z, b.x, 0, b.z, b.x, 1, b.z,
        a.x, 0, a.z, b.x, 1, b.z, a.x, 1, a.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export async function buildLand(territories, coastlines, onProgress = () => {}, { style = "relief" } = {}) {
  const entries = [], topParts = [], borders = [], coasts = [];
  let topGeometry;
  for (let i = 0; i < territories.features.length; i++) {
    const feature = territories.features[i];
    const region = feature.properties.region;
    if (!["europe", "south-america"].includes(region)) continue;
    const polygons = geometryPolygons(feature.geometry)
      .map((polygon) => polygon.map((ring) => cleanRing(ring, region)))
      .filter((polygon) => polygon[0]?.length >= 3)
      .map((polygon) => [polygon[0], ...polygon.slice(1).filter((ring) => ring.length >= 3)]);
    if (!polygons.length) continue;
    const entry = { id: feature.properties.territoryId, properties: feature.properties, polygons };
    entries.push(entry);
    const part = provinceGeometry(entry);
    // Ownership is supplied by the live business overlay, not initial metadata.
    const tint = new THREE.Color(MAP_THREE_LAND.base);
    const colors = new Float32Array(part.attributes.position.count * 3);
    for (let j = 0; j < colors.length; j += 3) tint.toArray(colors, j);
    part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    topParts.push(part);
    for (const polygon of polygons) {
      for (const ring of polygon) borders.push([...ring, ring[0]]);
    }
    for (const segment of coastlines.territories?.[entry.id]?.coastlines ?? []) {
      const projected = segment.map((point) => projectTerritoryPoint(point, region)).map((p) => [p.x, p.z]);
      let simplified = simplifyCoastlineSegment(projected, 0.012);
      // Use projected units, just like the top. Geographic degree tolerance
      // otherwise widens near Svalbard and pulls cliff edges away from land.
      if (simplified.length < 3 && projected.length > 2
        && projected[0][0] === projected.at(-1)[0] && projected[0][1] === projected.at(-1)[1]) simplified = projected;
      const coast = simplified.map(([x, z]) => ({ x, z }));
      if (coast.length >= 2) coasts.push(coast);
    }
    if (i % 35 === 0) {
      onProgress(Math.round((i + 1) / territories.features.length * 100));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  try {
    topGeometry = mergeGeometries(topParts, false);
    if (!topGeometry) throw new Error("Unable to merge land geometry");
  } finally {
    topParts.forEach((part) => part.dispose());
  }
  const top = new THREE.Mesh(topGeometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0,
    stencilWrite: true, stencilRef: LAND_STENCIL_BIT, stencilWriteMask: LAND_STENCIL_BIT,
    stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  }));
  if (style === "atlas") { top.material.stencilFunc = THREE.EqualStencilFunc; top.material.stencilFuncMask = WATER_STENCIL_BIT; }
  top.castShadow = true;
  top.receiveShadow = true;
  const sides = new THREE.Mesh(shoreGeometry(coasts), new THREE.MeshStandardMaterial({
    color: "#857348", roughness: 0.95, side: THREE.DoubleSide,
  }));
  if (style === "atlas") sides.material.color.set("#92876a");
  sides.castShadow = style !== "atlas";
  sides.receiveShadow = true;
  const provinceLines = new THREE.LineSegments(lineGeometry(borders), new THREE.LineBasicMaterial({
    color: "#d3c7a0", transparent: true, opacity: 0.22, depthWrite: false,
  }));
  provinceLines.renderOrder = 12;
  const coastLines = new THREE.LineSegments(lineGeometry(coasts), new THREE.LineBasicMaterial({
    color: "#c6b379", transparent: true, opacity: 0.55, depthWrite: false,
  }));
  coastLines.renderOrder = 13;
  if (style === "atlas") coastLines.material.opacity = .28;
  const shelves = style === "atlas" ? await buildAtlasShores(coasts) : [2.0, 0.7].map((width, index) => {
    const mesh = new THREE.Mesh(shoreBandGeometry(coasts, width), shoreBandMaterial(index));
    mesh.position.y = 0.015 + index * 0.005;
    mesh.renderOrder = index + 1;
    return mesh;
  });
  const group = new THREE.Group();
  group.add(top, sides, provinceLines, coastLines, ...shelves);
  return {
    group, entries, index: createProvinceIndex(entries), provinceLines,
    setTerrainVisible(visible) {
      // Compensate existing vertex colors so unloaded land matches flat tiles.
      const base = new THREE.Color(MAP_THREE_LAND.base);
      const flat = new THREE.Color(MAP_THREE_LAND.flat);
      if (visible) top.material.color.set(0xffffff);
      else top.material.color.setRGB(flat.r / base.r, flat.g / base.g, flat.b / base.b);
    },
    setThickness(height) {
      top.position.y = height;
      sides.scale.y = height;
      if (style === "atlas") for (const shelf of shelves) shelf.position.y = atlasWaterHeight(height) + .012;
      provinceLines.position.y = height + 0.055;
      coastLines.position.y = height + 0.06;
    },
    dispose() {
      group.removeFromParent();
      group.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
    },
  };
}
