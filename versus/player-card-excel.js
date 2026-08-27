import ExcelJS from "exceljs";
import { ATTRIBUTE_NAMES, playerOverallFromAttributes } from "../game/public/schema.js";
import { isS4Legend, isXPlayer, REAL_PLAYERS } from "./player-pool.js";
import { S4_BOND_POOL_MINIMUM } from "./public/bond-rules.js";

const BASE_COLUMNS = Object.freeze([
  ["id", "球员ID（可留空）", 26], ["name", "中文名", 18], ["sourceName", "英文名", 24], ["overall", "游戏总评", 12],
  ["grade", "等级", 10], ["role", "主位置", 12], ["secondaryRole", "副位置（可留空）", 18], ["nationality", "国籍", 16],
  ["club", "俱乐部", 22], ["heightCm", "身高cm", 12], ["preferredFoot", "惯用脚", 12],
]);
const ALL_COLUMNS = Object.freeze([...BASE_COLUMNS, ...ATTRIBUTE_NAMES.map((key) => [key, key, 15])]);
const ROLES = new Set(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const GRADES = new Set(["S", "A", "B", "C"]);
const EXPORT_COLORS = Object.freeze({
  dark:"FF071411",
  panel:"FF0D211A",
  lime:"FFC9F05C",
  cyan:"FF71D9D0",
  amber:"FFFFCF4A",
  red:"FFFF9A9F",
  white:"FFF5FFF9",
  muted:"FF9BB3AA",
});

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

function reportHeader(sheet, color = EXPORT_COLORS.lime) {
  const header = sheet.getRow(1);
  header.height = 28;
  header.font = { bold:true, color:{ argb:EXPORT_COLORS.dark } };
  header.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:color } };
  header.alignment = { vertical:"middle", horizontal:"center", wrapText:true };
  sheet.autoFilter = { from:{ row:1, column:1 }, to:{ row:1, column:sheet.columnCount } };
  sheet.views = [{ state:"frozen", ySplit:1, showGridLines:false }];
}

function reportBody(sheet, wrapColumns = []) {
  const wraps = new Set(wrapColumns);
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (!wraps.size) row.height = 22;
    row.alignment = { vertical:"middle" };
    row.eachCell((cell, columnNumber) => {
      cell.border = { bottom:{ style:"hair", color:{ argb:"FFE0EBE5" } } };
      if (wraps.has(columnNumber)) cell.alignment = { vertical:"middle", wrapText:true };
    });
  }
}

function playerType(player) {
  if (isXPlayer(player)) return "X球员";
  if (player.customPlayer) return "后台自定义";
  if (isS4Legend(player)) return "传奇球员";
  if (player.isDlc) return "DLC球员";
  return "基础球员";
}

function groupedPlayerSummary(players, key) {
  const groups = new Map();
  players.forEach((player) => {
    const name = text(player?.[key]) || "未填写";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(player);
  });
  return [...groups.entries()].map(([name, members]) => {
    const eligible = members.filter((player) => !isXPlayer(player));
    const poolCount = (pool) => eligible.filter((player) => player.pool === pool).length;
    const gradeCount = (grade) => eligible.filter((player) => player.grade === grade).length;
    return {
      name,
      members:[...members].sort((left, right) => Number(right.overall ?? 0) - Number(left.overall ?? 0) || String(left.name).localeCompare(String(right.name), "zh-CN")),
      eligibleCount:eligible.length,
      totalCount:members.length,
      GK:poolCount("GK"), DEF:poolCount("DEF"), MID:poolCount("MID"), ATT:poolCount("ATT"),
      S:gradeCount("S"), A:gradeCount("A"), B:gradeCount("B"), C:gradeCount("C"),
      X:members.filter((player) => isXPlayer(player)).length,
    };
  }).sort((left, right) => right.eligibleCount - left.eligibleCount || left.name.localeCompare(right.name, "zh-CN"));
}

