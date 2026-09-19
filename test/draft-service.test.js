import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DraftService } from '../server/application/draft-service.mjs';
import { DRAFT_SIZE, DRAFT_POOLS, DRAFT_VERSION, GRADE_WEIGHTS, MINIMUM_GOALKEEPERS, availableDraftPools, draftPositionCounts, draftTargetSize, hasCurrentDraftOffer } from '../shared/config/draft.mjs';

const catalog = JSON.parse(readFileSync(new URL('../assets/data/s4-player-catalog.json', import.meta.url), 'utf8'));
const seeded = (seed = 91) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function fixture(random = seeded()) {
  const account = { id: 'draft-account', draft: null, setupComplete: false };
  let saved = null, writes = 0, fail = false;
  const service = new DraftService({ catalog, random, save() { if (fail) throw Error('disk failure'); writes++; saved = structuredClone(account); } });
  return { account, service, get saved() { return saved; }, get writes() { return writes; }, failSave(value) { fail = value; } };
}

test('a new draft finishes at 33 with at least three goalkeepers and no other role quotas', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const f = fixture(seeded(seed)); f.service.start(f.account, '测试队');
    assert.deepEqual(f.account.draft.offer, []);
    for (let pick = 1; pick <= 33; pick++) {
      const draft = f.account.draft, pool = availableDraftPools(draft)[seed % availableDraftPools(draft).length];
      f.service.open(f.account, pool, pick);
      assert.equal(draft.offer.length, 3);
      assert.ok(draft.offer.every(card => card.pool === pool && DRAFT_POOLS[pool].includes(card.role) && !card.isX));
      assert.equal(new Set(draft.offer.map(card => card.id)).size, 3);
      const card = draft.offer[seed % draft.offer.length];
      f.service.choose(f.account, card.id, draft.offerId);
      assert.equal(f.account.draft.roster.length, pick);
      assert.equal(f.account.setupComplete, pick === 33);
      assert.deepEqual(f.account.draft.offer, []);
    }
    assert.equal(new Set(f.account.draft.roster.map(card => card.id)).size, DRAFT_SIZE);
    assert.ok(draftPositionCounts(f.account.draft.roster).GK >= MINIMUM_GOALKEEPERS);
    assert.deepEqual(availableDraftPools(f.account.draft), []);
    assert.equal(f.saved.setupComplete, true);
  }
});

test('front and back offers cover their three distinct roles; midfield rotates all four roles', () => {
  for (const pool of ['DEF', 'ATT']) {
    const f = fixture(); f.service.start(f.account, '均衡队'); f.service.open(f.account, pool, 1);
    assert.deepEqual(new Set(f.account.draft.offer.map(card => card.role)), new Set(DRAFT_POOLS[pool]));
  }
  const f = fixture(); f.service.start(f.account, '中场队'); f.service.open(f.account, 'MID', 1);
  const first = f.account.draft.offer.map(card => card.role);
  assert.deepEqual(first, ['LM', 'RM', 'AM']);
  f.service.choose(f.account, f.account.draft.offer[0].id, f.account.draft.offerId);
  f.service.open(f.account, 'MID', 2);
  assert.equal(new Set(f.account.draft.offer.map(card => card.role)).size, 3);
  assert.deepEqual(new Set([...first, ...f.account.draft.offer.map(card => card.role)]), new Set(DRAFT_POOLS.MID));
});

test('saved offers survive retries and reloads; switching pools and stale rounds cannot reroll them', () => {
  const f = fixture(); f.service.start(f.account, '保存队'); f.service.open(f.account, 'ATT', 1);
  const offer = structuredClone(f.account.draft.offer), offerId = f.account.draft.offerId, writes = f.writes;
  f.service.open(f.account, 'ATT', 1); assert.equal(f.writes, writes); assert.deepEqual(f.account.draft.offer, offer);
  assert.throws(() => f.service.open(f.account, 'MID', 1), /先选择/);
  const resumed = structuredClone(f.saved), service = new DraftService({ catalog });
  service.open(resumed, 'ATT', 1); assert.equal(resumed.draft.offerId, offerId); assert.deepEqual(resumed.draft.offer, offer);
  assert.throws(() => service.choose(resumed, 'foreign', offerId), /不在本次候选/);
  assert.throws(() => service.choose(resumed, offer[0].id, 'old-offer'), /候选已变化/);
  service.choose(resumed, offer[0].id, offerId); service.choose(resumed, offer[0].id, offerId);
  assert.equal(resumed.draft.roster.length, 1);
  assert.throws(() => service.open(resumed, 'ATT', 1), /进度已变化/);
  service.open(resumed, 'MID', 2); const second = resumed.draft.offerId;
  service.choose(resumed, offer[0].id, offerId); assert.equal(resumed.draft.offerId, second);
  assert.throws(() => service.choose(resumed, offer[1].id, offerId), /候选已变化/);
  assert.throws(() => service.open(resumed, '__proto__', 2), /有效的位置池/);
});

