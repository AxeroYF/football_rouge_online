import test from 'node:test';
import assert from 'node:assert/strict';
import { createV22DemoAccounts } from '../engine/v2.2/demo-fixture.mjs';
import { buildAccountMatchSeat } from '../shared/football/account-match-seat.mjs';
import { prepareV22Match } from '../engine/v2.2/v21-adapter.mjs';
import { V22HybridMatch } from '../engine/v2.2/hybrid-engine.js';
import { V22_SLIDERS } from '../engine/v2.2/tactical-controls.js';
import { selectV22Cross, v22DirectionPreference } from '../engine/v2.2/attacking-movement.js';

function savedMatch(edit = () => {}, team = 0) {
  const accounts = createV22DemoAccounts();
  const account = accounts[team], saved = account.tactics.planSnapshots.__s4V2;
  edit(saved, account.draft.roster);
  const before = structuredClone(accounts);
  const match = new V22HybridMatch(prepareV22Match(accounts.map(a => buildAccountMatchSeat(a)), { seed: 'saved-board' }));
  assert.deepEqual(accounts, before, 'reading tactics must not mutate an account');
  return match;
}
function stage(match, team = 0, x = 78, y = 58, carrierIndex = 10) {
  const own = match.players.filter(p => p.team === team);
  for (const p of match.players) {
    if (p.team !== team) { p.x = team === 0 ? 99 : 6; p.y = 8 + p.number * 4; }
    p.vx = 0; p.vy = 0;
  }
  const owner = own[carrierIndex]; owner.x = team === 0 ? x : 105 - x; owner.y = team === 0 ? y : 68 - y;
  match.possession = team; match.ball = { x: owner.x, y: owner.y, z: 0, owner: owner.id, flight: null };
  match.updateTargets(); return own;
}
const d = (p, team = 0) => team === 0 ? p.target.x : 105 - p.target.x;
const average = ns => ns.reduce((a, b) => a + b, 0) / ns.length;

test('saved fullback duties survive the account projection and generic support for both teams', () => {
  for (const team of [0, 1]) {
    const make = duty => savedMatch((s, ps) => { s.tacticalPlans.opening.playerDuties[ps[4].id] = duty; }, team);
    const overlap = make('overlappingFullback'), held = make('holdingFullback'), inverted = make('invertedFullback');
    const a = stage(overlap, team), b = stage(held, team), c = stage(inverted, team);
    assert.match(a[4].action, /套上/); assert.ok(d(a[4], team) > d(b[4], team) + 15);
    assert.match(c[4].action, /内收/); assert.ok(Math.abs(c[4].target.y - 34) < Math.abs(a[4].target.y - 34) - 12);
    assert.ok([a[2], a[3], a[6]].every(p => d(p, team) < 64), 'cover behind an overlap');
    assert.ok(d(a[1], team) < 64, 'opposite fullback stays behind');
    const before = overlap.players.map(p => [p.x, p.y]);
    overlap.possession = 1 - team; overlap.ball.owner = overlap.players.find(p => p.team !== team && !p.gk).id; overlap.updateTargets();
    assert.deepEqual(overlap.players.map(p => [p.x, p.y]), before);
    assert.doesNotMatch(a[4].action, /套上|内收中场/);
  }
});

test('a wide winger staggers the overlapping fullback; an inside forward frees the outside lane', () => {
  const make = duty => savedMatch((s, ps) => { s.tacticalPlans.opening.playerDuties[ps[10].id] = duty; });
  const inside = make('insideForward'), wide = make('bylineWinger');
  const a = stage(inside, 0, 78, 58, 7), b = stage(wide, 0, 78, 58, 7);
  assert.ok(Math.abs(a[10].target.y - 34) < Math.abs(b[10].target.y - 34) - 10);
  assert.ok(d(a[4]) > d(b[4]) + 10); assert.match(b[4].action, /等待/);
  stage(inside); stage(wide);
  assert.ok(inside.players[10].target.y < wide.players[10].target.y - 5, 'on-ball route also respects duty');
});

test('saved attacking midfielder and striker duties change run depth and reject invalid role duties', () => {
  const make = duty => savedMatch((s, ps) => {
    s.positionPresets.position1[ps[7].id] = { x: 60, y: 37 };
    s.tacticalPlans.opening.playerDuties[ps[7].id] = duty;
  });
  const runner = make('shadowStriker'), playmaker = make('advancedPlaymaker'), invalid = make('overlappingFullback');
  const a = stage(runner), b = stage(playmaker); stage(invalid);
  assert.equal(runner.plan(0).roles[a[7].sourceId], 'AM');
  assert.ok(d(a[7]) > d(b[7]) + 10); assert.match(a[7].action, /后排/); assert.match(b[7].action, /组织/);
  assert.equal(invalid.effective[0].get(a[7].sourceId).tacticalDuty, null);
  const striker = duty => savedMatch((s, ps) => { s.tacticalPlans.opening.playerDuties[ps[9].id] = duty; });
  const high = stage(striker('advancedForward')), deep = stage(striker('deepLyingForward'));
  assert.ok(d(high[9]) > d(deep[9]) + 6);
});