function addIdentitySummarySheet(workbook, name, label, summaries) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { header:label, key:"name", width:20 },
    { header:"羁绊池人数", key:"eligibleCount", width:13 },
    { header:"全部球员数", key:"totalCount", width:13 },
    { header:"门将", key:"GK", width:9 },
    { header:"后场", key:"DEF", width:9 },
    { header:"中场", key:"MID", width:9 },
    { header:"前场", key:"ATT", width:9 },
    { header:"S", key:"S", width:8 },
    { header:"A", key:"A", width:8 },
    { header:"B", key:"B", width:8 },
    { header:"C", key:"C", width:8 },
    { header:"X", key:"X", width:8 },
    { header:"当前羁绊状态", key:"bondStatus", width:16 },
    { header:`距${S4_BOND_POOL_MINIMUM}人差额`, key:"gap", width:13 },
    { header:"球员名单（按总评）", key:"players", width:64 },
  ];
  summaries.forEach((summary, index) => {
    const rowNumber = index + 2;
    const enabled = summary.eligibleCount >= S4_BOND_POOL_MINIMUM;
    sheet.addRow({
      ...summary,
      bondStatus:{ formula:`IF(B${rowNumber}>=${S4_BOND_POOL_MINIMUM},\"已开放\",\"未开放\")`, result:enabled ? "已开放" : "未开放" },
      gap:{ formula:`MAX(0,${S4_BOND_POOL_MINIMUM}-B${rowNumber})`, result:Math.max(0, S4_BOND_POOL_MINIMUM - summary.eligibleCount) },
      players:summary.members.map((player) => `${player.name}(${player.grade ?? "X"}/${player.role})`).join("、"),
    });
    const statusCell = sheet.getCell(rowNumber, 13);
    statusCell.font = { bold:true, color:{ argb:enabled ? "FF276749" : "FF9B2C2C" } };
    statusCell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:enabled ? "FFE6FFEF" : "FFFFE8E8" } };
  });
  reportHeader(sheet, label === "国籍" ? EXPORT_COLORS.cyan : EXPORT_COLORS.amber);
  reportBody(sheet);
  sheet.getColumn(2).numFmt = "#,##0";
  sheet.getColumn(3).numFmt = "#,##0";
  return sheet;
}

