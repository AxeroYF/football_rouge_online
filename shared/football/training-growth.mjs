import { s4EnhancementAbilityBonus } from "../config/enhancement.mjs";
import { PLAYER_OVERALL_ATTRIBUTE_KEYS, playerOverallFromAttributes, roleGroup } from "../../engine/s4-v2.1/game/public/schema.js";

const clamp = value => Math.max(1, Math.min(99, value));
export function ensureTrainingBases(player) {
  const bonus = s4EnhancementAbilityBonus(player.upgradeLevel);
  const bases = values => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key,
    Number(value) >= 99 && Number.isFinite(player.referenceAttributes?.[key])
      ? Number(player.referenceAttributes[key]) : Number(value) - bonus - Number(player.trainingBonuses?.[key] ?? 0)]));
  player.enhancementBaseAttributes ??= bases(player.attributes);
  player.enhancementBaseEffectiveAttributes ??= bases(player.effectiveAttributes ?? player.attributes);
}

// Always recompute from the unenhanced base plus cumulative growth. Computing a
// rounded delta per session loses fractional progress; rating enhanced stats
// directly would count enhancement twice and change the existing cap rules.
export function refreshTrainingGrowth(player) {
  if (!Object.values(player.trainingBonuses ?? {}).some(value => Number(value) > 0)) return;
  ensureTrainingBases(player);
  const bonus = s4EnhancementAbilityBonus(player.upgradeLevel);
  const trained = base => Object.fromEntries(Object.entries(base).map(([key, value]) => [key, clamp(Number(value) + Number(player.trainingBonuses?.[key] ?? 0))]));
  const enhanced = base => Object.fromEntries(Object.entries(base).map(([key, value]) => [key, clamp(Number(value) + Number(player.trainingBonuses?.[key] ?? 0) + bonus)]));
  const baseAttributes = trained(player.enhancementBaseAttributes);
  const role = player.role ?? player.pool;
  const core = PLAYER_OVERALL_ATTRIBUTE_KEYS[roleGroup(role)];
  // Sparse legacy records must not be re-rated using invented default stats.
  if (core.every(key => Number.isFinite(baseAttributes[key]))) {
    player.baseOverall = playerOverallFromAttributes(baseAttributes, role);
    player.overall = player.baseOverall + bonus;
    player.effectiveOverall = player.overall;
  }
  player.attributes = enhanced(player.enhancementBaseAttributes);
  player.effectiveAttributes = enhanced(player.enhancementBaseEffectiveAttributes);
  player.cardDefinitionId ??= String(player.id ?? player.playerId);
  player.cardInstanceId ??= String(player.id ?? player.playerId);
  delete player.card;
}
