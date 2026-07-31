import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WORKSPACE_ROOT = path.resolve(ROOT, "..", "..");
const INPUT = path.join(ROOT, "outputs", "player-dlc-review-20260731", "球员DLC-EA数据与26项属性审阅.xlsx");
const OUTPUT_DIR = path.join(ROOT, "outputs", "player-dlc-final-20260731");
const OUTPUT = path.join(OUTPUT_DIR, "球员DLC-S4最终数据.xlsx");
const OUTPUT_JSON = path.join(ROOT, "data", "player-dlc-s4-final.json");
const OUTPUT_CSV = path.join(ROOT, "data", "player-dlc-s4-final.csv");
const PREVIEW = path.join(OUTPUT_DIR, "preview.png");
const S3_SOURCE = path.join(WORKSPACE_ROOT, "backups", "player-data", "S3-player-pool-700-20260725.json");
const FIFA_HISTORY_SOURCE = path.join(WORKSPACE_ROOT, ".tmp-fifa21-small", "fifa21_male2.csv");

const ATTRIBUTE_COLUMNS = Object.freeze({
  传球:"passing", 停球:"firstTouch", 盘带:"dribbling", 传中:"crossing", 射门:"finishing",
  远射:"longShots", 头球:"heading", 定位球:"setPieces", 抢断:"tackling", 盯人:"marking",
  站位:"positioning", 视野:"vision", 决策:"decisions", 冷静:"composure", 无球:"offBall",
  纪律:"discipline", 速度:"pace", 加速:"acceleration", 力量:"strength", 耐力:"stamina",
  灵活:"agility", 弹跳:"jumping", 投入:"workRate", 侵略性:"aggression", 守门:"goalkeeping", 反应:"reflexes",
});
const ATTRIBUTE_KEYS = Object.freeze(Object.values(ATTRIBUTE_COLUMNS));
const USER_AUTHORITY_COLUMNS = new Set(["名单名称", "中文全名", "英文名", "调整后 OVR", "位置池", "主位置", "副位置", "国籍", "俱乐部"]);
const LEGEND_GRADE = "S";

