import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WORKSPACE_ROOT = path.resolve(ROOT, "..", "..");
const INPUT = path.join(ROOT, "player_dlc.txt");
const FC26_SOURCE = path.join(ROOT, "data", "sources", "eafc26-player-database-20251124", "EAFC26-Men.csv");
const FIFA22_SOURCE = path.join(WORKSPACE_ROOT, ".tmp-fifa22-small", "players_fifa22.csv");
const FIFA21_SOURCE = path.join(WORKSPACE_ROOT, ".tmp-fifa21-small", "fifa21_male2.csv");
const S3_SOURCE = path.join(WORKSPACE_ROOT, "backups", "player-data", "S3-player-pool-700-20260725.json");
const OUTPUT_JSON = path.join(ROOT, "data", "player-dlc-ea-reference.json");
const OUTPUT_CSV = path.join(ROOT, "data", "player-dlc-ea-reference.csv");

const CORE_ATTRIBUTE_KEYS = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

const PLAYER_IDENTITIES = Object.freeze([
  ["拉莫斯", "Sergio Ramos", "塞尔希奥·拉莫斯"],
  ["贝尔", "Gareth Bale", "加雷斯·贝尔"],
  ["卡塞米罗", "Casemiro", "卡塞米罗"],
  ["皮克", "Gerard Piqué", "杰拉德·皮克"],
  ["阿尔维斯", "Dani Alves", "丹尼·阿尔维斯"],
  ["德米凯利斯", "Martín Demichelis", "马丁·德米凯利斯"],
  ["佩德罗", "Pedro", "佩德罗"],
  ["迭戈米利托", "Diego Milito", "迭戈·米利托"],
  ["内维尔", "Gary Neville", "加里·内维尔", true],
  ["莫拉塔", "Morata", "莫拉塔"],
  ["麦孔", "Maicon", "麦孔"],
  ["瓦拉内", "Raphaël Varane", "拉斐尔·瓦拉内"],
  ["布斯克茨", "Sergio Busquets", "布斯克茨"],
  ["摩根罗杰斯", "Morgan Rogers", "摩根·罗杰斯"],
  ["蒂亚戈席尔瓦", "Thiago Silva", "蒂亚戈·席尔瓦"],
  ["内马尔", "Neymar Jr", "内马尔"],
  ["儒利奥塞萨尔", "Júlio César", "儒利奥·塞萨尔"],
  ["斯坦科维奇", "Dejan Stanković", "德扬·斯坦科维奇"],
  ["本阿尔法", "Hatem Ben Arfa", "哈特姆·本阿尔法"],
  ["德罗索", "Daniele De Rossi", "丹尼尔·德罗西", true],
  ["托蒂", "Francesco Totti", "弗朗切斯科·托蒂"],
  ["马特拉齐", "Marco Materazzi", "马尔科·马特拉齐"],
  ["鲁伊科斯塔", "Rui Costa", "鲁伊·科斯塔"],
  ["科恩特朗", "Fábio Coentrão", "法比奥·科恩特朗"],
  ["卡瓦略", "Ricardo Carvalho", "卡瓦略"],
  ["比利亚", "David Villa", "大卫·比利亚"],
  ["华金", "Joaquín", "华金"],
  ["肯佩斯", "Mario Kempes", "肯佩斯"],
  ["克林斯曼", "Jürgen Klinsmann", "尤尔根·克林斯曼"],
  ["盖德穆勒", "Gerd Müller", "盖德·穆勒"],
  ["里杰卡尔德", "Frank Rijkaard", "里杰卡尔德"],
  ["古力特", "Ruud Gullit", "古利特"],
  ["阿扎尔", "Eden Hazard", "阿扎尔"],
  ["法尔考", "Radamel Falcao", "拉达梅尔·法尔考"],
  ["哈维阿隆索", "Xabi Alonso", "哈维·阿隆索"],
  ["托马斯穆勒", "Thomas Müller", "托马斯·穆勒"],
  ["博格巴", "Paul Pogba", "博格巴"],
  ["马斯切拉诺", "Javier Mascherano", "哈维尔·马斯切拉诺"],
  ["法布雷加斯", "Cesc Fàbregas", "法布雷加斯"],
  ["范佩西", "Robin van Persie", "罗宾·范佩西"],
  ["里瓦尔多", "Rivaldo", "里瓦尔多"],
  ["阿韦洛亚", "Álvaro Arbeloa", "阿尔瓦罗·阿韦洛亚"],
  ["拉基蒂奇", "Ivan Rakitić", "拉基蒂奇"],
  ["曼朱基奇", "Mario Mandžukić", "曼朱基奇"],
  ["古德温", "Craig Goodwin", "古德温"],
  ["佩佩", "Pepe", "佩佩"],
  ["拉姆斯代尔", "Aaron Ramsdale", "拉姆斯代尔"],
  ["卢西奥", "Lúcio", "卢西奥"],
  ["邓加", "Dunga", "邓加"],
  ["科瓦契奇", "Mateo Kovačić", "科瓦契奇"],
  ["博阿滕", "Jérôme Boateng", "博阿滕", true],
]);

