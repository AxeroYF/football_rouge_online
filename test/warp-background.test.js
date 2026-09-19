import test from 'node:test';
import assert from 'node:assert/strict';
import { createWarpBackground } from '../client/ui/warp-background.js';

function events() { const handlers = new Map(); return { handlers, addEventListener: (key, fn) => handlers.set(key, fn), removeEventListener: key => handlers.delete(key), fire: key => handlers.get(key)?.() }; }
test('opening warp uses one bounded canvas and pauses for hidden tabs, reduced motion and destruction', () => {
  const doc = { ...events(), hidden: false }, reduced = { ...events(), matches: false }, frames = new Map();
  let frameId = 0, paints = 0, disconnected = false;
  const context = { setTransform() {}, fillRect() { paints++; }, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) };
  const win = { ...events(), devicePixelRatio: 3, matchMedia: () => reduced, requestAnimationFrame(fn) { frames.set(++frameId, fn); assert.ok(frames.size <= 1); return frameId; }, cancelAnimationFrame: id => frames.delete(id), ResizeObserver: class { observe() {} disconnect() { disconnected = true; } } };
  const canvas = { isConnected: true, width: 1, height: 1, getContext: () => context, getBoundingClientRect: () => ({ width: 2560, height: 1440 }) };
  const controller = createWarpBackground(canvas, { document: doc, window: win });
  assert.ok(canvas.width <= 1280 && canvas.height <= 900); assert.equal(frames.size, 1);
  const tick = time => { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(time); };
  tick(0); const before = paints; tick(16); assert.equal(paints, before); tick(34); assert.ok(paints > before);
  doc.hidden = true; doc.fire('visibilitychange'); assert.equal(frames.size, 0);
  doc.hidden = false; doc.fire('visibilitychange'); assert.equal(frames.size, 1);
  reduced.matches = true; reduced.fire('change'); assert.equal(frames.size, 0);
  reduced.matches = false; reduced.fire('change'); assert.equal(frames.size, 1);
  win.fire('pagehide'); assert.equal(frames.size, 0); win.fire('pageshow'); assert.equal(frames.size, 1);
  controller.destroy(); assert.equal(frames.size, 0); assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
  assert.equal(doc.handlers.size, 0); assert.equal(win.handlers.size, 0); assert.equal(reduced.handlers.size, 0); assert.equal(disconnected, true);
});
