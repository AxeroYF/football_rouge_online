import { representativePlayers } from "./representative-players.mjs";
export const PLAYER_SQUAD_SCHEMA_VERSION = 2;
export const EXPEDITION_MAX_PLAYERS = 22;

export const PLAYER_SQUAD_IDS = Object.freeze({
  EXPEDITION:"expedition",
  GARRISON:"garrison",
});

export const PLAYER_SQUAD_DEFINITIONS = Object.freeze([
  Object.freeze({ id:PLAYER_SQUAD_IDS.EXPEDITION, name:"远征" }),
  Object.freeze({ id:PLAYER_SQUAD_IDS.GARRISON, name:"留守" }),
]);

const PLAYER_SQUAD_ID_SET = new Set(PLAYER_SQUAD_DEFINITIONS.map((squad) => squad.id));

export function isPlayerSquadId(value) {
  return PLAYER_SQUAD_ID_SET.has(String(value ?? ""));
}

export function normalizePlayerSquads(value, roster = []) {
  const rosterIds = (Array.isArray(roster) ? roster : []).map((player) => String(player?.id ?? player?.playerId ?? "")).filter(Boolean);
  const source = value?.assignments && typeof value.assignments === "object" ? value.assignments : {};
  const assignments = Object.fromEntries(rosterIds.map((playerId) => [
    playerId,
    String(source[playerId]) === PLAYER_SQUAD_IDS.EXPEDITION
      ? PLAYER_SQUAD_IDS.EXPEDITION
      : PLAYER_SQUAD_IDS.GARRISON,
  ]));
  return { schemaVersion:PLAYER_SQUAD_SCHEMA_VERSION, assignments };
}

export function expeditionPlayerCount(value, roster = []) {
  const { assignments } = normalizePlayerSquads(value, roster);
  return representativePlayers(roster).filter(player => assignments[String(player.id ?? player.playerId)] === PLAYER_SQUAD_IDS.EXPEDITION).length;
}

export function assertExpeditionCapacity(value, roster = []) {
  if (expeditionPlayerCount(value, roster) > EXPEDITION_MAX_PLAYERS) {
    throw Object.assign(new Error(`远征队最多 ${EXPEDITION_MAX_PLAYERS} 人（含首发与替补），请先将多余球员调至留守队`), { statusCode:400 });
  }
}

const REQUIRED_SQUAD_POOLS = Object.freeze(["GK","DEF","MID","ATT"]);

function playerOverall(player) {
  return Number(player?.effectiveOverall ?? player?.overall ?? 0);
}

function squadReadiness(players, minimumSize) {
  const pools = Object.fromEntries(REQUIRED_SQUAD_POOLS.map((pool) => [pool,players.filter((player) => player?.pool === pool).length]));
  return { count:players.length, pools, ready:players.length >= minimumSize && REQUIRED_SQUAD_POOLS.every((pool) => pools[pool] >= 1) };
}

export function autoCompletePlayerSquads(value, roster = [], { minimumSize = 11, allowTransfers = true } = {}) {
  const players = representativePlayers(Array.isArray(roster) ? roster.filter((player) => player?.id ?? player?.playerId) : []);
  const normalized = normalizePlayerSquads(value,roster);
  const assignments = { ...normalized.assignments };
  const playerId = (player) => String(player?.id ?? player?.playerId);
  const squadPlayers = (squadId) => players.filter((player) => assignments[playerId(player)] === squadId);
  const available = players
    .filter((player) => assignments[playerId(player)] === PLAYER_SQUAD_IDS.GARRISON)
    .sort((left,right) => playerOverall(right)-playerOverall(left) || String(left.name ?? playerId(left)).localeCompare(String(right.name ?? playerId(right)),"zh-CN"));
  const autoAssignedPlayerIds = [];
  const canMoveToExpedition = (candidate) => {
    if (candidate.training || candidate.coalitionLoan || squadPlayers(PLAYER_SQUAD_IDS.EXPEDITION).length >= EXPEDITION_MAX_PLAYERS) return false;
    const remaining = available.filter((player) => player !== candidate);
    return squadReadiness(remaining,minimumSize).ready;
  };
  while (allowTransfers && !squadReadiness(squadPlayers(PLAYER_SQUAD_IDS.EXPEDITION),minimumSize).ready) {
    const current = squadReadiness(squadPlayers(PLAYER_SQUAD_IDS.EXPEDITION),minimumSize);
    const missingPool = REQUIRED_SQUAD_POOLS.find((pool) => current.pools[pool] < 1);
    const candidateIndex = available.findIndex((player) => (!missingPool || player.pool === missingPool) && canMoveToExpedition(player));
    if (candidateIndex < 0) break;
    const [candidate] = available.splice(candidateIndex,1);
    const id = playerId(candidate);
    assignments[id] = PLAYER_SQUAD_IDS.EXPEDITION;
    autoAssignedPlayerIds.push(id);
  }
  const readiness = Object.fromEntries(PLAYER_SQUAD_DEFINITIONS.map((squad) => [squad.id,squadReadiness(squadPlayers(squad.id),minimumSize)]));
  if (readiness.expedition.count > EXPEDITION_MAX_PLAYERS) readiness.expedition.ready = false;
  return {
    playerSquads:{ schemaVersion:PLAYER_SQUAD_SCHEMA_VERSION, assignments },
    readiness,
    ready:PLAYER_SQUAD_DEFINITIONS.every((squad) => readiness[squad.id].ready),
    autoAssignedPlayerIds,
  };
}
