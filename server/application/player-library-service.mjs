import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ATTRIBUTE_NAMES, playerOverallFromAttributes } from "../../engine/s4-v2.1/game/public/schema.js";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";

const ROLES = Object.freeze(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const GRADES = Object.freeze(["S", "A", "B", "C"]);
const FEET = Object.freeze(["left", "right", "both"]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value, fallback = "") { return String(value ?? fallback).trim(); }
function clamp(value, minimum, maximum, label = "数值") {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}必须是数字`);
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { if (error.code === "ENOENT") return clone(fallback); throw error; }
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function distribution(values) {
  return Object.entries(values.reduce((counts, value) => {
    const key = clean(value, "未填写") || "未填写";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {})).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
function poolForRole(role) {
  if (role === "GK") return "GK";
  if (["CB", "LB", "RB", "LWB", "RWB"].includes(role)) return "DEF";
  if (["ST", "LW", "RW"].includes(role)) return "ATT";
  return "MID";
}
function assertChoice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label}无效`);
  return value;
}

export class PlayerLibraryService {
  constructor({ root, catalog, campaign = null } = {}) {
    if (!root || !Array.isArray(catalog)) throw new Error("PlayerLibraryService requires root and catalog");
    this.root = root;
    this.catalog = catalog;
    this.campaign = campaign;
    this.baseCatalogPath = path.join(root, "assets/data/s4-player-base-catalog.json");
    this.catalogPath = path.join(root, "assets/data/s4-player-catalog.json");
    this.overridesPath = path.join(root, "assets/data/s4-production-content-overrides.json");
    this.registryPath = path.join(root, "assets/data/s4-player-profile-registry.json");
    this.profileRoot = path.join(root, "assets/player-profiles");
    this.studioPath = path.join(root, "data/player-library-admin.json");
    this.baseCatalog = readJson(this.baseCatalogPath, []);
    this.overrides = readJson(this.overridesPath, { schemaVersion: 2, updatedAt: null, players: {} });
    this.registry = readJson(this.registryPath, { schemaVersion: 1, generatedAt: null, profiles: {} });
    this.studio = readJson(this.studioPath, { schemaVersion: 1, updatedAt: null, batches: {}, drafts: {} });
  }

  metadata() {
    return {
      attributeNames: [...ATTRIBUTE_NAMES], roles: [...ROLES], grades: [...GRADES], feet: [...FEET],
      attributeLabels: { passing:"传球", firstTouch:"停球", dribbling:"盘带", crossing:"传中", finishing:"射门", longShots:"远射", heading:"头球", setPieces:"定位球", tackling:"抢断", marking:"盯人", positioning:"站位", vision:"视野", decisions:"决策", composure:"冷静", offBall:"无球", discipline:"纪律", pace:"速度", acceleration:"加速", strength:"力量", stamina:"耐力", agility:"灵活", jumping:"弹跳", workRate:"投入", aggression:"侵略性", goalkeeping:"守门", reflexes:"反应" },
    };
  }

  profileFor(player) {
    const profile = this.registry.profiles?.[String(player.id)] ?? null;
    if (!profile) return null;
    const fileName = clean(profile.fileName);
    return { ...clone(profile), imageUrl: `/assets/player-profiles/${fileName.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}` };
  }

  publicPlayer(player, status = "active") {
    const value = {
      id: player.id, name: player.name, sourceName: player.sourceName ?? null, role: player.role,
      secondaryRole: player.secondaryRole ?? null, pool: player.pool ?? poolForRole(player.role), overall: Number(player.overall),
      grade: player.grade, nationality: player.nationality, club: player.club, heightCm: player.heightCm,
      preferredFoot: player.preferredFoot ?? "right", weakFoot: player.weakFoot ?? null, skillMoves: player.skillMoves ?? null,
      attributes: clone(player.attributes ?? {}), status, batchId: player.batchId ?? null, librarySource: player.librarySource ?? "YDL",
      isX: Boolean(player.isX), profile: this.profileFor(player), updatedAt: player.updatedAt ?? null,
    };
    return { ...value, card: createPlayerCardViewModel(value) };
  }

  overview() {
    const audit = this.audit();
    return { ...this.metadata(), audit, drafts: Object.keys(this.studio.drafts ?? {}).length, batches: this.listBatches() };
  }

