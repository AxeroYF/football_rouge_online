import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRAIT_CARDS } from "../src/traits.js";
import { ACCEPTED_TEST_TRAIT_NAMES, NEW_TRAIT_BATCH, NEW_TRAIT_NAMES } from "../src/new-trait-batch.js";
import { createDefaultDatabase } from "./default-data.js";
import { normalizeBondDefinitions } from "../game/public/bonds.js";
import { ATTRIBUTE_NAMES, POSITION_ORDER, SEVEN_A_SIDE, normalizePlayerSchema, roleGroup } from "../game/public/schema.js";
import { normalizeGameConfig } from "../game/public/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(here, "../data");
const databasePath = path.join(dataDirectory, "devtool-db.json");
const backupPath = path.join(dataDirectory, "devtool-db.backup.json");
const currentSchemaVersion = 11;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hasCorruptedText(value) {
  if (typeof value !== "string") return false;
  if (value.includes("�") || /锟斤拷|闁|鐞|鍦鸿竟/.test(value)) return true;
  const questionMarks = [...value].filter((character) => character === "?").length;
  return questionMarks >= 2 && (questionMarks / Math.max(1, value.length) >= 0.18 || /^\?+(?:\s+\S+)?$/.test(value));
}

function repairValue(current, canonical, repairs) {
  if (typeof current === "string") {
    if (hasCorruptedText(current) && typeof canonical === "string" && !hasCorruptedText(canonical)) {
      repairs.count += 1;
      return canonical;
    }
    return current;
  }
  if (Array.isArray(current)) {
    if (!Array.isArray(canonical)) return current;
    const canonicalById = new Map(
      canonical.filter((item) => item && typeof item === "object" && item.id).map((item) => [item.id, item]),
    );
    return current.map((item, index) => {
      const reference = item && typeof item === "object" && item.id
        ? canonicalById.get(item.id)
        : canonical[index];
      return repairValue(item, reference, repairs);
    });
  }
  if (current && typeof current === "object") {
    const result = {};
    for (const [key, value] of Object.entries(current)) {
      result[key] = repairValue(value, canonical?.[key], repairs);
    }
    return result;
  }
  return current;
}

function migrateTeamsToSeven(state) {
  const next = clone(state);
  const players = new Map((next.players ?? []).map((player) => [player.id, player]));
  next.teams = (next.teams ?? []).map((team) => {
    const candidates = [...new Set([...(team.lineupIds ?? []), ...(team.benchIds ?? [])])].filter((id) => players.has(id));
    const available = [...candidates];
    const take = (group, count) => {
      const picked = [];
      while (picked.length < count) {
        const index = available.findIndex((id) => roleGroup(players.get(id)?.role) === group);
        if (index < 0) break;
        picked.push(...available.splice(index, 1));
      }
      return picked;
    };
    const lineupIds = [...take("GK", 1), ...take("DEF", 2), ...take("MID", 3), ...take("ATT", 1)];
    while (lineupIds.length < 7 && available.length) lineupIds.push(available.shift());
    const benchIds = [];
    for (const group of ["GK", "DEF", "MID", "ATT"]) {
      const index = available.findIndex((id) => roleGroup(players.get(id)?.role) === group);
      if (index >= 0) benchIds.push(...available.splice(index, 1));
    }
    while (benchIds.length < 4 && available.length) benchIds.push(available.shift());
    for (const player of players.values()) {
      if (player.teamId !== team.id) continue;
      player.squadStatus = lineupIds.includes(player.id) ? "lineup" : benchIds.includes(player.id) ? "bench" : "reserve";
    }
    const lineCounts = lineupIds.reduce((counts, id) => {
      const group = roleGroup(players.get(id)?.role);
      counts[group] = (counts[group] ?? 0) + 1;
      return counts;
    }, {});
    return {
      ...team,
      lineupIds,
      benchIds,
      formation: {
        ...team.formation,
        name: `${lineCounts.DEF ?? 0}-${lineCounts.MID ?? 0}-${lineCounts.ATT ?? 0}`,
      },
    };
  });
  return next;
}

export function repairCorruptedDatabaseText(state) {
  const repairs = { count: 0 };
  const repaired = repairValue(state, createDefaultDatabase(), repairs);
  return { state: repaired, repairedFields: repairs.count };
}