test('board depth and lateral position are retained instead of cancelled by block normalization', () => {
  const base = savedMatch(), pushed = savedMatch((s, ps) => {
    for (const p of ps.filter(p => p.pool !== 'GK')) s.positionPresets.position1[p.id].y -= 3;
  });
  const a = stage(base, 0, 65, 34), b = stage(pushed, 0, 65, 34);
  assert.ok(average(b.filter(p => !p.gk).map(p => d(p))) > average(a.filter(p => !p.gk).map(p => d(p))) + .2);
  const narrow = savedMatch((s, ps) => { s.positionPresets.position1[ps[5].id].x = 45; });
  const c = stage(narrow, 0, 65, 34);
  assert.ok(c[5].target.y > a[5].target.y + 3);
});

test('automatic score plan restores its saved formation, lines, dimensions and valid duties', () => {
  const match = savedMatch((s, ps) => {
    s.customPositionPresets = { position2: true };
    s.positionPresets.position2[ps[4].id] = { x: 88, y: 67 };
    s.formationLinePresets = { position2: { attack: 18, midfield: 42, defense: 67, goalkeeper: 90 } };
    s.tacticalPlans.leading = { ...s.tacticalPlans.opening, positionPreset: 'position2', triggerGoalDifference: 1, playerDuties: { [ps[4].id]: 'invertedFullback' }, tacticalDimensions: { pressing: 20 } };
  });
  match.score = [1, 0]; match.advance(5);
  assert.equal(match.planKeys[0], 'leading');
  assert.deepEqual(match.plan(0).formationLines, { attack: 18, midfield: 42, defense: 67, goalkeeper: 90 });
  const ps = stage(match);
  assert.deepEqual(match.plan(0).positions[ps[4].sourceId], { x: 88, y: 67 });
  assert.equal(match.dimensions(0).pressing, 20); assert.match(ps[4].action, /内收/);
});

test('all eight board sliders propagate through saved accounts; tempo affects actual reception timing', () => {
  for (const key of Object.keys(V22_SLIDERS)) {
    const low = savedMatch(s => { s.tacticalPlans.opening.tacticalDimensions[key] = 10; });
    const high = savedMatch(s => { s.tacticalPlans.opening.tacticalDimensions[key] = 90; });
    assert.ok(high.dimensions(0)[key] > low.dimensions(0)[key] + 60, key);
    assert.deepEqual(low.dimensions(1), high.dimensions(1));
    const a = stage(low), b = stage(high);
    if (key === 'tempo') { low.receive(a[10]); high.receive(b[10]); assert.ok(high.nextDecision < low.nextDecision - 1); }
    if (key === 'attackingWidth') assert.ok(Math.abs(b[8].target.y - 34) > Math.abs(a[8].target.y - 34));
  }
});

test('saved crossing preference produces an actual cross or cutback with offside evidence', () => {
  const make = setting => savedMatch((s, ps) => {
    s.tacticalPlans.opening.inPossessionDetails.crossing = setting;
    s.tacticalPlans.opening.playerDuties[ps[10].id] = 'bylineWinger';
  });
  const increased = make('increase'), reduced = make('reduce');
  const arrange = (m, x) => { const ps = stage(m, 0, x, 62); ps[9].x = 91; ps[9].y = 34; return ps; };
  arrange(increased, 72); arrange(reduced, 72);
  increased.decide(); reduced.decide();
  assert.equal(increased.ball.flight.type, 'cross'); assert.notEqual(reduced.ball.flight?.type, 'cross');
  assert.ok(increased.offsideSnapshot); assert.ok(increased.ball.flight.height > 2);
  const ps = arrange(reduced, 97); ps[9].x = 89; reduced.decide(); assert.equal(reduced.ball.flight.type, 'cutback');
  assert.equal(reduced.ball.flight.height, .3);
  assert.equal(selectV22Cross(ps[10], [ps[10], { ...ps[9], x: 101 }], { crossing: 'increase' }, 99), null);
});

