import { S4_ENHANCEMENT, s4EnhancementAbilityBonus } from "./enhancement.mjs";

export const CARD_MANAGEMENT_DEFAULTS = Object.freeze({
  recycleEnabled: true,
  recycleRatioBps: 2000,
  upgradeBonusBps: 1000,
  valuations: Object.freeze({ C: 400, B: 2000, A: 10000, S: 50000 }),
});

export const TRADE_UP_GRADES = Object.freeze({ C: "B", B: "A", A: "S" });
export const TRADE_UP_HISTORY_LIMIT = 20;
export const MAX_CARD_PRICE = 1_000_000_000;


export const LISTING_PRICE_RULES = Object.freeze({
  ratioBps: 5000,
  overallStepBps: 500,
  overallFloors: Object.freeze({ C: 75, B: 80, A: 86, S: 90 }),
  roundingUnit: 10,
});

// Price strength and enhancement separately: never count the enhancement ability bonus twice.
export function minimumListingPrice(card, config = CARD_MANAGEMENT_DEFAULTS) {
  const grade = card.grade === "X" ? "S" : card.grade;
  const valuation = config.valuations?.[grade], level = Number(card.upgradeLevel ?? 0);
  const floor = LISTING_PRICE_RULES.overallFloors[grade];
  const baseOverall = Number(card.baseOverall ?? (Number(card.effectiveOverall ?? card.overall) - s4EnhancementAbilityBonus(level)));
  if (!Number.isSafeInteger(valuation) || valuation <= 0 || floor == null || !Number.isInteger(level) || level < 0 || level > 8 ||
      !Number.isFinite(baseOverall) || baseOverall < 1 || baseOverall > 999) return null;
  const abilityBps = 10000 + Math.max(0, Math.round(baseOverall) - floor) * LISTING_PRICE_RULES.overallStepBps;
  const multiplierTenths = Math.round(S4_ENHANCEMENT.cardValueMultipliers[level] * 10);
  const numerator = BigInt(valuation) * BigInt(LISTING_PRICE_RULES.ratioBps) * BigInt(abilityBps) * BigInt(multiplierTenths);
  const unit = BigInt(LISTING_PRICE_RULES.roundingUnit), denominator = 10000n * 10000n * 10n * unit;
  return Number(((numerator + denominator - 1n) / denominator) * unit);
}

export function recycleValue(card, config = CARD_MANAGEMENT_DEFAULTS) {
  const grade = card.grade === "X" ? "S" : card.grade;
  const valuation = config.valuations[grade];
  const level = Number(card.upgradeLevel ?? 0);
  if (!Number.isSafeInteger(valuation) || !Number.isInteger(level) || level < 0 || level > 8) return 0;
  return Number(BigInt(valuation) * BigInt(config.recycleRatioBps) * BigInt(10000 + level * config.upgradeBonusBps) / 100000000n);
}