function migrateDatabase(state) {
  const version = Number(state?.meta?.schemaVersion ?? 1);
  if (version >= currentSchemaVersion) return { changed: false, state };
  let next = clone(state);
  if (version < 2) {
    const existingIds = new Set((next.traitCards ?? []).map((trait) => trait.id));
    const additions = TRAIT_CARDS.filter((trait) => !existingIds.has(trait.id)).map(clone);
    next.traitCards = [...(next.traitCards ?? []), ...additions];
  }
  if (version < 3) next = repairCorruptedDatabaseText(next).state;
  if (version < 4) next.traitCards = (next.traitCards ?? []).map(withInferredTraitBonds);
  if (version < 5) next = migrateTeamsToSeven(next);
  if (version < 6) {
    next.players = (next.players ?? []).map((player, index) => normalizePlayerSchema(player, { index }));
    next = migrateTeamsToSeven(next);
  }
  if (version < 7) next.players = (next.players ?? []).map((player, index) => normalizePlayerSchema(player, { index }));
  if (version < 8) next.globalConfig = normalizeGameConfig(next.globalConfig);
  if (version < 9) next.traitDrafts = Array.isArray(next.traitDrafts) ? next.traitDrafts : [];
  if (version < 10) {
    const existingIds = new Set((next.traitCards ?? []).map((trait) => trait.id));
    const formalized = NEW_TRAIT_BATCH.filter((trait) => !existingIds.has(trait.id)).map(clone);
    next.traitCards = [...(next.traitCards ?? []), ...formalized].map((trait) => ({ ...trait, bondIds: [] }));
    next.traitDrafts = (next.traitDrafts ?? [])
      .filter((draft) => !NEW_TRAIT_NAMES.has(String(draft.name ?? "").trim()))
      .map((draft) => ({ ...draft, bondIds: [] }));
    next.bonds = [];
  }
  if (version < 11) {
    const existingIds = new Set((next.traitCards ?? []).map((trait) => trait.id));
    const formalized = NEW_TRAIT_BATCH
      .filter((trait) => ACCEPTED_TEST_TRAIT_NAMES.has(trait.name) && !existingIds.has(trait.id))
      .map(clone);
    next.traitCards = [...(next.traitCards ?? []), ...formalized].map((trait) => ({ ...trait, bondIds: trait.bondIds ?? [] }));
    next.traitDrafts = (next.traitDrafts ?? []).filter((draft) => !ACCEPTED_TEST_TRAIT_NAMES.has(String(draft.name ?? "").trim()));
  }
  return {
    changed: true,
    state: {
      ...next,
      meta: { ...next.meta, schemaVersion: currentSchemaVersion },
    },
  };
}

function uniqueIds(records, label, errors) {
  const seen = new Set();
  for (const record of records) {
    if (!record?.id || typeof record.id !== "string") {
      errors.push(label + " contains record without string id");
      continue;
    }
    if (seen.has(record.id)) errors.push(label + " has duplicate id: " + record.id);
    seen.add(record.id);
  }
  return seen;
}

