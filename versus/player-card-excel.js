import ExcelJS from "exceljs";
import { ATTRIBUTE_NAMES, playerOverallFromAttributes } from "../game/public/schema.js";
import { REAL_PLAYERS } from "./player-pool.js";

const BASE_COLUMNS = Object.freeze([
  ["id", "球员ID（可留空）", 26], ["name", "中文名", 18], ["sourceName", "英文名", 24], ["overall", "游戏总评", 12],
  ["grade", "等级", 10], ["role", "主位置", 12], ["secondaryRole", "副位置（可留空）", 18], ["nationality", "国籍", 16],
  ["club", "俱乐部", 22], ["heightCm", "身高cm", 12], ["preferredFoot", "惯用脚", 12],
]);
const ALL_COLUMNS = Object.freeze([...BASE_COLUMNS, ...ATTRIBUTE_NAMES.map((key) => [key, key, 15])]);
const ROLES = new Set(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const GRADES = new Set(["S", "A", "B", "C"]);

function cellValue(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if (Object.hasOwn(value, "result")) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if (Object.hasOwn(value, "text")) return value.text;
  }
  return value;
}

function text(value) {
  return String(value ?? "").trim();
}

function foot(value) {
  const normalized = text(value).toLowerCase();
  if (["左脚", "left", "左"].includes(normalized)) return "left";
  if (["双足", "both", "双脚"].includes(normalized)) return "both";
  if (["右脚", "right", "右", ""].includes(normalized)) return "right";
  return normalized;
}

