import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { REAL_PLAYER_BY_ID } from "./player-pool.js";
import { VERSUS_TRAIT_BY_ID } from "./trait-pool.js";
import { VERSUS_FOCUSES, VERSUS_STYLES, VERSUS_TACTICS, VERSUS_TEAM_SIZE, sanitizePositions } from "./rules.js";

const SEED_PREFIX = "FT11-1";
const MAX_SEED_LENGTH = 4_000;
const MAX_PAYLOAD_LENGTH = 16_384;

function checksum(buffer) {
  return createHash("sha256").update(SEED_PREFIX).update(buffer).digest("base64url").slice(0, 16);
}

function traitFitsPlayer(trait, player) {
  const eligible = trait.eligibleRoleGroups ?? [];
  return eligible.includes("ANY") || eligible.includes(player.pool) || eligible.includes(player.role);
}

function normalizeLineup(data = {}) {
  if (!Array.isArray(data.selections) || data.selections.length !== VERSUS_TEAM_SIZE) throw new Error("阵容种子必须包含 11 名球员");
  const playerIds = data.selections.map((selection) => String(selection?.playerId ?? ""));
  if (new Set(playerIds).size !== VERSUS_TEAM_SIZE) throw new Error("阵容种子包含重复球员");
  const selections = data.selections.map((selection) => {
    const player = REAL_PLAYER_BY_ID[selection.playerId];
    if (!player) throw new Error("阵容种子包含不存在的球员");
    if (!Array.isArray(selection.traitIds) || selection.traitIds.length !== 1) throw new Error(`${player.name}的自带特性无效`);
    const trait = VERSUS_TRAIT_BY_ID[selection.traitIds[0]];
    if (!trait || !traitFitsPlayer(trait, player)) throw new Error(`${player.name}的自带特性不适配`);
    return { playerId: player.id, traitIds: [trait.id] };
  });
  const goalkeeperCount = selections.filter((selection) => REAL_PLAYER_BY_ID[selection.playerId].pool === "GK").length;
  if (goalkeeperCount !== 1) throw new Error("阵容种子必须且只能包含一名门将");
  if (!VERSUS_TACTICS.includes(data.tactic)) throw new Error("阵容种子中的比赛思路无效");
  if (!VERSUS_STYLES.includes(data.style)) throw new Error("阵容种子中的比赛战术无效");
  const attackFocus = data.attackFocus ?? "balanced";
  const defenseFocus = data.defenseFocus ?? "balanced";
  if (!VERSUS_FOCUSES.includes(attackFocus) || !VERSUS_FOCUSES.includes(defenseFocus)) throw new Error("阵容种子中的攻守方向无效");
  const players = selections.map((selection) => REAL_PLAYER_BY_ID[selection.playerId]);
  return {
    selections,
    positions: sanitizePositions(players, data.positions),
    tactic: data.tactic,
    style: data.style,
    attackFocus,
    defenseFocus,
  };
}

export function createLineupSeed(data, options = {}) {
  const lineup = normalizeLineup(data);
  const payload = {
    v: 1,
    n: options.nonce ?? randomBytes(6).toString("base64url"),
    p: lineup.selections.map((selection) => [selection.playerId, selection.traitIds[0]]),
    x: lineup.selections.map((selection) => {
      const position = lineup.positions[selection.playerId];
      return [position.x, position.y];
    }),
    t: lineup.tactic,
    s: lineup.style,
    a: lineup.attackFocus,
    d: lineup.defenseFocus,
  };
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  return `${SEED_PREFIX}.${compressed.toString("base64url")}.${checksum(compressed)}`;
}

export function parseLineupSeed(value) {
  const seed = String(value ?? "").trim();
  if (!seed || seed.length > MAX_SEED_LENGTH) throw new Error("阵容种子码格式无效");
  const [prefix, encoded, suppliedChecksum, ...extra] = seed.split(".");
  if (prefix !== SEED_PREFIX || !encoded || !suppliedChecksum || extra.length) throw new Error("阵容种子码格式无效");
  let compressed;
  try {
    compressed = Buffer.from(encoded, "base64url");
  } catch {
    throw new Error("阵容种子码格式无效");
  }
  const expectedChecksum = checksum(compressed);
  const supplied = Buffer.from(suppliedChecksum);
  const expected = Buffer.from(expectedChecksum);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("阵容种子码校验失败");
  let payload;
  try {
    payload = JSON.parse(inflateRawSync(compressed, { maxOutputLength: MAX_PAYLOAD_LENGTH }).toString("utf8"));
  } catch {
    throw new Error("阵容种子码内容损坏");
  }
  if (payload?.v !== 1 || !Array.isArray(payload.p) || !Array.isArray(payload.x) || payload.p.length !== payload.x.length) throw new Error("阵容种子码版本或内容无效");
  return normalizeLineup({
    selections: payload.p.map(([playerId, traitId]) => ({ playerId, traitIds: [traitId] })),
    positions: Object.fromEntries(payload.p.map(([playerId], index) => [playerId, { x:payload.x[index]?.[0], y:payload.x[index]?.[1] }])),
    tactic: payload.t,
    style: payload.s,
    attackFocus: payload.a ?? "balanced",
    defenseFocus: payload.d ?? "balanced",
  });
}
