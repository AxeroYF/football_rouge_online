import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTacticsCardDisplay, tacticsCardMarkup, TACTICS_DISPLAY_KEY } from '../client/tactics/card-display-controller.js';
import { playerCardMarkup } from '../client/player-card/player-card.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json', import.meta.url), 'utf8'));
function classes() {
  const values = new Set();
  return { toggle(name, on) { if (on) values.add(name); else values.delete(name); }, contains: name => values.has(name) };
}
function fixture(saved = null) {
  const player = { ...catalog.find(p => p.grade === 'S'), id: 'owned-instance', upgradeLevel: 4 };
  const duty = { selected: 'advancedForward' }, source = { x: 47, y: 23 };
  const node = {
    dataset: { leagueMagnet: player.id }, style: { left: '47%', top: '23%' }, classList: classes(), duty, dragHandler() {}, card: null,
    querySelector() { return this.card; },
    insertAdjacentHTML(position, html) { assert.equal(position, 'afterbegin'); this.card = { html, remove: () => { this.card = null; } }; },
  };
  const buttons = ['magnets', 'cards'].map(mode => ({ dataset: { tacticsPieceDisplay: mode }, classList: classes(),
    setAttribute(name, value) { this[name] = value; }, addEventListener(type, fn) { this[type] = fn; },
  }));
  const panel = { querySelectorAll(selector) {
    if (selector === '[data-tactics-piece-display]') return buttons;
    if (selector === '[data-league-magnet]') return [node];
    throw Error('Unexpected DOM mutation scope: ' + selector);
  }, set innerHTML(_) { throw Error('Display switch must not rebuild the tactics form'); } };
  const storage = { value: saved, getItem(key) { assert.equal(key, TACTICS_DISPLAY_KEY); return this.value; }, setItem(key, value) { assert.equal(key, TACTICS_DISPLAY_KEY); this.value = value; } };
  const getPlayer = id => id === player.id ? player : null;
  const controller = createTacticsCardDisplay({ panel, getPlayer, storage });
  return { controller, player, node, panel, buttons, storage, getPlayer, duty, source };
}

test('tactical cards use real shield portraits and upgrades without a particle canvas or sheen', () => {
  for (const grade of ['S', 'A', 'B', 'C']) {
    const p = { ...catalog.find(p => p.grade === grade), upgradeLevel: 4 };
    const html = tacticsCardMarkup(p);
    assert.match(html, /player-card-shield player-card-static tactics-shield-card/);
    assert.match(html, /shield-card-information/); assert.match(html, />\+4<\/span>/);
    assert.equal(html.includes('data-player-card-art src='), Boolean(p.portrait));
    if (p.portrait) assert.ok(html.includes(p.portrait.replace(/^\.\//, '/')));
    assert.doesNotMatch(html, /<canvas|data-card-motion=|shield-card-sheen/);
  }
  assert.match(playerCardMarkup(catalog.find(p => p.grade === 'S')), /data-card-motion=/);
});

test('switching card mode preserves drag targets, positions, duties and current shape preview coordinates', () => {
  const f = fixture(), drag = f.node.dragHandler;
  f.controller.bind(); assert.equal(f.controller.mode, 'magnets'); assert.equal(f.node.card, null);
  // The preview is showing a transient target; changing skin must not restore or save it.
  f.node.style.top = '37%'; f.node.classList.toggle('is-tactical-shape-previewing', true);
  f.buttons[1].click(); assert.equal(f.controller.mode, 'cards'); assert.ok(f.node.card.html.includes('owned-instance'));
  assert.equal(f.buttons[1]['aria-pressed'], 'true'); assert.equal(f.buttons[0]['aria-pressed'], 'false');
  assert.equal(f.node.style.top, '37%'); assert.equal(f.node.style.left, '47%');
  assert.equal(f.node.duty, f.duty); assert.equal(f.node.dragHandler, drag);
  assert.deepEqual(f.source, { x: 47, y: 23 }); assert.ok(f.node.classList.contains('is-tactical-shape-previewing'));
  const card = f.node.card; f.controller.select('cards'); assert.equal(f.node.card, card);
  f.buttons[0].click(); assert.equal(f.node.card, null); assert.equal(f.node.classList.contains('is-card-mode'), false);
  assert.equal(f.node.style.top, '37%'); assert.equal(f.node.dragHandler, drag);
});

test('display preference survives controller/board recreation without entering tactical state', () => {
  const f = fixture(); f.controller.select('cards'); assert.equal(f.storage.value, 'cards');
  f.node.card = null; // A preset/squad change rebuilt the field; next bind restores the skin.
  f.controller.bind(); assert.ok(f.node.card);
  const next = createTacticsCardDisplay(f); assert.equal(next.mode, 'cards'); next.bind();
  assert.match(next.markup(), /data-tactics-piece-display="cards" aria-pressed="true"/);
  assert.equal(f.node.duty, f.duty);
});

test('unknown preferences, absent players and blocked storage retain a usable magnet fallback', () => {
  const f = fixture('invalid'); assert.equal(f.controller.mode, 'magnets');
  const controller = createTacticsCardDisplay({ panel: f.panel, getPlayer: () => null, storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  controller.select('cards'); assert.equal(controller.mode, 'cards'); assert.equal(f.node.card, null);
  assert.equal(f.node.classList.contains('is-card-mode'), false);
  controller.select('unknown'); assert.equal(controller.mode, 'cards'); controller.select('magnets'); assert.equal(controller.mode, 'magnets');
});
