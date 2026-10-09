// IFAB 2026/27 Laws 9–11, 15–17. Point-player approximation: x represents
// the playable body position, not hands/arms or the decorative marker radius.
export const RULESET = 'IFAB 2026/27 · V2.2 demo subset';
export const BALL_RADIUS = .11;
const depth = (x, team) => team === 0 ? x : 105 - x;
const exemptions = new Set(['goalKick', 'throwIn', 'corner']);

export function captureOffside(players, ball, team, kickerId, restart = null) {
  const defenders = players.filter(p => p.team !== team).map(p => depth(p.x, team)).sort((a, b) => b - a);
  const lineDepth = Math.max(52.5, depth(ball.x, team), defenders[1] ?? 105);
  const candidates = exemptions.has(restart) ? [] : players.filter(p => p.team === team && p.id !== kickerId && depth(p.x, team) > lineDepth + 1e-7).map(p => ({ id: p.id, margin: depth(p.x, team) - lineDepth }));
  return { team, kickerId, lineX: team === 0 ? lineDepth : 105 - lineDepth, candidates, exempt: exemptions.has(restart), ball: { x: ball.x, y: ball.y }, players: players.map(({ id, team, x, y, number, name }) => ({ id, team, x, y, number, name })) };
}

// Being in an offside position alone is not an offence. Call only on involvement.
export function offsideInvolvement(snapshot, player, kind = 'touch') {
  if (!snapshot || !['touch', 'challenge', 'obstructVision'].includes(kind)) return null;
  const candidate = snapshot.candidates.find(p => p.id === player.id);
  return candidate ? { ...candidate, team: player.team, spot: { x: player.x, y: player.y }, snapshot, kind } : null;
}

export function classifyBoundary(ball, lastTouchTeam) {
  if (ball.y < -BALL_RADIUS || ball.y > 68 + BALL_RADIUS) return { type: 'throwIn', team: 1 - lastTouchTeam, spot: { x: Math.max(0, Math.min(105, ball.x)), y: ball.y < 0 ? 0 : 68 } };
  if (ball.x >= -BALL_RADIUS && ball.x <= 105 + BALL_RADIUS) return null;
  const scoringTeam = ball.x > 105 ? 0 : 1;
  if (Math.abs(ball.y - 34) + BALL_RADIUS < 3.66 && (ball.z ?? 0) + BALL_RADIUS < 2.44) return { type: 'goal', team: scoringTeam };
  if (lastTouchTeam === scoringTeam) return { type: 'goalKick', team: 1 - scoringTeam, spot: { x: ball.x > 105 ? 99.5 : 5.5, y: 34 } };
  return { type: 'corner', team: scoringTeam, spot: { x: ball.x > 105 ? 105 : 0, y: ball.y < 34 ? 0 : 68 } };
}

// Factual review: deterministic evidence, never a random disallowed-goal roll.
export function reviewGoal({ team, offsideOffence }) {
  return offsideOffence?.team === team
    ? { confirmed: false, reason: '进攻方越位，进球无效', restart: { type: 'indirectFreeKick', team: 1 - team, spot: offsideOffence.spot }, evidence: offsideOffence.snapshot }
    : { confirmed: true, reason: '进球有效', restart: { type: 'kickoff', team: 1 - team }, evidence: null };
}
