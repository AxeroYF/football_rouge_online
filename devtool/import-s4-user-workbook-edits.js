import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const extractPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(ROOT, "..", "..", ".tmp-s4-player-rebuild", "user-candidate-extract.json");
const candidatePath = path.join(ROOT, "data", "s4-player-candidates-500.json");
const outputPath = path.join(ROOT, "data", "s4-user-workbook-overrides.json");

const extract = JSON.parse(await fs.readFile(extractPath, "utf8"));
const source = JSON.parse(await fs.readFile(candidatePath, "utf8"));
const sourceById = new Map(source.players.map((player) => [player.id, player]));
const headers = extract.databaseValues[0];
const index = Object.fromEntries(headers.map((header, column) => [header, column]));
const records = {};

const editableFields = [
  ["displayNameZh", "中文显示名"],
  ["pool", "位置池"],
  ["role", "主位置"],
  ["secondaryRole", "副位置"],
  ["sourceMainPosition", "原始主位置"],
  ["referenceOverall", "参考能力"],
  ["suggestedOverall", "建议能力"],
  ["suggestedGrade", "建议评级"],
  ["nationality", "国家队/国籍"],
  ["club", "俱乐部"],
  ["league", "联赛"],
  ["heightCm", "身高cm"],
  ["age", "年龄"],
  ["preferredFoot", "惯用脚"],
  ["weakFoot", "逆足"],
  ["skillMoves", "花式"],
];

for (const row of extract.databaseValues.slice(1)) {
  const id = row[index.ID];
  const original = sourceById.get(id);
  if (!id || !original) continue;
  // Legend reference values and positions are refreshed from the EAFC source
  // during candidate generation; the older workbook snapshot must not overwrite them.
  if (original.isLegend) continue;
  const changes = {};
  for (const [field, column] of editableFields) {
    const before = original[field] ?? null;
    const after = row[index[column]] ?? null;
    if (String(before ?? "") !== String(after ?? "")) changes[field] = after;
  }
  if (!original.isLegend) changes.displayNameZh = row[index["中文显示名"]] ?? "";
  const originalAlternatives = (original.sourceAlternativePositions ?? []).join("|");
  const afterAlternatives = row[index["原始替代位置"]] ?? "";
  if (originalAlternatives !== afterAlternatives) {
    changes.sourceAlternativePositions = afterAlternatives ? String(afterAlternatives).split("|") : [];
  }
  if (Object.keys(changes).length) records[id] = changes;
}

const output = {
  schemaVersion:1,
  importedAt:new Date().toISOString(),
  sourceWorkbook:"outputs/s4-player-rebuild-20260726/S4候选球员库500.xlsx",
  players:records,
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  changedPlayers:Object.keys(records).length,
  translatedNames:Object.values(records).filter((record) => record.displayNameZh).length,
  clubChanges:Object.values(records).filter((record) => "club" in record).length,
  overallChanges:Object.values(records).filter((record) => "referenceOverall" in record || "suggestedOverall" in record).length,
}, null, 2));
