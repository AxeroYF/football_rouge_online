import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameSettings, DEFAULT_GAME_SETTINGS, gameSettingsMarkup, normalizeGameSettings} from '../versus/public/game-settings.js';

function environment(entries = {}, blocked = false) {
  const env = new EventTarget();
  const values = new Map(Object.entries(entries));
  env.localStorage = {
    getItem(key) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('blocked'); values.set(key, value); },
  };
  return {env, values};
}

test('settings reuse existing theme and opening preferences on first use', () => {
  const {env} = environment({yellowdogs_league_desktop_theme_v1:'dark', yffm1_pack_opening_motion_v1:'on'});
  const settings = createGameSettings(env);
  assert.deepEqual(settings.value, {...DEFAULT_GAME_SETTINGS, theme:'dark', packMotion:'on'});
  settings.destroy();
});

test('display and animation changes persist together and retain the existing keys', () => {
  const {env, values} = environment();
  const settings = createGameSettings(env);
  let changes = 0;
  const unsubscribe = settings.subscribe((next, previous) => {
    changes++;
    assert.equal(previous.compactCards, true);
    assert.equal(next.compactCards, false);
  });
  const result = settings.update({theme:'dark',uiMotion:'off',packMotion:'on',compactCards:false,stackCards:true,tacticsPieceDisplay:'cards',broadcastPieceDisplay:'cards',sidebarPinned:true});
  assert.equal(result.saved, true);
  assert.equal(changes, 1);
  assert.equal(values.get('yellowdogs_league_desktop_theme_v1'), 'dark');
  assert.equal(values.get('yffm1_pack_opening_motion_v1'), 'on');
  assert.equal(JSON.parse(values.get('yffm1_game_settings_v1')).tacticsPieceDisplay, 'cards');
  assert.equal(JSON.parse(values.get('yffm1_game_settings_v1')).uiMotion, 'off');
  assert.equal(JSON.parse(values.get('yffm1_game_settings_v1')).sidebarPinned, true);
  assert.equal(JSON.parse(values.get('yffm1_game_settings_v1')).broadcastPieceDisplay, 'cards');
  const reloaded = createGameSettings(env);
  assert.deepEqual(reloaded.value, settings.value);
  result.value.theme = 'light';
  assert.equal(settings.value.theme, 'dark');
  unsubscribe(); settings.reset();
  assert.deepEqual(settings.value, DEFAULT_GAME_SETTINGS);
  assert.equal(changes, 1);
  settings.destroy(); reloaded.destroy();
});

test('invalid and corrupted preferences fall back without touching other browser data', () => {
  assert.deepEqual(normalizeGameSettings({theme:'<script>',compactCards:'false',packMotion:'invalid',tacticsPieceDisplay:'invalid',accountToken:'secret'}), DEFAULT_GAME_SETTINGS);
  for (const raw of ['broken', 'null', 'false']) {
    const {env, values} = environment({yffm1_game_settings_v1:raw,football_test1_versus_account_v1:'existing-account'});
    const settings = createGameSettings(env);
    settings.reset();
    assert.equal(values.get('football_test1_versus_account_v1'), 'existing-account');
    settings.destroy();
  }
});

test('blocked storage keeps settings functional for the session and reports that saving failed', () => {
  const {env} = environment({}, true);
  const settings = createGameSettings(env);
  const result = settings.update({packMotion:'on',positionZones:true,tacticsPieceDisplay:'cards'});
  assert.equal(result.saved, false);
  assert.equal(settings.value.packMotion, 'on');
  assert.equal(settings.value.positionZones, true);
  assert.equal(settings.value.tacticsPieceDisplay, 'cards');
  settings.destroy();
});

test('other-tab settings changes update subscribers; disposal removes the listener', () => {
  const {env, values} = environment();
  const settings = createGameSettings(env);
  values.set('yffm1_game_settings_v1', JSON.stringify({...DEFAULT_GAME_SETTINGS, chemistryLines:false,tacticsPieceDisplay:'cards'}));
  const event = new Event('storage');
  Object.defineProperty(event, 'key', {value:'yffm1_game_settings_v1'});
  env.dispatchEvent(event);
  assert.equal(settings.value.chemistryLines, false);
  assert.equal(settings.value.tacticsPieceDisplay, 'cards');
  settings.destroy();
  values.set('yffm1_game_settings_v1', JSON.stringify(DEFAULT_GAME_SETTINGS));
  env.dispatchEvent(event);
  assert.equal(settings.value.chemistryLines, false);
});

test('settings screen contains all preferences and explains the system motion override', () => {
  const markup = gameSettingsMarkup({...DEFAULT_GAME_SETTINGS,packMotion:'on'}, {reducedMotion:true,showAccount:true});
  for (const key of Object.keys(DEFAULT_GAME_SETTINGS)) assert.ok(markup.includes(`data-game-setting="${key}"`), key);
  assert.match(markup, /系统当前已减弱动画/);
  assert.match(markup, /value="on" selected/);
  assert.match(markup, /data-game-account-settings/);
  assert.doesNotMatch(gameSettingsMarkup(DEFAULT_GAME_SETTINGS), /data-game-account-settings/);
});

test('broadcast card preference is independent of tactics and rejects unknown modes', () => {
  const {env}=environment();
  const settings=createGameSettings(env);
  settings.update({broadcastPieceDisplay:'cards'});
  assert.equal(settings.value.tacticsPieceDisplay,'magnets');
  assert.equal(createGameSettings(env).value.broadcastPieceDisplay,'cards');
  settings.update({broadcastPieceDisplay:'invalid'});
  assert.equal(settings.value.broadcastPieceDisplay,'magnets');
  settings.destroy();
});
