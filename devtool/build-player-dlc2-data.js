import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_PLAYERS, isXPlayer } from "../versus/player-pool.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WORKSPACE_ROOT = path.resolve(ROOT, "..", "..");
const INPUT = path.join(ROOT, "player_dlc2.txt");
const S3_SOURCE = path.join(WORKSPACE_ROOT, "backups", "player-data", "S3-player-pool-700-20260725.json");
const FIFA22_SOURCE = path.join(ROOT, "data", "sources", "kaggle-history-dlc2", "fifa22", "players_fifa22.csv");
const FIFA21_SOURCE = path.join(ROOT, "data", "sources", "kaggle-history-dlc2", "fifa11-21", "fifa21_male2.csv");
const FUT_HISTORY_DIR = path.join(ROOT, "data", "sources", "kaggle-history-dlc2", "fut10-20");
const CACHE_DIR = path.join(ROOT, "data", "sources", "ea-official-dlc2-20260803");
const OUTPUT_JSON = path.join(ROOT, "data", "player-dlc2-ea-reference.json");
const OUTPUT_CSV = path.join(ROOT, "data", "player-dlc2-ea-reference.csv");
const EA_API = "https://drop-api.ea.com/rating/ea-sports-fc";
const EA_RATINGS_URL = "https://www.ea.com/games/ea-sports-fc/ratings";

const OFFICIAL_NATIONALITY_BY_GROUP = Object.freeze({
  "阿根廷":"Argentina",
  "荷兰":"Holland",
  "葡萄牙":"Portugal",
  "意大利":"Italy",
});

const HISTORICAL_NAME_ALIASES = Object.freeze({
  "阿尔扬·罗本":["罗本"],
  "埃德加·戴维斯":["戴维斯"],
  "佩佩（中后卫）":["佩佩"],
  "鲁伊·帕特里西奥":["帕特里西奥"],
  "曼努埃尔·本托":["本托"],
  "迪诺·佐夫":["佐夫"],
  "贾琴托·法切蒂":["贾钦托·法切蒂"],
});

const FIFA22_ID_OVERRIDES = Object.freeze({
  "里卡多·夸雷斯马":"20775",
});

const FIFA21_ID_OVERRIDES = Object.freeze({
  "埃尔南·克雷斯波":"7512",
  "卡洛斯·特维斯":"143001",
  "加布里埃尔·海因策":"8222",
  "韦斯利·斯内德":"139869",
  "鲁德·范尼斯特鲁伊":"10264",
  "帕特里克·克鲁伊维特":"5680",
  "拉斐尔·范德法特":"45574",
  "迪尔克·库伊特":"15723",
  "费尔南多·库托":"1186",
});

const FUT_HISTORY_OVERRIDES = Object.freeze({
  "乔瓦尼·范布隆克霍斯特":{ file:"Fifa 10 Fut Players.csv", name:"Giovanni van Bronckhorst", rating:75 },
  "马克·范博梅尔":{ file:"Fifa 11 Fut Players.csv", name:"Mark van Bommel", rating:82 },
  "马克·奥维马斯":{ file:"Fifa 20 Fut Players.csv", name:"Marc Overmars", rating:90 },
  "保罗·富特雷":{ file:"Fifa 17 Fut Players.csv", name:"Paulo Futre", rating:87 },
  "保莱塔":{ file:"Fifa 17 Fut Players.csv", name:"Pauleta", rating:87 },
});

const CORE_ATTRIBUTE_KEYS = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

