import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BASE_INPUT = path.join(ROOT, "data", "s4-player-pool-s4.json");
const DLC_INPUT = path.join(ROOT, "data", "player-dlc-s4-final.json");
const OUTPUT_JSON = path.join(ROOT, "data", "s4-player-pool-with-dlc.json");
const OUTPUT_MODULE = path.join(ROOT, "versus", "player-pool-s4-dlc-generated.js");

const CORE_ATTRIBUTE_KEYS = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

const normalizeName = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\u4e00-\u9fff]/gi, "")
  .toLowerCase();

const basePayload = JSON.parse(await fs.readFile(BASE_INPUT, "utf8"));
const dlcPayload = JSON.parse(await fs.readFile(DLC_INPUT, "utf8"));
const basePlayers = basePayload.players;
const usedIds = new Set(basePlayers.map((player) => player.id));
const replacedIds = new Set();

function matchingBasePlayer(player) {
  const sourceId = String(player.source?.id ?? "");
  const names = new Set([player.inputName, player.displayNameZh, player.sourceName].map(normalizeName).filter(Boolean));
  return basePlayers.find((candidate) => {
    if (sourceId && String(candidate.sourceId ?? "") === sourceId) return true;
    return [candidate.displayNameZh, candidate.name, candidate.displayName, candidate.sourceName]
      .map(normalizeName)
      .some((name) => name && names.has(name));
  }) ?? null;
}

function stableId(player, index, existing) {
  if (existing) return existing.id;
  const suffix = String(index + 1).padStart(3, "0");
  const preferred = `s4-dlc-20260731-${suffix}`;
  if (!usedIds.has(preferred)) return preferred;
  throw new Error(`duplicate generated DLC id: ${preferred}`);
}

function sourceId(player, index, existing) {
  return String(existing?.sourceId ?? player.source?.id ?? `dlc-20260731-${String(index + 1).padStart(3, "0")}`);
}

function fallbackHeight(role) {
  if (role === "GK") return 190;
  if (["CB", "DM", "ST"].includes(role)) return 185;
  return 178;
}

function convertPlayer(player, index) {
  const existing = matchingBasePlayer(player);
  if (existing) {
    if (replacedIds.has(existing.id)) throw new Error(`multiple DLC players matched ${existing.id}`);
    replacedIds.add(existing.id);
  }
  const id = stableId(player, index, existing);
  usedIds.add(id);
  const resolvedSourceId = sourceId(player, index, existing);
  const heightCm = Number(player.heightCm) >= 150 ? Number(player.heightCm) : fallbackHeight(player.role);
  const age = Number(player.age) > 0 ? Number(player.age) : 27;
  const preferredFoot = ["left", "right", "both"].includes(player.preferredFoot) ? player.preferredFoot : "right";
  const weakFoot = Number(player.weakFoot) > 0 ? Number(player.weakFoot) : 3;
  const skillMoves = Number(player.skillMoves) > 0 ? Number(player.skillMoves) : player.role === "GK" ? 1 : 3;
  const sourceDataset = player.source?.type || "S4 player DLC";
  const referenceOverall = Number.isFinite(Number(player.source?.overall)) ? Number(player.source.overall) : player.overall;

  return {
    ...(existing ?? {}),
    id,
    sourceId: resolvedSourceId,
    sourceRank: existing?.sourceRank ?? 10000 + index,
    sourceName: player.sourceName,
    displayName: player.displayNameZh,
    displayNameZh: player.displayNameZh,
    name: player.displayNameZh,
    isLegend: player.grade === "S",
    pool: player.pool,
    role: player.role,
    secondaryRole: player.secondaryRole,
    secondaryRoleSource: "user DLC workbook",
    sourceMainPosition: player.role,
    sourceAlternativePositions: player.secondaryRole ?? "",
    referenceOverall,
    suggestedOverall: player.overall,
    suggestedGrade: player.grade,
    nationality: player.nationality,
    club: player.club,
    league: existing?.league ?? "",
    heightCm,
    age,
    preferredFoot,
    weakFoot,
    skillMoves,
    attributes: { ...player.attributes },
    eafcReferenceAttributes: null,
    referenceAttributes: { ...player.attributes },
    sourceUrl: player.source?.url ?? "",
    sourceDataset,
    sourceUpdatedAt: "2026-07-31",
    sourceLicense: existing?.sourceLicense ?? "",
    reviewStatus: "用户 DLC 最终确认",
    userWorkbookEdited: true,
    userWorkbookNameEdited: true,
    sourceNationality: player.nationality,
    sourceClub: player.club,
    localizationMethod: "user-dlc-workbook",
    localizationConfidence: "high",
    localizationNote: player.source?.note ?? "",
    isDlc: true,
    dlcBatch: "2026-07-31",
  };
}

const dlcPlayers = dlcPayload.players.map(convertPlayer);
const mergedPlayers = [
  ...basePlayers.filter((player) => !replacedIds.has(player.id)),
  ...dlcPlayers,
];

const invalid = [];
for (const player of dlcPlayers) {
  if (!["GK", "DEF", "MID", "ATT"].includes(player.pool)) invalid.push(`${player.id}:pool`);
  if (!["S", "A", "B", "C"].includes(player.suggestedGrade)) invalid.push(`${player.id}:grade`);
  if (!player.displayNameZh || !player.sourceName || !player.nationality || !player.club) invalid.push(`${player.id}:identity`);
  if (player.heightCm < 150 || player.heightCm > 210) invalid.push(`${player.id}:height`);
  for (const key of CORE_ATTRIBUTE_KEYS) {
    const value = Number(player.attributes[key]);
    if (!Number.isFinite(value) || value < 1 || value > 99) invalid.push(`${player.id}:${key}`);
  }
}
if (invalid.length) throw new Error(`invalid DLC players: ${invalid.join(", ")}`);
if (new Set(mergedPlayers.map((player) => player.id)).size !== mergedPlayers.length) throw new Error("merged player IDs must be unique");

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    base: path.relative(ROOT, BASE_INPUT).replaceAll("\\", "/"),
    dlc: path.relative(ROOT, DLC_INPUT).replaceAll("\\", "/"),
  },
  summary: {
    basePlayers: basePlayers.length,
    dlcEntries: dlcPlayers.length,
    updatedPlayers: replacedIds.size,
    addedPlayers: dlcPlayers.length - replacedIds.size,
    mergedPlayers: mergedPlayers.length,
  },
  coreAttributeKeys: CORE_ATTRIBUTE_KEYS,
  players: mergedPlayers,
};

await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(
  OUTPUT_MODULE,
  `// Generated by devtool/import-player-dlc-to-s4.js.\nexport const S4_DLC_PLAYER_DATABASE = Object.freeze(${JSON.stringify(dlcPlayers, null, 2)});\n`,
  "utf8",
);

console.log(JSON.stringify({
  ...output.summary,
  updated: dlcPlayers.filter((player) => replacedIds.has(player.id)).map((player) => ({ id:player.id, name:player.displayNameZh })),
  grades: Object.fromEntries(["S", "A", "B", "C"].map((grade) => [grade, mergedPlayers.filter((player) => player.suggestedGrade === grade).length])),
  pools: Object.fromEntries(["GK", "DEF", "MID", "ATT"].map((pool) => [pool, mergedPlayers.filter((player) => player.pool === pool).length])),
}, null, 2));
