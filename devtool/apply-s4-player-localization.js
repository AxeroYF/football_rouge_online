import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const INPUT = path.join(ROOT, "data", "s4-player-candidates-500.json");
const WIKI = path.join(ROOT, "data", "sources", "wikipedia-zh-localization.json");
const OVERRIDES = path.join(ROOT, "data", "s4-localization-overrides.json");
const USER_EDITS = path.join(ROOT, "data", "s4-user-workbook-overrides.json");
const RETIRED_PLAYERS = path.join(ROOT, "data", "s4-retired-famous-players-50.json");
const FINAL_WORKBOOK_EDITS = path.join(ROOT, "data", "s4-final-workbook-overrides.json");
const LEGACY_MATCHES = path.resolve(ROOT, "..", "..", ".tmp-s4-translate", "name-match-suggestions.json");
const OUTPUT_JSON = path.join(ROOT, "data", "s4-player-pool-s4.json");
const OUTPUT_REVIEW = path.join(ROOT, "data", "s4-player-localization-review.json");
const OUTPUT_MODULE = path.join(ROOT, "versus", "player-pool-s4-generated.js");

const CORE_ATTRIBUTE_KEYS = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

function roundAverage(...values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : 50;
}

function clamp(value, minimum = 1, maximum = 99) {
  return Math.max(minimum, Math.min(maximum, Math.round(Number.isFinite(value) ? value : minimum)));
}

function adjusted(value, delta, fallback = 50) {
  return clamp((Number.isFinite(value) ? value : fallback) + delta * 0.65);
}

function coreAttributes(player) {
  if (!player.eafcReferenceAttributes && CORE_ATTRIBUTE_KEYS.every((key) => Number.isFinite(player.attributes[key]))) {
    const delta = player.suggestedOverall - player.referenceOverall;
    return Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, adjusted(player.attributes[key], delta)]));
  }
  const source = player.eafcReferenceAttributes ?? player.attributes;
  const delta = player.suggestedOverall - player.referenceOverall;
  const isGoalkeeper = player.role === "GK";
  const isDefensiveRole = ["CB", "LB", "RB", "DM"].includes(player.role);
  const goalkeeperAverage = roundAverage(
    source.goalkeeperDiving,
    source.goalkeeperHandling,
    source.goalkeeperKicking,
    source.goalkeeperPositioning,
    source.goalkeeperReflexes,
  );
  const raw = {
    passing: roundAverage(source.passing, source.shortPassing, source.longPassing),
    firstTouch: source.ballControl,
    dribbling: source.dribbling,
    crossing: source.crossing,
    finishing: source.finishing,
    longShots: source.longShots,
    heading: source.headingAccuracy,
    setPieces: roundAverage(source.freeKickAccuracy, source.curve, source.penalties),
    tackling: roundAverage(source.standingTackle, source.slidingTackle),
    marking: source.defensiveAwareness,
    positioning: isGoalkeeper
      ? source.goalkeeperPositioning
      : isDefensiveRole ? source.defensiveAwareness : roundAverage(source.defensiveAwareness, source.interceptions),
    vision: source.vision,
    decisions: source.reactions,
    composure: source.composure,
    offBall: source.positioning,
    discipline: clamp(roundAverage(source.composure, source.reactions, 105 - source.aggression), 35, 95),
    pace: source.pace,
    acceleration: source.acceleration,
    strength: source.strength,
    stamina: source.stamina,
    agility: source.agility,
    jumping: source.jumping,
    workRate: source.stamina,
    aggression: source.aggression,
    goalkeeping: isGoalkeeper ? goalkeeperAverage : 8,
    reflexes: isGoalkeeper ? source.goalkeeperReflexes : 8,
  };
  return Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [
    key,
    adjusted(raw[key], delta, isGoalkeeper && ["goalkeeping", "reflexes"].includes(key) ? player.suggestedOverall : 50),
  ]));
}

function cleanWikiTitle(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\s*[（(][^）)]*(?:足球|球员|球員|运动员|運動員)[^）)]*[）)]\s*$/u, "")
    .trim();
}

function looksLikeNonPlayerPage(value) {
  return /(足球俱乐部|足球俱樂部|国家足球队|國家足球隊|赛季|賽季|世界杯|聯賽|联赛|名單|名单|年$|守门员$|守門員$)/u.test(value);
}

const payload = JSON.parse(await fs.readFile(INPUT, "utf8"));
const wiki = JSON.parse(await fs.readFile(WIKI, "utf8"));
const overrides = JSON.parse(await fs.readFile(OVERRIDES, "utf8"));
const userEdits = JSON.parse(await fs.readFile(USER_EDITS, "utf8"));
const retiredPayload = JSON.parse(await fs.readFile(RETIRED_PLAYERS, "utf8"));
const finalWorkbookEdits = JSON.parse(await fs.readFile(FINAL_WORKBOOK_EDITS, "utf8"));
let legacyMatches = [];
try {
  legacyMatches = JSON.parse(await fs.readFile(LEGACY_MATCHES, "utf8"));
} catch {
  legacyMatches = [];
}
const legacyById = new Map(legacyMatches.map((item) => [item.candidateId, item]));

const sourcePlayers = [
  ...payload.players.map((player) => {
    const edit = userEdits.players[player.id];
    return {
      ...player,
      ...(edit ?? {}),
      userWorkbookEdited:Boolean(edit),
      userWorkbookNameEdited:Boolean(edit && Object.hasOwn(edit, "displayNameZh")),
    };
  }),
  ...retiredPayload.players,
].map((player) => {
  const edit = finalWorkbookEdits.players[player.id];
  if (!edit) return player;
  return {
    ...player,
    ...edit,
    attributes: edit.attributes ? { ...player.attributes, ...edit.attributes } : player.attributes,
    userWorkbookEdited:true,
    userWorkbookNameEdited:Object.hasOwn(edit, "displayNameZh"),
  };
});

