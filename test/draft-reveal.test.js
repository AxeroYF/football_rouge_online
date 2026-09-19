import test from 'node:test';
import assert from 'node:assert/strict';
import { revealDraftOffer } from '../client/draft/draft-reveal.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(images = [], reduced = false) {
  const classes = new Set(), events = {}, motionEvents = {}, timers = new Map(), frames = new Map();
  const flips = [{}, {}, {}]; let id = 0, calls = 0;
  const offer = { querySelectorAll: selector => selector === 'img' ? images : flips,
    classList: { add: (...keys) => keys.forEach(key => classes.add(key)), remove: (...keys) => keys.forEach(key => classes.delete(key)) },
    addEventListener: (type, fn) => events[type] = fn, removeEventListener: type => delete events[type] };
  const motion = { matches: reduced, addEventListener: (type, fn) => motionEvents[type] = fn, removeEventListener: type => delete motionEvents[type] };
  const env = { matchMedia: () => motion, requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const reveal = revealDraftOffer(offer, () => calls++, env);
  return { reveal, classes, events, motionEvents, timers, frames, flips, get calls() { return calls; },
    frame() { const all = [...frames]; frames.clear(); for (const [, fn] of all) fn(); },
    timer(delay) { const [key, timer] = [...timers].find(([, timer]) => timer.delay === delay); timers.delete(key); timer.fn(); } };
}

test('images decode before one staggered flip, and only the final card unlocks selection', async () => {
  let decode;
  const image = { decode: () => new Promise(resolve => decode = resolve) }, f = fixture([image]);
  assert.equal(image.loading, 'eager'); assert.equal(image.decoding, 'async');
  assert.ok(f.classes.has('is-loading')); assert.equal(f.frames.size, 0);
  decode(); await flush(); f.frame(); assert.ok(f.classes.has('is-revealing')); assert.equal(f.calls, 0);
  f.events.animationend({ animationName: 'other', target: f.flips[2] });
  f.events.animationend({ animationName: 'draft-flip-reveal', target: f.flips[0] }); assert.equal(f.calls, 0);
  f.events.animationend({ animationName: 'draft-flip-reveal', target: f.flips[2] });
  assert.equal(f.calls, 1); assert.equal(f.classes.size, 0); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.events, {}); assert.deepEqual(f.motionEvents, {});
});

test('failed and indefinitely loading art never blocks the draft', async () => {
  const failed = fixture([{ decode: () => Promise.reject(Error('missing')) }]);
  await flush(); failed.frame(); failed.timer(700); assert.equal(failed.calls, 1);
  let decode;
  const stalled = fixture([{ decode: () => new Promise(resolve => decode = resolve) }]);
  stalled.timer(350); stalled.frame(); stalled.timer(700); assert.equal(stalled.calls, 1);
  decode(); await flush(); assert.equal(stalled.frames.size, 0); assert.equal(stalled.calls, 1);
});

test('OS reduced motion does not skip the requested card reveal sequence', async () => {
  const f=fixture([],true);await flush();
  assert.equal(f.calls,0);assert.equal(f.frames.size,1);
  f.frame();assert.ok(f.classes.has('is-revealing'));
  f.events.animationend({animationName:'draft-flip-reveal',target:f.flips[2]});
  assert.equal(f.calls,1);assert.equal(f.timers.size,0);
});

test('closing or replacing an offer cancels image waits, frames, callbacks and animation handlers', async () => {
  let decode;
  const loading = fixture([{ decode: () => new Promise(resolve => decode = resolve) }]);
  loading.reveal.destroy(); decode(); await flush();
  assert.equal(loading.calls, 0); assert.equal(loading.frames.size, 0); assert.equal(loading.timers.size, 0);
  const queued = fixture(); await flush(); assert.equal(queued.frames.size, 1);
  queued.reveal.destroy(); assert.equal(queued.frames.size, 0);
  const active = fixture(); await flush(); active.frame(); active.reveal.destroy(); active.reveal.destroy();
  assert.equal(active.calls, 0); assert.equal(active.classes.size, 0);
  assert.equal(active.timers.size, 0); assert.deepEqual(active.events, {}); assert.deepEqual(active.motionEvents, {});
});
