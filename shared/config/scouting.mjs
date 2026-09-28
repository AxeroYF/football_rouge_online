export const SCOUTING_RULES = Object.freeze({
  maxCentersPerPlayer: 1,
  scoutCapacity: 2,
  recruitBatchLimit: 2,
  recruitCostGold: 0,
  costGold: 1200,
  maxQueueRounds: 20,
  durationMs: 10 * 60_000,
  choiceCount: 3,
  regionalBias: 0.8,
  enhancementWeights: Object.freeze({ 0: 94, 1: 4.5, 2: 1.2, 3: 0.3 }),
});

// Candidate quality by active facility level; each mission snapshots its starting level.
export const SCOUTING_LEVELS = Object.freeze([
  null,
  { gradeWeights: { C: 75, B: 25 }, legendaryChance: 0.005 },
  { gradeWeights: { C: 45, B: 50, A: 5 }, legendaryChance: 0.01 },
  { gradeWeights: { C: 20, B: 65, A: 15 }, legendaryChance: 0.015 },
  { gradeWeights: { C: 5, B: 60, A: 35 }, legendaryChance: 0.02 },
  { gradeWeights: { B: 40, A: 60 }, legendaryChance: 0.03 },
].map((value) => value && Object.freeze({ ...value, gradeWeights: Object.freeze(value.gradeWeights) })));

export function scoutingLevel(level) {
  return SCOUTING_LEVELS[Math.max(1, Math.min(5, Math.floor(Number(level) || 1)))];
}

export function scoutingGradeProbabilities(levelRules) {
  const weights = levelRules.gradeWeights;
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const legendary = levelRules.legendaryChance;
  return [...Object.entries(weights).filter(([, weight]) => weight > 0).map(([grade, weight]) => ({ grade, percent: (1 - legendary) * weight / total * 100 })), { grade: "S", percent: legendary * 100 }].filter((entry) => entry.percent > 0);
}

// Diminishing production efficiency; no hard cap or production stockpile spending.
export function scoutingProductionTiming(production = 0, baseDurationMs = SCOUTING_RULES.durationMs) {
  const capacity = Number.isFinite(production) ? Math.max(0, production) : 0;
  const speedMultiplier = 1 + 0.1 * Math.log2(1 + capacity / 300);
  const durationMs = Math.ceil(baseDurationMs / speedMultiplier);
  return { production: capacity, speedMultiplier, baseDurationMs, durationMs, reductionPercent: (1 - 1 / speedMultiplier) * 100 };
}

export const JOINT_SCOUTING_RULES = Object.freeze({
 siteCount:3, rotationMs:6*60*60_000, maxQueueRounds:30, costMultiplier:1.2, legendaryMultiplier:1.5,
 enhancementWeights:Object.freeze({0:88,1:8,2:3,3:1}),
});
