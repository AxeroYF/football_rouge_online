import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const ATTRIBUTE_NAMES = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { if (error.code === "ENOENT" && fallback !== null) return clone(fallback); throw error; }
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function poolForRole(role) {
  if (role === "GK") return "GK";
  if (["CB", "LB", "RB", "LWB", "RWB"].includes(role)) return "DEF";
  if (["ST", "LW", "RW"].includes(role)) return "ATT";
  return "MID";
}
function emptyState() {
  return {
    retired: false, fitness: 100, form: 50, morale: 70, injuryProneness: 15,
    injury: { severity: "none", matchesRemaining: 0, totalMatches: 0, cause: null, sufferedAtStage: null },
    suspension: { matchesRemaining: 0, totalMatches: 0, reason: null, receivedAtStage: null },
  };
}
function profileFileName(profile) {
  const optimized = String(profile?.optimizedFileName ?? "").trim();
  if (!/^[a-f0-9]{24}\.webp$/i.test(optimized)) throw new Error(`无效的服务器卡画文件名：${optimized || "(空)"}`);
  return `s4-imported/${optimized}`;
}
function profilePosition(profile) {
  return { x: Number(profile.xPercent), y: Number(profile.yPercent), width: Number(profile.widthPercent) };
}
function catalogPlayer(record, profile = null) {
  const attributes = Object.fromEntries(ATTRIBUTE_NAMES.map((name) => {
    const value = Number(record.attributes?.[name]);
    if (!Number.isFinite(value)) throw new Error(`球员 ${record.id} 缺少有效属性 ${name}`);
    return [name, value];
  }));
  const portrait = profile ? `./assets/player-profiles/${profileFileName(profile)}` : null;
  return {
    id: String(record.id), name: String(record.name), sourceName: record.sourceName ?? null,
    role: record.role, secondaryRole: record.secondaryRole ?? null, pool: poolForRole(record.role),
    overall: Number(record.overall), grade: record.grade, nationality: record.nationality, club: record.club,
    preferredFoot: record.preferredFoot ?? "right", heightCm: Number(record.heightCm ?? 180),
    weakFoot: record.weakFoot ?? null, skillMoves: record.skillMoves ?? null,
    attributes, referenceAttributes: clone(attributes), baseOverall: Number(record.overall), upgradeLevel: 0,
    traits: [], state: emptyState(), portrait, portraitPosition: profile ? profilePosition(profile) : null,
    isX: false, librarySource: "YDL", requestedOverall: record.requestedOverall ?? record.overall,
    attributeMode: record.attributeMode ?? null,
    createdAt: record.createdAt ?? null, updatedAt: record.updatedAt ?? null, publishedAt: record.publishedAt ?? null,
  };
}

