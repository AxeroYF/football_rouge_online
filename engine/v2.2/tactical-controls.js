import { hasV2SplitTacticalPlan, resolveV2SplitTacticalPlan } from '../s4-v2.1/versus/public/v2-tactical-profiles.js';

export const V22_SLIDERS = Object.freeze({ tempo: '比赛节奏', directness: '传球纵深', attackingWidth: '进攻宽度', defensiveLine: '防线高度', pressing: '压迫强度', compactness: '阵型紧凑', counterAttack: '反击倾向', timeWasting: '比赛控制' });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function boundedDimension(plan, key, value) {
  if (!(Object.hasOwn(V22_SLIDERS, key) || key === 'mentality') || typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid tactical dimension');
  const deepBlock = plan.outOfPossession === 'lowBlock' || (hasV2SplitTacticalPlan(plan) ? resolveV2SplitTacticalPlan(plan).defensiveBlock === 'lowBlock' : plan.style === 'lowBlock');
  return clamp(value, 0, key === 'mentality' && deepBlock ? 52 : 100);
}

// Tempo changes thinking time, not running speed. Counter-attack bonuses fade
// after a real turnover; match control prefers patient/safe play under low pressure.
export function tacticalExecution(dimensions, { transitionAge = Infinity, leading = false, pressureDistance = 20 } = {}) {
  const counter = clamp(1 - Math.max(0, transitionAge) / 6, 0, 1) * dimensions.counterAttack / 100;
  const control = dimensions.timeWasting / 100 * (leading ? 1 : .35) * clamp((pressureDistance - 3) / 7, 0, 1);
  return {
    counter, control,
    decisionDelay: (.65 + (100 - dimensions.tempo) * .018) * (1 - counter * .45) + control * .9,
    retryDelay: .25 + (100 - dimensions.tempo) * .005 + control * .3,
    desiredPassDistance: 12 + dimensions.directness * .18 + counter * 8 - control * 5,
    forwardWeight: .5 + dimensions.directness * .007 + dimensions.mentality * .002 + counter * .65 - control * .3,
  };
}
