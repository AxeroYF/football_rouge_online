const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const depth = (p, team) => team === 0 ? p.x : 105 - p.x;
const worldX = (x, team) => team === 0 ? x : 105 - x;
const width = (y, team) => team === 0 ? y : 68 - y;

// These targets run at 2 Hz, before the onside limiter. They never move a
// player directly. Board coordinates choose the side; V2.1 validates duties.
export function applyV22AttackingMovement(targets, shape, { team, ball, ownerId, dimensions }) {
  const reserved = new Set();
  const ballDepth = depth(ball, team), ballY = width(ball.y, team);
  const cover = shape.players.filter(p => `${team}:${p.id}` !== ownerId && depth(targets.get(p.id), team) < ballDepth - 8 && (p.genericRole === 'CB' || ['anchor', 'deepLyingPlaymaker'].includes(p.tacticalDuty)));
  const put = (p, x, y, action) => {
    if (`${team}:${p.id}` === ownerId) return;
    targets.set(p.id, { x: worldX(clamp(x, 5, 100), team), y: width(clamp(y, 4, 64), team), action });
    reserved.add(p.id);
  };
  const overlapSides = new Set();
  for (const p of shape.players) {
    if (!['FB', 'WB'].includes(p.genericRole)) continue;
    const left = p.basePosition.x < 50, side = left ? -1 : 1;
    const near = left ? ballY < 29 : ballY > 39;
    const point = targets.get(p.id), x = depth(point, team);
    const fullbackDepth = clamp((70 - p.basePosition.y) * .35, -4, 4);
    if (p.tacticalDuty === 'invertedFullback') {
      put(p, Math.min(ballDepth - 11 + fullbackDepth, x + 9), 34 + side * (8 + dimensions.attackingWidth * .035), '内收中场接应');
    } else if (p.tacticalDuty === 'overlappingFullback') {
      // Only the ball-side fullback goes beyond play. The other protects the
      // turnover, and a side without two covering defenders does not overlap.
      if (near && ballDepth > 48 && cover.length >= 2) {
        const winger = shape.players.find(q => ['W', 'AM'].includes(q.genericRole) && (q.basePosition.x < 50) === left);
        const byline = winger?.tacticalDuty === 'bylineWinger';
        put(p, ballDepth + (byline ? -7 : 9) + fullbackDepth, left ? 5 : 63, byline ? '套边跟进等待外线空间' : '边后卫外线套上');
        overlapSides.add(side);
      } else put(p, Math.min(x, ballDepth - 18), 34 + side * 17, '远侧边后卫留后保护');
    }
  }
  for (const p of shape.players) {
    const point = targets.get(p.id), x = depth(point, team), y = width(point.y, team);
    const side = p.basePosition.x < 50 ? -1 : 1;
    const halfSpace = 34 + side * (9 + dimensions.attackingWidth * .045);
    switch (p.tacticalDuty) {
      case 'bylineWinger':
      case 'wideMidfielder':
        put(p, x, 34 + side * (23 + dimensions.attackingWidth * .045), '拉开边路准备传中'); break;
      case 'insideForward':
        put(p, Math.max(x, ballDepth + 6), halfSpace, overlapSides.has(side) ? '内切让出套边通道' : '斜插肋部'); break;
      case 'invertedWideMidfielder':
        put(p, Math.min(x, ballDepth + 2), halfSpace, '内收串联'); break;
      case 'advancedPlaymaker':
        put(p, ballDepth - 8, 34 + side * 8, '前腰回接组织'); break;
      case 'shadowStriker':
        put(p, Math.max(x, ballDepth + 8), 34 + side * 8, '后排插入禁区'); break;
      case 'deepLyingForward':
        put(p, Math.min(x - 7, ballDepth + 1), 34 + side * 5, '回撤串联接应'); break;
      case 'targetForward':
        put(p, Math.max(x, ballDepth + 3), 34 + (y - 34) * .35, '中路支点接应'); break;
      case 'advancedForward':
        put(p, Math.max(x, ballDepth + 10), y, '压住防线等待直塞'); break;
      default:
        if (p.genericRole === 'W' && overlapSides.has(side)) put(p, x, halfSpace, '内移为套边腾出通道');
    }
  }
  return reserved;
}

export function v22CarrierTarget(owner, duty) {
  const sign = owner.team === 0 ? 1 : -1;
  const wide = ['bylineWinger', 'wideMidfielder', 'overlappingFullback'].includes(duty);
  const inside = ['insideForward', 'invertedWideMidfielder', 'invertedFullback'].includes(duty);
  const organize = ['advancedPlaymaker', 'deepLyingPlaymaker', 'deepLyingForward'].includes(duty);
  const desiredY = wide ? (owner.y < 34 ? 6 : 62) : 34;
  return { x: clamp(owner.x + sign * (organize ? 4 : 9), 3, 102), y: clamp(owner.y + (desiredY - owner.y) * (inside ? .4 : wide ? .22 : .16), 3, 65), action: wide ? '沿边线推进寻找传中' : inside ? '持球内切' : organize ? '持球组织等待接应' : '持球推进' };
}

export function v22DirectionPreference(direction, localY) {
  const lanes = { left: 7, leftHalf: 22, center: 34, rightHalf: 46, right: 61 };
  return Object.hasOwn(lanes, direction) ? 5 - Math.abs(localY - lanes[direction]) * .18 : 0;
}

export function v22ShotRange(details) {
  return (details.longShots === 'increase' ? 29 : details.longShots === 'reduce' ? 19 : 23)
    + (details.chanceCreation === 'shootOnSight' ? 2 : details.chanceCreation === 'patient' ? -2 : 0);
}

// Crossing uses actual positions and a real flight/interception, never a
// remote scoring roll. Low cutbacks remain available with reduced crossing.
export function selectV22Cross(owner, players, details, offsideLine) {
  const d = depth(owner, owner.team), wingDistance = Math.abs(owner.y - 34);
  const threshold = details.crossing === 'increase' ? 65 : details.crossing === 'reduce' ? 88 : 76;
  if (owner.gk || d < threshold || wingDistance < 20) return null;
  const receivers = players.filter(p => p.team === owner.team && p !== owner && !p.gk && depth(p, owner.team) > 76 && depth(p, owner.team) <= offsideLine && Math.abs(p.y - 34) < 18)
    .filter(p => Math.hypot(p.x - owner.x, p.y - owner.y) < 39 && (details.crossing !== 'reduce' || depth(p, owner.team) < d - 2));
  receivers.sort((a, b) => {
    const score = p => Math.min(...players.filter(q => q.team !== owner.team).map(q => Math.hypot(p.x - q.x, p.y - q.y))) - Math.abs(depth(p, owner.team) - 91) * .15;
    return score(b) - score(a);
  });
  return receivers[0] ? { receiver: receivers[0], cutback: depth(receivers[0], owner.team) < d - 3 } : null;
}
