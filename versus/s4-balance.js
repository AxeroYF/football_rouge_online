import { offlineDisplayAttributeValue } from "./offline-attribute-settings.js";

export const S4_ECONOMY = Object.freeze({
  initialWalletBalance:100000,
  leagueMatchRewards:Object.freeze({ loss:1200, draw:1400, win:1600 }),
  cupAdvancePackType:"public-random",
  cupAdvancePackQuantity:2,
  marketFeeRate:.05,
  singleCardRecoveryRate:.25,
  forcedCardRecoveryRate:.25,
  ownershipRecoveryRate:.1,
});

export const S4_PRICING = Object.freeze({
  cardGradeBase:Object.freeze({ S:6500, A:2800, B:1400, C:700 }),
  cardOverallFloor:Object.freeze({ S:90, A:86, B:80, C:75 }),
  cardOverallStep:Object.freeze({ S:250, A:200, B:120, C:100 }),
  ownershipGradeBase:Object.freeze({ S:12000, A:7000, B:4500, C:2800 }),
  ownershipOverallFloor:Object.freeze({ S:90, A:86, B:80, C:75 }),
  ownershipOverallStep:Object.freeze({ S:0, A:400, B:250, C:250 }),
  cardListingFloorRate:.5,
  ownershipListingFloorRate:.6,
});

function roundedReferenceValue(baseValue, overallValue, overallFloor, overallStep) {
  const value = Number(baseValue ?? 0) + Math.max(0, Number(overallValue ?? 0) - Number(overallFloor ?? 0)) * Number(overallStep ?? 0);
  return Math.ceil(value / 100) * 100;
}

export function s4BaseCardReferenceValue(player) {
  const grade = player?.grade ?? "C";
  return roundedReferenceValue(S4_PRICING.cardGradeBase[grade], player?.overall, S4_PRICING.cardOverallFloor[grade], S4_PRICING.cardOverallStep[grade]);
}

export function s4OwnershipReferenceValue(player) {
  const grade = player?.grade ?? "C";
  return roundedReferenceValue(S4_PRICING.ownershipGradeBase[grade], player?.overall, S4_PRICING.ownershipOverallFloor[grade], S4_PRICING.ownershipOverallStep[grade]);
}

export const S4_PACK_PRICES = Object.freeze({
  "legend-random":10000,
  "private-mixed":1000,
  "private-att":1300,
  "private-mid":1300,
  "private-def":1300,
  "private-gk":1100,
  "public-random":2200,
  "public-carnival":15000,
});

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

export function applyS4Enhancement(player, levelValue, options = {}) {
  const upgradeLevel = Math.max(0, Math.min(S4_ENHANCEMENT.maxLevel, Math.floor(Number(levelValue) || 0)));
  const upgradeBonus = s4EnhancementAbilityBonus(upgradeLevel);
  const attributes = Object.fromEntries(Object.entries(player?.attributes ?? {}).map(([key, value]) => [
    key,
    Number.isFinite(value) ? offlineDisplayAttributeValue(Number(value) + upgradeBonus, options.attributeSettings) : value,
  ]));
  return {
    ...player,
    baseOverall:Number(player?.overall ?? 0),
    overall:s4EffectiveOverall(player, upgradeLevel),
    attributes,
    upgradeLevel,
    upgradeBonus,
  };
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