export async function buildPlayerImportWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "YDL Admin";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("球员导入", { views:[{ state:"frozen", ySplit:1 }] });
  sheet.columns = ALL_COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  sheet.getRow(1).font = { bold:true, color:{ argb:"FF071411" } };
  sheet.getRow(1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFC9F05C" } };
  sheet.autoFilter = { from:"A1", to:`${sheet.getColumn(ALL_COLUMNS.length).letter}1` };
  for (let row = 2; row <= 1000; row += 1) {
    sheet.getCell(`E${row}`).dataValidation = { type:"list", allowBlank:false, formulae:['"S,A,B,C"'] };
    sheet.getCell(`F${row}`).dataValidation = { type:"list", allowBlank:false, formulae:['"GK,CB,LB,RB,LWB,RWB,DM,AM,LM,RM,ST,LW,RW"'] };
    sheet.getCell(`G${row}`).dataValidation = { type:"list", allowBlank:true, formulae:['"GK,CB,LB,RB,LWB,RWB,DM,AM,LM,RM,ST,LW,RW"'] };
    sheet.getCell(`K${row}`).dataValidation = { type:"list", allowBlank:false, formulae:['"right,left,both"'] };
  }
  const example = workbook.addWorksheet("填写示例");
  example.columns = ALL_COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  example.addRow({ name:"示例球员", sourceName:"Example Player", overall:82, grade:"B", role:"ST", secondaryRole:"RW", nationality:"示例国籍", club:"示例俱乐部", heightCm:183, preferredFoot:"right" });
  example.getRow(1).font = { bold:true, color:{ argb:"FF071411" } };
  example.getRow(1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFFCF4A" } };
  const guide = workbook.addWorksheet("填写说明");
  guide.columns = [{ header:"项目", width:28 }, { header:"说明", width:88 }];
  [
    ["基础资料", "中文名、英文名、总评、等级、主位置、国籍、俱乐部和身高为必填。球员ID可以留空，由服务器自动生成。"],
    ["能力回归", "26项能力全部留空时，系统按照游戏总评和主位置自动回归。"],
    ["手动能力", "需要手动导入能力时，26项必须全部填写，允许范围1—96；不能只填写其中一部分。"],
    ["PNG命名", "推荐使用英文名命名，例如 Lionel_Messi.png；后台会忽略空格、下划线、大小写和扩展名后自动匹配。"],
    ["惯用脚", "填写 right、left、both，也支持右脚、左脚、双足。"],
  ].forEach((row) => guide.addRow(row));
  guide.getRow(1).font = { bold:true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parsePlayerImportWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Excel文件为空");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("球员导入") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Excel中没有工作表");
  const headerByColumn = new Map();
  sheet.getRow(1).eachCell((cell, column) => headerByColumn.set(column, text(cellValue(cell))));
  const keyByHeader = new Map(ALL_COLUMNS.flatMap(([key, header]) => [[header, key], [key, key]]));
  const columnByKey = new Map();
  for (const [column, header] of headerByColumn) if (keyByHeader.has(header)) columnByKey.set(keyByHeader.get(header), column);
  for (const key of ["name", "sourceName", "overall", "grade", "role", "nationality", "club", "heightCm"]) {
    if (!columnByKey.has(key)) throw new Error(`Excel缺少列：${ALL_COLUMNS.find(([candidate]) => candidate === key)?.[1] ?? key}`);
  }
  const rows = [];
  const errors = [];
  const warnings = [];
  const seenNames = new Set();
  const existingNames = new Set(REAL_PLAYERS.flatMap((player) => [text(player.name).toLowerCase(), text(player.sourceName).toLowerCase()]).filter(Boolean));
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const input = Object.fromEntries([...columnByKey].map(([key, column]) => [key, cellValue(row.getCell(column))]));
    if (!text(input.name) && !text(input.sourceName)) continue;
    const rowErrors = [];
    const name = text(input.name);
    const sourceName = text(input.sourceName);
    const role = text(input.role).toUpperCase();
    const secondaryRole = text(input.secondaryRole).toUpperCase() || null;
    const grade = text(input.grade).toUpperCase();
    const overall = Number(input.overall);
    const heightCm = Number(input.heightCm);
    if (!name) rowErrors.push("中文名为空");
    if (!sourceName) rowErrors.push("英文名为空");
    if (!Number.isFinite(overall) || overall < 1 || overall > 96) rowErrors.push("总评必须为1—96");
    if (!GRADES.has(grade)) rowErrors.push("等级必须为S/A/B/C");
    if (!ROLES.has(role)) rowErrors.push("主位置无效");
    if (secondaryRole && (!ROLES.has(secondaryRole) || secondaryRole === role)) rowErrors.push("副位置无效");
    if (!text(input.nationality)) rowErrors.push("国籍为空");
    if (!text(input.club)) rowErrors.push("俱乐部为空");
    if (!Number.isFinite(heightCm) || heightCm < 140 || heightCm > 220) rowErrors.push("身高必须为140—220");
    const preferredFoot = foot(input.preferredFoot);
    if (!["left", "right", "both"].includes(preferredFoot)) rowErrors.push("惯用脚无效");
    const providedAttributes = ATTRIBUTE_NAMES.filter((key) => text(input[key]) !== "");
    if (providedAttributes.length && providedAttributes.length !== ATTRIBUTE_NAMES.length) rowErrors.push(`26项能力只填写了${providedAttributes.length}项`);
    const attributes = providedAttributes.length === ATTRIBUTE_NAMES.length
      ? Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, Number(input[key])]))
      : null;
    if (attributes && Object.entries(attributes).some(([, value]) => !Number.isFinite(value) || value < 1 || value > 96)) rowErrors.push("能力值必须为1—96");
    const normalizedName = sourceName.toLowerCase();
    if (seenNames.has(normalizedName)) rowErrors.push("Excel内英文名重复");
    seenNames.add(normalizedName);
    if (existingNames.has(name.toLowerCase()) || existingNames.has(normalizedName)) warnings.push({ row:rowNumber, message:"正式球员库中存在同名或同英文名球员" });
    if (attributes && ROLES.has(role)) {
      const calculatedOverall = playerOverallFromAttributes(attributes, role);
      if (calculatedOverall !== Math.round(overall)) warnings.push({ row:rowNumber, message:`26项能力计算总评为${calculatedOverall}，导入后以能力值计算结果为准` });
    }
    if (rowErrors.length) {
      errors.push({ row:rowNumber, name:name || sourceName || "未命名", errors:rowErrors });
      continue;
    }
    rows.push({
      id:text(input.id) || undefined, name, sourceName, overall:Math.round(overall), grade, role, secondaryRole,
      nationality:text(input.nationality), club:text(input.club), heightCm:Math.round(heightCm), preferredFoot,
      attributeMode:attributes ? "manual" : "regress", ...(attributes ? { attributes } : {}), sourceRow:rowNumber,
    });
  }
  return { sheetName:sheet.name, totalRows:rows.length + errors.length, validRows:rows.length, invalidRows:errors.length, rows, errors, warnings };
}

export const PLAYER_IMPORT_COLUMNS = Object.freeze(ALL_COLUMNS.map(([key, label]) => ({ key, label })));
