import test from 'node:test';
import assert from 'node:assert/strict';
import { captureOffside, offsideInvolvement, classifyBoundary, reviewGoal } from '../engine/v2.2/football-rules.js';
import { V22HybridMatch } from '../engine/v2.2/hybrid-engine.js';
import { createV22DemoInput } from '../engine/v2.2/demo-fixture.mjs';

const scene = () => [{ id: 'passer', team: 0, x: 65, y: 30 }, { id: 'runner', team: 0, x: 80, y: 34 }, { id: 'defender', team: 1, x: 79.5, y: 40 }, { id: 'keeper', team: 1, x: 101, y: 34 }];
test('offside uses the kick snapshot, second-last opponent and actual involvement', () => {
  const players = scene(), snap = captureOffside(players, { x: 65, y: 30 }, 0, 'passer');
  players[2].x = 90; players[1].x = 75;
  assert.equal(snap.lineX, 79.5); assert.equal(snap.players[2].x, 79.5);
  assert.equal(offsideInvolvement(snap, players[1], 'standing'), null);
  assert.equal(offsideInvolvement(snap, players[1]).margin, .5);
  assert.equal(offsideInvolvement(snap, players[1]).spot.x, 75);
});
test('level, own half, behind ball and direct restart exemptions are onside', () => {
  for (const [runner, ball, second] of [[79.5,65,79.5],[50,30,40],[80,81,79.5]]) {
    const players = scene(); players[1].x = runner; players[2].x = second;
    assert.equal(captureOffside(players, { x: ball, y: 30 }, 0, 'passer').candidates.length, 0);
  }
  for (const restart of ['throwIn', 'goalKick', 'corner']) assert.equal(captureOffside(scene(), { x: 65, y: 30 }, 0, 'passer', restart).candidates.length, 0);
  assert.equal(captureOffside(scene(), { x: 65, y: 30 }, 0, 'passer', 'indirectFreeKick').candidates.length, 1);
  const mirrored = scene().map(p => ({ ...p, x: 105 - p.x, team: 1 - p.team }));
  assert.equal(captureOffside(mirrored, { x: 40, y: 30 }, 1, 'passer').candidates[0].id, 'runner');
});
test('whole-ball boundary and last touch determine goal, throw, goal kick or corner', () => {
  assert.equal(classifyBoundary({ x: 105.05, y: 34 }, 0), null);
  assert.equal(classifyBoundary({ x: 105.2, y: 34 }, 0).type, 'goal');
  assert.equal(classifyBoundary({ x: 105.2, y: 34, z: 2.6 }, 0).type, 'goalKick');
  assert.equal(classifyBoundary({ x: 105.2, y: 40 }, 0).type, 'goalKick');
  assert.equal(classifyBoundary({ x: 105.2, y: 40 }, 1).type, 'corner');
  assert.deepEqual(classifyBoundary({ x: 40, y: -1 }, 0), { type: 'throwIn', team: 1, spot: { x: 40, y: 0 } });
  assert.equal(classifyBoundary({ x: -.2, y: 34 }, 0).team, 1);
});
test('VAR checks evidence, never randomly disallows goals or counts a goal twice', () => {
  const players = scene(), snapshot = captureOffside(players, { x: 65, y: 30 }, 0, 'passer');
  const offence = offsideInvolvement(snapshot, players[1]);
  const result = reviewGoal({ team: 0, offsideOffence: offence });
  assert.equal(result.confirmed, false); assert.equal(result.restart.type, 'indirectFreeKick');
  assert.equal(reviewGoal({ team: 0 }).confirmed, true);
  const match = new V22HybridMatch(createV22DemoInput());
  match.offsideOffence = offence; match.beginGoalReview(0);
  assert.deepEqual(match.score, [0, 0]); match.advance(2.6);
  assert.deepEqual(match.score, [0, 0]); assert.equal(match.lastReview.confirmed, false);
  match.advance(3.1); assert.equal(match.phase, 'play');
  match.beginGoalReview(0); match.advance(2.6); assert.deepEqual(match.score, [1, 0]);
  match.advance(3.1); assert.deepEqual(match.score, [1, 0]);
});
test('offside position is enforced on receiving; borderline involvement is delayed', () => {
  for (const margin of [.5, 3]) {
    const match = new V22HybridMatch(createV22DemoInput()), receiver = match.players.find(p => p.team === 0 && !p.gk);
    match.possession = 0;
    match.offsideSnapshot = { candidates: [{ id: receiver.id, margin }], team: 0, players: [] };
    match.receive(receiver);
    assert.equal(match.phase, margin > 1 ? 'stoppage' : 'play');
    if (margin < 1) { assert.ok(match.offsideOffence); match.beginGoalReview(0); match.advance(2.6); assert.equal(match.lastReview.confirmed, false); }
    else assert.equal(match.restart.type, 'indirectFreeKick');
  }
});
