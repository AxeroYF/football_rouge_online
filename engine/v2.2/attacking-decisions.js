const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function blocksLane(p, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, length2 = dx * dx + dy * dy;
  const fraction = ((p.x - start.x) * dx + (p.y - start.y) * dy) / (length2 || 1);
  return fraction > 0 && fraction < 1 && distance(p, { x: start.x + dx * fraction, y: start.y + dy * fraction }) < 1.05;
}

// Opportunity first: an unmarked striker with a clear view of goal should not
// discard the chance because a flat random gate failed. Narrow angles and
// blocked lanes still encourage a pass, cross or another touch.
export function v22ShotOpportunity(owner, opponents, { range, role, duty, details }) {
  const goalX = owner.team === 0 ? 105 : 0;
  const forward = Math.abs(goalX - owner.x), lateral = Math.abs(owner.y - 34);
  const goalDistance = Math.hypot(forward, lateral);
  const angle = Math.abs(Math.atan2(3.66 - (owner.y - 34), Math.max(.1, forward)) - Math.atan2(-3.66 - (owner.y - 34), Math.max(.1, forward)));
  const finisher = ['ST', 'LW', 'RW'].includes(role) || duty === 'shadowStriker';
  const effectiveRange = range + (finisher && details.longShots !== 'reduce' ? 2 : 0);
  const lanes = [31.8, 34, 36.2].map(y => ({ y, blocked: opponents.filter(p => !p.gk && blocksLane(p, owner, { x: goalX, y })).length }));
  lanes.sort((a, b) => a.blocked - b.blocked || Math.abs(a.y - 34) - Math.abs(b.y - 34));
  const clear = lanes[0].blocked === 0;
  const canShoot = !owner.gk && goalDistance < effectiveRange && angle > .13 && forward > .4;
  const prime = clear && angle > .29 && goalDistance < (finisher ? 25 : 18);
  const probability = prime ? 1 : clamp(.56 + (finisher ? .16 : 0) + (effectiveRange - goalDistance) * .016 + (details.chanceCreation === 'shootOnSight' ? .12 : details.chanceCreation === 'patient' ? -.13 : 0) - (clear ? 0 : .58) - (angle < .23 ? .3 : 0), .05, .95);
  return { canShoot, probability, clear, goalDistance, aimY: lanes[0].y };
}

export function v22CanCarryForward(owner, opponents, role) {
  const sign = owner.team === 0 ? 1 : -1, depth = owner.team === 0 ? owner.x : 105 - owner.x;
  return !owner.gk && ['ST', 'LW', 'RW', 'AM'].includes(role) && depth > 62 && depth < 96
    && opponents.every(p => distance(p, owner) > 3.5 && !blocksLane(p, owner, { x: owner.x + sign * 7, y: owner.y }));
}
