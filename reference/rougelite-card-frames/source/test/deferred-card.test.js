import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createDeferredCardController } from '../client/player-card/deferred-card-controller.js';
import { playerCardMarkup, renderDeferredCardContent } from '../client/player-card/player-card.js';

const selector = '[data-card-render]';
function harness(count = 1000) {
  const frames = new Map(), events = new Map(), intersections = [];
  let frameId = 0, mutation, renders = 0;
  const root = { querySelectorAll: () => cards };
  const cards = Array.from({ length: count }, (_, i) => {
    const surface = { innerHTML: '' }, attributes = new Map([['aria-pressed', 'false']]);
    const card = { isConnected: true, dataset: { cardRender: JSON.stringify({ id: i }), playerCardId: `instance-${i}` }, surface, attributes,
      matches: s => s === selector, querySelectorAll: () => [],
      closest: s => s === selector ? card : card.root,
      querySelector: s => s === '.shield-card-surface' ? surface : null,
      hasAttribute: k => attributes.has(k), setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k), root };
    return card;
  });
  const win = {
    requestAnimationFrame(fn) { frames.set(++frameId, fn); assert.ok(frames.size <= 1); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class {
      constructor(fn, options) { Object.assign(this, { fn, options, targets: new Set() }); intersections.push(this); }
      observe(card) { this.targets.add(card); }
      unobserve(card) { this.targets.delete(card); }
      disconnect() { this.targets.clear(); }
    },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; mutation = this; }
      observe() {} disconnect() { this.disconnected = true; }
    },
  };
  const doc = { body: root, hidden: false, querySelectorAll: () => cards,
    addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) };
  const control = createDeferredCardController({ document: doc, window: win, renderContent: value => { renders++; return `<svg>${value.id}</svg>`; } });
  const frame = () => { const [id, fn] = frames.entries().next().value ?? []; if (fn) { frames.delete(id); fn(); } };
  const drain = () => { let guard = 1000; while (frames.size && guard--) frame(); assert.ok(guard > 0); };
  const show = (items, visible = true) => {
    for (const io of intersections) io.fn(items.filter(card => io.targets.has(card)).map(target => ({ target, isIntersecting: visible })));
  };
  return { control, cards, root, doc, win, frames, events, intersections, mutation, frame, drain, show,
    fire: (key, target) => events.get(key)?.({ target }), get renders() { return renders; } };
}

test('1000 cards render in small frame batches and scrolling keeps only nearby bodies mounted', () => {
  const h = harness();
  assert.equal(h.renders, 0);
  assert.equal(h.control.inspect().tracked, 1000);
  assert.equal(h.intersections.length, 1);
  assert.equal(h.intersections[0].options.root, h.root);
  assert.equal(h.intersections[0].options.rootMargin, '320px 0px');
  h.show(h.cards.slice(0, 24)); h.frame(); assert.equal(h.renders, 6);
  h.drain(); assert.equal(h.control.inspect().mounted, 24);
  let prior = h.cards.slice(0, 24);
  for (let start = 24; start < 984; start += 24) {
    h.show(prior, false);
    assert.ok(prior.every(card => card.surface.innerHTML === ''));
    const next = h.cards.slice(start, start + 24);
    h.show(next); h.drain(); assert.equal(h.control.inspect().mounted, 24);
    assert.equal(h.control.inspect().tracked, 1000);
    prior = next;
  }
  h.show(prior, false); h.show(h.cards.slice(0, 24)); h.drain();
  assert.match(h.cards[0].surface.innerHTML, /<svg>0<\/svg>/);
  assert.equal(h.control.inspect().mounted, 24);
  h.control.destroy();
});

test('fast scrolling cancels queued work, focus hydrates and native dragging pins one card', () => {
  const h = harness(100), card = h.cards[0];
  card.attributes.set('aria-pressed', 'true');
  h.show(h.cards.slice(0, 24)); h.show(h.cards.slice(0, 24), false); h.drain();
  assert.equal(h.renders, 0);
  h.fire('focusin', card); assert.equal(h.renders, 1);
  h.show([card]); h.fire('dragstart', card); h.show([card], false);
  assert.equal(h.control.inspect().mounted, 1);
  assert.equal(card.dataset.playerCardId, 'instance-0');
  assert.equal(card.attributes.get('aria-pressed'), 'true');
  h.fire('dragend'); assert.equal(card.surface.innerHTML, '');
  h.fire('pointerdown', { querySelector: () => card });
  assert.match(card.surface.innerHTML, /<svg>0<\/svg>/);
  h.control.destroy();
});

