import { BUILDING_TYPES } from "./shared/config/buildings.mjs";

const indexCache = new WeakMap();

export const OWNER_TYPES = Object.freeze({
  NEUTRAL: "neutral",
  CLUB: "club",
  PLAYER: "player",
});

function metadataById(index) {
  if (!indexCache.has(index)) {
    indexCache.set(index, new Map(index.territories.map((territory) => [territory.territoryId, territory])));
  }
  return indexCache.get(index);
}

function territoryMetadata(index, territoryId) {
  const territory = metadataById(index).get(territoryId);
  if (!territory) throw new Error(`unknown territory: ${territoryId}`);
  return territory;
}

function playerState(world, playerId) {
  const player = world.players[playerId];
  if (!player) throw new Error(`unknown player: ${playerId}`);
  return player;
}

function ensurePlayer(world, playerId) {
  if (!world.players[playerId]) {
    world.players[playerId] = {
      playerId,
      capitalTerritoryId: null,
      territoryIds: [],
      attackLineupId: null,
      defenseLineupId: null,
      exiled: false,
    };
  }
  return world.players[playerId];
}

function removeTerritoryFromPlayer(world, playerId, territoryId) {
  const player = world.players[playerId];
  if (!player) return;
  player.territoryIds = player.territoryIds.filter((id) => id !== territoryId);
  if (player.capitalTerritoryId === territoryId) {
    player.capitalTerritoryId = player.territoryIds[0] ?? null;
  }
  player.exiled = player.territoryIds.length === 0;
}

function addTerritoryToPlayer(world, playerId, territoryId) {
  const player = ensurePlayer(world, playerId);
  if (!player.territoryIds.includes(territoryId)) {
    player.territoryIds.push(territoryId);
    player.territoryIds.sort();
  }
  player.exiled = false;
  return player;
}

export function createTerritoryWorld(index, { seasonId = "season-01" } = {}) {
  const territories = Object.fromEntries(index.territories.map((metadata) => [
    metadata.territoryId,
    {
      territoryId: metadata.territoryId,
      ownerType: metadata.initialOwner.type,
      ownerId: metadata.initialOwner.id,
      capitalOf: null,
      buildings: [],
      protectedUntil: null,
      version: 0,
    },
  ]));
  return {
    schemaVersion: 4,
    seasonId,
    aiGenerationSeed: `${seasonId}-${Math.random().toString(36).slice(2, 12)}`,
    aiGarrisons: {},
    activeChallenges: {},
    territories,
    players: {},
    revision: 0,
  };
}

export function setPlayerLineups(world, playerId, { attackLineupId, defenseLineupId }) {
  const player = ensurePlayer(world, playerId);
  player.attackLineupId = attackLineupId ?? player.attackLineupId;
  player.defenseLineupId = defenseLineupId ?? player.defenseLineupId;
  world.revision += 1;
  return player;
}

export function canChooseHome(index, world, playerId, territoryId) {
  const metadata = territoryMetadata(index, territoryId);
  const state = world.territories[territoryId];
  const existingPlayer = world.players[playerId];
  if (existingPlayer?.territoryIds.length) return { allowed: false, reason: "player-already-has-territory" };
  if (!metadata.playable || !metadata.spawnAllowed) return { allowed: false, reason: "territory-not-spawnable" };
  if (state.ownerType !== OWNER_TYPES.NEUTRAL) return { allowed: false, reason: "territory-not-neutral" };
  const adjacentClubTerritoryId = (metadata.landNeighbors ?? metadata.neighbors).find(
    (neighborId) => world.territories[neighborId]?.ownerType === OWNER_TYPES.CLUB,
  );
  if (adjacentClubTerritoryId) {
    return { allowed: false, reason: "adjacent-to-neutral-club", adjacentClubTerritoryId };
  }
  return { allowed: true, reason: null };
}

export function claimHome(index, world, playerId, territoryId) {
  const permission = canChooseHome(index, world, playerId, territoryId);
  if (!permission.allowed) throw new Error(permission.reason);
  const player = addTerritoryToPlayer(world, playerId, territoryId);
  player.capitalTerritoryId = territoryId;
  const state = world.territories[territoryId];
  state.ownerType = OWNER_TYPES.PLAYER;
  state.ownerId = playerId;
  state.capitalOf = playerId;
  state.version += 1;
  world.revision += 1;
  return state;
}

export function canAttack(index, world, playerId, targetTerritoryId, now = Date.now()) {
  const player = playerState(world, playerId);
  territoryMetadata(index, targetTerritoryId);
  const target = world.territories[targetTerritoryId];
  if (target.ownerType === OWNER_TYPES.PLAYER && target.ownerId === playerId) {
    return { allowed: false, reason: "already-owned", fromTerritoryIds: [] };
  }
  if (target.protectedUntil && Number(target.protectedUntil) > now) {
    return { allowed: false, reason: "territory-protected", fromTerritoryIds: [] };
  }
  const targetMetadata = territoryMetadata(index, targetTerritoryId);
  const landNeighbors = targetMetadata.landNeighbors ?? targetMetadata.neighbors;
  const fromTerritoryIds = player.territoryIds.filter((territoryId) => landNeighbors.includes(territoryId));
  if (!fromTerritoryIds.length) return { allowed: false, reason: "not-adjacent", fromTerritoryIds: [] };
  return { allowed: true, reason: null, fromTerritoryIds };
}

export function listAttackableTerritories(index, world, playerId, now = Date.now()) {
  const player = playerState(world, playerId);
  const candidates = new Set();
  for (const territoryId of player.territoryIds) {
    const metadata = territoryMetadata(index, territoryId);
    for (const neighborId of metadata.landNeighbors ?? metadata.neighbors) candidates.add(neighborId);
  }
  return [...candidates].filter((territoryId) => canAttack(index, world, playerId, territoryId, now).allowed).sort();
}

export function captureTerritory(index, world, playerId, targetTerritoryId, { protectedUntil = null, permission = null } = {}) {
  permission ??= canAttack(index, world, playerId, targetTerritoryId);
  if (!permission.allowed) throw new Error(permission.reason);
  const state = world.territories[targetTerritoryId];
  if (state.ownerType === OWNER_TYPES.PLAYER && state.ownerId) {
    removeTerritoryFromPlayer(world, state.ownerId, targetTerritoryId);
  }
  state.ownerType = OWNER_TYPES.PLAYER;
  state.ownerId = playerId;
  state.capitalOf = null;
  state.buildings = (state.buildings ?? []).filter((building) => building.type !== BUILDING_TYPES.MAIN_STADIUM);
  state.protectedUntil = protectedUntil;
  state.version += 1;
  addTerritoryToPlayer(world, playerId, targetTerritoryId);
  world.revision += 1;
  return {
    territoryId: targetTerritoryId,
    ownerId: playerId,
    fromTerritoryIds: permission.fromTerritoryIds,
    territoryVersion: state.version,
    worldRevision: world.revision,
  };
}
