import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ATTRIBUTE_NAMES, normalizePlayerSchema, playerOverallFromAttributes, roleGroup } from "../game/public/schema.js";
import {
  isXPlayer,
  normalizedS4LegendAttributes,
  REAL_PLAYER_BY_ID,
  REAL_PLAYERS,
  registerCustomRealPlayer,
  S4_PLAYER_DEFAULT_ATTRIBUTE_CAP,
} from "./player-pool.js";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const STUDIO_PATH = path.resolve(process.env.YDL_PLAYER_CARD_STUDIO_PATH ?? path.join(ROOT, "data", "ydl-player-card-studio.json"));
const STUDIO_BACKUP_PATH = `${STUDIO_PATH}.backup`;
const PROFILE_ROOT = path.resolve(process.env.YDL_PLAYER_PROFILE_ROOT ?? path.join(ROOT, "player_profiles"));
const PROFILE_WEBP_DIRECTORY = path.join(PROFILE_ROOT, "webp");
const STUDIO_SCHEMA_VERSION = 2;
const PLAYER_ROLES = Object.freeze(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const PLAYER_GRADES = Object.freeze(["S", "A", "B", "C"]);
const PROFILE_GRADES = Object.freeze(["X", ...PLAYER_GRADES]);
let sharpInstance = null;

let studio = {
  schemaVersion:STUDIO_SCHEMA_VERSION,
  updatedAt:null,
  batches:{},
  drafts:{},
  published:{},
  profiles:{},
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nonEmpty(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  return text;
}

function clamp(value, minimum, maximum, label = "数值") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${label}必须是数字`);
  return Math.max(minimum, Math.min(maximum, numeric));
}

function rounded(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function imageProcessor() {
  if (sharpInstance) return sharpInstance;
  try {
    sharpInstance = require("sharp");
    return sharpInstance;
  } catch {
    throw new Error("服务器缺少sharp，无法把PNG转换为WebP。请先执行npm install。");
  }
}

function normalizedRole(value) {
  const role = String(value ?? "");
  if (!PLAYER_ROLES.includes(role)) throw new Error("主位置无效");
  return role;
}

function normalizedSecondaryRole(value, primaryRole) {
  const role = value ? String(value) : null;
  if (role && (!PLAYER_ROLES.includes(role) || role === primaryRole)) throw new Error("副位置无效");
  return role;
}

function normalizedGrade(value) {
  const grade = String(value ?? "");
  if (!PLAYER_GRADES.includes(grade)) throw new Error("新球员评级必须是S、A、B或C");
  return grade;
}

function completeAttributes(attributes) {
  const input = attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {};
  return Object.fromEntries(ATTRIBUTE_NAMES.map((key) => {
    if (!Object.hasOwn(input, key)) throw new Error(`缺少能力值：${key}`);
    return [key, Math.round(clamp(input[key], 1, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, key))];
  }));
}

export function regressPlayerAttributes(roleValue, overallValue) {
  const role = normalizedRole(roleValue);
  const overall = Math.round(clamp(overallValue, 1, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, "游戏总评"));
  const exactRole = REAL_PLAYERS.filter((player) => !isXPlayer(player) && player.role === role && player.attributes);
  const groupRole = REAL_PLAYERS.filter((player) => !isXPlayer(player) && roleGroup(player.role) === roleGroup(role) && player.attributes);
  const reference = exactRole.length >= 6 ? exactRole : groupRole;
  const averages = Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, reference.length
    ? Math.round(reference.reduce((sum, player) => sum + Number(player.attributes[key] ?? 50), 0) / reference.length)
    : overall]));
  const currentOverall = playerOverallFromAttributes(averages, role);
  const shifted = Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, Math.max(1, Math.min(S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, averages[key] + overall - currentOverall))]));
  const attributes = normalizedS4LegendAttributes(shifted, role, overall);
  return { role, overall:playerOverallFromAttributes(attributes, role), attributes:completeAttributes(attributes) };
}

function normalizedDraft(input, current = null) {
  const role = normalizedRole(input.role ?? current?.role ?? "ST");
  const requestedOverall = Math.round(clamp(input.overall ?? current?.overall ?? 80, 1, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, "游戏总评"));
  const attributeMode = input.attributeMode === "manual" ? "manual" : input.attributeMode === "regress" ? "regress" : current?.attributeMode ?? "regress";
  const attributes = input.attributes
    ? completeAttributes(input.attributes)
    : attributeMode === "regress" || !current?.attributes
      ? regressPlayerAttributes(role, requestedOverall).attributes
      : completeAttributes(current.attributes);
  const calculatedOverall = playerOverallFromAttributes(attributes, role);
  return {
    id:String(input.id ?? current?.id ?? `ydl-custom-${randomUUID()}`),
    name:nonEmpty(input.name ?? current?.name, "球员姓名"),
    sourceName:String(input.sourceName ?? current?.sourceName ?? input.name ?? current?.name).trim(),
    role,
    secondaryRole:normalizedSecondaryRole(input.secondaryRole ?? current?.secondaryRole, role),
    overall:calculatedOverall,
    requestedOverall,
    grade:normalizedGrade(input.grade ?? current?.grade ?? "C"),
    nationality:nonEmpty(input.nationality ?? current?.nationality, "国籍"),
    club:nonEmpty(input.club ?? current?.club, "俱乐部"),
    heightCm:Math.round(clamp(input.heightCm ?? current?.heightCm ?? 180, 140, 220, "身高")),
    preferredFoot:["left", "right", "both"].includes(input.preferredFoot ?? current?.preferredFoot) ? input.preferredFoot ?? current?.preferredFoot : "right",
    attributes,
    attributeMode,
    batchId:input.batchId ?? current?.batchId ?? null,
    status:"draft",
    createdAt:current?.createdAt ?? new Date().toISOString(),
    updatedAt:new Date().toISOString(),
  };
}

function publishedPlayerFromRecord(record) {
  const role = normalizedRole(record.role);
  const attributes = completeAttributes(record.attributes);
  const overall = playerOverallFromAttributes(attributes, role);
  const normalized = normalizePlayerSchema({
    id:record.id,
    name:record.name,
    role,
    secondaryRole:record.secondaryRole,
    preferredFoot:record.preferredFoot,
    heightCm:record.heightCm,
    attributes,
    state:{ fitness:100, form:50, morale:70 },
    development:{ age:27, potential:overall },
    source:"ydl-admin-studio",
    nationality:record.nationality,
    club:record.club,
    cardFamilyId:`player-family-${record.id}`,
    cardVersion:"S4-admin",
    baseOverall:overall,
    upgradeLevel:0,
    upgradeBonus:0,
    canHaveDuplicates:true,
  }, { index:REAL_PLAYERS.length });
  return {
    ...normalized,
    sourceName:record.sourceName ?? record.name,
    sourceId:record.id,
    sourceUrl:null,
    nationality:record.nationality,
    club:record.club,
    pool:roleGroup(role),
    role,
    secondaryRole:record.secondaryRole ?? null,
    overall,
    referenceOverall:overall,
    grade:record.grade,
    referenceAttributes:{ ...attributes },
    signature:record.grade === "S" ? "传奇能力" : null,
    archetype:record.grade === "S" ? "传奇球员" : null,
    individualized:false,
    legendary:record.grade === "S",
    legendAbility:null,
    traits:[],
    customPlayer:true,
    publishedAt:record.publishedAt,
  };
}

function profileUrl(fileName, contentHash) {
  return `/versus/player_profiles/webp/${encodeURIComponent(fileName)}?v=${contentHash}`;
}

function applyProfileToPlayer(playerId) {
  const player = REAL_PLAYER_BY_ID[playerId];
  const profile = studio.profiles[playerId];
  if (player && profile) player.cardProfile = clone(profile);
}

function registerPublishedPlayers() {
  for (const record of Object.values(studio.published ?? {})) {
    if (!REAL_PLAYER_BY_ID[record.id]) registerCustomRealPlayer(publishedPlayerFromRecord(record));
  }
  for (const playerId of Object.keys(studio.profiles ?? {})) applyProfileToPlayer(playerId);
}

function loadStudioSync() {
  try {
    const parsed = JSON.parse(readFileSync(STUDIO_PATH, "utf8"));
    if (parsed && typeof parsed === "object") studio = {
      schemaVersion:STUDIO_SCHEMA_VERSION,
      updatedAt:parsed.updatedAt ?? null,
      batches:parsed.batches && typeof parsed.batches === "object" ? parsed.batches : {},
      drafts:parsed.drafts && typeof parsed.drafts === "object" ? parsed.drafts : {},
      published:parsed.published && typeof parsed.published === "object" ? parsed.published : {},
      profiles:parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  registerPublishedPlayers();
}

async function persistStudio() {
  await mkdir(path.dirname(STUDIO_PATH), { recursive:true });
  try { await copyFile(STUDIO_PATH, STUDIO_BACKUP_PATH); } catch (error) { if (error.code !== "ENOENT") throw error; }
  studio.updatedAt = new Date().toISOString();
  const temporaryPath = `${STUDIO_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(studio, null, 2)}\n`, "utf8");
  await rm(STUDIO_PATH, { force:true });
  await rename(temporaryPath, STUDIO_PATH);
}

function publicDraft(draft) {
  return { ...clone(draft), cardProfile:clone(studio.profiles[draft.id] ?? null) };
}

export function playerCardStudioView() {
  const batches = Object.values(studio.batches).map((batch) => {
    const drafts = Object.values(studio.drafts).filter((draft) => draft.batchId === batch.id);
    const published = Object.values(studio.published).filter((player) => player.batchId === batch.id);
    const profileCount = [...drafts, ...published].filter((player) => studio.profiles[player.id]).length;
    return {
      ...clone(batch),
      draftCount:drafts.length,
      publishedCount:published.length,
      profileCount,
      readyCount:drafts.filter((player) => studio.profiles[player.id]).length,
      issueCount:drafts.filter((player) => !studio.profiles[player.id]).length,
    };
  }).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return {
    schemaVersion:STUDIO_SCHEMA_VERSION,
    updatedAt:studio.updatedAt,
    mediaStorage:{ directory:PROFILE_ROOT, format:"webp", quality:90, maximumDimension:1600, environmentVariable:"YDL_PLAYER_PROFILE_ROOT" },
    batches,
    drafts:Object.values(studio.drafts).map(publicDraft).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))),
    published:Object.values(studio.published).map((record) => ({ ...clone(record), cardProfile:clone(studio.profiles[record.id] ?? null) })),
    profiles:clone(studio.profiles),
  };
}

export async function createPlayerCardDraft(input) {
  const draft = normalizedDraft(input);
  if (draft.batchId && !studio.batches[draft.batchId]) throw new Error("发布批次不存在");
  if (REAL_PLAYER_BY_ID[draft.id] || studio.drafts[draft.id] || studio.published[draft.id]) throw new Error("球员ID已存在");
  studio.drafts[draft.id] = draft;
  await persistStudio();
  return publicDraft(draft);
}

export async function createPlayerCardDrafts(inputs, batchId = null) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("没有可导入的球员数据");
  if (batchId && !studio.batches[batchId]) throw new Error("发布批次不存在");
  const drafts = inputs.map((input) => normalizedDraft({ ...input, batchId:batchId ?? input.batchId ?? null }));
  const ids = new Set();
  for (const draft of drafts) {
    if (ids.has(draft.id) || REAL_PLAYER_BY_ID[draft.id] || studio.drafts[draft.id] || studio.published[draft.id]) throw new Error(`球员ID重复：${draft.id}`);
    ids.add(draft.id);
  }
  drafts.forEach((draft) => { studio.drafts[draft.id] = draft; });
  await persistStudio();
  return drafts.map(publicDraft);
}

export async function updatePlayerCardDraft(id, input) {
  const current = studio.drafts[id];
  if (!current) throw Object.assign(new Error("暂存球员不存在"), { statusCode:404 });
  const draft = normalizedDraft({ ...input, id }, current);
  if (draft.batchId && !studio.batches[draft.batchId]) throw new Error("发布批次不存在");
  studio.drafts[id] = draft;
  await persistStudio();
  return publicDraft(draft);
}

export async function createPlayerCardBatch(input) {
  const now = new Date().toISOString();
  const batch = {
    id:`player-batch-${randomUUID()}`,
    name:nonEmpty(input.name, "批次名称"),
    description:String(input.description ?? "").trim().slice(0, 500),
    status:"staging",
    createdAt:now,
    updatedAt:now,
    publishedAt:null,
  };
  studio.batches[batch.id] = batch;
  await persistStudio();
  return clone(batch);
}

export async function updatePlayerCardBatch(id, input) {
  const current = studio.batches[id];
  if (!current) throw Object.assign(new Error("发布批次不存在"), { statusCode:404 });
  if (current.status === "published") throw new Error("已发布批次不能再修改");
  const batch = {
    ...current,
    name:Object.hasOwn(input, "name") ? nonEmpty(input.name, "批次名称") : current.name,
    description:Object.hasOwn(input, "description") ? String(input.description ?? "").trim().slice(0, 500) : current.description,
    updatedAt:new Date().toISOString(),
  };
  studio.batches[id] = batch;
  await persistStudio();
  return clone(batch);
}

export async function publishPlayerCardBatch(id) {
  const batch = studio.batches[id];
  if (!batch) throw Object.assign(new Error("发布批次不存在"), { statusCode:404 });
  if (batch.status === "published") throw new Error("该批次已经发布");
  const ids = Object.values(studio.drafts).filter((draft) => draft.batchId === id).map((draft) => draft.id);
  if (!ids.length) throw new Error("该批次没有待上线球员");
  const players = await publishDraftIds(ids, batch);
  return { batch:clone(batch), players };
}

export async function publishPlayerCardDrafts(ids) {
  return publishDraftIds(ids);
}

async function publishDraftIds(ids, batch = null) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!uniqueIds.length) throw new Error("请选择需要上线的暂存球员");
  const records = uniqueIds.map((id) => {
    const draft = studio.drafts[id];
    if (!draft) throw new Error(`暂存球员不存在：${id}`);
    if (!studio.profiles[id]) throw new Error(`${draft.name}尚未上传并保存卡画`);
    if (REAL_PLAYER_BY_ID[id]) throw new Error(`球员ID已在正式库中：${id}`);
    return { ...clone(draft), status:"active", publishedAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  });
  records.forEach((record) => { studio.published[record.id] = record; delete studio.drafts[record.id]; });
  if (batch) {
    batch.status = "published";
    batch.publishedAt = new Date().toISOString();
    batch.updatedAt = batch.publishedAt;
  }
  await persistStudio();
  const players = records.map((record) => registerCustomRealPlayer(publishedPlayerFromRecord(record)));
  players.forEach((player) => applyProfileToPlayer(player.id));
  return players.map((player) => ({ id:player.id, name:player.name, grade:player.grade, role:player.role, overall:player.overall }));
}

function profileTargetFileName(playerId) {
  return `${createHash("sha256").update(String(playerId)).digest("hex").slice(0, 24)}.webp`;
}

function decodeImageDataUrl(value) {
  const match = String(value ?? "").match(/^data:(image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("请上传透明PNG或WebP图片");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error("卡画文件必须小于12MB");
  return buffer;
}

function uploadedImageBuffer(input) {
  if (Buffer.isBuffer(input.imageBuffer)) {
    if (!input.imageBuffer.length || input.imageBuffer.length > 12 * 1024 * 1024) throw new Error("卡画文件必须小于12MB");
    return input.imageBuffer;
  }
  return decodeImageDataUrl(input.imageDataUrl);
}

function profileOwner(playerId) {
  return REAL_PLAYER_BY_ID[playerId] ?? studio.drafts[playerId] ?? studio.published[playerId] ?? null;
}

export async function savePlayerCardProfile(playerId, input) {
  const owner = profileOwner(playerId);
  if (!owner) throw Object.assign(new Error("球员或暂存卡不存在"), { statusCode:404 });
  const existing = studio.profiles[playerId];
  let fileName = existing?.optimizedFileName;
  let contentHash = existing?.contentHash;
  let sourceFileName = existing?.sourceFileName ?? null;
  let width = existing?.pixelWidth ?? null;
  let height = existing?.pixelHeight ?? null;
  if (input.imageDataUrl || input.imageBuffer) {
    const buffer = uploadedImageBuffer(input);
    const processor = imageProcessor()(buffer, { failOn:"error" });
    const metadata = await processor.metadata();
    if (!metadata.width || !metadata.height || metadata.width > 8000 || metadata.height > 8000) throw new Error("卡画尺寸无效或超过8000像素");
    fileName = profileTargetFileName(playerId);
    sourceFileName = String(input.sourceFileName ?? `${playerId}.png`).slice(0, 180);
    await mkdir(PROFILE_WEBP_DIRECTORY, { recursive:true });
    const output = await imageProcessor()(buffer, { failOn:"error" })
      .resize({ width:1600, height:1600, fit:"inside", withoutEnlargement:true })
      .webp({ quality:90, alphaQuality:100, smartSubsample:true })
      .toBuffer({ resolveWithObject:true });
    await writeFile(path.join(PROFILE_WEBP_DIRECTORY, fileName), output.data);
    contentHash = createHash("sha256").update(output.data).digest("hex").slice(0, 12);
    width = output.info.width;
    height = output.info.height;
  }
  if (!fileName || !contentHash) throw new Error("请先上传球员卡画PNG");
  const grade = PROFILE_GRADES.includes(String(owner.grade)) ? String(owner.grade) : "C";
  const profile = {
    playerId,
    grade,
    sourceFileName,
    optimizedFileName:fileName,
    imageUrl:profileUrl(fileName, contentHash),
    contentHash,
    xPercent:rounded(clamp(input.xPercent ?? existing?.xPercent ?? 50, -50, 150, "横向位置")),
    yPercent:rounded(clamp(input.yPercent ?? existing?.yPercent ?? 52, -50, 150, "纵向位置")),
    widthPercent:rounded(clamp(input.widthPercent ?? existing?.widthPercent ?? 200, 40, 360, "人物宽度")),
    pixelWidth:width,
    pixelHeight:height,
    updatedAt:new Date().toISOString(),
  };
  studio.profiles[playerId] = profile;
  await persistStudio();
  applyProfileToPlayer(playerId);
  return clone(profile);
}

loadStudioSync();
