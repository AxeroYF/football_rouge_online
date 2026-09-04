export const PLAYER_PACK_TYPES = Object.freeze({
  LEGENDARY: "legendary-player-pack",
  EXOTIC: "exotic-player-pack",
  RARE: "rare-player-pack",
  COMMON: "common-player-pack",
});

export const LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE = "new-territory-conquest";

export const PLAYER_PACK_GRADE_WEIGHTS = Object.freeze({
  [PLAYER_PACK_TYPES.LEGENDARY]: Object.freeze({ S:35, A:50, B:12, C:3 }),
  [PLAYER_PACK_TYPES.EXOTIC]: Object.freeze({ S:10, A:75, B:13, C:2 }),
  [PLAYER_PACK_TYPES.RARE]: Object.freeze({ S:2, A:8, B:75, C:15 }),
  [PLAYER_PACK_TYPES.COMMON]: Object.freeze({ S:0.2, A:1.8, B:23, C:75 }),
});

function packDefinition(type, name) {
  return Object.freeze({
    type,
    name,
    choiceCount:3,
    gradeWeights:PLAYER_PACK_GRADE_WEIGHTS[type],
  });
}

export const PLAYER_PACK_DEFINITIONS = Object.freeze({
  [PLAYER_PACK_TYPES.LEGENDARY]: packDefinition(PLAYER_PACK_TYPES.LEGENDARY,"传奇球员卡包"),
  [PLAYER_PACK_TYPES.EXOTIC]: packDefinition(PLAYER_PACK_TYPES.EXOTIC,"珍奇球员卡包"),
  [PLAYER_PACK_TYPES.RARE]: packDefinition(PLAYER_PACK_TYPES.RARE,"稀有球员卡包"),
  [PLAYER_PACK_TYPES.COMMON]: packDefinition(PLAYER_PACK_TYPES.COMMON,"普通球员卡包"),
});

export const NEUTRAL_CONQUEST_REWARDS = Object.freeze([
  null,
  Object.freeze({ difficulty:1, gold:2_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:1 }),
  Object.freeze({ difficulty:2, gold:4_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:2 }),
  Object.freeze({ difficulty:3, gold:6_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:3 }),
  Object.freeze({ difficulty:4, gold:8_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:4 }),
  Object.freeze({ difficulty:5, gold:10_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:5 }),
]);

export function neutralConquestRewardForDifficulty(value) {
  const difficulty = Math.max(1, Math.min(5, Math.round(Number(value) || 1)));
  return NEUTRAL_CONQUEST_REWARDS[difficulty];
}
