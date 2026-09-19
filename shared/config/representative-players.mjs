import { enhancementFamily } from "./enhancement.mjs";

export function totalTrainingGain(player) {
  return Object.values(player.trainingBonuses ?? {}).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

// Keep actual card instances intact. Only team/lineup views use this projection.
export function representativePlayers(roster = [], {includeLoans=true} = {}) {
  const best = new Map();
  for (const player of roster) {
    if(!includeLoans&&player.coalitionLoan)continue;
    const family = enhancementFamily(player), current = best.get(family);
    const level = Number(player.upgradeLevel ?? player.card?.upgradeLevel ?? 0);
    const previousLevel = Number(current?.upgradeLevel ?? current?.card?.upgradeLevel ?? 0);
    if (!current || level > previousLevel || (level === previousLevel && totalTrainingGain(player) > totalTrainingGain(current))) best.set(family, player);
  }
  return [...best.values()];
}

// Remap only player references, never formation/plan identifiers or the source save.
export function representativeTactics(tactics, roster = []) {
  const best = new Map(representativePlayers(roster).map(player => [enhancementFamily(player), String(player.id ?? player.playerId)]));
  const ids = new Map(roster.map(player => [String(player.id ?? player.playerId), best.get(enhancementFamily(player))]));
  const remap = id => ids.get(String(id)) ?? id;
  const visit = (value, preferred = []) => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(item => visit(item, preferred));
    preferred = value.planSnapshots?.__s4V2?.starters ?? value.starters ?? preferred;
    const rank = id => (preferred.includes(id) ? 2 : 0) + Number(remap(id) === id);
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if ((key === "starters" || key === "bench") && Array.isArray(item)) result[key] = [...new Set(item.map(remap))];
      else if (key === "captainId") result[key] = remap(item);
      else if ((key === "positions" || key === "playerDuties" || /^position[123]$/.test(key)) && item && typeof item === "object") {
        const mapped = {};
        // Preserve an existing starter's slot ahead of a duplicate's bench coordinates.
        for (const [id, data] of Object.entries(item).sort(([a],[b]) => rank(a) - rank(b))) mapped[remap(id)] = structuredClone(data);
        result[key] = mapped;
      } else result[key] = visit(item, preferred);
    }
    return result;
  };
  return visit(tactics);
}
