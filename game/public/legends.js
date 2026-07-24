import { roleGroup } from "./core.js";
import { normalizePlayerSchema } from "./schema.js";

export const LEGEND_ROLL_CHANCE = 0.04;
export const REWARD_LEGEND_ROLL_CHANCE = 0.06;
export const LEGEND_PITY_LIMIT = 10;
export const LEGEND_MATCH_LIMIT = 10;

const LEGEND_PITY_CONFIG = Object.freeze({
  shop: { baseChance: LEGEND_ROLL_CHANCE, step: 0.03, maximumChance: 0.28 },
  reward: { baseChance: REWARD_LEGEND_ROLL_CHANCE, step: 0.04, maximumChance: 0.38 },
});

export function legendPitySettings(misses = 0, source = "shop") {
  const config = LEGEND_PITY_CONFIG[source] ?? LEGEND_PITY_CONFIG.shop;
  const missCount = Math.max(0, Math.min(LEGEND_PITY_LIMIT - 1, Math.floor(Number(misses) || 0)));
  const guaranteed = missCount >= LEGEND_PITY_LIMIT - 1;
  return {
    source,
    misses: missCount,
    round: missCount + 1,
    limit: LEGEND_PITY_LIMIT,
    guaranteed,
    chance: guaranteed ? 1 : Math.min(config.maximumChance, config.baseChance + config.step * missCount),
  };
}

export const LEGEND_PROFILES = Object.freeze([
  {
    id: "messi",
    name: "梅西",
    role: "RW",
    secondaryRole: "ST",
    preferredFoot: "left",
    height: 170,
    quirk: "左脚魔法师 · 狭小空间仍能完成致命处理",
    attributes: { attack: 96, passing: 95, defense: 40, pace: 90, stamina: 82, composure: 98, goalkeeping: 12, aggression: 52 },
  },
  {
    id: "mbappe",
    name: "姆巴佩",
    role: "LW",
    secondaryRole: "ST",
    preferredFoot: "right",
    height: 178,
    quirk: "纵深终结者 · 第一脚启动撕开防线",
    attributes: { attack: 96, passing: 86, defense: 42, pace: 98, stamina: 89, composure: 94, goalkeeping: 11, aggression: 64 },
  },
  {
    id: "cristiano-ronaldo",
    name: "C罗",
    role: "ST",
    secondaryRole: "LW",
    preferredFoot: "right",
    height: 187,
    quirk: "禁区统治者 · 关键时刻永远相信下一次射门",
    attributes: { attack: 97, passing: 85, defense: 45, pace: 91, stamina: 88, composure: 98, goalkeeping: 13, aggression: 80 },
  },
  {
    id: "courtois",
    name: "库尔图瓦",
    role: "GK",
    secondaryRole: null,
    preferredFoot: "left",
    height: 200,
    quirk: "高塔门神 · 超大覆盖面积与近距离反应",
    attributes: { attack: 38, passing: 80, defense: 84, pace: 62, stamina: 84, composure: 95, goalkeeping: 97, aggression: 54 },
  },
  {
    id: "haaland",
    name: "哈兰德",
    role: "ST",
    secondaryRole: "RW",
    preferredFoot: "left",
    height: 195,
    quirk: "重型冲锋 · 速度、力量与终结合为一次撞击",
    attributes: { attack: 98, passing: 78, defense: 48, pace: 93, stamina: 92, composure: 94, goalkeeping: 11, aggression: 84 },
  },
  {
    id: "modric",
    name: "莫德里奇",
    role: "RM",
    secondaryRole: "DM",
    preferredFoot: "right",
    height: 172,
    quirk: "节拍大师 · 用观察和外脚背改变进攻方向",
    attributes: { attack: 84, passing: 97, defense: 79, pace: 80, stamina: 91, composure: 98, goalkeeping: 15, aggression: 66 },
  },
  {
    id: "kroos",
    name: "克罗斯",
    role: "DM",
    secondaryRole: "LM",
    preferredFoot: "right",
    height: 183,
    quirk: "精密校准 · 传球线路像预先画在草皮上",
    attributes: { attack: 83, passing: 98, defense: 76, pace: 70, stamina: 87, composure: 99, goalkeeping: 14, aggression: 60 },
  },
  {
    id: "pele",
    name: "贝利",
    role: "ST",
    secondaryRole: "AM",
    preferredFoot: "right",
    height: 173,
    quirk: "球王全能 · 无球、盘带和终结都能改变比赛",
    attributes: { attack: 99, passing: 91, defense: 45, pace: 94, stamina: 88, composure: 99, goalkeeping: 10, aggression: 62 },
  },
  {
    id: "zidane",
    name: "齐达内",
    role: "AM",
    secondaryRole: "DM",
    preferredFoot: "both",
    height: 185,
    quirk: "天鹅绒触球 · 在压力中掌控节奏并送出最后一传",
    attributes: { attack: 91, passing: 98, defense: 68, pace: 78, stamina: 84, composure: 99, goalkeeping: 10, aggression: 60 },
  },
  {
    id: "beckenbauer",
    name: "贝肯鲍尔",
    role: "CB",
    secondaryRole: "DM",
    preferredFoot: "right",
    height: 181,
    quirk: "自由人 · 从防线发起进攻并预判化解威胁",
    attributes: { attack: 72, passing: 95, defense: 98, pace: 82, stamina: 90, composure: 99, goalkeeping: 14, aggression: 72 },
  },
  {
    id: "ronaldo-nazario",
    name: "大罗",
    role: "ST",
    secondaryRole: "LW",
    preferredFoot: "right",
    height: 183,
    quirk: "外星人 · 爆发、力量与终结融为无法阻挡的推进",
    attributes: { attack: 99, passing: 88, defense: 38, pace: 98, stamina: 84, composure: 98, goalkeeping: 10, aggression: 68 },
  },
  {
    id: "ronaldinho",
    name: "罗纳尔迪尼奥",
    role: "AM",
    secondaryRole: "LW",
    preferredFoot: "right",
    height: 182,
    quirk: "即兴魔法 · 用不可预测的触球拆解整条防线",
    attributes: { attack: 94, passing: 97, defense: 42, pace: 91, stamina: 82, composure: 98, goalkeeping: 10, aggression: 50 },
  },
  {
    id: "maradona",
    name: "马拉多纳",
    role: "ST",
    secondaryRole: "AM",
    preferredFoot: "left",
    height: 165,
    quirk: "球场上帝 · 重心、盘带和创造力主宰比赛",
    attributes: { attack: 99, passing: 98, defense: 45, pace: 94, stamina: 88, composure: 99, goalkeeping: 10, aggression: 74 },
  },
  {
    id: "beckham",
    name: "贝克汉姆",
    role: "RM",
    secondaryRole: "DM",
    preferredFoot: "right",
    height: 183,
    quirk: "圆月弯刀 · 精确制导的传中与定位球改变比赛",
    attributes: { attack: 87, passing: 98, defense: 72, pace: 78, stamina: 92, composure: 96, goalkeeping: 12, aggression: 62 },
  },
]);