export async function buildPlayerBondAnalysisWorkbook(players = REAL_PLAYERS) {
  const snapshot = [...players].sort((left, right) => String(left.nationality).localeCompare(String(right.nationality), "zh-CN")
    || String(left.club).localeCompare(String(right.club), "zh-CN")
    || Number(right.overall ?? 0) - Number(left.overall ?? 0)
    || String(left.name).localeCompare(String(right.name), "zh-CN"));
  const nationalitySummaries = groupedPlayerSummary(snapshot, "nationality");
  const clubSummaries = groupedPlayerSummary(snapshot, "club");
  const nationalityCount = new Map(nationalitySummaries.map((entry) => [entry.name, entry.eligibleCount]));
  const clubCount = new Map(clubSummaries.map((entry) => [entry.name, entry.eligibleCount]));
  const eligiblePlayers = snapshot.filter((player) => !isXPlayer(player));
  const unopenedNationalities = nationalitySummaries.filter((entry) => entry.eligibleCount > 0 && entry.eligibleCount < S4_BOND_POOL_MINIMUM);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "YDL Admin";
  workbook.lastModifiedBy = "YDL Admin";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const detail = workbook.addWorksheet("球员明细");
  detail.columns = [
    { header:"序号", key:"index", width:9 },
    { header:"球员ID", key:"id", width:30 },
    { header:"中文名", key:"name", width:20 },
    { header:"英文名", key:"sourceName", width:26 },
    { header:"球员类型", key:"type", width:15 },
    { header:"等级", key:"grade", width:9 },
    { header:"总评", key:"overall", width:9 },
    { header:"主位置", key:"role", width:10 },
    { header:"副位置", key:"secondaryRole", width:10 },
    { header:"位置线", key:"pool", width:10 },
    { header:"国籍", key:"nationality", width:18 },
    { header:"俱乐部", key:"club", width:24 },
    { header:"国家池人数", key:"nationalityCount", width:13 },
    { header:"国家羁绊", key:"nationalityBond", width:13 },
    { header:"俱乐部池人数", key:"clubCount", width:15 },
    { header:"俱乐部羁绊", key:"clubBond", width:14 },
    { header:"身高cm", key:"heightCm", width:11 },
  ];
  snapshot.forEach((player, index) => {
    const rowNumber = index + 2;
    const xPlayer = isXPlayer(player);
    const nationPool = nationalityCount.get(text(player.nationality) || "未填写") ?? 0;
    const playerClubCount = clubCount.get(text(player.club) || "未填写") ?? 0;
    detail.addRow({
      index:index + 1,
      id:player.id,
      name:player.name,
      sourceName:player.sourceName ?? "",
      type:playerType(player),
      grade:xPlayer ? "X" : player.grade,
      overall:Number(player.overall ?? 0),
      role:player.role,
      secondaryRole:player.secondaryRole ?? "",
      pool:player.pool,
      nationality:player.nationality,
      club:player.club,
      nationalityCount:nationPool,
      nationalityBond:{ formula:`IF(E${rowNumber}=\"X球员\",\"不参与\",IF(M${rowNumber}>=${S4_BOND_POOL_MINIMUM},\"已开放\",\"未开放\"))`, result:xPlayer ? "不参与" : nationPool >= S4_BOND_POOL_MINIMUM ? "已开放" : "未开放" },
      clubCount:playerClubCount,
      clubBond:{ formula:`IF(E${rowNumber}=\"X球员\",\"不参与\",IF(O${rowNumber}>=${S4_BOND_POOL_MINIMUM},\"已开放\",\"未开放\"))`, result:xPlayer ? "不参与" : playerClubCount >= S4_BOND_POOL_MINIMUM ? "已开放" : "未开放" },
      heightCm:Number(player.heightCm ?? 0),
    });
  });
  reportHeader(detail);
  reportBody(detail);
  detail.getColumn(1).numFmt = "#,##0";
  detail.getColumn(7).numFmt = "0";
  detail.getColumn(17).numFmt = "0";

  addIdentitySummarySheet(workbook, "国家汇总", "国籍", nationalitySummaries);
  addIdentitySummarySheet(workbook, "俱乐部汇总", "俱乐部", clubSummaries);

  const candidates = workbook.addWorksheet("国家羁绊候选");
  candidates.columns = [
    { header:"优先顺序", key:"rank", width:11 },
    { header:"国籍", key:"name", width:20 },
    { header:"当前球员数", key:"eligibleCount", width:14 },
    { header:`距${S4_BOND_POOL_MINIMUM}人差额`, key:"gap", width:13 },
    { header:"门将", key:"GK", width:9 },
    { header:"后场", key:"DEF", width:9 },
    { header:"中场", key:"MID", width:9 },
    { header:"前场", key:"ATT", width:9 },
    { header:"S", key:"S", width:8 },
    { header:"A", key:"A", width:8 },
    { header:"B", key:"B", width:8 },
    { header:"C", key:"C", width:8 },
    { header:"现有球员名单", key:"players", width:70 },
  ];
  unopenedNationalities.forEach((summary, index) => candidates.addRow({
    rank:index + 1,
    ...summary,
    gap:S4_BOND_POOL_MINIMUM - summary.eligibleCount,
    players:summary.members.filter((player) => !isXPlayer(player)).map((player) => `${player.name}(${player.grade}/${player.role})`).join("、"),
  }));
  reportHeader(candidates, EXPORT_COLORS.red);
  reportBody(candidates);

  const overview = workbook.addWorksheet("导出说明", { properties:{ tabColor:{ argb:EXPORT_COLORS.lime } } });
  overview.columns = [{ header:"项目", key:"label", width:28 }, { header:"当前结果", key:"value", width:22 }, { header:"说明", key:"note", width:72 }];
  const activeNationalityCount = nationalitySummaries.filter((entry) => entry.eligibleCount >= S4_BOND_POOL_MINIMUM).length;
  const affectedPlayers = unopenedNationalities.reduce((sum, entry) => sum + entry.eligibleCount, 0);
  const detailLastRow = snapshot.length + 1;
  const nationalityLastRow = nationalitySummaries.length + 1;
  [
    ["生成时间", new Date(), "由正式服务器按当前内存球员库实时生成。"],
    ["完整球员数", { formula:`COUNTA('球员明细'!B2:B${detailLastRow})`, result:snapshot.length }, "包含X球员、运营覆盖和后台已发布自定义球员。"],
    ["可参与常规羁绊球员", { formula:`COUNTIF('球员明细'!E2:E${detailLastRow},\"<>X球员\")`, result:eligiblePlayers.length }, "X球员按当前规则不进入国家与俱乐部羁绊池统计。"],
    ["当前羁绊入池门槛", S4_BOND_POOL_MINIMUM, "国家或俱乐部在完整球员池达到此人数后，才会进入可触发目录。"],
    ["已有国家羁绊", { formula:`COUNTIF('国家汇总'!M2:M${nationalityLastRow},\"已开放\")`, result:activeNationalityCount }, "当前达到入池门槛的国家数量。"],
    ["尚无羁绊国家", { formula:`COUNTIF('国家汇总'!M2:M${nationalityLastRow},\"未开放\")`, result:unopenedNationalities.length }, "已有正式球员，但总人数尚未达到入池门槛。"],
    ["受国家羁绊缺口影响球员", { formula:`SUMIF('国家汇总'!M2:M${nationalityLastRow},\"未开放\",'国家汇总'!B2:B${nationalityLastRow})`, result:affectedPlayers }, "这些正式球员目前无法组成对应国家羁绊目录。"],
    ["使用建议", "优先查看“国家羁绊候选”", "先补齐人数接近门槛且位置结构完整的国家；不要只看总人数，还要检查门将、后场、中场和前场覆盖。"],
  ].forEach(([label, value, note]) => overview.addRow({ label, value, note }));
  reportHeader(overview);
  reportBody(overview, [3]);
  overview.getColumn(2).numFmt = "#,##0";
  overview.getCell("B2").numFmt = "yyyy-mm-dd hh:mm:ss";
  overview.getColumn(2).font = { bold:true, color:{ argb:"FF276749" } };
  overview.views = [{ state:"frozen", ySplit:1, showGridLines:false }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
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