const POSITION_TEMPLATES = Object.freeze({
  GK:{ passing:0, firstTouch:-2, dribbling:-18, crossing:-12, finishing:-24, longShots:-18, heading:-3, setPieces:-10, tackling:-8, marking:-6, positioning:9, vision:2, decisions:5, composure:7, offBall:-16, discipline:6, pace:-8, acceleration:-8, strength:3, stamina:-1, agility:2, jumping:4, workRate:0, aggression:-8, goalkeeping:15, reflexes:16 },
  CB:{ passing:-2, firstTouch:-2, dribbling:-6, crossing:-5, finishing:-10, longShots:-7, heading:8, setPieces:-6, tackling:11, marking:11, positioning:9, vision:-1, decisions:4, composure:2, offBall:-5, discipline:2, pace:-2, acceleration:-3, strength:8, stamina:4, agility:-4, jumping:8, workRate:5, aggression:7, goalkeeping:-70, reflexes:-70 },
  LB:{ passing:2, firstTouch:1, dribbling:3, crossing:8, finishing:-6, longShots:-2, heading:-3, setPieces:1, tackling:5, marking:4, positioning:4, vision:2, decisions:2, composure:0, offBall:3, discipline:1, pace:8, acceleration:8, strength:-2, stamina:8, agility:6, jumping:-3, workRate:8, aggression:2, goalkeeping:-70, reflexes:-70 },
  RB:{ passing:2, firstTouch:1, dribbling:3, crossing:8, finishing:-6, longShots:-2, heading:-3, setPieces:1, tackling:5, marking:4, positioning:4, vision:2, decisions:2, composure:0, offBall:3, discipline:1, pace:8, acceleration:8, strength:-2, stamina:8, agility:6, jumping:-3, workRate:8, aggression:2, goalkeeping:-70, reflexes:-70 },
  DM:{ passing:6, firstTouch:4, dribbling:0, crossing:1, finishing:-7, longShots:3, heading:1, setPieces:3, tackling:7, marking:6, positioning:8, vision:7, decisions:7, composure:5, offBall:1, discipline:4, pace:-1, acceleration:-2, strength:4, stamina:8, agility:0, jumping:1, workRate:8, aggression:5, goalkeeping:-70, reflexes:-70 },
  AM:{ passing:8, firstTouch:8, dribbling:7, crossing:3, finishing:5, longShots:7, heading:-3, setPieces:6, tackling:-5, marking:-5, positioning:0, vision:11, decisions:7, composure:6, offBall:8, discipline:1, pace:3, acceleration:4, strength:-4, stamina:4, agility:7, jumping:-4, workRate:3, aggression:-4, goalkeeping:-70, reflexes:-70 },
  LM:{ passing:7, firstTouch:6, dribbling:7, crossing:8, finishing:0, longShots:3, heading:-4, setPieces:4, tackling:0, marking:-1, positioning:1, vision:8, decisions:4, composure:3, offBall:5, discipline:0, pace:7, acceleration:7, strength:-4, stamina:7, agility:8, jumping:-4, workRate:5, aggression:-3, goalkeeping:-70, reflexes:-70 },
  RM:{ passing:7, firstTouch:6, dribbling:7, crossing:8, finishing:0, longShots:3, heading:-4, setPieces:4, tackling:0, marking:-1, positioning:1, vision:8, decisions:4, composure:3, offBall:5, discipline:0, pace:7, acceleration:7, strength:-4, stamina:7, agility:8, jumping:-4, workRate:5, aggression:-3, goalkeeping:-70, reflexes:-70 },
  ST:{ passing:-2, firstTouch:3, dribbling:4, crossing:-5, finishing:12, longShots:6, heading:6, setPieces:1, tackling:-12, marking:-12, positioning:-4, vision:-2, decisions:3, composure:7, offBall:11, discipline:-1, pace:5, acceleration:5, strength:3, stamina:1, agility:3, jumping:4, workRate:1, aggression:2, goalkeeping:-70, reflexes:-70 },
  LW:{ passing:3, firstTouch:6, dribbling:10, crossing:7, finishing:6, longShots:4, heading:-5, setPieces:2, tackling:-8, marking:-8, positioning:-3, vision:4, decisions:2, composure:3, offBall:9, discipline:0, pace:10, acceleration:10, strength:-5, stamina:3, agility:10, jumping:-5, workRate:3, aggression:-3, goalkeeping:-70, reflexes:-70 },
  RW:{ passing:3, firstTouch:6, dribbling:10, crossing:7, finishing:6, longShots:4, heading:-5, setPieces:2, tackling:-8, marking:-8, positioning:-3, vision:4, decisions:2, composure:3, offBall:9, discipline:0, pace:10, acceleration:10, strength:-5, stamina:3, agility:10, jumping:-5, workRate:3, aggression:-3, goalkeeping:-70, reflexes:-70 },
});

const ADDITION_SOURCES = Object.freeze({
  迪迪:{ type:"s3", name:"迪迪" },
  罗比尼奥:{ type:"fifa-history", id:"136144", sourceOverall:77 },
  卡纳里奥:{ type:"game-template", heightCm:176, preferredFoot:"right" },
  萨维奥:{ type:"game-template", heightCm:176, preferredFoot:"left" },
  泽罗伯托:{ type:"fifa-history", id:"28765", sourceOverall:74 },
  克洛泽:{ type:"s3", name:"米罗斯拉夫·克洛泽" },
  劳尔:{ type:"s3", name:"劳尔·冈萨雷斯" },
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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, minimum = 1, maximum = 99) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function average(...values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function adjustedAttributes(attributes, sourceOverall, targetOverall) {
  const delta = (targetOverall - sourceOverall) * 0.65;
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [
    key,
    Number.isFinite(attributes[key]) ? clamp(attributes[key] + delta) : null,
  ]));
}

function historicalCore(row, role) {
  const defensiveRole = ["CB", "LB", "RB", "DM"].includes(role);
  const raw = {
    passing:average(number(row.PAS), number(row["Short Passing"]), number(row["Long Passing"])),
    firstTouch:number(row["Ball Control"]),
    dribbling:number(row.Dribbling),
    crossing:number(row.Crossing),
    finishing:number(row.Finishing),
    longShots:number(row["Long Shots"]),
    heading:number(row["Heading Accuracy"]),
    setPieces:average(number(row["FK Accuracy"]), number(row.Curve), number(row.Penalties)),
    tackling:average(number(row["Standing Tackle"]), number(row["Sliding Tackle"])),
    marking:number(row.Marking),
    positioning:defensiveRole ? number(row.Marking) : average(number(row.Marking), number(row.Interceptions)),
    vision:number(row.Vision),
    decisions:number(row.Reactions),
    composure:number(row.Composure),
    offBall:number(row.Positioning),
    discipline:average(number(row.Composure), number(row.Reactions), 105 - number(row.Aggression)),
    pace:number(row.PAC),
    acceleration:number(row.Acceleration),
    strength:number(row.Strength),
    stamina:number(row.Stamina),
    agility:number(row.Agility),
    jumping:number(row.Jumping),
    workRate:number(row.Stamina),
    aggression:number(row.Aggression),
    goalkeeping:8,
    reflexes:8,
  };
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, Number.isFinite(raw[key]) ? clamp(raw[key]) : null]));
}