function fitsLegendRole(trait, role) {
  const roles = trait?.eligibleRoleGroups ?? [];
  return roles.includes("ANY") || roles.includes(role) || roles.includes(roleGroup(role));
}

function takeRandom(pool, rng) {
  if (!pool.length) return null;
  return pool.splice(Math.floor(rng() * pool.length), 1)[0];
}

function choosePowerTraits(profile, catalog, rng) {
  const strong = catalog.filter((trait) => ["epic", "legendary"].includes(trait.rarity));
  const compatible = strong.filter((trait) => fitsLegendRole(trait, profile.role));
  const fallback = strong.filter((trait) => !compatible.includes(trait));
  const allOther = catalog.filter((trait) => !compatible.includes(trait) && !fallback.includes(trait));
  const picked = [];
  for (const pool of [compatible, fallback, allOther]) {
    while (pool.length && picked.length < 3) {
      const trait = takeRandom(pool, rng);
      if (trait && !picked.some((item) => item.id === trait.id)) picked.push(trait);
    }
  }
  return picked;
}

export function createLegendPlayer(profile, catalog = [], rng = Math.random, index = 0) {
  const traits = choosePowerTraits(profile, catalog, rng);
  return normalizePlayerSchema({
    id: `legend-${profile.id}-${Date.now().toString(36)}-${index}-${Math.floor(rng() * 10000)}`,
    legendary: true,
    legendId: profile.id,
    name: profile.name,
    role: profile.role,
    secondaryRole: profile.secondaryRole,
    preferredFoot: profile.preferredFoot,
    attributes: { ...profile.attributes, height: profile.height, fitness: 100 },
    heightCm: profile.height,
    state: { fitness: 100, form: 88, morale: 90, injuryProneness: 10 },
    hidden: { mentality: 96, injuryResistance: 90, emergencyGoalkeeper: profile.role === "GK" ? 100 : 40 },
    quirk: profile.quirk,
    traits: traits.map((trait) => ({ id: trait.id, innate: true, locked: true })),
    legendMatchesRemaining: LEGEND_MATCH_LIMIT,
  }, { index });
}

export function rollLegend(catalog, rng = Math.random, unavailableIds = [], reservedIds = [], index = 0, chance = LEGEND_ROLL_CHANCE) {
  const effectiveChance = Math.max(0, Math.min(1, Number(chance) || 0));
  if (rng() >= effectiveChance) return null;
  const excluded = new Set([...unavailableIds, ...reservedIds]);
  const available = LEGEND_PROFILES.filter((profile) => !excluded.has(profile.id));
  if (!available.length) return null;
  const profile = available[Math.floor(rng() * available.length)];
  return createLegendPlayer(profile, catalog, rng, index);
}