test('save failures restore start, offer, selection and final-completion state', () => {
  const f = fixture(); f.failSave(true);
  assert.throws(() => f.service.start(f.account, '回滚队'), /disk failure/); assert.equal(f.account.draft, null);
  f.failSave(false); f.service.start(f.account, '回滚队'); f.failSave(true);
  assert.throws(() => f.service.open(f.account, 'ATT', 1), /disk failure/); assert.deepEqual(f.account.draft.offer, []);
  f.failSave(false); f.service.open(f.account, 'ATT', 1);
  const before = structuredClone(f.account), selected = before.draft.offer[0]; f.failSave(true);
  assert.throws(() => f.service.choose(f.account, selected.id, before.draft.offerId), /disk failure/);
  assert.deepEqual(f.account, before); f.failSave(false);
  f.service.choose(f.account, selected.id, before.draft.offerId);
  while (f.account.draft.roster.length < 32) {
    const draft = f.account.draft;
    f.service.open(f.account, availableDraftPools(draft)[0], draft.roster.length + 1);
    f.service.choose(f.account, draft.offer[0].id, draft.offerId);
  }
  f.service.open(f.account, availableDraftPools(f.account.draft)[0], 33);
  const final = structuredClone(f.account); f.failSave(true);
  assert.throws(() => f.service.choose(f.account, final.draft.offer[0].id, final.draft.offerId), /disk failure/);
  assert.deepEqual(f.account, final); assert.equal(f.account.setupComplete, false);
});

test('candidate weights include S and substantially more A while sparse grades never cross position pools', () => {
  assert.deepEqual(GRADE_WEIGHTS, { C: .30, B: .40, A: .25, S: .05 });
  const f = fixture(), totals = { C: 0, B: 0, A: 0, S: 0 }; f.service.start(f.account, '概率队');
  for (let i = 0; i < 2000; i++) {
    for (const card of f.service.drawOffer(f.account.draft, ['GK', 'DEF', 'MID', 'ATT'][i % 4])) totals[card.grade]++;
  }
  for (const grade of Object.keys(totals)) assert.ok(Math.abs(totals[grade] / 6000 - GRADE_WEIGHTS[grade]) < .025, JSON.stringify(totals));
  const sparse = new DraftService({ catalog: catalog.filter(card => card.pool === 'GK' && card.grade === 'C'), random: () => .999 });
  const cards = sparse.drawOffer(f.account.draft, 'GK'); assert.ok(cards.every(card => card.pool === 'GK' && card.grade === 'C'));
  assert.throws(() => sparse.drawOffer(f.account.draft, 'ATT'), /暂无可选球员/);
});

test('old unfinished drafts preserve chosen cards and can complete; completed accounts are untouched', () => {
  const f = fixture(), roster = catalog.filter(card => card.role === 'GK').slice(0, 5);
  f.account.draft = { teamName: '旧队', roster: structuredClone(roster), offer: catalog.slice(0, 3) };
  f.service.start(f.account, '无需改名'); assert.equal(f.account.draft.totalPicks, 33);
  assert.deepEqual(f.account.draft.roster, roster); assert.deepEqual(f.account.draft.offer, []);
  while (!f.account.setupComplete) {
    const draft = f.account.draft;
    f.service.open(f.account, availableDraftPools(draft)[0], draft.roster.length + 1);
    f.service.choose(f.account, draft.offer[0].id, draft.offerId);
  }
  assert.equal(f.account.draft.roster.length, 33);
  assert.ok(draftPositionCounts(f.account.draft.roster).GK >= 3);
  const completed = structuredClone(f.account); f.service.start(f.account, '不能重置'); assert.deepEqual(f.account, completed);
  assert.throws(() => f.service.open(f.account, 'GK', 36), /已经完成/);
});