const S3_NAME_OVERRIDES = Object.freeze({
  拉莫斯:"拉莫斯", 贝尔:"贝尔", 皮克:"皮克", 阿尔维斯:"阿尔维斯",
  德米凯利斯:"马丁·德米凯利斯", 莫拉塔:"莫拉塔", 麦孔:"麦孔",
  瓦拉内:"拉斐尔·瓦拉内", 布斯克茨:"布斯克茨", 蒂亚戈席尔瓦:"蒂亚戈·席尔瓦",
  内马尔:"内马尔", 儒利奥塞萨尔:"塞萨尔", 斯坦科维奇:"德扬·斯坦科维奇",
  托蒂:"弗朗切斯科·托蒂", 鲁伊科斯塔:"鲁伊·科斯塔", 卡瓦略:"卡瓦略",
  比利亚:"大卫·比利亚", 肯佩斯:"肯佩斯", 盖德穆勒:"盖德·穆勒",
  里杰卡尔德:"里杰卡尔德", 古力特:"古利特", 阿扎尔:"阿扎尔",
  哈维阿隆索:"哈维·阿隆索", 博格巴:"博格巴", 马斯切拉诺:"哈维尔·马斯切拉诺",
  法布雷加斯:"法布雷加斯", 里瓦尔多:"里瓦尔多", 佩佩:"佩佩",
  拉姆斯代尔:"拉姆斯代尔", 卢西奥:"卢西奥", 科瓦契奇:"科瓦契奇", 博阿滕:"博阿滕",
});

const FIFA21_ID_OVERRIDES = Object.freeze({
  迭戈米利托:"142708",
  内维尔:"244",
  本阿尔法:"161648",
  德罗索:"53302",
  马特拉齐:"177844",
  科恩特朗:"171688",
  法尔考:"167397",
  范佩西:"7826",
  曼朱基奇:"181783",
});

