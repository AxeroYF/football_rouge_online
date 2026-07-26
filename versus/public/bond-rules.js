export const S4_BOND_POOL_MINIMUM = 10;
export const S4_BOND_LINEUP_MINIMUM = 5;
export const S4_BOND_WILDCARD_TRAIT_ID = "lone-finisher";

export const S4_BOND_BONUS_BY_COUNT = Object.freeze({
  5:0.01,
  6:0.015,
  7:0.02,
  8:0.025,
  9:0.03,
  10:0.04,
  11:0.05,
});

const bondTypes = Object.freeze([
  Object.freeze({ type:"nationality", field:"nationality", label:"国家队" }),
  Object.freeze({ type:"club", field:"club", label:"俱乐部" }),
]);

const cleanName = (value) => String(value ?? "").trim();

function playerTraitIds(player) {
  const direct = Array.isArray(player?.traits) ? player.traits : [];
  const activeCard = Array.isArray(player?.cards)
    ? player.cards.find((card) => card.id === player.activeCardId) ?? player.cards[0]
    : null;
  const cardTraits = Array.isArray(activeCard?.traits) ? activeCard.traits : [];
  return new Set([...direct, ...cardTraits].map((trait) => cleanName(typeof trait === "string" ? trait : trait?.id)).filter(Boolean));
}

export function createS4BondCatalog(players, minimum = S4_BOND_POOL_MINIMUM) {
  return bondTypes.flatMap(({ type, field, label }) => {
    const counts = new Map();
    players.forEach((player) => {
      const name = cleanName(player?.[field]);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return [...counts.entries()]
      .filter(([, poolCount]) => poolCount >= minimum)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
      .map(([name, poolCount]) => Object.freeze({ id:`${type}:${name}`, type, field, label, name, poolCount }));
  });
}

export function s4BondBonus(countValue) {
  const count = Math.max(0, Math.min(11, Math.floor(Number(countValue) || 0)));
  return S4_BOND_BONUS_BY_COUNT[count] ?? 0;
}

export function evaluateS4LineupBonds(players, catalog) {
  const lineup = (players ?? []).slice(0, 11);
  const entries = Array.isArray(catalog) ? catalog : [];
  return bondTypes.flatMap(({ type, field, label }) => {
    const available = entries.filter((entry) => entry.type === type);
    if (!available.length) return [];
    const wildcards = lineup.filter((player) => playerTraitIds(player).has(S4_BOND_WILDCARD_TRAIT_ID));
    const regulars = lineup.filter((player) => !playerTraitIds(player).has(S4_BOND_WILDCARD_TRAIT_ID));
    const ranked = available.map((entry) => {
      const members = regulars.filter((player) => cleanName(player?.[field]) === entry.name);
      const count = Math.min(11, members.length + wildcards.length);
      return {
        id:entry.id,
        type,
        label,
        name:entry.name,
        poolCount:entry.poolCount,
        count,
        bonus:s4BondBonus(count),
        memberIds:[...members, ...wildcards].slice(0, count).map((player) => player.id),
        wildcardIds:wildcards.map((player) => player.id),
      };
    }).sort((left, right) => right.count - left.count || right.poolCount - left.poolCount || left.name.localeCompare(right.name, "zh-CN"));
    const strongest = ranked[0];
    return strongest?.count >= S4_BOND_LINEUP_MINIMUM ? [strongest] : [];
  });
}

export function applyS4BondBonuses(players, bonds) {
  const bonusByPlayer = new Map();
  (bonds ?? []).forEach((bond) => bond.memberIds.forEach((id) => {
    bonusByPlayer.set(id, (bonusByPlayer.get(id) ?? 0) + Number(bond.bonus ?? 0));
  }));
  return (players ?? []).map((player) => {
    const bonus = bonusByPlayer.get(player.id) ?? 0;
    if (!bonus) return player;
    return {
      ...player,
      attributes:Object.fromEntries(Object.entries(player.attributes ?? {}).map(([key, value]) => [
        key,
        Number.isFinite(value) ? Math.min(99, Number((value * (1 + bonus)).toFixed(2))) : value,
      ])),
      ydlBondBonus:Number(bonus.toFixed(4)),
      ydlBondIds:(bonds ?? []).filter((bond) => bond.memberIds.includes(player.id)).map((bond) => bond.id),
    };
  });
}
