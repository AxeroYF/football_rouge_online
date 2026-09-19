import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createDraftController, draftMarkup, draftBackgroundMarkup } from '../client/draft/draft-controller.js';
import { DRAFT_ROLES, draftPositionCounts } from '../shared/config/draft.mjs';

const cards = ['LW', 'ST', 'RW'].map((role, i) => ({ id: 'player-' + i, name: '测试球员' + i, role, pool: 'ATT', grade: i === 0 ? 'S' : 'A', overall: 90 }));
const draft = { teamName: '测试俱乐部', roster: [], offer: [], offerId: null, offerPool: null, pickNumber: 1, totalPicks: 33, positionCounts: draftPositionCounts([]), availablePools: ['GK', 'DEF', 'MID', 'ATT'] };
const opened = () => ({ ...structuredClone(draft), offer: cards, offerId: 'offer-1', offerPool: 'ATT' });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ manualReveal = false } = {}) {
  const requests = [], states = [], listeners = {}, classes = new Set(), reveals = [], docListeners = {};
  let markup = '', buttons = [], writes = 0;
  const message = { textContent: '', hidden: true };
  const content = { setAttribute() {}, querySelectorAll: () => buttons,
    querySelector: selector => selector === '.draft-error' ? message : selector === '.draft-panel' ? { setAttribute() {} } : {} };
  Object.defineProperty(content, 'innerHTML', { get: () => markup, set(value) {
    writes++; markup = value; buttons = [...value.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => ({ disabled: /(?:^|\s)disabled(?:\s|$)/.test(attributes),
      dataset: Object.fromEntries([...attributes.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, key, val]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), val])) }));
  } });
  const doc = { hidden: false, addEventListener: (type, fn) => docListeners[type] = fn, removeEventListener: type => delete docListeners[type] };
  const root = { classList: { add: key => classes.add(key), remove: (...keys) => keys.forEach(key => classes.delete(key)), toggle: (key, yes) => yes ? classes.add(key) : classes.delete(key) },
    innerHTML: '', querySelector: () => content,
    addEventListener: (type, fn) => listeners[type] = fn, removeEventListener: type => delete listeners[type] };
  const controller = createDraftController({ root, document: doc,
    request: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
    onState(state) { states.push(state); if (state.setupComplete) controller.destroy(); else controller.render(state.draft); },
    revealFactory(offer, ready) { const reveal = { ready, destroyed: false, destroy() { this.destroyed = true; } }; reveals.push(reveal); if (!manualReveal) ready(); return reveal; },
  });
  controller.render(structuredClone(draft));
  const click = (key, value) => { const button = buttons.find(b => b.dataset[key] === value); assert.ok(button); return listeners.click({ target: { closest: () => button } }); };
  return { controller, root, content, message, requests, states, classes, listeners, doc, docListeners, reveals, click, get writes() { return writes; } };
}

test('line totals appear above eleven actual position counts, with no quota or small print', () => {
  const markup = draftMarkup({ ...draft, roster: cards, positionCounts: draftPositionCounts(cards) });
  assert.equal((markup.match(/data-draft-pool=/g) ?? []).length, 4);
  assert.equal((markup.match(/class="draft-line-total"/g) ?? []).length, 4);
  for (const role of DRAFT_ROLES) assert.match(markup, new RegExp('<span>' + role + '</span><b>' + (cards.some(c => c.role === role) ? 1 : 0) + '</b>'));
  assert.match(markup, /<div class="draft-line-total"><span>前场<\/span><b>3<\/b><\/div><div class="draft-position-counts">/);
  assert.match(markup, /3 人，共 33 人/);
  assert.doesNotMatch(markup, /line-requirements|\/ 2|\/ 3<|永久|<small|初始建队/);
  const offer = draftMarkup(opened());
  assert.equal((offer.match(/data-player-card-action="draft-select"/g) ?? []).length, 3);
  assert.equal((offer.match(/class="draft-card-back" aria-hidden="true"/g) ?? []).length, 3);
  assert.doesNotMatch(offer, /data-draft-pool=|data-card-motion=|data-card-render=/);
  assert.match(offer, /shield-card-information/);
});

