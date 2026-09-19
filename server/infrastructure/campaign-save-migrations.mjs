import { refreshTrainingGrowth } from "../../shared/football/training-growth.mjs";
import { remapTerritoryReferences, assertSafeMapMerge } from "./map-version-migration.mjs";
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
  const clubStates = states.filter(state => state?.ownerType === OWNER_TYPES.CLUB);
  return [...(clubStates.length ? clubStates : states)].sort((left, right) => Number(right?.version ?? 0) - Number(left?.version ?? 0))[0];
}

export function hydrateCampaignWorld(index, savedWorld) {
  const world = createTerritoryWorld(index);
  world.mapVersion=index.mapVersion??savedWorld?.mapVersion??null;
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
  world.activeChallenges = {};
  for(const [oldId,oldChallenge]of Object.entries(savedWorld.activeChallenges??{})){
    const id=canonicalTerritoryId(index,oldId);
    if(!world.territories[id]||!(oldChallenge?.battle||oldChallenge?.live?.firstLeg))continue;
    if(world.activeChallenges[id]&&world.activeChallenges[id].id!==oldChallenge.id)throw Error('合并地块存在多场进行中比赛，已保留原存档');
    const challenge=structuredClone(oldChallenge);remapTerritoryReferences(challenge,index.territoryIdAliases??{});world.activeChallenges[id]=challenge;
  }
  world.schemaVersion = 4;
  world.revision = Number(savedWorld.revision ?? 0);
  world.seasonId = savedWorld.seasonId ?? world.seasonId;
  if(Array.isArray(savedWorld.news))world.news=structuredClone(savedWorld.news.slice(-200));
  if(savedWorld.coalitions){world.coalitions=structuredClone(savedWorld.coalitions);remapTerritoryReferences(world.coalitions,index.territoryIdAliases??{});}
  if(savedWorld.diplomacy)world.diplomacy=structuredClone(savedWorld.diplomacy);
  if(savedWorld.eliteChallenges)world.eliteChallenges=structuredClone(savedWorld.eliteChallenges);
  if(savedWorld.eliteRaids){world.eliteRaids=structuredClone(savedWorld.eliteRaids);remapTerritoryReferences(world.eliteRaids,index.territoryIdAliases??{});}
  for(const t of index.territories){const state=world.territories[t.territoryId];if(!Array.isArray(t.eliteClubIds)||state.ownerType==='player')continue;
   const type=t.eliteClubIds.length?'club':'neutral';if(state.ownerType!==type){state.ownerType=type;state.ownerId=type==='club'?t.initialOwner.id:null;state.capitalOf=null;state.version++;delete world.aiGarrisons[t.territoryId];}
  }
  if (savedWorld.shop) world.shop = structuredClone(savedWorld.shop);
  if (savedWorld.cardManagement) world.cardManagement = structuredClone(savedWorld.cardManagement);
  if (savedWorld.economyRecoveries) world.economyRecoveries = structuredClone(savedWorld.economyRecoveries);
  if (savedWorld.serverEconomyClock) world.serverEconomyClock = structuredClone(savedWorld.serverEconomyClock);
  if (savedWorld.resourceEconomy) world.resourceEconomy = structuredClone(savedWorld.resourceEconomy);
  if (savedWorld.constructionEconomy) world.constructionEconomy = structuredClone(savedWorld.constructionEconomy);
  if (savedWorld.neutralRewards) world.neutralRewards = structuredClone(savedWorld.neutralRewards);
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
        if (savedPlayer.cardInstanceId) return savedPlayer;
        const source = byId.get(savedPlayer.id);
        if (!source) return savedPlayer;
        if (account.playerCatalogVersion !== context.playerCatalogVersion) changed = true;
        const trainedAttributes = (base) => Object.fromEntries(Object.entries(base ?? {}).map(([key, value]) => [key, Math.min(99, Number(value) + Number(savedPlayer.trainingBonuses?.[key] ?? 0))]));
        return {
          ...savedPlayer,
          ...source,
          attributes: trainedAttributes(source.attributes),
          state: { ...source.state, ...savedPlayer.state },
          effectiveAttributes: trainedAttributes(source.effectiveAttributes ?? source.attributes),
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

function migrateTrainingGrowth(context) {
  let changed = false;
  for (const account of context.accounts.values()) for (const player of account.draft?.roster ?? []) {
    if (!Object.values(player.trainingBonuses ?? {}).some(value => Number(value) > 0)) continue;
    const before = JSON.stringify(player);
    refreshTrainingGrowth(player);
    changed = before !== JSON.stringify(player) || changed;
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
  Object.freeze({ id: "training-growth", apply: migrateTrainingGrowth }),
  Object.freeze({ id: "player-squads", apply: migratePlayerSquads }),
]);

export function migrateCampaignSave({
  saved,
  territoryIndex,
  playerDatabase,
  playerCatalogVersion,
  economy,
}) {
  assertSafeMapMerge(saved,territoryIndex);
  const accounts = new Map(Object.values(saved?.accounts ?? {}).map((account) => [account.id, account]));
  let mapReferencesChanged=false;
  for(const account of accounts.values())mapReferencesChanged=remapTerritoryReferences(account,territoryIndex?.territoryIdAliases??{})||mapReferencesChanged;
  const world = territoryIndex ? hydrateCampaignWorld(territoryIndex, saved?.world) : null;
  const context = { saved, accounts, world, territoryIndex, playerDatabase, playerCatalogVersion, economy };
  const appliedMigrations = mapReferencesChanged||saved?.world&&territoryIndex?.mapVersion&&saved.world.mapVersion!==territoryIndex.mapVersion?["world-map-version"]:[];
  for (const migration of CAMPAIGN_SAVE_MIGRATIONS) {
    if (migration.apply(context)) appliedMigrations.push(migration.id);
  }
  return { accounts, world, appliedMigrations, changed: appliedMigrations.length > 0 };
}