function studioFromArchive(archive) {
  const entries = ["data/ydl-player-card-studio.json", "./data/ydl-player-card-studio.json"];
  for (const entry of entries) {
    try {
      return JSON.parse(execFileSync("tar", ["-xOf", archive, entry], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch { /* Try the alternate archive path. */ }
  }
  throw new Error(`数据压缩包中没有 data/ydl-player-card-studio.json：${archive}`);
}

export function readStudioSource(source) {
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`服务器数据源不存在：${resolved}`);
  if (fs.statSync(resolved).isFile()) return resolved.toLowerCase().endsWith(".json") ? readJson(resolved) : studioFromArchive(resolved);
  const direct = [path.join(resolved, "data", "ydl-player-card-studio.json"), path.join(resolved, "ydl-player-card-studio.json")]
    .find((candidate) => fs.existsSync(candidate));
  if (direct) return readJson(direct);
  const archives = path.join(resolved, "archives");
  const archive = fs.existsSync(archives)
    ? fs.readdirSync(archives).filter((name) => /^football-s4-data-.*\.tar\.gz$/i.test(name)).sort().at(-1)
    : null;
  if (archive) return studioFromArchive(path.join(archives, archive));
  throw new Error(`目录中没有服务器 studio 数据或 data 压缩包：${resolved}`);
}

export function recoverPlayerLibrary({ root = defaultRoot, studio, now = new Date().toISOString() }) {
  if (!studio || typeof studio !== "object") throw new Error("缺少服务器 studio 数据");
  const published = studio.published ?? {};
  const profiles = studio.profiles ?? {};
  const catalogPath = path.join(root, "assets/data/s4-player-catalog.json");
  const baseCatalogPath = path.join(root, "assets/data/s4-player-base-catalog.json");
  const registryPath = path.join(root, "assets/data/s4-player-profile-registry.json");
  const adminPath = path.join(root, "data/player-library-admin.json");
  const profileRoot = path.join(root, "assets/player-profiles");
  const catalog = readJson(catalogPath);
  const baseCatalog = readJson(baseCatalogPath);
  const registry = readJson(registryPath, { schemaVersion: 1, generatedAt: null, profiles: {} });
  const admin = readJson(adminPath, { schemaVersion: 1, updatedAt: null, batches: {}, drafts: {} });
  if (!Array.isArray(catalog) || !Array.isArray(baseCatalog)) throw new Error("球员目录格式无效");

  const publishedEntries = Object.entries(published);
  const profileEntries = Object.entries(profiles);
  const publishedIds = new Set(publishedEntries.map(([id]) => id));
  const ownerIds = new Set([...catalog.map((player) => String(player.id)), ...publishedIds]);
  const missingOwners = profileEntries.filter(([id]) => !ownerIds.has(id)).map(([id]) => id);
  if (missingOwners.length) throw new Error(`存在没有球员记录的卡画映射：${missingOwners.join(", ")}`);
  const missingAssets = profileEntries.map(([id, profile]) => ({ id, fileName: profileFileName(profile) }))
    .filter(({ fileName }) => !fs.existsSync(path.join(profileRoot, fileName)));
  if (missingAssets.length) throw new Error(`缺少 ${missingAssets.length} 个卡画文件：${missingAssets.slice(0, 5).map((entry) => entry.fileName).join(", ")}`);

  const profileById = new Map(profileEntries);
  const mergePublished = (target) => {
    const byId = new Map(target.map((player) => [String(player.id), player]));
    let added = 0;
    for (const [id, record] of publishedEntries) {
      if (byId.has(id)) continue;
      const player = catalogPlayer(record, profileById.get(id));
      target.push(player); byId.set(id, player); added += 1;
    }
    return added;
  };
  const addedToCatalog = mergePublished(catalog);
  const addedToBase = mergePublished(baseCatalog);

  const applyProfiles = (target) => {
    const byId = new Map(target.map((player) => [String(player.id), player]));
    for (const [id, profile] of profileEntries) {
      const player = byId.get(id);
      player.portrait = `./assets/player-profiles/${profileFileName(profile)}`;
      player.portraitPosition = profilePosition(profile);
    }
  };
  applyProfiles(catalog); applyProfiles(baseCatalog);

  registry.profiles ??= {};
  for (const [id, profile] of profileEntries) {
    registry.profiles[id] = {
      profileKey: id, fileName: profileFileName(profile),
      x: Number(profile.xPercent), y: Number(profile.yPercent), width: Number(profile.widthPercent),
      sourceGroup: "YDL", updatedAt: profile.updatedAt ?? studio.updatedAt ?? now,
      sourceFileName: profile.sourceFileName ?? null, contentHash: profile.contentHash ?? null,
    };
  }
  registry.generatedAt = now;

  admin.batches ??= {}; admin.drafts ??= {};
  admin.librarySource = "YDL";
  admin.updatedAt = now;

  const ids = catalog.map((player) => String(player.id));
  if (new Set(ids).size !== ids.length) throw new Error("恢复后球员库存在重复 ID");
  if (catalog.length !== baseCatalog.length) throw new Error(`正式/基础球员库数量不一致：${catalog.length}/${baseCatalog.length}`);

  atomicWriteJson(baseCatalogPath, baseCatalog);
  atomicWriteJson(catalogPath, catalog);
  atomicWriteJson(registryPath, registry);
  atomicWriteJson(adminPath, admin);
  return {
    activePlayers: catalog.length, basePlayers: baseCatalog.length,
    publishedPlayers: publishedEntries.length, addedToCatalog, addedToBase,
    profilesRecovered: profileEntries.length,
    publishedWithProfile: publishedEntries.filter(([id]) => profileById.has(id)).length,
    publishedWithoutProfile: publishedEntries.filter(([id]) => !profileById.has(id)).length,
    existingPlayersGivenProfiles: profileEntries.filter(([id]) => !publishedIds.has(id)).length,
    registryProfiles: Object.keys(registry.profiles).length,
  };
}

function parseArgs(args) {
  const options = { source: null, root: defaultRoot };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root") options.root = path.resolve(args[++index]);
    else if (!options.source) options.source = args[index];
    else throw new Error(`未知参数：${args[index]}`);
  }
  if (!options.source) throw new Error("用法：node scripts/recover-s4-player-library.mjs <studio.json|data-archive|backup-root> [--root <project-root>]");
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = recoverPlayerLibrary({ root: options.root, studio: readStudioSource(options.source) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}
