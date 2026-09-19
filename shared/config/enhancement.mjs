// Enhancement rules ported from S4 versus/s4-balance.js.
export const S4_ENHANCEMENT = Object.freeze({
  maxLevel:8,
  abilityBonuses:Object.freeze([0, 1, 2, 3, 5, 7, 9, 11, 13]),
  traitUnlockLevels:Object.freeze([4, 7]),
  equalLevelChances:Object.freeze([100, 100, 95, 85, 70, 55, 40, 25]),
  protectionCostFactor:.7,
  protectionCostDiscount:.75,
  protectionCostUnit:100,
  lowerMaterialMultiplier:.6,
  higherMaterialMultiplier:1.2,
  cardValueMultipliers:Object.freeze([1, 1.7, 2.7, 4, 6, 9, 13, 19, 28]),
});

export function s4EnhancementAbilityBonus(levelValue) {
  const level = Math.max(0, Math.min(S4_ENHANCEMENT.maxLevel, Math.floor(Number(levelValue) || 0)));
  return S4_ENHANCEMENT.abilityBonuses[level];
}

export function s4EffectiveOverall(player, levelValue) {
  const overall = Number(player?.overall ?? 0) + s4EnhancementAbilityBonus(levelValue);
  return overall;
}

export function s4CardValueMultiplier(levelValue) {
  const level = Math.max(0, Math.min(S4_ENHANCEMENT.maxLevel, Math.floor(Number(levelValue) || 0)));
  return S4_ENHANCEMENT.cardValueMultipliers[level];
}

export function s4EnhancementChanceForLevels(mainLevelValue, materialLevelValue) {
  const mainLevel = Math.max(0, Math.min(S4_ENHANCEMENT.maxLevel - 1, Math.floor(Number(mainLevelValue) || 0)));
  const materialLevel = Math.max(0, Math.min(S4_ENHANCEMENT.maxLevel, Math.floor(Number(materialLevelValue) || 0)));
  const equalChance = S4_ENHANCEMENT.equalLevelChances[mainLevel];
  const distance = materialLevel - mainLevel;
  const adjusted = distance < 0
    ? equalChance * (S4_ENHANCEMENT.lowerMaterialMultiplier ** Math.abs(distance))
    : equalChance * (S4_ENHANCEMENT.higherMaterialMultiplier ** distance);
  return Math.max(1, Math.min(100, Math.round(adjusted)));
}

export function s4EnhancementProtectionCost(chanceValue) {
  const failureChance = Math.max(0, 100 - Number(chanceValue ?? 100));
  if (!failureChance) return 0;
  const rawCost = failureChance * failureChance * S4_ENHANCEMENT.protectionCostFactor;
  const baseCost = Math.ceil(rawCost / S4_ENHANCEMENT.protectionCostUnit) * S4_ENHANCEMENT.protectionCostUnit;
  return Math.ceil(baseCost * S4_ENHANCEMENT.protectionCostDiscount);
}

export function enhancementFamily(player) {
  return String(player.cardDefinitionId ?? player.card?.cardDefinitionId ?? player.id ?? player.playerId);
}
export function duplicateEnhancementCards(roster = []) {
  const counts = new Map();
  for (const player of roster) { const key = enhancementFamily(player); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return roster.filter((player) => counts.get(enhancementFamily(player)) > 1);
}