test('saved long-shot values change shooting decisions and all directional channels rank correctly', () => {
  for (const setting of ['increase', 'reduce']) {
    const m = savedMatch(s => { s.tacticalPlans.opening.inPossessionDetails.longShots = setting; });
    const ps = stage(m, 0, 79, 34, 9);
    const defender = m.players.find(p => p.team === 1); defender.x = ps[9].x + 2; defender.y = 34;
    m.decide(); assert.equal(m.stats[0].shots, setting === 'increase' ? 1 : 0);
  }
  for (const [key, y] of Object.entries({ left: 7, leftHalf: 22, center: 34, rightHalf: 46, right: 61 })) {
    assert.ok(v22DirectionPreference(key, y) > v22DirectionPreference(key, y < 34 ? 60 : 8));
  }
});

test('all coordinated targets respect the current onside line and stay inside the pitch', () => {
  const m = savedMatch(), ps = stage(m, 0, 70, 58);
  for (const p of m.players.filter(p => p.team === 1)) p.x = p.gk ? 102 : 78;
  m.updateTargets();
  for (const p of ps.filter(p => p.id !== m.ball.owner && !p.gk)) {
    assert.ok(p.target.x <= 76.8 + 1e-8); assert.ok(p.target.y >= 2 && p.target.y <= 66);
  }
});

test('a goalkeeper holding an intercepted ball cannot be tackled into a repeated point-blank shot loop', () => {
  const m = savedMatch(), keeper = m.players.find(p => p.team === 1 && p.gk);
  keeper.x = 100; keeper.y = 34;
  const attacker = m.players.find(p => p.team === 0 && !p.gk); attacker.x = 100; attacker.y = 34.5;
  m.ball.flight = { team: 0 }; m.receive(keeper, true);
  assert.equal(m.ball.heldByKeeper, true);
  m.random = () => 0; keeper.cooldown = 0; m.nextDecision = 100; m.advance(.5);
  assert.equal(m.ball.owner, keeper.id);
  m.kick(keeper, { x: 85, y: 34 }, 'pass'); assert.equal(m.ball.heldByKeeper, false);
  assert.equal(m.ball.flight.startHeight, 1.8);
  m.moveBall(); assert.equal(m.ball.owner, null, 'nearby striker must not intercept a keeper release above foot reach');
  m.ball.flight = { team: 1 }; m.receive(keeper, true); assert.equal(m.ball.heldByKeeper, false, 'own-team backpass is not caught');
  keeper.x = 80; m.ball.flight = { team: 0 }; m.receive(keeper, true); assert.equal(m.ball.heldByKeeper, false, 'outside the penalty area');
});

test('a clear central striker chance is taken instead of an unpressured backward pass', () => {
  const m = savedMatch(), ps = stage(m, 0, 84, 34, 9);
  for (const p of m.players.filter(p => p.team === 1)) { p.x = p.gk ? 102 : 50; p.y = p.gk ? 34 : 5; }
  for (const p of ps.filter(p => p !== ps[9])) { p.x = 60; p.y = 10 + p.number * 3; }
  m.random = () => .99; m.decide();
  assert.equal(m.ball.flight?.type, 'shot'); assert.equal(m.stats[0].shots, 1);
});

test('a striker carries toward shooting range when only backward passes exist, but can release under pressure', () => {
  const m = savedMatch(), ps = stage(m, 0, 75, 34, 9);
  for (const p of m.players.filter(p => p.team === 1)) { p.x = 45; p.y = 5; }
  for (const p of ps.filter(p => p !== ps[9])) { p.x = 58; p.y = 20 + p.number; }
  m.decide(); assert.equal(m.ball.owner, ps[9].id); assert.equal(m.ball.flight, null);
  const marker = m.players.find(p => p.team === 1 && !p.gk); marker.x = 77; marker.y = 34;
  m.decide(); assert.equal(m.ball.flight?.type, 'pass');
});

test('blocked central lanes and a very narrow angle do not force speculative shots', () => {
  const m = savedMatch(), ps = stage(m, 0, 83, 34, 9);
  for (const p of m.players.filter(p => p.team === 1)) { p.x = 40; p.y = 5; }
  for (const p of ps.filter(p => p !== ps[9])) { p.x = 65; p.y = 20 + p.number; }
  const marker = m.players.find(p => p.team === 1 && !p.gk); marker.x = 88; marker.y = 34;
  m.random = () => .99; m.decide(); assert.equal(m.stats[0].shots, 0); assert.equal(m.ball.flight?.type, 'pass');
  const wide = savedMatch(s => { s.tacticalPlans.opening.inPossessionDetails.longShots = 'increase'; });
  stage(wide, 0, 98, 62, 9); wide.random = () => 0; wide.decide(); assert.equal(wide.stats[0].shots, 0);
});
