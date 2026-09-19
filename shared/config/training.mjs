export const TRAINING_RULES = Object.freeze({ durationMs: 600_000, attributePoints: 5, attributeMaximum: 99, minimumCostGold: 250, referenceOverall: 70, referenceCostGold: 500, doublingInterval: 10, costRounding: 50 });
export const TRAINING_POOLS = Object.freeze({ ATT: "前场", MID: "中场", DEF: "后场", GK: "门将" });
export function trainingCapacity(level) { return Math.max(1, Math.min(5, Math.floor(Number(level) || 1))); }
export function isPlayerTraining(player) { return Boolean(player?.training); }

// Charge the displayed overall, including enhancement and accumulated training.
export function trainingCostGold(playerOrOverall) {
  const value = typeof playerOrOverall === "object" ? playerOrOverall?.effectiveOverall ?? playerOrOverall?.overall : playerOrOverall;
  const overall = Number.isFinite(Number(value)) ? Number(value) : 0;
  const raw = TRAINING_RULES.referenceCostGold * 2 ** ((overall - TRAINING_RULES.referenceOverall) / TRAINING_RULES.doublingInterval);
  return Math.max(TRAINING_RULES.minimumCostGold, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(raw / TRAINING_RULES.costRounding) * TRAINING_RULES.costRounding));
}
