import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoastlineLods,
  coastlineLodKeyForZoom,
  simplifyCoastlineSegment,
} from "../client/map/coastline-lod.js";

test("coastline simplification preserves endpoints and removes sub-pixel bends", () => {
  const segment = [[0, 0], [0.01, 0.002], [0.02, -0.001], [0.03, 0]];
  const simplified = simplifyCoastlineSegment(segment, 0.01);
  assert.deepEqual(simplified, [[0, 0], [0.03, 0]]);
  assert.deepEqual(segment, [[0, 0], [0.01, 0.002], [0.02, -0.001], [0.03, 0]]);
});

test("coastline LOD selects overview, regional and detailed geometry by zoom", () => {
  assert.equal(coastlineLodKeyForZoom(3), "overview");
  assert.equal(coastlineLodKeyForZoom(4.74), "overview");
  assert.equal(coastlineLodKeyForZoom(4.75), "regional");
  assert.equal(coastlineLodKeyForZoom(6.74), "regional");
  assert.equal(coastlineLodKeyForZoom(6.75), "detailed");
  assert.equal(coastlineLodKeyForZoom(9), "detailed");
});

test("coastline LOD retains progressively more geometry without changing segment count", () => {
  const segment = Array.from({ length: 81 }, (_, index) => [
    index * 0.01,
    Math.sin(index / 4) * 0.03,
  ]);
  const lods = buildCoastlineLods([segment, [[1, 1], [2, 2]]]);
  assert.equal(lods.overview.length, 2);
  assert.equal(lods.regional.length, 2);
  assert.equal(lods.detailed.length, 2);
  assert.ok(lods.overview[0].length <= lods.regional[0].length);
  assert.ok(lods.regional[0].length <= lods.detailed[0].length);
  assert.deepEqual(lods.detailed[1], [[1, 1], [2, 2]]);
});