function templateAttributes(role, overall) {
  const template = POSITION_TEMPLATES[role] ?? POSITION_TEMPLATES.AM;
  const initial = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [
    key,
    clamp(overall + Number(template[key] ?? 0)),
  ]));
  const overallKeys = role === "GK"
    ? ["goalkeeping", "reflexes", "positioning", "composure", "decisions"]
    : ["CB", "LB", "RB"].includes(role)
      ? ["tackling", "marking", "positioning", "strength", "jumping"]
      : ["DM", "AM", "LM", "RM"].includes(role)
        ? ["passing", "vision", "decisions", "firstTouch", "stamina"]
        : ["finishing", "offBall", "pace", "dribbling", "composure"];
  const current = average(...overallKeys.map((key) => initial[key]));
  const correction = overall - current;
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, clamp(initial[key] + correction)]));
}

function parseFeetHeight(value) {
  const match = String(value ?? "").match(/(\d+)'(\d+)/);
  return match ? Math.round((Number(match[1]) * 12 + Number(match[2])) * 2.54) : null;
}

function gradeFor(overall) {
  if (overall >= 90) return LEGEND_GRADE;
  if (overall >= 86) return "A";
  if (overall >= 80) return "B";
  return "C";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(INPUT));
const sheet = workbook.worksheets.getItem("球员数据");
const usedRange = sheet.getUsedRange();
const values = usedRange.values;
const headers = values[0].map((value) => String(value ?? ""));
const columns = Object.fromEntries(headers.map((header, index) => [header, index]));
const s3Payload = JSON.parse(await fs.readFile(S3_SOURCE, "utf8"));
const s3ByName = new Map(s3Payload.players.map((player) => [player.name, player]));
const historyRows = parseCsv(await fs.readFile(FIFA_HISTORY_SOURCE, "utf8"));
const historyById = new Map(historyRows.map((row) => [String(row.ID), row]));
const outputRows = [];

for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
  const row = [...values[rowIndex]];
  const inputName = String(row[columns["名单名称"]] ?? "").trim();
  if (!inputName) continue;
  const overall = number(row[columns["调整后 OVR"]]);
  if (!Number.isFinite(overall)) throw new Error(`${inputName} 缺少调整后 OVR`);
  row[columns["评级"]] = gradeFor(overall);

  const addition = ADDITION_SOURCES[inputName];
  if (addition) {
    const role = String(row[columns["主位置"]] ?? "").trim();
    let sourceOverall = overall;
    let attributes;
    let sourceId = "";
    let sourceUrl = "";
    let datasetUrl = "";
    let sourceVersion = "";
    let sourceType = "";
    let heightCm = null;
    let age = null;
    let preferredFoot = "";
    let weakFoot = null;
    let skillMoves = null;
    let sourceNote = "";

    if (addition.type === "s3") {
      const source = s3ByName.get(addition.name);
      if (!source) throw new Error(`S3 source missing: ${addition.name}`);
      sourceOverall = number(source.overall);
      attributes = adjustedAttributes(source.attributes, sourceOverall, overall);
      sourceId = source.id;
      sourceVersion = "YellowDogs S3 EA-derived archive";
      sourceType = "project S3 EA-derived profile";
      heightCm = source.heightCm;
      age = source.development?.age ?? null;
      preferredFoot = source.preferredFoot;
      sourceNote = `使用项目 S3 EA 派生 26 项，按 OVR ${sourceOverall}→${overall} 缩放`;
    } else if (addition.type === "fifa-history") {
      const source = historyById.get(addition.id);
      if (!source) throw new Error(`FIFA history source missing: ${addition.id}`);
      sourceOverall = number(addition.sourceOverall ?? source.OVA);
      attributes = adjustedAttributes(historicalCore(source, role), sourceOverall, overall);
      sourceId = source.ID;
      sourceUrl = source["Player Photo"] ?? "";
      datasetUrl = "https://www.kaggle.com/datasets/ekrembayar/fifa-21-complete-player-dataset";
      sourceVersion = `FIFA historical snapshot (${String(source.Contract ?? "").match(/\d{4}/)?.[0] ?? "legacy"})`;
      sourceType = "FIFA historical database archive";
      heightCm = parseFeetHeight(source.Height);
      age = number(source.Age);
      preferredFoot = String(source.foot ?? "").toLowerCase();
      weakFoot = number(String(source["W/F"] ?? "").match(/\d+/)?.[0]);
      skillMoves = number(String(source.SM ?? "").match(/\d+/)?.[0]);
      sourceNote = `历史 FIFA 细项按 OVR ${sourceOverall}→${overall} 缩放`;
    } else {
      attributes = templateAttributes(role, overall);
      sourceVersion = "S4 game definition";
      sourceType = "game position template";
      heightCm = addition.heightCm;
      preferredFoot = addition.preferredFoot;
      sourceNote = `无可靠 EA 普通卡细项，按 S4 ${role} 位置模板与 OVR ${overall} 生成`;
    }

    const fillIfBlank = (header, value) => {
      if (!USER_AUTHORITY_COLUMNS.has(header) && (row[columns[header]] === "" || row[columns[header]] == null)) {
        row[columns[header]] = value ?? "";
      }
    };
    fillIfBlank("身份确认", "已映射");
    fillIfBlank("数据状态", "26项已齐");
    fillIfBlank("数据版本", sourceVersion);
    fillIfBlank("来源类型", sourceType);
    fillIfBlank("来源 OVR", sourceOverall);
    fillIfBlank("身高cm", heightCm);
    fillIfBlank("年龄", age);
    fillIfBlank("惯用脚", preferredFoot);
    fillIfBlank("逆足", weakFoot);
    fillIfBlank("花式", skillMoves);
    for (const [label, key] of Object.entries(ATTRIBUTE_COLUMNS)) fillIfBlank(label, attributes[key]);
    fillIfBlank("来源 ID", sourceId);
    fillIfBlank("来源 URL", sourceUrl);
    fillIfBlank("数据集 URL", datasetUrl);
    fillIfBlank("备注", sourceNote);
  }
  outputRows.push(row);
}