test('opening and choosing lock concurrent clicks, preserve the reveal DOM, and return to pools', async () => {
  const f = fixture(), background = f.root.innerHTML;
  const pending = f.click('draftPool', 'ATT'); f.click('draftPool', 'ATT');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].options.body, { pool: 'ATT', pickNumber: 1 });
  f.requests[0].resolve({ state: { draft: opened(), setupComplete: false } }); await pending;
  assert.equal(f.writes, 2, 'response and finally must not rebuild the offer twice');
  f.controller.render(opened()); assert.equal(f.writes, 2); assert.equal(f.reveals.length, 1);
  const choose = f.click('playerCardId', 'player-0'); f.click('playerCardId', 'player-0');
  assert.equal(f.requests.length, 2); assert.equal(f.writes, 2, 'pending keeps the same decoded images');
  assert.deepEqual(f.requests[1].options.body, { playerId: 'player-0', offerId: 'offer-1' });
  f.requests[1].resolve({ state: { setupComplete: false, draft: { ...draft, roster: [cards[0]], positionCounts: draftPositionCounts([cards[0]]), pickNumber: 2 } } }); await choose;
  assert.equal(f.writes, 3); assert.equal(f.reveals[0].destroyed, true);
  assert.match(f.content.innerHTML, /data-draft-pool="ATT"/);
  assert.match(f.content.innerHTML, /<span>LW<\/span><b>1<\/b>/);
  assert.doesNotMatch(f.content.innerHTML, /draft-select/);
  assert.equal(f.root.innerHTML, background, 'meteors persist between rounds');
});

test('lost responses restore a saved offer and retries never replay its reveal', async () => {
  const f = fixture(), opening = f.click('draftPool', 'ATT');
  f.requests[0].reject(Error('connection lost')); await flush();
  assert.equal(f.requests[1].path, '/api/campaign/state');
  f.requests[1].resolve({ state: { draft: opened() } }); await opening;
  assert.equal(f.message.textContent, 'connection lost');
  const choose = f.click('playerCardId', 'player-1'); f.requests[2].reject(Error('offline')); await flush();
  f.requests[3].resolve({ state: { draft: opened() } }); await choose;
  assert.equal(f.writes, 2); assert.equal(f.reveals.length, 1);
  const retry = f.click('playerCardId', 'player-1');
  f.requests[4].reject(Error('offline')); await flush(); f.requests[5].reject(Error('still offline')); await retry;
  assert.equal(f.writes, 2); assert.equal(f.message.textContent, 'offline');
  const final = f.click('playerCardId', 'player-1');
  assert.deepEqual(f.requests[6].options.body, f.requests[2].options.body);
  f.requests[6].resolve({ state: { setupComplete: true } }); await final;
  assert.equal(f.classes.has('is-drafting'), false); assert.equal(f.root.innerHTML, '');
});

test('selection waits for the reveal and the next offer gets exactly one fresh animation', async () => {
  const f = fixture({ manualReveal: true });
  f.controller.render(opened()); f.click('playerCardId', 'player-0');
  assert.equal(f.requests.length, 0);
  f.reveals[0].ready();
  const choose = f.click('playerCardId', 'player-0');
  f.requests[0].resolve({ state: { draft: { ...draft, roster: [cards[0]], positionCounts: draftPositionCounts([cards[0]]) } } }); await choose;
  f.controller.render({ ...opened(), offerId: 'offer-2' });
  assert.equal(f.reveals.length, 2); assert.equal(f.reveals[0].destroyed, true);
  f.controller.destroy(); assert.equal(f.reveals[1].destroyed, true);
});

test('background pauses when hidden; destruction ignores late responses and removes handlers and effects', async () => {
  const f = fixture(), pending = f.click('draftPool', 'MID');
  assert.equal((f.root.innerHTML.match(/--meteor-x:/g) ?? []).length, 16);
  assert.doesNotMatch(f.root.innerHTML, /canvas|warp/);
  f.doc.hidden = true; f.docListeners.visibilitychange(); assert.ok(f.classes.has('is-motion-paused'));
  f.doc.hidden = false; f.docListeners.visibilitychange(); assert.ok(!f.classes.has('is-motion-paused'));
  f.controller.destroy(); f.controller.destroy();
  f.requests[0].resolve({ state: { draft: opened() } }); await pending;
  assert.equal(f.states.length, 0); assert.deepEqual(f.listeners, {}); assert.deepEqual(f.docListeners, {});
  assert.equal(f.root.innerHTML, '');
});

test('reserved goalkeeper slots disable only non-GK pools; emit offline CSS review fixtures', () => {
  const partial = { ...draft, roster: cards, positionCounts: draftPositionCounts(cards), availablePools: ['GK'] };
  assert.match(draftMarkup(partial), /data-draft-pool="ATT" disabled/);
  assert.doesNotMatch(draftMarkup(partial), /data-draft-pool="GK" disabled/);
  assert.doesNotMatch(draftMarkup(partial), /已完成/);
  const path = process.env.DRAFT_REVIEW_OUTPUT;
  if (path) {
    mkdirSync(path, { recursive: true });
    for (const [name, data] of [['pools', draft], ['offer', opened()], ['partial', partial]]) {
      const background = draftBackgroundMarkup().replace('<div class="draft-content" data-draft-content></div>', '<div class="draft-content">' + draftMarkup(data) + '</div>');
      const markup = '<!doctype html><html lang="zh-CN" data-ui-theme="club"><body><main class="map-stage"><div id="campaign-entry" class="is-drafting">' + background + '</div></main></body></html>';
      writeFileSync(path + '/' + name + '.html', markup);
    }
  }
});