const POSITION_MAP = Object.freeze({
  GK:"GK", CB:"CB", LB:"LB", LWB:"LB", RB:"RB", RWB:"RB",
  CDM:"DM", CM:"AM", CAM:"AM", LM:"LM", RM:"RM", ST:"ST", CF:"ST", LW:"LW", RW:"RW",
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted && character === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift().map((header) => header.replace(/^\ufeff/, ""));
  return rows
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(...values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function clamp(value, minimum = 1, maximum = 99) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function parseHeight(value) {
  const match = String(value ?? "").match(/(\d{3})/);
  return match ? Number(match[1]) : null;
}

function parseFeetHeight(value) {
  const match = String(value ?? "").match(/(\d+)'(\d+)/);
  return match ? Math.round((Number(match[1]) * 12 + Number(match[2])) * 2.54) : null;
}

function mapRole(value) {
  return POSITION_MAP[String(value ?? "").trim()] ?? null;
}

function poolForRole(role) {
  if (role === "GK") return "GK";
  if (["CB", "LB", "RB"].includes(role)) return "DEF";
  if (["DM", "AM", "LM", "RM"].includes(role)) return "MID";
  if (["ST", "LW", "RW"].includes(role)) return "ATT";
  return null;
}

function coreFromRaw(source, role) {
  const isGoalkeeper = role === "GK";
  const isDefensiveRole = ["CB", "LB", "RB", "DM"].includes(role);
  const raw = {
    passing:average(source.passing, source.shortPassing, source.longPassing),
    firstTouch:source.ballControl,
    dribbling:source.dribbling,
    crossing:source.crossing,
    finishing:source.finishing,
    longShots:source.longShots,
    heading:source.headingAccuracy,
    setPieces:average(source.freeKickAccuracy, source.curve, source.penalties),
    tackling:average(source.standingTackle, source.slidingTackle),
    marking:source.defensiveAwareness,
    positioning:isGoalkeeper
      ? source.goalkeeperPositioning
      : isDefensiveRole ? source.defensiveAwareness : average(source.defensiveAwareness, source.interceptions),
    vision:source.vision,
    decisions:source.reactions,
    composure:source.composure,
    offBall:source.positioning,
    discipline:average(source.composure, source.reactions, Number.isFinite(source.aggression) ? 105 - source.aggression : null),
    pace:source.pace,
    acceleration:source.acceleration,
    strength:source.strength,
    stamina:source.stamina,
    agility:source.agility,
    jumping:source.jumping,
    workRate:source.stamina,
    aggression:source.aggression,
    goalkeeping:isGoalkeeper
      ? average(source.goalkeeperDiving, source.goalkeeperHandling, source.goalkeeperKicking, source.goalkeeperPositioning, source.goalkeeperReflexes)
      : 8,
    reflexes:isGoalkeeper ? source.goalkeeperReflexes : 8,
  };
  return Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [
    key,
    Number.isFinite(raw[key]) ? clamp(raw[key], key === "discipline" ? 35 : 1, key === "discipline" ? 95 : 99) : null,
  ]));
}

function rawFromFc26(row) {
  return {
    pace:number(row.PAC), acceleration:number(row.Acceleration), positioning:number(row.Positioning),
    finishing:number(row.Finishing), longShots:number(row["Long Shots"]), vision:number(row.Vision),
    crossing:number(row.Crossing), freeKickAccuracy:number(row["Free Kick Accuracy"]),
    shortPassing:number(row["Short Passing"]), longPassing:number(row["Long Passing"]),
    curve:number(row.Curve), dribbling:number(row.Dribbling), agility:number(row.Agility),
    reactions:number(row.Reactions), ballControl:number(row["Ball Control"]), composure:number(row.Composure),
    interceptions:number(row.Interceptions), headingAccuracy:number(row["Heading Accuracy"]),
    defensiveAwareness:number(row["Def Awareness"]), standingTackle:number(row["Standing Tackle"]),
    slidingTackle:number(row["Sliding Tackle"]), jumping:number(row.Jumping), stamina:number(row.Stamina),
    strength:number(row.Strength), aggression:number(row.Aggression), penalties:number(row.Penalties),
    goalkeeperDiving:number(row["GK Diving"]), goalkeeperHandling:number(row["GK Handling"]),
    goalkeeperKicking:number(row["GK Kicking"]), goalkeeperPositioning:number(row["GK Positioning"]),
    goalkeeperReflexes:number(row["GK Reflexes"]), passing:number(row.PAS),
  };
}

function rawFromFifa22(row) {
  return {
    pace:number(row.PaceTotal), acceleration:number(row.Acceleration), positioning:number(row.Positioning),
    finishing:number(row.Finishing), longShots:number(row.LongShots), vision:number(row.Vision),
    crossing:number(row.Crossing), freeKickAccuracy:number(row.FKAccuracy),
    shortPassing:number(row.ShortPassing), longPassing:number(row.LongPassing),
    curve:number(row.Curve), dribbling:number(row.Dribbling), agility:number(row.Agility),
    reactions:number(row.Reactions), ballControl:number(row.BallControl), composure:number(row.Composure),
    interceptions:number(row.Interceptions), headingAccuracy:number(row.HeadingAccuracy),
    defensiveAwareness:number(row.Marking), standingTackle:number(row.StandingTackle),
    slidingTackle:number(row.SlidingTackle), jumping:number(row.Jumping), stamina:number(row.Stamina),
    strength:number(row.Strength), aggression:number(row.Aggression), penalties:number(row.Penalties),
    goalkeeperDiving:number(row.GKDiving), goalkeeperHandling:number(row.GKHandling),
    goalkeeperKicking:number(row.GKKicking), goalkeeperPositioning:number(row.GKPositioning),
    goalkeeperReflexes:number(row.GKReflexes), passing:number(row.PassingTotal),
  };
}

function rawFromFifa21(row) {
  return {
    pace:number(row.PAC), acceleration:number(row.Acceleration), positioning:number(row.Positioning),
    finishing:number(row.Finishing), longShots:number(row["Long Shots"]), vision:number(row.Vision),
    crossing:number(row.Crossing), freeKickAccuracy:number(row["FK Accuracy"]),
    shortPassing:number(row["Short Passing"]), longPassing:number(row["Long Passing"]),
    curve:number(row.Curve), dribbling:number(row.Dribbling), agility:number(row.Agility),
    reactions:number(row.Reactions), ballControl:number(row["Ball Control"]), composure:number(row.Composure),
    interceptions:number(row.Interceptions), headingAccuracy:number(row["Heading Accuracy"]),
    defensiveAwareness:number(row.Marking), standingTackle:number(row["Standing Tackle"]),
    slidingTackle:number(row["Sliding Tackle"]), jumping:number(row.Jumping), stamina:number(row.Stamina),
    strength:number(row.Strength), aggression:number(row.Aggression), penalties:number(row.Penalties),
    goalkeeperDiving:number(row["GK Diving"]), goalkeeperHandling:number(row["GK Handling"]),
    goalkeeperKicking:number(row["GK Kicking"]), goalkeeperPositioning:number(row["GK Positioning"]),
    goalkeeperReflexes:number(row["GK Reflexes"]), passing:number(row.PAS),
  };
}

function parsePositions(value) {
  return String(value ?? "").replace(/[\[\]'"]/g, "").split(",").map((position) => position.trim()).filter(Boolean);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const requestedNames = (await fs.readFile(INPUT, "utf8")).split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
const identityByInput = new Map(PLAYER_IDENTITIES.map(([inputName, englishName, chineseName, ambiguous = false]) => [
  inputName,
  { inputName, englishName, chineseName, ambiguous },
]));
const missingIdentities = requestedNames.filter((name) => !identityByInput.has(name));
if (missingIdentities.length) throw new Error(`missing player identity mappings: ${missingIdentities.join(", ")}`);

const fc26Rows = parseCsv(await fs.readFile(FC26_SOURCE, "utf8"));
const fifa22Rows = parseCsv(await fs.readFile(FIFA22_SOURCE, "utf8"));
const fifa21Rows = parseCsv(await fs.readFile(FIFA21_SOURCE, "utf8"));
const s3Payload = JSON.parse(await fs.readFile(S3_SOURCE, "utf8"));
const fc26ByName = new Map(fc26Rows.map((row) => [normalizeName(row.Name), row]));
const fifa22ByName = new Map(fifa22Rows.map((row) => [normalizeName(row.FullName), row]));
const fifa21ById = new Map(fifa21Rows.map((row) => [String(row.ID), row]));
const s3ByName = new Map(s3Payload.players.map((player) => [player.name, player]));

const players = requestedNames.map((inputName, order) => {
  const identity = identityByInput.get(inputName);
  const fc26 = fc26ByName.get(normalizeName(identity.englishName));
  const fifa22 = fifa22ByName.get(normalizeName(identity.englishName));
  const fifa21 = fifa21ById.get(FIFA21_ID_OVERRIDES[inputName]);
  const s3 = s3ByName.get(S3_NAME_OVERRIDES[inputName]);
  const sourceRow = fc26 ?? fifa22 ?? fifa21;
  const sourceVersion = fc26
    ? "EA SPORTS FC 26"
    : fifa22 ? "FIFA 22" : fifa21 ? `FIFA historical snapshot (${fifa21.Contract?.match(/\d{4}/)?.[0] ?? "legacy"})` : s3 ? "YellowDogs S3 EA-derived archive" : "unresolved";
  const role = sourceRow
    ? mapRole(fc26 ? sourceRow.Position : fifa22 ? sourceRow.BestPosition : sourceRow.BP)
    : s3?.role ?? null;
  const sourceAlternativePositions = sourceRow
    ? parsePositions(fc26 ? sourceRow["Alternative positions"] : fifa22 ? sourceRow.Positions : sourceRow.Position)
    : s3?.secondaryRole ? [s3.secondaryRole] : [];
  const rawAttributes = fc26
    ? rawFromFc26(fc26)
    : fifa22 ? rawFromFifa22(fifa22) : fifa21 ? rawFromFifa21(fifa21) : null;
  const attributes = rawAttributes
    ? coreFromRaw(rawAttributes, role)
    : s3 ? Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, number(s3.attributes?.[key])])) : Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, null]));
  const resolvedAttributeCount = CORE_ATTRIBUTE_KEYS.filter((key) => Number.isFinite(attributes[key])).length;
  const needsIdentityReview = identity.ambiguous;
  return {
    order:order + 1,
    id:`dlc-${normalizeName(identity.englishName) || order + 1}`,
    inputName,
    displayNameZh:identity.chineseName,
    sourceName:identity.englishName,
    sourceId:fc26?.ID ?? fifa22?.ID ?? null,
    sourceVersion,
    sourceType:fc26
      ? "EAFC26 official ratings snapshot"
      : fifa22 ? "FIFA 22 historical database archive" : fifa21 ? "FIFA historical database archive" : s3 ? "project S3 EA-derived profile" : "missing",
    sourceUrl:fc26?.url ?? fifa22?.PhotoUrl ?? fifa21?.["Player Photo"] ?? "",
    sourceDatasetUrl:fc26
      ? "https://www.ea.com/games/ea-sports-fc/ratings"
      : fifa22 ? "https://www.kaggle.com/datasets/cashncarry/fifa-22-complete-player-dataset"
        : fifa21 ? "https://www.kaggle.com/datasets/ekrembayar/fifa-21-complete-player-dataset" : "",
    sourceOverall:number(fc26?.OVR ?? fifa22?.Overall ?? fifa21?.OVA ?? s3?.overall),
    proposedOverall:number(fc26?.OVR ?? fifa22?.Overall ?? fifa21?.OVA ?? s3?.overall),
    proposedGrade:"",
    pool:poolForRole(role) ?? s3?.pool ?? "",
    role:role ?? "",
    secondaryRole:sourceAlternativePositions.map(mapRole).find((candidate) => candidate && candidate !== role) ?? s3?.secondaryRole ?? "",
    sourceMainPosition:fc26?.Position ?? fifa22?.BestPosition ?? fifa21?.BP ?? s3?.role ?? "",
    sourceAlternativePositions,
    nationality:fc26?.Nation ?? fifa22?.Nationality ?? fifa21?.Nationality ?? s3?.nationality ?? "",
    club:fc26?.Team ?? fifa22?.Club ?? fifa21?.Club ?? s3?.club ?? "",
    league:fc26?.League ?? "",
    heightCm:fc26 ? parseHeight(fc26.Height) : fifa22 ? number(fifa22.Height) : fifa21 ? parseFeetHeight(fifa21.Height) : number(s3?.heightCm),
    age:number(fc26?.Age ?? fifa22?.Age ?? fifa21?.Age),
    preferredFoot:String(fc26?.["Preferred foot"] ?? fifa22?.PreferredFoot ?? fifa21?.foot ?? s3?.preferredFoot ?? "").toLowerCase(),
    weakFoot:number(fc26?.["Weak foot"] ?? fifa22?.WeakFoot ?? String(fifa21?.["W/F"] ?? "").match(/\d+/)?.[0]),
    skillMoves:number(fc26?.["Skill moves"] ?? fifa22?.SkillMoves ?? String(fifa21?.SM ?? "").match(/\d+/)?.[0]),
    attributes,
    rawReferenceAttributes:rawAttributes,
    resolvedAttributeCount,
    identityReview:needsIdentityReview ? "需确认" : "已映射",
    dataReview:resolvedAttributeCount === CORE_ATTRIBUTE_KEYS.length ? "26项已齐" : "缺少可靠历史数据",
    note:inputName === "法尔考"
      ? "用户已确认：哥伦比亚前锋 Radamel Falcao"
      : inputName === "德罗索"
        ? "按常见笔误映射为丹尼尔·德罗西，请确认"
        : inputName === "内维尔"
          ? "暂按加里·内维尔处理，请确认"
          : inputName === "博阿滕"
            ? "暂按热罗姆·博阿滕处理，请确认"
            : "",
  };
});