test('hidden tabs release bodies and disconnected grids release observers and pending work', () => {
  const h = harness(72); h.show(h.cards); h.drain();
  h.doc.hidden = true; h.fire('visibilitychange');
  assert.equal(h.control.inspect().mounted, 0); assert.equal(h.frames.size, 0);
  h.doc.hidden = false; h.fire('visibilitychange'); h.drain();
  assert.equal(h.control.inspect().mounted, 72);
  for (const card of h.cards) card.isConnected = false;
  h.mutation.fn([{ target: {}, removedNodes: [h.root], addedNodes: [] }]);
  assert.deepEqual(h.control.inspect(), { tracked: 0, mounted: 0, queued: 0, observers: 0 });
  assert.equal(h.intersections[0].targets.size, 0);
  h.control.destroy(); assert.equal(h.events.size, 0); assert.equal(h.frames.size, 0);
});

test('market and warehouse scroll roots hydrate independently and ignore card-body mutations', () => {
  const h = harness(48), secondRoot = {};
  const extra = { ...h.cards[0], dataset: { cardRender: '{"id":"market"}' }, root: secondRoot, surface: { innerHTML: '' } };
  extra.closest = s => s === selector ? extra : secondRoot;
  extra.querySelector = s => s === '.shield-card-surface' ? extra.surface : null;
  h.mutation.fn([{ target: {}, addedNodes: [extra], removedNodes: [] }]);
  assert.equal(h.control.inspect().observers, 2);
  h.show([extra]); h.drain();
  assert.equal(h.control.inspect().mounted, 1);
  assert.ok(h.cards.every(c => c.surface.innerHTML === ''));
  h.mutation.fn([{ target: { closest: () => extra }, addedNodes: [{ querySelectorAll() { throw new Error('must not rescan hydrated body'); } }], removedNodes: [] }]);
  assert.equal(h.control.inspect().tracked, 49);
  h.control.destroy();
});

const decodeAttribute = value => value.replaceAll('&quot;', '"').replaceAll('&#039;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
test('deferred cards preserve full card art, information and escaping without inline animation or SVG trees', () => {
  for (const grade of ['C', 'B', 'A', 'S', 'X']) {
    const player = { playerId: 'copy', name: '球员<&"测试', sourceName: 'Test & Player', grade, overall: 90, role: 'ST', nationality: '葡萄牙', club: '皇家马德里', traits: ['测试特性'], art: { url: '/assets/test-portrait.png', x: 48, y: 53, width: 210 }, upgradeLevel: 4 };
    const eager = playerCardMarkup(player, { animated: false });
    const lazy = playerCardMarkup(player, { deferred: true, interactive: true, action: 'pick' });
    assert.doesNotMatch(lazy, /<svg|<canvas|data-card-motion|<img/);
    assert.match(lazy, /data-player-card-action="pick"/);
    assert.match(lazy, /class="shield-card-surface"><\/span>/);
    assert.match(lazy, /球员&lt;&amp;&quot;测试/);
    const payload = JSON.parse(decodeAttribute(lazy.match(/ data-card-render="([^"]+)"/)[1]));
    const surface = eager.slice(eager.indexOf('<span class="shield-card-surface">') + '<span class="shield-card-surface">'.length, -13);
    assert.equal(renderDeferredCardContent(payload), surface);
  }
});

test('collection markup stays lightweight for 1000 cards while normal details retain their animated renderer', t => {
  const cards = Array.from({ length: 1000 }, (_, i) => ({ playerId: `copy-${i}`, name: '测试球员', grade: 'S', overall: 90, role: 'ST', nationality: '葡萄牙', club: '皇家马德里', upgradeLevel: i % 9 }));
  const started = performance.now();
  const eager = cards.map(card => playerCardMarkup(card)).join('');
  const eagerMs = performance.now() - started, deferredStarted = performance.now();
  const lazy = cards.map(card => playerCardMarkup(card, { deferred: true })).join('');
  const report = { fixtureCards: cards.length, eagerBytes: Buffer.byteLength(eager), deferredBytes: Buffer.byteLength(lazy), eagerInitialImageSvgCanvasNodes: (eager.match(/<svg|<canvas|<img/g) ?? []).length, deferredInitialImageSvgCanvasNodes: (lazy.match(/<svg|<canvas|<img/g) ?? []).length, eagerMarkupMs: eagerMs, deferredMarkupMs: performance.now() - deferredStarted, note: 'Synthetic markup/observer tests; not a browser FPS measurement.' };
  t.diagnostic(JSON.stringify(report));
  if (process.env.CARD_SCROLL_REVIEW_OUTPUT) { mkdirSync(process.env.CARD_SCROLL_REVIEW_OUTPUT, { recursive: true }); writeFileSync(process.env.CARD_SCROLL_REVIEW_OUTPUT + '/performance.json', JSON.stringify(report, null, 2)); }
  assert.ok(Buffer.byteLength(lazy) < Buffer.byteLength(eager) * .5);
  assert.equal((lazy.match(/<svg|<canvas|<img/g) ?? []).length, 0);
  assert.match(playerCardMarkup(cards[0]), /data-card-motion=/);
  assert.match(playerCardMarkup(cards[0]), /shield-card-information/);
});
