import test from 'node:test';
import assert from 'node:assert/strict';
import { V22HybridMatch, STEP } from '../engine/v2.2/hybrid-engine.js';
import { createV22DemoInput } from '../engine/v2.2/demo-fixture.mjs';
import { prepareV22Match } from '../engine/v2.2/v21-adapter.mjs';
import { refactorMatchTeams } from './fixtures/refactor-match-cases.mjs';
import { buildV2TeamSnapshots } from '../engine/s4-v2.1/versus/v2/team-snapshot-v2.js';
import { tacticalDimensionsForPlan } from '../engine/s4-v2.1/versus/v2/match-engine-v2.js';
import { resolveV2TacticalDimensions } from '../engine/s4-v2.1/versus/v2/spatial-model-v2.js';
import { tacticalExecution, V22_SLIDERS } from '../engine/v2.2/tactical-controls.js';

test('V2.2 accepts unmodified V2.1 seats, preserves ownership and effective ability rules', () => {
  const seats = refactorMatchTeams();
  seats[0].players[2].attributes.passing = 135.7;
  seats[0].players[2].upgradeLevel = 8;
  const original = structuredClone(seats);
  const input = prepareV22Match(seats), match = new V22HybridMatch(input);
  const snapshots = buildV2TeamSnapshots(seats.map(t => ({ ...t, players: t.players.map(p => ({ ...p, tacticalDuty: t.tacticalPlans.opening.playerDuties?.[p.id] })) })));
  for (const p of match.players) assert.deepEqual(match.effective[p.team].get(p.sourceId).attributes, snapshots[p.team].players.find(q => q.id === p.sourceId).attributes);
  match.advance(20); assert.equal(match.players.length, 22); assert.deepEqual(seats, original);
});
test('V2.2 fixed steps are independent of presentation frame rate', () => {
  const input = createV22DemoInput(), a = new V22HybridMatch(input), b = new V22HybridMatch(input);
  a.advance(60); for (let i = 0; i < 3600; i++) b.advance(1 / 60);
  assert.deepEqual(a.players, b.players); assert.deepEqual(a.ball, b.ball); assert.deepEqual(a.score, b.score);
});
test('V2.2 match clock changes without accelerating physical motion', () => {
  const input = createV22DemoInput(), a = new V22HybridMatch(input), b = new V22HybridMatch({ ...input, duration: input.duration * 2 });
  a.advance(2); b.advance(2); assert.deepEqual(a.players, b.players); assert.equal(a.minute, b.minute * 2);
});
test('V2.2 tactic changes update shape targets without teleporting players', () => {
  const match = new V22HybridMatch(createV22DemoInput()); match.advance(8);
  const before = match.players.map(({ x, y }) => ({ x, y }));
  match.setPlan(0, 'counter'); const low = match.players.filter(p => p.team === 0 && !p.gk).map(p => ({ ...p.target }));
  match.setPlan(0, 'press'); const high = match.players.filter(p => p.team === 0 && !p.gk).map(p => p.target);
  assert.deepEqual(match.players.map(({ x, y }) => ({ x, y })), before);
  assert.ok(high.reduce((sum, p) => sum + p.x, 0) > low.reduce((sum, p) => sum + p.x, 0) + 10);
});
test('V2.2 complete six-minute match has bounded movement, finite state and active play', () => {
  const match = new V22HybridMatch(createV22DemoInput()); let maxSpeed = 0, turnovers = 0;
  for (let i = 0; i < 7200; i++) {
    const before = match.players.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy })), phase = match.phase;
    const possession = match.possession; match.advance(STEP); if (possession !== match.possession) turnovers++;
    match.players.forEach((p, index) => {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 105 && p.y >= 0 && p.y <= 68);
      if (phase === 'play' && match.phase === 'play') {
        const speed = Math.hypot(p.x - before[index].x, p.y - before[index].y) / STEP; maxSpeed = Math.max(maxSpeed, speed);
        assert.ok(speed < 8, `in-play teleport or speed: ${speed}`);
        assert.ok(Math.hypot(p.vx - before[index].vx, p.vy - before[index].vy) <= 5.3 * STEP + 1e-8);
      }
    });
  }
  assert.equal(match.minute, 90); assert.equal(match.finished, true); assert.ok(maxSpeed > 3);
  assert.ok(turnovers > 5); assert.ok(match.stats.every(s => s.passes > 10)); assert.ok(match.stats.reduce((sum, s) => sum + s.shots, 0) > 2);
});

function shapeScenario(x = 85, y = 34) {
  const match = new V22HybridMatch(createV22DemoInput());
  for (const p of match.players) {
    const base = match.plan(p.team).positions[p.sourceId];
    p.x = (p.team === 0 ? 100 - base.y : base.y) * 1.05;
    p.y = (p.team === 0 ? base.x : 100 - base.x) * .68;
  }
  const carrier = match.players.find(p => p.team === 0 && match.effective[0].get(p.sourceId).pool === 'ATT');
  carrier.x = x; carrier.y = y;
  match.possession = 0; match.ball = { x, y, z: 0, owner: carrier.id, flight: null }; match.updateTargets();
  return match;
}
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const poolPlayers = (match, team, pool) => match.players.filter(p => p.team === team && match.effective[team].get(p.sourceId).pool === pool);