const headers = [
  "序号", "名单名称", "中文全名", "英文名", "身份确认", "数据状态", "数据版本", "来源类型",
  "来源OVR", "调整后OVR", "评级", "位置池", "主位置", "副位置", "原始位置", "国籍", "俱乐部", "联赛",
  "身高cm", "年龄", "惯用脚", "逆足", "花式",
  ...CORE_ATTRIBUTE_KEYS,
  "来源ID", "来源URL", "数据集URL", "备注",
];
const rows = players.map((player) => [
  player.order, player.inputName, player.displayNameZh, player.sourceName, player.identityReview,
  player.dataReview, player.sourceVersion, player.sourceType, player.sourceOverall, player.proposedOverall,
  player.proposedGrade, player.pool, player.role, player.secondaryRole, player.sourceMainPosition,
  player.nationality, player.club, player.league, player.heightCm, player.age, player.preferredFoot,
  player.weakFoot, player.skillMoves, ...CORE_ATTRIBUTE_KEYS.map((key) => player.attributes[key]),
  player.sourceId, player.sourceUrl, player.sourceDatasetUrl, player.note,
]);

const payload = {
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  input:"player_dlc.txt",
  coreAttributeKeys:CORE_ATTRIBUTE_KEYS,
  sourcePriority:[
    "EAFC26 official ratings snapshot",
    "FIFA 22 historical database archive",
    "FIFA historical database archive",
    "project S3 EA-derived profile",
  ],
  warning:"External reference ratings and attributes must not overwrite game balance without review.",
  summary:{
    requested:players.length,
    complete:players.filter((player) => player.resolvedAttributeCount === CORE_ATTRIBUTE_KEYS.length).length,
    incomplete:players.filter((player) => player.resolvedAttributeCount !== CORE_ATTRIBUTE_KEYS.length).length,
    identityReview:players.filter((player) => player.identityReview !== "已映射").length,
    bySource:Object.fromEntries([...new Set(players.map((player) => player.sourceType))].map((sourceType) => [
      sourceType,
      players.filter((player) => player.sourceType === sourceType).length,
    ])),
  },
  players,
};

await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await fs.writeFile(
  OUTPUT_CSV,
  `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`,
  "utf8",
);

console.log(JSON.stringify({
  outputJson:OUTPUT_JSON,
  outputCsv:OUTPUT_CSV,
  ...payload.summary,
  incompletePlayers:players.filter((player) => player.resolvedAttributeCount !== CORE_ATTRIBUTE_KEYS.length).map((player) => player.inputName),
}, null, 2));