  listPlayers(filters = {}) {
    const term = clean(filters.search).toLowerCase();
    const status = clean(filters.status, "all");
    const grade = clean(filters.grade, "all");
    const role = clean(filters.role, "all");
    const profile = clean(filters.profile, "all");
    const active = this.catalog.map((player) => this.publicPlayer(player, "active"));
    const drafts = Object.values(this.studio.drafts ?? {}).map((player) => this.publicPlayer(player, "draft"));
    return [...(status === "draft" ? [] : active), ...(status === "active" ? [] : drafts)]
      .filter((player) => grade === "all" || player.grade === grade)
      .filter((player) => role === "all" || player.role === role)
      .filter((player) => profile === "all" || (profile === "present" ? player.profile : !player.profile))
      .filter((player) => !term || `${player.id} ${player.name} ${player.sourceName ?? ""} ${player.club} ${player.nationality}`.toLowerCase().includes(term))
      .sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name));
  }

  getPlayer(id) {
    const active = this.catalog.find((player) => String(player.id) === String(id));
    if (active) return this.publicPlayer(active, "active");
    const draft = this.studio.drafts?.[String(id)];
    if (draft) return this.publicPlayer(draft, "draft");
    throw Object.assign(new Error("球员不存在"), { statusCode: 404 });
  }

  getCard(id) {
    return this.getPlayer(id).card;
  }

  normalizePatch(input, current = {}) {
    const role = assertChoice(clean(input.role ?? current.role, "ST"), ROLES, "主位置");
    const secondaryRole = clean(input.secondaryRole ?? current.secondaryRole) || null;
    if (secondaryRole && (!ROLES.includes(secondaryRole) || secondaryRole === role)) throw new Error("副位置无效");
    const grade = assertChoice(clean(input.grade ?? current.grade, "C"), GRADES, "评级");
    const attributes = { ...(current.attributes ?? {}) };
    if (input.attributes && typeof input.attributes === "object") {
      for (const key of ATTRIBUTE_NAMES) if (Object.hasOwn(input.attributes, key)) attributes[key] = clamp(input.attributes[key], 1, 99, key);
    }
    for (const key of ATTRIBUTE_NAMES) if (!Number.isFinite(Number(attributes[key]))) attributes[key] = clamp(input.overall ?? current.overall ?? 70, 1, 99);
    const calculatedOverall = playerOverallFromAttributes(attributes, role);
    return {
      librarySource: "YDL", name: clean(input.name ?? current.name), sourceName: clean(input.sourceName ?? current.sourceName ?? input.name ?? current.name),
      role, secondaryRole, pool: poolForRole(role), grade, nationality: clean(input.nationality ?? current.nationality),
      club: clean(input.club ?? current.club), heightCm: clamp(input.heightCm ?? current.heightCm ?? 180, 140, 220, "身高"),
      preferredFoot: FEET.includes(input.preferredFoot ?? current.preferredFoot) ? input.preferredFoot ?? current.preferredFoot : "right",
      overall: calculatedOverall, baseOverall: calculatedOverall, attributes, referenceAttributes: clone(attributes),
    };
  }

  updatePlayer(id, input) {
    const player = this.catalog.find((candidate) => String(candidate.id) === String(id));
    if (!player) throw Object.assign(new Error("正式球员不存在"), { statusCode: 404 });
    const patch = this.normalizePatch(input, player);
    Object.assign(player, patch);
    this.overrides.players ??= {};
    this.overrides.players[id] = { ...(this.overrides.players[id] ?? {}), ...clone(patch) };
    this.overrides.updatedAt = new Date().toISOString();
    atomicWriteJson(this.overridesPath, this.overrides);
    atomicWriteJson(this.catalogPath, this.catalog);
    return this.publicPlayer(player, "active");
  }

  createDraft(input) {
    const id = clean(input.id) || `ydl-custom-${crypto.randomUUID()}`;
    if (this.catalog.some((player) => String(player.id) === id) || this.studio.drafts?.[id]) throw new Error(`球员ID已存在：${id}`);
    const normalized = this.normalizePatch(input);
    if (!normalized.name || !normalized.nationality || !normalized.club) throw new Error("球员姓名、国籍和俱乐部不能为空");
    const draft = { id, ...normalized, batchId: clean(input.batchId) || null, status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isX: false };
    if (draft.batchId && !this.studio.batches?.[draft.batchId]) throw new Error("发布批次不存在");
    this.studio.drafts ??= {}; this.studio.drafts[id] = draft; this.persistStudio();
    return this.publicPlayer(draft, "draft");
  }

  createDrafts(rows, batchId = null) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("没有可导入的球员数据");
    const created = [];
    for (const row of rows) created.push(this.createDraft({ ...row, batchId: batchId ?? row.batchId }));
    return created;
  }

  updateDraft(id, input) {
    const current = this.studio.drafts?.[id];
    if (!current) throw Object.assign(new Error("暂存球员不存在"), { statusCode: 404 });
    const normalized = this.normalizePatch(input, current);
    Object.assign(current, normalized, { updatedAt: new Date().toISOString() });
    this.persistStudio();
    return this.publicPlayer(current, "draft");
  }

  createBatch(input) {
    const name = clean(input.name);
    if (!name) throw new Error("批次名称不能为空");
    const id = `player-batch-${crypto.randomUUID()}`;
    const batch = { id, name, description: clean(input.description).slice(0, 500), status: "staging", createdAt: new Date().toISOString(), publishedAt: null };
    this.studio.batches ??= {}; this.studio.batches[id] = batch; this.persistStudio(); return clone(batch);
  }

  listBatches() {
    return Object.values(this.studio.batches ?? {}).map((batch) => {
      const drafts = Object.values(this.studio.drafts ?? {}).filter((player) => player.batchId === batch.id);
      return { ...clone(batch), draftCount: drafts.length, readyCount: drafts.filter((player) => this.registry.profiles?.[player.id]).length, missingProfileCount: drafts.filter((player) => !this.registry.profiles?.[player.id]).length };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  publishDrafts(ids) {
    const uniqueIds = [...new Set((ids ?? []).map(String))];
    if (!uniqueIds.length) throw new Error("请选择需要上线的暂存球员");
    const records = uniqueIds.map((id) => {
      const value = this.studio.drafts?.[id];
      if (!value) throw new Error(`暂存球员不存在：${id}`);
      return clone(value);
    });
    for (const record of records) {
      const player = { ...record, status: undefined, batchId: undefined, createdAt: undefined, updatedAt: undefined };
      this.baseCatalog.push(player); this.catalog.push(clone(player)); delete this.studio.drafts[record.id];
      if (this.campaign) {
        const live = this.catalog[this.catalog.length - 1];
        this.campaign.playerDatabase.push(live);
        if (["A", "B", "C"].includes(live.grade)) this.campaign.catalog.push(live);
      }
    }
    for (const batch of Object.values(this.studio.batches ?? {})) {
      if (batch.status === "staging" && !Object.values(this.studio.drafts ?? {}).some((player) => player.batchId === batch.id)) {
        batch.status = "published"; batch.publishedAt = new Date().toISOString();
      }
    }
    atomicWriteJson(this.baseCatalogPath, this.baseCatalog); atomicWriteJson(this.catalogPath, this.catalog); this.persistStudio();
    return records.map((player) => this.getPlayer(player.id));
  }

  saveProfile(playerId, input) {
    const owner = (() => { try { return this.getPlayer(playerId); } catch { return null; } })();
    if (!owner) throw Object.assign(new Error("球员不存在"), { statusCode: 404 });
    const existing = this.registry.profiles?.[playerId] ?? null;
    let fileName = existing?.fileName ?? null;
    if (input.imageDataUrl) {
      const match = String(input.imageDataUrl).match(/^data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new Error("卡画必须是透明 PNG 或 WebP");
      const data = Buffer.from(match[2], "base64");
      if (!data.length || data.length > 12 * 1024 * 1024) throw new Error("卡画必须小于 12MB");
      const extension = match[1] === "png" ? "png" : "webp";
      fileName = `admin/${crypto.createHash("sha256").update(String(playerId)).digest("hex").slice(0, 24)}.${extension}`;
      const target = path.join(this.profileRoot, fileName);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
    }
    if (!fileName) throw new Error("请先上传球员卡画");
    const profile = {
      profileKey: existing?.profileKey ?? playerId, fileName,
      x: Math.max(-50, Math.min(150, Number(input.x ?? existing?.x ?? 50))),
      y: Math.max(-50, Math.min(150, Number(input.y ?? existing?.y ?? 52))),
      width: Math.max(40, Math.min(360, Number(input.width ?? existing?.width ?? 200))),
      sourceGroup: "YDL", updatedAt: new Date().toISOString(), sourceFileName: clean(input.sourceFileName) || existing?.sourceFileName || null,
    };
    this.registry.profiles ??= {}; this.registry.profiles[playerId] = profile; this.registry.generatedAt = new Date().toISOString();
    atomicWriteJson(this.registryPath, this.registry);
    const active = this.catalog.find((player) => String(player.id) === String(playerId));
    if (active) { active.portrait = `./assets/player-profiles/${fileName}`; active.portraitPosition = { x: profile.x, y: profile.y, width: profile.width }; atomicWriteJson(this.catalogPath, this.catalog); }
    const base = this.baseCatalog.find((player) => String(player.id) === String(playerId));
    if (base) { base.portrait = `./assets/player-profiles/${fileName}`; base.portraitPosition = { x: profile.x, y: profile.y, width: profile.width }; atomicWriteJson(this.baseCatalogPath, this.baseCatalog); }
    return this.profileFor(owner);
  }

  audit() {
    const profiles = this.registry.profiles ?? {};
    const activeIds = new Set(this.catalog.map((player) => String(player.id)));
    const baseIds = new Set(this.baseCatalog.map((player) => String(player.id)));
    const missingAssets = [];
    for (const [id, profile] of Object.entries(profiles)) if (!fs.existsSync(path.join(this.profileRoot, clean(profile.fileName)))) missingAssets.push({ id, fileName: profile.fileName });
    const assetFiles = [];
    const visit = (directory) => { if (!fs.existsSync(directory)) return; for (const entry of fs.readdirSync(directory, { withFileTypes:true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) visit(target); else if (/\.(png|webp)$/i.test(entry.name)) assetFiles.push(path.relative(this.profileRoot, target).replaceAll("\\", "/")); } };
    visit(this.profileRoot);
    const referencedFiles = new Set(Object.values(profiles).map((profile) => clean(profile.fileName).replaceAll("\\", "/").toLowerCase()));
    const unusedAssetFiles = assetFiles.filter((file) => !referencedFiles.has(file.toLowerCase()));
    const duplicateIds = distribution(this.catalog.map((player) => player.id)).filter((entry) => entry.count > 1);
    const duplicateNames = distribution(this.catalog.map((player) => player.name)).filter((entry) => entry.count > 1);
    const incomplete = this.catalog.filter((player) => ATTRIBUTE_NAMES.some((key) => !Number.isFinite(Number(player.attributes?.[key])))).map((player) => player.id);
    const invalidOverall = this.catalog.filter((player) => playerOverallFromAttributes(player.attributes ?? {}, player.role) !== Number(player.overall)).map((player) => player.id);
    return {
      generatedAt: new Date().toISOString(), activePlayers: this.catalog.length, basePlayers: this.baseCatalog.length,
      catalogOnlyIds: [...activeIds].filter((id) => !baseIds.has(id)), baseOnlyIds: [...baseIds].filter((id) => !activeIds.has(id)),
      profileEntries: Object.keys(profiles).length, activeWithProfile: this.catalog.filter((player) => profiles[player.id]).length,
      profileCoverage: Number((this.catalog.filter((player) => profiles[player.id]).length / Math.max(1, this.catalog.length) * 100).toFixed(1)),
      assetFiles: assetFiles.length, unusedAssetFiles, missingAssets,
      orphanProfiles: Object.keys(profiles).filter((id) => !activeIds.has(id) && !this.studio.drafts?.[id]),
      duplicateIds, duplicateNames, incompleteAttributePlayers: incomplete, overallMismatchPlayers: invalidOverall,
      productionOverrides: Object.keys(this.overrides.players ?? {}).length,
      grade: distribution(this.catalog.map((player) => player.grade)), role: distribution(this.catalog.map((player) => player.role)),
      sourceGroup: distribution(Object.values(profiles).map((profile) => profile.sourceGroup)),
    };
  }

  persistStudio() { this.studio.updatedAt = new Date().toISOString(); atomicWriteJson(this.studioPath, this.studio); }
}

export { ATTRIBUTE_NAMES, GRADES, ROLES };