const rowCount = outputRows.length;
sheet.getRangeByIndexes(1, 0, rowCount, headers.length).values = outputRows;
sheet.getRange(`K2:K${rowCount + 1}`).format.fill = "#E6F4EA";
sheet.getRange(`K1`).format.fill = "#176B45";
sheet.getRange(`K1`).format.font = { bold:true, color:"#FFFFFF", name:"Microsoft YaHei" };

const summary = workbook.worksheets.getItem("说明与汇总");
summary.getRange("A3:B7").values = [
  ["最终名单人数", rowCount],
  ["S / 传奇", outputRows.filter((row) => row[columns["评级"]] === "S").length],
  ["普通 A", outputRows.filter((row) => row[columns["评级"]] === "A").length],
  ["普通 B / C", outputRows.filter((row) => ["B", "C"].includes(row[columns["评级"]])).length],
  ["完成日期", "2026-07-31"],
];
summary.getRange("D4:H9").unmerge();
summary.getRange("D4:H9").merge();
summary.getRange("D4").values = [[
  "本版以用户编辑后的 54 人名单为唯一基准。位置、国籍、俱乐部、OVR、位置池均保留用户值。S 与传奇为同一定义，并按 OVR 自动评级：90+ 为 S/传奇、86–89 为 A、80–85 为 B、其余为 C。新增球员优先使用历史 EA/FIFA 或项目 EA 派生数据，无可靠细项时使用 S4 位置模板补全。",
]];
summary.getRange("A10:H14").clear({ applyTo:"contents" });
summary.getRange("A10:H10").unmerge();
summary.getRange("A10:H10").merge();
summary.getRange("A10").values = [["最终状态"]];
summary.getRange("A10:H10").format = { fill:"#176B45", font:{ bold:true, color:"#FFFFFF", name:"Microsoft YaHei" } };
summary.getRange("A11:H14").unmerge();
summary.getRange("A11:H14").merge();
summary.getRange("A11").values = [[
  `最终共 ${rowCount} 人，新增 7 人信息与 26 项能力已补齐。S/传奇 ${outputRows.filter((row) => row[columns["评级"]] === "S").length} 人；普通 A ${outputRows.filter((row) => row[columns["评级"]] === "A").length} 人；普通 B ${outputRows.filter((row) => row[columns["评级"]] === "B").length} 人；普通 C ${outputRows.filter((row) => row[columns["评级"]] === "C").length} 人。`,
]];
summary.getRange("A11:H14").format = { wrapText:true, verticalAlignment:"top", font:{ name:"Microsoft YaHei" } };

