import { createTerritoryWorld, OWNER_TYPES } from "../../territory-model.js";
import { normalizePlayerSquads } from "../../shared/config/player-squads.mjs";
import { nextAvailablePlayerMapColor } from "../domain/player-map-colors.mjs";
import { normalizeExpeditionPiece } from "../domain/expedition-piece.mjs";

export function canonicalTerritoryId(index, territoryId) {
  return index?.territoryIdAliases?.[territoryId] ?? territoryId;
}

function selectMergedTerritoryState(states) {
  const capitalState = states.find((state) => state?.ownerType === OWNER_TYPES.PLAYER && state.capitalOf);
  if (capitalState) return capitalState;
  const playerStates = states.filter((state) => state?.ownerType === OWNER_TYPES.PLAYER && state.ownerId);
  if (playerStates.length) {
    const counts = Object.groupBy(playerStates, (state) => state.ownerId);
    const winningOwnerId = Object.entries(counts)
      .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0][0];
    return playerStates
      .filter((state) => state.ownerId === winningOwnerId)
      .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  }
  return [...states].sort((left, right) => Number(right?.version ?? 0) - Number(left?.version ?? 0))[0];
}

export function hydrateCampaignWorld(index, savedWorld) {
  const world = createTerritoryWorld(index);
  if (!savedWorld) return world;
  const groupedStates = new Map();
  for (const [savedTerritoryId, state] of Object.entries(savedWorld.territories ?? {})) {
    const territoryId = canonicalTerritoryId(index, savedTerritoryId);
    if (!world.territories[territoryId]) continue;
    const states = groupedStates.get(territoryId) ?? [];
    states.push(state);
    groupedStates.set(territoryId, states);
  }
  for (const [territoryId, states] of groupedStates) {
    const selectedState = selectMergedTerritoryState(states);
    const buildings = states
      .flatMap((state) => Array.isArray(state?.buildings) ? state.buildings : [])
      .filter((building, index, entries) => building?.id && entries.findIndex((candidate) => candidate?.id === building.id) === index);
    Object.assign(world.territories[territoryId], selectedState, { territoryId, buildings });
  }
  world.players = Object.fromEntries(Object.entries(savedWorld.players ?? {}).map(([playerId, player]) => {
    const territoryIds = [...new Set((player.territoryIds ?? []).map((territoryId) => canonicalTerritoryId(index, territoryId)))]
      .filter((territoryId) => world.territories[territoryId]?.ownerId === playerId)
      .sort();
    const savedCapital = canonicalTerritoryId(index, player.capitalTerritoryId);
    const capitalTerritoryId = territoryIds.includes(savedCapital)
      ? savedCapital
      : territoryIds.find((territoryId) => world.territories[territoryId]?.capitalOf === playerId) ?? territoryIds[0] ?? null;
    return [playerId, { ...player, territoryIds, capitalTerritoryId, exiled: territoryIds.length === 0 }];
  }));
  world.aiGenerationSeed = savedWorld.aiGenerationSeed ?? world.aiGenerationSeed;
  world.aiGarrisons = Object.fromEntries(
    Object.entries(savedWorld.aiGarrisons ?? {})
      .filter(([territoryId]) => world.territories[territoryId] && !index.territoryIdAliases?.[territoryId]),
  );
  world.activeChallenges = Object.fromEntries(
    Object.entries(savedWorld.activeChallenges ?? {})
      .filter(([territoryId, challenge]) => world.territories[territoryId] && (challenge?.battle || challenge?.live?.firstLeg)),
  );
  world.schemaVersion = 4;
  world.revision = Number(savedWorld.revision ?? 0);
  world.seasonId = savedWorld.seasonId ?? world.seasonId;
  return world;
}

function migrateAccountDefaults(context) {
  let changed = false;
  for (const account of context.accounts.values()) {
    if (account.homeTerritoryId === undefined) {
      account.homeTerritoryId = null;
      changed = true;
    }
    if (!account.mapColor) {
      account.mapColor = nextAvailablePlayerMapColor(context.accounts);
      changed = true;
    }
    changed = normalizeExpeditionPiece(account, context.world).changed || changed;
  }
  return changed;
}

function migrateAccountEconomy(context) {
  let changed = false;
  for (const account of context.accounts.values()) changed = context.economy.migrateAccount(account) || changed;
  return changed;
}

