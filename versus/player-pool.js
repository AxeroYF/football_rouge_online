import { normalizePlayerSchema, PLAYER_OVERALL_ATTRIBUTE_KEYS, playerOverallFromAttributes, roleGroup } from "../game/public/schema.js";
import { LEGEND_PROFILES } from "../game/public/legends.js";
import { legendAbilityForName } from "./legend-abilities.js";
import { S4_PLAYER_DATABASE } from "./player-pool-s4-generated.js";
import { S4_DLC_PLAYER_DATABASE } from "./player-pool-s4-dlc-generated.js";
import { isXPlayer, X_PLAYER_BY_ID, X_PLAYERS } from "./x-player-pool.js";

export const VERSUS_LINES = Object.freeze({
  GK: Object.freeze({ label: "门将", roles: ["GK"] }),
  DEF: Object.freeze({ label: "后场", roles: ["CB", "LB", "RB"] }),
  MID: Object.freeze({ label: "中场", roles: ["DM", "AM", "LM", "RM"] }),
  ATT: Object.freeze({ label: "前场", roles: ["ST", "LW", "RW"] }),
});

export const VERSUS_PLAYER_GRADE_WEIGHTS = Object.freeze({ S: 0.12, A: 0.62, B: 1, C: 1.55 });
const VERSUS_LEGEND_NAMES = new Set(LEGEND_PROFILES.map((profile) => profile.name));
export const S4_PLAYER_DEFAULT_ATTRIBUTE_CAP = 96;
export const S4_LEGEND_DEFAULT_ATTRIBUTE_CAP = S4_PLAYER_DEFAULT_ATTRIBUTE_CAP;

function attributesForOverall(attributes, role, overall, maximum = S4_PLAYER_DEFAULT_ATTRIBUTE_CAP) {
  const normalized = Object.fromEntries(Object.entries(attributes ?? {}).map(([key, rawValue]) => [
    key,
    Math.max(1, Math.min(maximum, Math.round(Number(rawValue) || 1))),
  ]));
  const keys = PLAYER_OVERALL_ATTRIBUTE_KEYS[roleGroup(role)] ?? PLAYER_OVERALL_ATTRIBUTE_KEYS.ATT;
  const targetOverall = Math.min(maximum, Math.round(Number(overall) || 1));
  const targetSum = targetOverall * keys.length;
  let currentSum = keys.reduce((sum, key) => sum + Number(normalized[key] ?? 1), 0);
  while (currentSum < targetSum) {
    const key = keys.filter((candidate) => normalized[candidate] < maximum).sort((left, right) => normalized[left] - normalized[right])[0];
    if (!key) break;
    normalized[key] += 1;
    currentSum += 1;
  }
  while (currentSum > targetSum) {
    const key = keys.filter((candidate) => normalized[candidate] > 1).sort((left, right) => normalized[right] - normalized[left])[0];
    if (!key) break;
    normalized[key] -= 1;
    currentSum -= 1;
  }
  return normalized;
}

export function normalizedGameAttributes(attributes, role, overall, referenceOverall = overall) {
  const targetOverall = Math.min(S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, Math.round(Number(overall) || 1));
  const sourceOverall = Math.round(Number(referenceOverall) || targetOverall);
  const adjustment = targetOverall - sourceOverall;
  const gameAttributes = Object.fromEntries(Object.entries(attributes ?? {}).map(([key, rawValue]) => [
    key,
    Math.max(1, Math.min(S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, Math.round(Number(rawValue) || 1) + adjustment)),
  ]));
  return attributesForOverall(gameAttributes, role, targetOverall);
}

export function normalizedS4LegendAttributes(attributes, role, overall) {
  return attributesForOverall(attributes, role, overall);
}

export const VERSUS_PLAYER_BALANCE_TARGETS = Object.freeze({
  GK: Object.freeze({ S: 1, A: 12, B: 23, C: 19 }),
  DEF: Object.freeze({ S: 1, A: 35, B: 70, C: 59 }),
  MID: Object.freeze({ S: 5, A: 35, B: 70, C: 55 }),
  ATT: Object.freeze({ S: 8, A: 35, B: 70, C: 53 }),
});

export function versusPlayerGrade(name, overall) {
  if (VERSUS_LEGEND_NAMES.has(name) || overall >= 90) return "S";
  if (overall >= 86) return "A";
  if (overall >= 80) return "B";
  return "C";
}

