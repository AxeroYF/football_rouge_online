import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ATTRIBUTE_NAMES, playerOverallFromAttributes, POSITION_GROUPS, roleGroup } from "../game/public/schema.js";
import { isS4Legend, isXPlayer, moveRealPlayerToPool, normalizedS4LegendAttributes, REAL_PLAYER_BY_ID, REAL_PLAYERS, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP } from "./player-pool.js";
import { playerCardStudioView } from "./player-card-studio-store.js";
import { YDL_TRAIT_BY_ID, YDL_TRAIT_CARDS } from "./trait-pool.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIRECTORY = path.resolve(HERE, "../data");
const CONTENT_PATH = path.resolve(process.env.YDL_CONTENT_OVERRIDES_PATH ?? path.join(DATA_DIRECTORY, "ydl-content-overrides.json"));
const BACKUP_PATH = path.join(path.dirname(CONTENT_PATH), `${path.basename(CONTENT_PATH, path.extname(CONTENT_PATH))}.backup.json`);
const CONTENT_SCHEMA_VERSION = 2;
const TRAIT_ROLE_GROUPS = Object.freeze(["ANY", "GK", "DEF", "MID", "ATT"]);
const PLAYER_ROLES = Object.freeze(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const ROLES_BY_POOL = Object.freeze({
  GK:Object.freeze([...POSITION_GROUPS.GK]),
  DEF:Object.freeze([...POSITION_GROUPS.DEF]),
  MID:Object.freeze([...POSITION_GROUPS.MID]),
  ATT:Object.freeze([...POSITION_GROUPS.ATT]),
});

let overrides = {
  schemaVersion:CONTENT_SCHEMA_VERSION,
  updatedAt:null,
  players:{},
  traits:{},
  traitDrafts:{},
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum = 1, maximum = 99) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error("能力值必须是数字");
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function nonEmpty(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  return text;
}

function normalizedRoles(value) {
  const roles = [...new Set((Array.isArray(value) ? value : []).map(String))];
  if (!roles.length) throw new Error("特性卡至少需要一个适用位置");
  if (roles.some((role) => !TRAIT_ROLE_GROUPS.includes(role))) throw new Error("特性卡包含无效适用位置");
  return roles.includes("ANY") ? ["ANY"] : roles;
}

function attributesForOverall(attributes, role, overall, maximum = 99) {
  const normalized = Object.fromEntries(Object.entries(attributes ?? {}).map(([key, value]) => [key, clamp(value, 1, maximum)]));
  const keys = roleGroup(role) === "GK" ? ["goalkeeping", "reflexes", "positioning", "composure"]
    : roleGroup(role) === "DEF" ? ["tackling", "marking", "positioning", "strength", "pace"]
      : roleGroup(role) === "MID" ? ["passing", "vision", "decisions", "firstTouch", "stamina"]
        : ["finishing", "offBall", "pace", "dribbling", "composure"];
  const target = Math.min(maximum, Math.round(Number(overall) || 1)) * keys.length;
  let sum = keys.reduce((total, key) => total + Number(normalized[key] ?? 1), 0);
  while (sum < target) {
    const key = keys.filter((candidate) => normalized[candidate] < maximum).sort((left, right) => normalized[left] - normalized[right])[0];
    if (!key) break;
    normalized[key] += 1;
    sum += 1;
  }
  while (sum > target) {
    const key = keys.filter((candidate) => normalized[candidate] > 1).sort((left, right) => normalized[right] - normalized[left])[0];
    if (!key) break;
    normalized[key] -= 1;
    sum -= 1;
  }
  return normalized;
}

function applyPlayerPatch(player, patch, options = {}) {
  if (Object.hasOwn(patch, "name")) player.name = nonEmpty(patch.name, "球员姓名");
  if (Object.hasOwn(patch, "grade")) {
    const grade = String(patch.grade);
    if (!["S", "A", "B", "C"].includes(grade)) throw new Error("球员评级无效");
    player.grade = grade;
    player.legendary = grade === "S";
  }
  if (Object.hasOwn(patch, "role")) {
    const role = String(patch.role);
    if (!PLAYER_ROLES.includes(role)) throw new Error("主位置无效");
    player.role = role;
    moveRealPlayerToPool(player, roleGroup(role));
    if (player.secondaryRole === role) player.secondaryRole = null;
  }
  if (Object.hasOwn(patch, "secondaryRole")) {
    const role = patch.secondaryRole ? String(patch.secondaryRole) : null;
    if (role && (!PLAYER_ROLES.includes(role) || role === player.role)) throw new Error("副位置无效");
    player.secondaryRole = role;
  }
  if (Object.hasOwn(patch, "nationality")) player.nationality = nonEmpty(patch.nationality, "国家队/国籍");
  if (Object.hasOwn(patch, "club")) player.club = nonEmpty(patch.club, "俱乐部");
  if (Object.hasOwn(patch, "heightCm")) player.heightCm = clamp(patch.heightCm, 140, 220);
  if (patch.attributes && typeof patch.attributes === "object" && !Array.isArray(patch.attributes)) {
    const patchedAttributes = options.preserveOverall && Object.hasOwn(patch, "overall")
      ? attributesForOverall(patch.attributes, player.role, patch.overall, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP)
      : patch.attributes;
    for (const [key, value] of Object.entries(patchedAttributes)) {
      if (!ATTRIBUTE_NAMES.includes(key)) throw new Error(`未知球员属性：${key}`);
      player.attributes[key] = clamp(value, 1, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP);
    }
    player.overall = playerOverallFromAttributes(player.attributes, player.role);
    player.baseOverall = player.overall;
  } else if (Object.hasOwn(patch, "overall")) {
    const requestedOverall = clamp(patch.overall, 1, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP);
    player.attributes = normalizedS4LegendAttributes(player.attributes, player.role, requestedOverall);
    player.overall = playerOverallFromAttributes(player.attributes, player.role);
    player.baseOverall = player.overall;
  } else if (Object.hasOwn(patch, "role")) {
    player.overall = playerOverallFromAttributes(player.attributes, player.role);
    player.baseOverall = player.overall;
  }
  player.referenceAttributes = clone(player.attributes);
  return player;
}

function applyTraitPatch(trait, patch) {
  if (Object.hasOwn(patch, "name")) trait.name = nonEmpty(patch.name, "特性卡名称");
  if (Object.hasOwn(patch, "summary")) trait.summary = String(patch.summary ?? "").trim();
  if (Object.hasOwn(patch, "eligibleRoleGroups")) trait.eligibleRoleGroups = normalizedRoles(patch.eligibleRoleGroups);
  if (Object.hasOwn(patch, "rules")) {
    if (!Array.isArray(patch.rules)) throw new Error("特性效果规则必须是JSON数组");
    trait.rules = clone(patch.rules);
  }
  return trait;
}

function traitView(trait, { status = "active", custom = false } = {}) {
  return {
    id:trait.id,
    name:trait.name,
    summary:trait.summary,
    category:trait.category,
    eligibleRoleGroups:[...(trait.eligibleRoleGroups ?? [])],
    rules:clone(trait.rules ?? []),
    status,
    custom,
  };
}

function normalizeTraitDraft(id, value = {}) {
  return {
    id,
    name:nonEmpty(value.name, "特性卡名称"),
    summary:String(value.summary ?? "").trim(),
    category:"custom",
    eligibleRoleGroups:normalizedRoles(value.eligibleRoleGroups),
    rules:Array.isArray(value.rules) ? clone(value.rules) : [],
    status:"draft",
    custom:true,
    createdAt:value.createdAt ?? new Date().toISOString(),
    updatedAt:value.updatedAt ?? new Date().toISOString(),
  };
}

function applyOverrides() {
  let migrated = false;
  for (const [id, patch] of Object.entries(overrides.players ?? {})) {
    const player = REAL_PLAYER_BY_ID[id];
    if (player) {
      applyPlayerPatch(player, patch, { preserveOverall:true });
      const nextPatch = { ...patch, overall:player.overall, attributes:clone(player.attributes) };
      if (JSON.stringify(nextPatch) !== JSON.stringify(patch)) migrated = true;
      overrides.players[id] = nextPatch;
    }
  }
  const messiPatch = overrides.players?.["legend-messi"];
  const messiRat = REAL_PLAYER_BY_ID["legend-messi-rat"];
  if (messiPatch && messiRat) applyPlayerPatch(messiRat, { ...clone(messiPatch), name:"梅老鼠" }, { preserveOverall:true });
  for (const [id, patch] of Object.entries(overrides.traits ?? {})) {
    const trait = YDL_TRAIT_BY_ID[id];
    if (trait) applyTraitPatch(trait, patch);
  }
  return migrated;
}

function loadOverridesSync() {
  let migrated = false;
  try {
    const parsed = JSON.parse(readFileSync(CONTENT_PATH, "utf8"));
    if (parsed && typeof parsed === "object") {
      const schemaVersion = Number(parsed.schemaVersion ?? 1);
      const traitPatches = parsed.traits && typeof parsed.traits === "object" ? parsed.traits : {};
      const draftTraits = parsed.traitDrafts && typeof parsed.traitDrafts === "object" ? parsed.traitDrafts : {};
      const migratedTraitPatches = { ...traitPatches };
      for (const [id, draft] of Object.entries(draftTraits)) {
        if (YDL_TRAIT_BY_ID[id] && !migratedTraitPatches[id]) {
          const migratedDraft = clone(draft);
          if (!Array.isArray(migratedDraft.rules) || migratedDraft.rules.length === 0) delete migratedDraft.rules;
          delete migratedDraft.status;
          delete migratedDraft.custom;
          migratedTraitPatches[id] = migratedDraft;
        }
      }
      overrides = {
        schemaVersion:CONTENT_SCHEMA_VERSION,
        updatedAt:parsed.updatedAt ?? null,
        players:parsed.players && typeof parsed.players === "object" ? parsed.players : {},
        traits:Object.fromEntries(Object.entries(migratedTraitPatches)
          .filter(([id]) => YDL_TRAIT_BY_ID[id])
          .map(([id, patch]) => [id, schemaVersion < CONTENT_SCHEMA_VERSION
            ? Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => key !== "rules"))
            : patch])),
        traitDrafts:Object.fromEntries(Object.entries(draftTraits).filter(([id]) => !YDL_TRAIT_BY_ID[id])),
      };
      migrated = schemaVersion < CONTENT_SCHEMA_VERSION
        || Object.keys(traitPatches).some((id) => !YDL_TRAIT_BY_ID[id])
        || Object.keys(draftTraits).some((id) => YDL_TRAIT_BY_ID[id]);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  migrated = applyOverrides() || migrated;
  if (migrated) void persist().catch((error) => console.error("YDL内容覆盖迁移持久化失败", error));
}

async function persist() {
  await mkdir(path.dirname(CONTENT_PATH), { recursive:true });
  try {
    await copyFile(CONTENT_PATH, BACKUP_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  overrides.updatedAt = new Date().toISOString();
  await writeFile(CONTENT_PATH, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
}

loadOverridesSync();

function contentDistribution(key, fallback = "未填写") {
  return Object.entries(REAL_PLAYERS.reduce((counts, player) => {
    const value = String(player?.[key] ?? fallback).trim() || fallback;
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {})).map(([label, count]) => ({ label, count, percent:Number((count / Math.max(1, REAL_PLAYERS.length) * 100).toFixed(1)) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function contentOverview(studio) {
  return {
    totalPlayers:REAL_PLAYERS.length,
    draftCount:studio.drafts.length,
    profileCount:Object.keys(studio.profiles).length,
    averageOverall:Number((REAL_PLAYERS.reduce((sum, player) => sum + Number(player.overall ?? 0), 0) / Math.max(1, REAL_PLAYERS.length)).toFixed(1)),
    activeTraitCount:YDL_TRAIT_CARDS.length,
  };
}

export function ydlContentSection(section = "summary") {
  const common = {
    schemaVersion:CONTENT_SCHEMA_VERSION,
    updatedAt:overrides.updatedAt,
    roleGroups:[...TRAIT_ROLE_GROUPS],
    playerRoles:[...PLAYER_ROLES],
    attributeNames:[...ATTRIBUTE_NAMES],
    rolesByPool:clone(ROLES_BY_POOL),
  };
  if (section === "summary") {
    const studio = playerCardStudioView();
    return { ...common, overview:contentOverview(studio) };
  }
  if (section === "players") return { players:REAL_PLAYERS.filter((player) => !isXPlayer(player)).map((player) => ({
      id:player.id,
      name:player.name,
      sourceName:player.sourceName,
      pool:player.pool,
      role:player.role,
      secondaryRole:player.secondaryRole,
      overall:player.overall,
      referenceOverall:player.referenceOverall,
      grade:player.grade,
      nationality:player.nationality,
      club:player.club,
      heightCm:player.heightCm,
      attributes:clone(player.attributes),
      isLegend:isS4Legend(player),
      customPlayer:Boolean(player.customPlayer),
      status:"active",
      cardProfile:clone(player.cardProfile ?? null),
    })) };
  if (section === "studio") {
    const studio = playerCardStudioView();
    return {
      profilePlayers:REAL_PLAYERS.map((player) => ({
      id:player.id,
      name:player.name,
      sourceName:player.sourceName,
      pool:player.pool,
      role:player.role,
      secondaryRole:player.secondaryRole,
      overall:player.overall,
      grade:player.grade,
      nationality:player.nationality,
      club:player.club,
      isLegend:isS4Legend(player),
      xPlayer:isXPlayer(player),
      customPlayer:Boolean(player.customPlayer),
      status:"active",
      cardProfile:clone(player.cardProfile ?? null),
      })),
      playerBatches:studio.batches,
      playerDrafts:studio.drafts,
      cardStudio:{ mediaStorage:studio.mediaStorage, updatedAt:studio.updatedAt, profileCount:Object.keys(studio.profiles).length },
    };
  }
  if (section === "analytics") {
    const studio = playerCardStudioView();
    return { analytics:{
      totalPlayers:REAL_PLAYERS.length,
      averageOverall:Number((REAL_PLAYERS.reduce((sum, player) => sum + Number(player.overall ?? 0), 0) / Math.max(1, REAL_PLAYERS.length)).toFixed(1)),
      profileCount:Object.keys(studio.profiles).length,
      profileCoverage:Number((Object.keys(studio.profiles).length / Math.max(1, REAL_PLAYERS.length) * 100).toFixed(1)),
      nationality:contentDistribution("nationality"),
      club:contentDistribution("club"),
      grade:contentDistribution("grade"),
      role:contentDistribution("role"),
    } };
  }
  if (section === "traits") return { traits:[
      ...YDL_TRAIT_CARDS.map((trait) => traitView(trait)),
      ...Object.entries(overrides.traitDrafts ?? {}).map(([id, trait]) => traitView(normalizeTraitDraft(id, trait), { status:"draft", custom:true })),
    ] };
  throw Object.assign(new Error("未知内容分区"), { statusCode:404 });
}

export function ydlContentView() {
  return {
    ...ydlContentSection("summary"),
    ...ydlContentSection("players"),
    ...ydlContentSection("studio"),
    ...ydlContentSection("analytics"),
    ...ydlContentSection("traits"),
  };
}

export async function updateYdlPlayer(id, patch) {
  const player = REAL_PLAYER_BY_ID[id];
  if (!player) throw Object.assign(new Error("球员不存在"), { statusCode:404 });
  const allowed = {
    name:patch.name,
    overall:patch.overall,
    grade:patch.grade,
    role:patch.role,
    secondaryRole:patch.secondaryRole,
    nationality:patch.nationality,
    club:patch.club,
    heightCm:patch.heightCm,
    attributes:patch.attributes,
  };
  const cleanPatch = Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
  applyPlayerPatch(player, cleanPatch);
  cleanPatch.overall = player.overall;
  cleanPatch.attributes = clone(player.attributes);
  overrides.players[id] = { ...(overrides.players[id] ?? {}), ...clone(cleanPatch) };
  if (id === "legend-messi" && REAL_PLAYER_BY_ID["legend-messi-rat"]) {
    const mirroredPatch = { ...clone(cleanPatch), name:"梅老鼠" };
    applyPlayerPatch(REAL_PLAYER_BY_ID["legend-messi-rat"], mirroredPatch);
    overrides.players["legend-messi-rat"] = { ...(overrides.players["legend-messi-rat"] ?? {}), ...mirroredPatch };
  }
  await persist();
  return ydlContentView().players.find((candidate) => candidate.id === id);
}

export async function updateYdlTrait(id, patch) {
  const trait = YDL_TRAIT_BY_ID[id];
  const draft = overrides.traitDrafts?.[id];
  if (!trait && !draft) throw Object.assign(new Error("特性卡不存在"), { statusCode:404 });
  const allowed = {
    name:patch.name,
    summary:patch.summary,
    eligibleRoleGroups:patch.eligibleRoleGroups,
    rules:patch.rules,
  };
  const cleanPatch = Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
  if (trait) {
    applyTraitPatch(trait, cleanPatch);
    overrides.traits[id] = { ...(overrides.traits[id] ?? {}), ...clone(cleanPatch) };
  } else {
    overrides.traitDrafts[id] = normalizeTraitDraft(id, {
      ...draft,
      ...clone(cleanPatch),
      updatedAt:new Date().toISOString(),
    });
  }
  await persist();
  return ydlContentView().traits.find((candidate) => candidate.id === id);
}

export async function createYdlTraitDraft(patch) {
  const id = `custom-${randomUUID()}`;
  const draft = normalizeTraitDraft(id, {
    name:patch.name,
    summary:patch.summary,
    eligibleRoleGroups:patch.eligibleRoleGroups,
    rules:[],
  });
  overrides.traitDrafts[id] = draft;
  await persist();
  return traitView(draft, { status:"draft", custom:true });
}