function migrateTerritoryAliases(context) {
  let changed = Object.keys(context.saved?.world?.territories ?? {})
    .some((territoryId) => context.territoryIndex?.territoryIdAliases?.[territoryId]);
  for (const account of context.accounts.values()) {
    const canonicalHome = canonicalTerritoryId(context.territoryIndex, account.homeTerritoryId);
    if (canonicalHome !== account.homeTerritoryId) {
      account.homeTerritoryId = canonicalHome;
      changed = true;
    }
    for (const battle of account.battleHistory ?? []) {
      const canonicalBattle = canonicalTerritoryId(context.territoryIndex, battle.territoryId);
      if (canonicalBattle !== battle.territoryId) {
        battle.territoryId = canonicalBattle;
        changed = true;
      }
    }
    if (account.expeditionPiece) {
      const canonicalPosition = canonicalTerritoryId(context.territoryIndex, account.expeditionPiece.territoryId);
      if (canonicalPosition !== account.expeditionPiece.territoryId) {
        account.expeditionPiece.territoryId = canonicalPosition;
        changed = true;
      }
      if (account.expeditionPiece.movement) {
        for (const key of ["fromTerritoryId", "toTerritoryId"]) {
          const canonicalMovement = canonicalTerritoryId(context.territoryIndex, account.expeditionPiece.movement[key]);
          if (canonicalMovement !== account.expeditionPiece.movement[key]) {
            account.expeditionPiece.movement[key] = canonicalMovement;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

function migratePlayerCatalog(context) {
  let changed = false;
  const byId = new Map(context.playerDatabase.map((player) => [player.id, player]));
  for (const account of context.accounts.values()) {
    if (account.draft) {
      const hydrateSavedPlayer = (savedPlayer) => {
        const source = byId.get(savedPlayer.id);
        if (!source) return savedPlayer;
        if (account.playerCatalogVersion !== context.playerCatalogVersion) changed = true;
        return {
          ...savedPlayer,
          ...source,
          state: { ...source.state, ...savedPlayer.state },
          effectiveAttributes: source.effectiveAttributes,
          effectiveOverall: source.effectiveOverall,
          effectiveHeightCm: source.effectiveHeightCm,
        };
      };
      account.draft.roster = (account.draft.roster ?? []).map(hydrateSavedPlayer);
      account.draft.offer = (account.draft.offer ?? []).map(hydrateSavedPlayer);
    }
    if (account.playerCatalogVersion !== context.playerCatalogVersion) {
      account.playerCatalogVersion = context.playerCatalogVersion;
      changed = true;
    }
  }
  return changed;
}

function migratePlayerSquads(context) {
  let changed = false;
  for (const account of context.accounts.values()) {
    const normalized = normalizePlayerSquads(account.playerSquads, account.draft?.roster ?? []);
    if (JSON.stringify(account.playerSquads ?? null) !== JSON.stringify(normalized)) {
      account.playerSquads = normalized;
      changed = true;
    }
  }
  return changed;
}

export const CAMPAIGN_SAVE_MIGRATIONS = Object.freeze([
  Object.freeze({ id: "account-defaults", apply: migrateAccountDefaults }),
  Object.freeze({ id: "account-economy", apply: migrateAccountEconomy }),
  Object.freeze({ id: "territory-aliases", apply: migrateTerritoryAliases }),
  Object.freeze({ id: "player-catalog", apply: migratePlayerCatalog }),
  Object.freeze({ id: "player-squads", apply: migratePlayerSquads }),
]);

export function migrateCampaignSave({
  saved,
  territoryIndex,
  playerDatabase,
  playerCatalogVersion,
  economy,
}) {
  const accounts = new Map(Object.values(saved?.accounts ?? {}).map((account) => [account.id, account]));
  const world = territoryIndex ? hydrateCampaignWorld(territoryIndex, saved?.world) : null;
  const context = { saved, accounts, world, territoryIndex, playerDatabase, playerCatalogVersion, economy };
  const appliedMigrations = [];
  for (const migration of CAMPAIGN_SAVE_MIGRATIONS) {
    if (migration.apply(context)) appliedMigrations.push(migration.id);
  }
  return { accounts, world, appliedMigrations, changed: appliedMigrations.length > 0 };
}