export function validateDatabase(state) {
  const errors = [];
  if (!state || typeof state !== "object") return ["database must be an object"];
  if (!state.globalConfig || typeof state.globalConfig !== "object") errors.push("globalConfig must be an object");
  for (const key of ["traitCards", "traitDrafts", "bonds", "players", "teams", "simulationPresets"]) {
    if (!Array.isArray(state[key])) errors.push(key + " must be an array");
  }
  if (errors.length > 0) return errors;

  const traitIds = uniqueIds(state.traitCards, "traitCards", errors);
  const traitDraftIds = uniqueIds(state.traitDrafts, "traitDrafts", errors);
  const bondIds = uniqueIds(state.bonds, "bonds", errors);
  const playerIds = uniqueIds(state.players, "players", errors);
  const playersById = new Map(state.players.map((player) => [player.id, player]));
  const teamIds = uniqueIds(state.teams, "teams", errors);
  uniqueIds(state.simulationPresets, "simulationPresets", errors);

  for (const draftId of traitDraftIds) {
    if (traitIds.has(draftId)) errors.push("trait draft id conflicts with formal trait: " + draftId);
  }

  for (const draft of state.traitDrafts) {
    if (draft.name !== undefined && typeof draft.name !== "string") errors.push("trait draft name must be string: " + draft.id);
    if (draft.summary !== undefined && typeof draft.summary !== "string") errors.push("trait draft summary must be string: " + draft.id);
    if (draft.tags !== undefined && !Array.isArray(draft.tags)) errors.push("trait draft tags must be an array: " + draft.id);
    if (draft.eligibleRoleGroups !== undefined && !Array.isArray(draft.eligibleRoleGroups)) errors.push("trait draft roles must be an array: " + draft.id);
    if (draft.bondIds !== undefined && !Array.isArray(draft.bondIds)) errors.push("trait draft bonds must be an array: " + draft.id);
    if (draft.rulesDraft !== undefined && typeof draft.rulesDraft !== "string") errors.push("trait draft rulesDraft must be string: " + draft.id);
  }

  for (const trait of state.traitCards) {
    if (!trait.name) errors.push("trait missing name: " + trait.id);
    if (hasCorruptedText(trait.name) || hasCorruptedText(trait.summary)) {
      errors.push("trait contains corrupted text: " + trait.id);
    }
    if (!Array.isArray(trait.eligibleRoleGroups) || trait.eligibleRoleGroups.length === 0) {
      errors.push("trait missing eligible roles: " + trait.id);
    }
    if (!Array.isArray(trait.rules)) errors.push("trait rules must be an array: " + trait.id);
    if (!Object.hasOwn({ common: true, rare: true, epic: true, legendary: true }, trait.rarity)) {
      errors.push("trait has invalid rarity: " + trait.id);
    }
    if (!trait.category || typeof trait.category !== "string") errors.push("trait missing category: " + trait.id);
    if (!Array.isArray(trait.tags)) errors.push("trait tags must be an array: " + trait.id);
    if (trait.bondIds !== undefined && !Array.isArray(trait.bondIds)) errors.push("trait bonds must be an array: " + trait.id);
    for (const bondId of trait.bondIds ?? []) if (!bondIds.has(bondId)) errors.push("trait has unknown bond: " + trait.id + " -> " + bondId);
    for (const [index, rule] of (trait.rules ?? []).entries()) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) errors.push("trait rule must be object: " + trait.id + "[" + index + "]");
      else if (!rule.hook || typeof rule.hook !== "string") errors.push("trait rule missing hook: " + trait.id + "[" + index + "]");
    }
  }

  const allTraitIds = new Set([...traitIds, ...traitDraftIds]);
  for (const bond of state.bonds) {
    if (!bond.name || typeof bond.name !== "string") errors.push("bond missing name: " + bond.id);
    if (!Array.isArray(bond.traitIds)) errors.push("bond traitIds must be an array: " + bond.id);
    for (const traitId of bond.traitIds ?? []) if (!allTraitIds.has(traitId)) errors.push("bond references unknown trait: " + bond.id + " -> " + traitId);
    if (!Array.isArray(bond.tiers) || bond.tiers.length === 0) errors.push("bond must have at least one tier: " + bond.id);
    for (const [index, tier] of (bond.tiers ?? []).entries()) {
      if (!Number.isInteger(Number(tier?.threshold)) || Number(tier.threshold) < 1) errors.push("bond tier has invalid threshold: " + bond.id + "[" + index + "]");
      if (!tier?.bonuses || typeof tier.bonuses !== "object" || Array.isArray(tier.bonuses)) errors.push("bond tier bonuses must be an object: " + bond.id + "[" + index + "]");
      if (tier?.effectText !== undefined && typeof tier.effectText !== "string") errors.push("bond tier effectText must be a string: " + bond.id + "[" + index + "]");
    }
  }

  for (const player of state.players) {
    if (!player.name) errors.push("player missing name: " + player.id);
    if (hasCorruptedText(player.name)) errors.push("player contains corrupted text: " + player.id);
    if (!player.role) errors.push("player missing role: " + player.id);
    else if (!POSITION_ORDER.includes(player.role)) errors.push("player has non-canonical seven-a-side role: " + player.id + " -> " + player.role);
    if (player.secondaryRole && !POSITION_ORDER.includes(player.secondaryRole)) errors.push("player has invalid secondary role: " + player.id);
    if (!player.attributes || typeof player.attributes !== "object") {
      errors.push("player missing attributes: " + player.id);
    } else {
      for (const attribute of ATTRIBUTE_NAMES) if (!Number.isFinite(Number(player.attributes[attribute]))) errors.push("player missing canonical attribute: " + player.id + " -> " + attribute);
    }
    if (!player.state || typeof player.state !== "object") errors.push("player missing state: " + player.id);
    else if (!player.state.injury || typeof player.state.injury !== "object") errors.push("player missing injury state: " + player.id);
    if (!player.hidden || typeof player.hidden !== "object") errors.push("player missing hidden personality: " + player.id);
    if (!player.development || typeof player.development !== "object") errors.push("player missing development state: " + player.id);
    if (player.teamId && !teamIds.has(player.teamId)) {
      errors.push("player references unknown team: " + player.id);
    }
    if (!Array.isArray(player.traitCards)) errors.push("player traitCards must be array: " + player.id);
    if ((player.traitCards ?? []).length > 3) errors.push("player has more than 3 traits: " + player.id);
    for (const traitId of player.traitCards ?? []) {
      if (!traitIds.has(traitId)) errors.push("player references unknown trait: " + player.id + " -> " + traitId);
    }
  }

  for (const team of state.teams) {
    if (!team.name) errors.push("team missing name: " + team.id);
    if (hasCorruptedText(team.name)) errors.push("team contains corrupted text: " + team.id);
    for (const playerId of [...(team.lineupIds ?? []), ...(team.benchIds ?? [])]) {
      if (!playerIds.has(playerId)) errors.push("team references unknown player: " + team.id + " -> " + playerId);
    }
    if ((team.lineupIds ?? []).length !== SEVEN_A_SIDE.starters) errors.push("team must have exactly 7 starters: " + team.id);
    if ((team.benchIds ?? []).length > SEVEN_A_SIDE.benchLimit) errors.push("team may have at most 4 bench players: " + team.id);
    const groups = new Set((team.lineupIds ?? []).map((id) => roleGroup(playersById.get(id)?.role)));
    for (const required of ["GK", "DEF", "MID", "ATT"]) {
      if (!groups.has(required)) errors.push("team lineup missing " + required + ": " + team.id);
    }
  }

  return errors;
}