test('advanced possession brings defenders across halfway and midfield within support range', () => {
  const match = shapeScenario();
  assert.ok(average(poolPlayers(match, 0, 'DEF').map(p => p.target.x)) > 50);
  assert.ok(average(poolPlayers(match, 0, 'MID').map(p => p.target.x)) > 64);
  assert.equal(match.players.filter(p => p.team === 0 && p.action.includes('接应') && Math.hypot(p.target.x - 85, p.target.y - 34) < 22).length >= 2, true);
  const protecting = match.shapes[0].players.filter(p => p.genericRole === 'CB' || p.tacticalDuty === 'anchor');
  for (const role of protecting) assert.ok(match.players.find(p => p.team === 0 && p.sourceId === role.id).target.x < 72);
});
test('the whole block advances and retreats with the ball rather than staying in kickoff lanes', () => {
  const low = shapeScenario(35), high = shapeScenario(85);
  for (const pool of ['DEF', 'MID']) {
    const advance = average(poolPlayers(high, 0, pool).map(p => p.target.x)) - average(poolPlayers(low, 0, pool).map(p => p.target.x));
    assert.ok(advance > 25, `${pool} should move with play`);
  }
  const before = high.players.map(p => ({ x: p.x, y: p.y }));
  high.possession = 1; high.ball.owner = high.players.find(p => p.team === 1 && !p.gk).id; high.lastTurnover = high.time; high.updateTargets();
  assert.deepEqual(high.players.map(p => ({ x: p.x, y: p.y })), before);
  assert.ok(average(poolPlayers(high, 0, 'DEF').map(p => p.target.x)) < 67);
});
test('defending lines narrow and shift to the threatened flank without all chasing the carrier', () => {
  const central = shapeScenario(), wide = shapeScenario(85, 10);
  const defenders = match => match.players.filter(p => p.team === 1 && !p.gk);
  const targets = defenders(wide).map(p => p.target);
  assert.ok(Math.max(...targets.map(p => p.y)) - Math.min(...targets.map(p => p.y)) < 38);
  assert.ok(average(targets.map(p => p.y)) < average(defenders(central).map(p => p.target.y)) - 8);
  assert.ok(defenders(wide).filter(p => p.action.includes('压迫')).length <= 2);
  assert.ok(defenders(wide).filter(p => p.action.includes('远侧内收')).length >= 2);
  assert.ok(Math.max(...targets.map(p => p.x)) - Math.min(...targets.map(p => p.x)) < 36);
});