const IDENTITIES = Object.freeze({
  "阿尔弗雷多·迪斯蒂法诺":["Alfredo Di Stéfano", "阿尔弗雷多·迪斯蒂法诺"],
  "丹尼尔·帕萨雷拉":["Daniel Passarella", "丹尼尔·帕萨雷拉"],
  "费尔南多·雷东多":["Fernando Redondo", "费尔南多·雷东多"],
  "奥马尔·西沃里":["Omar Sívori", "奥马尔·西沃里"],
  "何塞·曼努埃尔·莫雷诺":["José Manuel Moreno", "何塞·曼努埃尔·莫雷诺"],
  "阿道夫·佩德内拉":["Adolfo Pedernera", "阿道夫·佩德内拉"],
  "乌巴尔多·菲洛尔":["Ubaldo Fillol", "乌巴尔多·菲洛尔"],
  "奥斯卡·鲁杰里":["Oscar Ruggeri", "奥斯卡·鲁杰里"],
  "里卡多·博奇尼":["Ricardo Bochini", "里卡多·博奇尼"],
  "埃尔南·克雷斯波":["Hernán Crespo", "埃尔南·克雷斯波"],
  "胡安·塞巴斯蒂安·贝隆":["Juan Sebastián Verón", "胡安·塞巴斯蒂安·贝隆"],
  "奥斯瓦尔多·阿尔迪列斯":["Osvaldo Ardiles", "奥斯瓦尔多·阿尔迪列斯"],
  "克劳迪奥·卡尼吉亚":["Claudio Caniggia", "克劳迪奥·卡尼吉亚"],
  "豪尔赫·布鲁查加":["Jorge Burruchaga", "豪尔赫·布鲁查加"],
  "迭戈·西蒙尼":["Diego Simeone", "迭戈·西蒙尼"],
  "贡萨洛·伊瓜因":["Gonzalo Higuaín", "贡萨洛·伊瓜因"],
  "卡洛斯·特维斯":["Carlos Tévez", "卡洛斯·特维斯"],
  "莱安德罗·帕雷德斯":["Leandro Paredes", "莱安德罗·帕雷德斯"],
  "尼古拉斯·塔利亚菲科":["Nicolás Tagliafico", "尼古拉斯·塔利亚菲科"],
  "贡萨洛·蒙铁尔":["Gonzalo Montiel", "贡萨洛·蒙铁尔"],
  "加布里埃尔·海因策":["Gabriel Heinze", "加布里埃尔·海因策"],
  "阿尔扬·罗本":["Arjen Robben", "阿尔扬·罗本"],
  "罗纳德·科曼":["Ronald Koeman", "罗纳德·科曼"],
  "约翰·内斯肯斯":["Johan Neeskens", "约翰·内斯肯斯"],
  "鲁德·克罗尔":["Ruud Krol", "鲁德·克罗尔"],
  "韦斯利·斯内德":["Wesley Sneijder", "韦斯利·斯内德"],
  "鲁德·范尼斯特鲁伊":["Ruud van Nistelrooy", "鲁德·范尼斯特鲁伊"],
  "威廉·范哈内亨":["Wim van Hanegem", "威廉·范哈内亨"],
  "埃德加·戴维斯":["Edgar Davids", "埃德加·戴维斯"],
  "雅普·斯塔姆":["Jaap Stam", "雅普·斯塔姆"],
  "帕特里克·克鲁伊维特":["Patrick Kluivert", "帕特里克·克鲁伊维特"],
  "罗布·伦森布林克":["Rob Rensenbrink", "罗布·伦森布林克"],
  "弗兰克·德波尔":["Frank de Boer", "弗兰克·德波尔"],
  "孟菲斯·德佩":["Memphis Depay", "孟菲斯·德佩"],
  "拉斐尔·范德法特":["Rafael van der Vaart", "拉斐尔·范德法特"],
  "马克·奥维马斯":["Marc Overmars", "马克·奥维马斯"],
  "乔瓦尼·范布隆克霍斯特":["Giovanni van Bronckhorst", "乔瓦尼·范布隆克霍斯特"],
  "菲利普·科库":["Phillip Cocu", "菲利普·科库"],
  "迪尔克·库伊特":["Dirk Kuyt", "迪尔克·库伊特"],
  "汉斯·范布鲁克伦":["Hans van Breukelen", "汉斯·范布鲁克伦"],
  "马克·范博梅尔":["Mark van Bommel", "马克·范博梅尔"],
  "约翰尼·雷普":["Johnny Rep", "约翰尼·雷普"],
  "若尔日尼奥·维纳尔杜姆":["Georginio Wijnaldum", "若尔日尼奥·维纳尔杜姆"],
  "佩佩（中后卫）":["Pepe", "佩佩"],
  "德科":["Deco", "德科"],
  "马里奥·科卢纳":["Mário Coluna", "马里奥·科卢纳"],
  "保罗·富特雷":["Paulo Futre", "保罗·富特雷"],
  "费尔南多·佩罗特奥":["Fernando Peyroteo", "费尔南多·佩罗特奥"],
  "若泽·阿瓜斯":["José Águas", "若泽·阿瓜斯"],
  "费尔南多·戈麦斯":["Fernando Gomes", "费尔南多·戈麦斯"],
  "鲁伊·帕特里西奥":["Rui Patrício", "鲁伊·帕特里西奥"],
  "若昂·穆蒂尼奥":["João Moutinho", "若昂·穆蒂尼奥"],
  "温贝托·科埃略":["Humberto Coelho", "温贝托·科埃略"],
  "查拉纳":["Chalana", "查拉纳"],
  "保莱塔":["Pauleta", "保莱塔"],
  "曼努埃尔·本托":["Manuel Bento", "曼努埃尔·本托"],
  "若昂·维埃拉·平托":["João Vieira Pinto", "若昂·维埃拉·平托"],
  "费尔南多·库托":["Fernando Couto", "费尔南多·库托"],
  "维托尔·拜亚":["Vítor Baía", "维托尔·拜亚"],
  "纳尼":["Nani", "纳尼"],
  "保罗·索萨":["Paulo Sousa", "保罗·索萨"],
  "里卡多·夸雷斯马":["Ricardo Quaresma", "里卡多·夸雷斯马"],
  "朱塞佩·梅阿查":["Giuseppe Meazza", "朱塞佩·梅阿查"],
  "罗伯托·巴乔":["Roberto Baggio", "罗伯托·巴乔"],
  "加埃塔诺·西雷阿":["Gaetano Scirea", "加埃塔诺·西雷阿"],
  "迪诺·佐夫":["Dino Zoff", "迪诺·佐夫"],
  "詹尼·里维拉":["Gianni Rivera", "詹尼·里维拉"],
  "保罗·罗西":["Paolo Rossi", "保罗·罗西"],
  "贾琴托·法切蒂":["Giacinto Facchetti", "贾琴托·法切蒂"],
  "路易吉·里瓦":["Luigi Riva", "路易吉·里瓦"],
  "亚历山德罗·德尔·皮耶罗":["Alessandro Del Piero", "亚历山德罗·德尔·皮耶罗"],
  "库库雷利亚":["Marc Cucurella", "马克·库库雷利亚"],
  "纳瓦斯（门将）":["Keylor Navas", "凯洛尔·纳瓦斯"],
});

