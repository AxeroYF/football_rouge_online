import { normalizePlayerSchema } from "../game/public/schema.js";
import { LEGEND_PROFILES } from "../game/public/legends.js";
import { legendAbilityForName } from "./legend-abilities.js";
import { S4_PLAYER_DATABASE } from "./player-pool-s4-generated.js";
import { isXPlayer, X_PLAYER_BY_ID, X_PLAYERS } from "./x-player-pool.js";

export const VERSUS_LINES = Object.freeze({
  GK: Object.freeze({ label: "门将", roles: ["GK"] }),
  DEF: Object.freeze({ label: "后场", roles: ["CB", "LB", "RB"] }),
  MID: Object.freeze({ label: "中场", roles: ["DM", "AM", "LM", "RM"] }),
  ATT: Object.freeze({ label: "前场", roles: ["ST", "LW", "RW"] }),
});

export const VERSUS_PLAYER_GRADE_WEIGHTS = Object.freeze({ S: 0.12, A: 0.62, B: 1, C: 1.55 });
const VERSUS_LEGEND_NAMES = new Set(LEGEND_PROFILES.map((profile) => profile.name));

export const VERSUS_PLAYER_BALANCE_TARGETS = Object.freeze({
  GK: Object.freeze({ S: 1, A: 12, B: 23, C: 19 }),
  DEF: Object.freeze({ S: 1, A: 35, B: 70, C: 59 }),
  MID: Object.freeze({ S: 5, A: 35, B: 70, C: 55 }),
  ATT: Object.freeze({ S: 7, A: 35, B: 70, C: 53 }),
});

export function versusPlayerGrade(name, overall) {
  if (VERSUS_LEGEND_NAMES.has(name)) return "S";
  if (overall >= 86) return "A";
  if (overall >= 80) return "B";
  return "C";
}

function buildPlayer(candidate, index) {
  const overall = candidate.suggestedOverall;
  const normalized = normalizePlayerSchema({
    id: candidate.id,
    name: candidate.displayNameZh,
    role: candidate.role,
    secondaryRole: candidate.secondaryRole,
    preferredFoot: candidate.preferredFoot,
    heightCm: candidate.heightCm,
    attributes: candidate.attributes,
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
    overall,
    referenceOverall: candidate.referenceOverall,
    grade: candidate.suggestedGrade,
    weakFoot: candidate.weakFoot,
    skillMoves: candidate.skillMoves,
    referenceAttributes: { ...candidate.referenceAttributes },
    signature: candidate.isLegend ? "传奇能力" : null,
    archetype: candidate.isLegend ? "传奇球员" : null,
    individualized: candidate.isLegend,
    legendary: candidate.suggestedGrade === "S",
    legendAbility: legendAbilityForName(candidate.displayNameZh),
    localizationConfidence: candidate.localizationConfidence,
    traits: [],
  };
}

const expectedPools = Object.keys(VERSUS_LINES);
const grouped = Object.fromEntries(expectedPools.map((pool) => [pool, []]));
S4_PLAYER_DATABASE.forEach((candidate, index) => {
  if (!grouped[candidate.pool]) throw new Error(`unknown S4 player pool: ${candidate.pool}`);
  grouped[candidate.pool].push(buildPlayer(candidate, index));
});

for (const pool of expectedPools) {
  const players = grouped[pool];
  const expected = Object.values(VERSUS_PLAYER_BALANCE_TARGETS[pool]).reduce((sum, count) => sum + count, 0);
  if (players.length !== expected) {
    throw new Error(`${pool} player pool must contain exactly ${expected} players, received ${players.length}`);
  }
  for (const grade of ["S", "A", "B", "C"]) {
    const actual = players.filter((player) => player.grade === grade).length;
    const target = VERSUS_PLAYER_BALANCE_TARGETS[pool][grade];
    if (actual !== target) throw new Error(`${pool} ${grade} target is ${target}, received ${actual}`);
  }
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