test('adapter preserves root sliders and matches V2.1 resolved values including detail modifiers', () => {
  const seats = refactorMatchTeams();
  seats[0].tacticalDimensions = { tempo: 17, directness: 26, attackingWidth: 72 };
  seats[0].tacticalPlans.opening = { positionPreset: 'position1', tacticalDimensions: { pressing: 83 }, inPossessionDetails: { chanceCreation: 'patient' } };
  const plan = { tactic: seats[0].tactic, style: seats[0].style, ...seats[0].tacticalPlans.opening, tacticalDimensions: { ...seats[0].tacticalDimensions, ...seats[0].tacticalPlans.opening.tacticalDimensions } };
  const expected = resolveV2TacticalDimensions(plan.tactic, plan.style, tacticalDimensionsForPlan(plan));
  const actual = prepareV22Match(seats).teams[0].plans.opening.tacticalDimensions;
  assert.deepEqual(actual, expected);
  assert.equal(actual.tempo, 12); assert.equal(actual.directness, 26); assert.equal(actual.pressing, 83);
});
test('all eight sliders update one team only, preserve input and restore the selected plan', () => {
  const input = createV22DemoInput(), original = structuredClone(input), match = new V22HybridMatch(input);
  const defaults = { ...match.dimensions(0) }, away = { ...match.dimensions(1) };
  const before = match.players.map(({ x, y }) => ({ x, y }));
  for (const key of Object.keys(V22_SLIDERS)) {
    match.setDimensions(0, { [key]: 0 }); assert.equal(match.dimensions(0)[key], 0);
    match.setDimensions(0, { [key]: 100 }); assert.equal(match.dimensions(0)[key], 100);
  }
  assert.deepEqual(match.dimensions(1), away); assert.deepEqual(input, original);
  assert.deepEqual(match.players.map(({ x, y }) => ({ x, y })), before);
  match.clearDimensions(0); assert.deepEqual(match.dimensions(0), defaults); assert.equal(match.manualPlans[0], false);
  match.setDimensions(0, { tempo: 0 }); match.setPlan(0, 'press'); assert.equal(match.dimensions(0).tempo, input.teams[0].plans.press.tacticalDimensions.tempo);
  assert.throws(() => match.setDimensions(0, { tempo: NaN })); assert.throws(() => match.setDimensions(0, { unknown: 20 }));
});
test('line, width, compactness, pressing and mentality each affect the corresponding geometry', () => {
  const match = shapeScenario(), width = team => { const ps = match.players.filter(p => p.team === team && !p.gk); return Math.max(...ps.map(p => p.target.y)) - Math.min(...ps.map(p => p.target.y)); };
  match.setDimensions(0, { defensiveLine: 10 }); const low = average(poolPlayers(match, 0, 'DEF').map(p => p.target.x));
  match.setDimensions(0, { defensiveLine: 90 }); assert.ok(average(poolPlayers(match, 0, 'DEF').map(p => p.target.x)) > low + 4);
  match.setDimensions(0, { attackingWidth: 10 }); const narrow = width(0);
  match.setDimensions(0, { attackingWidth: 90 }); assert.ok(width(0) > narrow + 4);
  match.setDimensions(1, { compactness: 10 }); const loose = width(1);
  match.setDimensions(1, { compactness: 90 }); assert.ok(width(1) < loose - 4);
  match.setDimensions(1, { pressing: 0 }); const passive = match.players.filter(p => p.team === 1 && p.action.includes('压迫')).length;
  match.setDimensions(1, { pressing: 100 }); assert.ok(match.players.filter(p => p.team === 1 && p.action.includes('压迫')).length > passive);
  match.clearDimensions(0); match.setDimensions(0, { mentality: 10 }); const cautious = average(poolPlayers(match, 0, 'DEF').map(p => p.target.x));
  match.setDimensions(0, { mentality: 90 }); assert.ok(average(poolPlayers(match, 0, 'DEF').map(p => p.target.x)) > cautious + 3);
});
test('tempo and match control change actual possession decision timing without changing velocity', () => {
  const match = shapeScenario(); match.score = [1, 0];
  match.setDimensions(0, { tempo: 10, timeWasting: 0 }); const patient = match.nextDecision;
  match.setDimensions(0, { tempo: 90 }); const quick = match.nextDecision; assert.ok(quick < patient - 1);
  match.setDimensions(0, { timeWasting: 100 }); assert.ok(match.nextDecision > quick + .5);
  const opponent = match.players.find(p => p.team === 1 && !p.gk); opponent.x = match.ball.x; opponent.y = match.ball.y + 1;
  match.setDimensions(0, { timeWasting: 100 }); assert.equal(match.nextDecision, quick);
});
test('directness is continuous and counter-attack response expires after a turnover', () => {
  const match = shapeScenario();
  const short = tacticalExecution({ ...match.dimensions(0), directness: 20 }), long = tacticalExecution({ ...match.dimensions(0), directness: 80 });
  assert.ok(long.desiredPassDistance > short.desiredPassDistance + 8); assert.ok(long.forwardWeight > short.forwardWeight);
  match.lastTurnover = match.time;
  match.setDimensions(0, { counterAttack: 0 }); const held = match.nextDecision;
  match.setDimensions(0, { counterAttack: 100 }); assert.ok(match.nextDecision < held - .3);
  match.lastTurnover = match.time - 7; match.setDimensions(0, { counterAttack: 100 }); assert.equal(match.nextDecision, held);
});
test('manual mentality preserves V2.1 low-block cap', () => {
  const input = createV22DemoInput(); input.teams[0].plans.opening.outOfPossession = 'lowBlock';
  const match = new V22HybridMatch(input); match.setDimensions(0, { mentality: 100 }); assert.equal(match.dimensions(0).mentality, 52);
});

function atRegulationEnd(match, score) {
  match.tick = Math.round(match.input.duration / STEP) - 1;
  match.time = match.input.duration - STEP;
  match.score = [...score]; match.phase = 'stoppage'; match.restartAt = Infinity;
}

test('regulation lasts 360 seconds; draws only extend knockout matches by 120 seconds', () => {
  for (const [knockout, score, extend] of [[false, [0, 0], false], [true, [1, 0], false], [true, [1, 1], true]]) {
    const m = new V22HybridMatch(createV22DemoInput('clock', { knockout }));
    assert.equal(m.input.duration, 360); assert.equal(m.input.extraTimeDuration, 120);
    atRegulationEnd(m, score); m.advance(STEP);
    assert.equal(m.time, 360); assert.equal(m.minute, 90); assert.equal(m.extraTimePlayed, extend); assert.equal(m.finished, !extend);
    if (extend) {
      m.phase = 'stoppage'; m.restartAt = Infinity; m.advance(60);
      assert.equal(m.minute, 105); assert.equal(m.finished, false); assert.equal(m.duration, 480);
      m.advance(60); assert.equal(m.minute, 120); assert.equal(m.time, 480); assert.equal(m.finished, true); assert.equal(m.needsPenalties, true);
      m.advance(30); assert.equal(m.time, 480);
    }
  }
});

test('a pending VAR goal is resolved before deciding whether extra time is necessary', () => {
  const m = new V22HybridMatch(createV22DemoInput('clock-var', { knockout: true }));
  atRegulationEnd(m, [0, 0]); m.beginGoalReview(0); m.advance(STEP);
  assert.deepEqual(m.score, [1, 0]); assert.equal(m.finished, true); assert.equal(m.extraTimePlayed, false);
});