test('only goalkeeper minimum reserves the final slots; other roles may exceed three or stay empty', () => {
  const f = fixture(); f.service.start(f.account, '自由选人');
  for (let pick = 1; pick <= 30; pick++) {
    assert.deepEqual(availableDraftPools(f.account.draft), ['GK', 'DEF', 'MID', 'ATT']);
    f.service.open(f.account, 'ATT', pick);
    const d = f.account.draft, chosen = d.offer.find(card => card.role === 'ST') ?? d.offer[0];
    f.service.choose(f.account, chosen.id, d.offerId);
  }
  assert.ok(draftPositionCounts(f.account.draft.roster).ST > 3);
  assert.deepEqual(availableDraftPools(f.account.draft), ['GK']);
  const before = structuredClone(f.account);
  assert.throws(() => f.service.open(f.account, 'MID', 31), /3 名门将/); assert.deepEqual(f.account, before);
  for (let pick = 31; pick <= 33; pick++) {
    f.service.open(f.account, 'GK', pick);
    f.service.choose(f.account, f.account.draft.offer[0].id, f.account.draft.offerId);
  }
  const counts = draftPositionCounts(f.account.draft.roster);
  assert.equal(counts.GK, 3); assert.equal(counts.CB, 0); assert.equal(counts.AM, 0);
  assert.equal(f.account.setupComplete, true); assert.equal(f.account.draft.roster.length, 33);
});

test('a fourth goalkeeper remains selectable and no positional cap is restored', () => {
  const f = fixture(); f.service.start(f.account, '门将队');
  for (let pick = 1; pick <= 4; pick++) {
    assert.deepEqual(availableDraftPools(f.account.draft), ['GK', 'DEF', 'MID', 'ATT']);
    f.service.open(f.account, 'GK', pick);
    f.service.choose(f.account, f.account.draft.offer[0].id, f.account.draft.offerId);
  }
  assert.equal(draftPositionCounts(f.account.draft.roster).GK, 4);
});

test('v2 migration keeps a valid open pack without rerolling and corrects the previous inflated target', () => {
  const f = fixture(); f.service.start(f.account, '旧进度');
  f.service.open(f.account, 'ATT', 1);
  const id = f.account.draft.offerId, offer = structuredClone(f.account.draft.offer);
  f.account.draft.version = 2; f.account.draft.totalPicks = 35;
  assert.equal(hasCurrentDraftOffer(f.account.draft), true);
  assert.equal(draftTargetSize(f.account.draft), 33);
  f.service.choose(f.account, offer[0].id, id);
  assert.equal(f.account.draft.version, DRAFT_VERSION);
  assert.equal(f.account.draft.totalPicks, 33);
  assert.deepEqual(f.account.draft.roster, [offer[0]]);

  const saved = fixture(); saved.service.start(saved.account, '未选旧卡包'); saved.service.open(saved.account, 'MID', 1);
  saved.account.draft.version = 2;
  const original = structuredClone(saved.account.draft.offer);
  saved.service.start(saved.account, '不改名');
  assert.deepEqual(saved.account.draft.offer, original);
});

test('legacy offers cannot consume reserved goalkeeper slots and oversized legacy rosters are never deleted', () => {
  const f = fixture(), roster = structuredClone(catalog.filter(card => card.role !== 'GK' && !card.isX).slice(0, 33));
  f.account.draft = { version: 2, totalPicks: 35, roster, teamName: '旧阵容',
    offer: structuredClone(catalog.filter(card => card.pool === 'ATT').slice(0, 3)), offerPool: 'ATT', offerId: 'old' };
  assert.equal(draftTargetSize(f.account.draft), 36);
  assert.equal(hasCurrentDraftOffer(f.account.draft), false);
  assert.throws(() => f.service.choose(f.account, f.account.draft.offer[0].id, 'old'), /候选已变化/);
  f.service.open(f.account, 'GK', 34);
  assert.equal(f.account.draft.totalPicks, 36);
  assert.deepEqual(f.account.draft.roster, roster);

  const complete = fixture();
  complete.account.draft = { version: 2, totalPicks: 35, roster: structuredClone(catalog.filter(card => card.role === 'GK').slice(0, 34)), offer: [] };
  complete.service.start(complete.account, '保留旧卡');
  assert.equal(complete.account.draft.roster.length, 34);
  assert.equal(complete.account.setupComplete, true);
});

test('selection validates the goalkeeper minimum even if a saved offer contains an invalid card', () => {
  const f = fixture(); f.service.start(f.account, '兜底');
  f.account.draft.roster = structuredClone(catalog.filter(card => card.role !== 'GK' && !card.isX).slice(0, 30));
  const foreign = catalog.find(card => card.pool === 'ATT' && !f.account.draft.roster.some(p => p.id === card.id));
  f.account.draft.offer = [structuredClone(foreign)]; f.account.draft.offerId = 'invalid'; f.account.draft.offerPool = 'GK';
  const before = structuredClone(f.account);
  assert.throws(() => f.service.choose(f.account, foreign.id, 'invalid'), /至少需要 3 名门将/);
  assert.deepEqual(f.account, before);
});
