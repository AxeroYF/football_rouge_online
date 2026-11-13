import test from 'node:test';
import assert from 'node:assert/strict';
import {createPackOpeningEffects} from '../versus/public/pack-opening.js';
import {createGameSettings} from '../versus/public/game-settings.js';

class Classes extends Set {
  add(...names) { names.forEach(name => super.add(name)); }
  remove(...names) { names.forEach(name => this.delete(name)); }
  toggle(name, enabled) { if (enabled) this.add(name); else this.delete(name); }
}

function fixture({reduced = true, stored = null, storageFails = false, central = false} = {}) {
  const media = new EventTarget();
  media.matches = reduced;
  const doc = new EventTarget();
  doc.hidden = false;
  const frames = new Map(), timers = new Map(), storage = new Map();
  if (stored !== null) storage.set('yffm1_pack_opening_motion_v1', stored);
  let sequence = 0;
  const env = {
    matchMedia: () => media,
    localStorage: {
      getItem: key => { if (storageFails) throw new Error('storage blocked'); return storage.get(key); },
      setItem: (key, value) => { if (storageFails) throw new Error('storage blocked'); storage.set(key, value); },
    },
    requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: id => timers.delete(id),
  };
  doc.defaultView = env;
  const cards = Array.from({length:3}, (_, index) => {
    const button = {disabled:false, attributes:new Map(), setAttribute(key, value) { this.attributes.set(key, value); }, removeAttribute(key) { this.attributes.delete(key); }};
    const status = {textContent:'请选择'};
    const player = {id:`player-${index}`};
    return {
      classList:new Classes(), dataset:{packPlayerId:String(index)},
      style:{setProperty() {}}, button, status, player,
      querySelector: selector => selector === '[data-s4-pack-choice]' ? button : selector === '.inventory-owned-status' ? status : selector === '.s4-player-card' ? player : null,
      querySelectorAll: () => [],
    };
  });
  const select = {value:'system'}, status = {textContent:''};
  const root = new EventTarget();
  Object.assign(root, {
    ownerDocument:doc, isConnected:true, classList:new Classes(), dataset:{},
    setAttribute() {},
    querySelector: selector => selector === '[data-pack-opening-motion]' ? select : selector === '[data-pack-opening-motion-status]' ? status : null,
    querySelectorAll: selector => selector.endsWith('.is-revealing') ? cards.filter(card => card.classList.has('is-revealing')) : cards,
  });
  const settings = central ? createGameSettings(env) : null;
  const effects = createPackOpeningEffects(root, env, settings);
  const change = value => {
    const event = new Event('change');
    Object.defineProperty(event, 'target', {value:{value, matches: selector => selector === '[data-pack-opening-motion]'}});
    root.dispatchEvent(event);
  };
  const animate = async () => {
    await new Promise(resolve => setImmediate(resolve));
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
  };
  return {root, media, doc, cards, effects, change, animate, frames, timers, storage, select, status, settings};
}

test('system preference explains reduced motion and leaves cards usable', () => {
  const f = fixture();
  f.effects.reveal();
  assert.equal(f.effects.motionPreference, 'system');
  assert.equal(f.root.dataset.packMotionActive, 'false');
  assert.equal(f.status.textContent, '系统已关闭动画');
  assert.ok(f.cards.every(card => card.classList.has('is-revealed')));
  assert.equal(f.effects.select('0'), true);
  assert.ok(f.cards.every(card => card.button.disabled));
  f.effects.destroy();
});

test('explicit on overrides reduced motion, starts card reveals and persists locally', async () => {
  const f = fixture();
  f.effects.reveal();
  f.change('on');
  await f.animate();
  assert.equal(f.root.dataset.packMotionActive, 'true');
  assert.equal(f.root.classList.has('is-motion-paused'), false);
  assert.ok(f.cards.every(card => card.classList.has('is-revealing')));
  assert.equal(f.storage.get('yffm1_pack_opening_motion_v1'), 'on');
  assert.match(f.effects.motionControlMarkup(), /value="on" selected/);
  const next = fixture({stored:f.storage.get('yffm1_pack_opening_motion_v1')});
  assert.equal(next.root.dataset.packMotionActive, 'true');
  f.effects.destroy(); next.effects.destroy();
});

test('explicit off remains off when the system enables animations', () => {
  const f = fixture({reduced:false, stored:'off'});
  f.media.dispatchEvent(new Event('change'));
  assert.equal(f.root.dataset.packMotionActive, 'false');
  assert.equal(f.status.textContent, '动画已关闭');
  f.change('system');
  assert.equal(f.root.dataset.packMotionActive, 'true');
  f.media.matches = true;
  f.media.dispatchEvent(new Event('change'));
  assert.equal(f.root.dataset.packMotionActive, 'false');
  f.effects.destroy();
});

test('changing animation settings cannot reset an in-flight claim or replay a claimed offer', async () => {
  const f = fixture();
  f.effects.reveal();
  assert.equal(f.effects.select('1'), true);
  f.change('on');
  await f.animate();
  assert.equal(f.effects.busy, true);
  assert.equal(f.effects.selectedPlayerId, '1');
  assert.ok(f.cards.every(card => card.button.disabled));
  assert.equal(f.effects.select('2'), false);
  assert.equal(f.effects.confirm(), f.cards[1].player);
  f.change('off'); f.change('on');
  await f.animate();
  assert.equal(f.root.dataset.packOpeningComplete, 'true');
  assert.equal(f.cards[1].status.textContent, '已获得');
  assert.ok(f.cards.every(card => !card.classList.has('is-revealing')));
  f.effects.destroy();
});

test('disabling motion cancels pending reveals; hidden pages still pause explicit-on effects', async () => {
  const f = fixture({reduced:false});
  f.effects.reveal(); f.change('off');
  await f.animate();
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.ok(f.cards.every(card => !card.classList.has('is-revealing')));
  f.change('on');
  await f.animate();
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.root.classList.has('is-motion-paused'), true);
  assert.equal(f.frames.size + f.timers.size, 0);
  f.doc.hidden = false;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.root.classList.has('is-motion-paused'), false);
  f.effects.destroy();
});

test('blocked storage, invalid stored values and destroyed scenes remain safe', async () => {
  for (const options of [{storageFails:true}, {stored:'invalid'}]) {
    const f = fixture(options);
    assert.equal(f.effects.motionPreference, 'system');
    f.change('on');
    await f.animate();
    assert.equal(f.root.dataset.packMotionActive, 'true');
    f.effects.destroy();
    f.change('off');
    assert.equal(f.effects.motionPreference, 'on');
    assert.equal(f.frames.size + f.timers.size, 0);
  }
});

test('the unified settings and the opening shortcut stay in sync without leaking scene listeners', async () => {
  const f = fixture({central:true});
  f.effects.reveal();
  f.settings.update({packMotion:'on'});
  await f.animate();
  assert.equal(f.select.value, 'on');
  assert.equal(f.root.dataset.packMotionActive, 'true');
  assert.ok(f.cards.every(card => card.classList.has('is-revealing')));
  f.change('off');
  assert.equal(f.settings.value.packMotion, 'off');
  assert.equal(f.root.dataset.packMotionActive, 'false');
  f.effects.destroy();
  f.settings.update({packMotion:'on'});
  assert.equal(f.root.dataset.packMotionActive, 'false');
  f.settings.destroy();
});
