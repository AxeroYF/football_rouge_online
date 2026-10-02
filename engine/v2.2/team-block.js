const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const localDepth = (point, team) => team === 0 ? point.x : 105 - point.x;
const worldDepth = (value, team) => team === 0 ? value : 105 - value;
const restDuties = new Set(['anchor', 'holdingFullback', 'coverDefender', 'deepLyingPlaymaker']);
const roleDepth = { CB: 26, FB: 32, WB: 40, DM: 45, CM: 55, AM: 67, W: 78, ST: 84 };

// V2.1 provides relative role/duty geometry. Re-anchor that geometry to the
// live ball instead of leaving the lines attached to their kickoff positions.
// Called at the existing 2 Hz target cadence, never during each render frame.
export function buildV22TeamBlock(shape, { team, attacking, ball, dimensions, counter = 0 }) {
  const ballDepth = clamp(localDepth(ball, team), 0, 105);
  const lineBias = (dimensions.defensiveLine - 50) * .14;
  const compactness = dimensions.compactness / 100;
  const outfield = shape.players.filter(p => p.genericRole !== 'GK');
  const sourceDepths = outfield.map(p => (100 - p.targetPosition.y) * 1.05);
  const minDepth = Math.min(...sourceDepths), span = Math.max(12, Math.max(...sourceDepths) - minDepth);
  let rear, front, centerY, widthScale;
  if (attacking) {
    const mentalityBias = (dimensions.mentality - 50) * .10;
    const followThrough = 3 + clamp((ballDepth - 40) / 45, 0, 1) * 3;
    rear = clamp(ballDepth - 34 + lineBias + mentalityBias + followThrough, 9, 72);
    front = clamp(rear + 36 + (1 - compactness) * 8 + counter * 5, 47, 99);
    centerY = 34 + (ball.y - 34) * .23;
    widthScale = .88 + dimensions.attackingWidth * .0014;
  } else {
    const length = 25 + (1 - compactness) * 9;
    const center = clamp(ballDepth + 5 + lineBias, 10 + length / 2, 51 + dimensions.defensiveLine * .32);
    rear = center - length / 2; front = center + length / 2;
    centerY = 34 + (ball.y - 34) * (.38 + compactness * .16);
    widthScale = .78 - compactness * .18;
  }
  const targets = new Map();
  for (const item of shape.players) {
    if (item.genericRole === 'GK') {
      const keeperDepth = attacking ? clamp(rear * .24, 4, 16) : clamp(ballDepth * .14, 3, 10);
      targets.set(item.id, { x: worldDepth(keeperDepth, team), y: 34 + (ball.y - 34) * .14, action: attacking ? '跟进保护身后' : '封守球门' });
      continue;
    }
    const fraction = clamp(((100 - item.targetPosition.y) * 1.05 - minDepth) / span, 0, 1);
    // Keep the board's absolute depth preference as well as relative spacing;
    // min/max normalization alone cancels a whole-line move on the board.
    const boardBias = clamp(((100 - item.basePosition.y) * 1.05 - (roleDepth[item.genericRole] ?? 55)) * .35, -7, 7);
    let targetDepth = rear + fraction * (front - rear) + boardBias;
    const sourceY = (team === 0 ? item.targetPosition.x : 100 - item.targetPosition.x) * .68;
    let y = centerY + (sourceY - 34) * widthScale;
    let action = attacking ? '随队前压接应' : '整体回收保护';
    if (attacking) {
      const nearSide = Math.abs(sourceY - ball.y) < 20;
      if (['FB', 'WB'].includes(item.genericRole) && nearSide && !restDuties.has(item.tacticalDuty) && item.tacticalDuty !== 'invertedFullback') {
        targetDepth += item.tacticalDuty === 'overlappingFullback' ? 9 : 5;
        action = '边后卫跟进接应';
      }
      if (item.genericRole === 'CB' || restDuties.has(item.tacticalDuty)) {
        const gap = item.genericRole === 'CB' ? 22 : item.genericRole === 'DM' ? 15 : 20;
        targetDepth = Math.min(targetDepth, Math.max(9, ballDepth - gap));
        action = '前压保留后场保护';
      }
    } else {
      // Far-side players move inward while the entire block shifts ball-side.
      if ((sourceY - 34) * (ball.y - 34) < 0) { y = centerY + (y - centerY) * .84; action = '远侧内收保护中路'; }
    }
    targets.set(item.id, { x: worldDepth(clamp(targetDepth, 3, 101), team), y: clamp(y, 3, 65), action });
  }
  return { targets, rear, front, centerY };
}

export function addV22SupportTargets(players, shape, { team, ball, ownerId, dimensions, reserved = new Set() }) {
  const roles = new Map(shape.players.map(p => [p.id, p]));
  const eligible = players.filter(p => p.team === team && p.id !== ownerId && !p.gk).filter(p => {
    const role = roles.get(p.sourceId);
    return role && !reserved.has(p.sourceId) && ['CM', 'AM', 'DM', 'FB', 'WB'].includes(role.genericRole) && !restDuties.has(role.tacticalDuty);
  }).sort((a, b) => Math.hypot(a.target.x - ball.x, a.target.y - ball.y) - Math.hypot(b.target.x - ball.x, b.target.y - ball.y));
  const sign = team === 0 ? 1 : -1;
  eligible.slice(0, 2).forEach((p, i) => {
    const boardY = (team === 0 ? roles.get(p.sourceId).basePosition.x : 100 - roles.get(p.sourceId).basePosition.x) * .68;
    const side = ball.y < 16 ? 1 : ball.y > 52 ? -1 : boardY < ball.y ? -1 : 1;
    const desired = { x: clamp(ball.x - sign * (i ? 17 : 10), 4, 101), y: clamp(ball.y + side * (i ? 13 : 10), 4, 64) };
    const blend = .65 - dimensions.counterAttack * .002;
    p.target = { x: p.target.x + (desired.x - p.target.x) * blend, y: p.target.y + (desired.y - p.target.y) * blend };
    p.action = i ? '后方回传接应' : '近侧三角接应';
  });
}
