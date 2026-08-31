import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function atomicWrite(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}
function atomicWriteJson(file, value) { atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }
function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`无法定位需要更新的代码：${label}`);
  return text.replace(before, after);
}

export function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog)) throw new Error("球员目录必须是数组");
  return catalog.map((record) => {
    const player = { ...record, librarySource: "YDL" };
    delete player.batchId;
    return player;
  });
}

export function normalizeRegistry(registry) {
  const normalized = structuredClone(registry);
  normalized.librarySource = "YDL";
  for (const profile of Object.values(normalized.profiles ?? {})) profile.sourceGroup = "YDL";
  return normalized;
}

export function normalizeAdminData(admin, now = new Date().toISOString()) {
  const normalized = structuredClone(admin);
  const draftBatchIds = new Set(Object.values(normalized.drafts ?? {}).map((draft) => draft.batchId).filter(Boolean));
  normalized.batches = Object.fromEntries(Object.entries(normalized.batches ?? {}).filter(([id]) => draftBatchIds.has(id)));
  normalized.librarySource = "YDL";
  normalized.updatedAt = now;
  delete normalized.recovery;
  return normalized;
}

function normalizeSourceFiles(root) {
  const update = (relative, edits) => {
    const file = path.join(root, relative);
    let text = fs.readFileSync(file, "utf8");
    for (const [before, after, label] of edits) text = replaceRequired(text, before, after, `${relative} / ${label}`);
    atomicWrite(file, text);
  };
  update("admin-v2.html", [
    ["20260830-s4-player-library", "20260830-ydl-player-library", "缓存版本"],
    ["以 S4 工作台为底座，管理球员数值、制卡批次、卡画资产与生产目录。", "统一维护 YDL 引入球员、球员数值、制卡任务、卡画资产与生产目录。", "后台说明"],
  ]);
  update("admin-v2.js", [
    ["S4 CONTENT LIBRARY", "YDL PLAYER LIBRARY", "球员库标题"],
    ["保存后按 S4 位置算法重算总评", "保存后按 YDL 位置算法重算总评", "能力算法说明"],
    ["S4 PLAYER CARD STUDIO", "YDL PLAYER CARD STUDIO", "卡画工作室标题"],
  ]);
  update("server/application/player-library-service.mjs", [
    ["attributes: clone(player.attributes ?? {}), status, batchId: player.batchId ?? null,", "attributes: clone(player.attributes ?? {}), status, batchId: player.batchId ?? null, librarySource: player.librarySource ?? \"YDL\",", "公开球员来源"],
    ["return {\n      name: clean(input.name", "return {\n      librarySource: \"YDL\", name: clean(input.name", "维护球员来源"],
    ["sourceGroup: \"admin\", updatedAt:", "sourceGroup: \"YDL\", updatedAt:", "后台卡画来源"],
  ]);
  update("scripts/import-s4-player-profiles.mjs", [
    ["sourceGroup: group };", "sourceGroup: \"YDL\" };", "静态卡画来源"],
  ]);
  update("scripts/recover-s4-player-library.mjs", [
    ["isX: false, requestedOverall:", "isX: false, librarySource: \"YDL\", requestedOverall:", "恢复球员来源"],
    ["attributeMode: record.attributeMode ?? null, batchId: record.batchId ?? null,", "attributeMode: record.attributeMode ?? null,", "恢复批次字段"],
    ["sourceGroup: \"s4-studio\", updatedAt:", "sourceGroup: \"YDL\", updatedAt:", "恢复卡画来源"],
    ["  for (const [id, batch] of Object.entries(studio.batches ?? {})) admin.batches[id] = clone(batch);\n  admin.updatedAt = now;\n  admin.recovery = {\n    source: \"S4 server ydl-player-card-studio.json\", sourceUpdatedAt: studio.updatedAt ?? null,\n    recoveredAt: now, publishedPlayers: publishedEntries.length, profiles: profileEntries.length,\n  };", "  admin.librarySource = \"YDL\";\n  admin.updatedAt = now;", "恢复后台历史批次"],
  ]);
}

export function normalizeYdlPlayerLibrary({ root = defaultRoot, now = new Date().toISOString(), updateSources = true } = {}) {
  const catalogPath = path.join(root, "assets/data/s4-player-catalog.json");
  const basePath = path.join(root, "assets/data/s4-player-base-catalog.json");
  const registryPath = path.join(root, "assets/data/s4-player-profile-registry.json");
  const adminPath = path.join(root, "data/player-library-admin.json");
  const catalog = normalizeCatalog(readJson(catalogPath));
  const base = normalizeCatalog(readJson(basePath));
  const registry = normalizeRegistry(readJson(registryPath));
  const admin = normalizeAdminData(readJson(adminPath), now);
  if (catalog.length !== base.length) throw new Error(`正式/基础球员库数量不一致：${catalog.length}/${base.length}`);
  if (new Set(catalog.map((player) => player.id)).size !== catalog.length) throw new Error("球员库存在重复 ID");
  atomicWriteJson(basePath, base);
  atomicWriteJson(catalogPath, catalog);
  atomicWriteJson(registryPath, registry);
  atomicWriteJson(adminPath, admin);
  if (updateSources) normalizeSourceFiles(root);
  return {
    players: catalog.length, profiles: Object.keys(registry.profiles ?? {}).length,
    playerSource: [...new Set(catalog.map((player) => player.librarySource))],
    profileSource: [...new Set(Object.values(registry.profiles ?? {}).map((profile) => profile.sourceGroup))],
    historicalBatches: Object.keys(admin.batches ?? {}).length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { console.log(JSON.stringify(normalizeYdlPlayerLibrary(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