function buildPlayer(candidate, index) {
  const legendary = candidate.suggestedGrade === "S";
  const overall = Math.min(S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, candidate.suggestedOverall);
  const attributes = normalizedGameAttributes(candidate.attributes, candidate.role, overall, candidate.referenceOverall);
  const normalized = normalizePlayerSchema({
    id: candidate.id,
    name: candidate.displayNameZh,
    role: candidate.role,
    secondaryRole: candidate.secondaryRole,
    preferredFoot: candidate.preferredFoot,
    heightCm: candidate.heightCm,
    attributes,
    state: { fitness: 100, form: 50, morale: 70 },
    development: {
      age: candidate.age ?? 27,
      potential: Math.max(overall, candidate.referenceOverall ?? overall),
    },
    source: candidate.sourceDataset,
    nationality: candidate.nationality,
    club: candidate.club,
    cardFamilyId: `player-family-${candidate.sourceId}`,
    cardVersion: "S4-base",
    baseOverall: overall,
    upgradeLevel: 0,
    upgradeBonus: 0,
    canHaveDuplicates: true,
  }, { index });

  const legendAbility = legendAbilityForName(candidate.displayNameZh)
    ?? (legendary ? {
      id:`dlc-legend-${candidate.id}`,
      name:"传奇球员",
      summary:"S4 DLC 传奇球员；当前使用通用传奇标识，后续可配置专属传奇能力。",
    } : null);

  return {
    ...normalized,
    sourceName: candidate.sourceName,
    sourceId: candidate.sourceId,
    sourceUrl: candidate.sourceUrl,
    sourceNationality: candidate.sourceNationality,
    sourceClub: candidate.sourceClub,
    nationality: candidate.nationality,
    club: candidate.club,
    pool: candidate.pool,
    role: candidate.role,
    secondaryRole: candidate.secondaryRole,
    overall,
    referenceOverall: candidate.referenceOverall,
    grade: candidate.suggestedGrade,
    weakFoot: candidate.weakFoot,
    skillMoves: candidate.skillMoves,
    referenceAttributes: { ...attributes },
    signature: legendary ? "传奇能力" : null,
    archetype: legendary ? "传奇球员" : null,
    individualized: legendary,
    legendary,
    legendAbility,
    localizationConfidence: candidate.localizationConfidence,
    isDlc: candidate.isDlc === true,
    dlcBatch: candidate.dlcBatch ?? null,
    traits: [],
  };
}

const expectedPools = Object.keys(VERSUS_LINES);
const grouped = Object.fromEntries(expectedPools.map((pool) => [pool, []]));
const dlcIds = new Set(S4_DLC_PLAYER_DATABASE.map((candidate) => candidate.id));
const playerDatabase = [
  ...S4_PLAYER_DATABASE.filter((candidate) => !dlcIds.has(candidate.id)),
  ...S4_DLC_PLAYER_DATABASE,
];
playerDatabase.forEach((candidate, index) => {
  if (!grouped[candidate.pool]) throw new Error(`unknown S4 player pool: ${candidate.pool}`);
  grouped[candidate.pool].push(buildPlayer(candidate, index));
});

const messiTemplate = grouped.ATT.find((player) => player.id === "legend-messi");
if (!messiTemplate) throw new Error("梅老鼠需要梅西作为模板");
grouped.ATT.push({
  ...messiTemplate,
  id:"legend-messi-rat",
  name:"梅老鼠",
  sourceName:"梅老鼠",
  sourceId:"messi-rat",
  cardFamilyId:"player-family-messi-rat",
  attributes:{ ...messiTemplate.attributes },
  referenceAttributes:{ ...messiTemplate.referenceAttributes },
  state:{ ...messiTemplate.state },
  development:{ ...messiTemplate.development },
  legendAbility:messiTemplate.legendAbility ? { ...messiTemplate.legendAbility } : null,
  traits:[...(messiTemplate.traits ?? [])],
});

for (const player of Object.values(grouped).flat()) {
  if (Object.values(player.attributes).some((value) => Number(value) > S4_PLAYER_DEFAULT_ATTRIBUTE_CAP)) throw new Error(`S4球员基础能力超过${S4_PLAYER_DEFAULT_ATTRIBUTE_CAP}: ${player.name}`);
  if (playerOverallFromAttributes(player.attributes, player.role) !== player.overall) throw new Error(`S4球员能力未回归OVR: ${player.name}`);
}

export const REAL_PLAYER_POOLS = Object.freeze(Object.fromEntries(
  expectedPools.map((pool) => [pool, grouped[pool]]),
));
export const REAL_PLAYERS = Object.freeze([...Object.values(REAL_PLAYER_POOLS).flat(), ...X_PLAYERS]);
export const REAL_PLAYER_BY_ID = Object.freeze({ ...Object.fromEntries(REAL_PLAYERS.map((player) => [player.id, player])), ...X_PLAYER_BY_ID });

export function isS4Legend(player) {
  return player?.grade === "S";
}

export { isXPlayer, X_PLAYERS };

export function moveRealPlayerToPool(player, pool) {
  if (!player || !REAL_PLAYER_BY_ID[player.id]) throw new Error("player does not exist");
  if (!REAL_PLAYER_POOLS[pool]) throw new Error(`unknown player pool: ${pool}`);
  for (const players of Object.values(REAL_PLAYER_POOLS)) {
    const index = players.findIndex((candidate) => candidate.id === player.id);
    if (index >= 0) players.splice(index, 1);
  }
  REAL_PLAYER_POOLS[pool].push(player);
  player.pool = pool;
  return player;
}

export const INDIVIDUALIZED_PLAYERS = Object.freeze(
  REAL_PLAYERS.filter((player) => player.individualized)
    .sort((left, right) => right.overall - left.overall || left.id.localeCompare(right.id)),
);