const localizedPlayers = sourcePlayers.map((player) => {
  const manual = overrides.players[player.sourceName];
  const wikiTitle = cleanWikiTitle(wiki[player.sourceName]?.zhTitle);
  const legacy = legacyById.get(player.id);
  let displayNameZh = player.displayNameZh || "";
  let localizationMethod = player.isLegend ? "existing-legend" : "untranslated";
  let localizationConfidence = player.isLegend ? "high" : "low";
  let localizationNote = "";

  if (player.userWorkbookNameEdited && player.displayNameZh) {
    displayNameZh = player.displayNameZh;
    localizationMethod = "user-workbook";
    localizationConfidence = "high";
    localizationNote = "用户已在审阅工作簿中校正";
  } else if (player.userWorkbookNameEdited) {
    displayNameZh = player.sourceName;
    localizationMethod = "user-workbook-unresolved";
    localizationConfidence = "low";
    localizationNote = "用户审阅后仍留空";
  } else if (player.isRetiredFamous) {
    displayNameZh = player.sourceName;
    localizationMethod = "retired-player-pending-user-review";
    localizationConfidence = "low";
    localizationNote = "新增退役名将，待用户填写中文名";
  } else if (manual) {
    displayNameZh = manual;
    localizationMethod = "manual-override";
    localizationConfidence = "high";
  } else if (!player.isLegend && wikiTitle && !looksLikeNonPlayerPage(wikiTitle)) {
    displayNameZh = wikiTitle;
    localizationMethod = "zhwiki-search";
    localizationConfidence = "medium";
    localizationNote = "中文维基搜索首项，建议人工确认常用译名";
  } else if (!player.isLegend && legacy?.confidence === "high") {
    displayNameZh = legacy.best.oldName;
    localizationMethod = "legacy-pinyin-match";
    localizationConfidence = "medium";
    localizationNote = "旧球员库高分且无冲突的拼音匹配，建议人工确认";
  } else if (!player.isLegend) {
    displayNameZh = player.sourceName;
    localizationNote = wikiTitle
      ? `中文维基候选疑似非球员页面：${wikiTitle}`
      : "未找到可靠中文译名";
  }

  const sourceNationality = player.nationality;
  const sourceClub = player.club;
  const nationality = overrides.nationalities[sourceNationality] ?? sourceNationality;
  const club = overrides.clubs[sourceClub] ?? sourceClub;
  return {
    ...player,
    sourceNationality,
    sourceClub,
    displayName: displayNameZh,
    displayNameZh,
    name: displayNameZh,
    nationality,
    club,
    referenceAttributes: player.eafcReferenceAttributes ?? player.attributes,
    attributes: coreAttributes(player),
    localizationMethod,
    localizationConfidence,
    localizationNote,
    reviewStatus: localizationConfidence === "high" ? "可用" : "待人工校正译名",
  };
});

const duplicateNames = new Map();
for (const player of localizedPlayers) {
  const sameName = duplicateNames.get(player.displayNameZh) ?? [];
  sameName.push(player.id);
  duplicateNames.set(player.displayNameZh, sameName);
}
for (const player of localizedPlayers) {
  const ids = duplicateNames.get(player.displayNameZh);
  if (ids.length > 1 && !player.isLegend && !player.userWorkbookNameEdited && !player.isRetiredFamous) {
    player.localizationConfidence = "low";
    player.localizationNote = `${player.localizationNote ? `${player.localizationNote}；` : ""}中文名与 ${ids.length - 1} 名球员重复`;
    player.reviewStatus = "待人工校正译名";
  }
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: payload.source,
  localization: {
    playerNames: "Chinese Wikipedia search plus manual overrides",
    nationalitiesAndClubs: "project-maintained Simplified Chinese dictionary",
  },
  coreAttributeKeys: CORE_ATTRIBUTE_KEYS,
  players: localizedPlayers,
};
const review = localizedPlayers
  .filter((player) => player.localizationConfidence !== "high")
  .map((player) => ({
    id: player.id,
    sourceName: player.sourceName,
    suggestedNameZh: player.displayNameZh,
    confidence: player.localizationConfidence,
    method: player.localizationMethod,
    note: player.localizationNote,
    nationality: player.nationality,
    club: player.club,
    pool: player.pool,
    role: player.role,
    secondaryRole: player.secondaryRole,
    referenceOverall: player.referenceOverall,
    suggestedOverall: player.suggestedOverall,
  }));

await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(OUTPUT_REVIEW, `${JSON.stringify(review, null, 2)}\n`, "utf8");
const moduleSource = `// Generated by devtool/apply-s4-player-localization.js.\n`
  + `export const S4_PLAYER_DATABASE = Object.freeze(${JSON.stringify(localizedPlayers, null, 2)});\n`;
await fs.writeFile(OUTPUT_MODULE, moduleSource, "utf8");

const counts = localizedPlayers.reduce((result, player) => {
  result[player.localizationConfidence] = (result[player.localizationConfidence] ?? 0) + 1;
  return result;
}, {});
console.log(JSON.stringify({
  total: localizedPlayers.length,
  localizationConfidence: counts,
  reviewRows: review.length,
  outputJson: OUTPUT_JSON,
  outputModule: OUTPUT_MODULE,
}, null, 2));