async function writeDatabase(state, createBackup) {
  const bonds = normalizeBondDefinitions(state.bonds ?? []);
  const memberships = new Map();
  for (const bond of bonds) {
    for (const traitId of bond.traitIds) {
      const values = memberships.get(traitId) ?? [];
      values.push(bond.id);
      memberships.set(traitId, values);
    }
  }
  const prepared = {
    ...state,
    bonds,
    traitCards: (state.traitCards ?? []).map((trait) => ({ ...trait, bondIds: memberships.get(trait.id) ?? [] })),
    traitDrafts: (state.traitDrafts ?? []).map((trait) => ({ ...trait, bondIds: memberships.get(trait.id) ?? [] })),
    players: (state.players ?? []).map((player, index) => normalizePlayerSchema(player, { index })),
    globalConfig: normalizeGameConfig(state.globalConfig),
  };
  const errors = validateDatabase(prepared);
  if (errors.length > 0) {
    const error = new Error("database validation failed");
    error.details = errors;
    throw error;
  }
  await mkdir(dataDirectory, { recursive: true });
  if (createBackup) {
    try {
      await copyFile(databasePath, backupPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const next = {
    ...prepared,
    meta: {
      ...prepared.meta,
      schemaVersion: currentSchemaVersion,
      updatedAt: new Date().toISOString(),
    },
  };
  await writeFile(databasePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export async function loadDatabase() {
  try {
    const raw = await readFile(databasePath, "utf8");
    const parsed = JSON.parse(raw);
    const migration = migrateDatabase(parsed);
    const state = migration.state;
    const errors = validateDatabase(state);
    if (errors.length > 0) {
      const error = new Error("saved database is invalid");
      error.details = errors;
      throw error;
    }
    if (migration.changed) return writeDatabase(state, true);
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return writeDatabase(createDefaultDatabase(), false);
  }
}

export async function saveDatabase(state) {
  return writeDatabase(state, true);
}

export async function resetDatabase() {
  return writeDatabase(createDefaultDatabase(), true);
}

export const storePaths = Object.freeze({ dataDirectory, databasePath, backupPath });