const players = outputRows.map((row, index) => ({
  order:index + 1,
  inputName:row[columns["名单名称"]],
  displayNameZh:row[columns["中文全名"]],
  sourceName:row[columns["英文名"]],
  legendary:row[columns["评级"]] === "S",
  grade:row[columns["评级"]],
  overall:number(row[columns["调整后 OVR"]]),
  pool:row[columns["位置池"]],
  role:row[columns["主位置"]],
  secondaryRole:row[columns["副位置"]] || null,
  nationality:row[columns["国籍"]],
  club:row[columns["俱乐部"]],
  heightCm:number(row[columns["身高cm"]]),
  age:number(row[columns["年龄"]]),
  preferredFoot:row[columns["惯用脚"]],
  weakFoot:number(row[columns["逆足"]]),
  skillMoves:number(row[columns["花式"]]),
  attributes:Object.fromEntries(Object.entries(ATTRIBUTE_COLUMNS).map(([label, key]) => [key, number(row[columns[label]])])),
  source:{
    overall:number(row[columns["来源 OVR"]]),
    version:row[columns["数据版本"]],
    type:row[columns["来源类型"]],
    id:row[columns["来源 ID"]],
    url:row[columns["来源 URL"]],
    datasetUrl:row[columns["数据集 URL"]],
    note:row[columns["备注"]],
  },
}));

const invalid = [];
for (const player of players) {
  if (!["S", "A", "B", "C"].includes(player.grade)) invalid.push(`${player.inputName}:评级`);
  if (!player.pool || !player.role || !player.nationality || !player.club || !Number.isFinite(player.overall)) invalid.push(`${player.inputName}:核心字段`);
  for (const key of ATTRIBUTE_KEYS) {
    if (!Number.isFinite(player.attributes[key]) || player.attributes[key] < 1 || player.attributes[key] > 99) {
      invalid.push(`${player.inputName}:${key}`);
    }
  }
}
if (invalid.length) throw new Error(`final validation failed: ${invalid.join(", ")}`);

await fs.mkdir(OUTPUT_DIR, { recursive:true });
const preview = await workbook.render({ sheetName:"说明与汇总", range:"A1:H14", scale:1.5, format:"png" });
await fs.writeFile(PREVIEW, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(OUTPUT);
await fs.writeFile(OUTPUT_JSON, `${JSON.stringify({
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  sourceWorkbook:"outputs/player-dlc-review-20260731/球员DLC-EA数据与26项属性审阅.xlsx",
  gradeRule:"S equals legendary: S>=90, A>=86, B>=80, otherwise C",
  coreAttributeKeys:ATTRIBUTE_KEYS,
  players,
}, null, 2)}\n`, "utf8");
await fs.writeFile(
  OUTPUT_CSV,
  `\ufeff${[headers, ...outputRows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`,
  "utf8",
);

const inspect = await workbook.inspect({
  kind:"table",
  range:`球员数据!A1:N${Math.min(rowCount + 1, 16)}`,
  include:"values,formulas",
  tableMaxRows:16,
  tableMaxCols:14,
});
const errors = await workbook.inspect({
  kind:"match",
  searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options:{ useRegex:true, maxResults:100 },
  summary:"final formula error scan",
});
console.log(JSON.stringify({
  output:OUTPUT,
  outputJson:OUTPUT_JSON,
  outputCsv:OUTPUT_CSV,
  preview:PREVIEW,
  players:players.length,
  grades:Object.fromEntries(["S", "A", "B", "C"].map((grade) => [grade, players.filter((player) => player.grade === grade).length])),
  additions:players.filter((player) => ADDITION_SOURCES[player.inputName]).map((player) => ({
    name:player.inputName,
    overall:player.overall,
    grade:player.grade,
    source:player.source.type,
  })),
  inspect:inspect.ndjson,
  errors:errors.ndjson,
}, null, 2));
