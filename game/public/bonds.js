export const BOND_DEFINITIONS = Object.freeze([]);
export const BOND_IDS = Object.freeze([]);

const BONUS_LABELS = Object.freeze({
  attack: "进攻",
  midfield: "组织",
  defense: "防守",
  goalkeeping: "门将",
  tempo: "节奏",
  pressing: "逼抢",
  counterAttack: "反击",
  penaltyChance: "造点",
  penaltyConversion: "点球",
  injuryResistance: "抗伤",
  cardAvoidance: "判罚保护",
});

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function normalizeBonuses(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, amount]) => [String(key), Number(amount)])
    .filter(([, amount]) => Number.isFinite(amount)));
}

export function normalizeBondDefinition(bond = {}, index = 0) {
  const rawTiers = Array.isArray(bond.tiers)
    ? bond.tiers
    : (bond.thresholds ?? []).map((threshold, tierIndex) => ({ threshold, bonuses: bond.bonuses?.[tierIndex] ?? {} }));
  const tiers = rawTiers
    .map((tier) => ({
      threshold: Math.max(1, Math.round(Number(tier?.threshold) || 1)),
      bonuses: normalizeBonuses(tier?.bonuses ?? tier?.effects),
      effectText: String(tier?.effectText ?? tier?.description ?? ""),
    }))
    .sort((left, right) => left.threshold - right.threshold);
  return {
    id: String(bond.id || `bond-${index + 1}`),
    name: String(bond.name || `新羁绊 ${index + 1}`),
    short: String(bond.short || bond.name || "羁绊").slice(0, 4),
    description: String(bond.description || ""),
    traitIds: uniqueStrings(bond.traitIds),
    tiers: tiers.length ? tiers : [{ threshold: 2, bonuses: {}, effectText: "" }],
  };
}

export function normalizeBondDefinitions(definitions = []) {
  const seen = new Set();
  return (Array.isArray(definitions) ? definitions : []).map(normalizeBondDefinition).filter((bond) => {
    if (seen.has(bond.id)) return false;
    seen.add(bond.id);
    return true;
  });
}

export function inferTraitBondIds(trait = {}, definitions = []) {
  const id = String(trait.id ?? "");
  return normalizeBondDefinitions(definitions).filter((bond) => bond.traitIds.includes(id)).map((bond) => bond.id);
}

export function withInferredTraitBonds(trait, definitions = []) {
  return { ...trait, bondIds: inferTraitBondIds(trait, definitions) };
}

function playerTraitIds(player) {
  if (Array.isArray(player?.traitCards)) return player.traitCards.map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean);
  return (player?.traits ?? []).map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean);
}

export function computeTeamBonds(players = [], traitCatalog = [], definitions = []) {
  const bonds = normalizeBondDefinitions(definitions);
  const catalogIds = new Set((traitCatalog ?? []).map((trait) => trait.id));
  return bonds.map((definition) => {
    const allowed = new Set(definition.traitIds.filter((id) => catalogIds.has(id)));
    const carriers = players.filter((player) => playerTraitIds(player).some((id) => allowed.has(id))).length;
    const cardCount = players.reduce((count, player) => count + playerTraitIds(player).filter((id) => allowed.has(id)).length, 0);
    let tier = 0;
    definition.tiers.forEach((entry, index) => { if (carriers >= entry.threshold) tier = index + 1; });
    const nextThreshold = definition.tiers[tier]?.threshold ?? null;
    return {
      ...definition,
      thresholds: definition.tiers.map((entry) => entry.threshold),
      carriers,
      cardCount,
      tier,
      active: tier > 0,
      nextThreshold,
      bonus: tier > 0 ? definition.tiers[tier - 1].bonuses : {},
      effectText: tier > 0 ? definition.tiers[tier - 1].effectText : "",
    };
  }).filter((bond) => bond.carriers > 0).sort((left, right) => right.tier - left.tier || right.carriers - left.carriers || left.name.localeCompare(right.name, "zh-CN"));
}

export function sumBondBonuses(bonds = []) {
  return bonds.reduce((total, bond) => {
    for (const [key, value] of Object.entries(bond.bonus ?? {})) {
      if (Number.isFinite(Number(value))) total[key] = (total[key] ?? 0) + Number(value);
    }
    return total;
  }, { attack: 0, midfield: 0, defense: 0, goalkeeping: 0, tempo: 0 });
}

export function bondBonusText(bonus = {}, effectText = "") {
  const entries = Object.entries(bonus).filter(([, value]) => Number(value));
  const numeric = entries.map(([key, value]) => `${BONUS_LABELS[key] ?? key}${Number(value) > 0 ? "+" : ""}${value}`).join(" · ");
  return [String(effectText || "").trim(), numeric].filter(Boolean).join(" · ") || "已激活，无数值效果";
}
