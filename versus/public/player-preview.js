const DEFAULT_BONUSES = Object.freeze([0,1,2,3,5,7,9,11,13]);

export function playerPreviewValues(player, upgradeLevel = 0, bondPercent = 0, {abilityBonuses = DEFAULT_BONUSES, unlocked = false} = {}) {
  const level = Math.max(0, Math.min(8, Math.floor(Number(upgradeLevel) || 0)));
  const bond = Math.max(-100, Math.min(100, Number(bondPercent) || 0));
  const enhancementBonus = Number(abilityBonuses[level] ?? 0);
  const multiplier = 1 + bond / 100;
  const attributes = Object.fromEntries(Object.entries(player.attributes ?? {}).map(([key,value]) => {
    const enhanced = Math.round((Number(value) + enhancementBonus) * multiplier);
    return [key, Math.max(1, unlocked ? enhanced : Math.min(99, enhanced))];
  }));
  return {level,bond,enhancementBonus,attributes,overall:Math.round((Number(player.overall) + enhancementBonus) * multiplier)};
}
