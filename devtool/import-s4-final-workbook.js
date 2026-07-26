import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const extractPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(ROOT, "..", "..", ".tmp-s4-player-rebuild", "s4-550-user-extract.json");
const sourcePath = path.join(ROOT, "data", "s4-player-database-550.zh-CN.json");
const outputPath = path.join(ROOT, "data", "s4-final-workbook-overrides.json");

const extract = JSON.parse(await fs.readFile(extractPath, "utf8"));
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const sourceById = new Map(source.players.map((player) => [player.id, player]));
const headers = extract.databaseValues[0];
const columns = Object.fromEntries(headers.map((header, index) => [header, index]));
const reviewHeaders = extract.reviewValues[0];
const reviewColumns = Object.fromEntries(reviewHeaders.map((header, index) => [header, index]));
const reviewNames = new Map(
  extract.reviewValues.slice(1)
    .filter((row) => row[reviewColumns.ID] && row[reviewColumns["请填写中文名"]])
    .map((row) => [row[reviewColumns.ID], String(row[reviewColumns["请填写中文名"]]).trim()]),
);

const coreLabels = {
  passing:"传球", firstTouch:"停球", dribbling:"盘带", crossing:"传中", finishing:"射门",
  longShots:"远射", heading:"头球", setPieces:"定位球", tackling:"抢断", marking:"盯人",
  positioning:"站位", vision:"视野", decisions:"决策", composure:"冷静", offBall:"无球",
  discipline:"纪律", pace:"速度", acceleration:"加速", strength:"力量", stamina:"耐力",
  agility:"灵活", jumping:"弹跳", workRate:"投入", aggression:"侵略性", goalkeeping:"守门", reflexes:"反应",
};
const editableFields = [
  ["displayNameZh", "中文显示名"],
  ["suggestedGrade", "评级"],
  ["role", "主位置"],
  ["secondaryRole", "副位置"],
  ["suggestedOverall", "游戏能力"],
  ["referenceOverall", "参考OVR"],
  ["sourceMainPosition", "原始主位置"],
  ["nationality", "国家队/国籍"],
  ["club", "俱乐部"],
  ["league", "联赛"],
  ["heightCm", "身高cm"],
  ["age", "年龄"],
];

const records = {};
for (const row of extract.databaseValues.slice(1)) {
  const id = row[columns.ID];
  const original = sourceById.get(id);
  if (!original) continue;
  const changes = {};
  for (const [field, label] of editableFields) {
    const after = field === "displayNameZh" && reviewNames.has(id) ? reviewNames.get(id) : row[columns[label]];
    const before = original[field] ?? null;
    const normalizedAfter = after === "" || after == null ? null : after;
    if (String(before ?? "") !== String(normalizedAfter ?? "")) changes[field] = normalizedAfter;
  }
  const alternatives = String(row[columns["原始副位置"]] ?? "").split("|").filter(Boolean);
  if ((original.sourceAlternativePositions ?? []).join("|") !== alternatives.join("|")) {
    changes.sourceAlternativePositions = alternatives;
  }
  const attributes = {};
  for (const [key, label] of Object.entries(coreLabels)) {
    const after = Number(row[columns[label]]);
    if (Number.isFinite(after) && after !== Number(original.attributes[key])) attributes[key] = after;
  }
  if (Object.keys(attributes).length) changes.attributes = attributes;
  if (Object.keys(changes).length) records[id] = changes;
}

const output = {
  schemaVersion:1,
  importedAt:new Date().toISOString(),
  sourceWorkbook:"outputs/s4-player-550-review-20260726/S4球员库550与退役名将校对.xlsx",
  players:records,
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  changedPlayers:Object.keys(records).length,
  names:Object.values(records).filter((record) => record.displayNameZh).length,
  overalls:Object.values(records).filter((record) => "suggestedOverall" in record).length,
  attributes:Object.values(records).filter((record) => record.attributes).length,
}, null, 2));