const POSITION_MAP = Object.freeze({
  GK:"GK", CB:"CB", LB:"LB", LWB:"LB", RB:"RB", RWB:"RB",
  CDM:"DM", CM:"AM", CAM:"AM", LM:"LM", RM:"RM", ST:"ST", CF:"ST", LW:"LW", RW:"RW",
});

const sourceLines = (await fs.readFile(INPUT, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
let group = "";
const requested = sourceLines.flatMap((line) => {
  if (line.endsWith("：")) {
    group = line.slice(0, -1);
    return [];
  }
  const identity = IDENTITIES[line];
  if (!identity) throw new Error(`missing DLC2 identity mapping: ${line}`);
  return [{ inputName:line, group, englishName:identity[0], chineseName:identity[1] }];
});
if (requested.length !== 73) throw new Error(`expected 73 DLC2 players, received ${requested.length}`);

const s3Payload = JSON.parse(await fs.readFile(S3_SOURCE, "utf8"));
const s3ByName = new Map(s3Payload.players.map((player) => [normalizeChinese(player.name), player]));
const fifa22Rows = parseCsv(await fs.readFile(FIFA22_SOURCE, "utf8"));
const fifa21Rows = parseCsv(await fs.readFile(FIFA21_SOURCE, "utf8"));
const fifa22ByName = new Map(fifa22Rows.map((row) => [normalizeName(row.FullName), row]));
const fifa22ById = new Map(fifa22Rows.map((row) => [String(row.ID), row]));
const fifa21ById = new Map(fifa21Rows.map((row) => [String(row.ID), row]));
const futRowsByFile = new Map();
for (const file of new Set(Object.values(FUT_HISTORY_OVERRIDES).map((entry) => entry.file))) {
  futRowsByFile.set(file, parseCsv(await fs.readFile(path.join(FUT_HISTORY_DIR, file), "utf8")));
}
const currentPlayers = REAL_PLAYERS.filter((player) => !isXPlayer(player));
const currentByEnglish = new Map(currentPlayers.filter((player) => player.sourceName).map((player) => [normalizeName(player.sourceName), player]));
const currentByChinese = new Map(currentPlayers.map((player) => [normalizeChinese(player.name), player]));

await fs.mkdir(CACHE_DIR, { recursive:true });
const officialResults = new Map();
await mapConcurrent(requested, 6, async (identity, index) => {
  const cachePath = path.join(CACHE_DIR, `${String(index + 1).padStart(2, "0")}-${slug(identity.englishName)}.json`);
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const url = `${EA_API}?locale=en&limit=20&search=${encodeURIComponent(identity.englishName)}`;
    const response = await fetch(url, { headers:{ Accept:"application/json", "User-Agent":"Mozilla/5.0" } });
    if (!response.ok) throw new Error(`EA API ${response.status}: ${identity.englishName}`);
    payload = await response.json();
    await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  const expectedNationality = OFFICIAL_NATIONALITY_BY_GROUP[identity.group];
  const exact = (payload.items ?? []).find((item) =>
    officialNames(item).some((name) => normalizeName(name) === normalizeName(identity.englishName))
    && (!expectedNationality || item.nationality?.label === expectedNationality)
  );
  officialResults.set(identity.inputName, { exact, totalItems:Number(payload.totalItems ?? 0), candidates:(payload.items ?? []).map(displayOfficialName) });
});

const players = requested.map((identity, index) => {
  const officialSearch = officialResults.get(identity.inputName);
  const official = officialSearch?.exact ?? null;
  const duplicate = currentByEnglish.get(normalizeName(identity.englishName)) ?? currentByChinese.get(normalizeChinese(identity.chineseName)) ?? null;
  const historicalNames = [identity.chineseName, identity.inputName, ...(HISTORICAL_NAME_ALIASES[identity.inputName] ?? [])];
  const s3 = historicalNames.map((name) => s3ByName.get(normalizeChinese(name))).find(Boolean) ?? null;
  const fifa22 = fifa22ById.get(FIFA22_ID_OVERRIDES[identity.inputName]) ?? fifa22ByName.get(normalizeName(identity.englishName)) ?? null;
  const fifa21 = fifa21ById.get(FIFA21_ID_OVERRIDES[identity.inputName]) ?? null;
  const futOverride = FUT_HISTORY_OVERRIDES[identity.inputName];
  const fut = futOverride
    ? (futRowsByFile.get(futOverride.file) ?? []).find((row) => normalizeName(row.Name) === normalizeName(futOverride.name) && number(row.Ratings) === futOverride.rating) ?? null
    : null;
  const source = official ? fromOfficial(official)
    : duplicate ? fromCurrent(duplicate)
      : s3 ? fromS3(s3)
        : fifa22 ? fromFifa22(fifa22)
          : fifa21 ? fromFifa21(fifa21)
            : fut ? fromFutHistory(fut, futOverride.file) : unresolvedSource();
  const role = source.role ?? "";
  const resolvedAttributeCount = CORE_ATTRIBUTE_KEYS.filter((key) => Number.isFinite(source.attributes[key])).length;
  return {
    order:index + 1,
    group:identity.group,
    inputName:identity.inputName,
    displayNameZh:identity.chineseName,
    sourceName:identity.englishName,
    identityReview:official || duplicate || s3 || fifa22 || fifa21 || fut ? "已映射" : "需确认",
    dataReview:resolvedAttributeCount === CORE_ATTRIBUTE_KEYS.length ? "26项已齐" : resolvedAttributeCount ? `部分参考（${resolvedAttributeCount}/26）` : "缺少可靠细项",
    officialMatch:official ? "精确命中" : officialSearch?.totalItems ? "仅相似结果" : "无结果",
    officialCandidates:official ? displayOfficialName(official) : (officialSearch?.candidates ?? []).slice(0, 5).join(" | "),
    existingPlayerId:duplicate?.id ?? "",
    existingPlayerName:duplicate?.name ?? "",
    duplicateStatus:duplicate ? "当前球员池已存在" : "可新增候选",
    sourceVersion:source.sourceVersion,
    sourceType:source.sourceType,
    sourceOverall:source.overall,
    proposedOverall:source.overall,
    proposedGrade:"",
    pool:poolForRole(role),
    role,
    secondaryRole:source.secondaryRole ?? "",
    sourceMainPosition:source.sourceMainPosition ?? "",
    sourceAlternativePositions:source.sourceAlternativePositions ?? [],
    nationality:source.nationality ?? identity.group,
    club:source.club ?? (source.sourceType.includes("historical") ? "国家队传奇" : ""),
    league:source.league ?? "",
    heightCm:source.heightCm,
    age:source.age,
    preferredFoot:source.preferredFoot ?? "",
    weakFoot:source.weakFoot,
    skillMoves:source.skillMoves,
    attributes:source.attributes,
    rawReferenceAttributes:source.rawReferenceAttributes,
    resolvedAttributeCount,
    sourceId:source.sourceId ?? "",
    sourceUrl:source.sourceUrl ?? "",
    sourceDatasetUrl:source.sourceDatasetUrl ?? "",
    note:duplicate
      ? `当前 S4 已存在 ${duplicate.name}（${duplicate.id}，${duplicate.grade}级），请确认是否跳过或作为新版本卡处理`
      : official ? "EA 官方 FC Ratings 实时接口精确命中"
        : s3 ? "EA 当前接口未收录；使用项目 S3 的 EA 派生历史档案"
          : fifa22 ? "使用 Kaggle FIFA 22 完整球员数据库的历史快照"
            : fifa21 ? "使用 Kaggle FIFA 历史完整球员数据库中的最后可用赛季"
              : fut ? "使用 Kaggle FUT 历史卡面数据；仅填写可直接对应的传球、盘带、速度，其他细项不反推"
                : "EA 当前接口及已下载的历史档案均未找到可靠细项，需人工补全",
  };
});

const headers = [
  "序号", "分组", "名单名称", "中文全名", "英文名", "身份确认", "数据状态", "EA官方匹配", "官方候选",
  "重复状态", "现有球员ID", "现有球员名", "数据版本", "来源类型", "来源OVR", "调整后OVR", "评级",
  "位置池", "主位置", "副位置", "原始位置", "国籍", "俱乐部", "联赛", "身高cm", "年龄", "惯用脚", "逆足", "花式",
  ...CORE_ATTRIBUTE_KEYS,
  "来源ID", "来源URL", "数据集URL", "备注",
];
const rows = players.map((player) => [
  player.order, player.group, player.inputName, player.displayNameZh, player.sourceName, player.identityReview, player.dataReview,
  player.officialMatch, player.officialCandidates, player.duplicateStatus, player.existingPlayerId, player.existingPlayerName,
  player.sourceVersion, player.sourceType, player.sourceOverall, player.proposedOverall, player.proposedGrade,
  player.pool, player.role, player.secondaryRole, player.sourceMainPosition, player.nationality, player.club, player.league,
  player.heightCm, player.age, player.preferredFoot, player.weakFoot, player.skillMoves,
  ...CORE_ATTRIBUTE_KEYS.map((key) => player.attributes[key]),
  player.sourceId, player.sourceUrl, player.sourceDatasetUrl, player.note,
]);

const payload = {
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  input:"player_dlc2.txt",
  officialApi:EA_API,
  coreAttributeKeys:CORE_ATTRIBUTE_KEYS,
  warning:"EA current ratings are references only. Historical fallbacks and duplicates require user review before import.",
  summary:{
    requested:players.length,
    officialExact:players.filter((player) => player.officialMatch === "精确命中").length,
    historicalFallback:players.filter((player) => player.sourceType.includes("historical")).length,
    currentPoolFallback:players.filter((player) => player.sourceType === "current S4 player pool").length,
    complete:players.filter((player) => player.resolvedAttributeCount === CORE_ATTRIBUTE_KEYS.length).length,
    incomplete:players.filter((player) => player.resolvedAttributeCount !== CORE_ATTRIBUTE_KEYS.length).length,
    duplicates:players.filter((player) => player.duplicateStatus === "当前球员池已存在").length,
    byGroup:Object.fromEntries([...new Set(players.map((player) => player.group))].map((name) => [name, players.filter((player) => player.group === name).length])),
    bySource:Object.fromEntries([...new Set(players.map((player) => player.sourceType))].map((name) => [name, players.filter((player) => player.sourceType === name).length])),
  },
  players,
};

await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await fs.writeFile(OUTPUT_CSV, `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, "utf8");
console.log(JSON.stringify({
  outputJson:OUTPUT_JSON,
  outputCsv:OUTPUT_CSV,
  ...payload.summary,
  incompletePlayers:players.filter((player) => player.resolvedAttributeCount !== CORE_ATTRIBUTE_KEYS.length).map((player) => player.inputName),
  duplicates:players.filter((player) => player.duplicateStatus === "当前球员池已存在").map((player) => `${player.inputName}:${player.existingPlayerId}`),
}, null, 2));

function fromOfficial(player) {
  const role = mapRole(player.position?.shortLabel);
  const raw = rawFromOfficial(player.stats ?? {});
  return {
    sourceVersion:"EA SPORTS FC official live ratings",
    sourceType:"EA official Drop API",
    overall:number(player.overallRating),
    role,
    secondaryRole:(player.alternatePositions ?? []).map((position) => mapRole(position.shortLabel)).find((candidate) => candidate && candidate !== role) ?? "",
    sourceMainPosition:player.position?.shortLabel ?? "",
    sourceAlternativePositions:(player.alternatePositions ?? []).map((position) => position.shortLabel),
    nationality:player.nationality?.label ?? "",
    club:player.team?.label ?? "",
    league:player.leagueName ?? "",
    heightCm:number(player.height),
    age:ageFromBirthdate(player.birthdate),
    preferredFoot:Number(player.preferredFoot) === 2 ? "left" : "right",
    weakFoot:number(player.weakFootAbility),
    skillMoves:number(player.skillMoves),
    attributes:coreFromRaw(raw, role),
    rawReferenceAttributes:raw,
    sourceId:player.id,
    sourceUrl:`${EA_RATINGS_URL}/player-ratings/${slug(displayOfficialName(player))}/${player.id}`,
    sourceDatasetUrl:EA_RATINGS_URL,
  };
}

function fromCurrent(player) {
  return {
    sourceVersion:"Current YellowDogs League S4",
    sourceType:"current S4 player pool",
    overall:number(player.overall),
    role:player.role,
    secondaryRole:player.secondaryRole ?? "",
    sourceMainPosition:player.role,
    sourceAlternativePositions:player.secondaryRole ? [player.secondaryRole] : [],
    nationality:player.nationality,
    club:player.club,
    league:"",
    heightCm:number(player.heightCm),
    age:number(player.development?.age),
    preferredFoot:player.preferredFoot,
    weakFoot:number(player.weakFoot),
    skillMoves:number(player.skillMoves),
    attributes:Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, number(player.attributes?.[key])])),
    rawReferenceAttributes:null,
    sourceId:player.id,
    sourceUrl:player.sourceUrl ?? "",
    sourceDatasetUrl:player.source ?? "",
  };
}

function fromS3(player) {
  return {
    sourceVersion:"YellowDogs S3 EA-derived archive",
    sourceType:"project S3 EA-derived historical profile",
    overall:number(player.overall),
    role:player.role,
    secondaryRole:player.secondaryRole ?? "",
    sourceMainPosition:player.role,
    sourceAlternativePositions:player.secondaryRole ? [player.secondaryRole] : [],
    nationality:player.nationality,
    club:player.club,
    league:"",
    heightCm:number(player.heightCm),
    age:number(player.development?.age),
    preferredFoot:player.preferredFoot,
    weakFoot:null,
    skillMoves:null,
    attributes:Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, number(player.attributes?.[key])])),
    rawReferenceAttributes:null,
    sourceId:player.id,
    sourceUrl:"",
    sourceDatasetUrl:"backups/player-data/S3-player-pool-700-20260725.json",
  };
}

function fromFifa22(row) {
  const role = mapRole(row.BestPosition);
  const raw = rawFromFifa22(row);
  return {
    sourceVersion:"FIFA 22 historical snapshot",
    sourceType:"Kaggle FIFA 22 complete player archive",
    overall:number(row.Overall),
    role,
    secondaryRole:parsePositions(row.Positions).map(mapRole).find((candidate) => candidate && candidate !== role) ?? "",
    sourceMainPosition:row.BestPosition ?? "",
    sourceAlternativePositions:parsePositions(row.Positions),
    nationality:row.Nationality ?? "",
    club:row.Club ?? "",
    league:"",
    heightCm:number(row.Height),
    age:number(row.Age),
    preferredFoot:String(row.PreferredFoot ?? "").toLowerCase(),
    weakFoot:number(row.WeakFoot),
    skillMoves:number(row.SkillMoves),
    attributes:coreFromRaw(raw, role),
    rawReferenceAttributes:raw,
    sourceId:row.ID,
    sourceUrl:row.PhotoUrl ?? "",
    sourceDatasetUrl:"https://www.kaggle.com/datasets/cashncarry/fifa-22-complete-player-dataset",
  };
}

function fromFifa21(row) {
  const role = mapRole(row.BP);
  const raw = rawFromFifa21(row);
  return {
    sourceVersion:`FIFA historical snapshot (${String(row.Contract ?? "").match(/\d{4}/)?.[0] ?? "legacy"})`,
    sourceType:"Kaggle FIFA historical complete player archive",
    overall:number(row.OVA),
    role,
    secondaryRole:parsePositions(row.Position).map(mapRole).find((candidate) => candidate && candidate !== role) ?? "",
    sourceMainPosition:row.BP ?? "",
    sourceAlternativePositions:parsePositions(row.Position),
    nationality:row.Nationality ?? "",
    club:row.Club ?? "",
    league:"",
    heightCm:parseFeetHeight(row.Height),
    age:number(row.Age),
    preferredFoot:String(row.foot ?? "").toLowerCase(),
    weakFoot:number(String(row["W/F"] ?? "").match(/\d+/)?.[0]),
    skillMoves:number(String(row.SM ?? "").match(/\d+/)?.[0]),
    attributes:coreFromRaw(raw, role),
    rawReferenceAttributes:raw,
    sourceId:row.ID,
    sourceUrl:row["Player Photo"] ?? "",
    sourceDatasetUrl:"https://www.kaggle.com/datasets/ekrembayar/fifa-21-complete-player-dataset",
  };
}

function fromFutHistory(row, file) {
  const role = mapRole(row.Position);
  const directAttributes = Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, null]));
  directAttributes.passing = number(row.PAS);
  directAttributes.dribbling = number(row.DRI);
  directAttributes.pace = number(row.PAC);
  return {
    sourceVersion:`${file.replace(" Fut Players.csv", "")} FUT historical card`,
    sourceType:"Kaggle FUT historical partial card archive",
    overall:number(row.Ratings),
    role,
    secondaryRole:"",
    sourceMainPosition:row.Position ?? "",
    sourceAlternativePositions:[],
    nationality:row.Country ?? "",
    club:row.Club ?? "FUT Icons",
    league:row.League ?? "Icons",
    heightCm:number(String(row.Body ?? "").match(/\d{3}(?=cm)/)?.[0]),
    age:null,
    preferredFoot:"",
    weakFoot:number(row.WF),
    skillMoves:number(row.SKI),
    attributes:directAttributes,
    rawReferenceAttributes:{ pace:number(row.PAC), shooting:number(row.SHO), passing:number(row.PAS), dribbling:number(row.DRI), defending:number(row.DEF), physicality:number(row.PHY) },
    sourceId:"",
    sourceUrl:"",
    sourceDatasetUrl:"https://www.kaggle.com/datasets/mohammedessam97/fifa-1020-fut-players-dataset",
  };
}

function unresolvedSource() {
  return {
    sourceVersion:"unresolved",
    sourceType:"missing",
    overall:null,
    role:"",
    secondaryRole:"",
    sourceMainPosition:"",
    sourceAlternativePositions:[],
    nationality:"",
    club:"",
    league:"",
    heightCm:null,
    age:null,
    preferredFoot:"",
    weakFoot:null,
    skillMoves:null,
    attributes:Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, null])),
    rawReferenceAttributes:null,
  };
}

function rawFromOfficial(stats) {
  const value = (key) => number(stats[key]?.value);
  return {
    pace:value("pac"), acceleration:value("acceleration"), positioning:value("positioning"), finishing:value("finishing"),
    longShots:value("longShots"), vision:value("vision"), crossing:value("crossing"), freeKickAccuracy:value("freeKickAccuracy"),
    shortPassing:value("shortPassing"), longPassing:value("longPassing"), curve:value("curve"), dribbling:value("dribbling"),
    agility:value("agility"), reactions:value("reactions"), ballControl:value("ballControl"), composure:value("composure"),
    interceptions:value("interceptions"), headingAccuracy:value("headingAccuracy"), defensiveAwareness:value("defensiveAwareness"),
    standingTackle:value("standingTackle"), slidingTackle:value("slidingTackle"), jumping:value("jumping"), stamina:value("stamina"),
    strength:value("strength"), aggression:value("aggression"), penalties:value("penalties"), goalkeeperDiving:value("gkDiving"),
    goalkeeperHandling:value("gkHandling"), goalkeeperKicking:value("gkKicking"), goalkeeperPositioning:value("gkPositioning"),
    goalkeeperReflexes:value("gkReflexes"), passing:value("pas"),
  };
}

function rawFromFifa22(row) {
  return {
    pace:number(row.PaceTotal), acceleration:number(row.Acceleration), positioning:number(row.Positioning),
    finishing:number(row.Finishing), longShots:number(row.LongShots), vision:number(row.Vision), crossing:number(row.Crossing),
    freeKickAccuracy:number(row.FKAccuracy), shortPassing:number(row.ShortPassing), longPassing:number(row.LongPassing),
    curve:number(row.Curve), dribbling:number(row.Dribbling), agility:number(row.Agility), reactions:number(row.Reactions),
    ballControl:number(row.BallControl), composure:number(row.Composure), interceptions:number(row.Interceptions),
    headingAccuracy:number(row.HeadingAccuracy), defensiveAwareness:number(row.Marking), standingTackle:number(row.StandingTackle),
    slidingTackle:number(row.SlidingTackle), jumping:number(row.Jumping), stamina:number(row.Stamina), strength:number(row.Strength),
    aggression:number(row.Aggression), penalties:number(row.Penalties), goalkeeperDiving:number(row.GKDiving),
    goalkeeperHandling:number(row.GKHandling), goalkeeperKicking:number(row.GKKicking), goalkeeperPositioning:number(row.GKPositioning),
    goalkeeperReflexes:number(row.GKReflexes), passing:number(row.PassingTotal),
  };
}

function rawFromFifa21(row) {
  return {
    pace:number(row.PAC), acceleration:number(row.Acceleration), positioning:number(row.Positioning), finishing:number(row.Finishing),
    longShots:number(row["Long Shots"]), vision:number(row.Vision), crossing:number(row.Crossing),
    freeKickAccuracy:number(row["FK Accuracy"]), shortPassing:number(row["Short Passing"]), longPassing:number(row["Long Passing"]),
    curve:number(row.Curve), dribbling:number(row.Dribbling), agility:number(row.Agility), reactions:number(row.Reactions),
    ballControl:number(row["Ball Control"]), composure:number(row.Composure), interceptions:number(row.Interceptions),
    headingAccuracy:number(row["Heading Accuracy"]), defensiveAwareness:number(row.Marking), standingTackle:number(row["Standing Tackle"]),
    slidingTackle:number(row["Sliding Tackle"]), jumping:number(row.Jumping), stamina:number(row.Stamina), strength:number(row.Strength),
    aggression:number(row.Aggression), penalties:number(row.Penalties), goalkeeperDiving:number(row["GK Diving"]),
    goalkeeperHandling:number(row["GK Handling"]), goalkeeperKicking:number(row["GK Kicking"]), goalkeeperPositioning:number(row["GK Positioning"]),
    goalkeeperReflexes:number(row["GK Reflexes"]), passing:number(row.PAS),
  };
}

function coreFromRaw(source, role) {
  const goalkeeper = role === "GK";
  const defensiveRole = ["CB", "LB", "RB", "DM"].includes(role);
  const raw = {
    passing:average(source.passing, source.shortPassing, source.longPassing), firstTouch:source.ballControl,
    dribbling:source.dribbling, crossing:source.crossing, finishing:source.finishing, longShots:source.longShots,
    heading:source.headingAccuracy, setPieces:average(source.freeKickAccuracy, source.curve, source.penalties),
    tackling:average(source.standingTackle, source.slidingTackle), marking:source.defensiveAwareness,
    positioning:goalkeeper ? source.goalkeeperPositioning : defensiveRole ? source.defensiveAwareness : average(source.defensiveAwareness, source.interceptions),
    vision:source.vision, decisions:source.reactions, composure:source.composure, offBall:source.positioning,
    discipline:average(source.composure, source.reactions, Number.isFinite(source.aggression) ? 105 - source.aggression : null),
    pace:source.pace, acceleration:source.acceleration, strength:source.strength, stamina:source.stamina,
    agility:source.agility, jumping:source.jumping, workRate:source.stamina, aggression:source.aggression,
    goalkeeping:goalkeeper ? average(source.goalkeeperDiving, source.goalkeeperHandling, source.goalkeeperKicking, source.goalkeeperPositioning, source.goalkeeperReflexes) : 8,
    reflexes:goalkeeper ? source.goalkeeperReflexes : 8,
  };
  return Object.fromEntries(CORE_ATTRIBUTE_KEYS.map((key) => [key, Number.isFinite(raw[key]) ? clamp(raw[key], key === "discipline" ? 35 : 1, key === "discipline" ? 95 : 99) : null]));
}

function officialNames(player) {
  return [player.commonName, `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim()].filter(Boolean);
}

function displayOfficialName(player) {
  return player.commonName || `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim();
}

function normalizeName(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

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
  return rows.filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function parsePositions(value) {
  return String(value ?? "").replace(/[\[\]'\"]/g, "").split(",").map((position) => position.trim()).filter(Boolean);
}

function parseFeetHeight(value) {
  const match = String(value ?? "").match(/(\d+)'(\d+)/);
  return match ? Math.round((Number(match[1]) * 12 + Number(match[2])) * 2.54) : null;
}

function normalizeChinese(value) {
  return String(value ?? "").replace(/[·•・\s（）()]/g, "").replace(/中后卫|门将/g, "");
}

function slug(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function number(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
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

function mapRole(value) {
  return POSITION_MAP[String(value ?? "").trim()] ?? "";
}

function poolForRole(role) {
  if (role === "GK") return "GK";
  if (["CB", "LB", "RB"].includes(role)) return "DEF";
  if (["DM", "AM", "LM", "RM"].includes(role)) return "MID";
  if (["ST", "LW", "RW"].includes(role)) return "ATT";
  return "";
}

function ageFromBirthdate(value) {
  const birthdate = new Date(value);
  if (Number.isNaN(birthdate.getTime())) return null;
  const reference = new Date("2026-08-03T00:00:00Z");
  let age = reference.getUTCFullYear() - birthdate.getUTCFullYear();
  if (reference.getUTCMonth() < birthdate.getUTCMonth() || reference.getUTCMonth() === birthdate.getUTCMonth() && reference.getUTCDate() < birthdate.getUTCDate()) age -= 1;
  return age;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function mapConcurrent(items, concurrency, task) {
  let cursor = 0;
  const workers = Array.from({ length:Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}
