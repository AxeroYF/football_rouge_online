import assert from "node:assert/strict";
import test from "node:test";
import {
  addWheelImpulse,
  advanceInertialZoom,
  createInertialWheelZoom,
  normalizeWheelPixels,
} from "../client/map/inertial-wheel-zoom.js";

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  add(other) { return new Point(this.x + other.x, this.y + other.y); }
  subtract(other) { return new Point(this.x - other.x, this.y - other.y); }
  divideBy(value) { return new Point(this.x / value, this.y / value); }
}

function createHarness() {
  const listeners = new Map();
  const frames = [];
  let time = 0;
  const size = new Point(1000, 800);
  const map = {
    options: { zoomAnimation: true, zoomSnap: 0.1, maxBounds: null },
    zoom: 4,
    center: { lat: 50, lng: 10 },
    moves: [],
    animated: null,
    moveEnded: null,
    firedEvents: [],
    nativeWheelDisabled: false,
    scrollWheelZoom: { disable() { map.nativeWheelDisabled = true; } },
    getSize: () => size,
    getZoom() { return this.zoom; },
    getMinZoom: () => 3,
    getMaxZoom: () => 9,
    getCenter() { return this.center; },
    project(latlng, zoom) {
      const scale = 2 ** zoom;
      return new Point(latlng.lng * scale, latlng.lat * scale);
    },
    unproject(point, zoom) {
      const scale = 2 ** zoom;
      return { lat: point.y / scale, lng: point.x / scale };
    },
    containerPointToLatLng(point) {
      const projectedCenter = this.project(this.center, this.zoom);
      return this.unproject(projectedCenter.add(point.subtract(size.divideBy(2))), this.zoom);
    },
    latLngToContainerPoint(latlng) {
      return this.project(latlng, this.zoom).subtract(this.project(this.center, this.zoom)).add(size.divideBy(2));
    },
    mouseEventToContainerPoint(event) { return new Point(event.clientX, event.clientY); },
    _stop() {},
    _moveStart() {},
    _move(center, zoom) {
      this.center = center;
      this.zoom = zoom;
      this.moves.push({ center, zoom });
    },
    _moveEnd(zoomChanged) { this.moveEnded = zoomChanged; },
    fire(type) { this.firedEvents.push(type); },
    _limitZoom(zoom) { return Math.round(Math.max(3, Math.min(9, zoom)) * 10) / 10; },
    _animateZoom(center, zoom) {
      this.center = center;
      this.zoom = zoom;
      this.animated = { center, zoom };
    },
  };
  const element = {
    clientHeight: 800,
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const controller = createInertialWheelZoom({
    map,
    element,
    requestFrame(callback) { frames.push(callback); return frames.length; },
    cancelFrame() {},
    now: () => time,
  });
  return {
    controller,
    map,
    wheel(deltaY, clientX = 700, clientY = 300) {
      let prevented = false;
      listeners.get("wheel")({ deltaY, deltaMode: 0, clientX, clientY, preventDefault() { prevented = true; } });
      return prevented;
    },
    runFrame(milliseconds = 16) {
      time += milliseconds;
      const callback = frames.shift();
      callback?.(time);
    },
    pendingFrames: () => frames.length,
  };
}

test("wheel deltas normalize across pixel, line, and page modes", () => {
  assert.equal(normalizeWheelPixels({ deltaY: 12, deltaMode: 0 }), 12);
  assert.equal(normalizeWheelPixels({ deltaY: 3, deltaMode: 1 }), 48);
  assert.equal(normalizeWheelPixels({ deltaY: 1, deltaMode: 2 }, 720), 720);
});

test("wheel impulses are directional, bounded, and responsive to reversal", () => {
  assert.ok(addWheelImpulse(0, -120) > 0);
  assert.ok(addWheelImpulse(0, 120) < 0);
  assert.equal(addWheelImpulse(100, -120), 6.25);
  assert.ok(addWheelImpulse(4, 120) < 4);
});

test("inertial integration decays smoothly and stops at zoom limits", () => {
  const next = advanceInertialZoom({
    zoom: 4,
    velocity: 4,
    elapsedSeconds: 0.016,
    minZoom: 3,
    maxZoom: 9,
  });
  assert.ok(next.zoom > 4);
  assert.ok(next.velocity > 0 && next.velocity < 4);
  assert.deepEqual(
    advanceInertialZoom({ zoom: 9, velocity: 4, elapsedSeconds: 0.016, minZoom: 3, maxZoom: 9 }),
    { zoom: 9, velocity: 0 },
  );
});

test("controller disables stepped wheel zoom and keeps the cursor anchor stable", () => {
  const harness = createHarness();
  const anchorBefore = harness.map.containerPointToLatLng(new Point(700, 300));
  assert.equal(harness.map.nativeWheelDisabled, true);
  assert.equal(harness.wheel(-120), true);
  assert.equal(harness.controller.isActive(), true);

  harness.runFrame();
  assert.ok(harness.map.zoom > 4);
  const anchorAfter = harness.map.containerPointToLatLng(new Point(700, 300));
  assert.ok(Math.abs(anchorAfter.lat - anchorBefore.lat) < 1e-9);
  assert.ok(Math.abs(anchorAfter.lng - anchorBefore.lng) < 1e-9);

  for (let index = 0; index < 100 && harness.pendingFrames(); index += 1) harness.runFrame();
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.map.moveEnded, true);
  assert.deepEqual(harness.map.firedEvents, ["viewreset"]);
  assert.equal(harness.map.animated, null);
  assert.equal(harness.map.zoom, harness.map.moves.at(-1).zoom);
});
