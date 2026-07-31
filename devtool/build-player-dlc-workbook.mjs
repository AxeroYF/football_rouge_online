import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const INPUT = path.join(ROOT, "data", "player-dlc-ea-reference.json");
const OUTPUT_DIR = path.join(ROOT, "outputs", "player-dlc-review-20260731");
const OUTPUT = path.join(OUTPUT_DIR, "球员DLC-EA数据与26项属性审阅.xlsx");
const PREVIEW = path.join(OUTPUT_DIR, "preview.png");

const payload = JSON.parse(await fs.readFile(INPUT, "utf8"));
const workbook = Workbook.create();
const summary = workbook.worksheets.add("说明与汇总");
const playersSheet = workbook.worksheets.add("球员数据");
const sourceSheet = workbook.worksheets.add("来源说明");

summary.showGridLines = false;
playersSheet.showGridLines = false;
sourceSheet.showGridLines = false;

summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["球员 DLC：EA 数据与 26 项属性审阅"]];
summary.getRange("A1:H1").format = {
  fill:"#17324D",
  font:{ bold:true, color:"#FFFFFF", size:18 },
  verticalAlignment:"center",
};
summary.getRange("A1:H1").format.rowHeight = 34;

summary.getRange("A3:B7").values = [
  ["名单人数", payload.summary.requested],
  ["26 项完整", payload.summary.complete],
  ["缺少历史细项", payload.summary.incomplete],
  ["需确认身份", payload.summary.identityReview],
  ["生成日期", "2026-07-31"],
];
summary.getRange("A3:A7").format = { fill:"#DCE6F1", font:{ bold:true, color:"#17324D" } };
summary.getRange("B3:B7").format = { fill:"#F8FAFC", font:{ bold:true, color:"#17324D" } };
summary.getRange("A3:B7").format.borders = { preset:"outside", style:"thin", color:"#9CA3AF" };

summary.getRange("D3:H3").merge();
summary.getRange("D3").values = [["使用说明"]];
summary.getRange("D3:H3").format = { fill:"#C9A227", font:{ bold:true, color:"#FFFFFF" } };
summary.getRange("D4:H9").merge();
summary.getRange("D4").values = [[
  "“球员数据”表中的调整后 OVR、评级以及 26 项属性均可直接修改。FC26 当前值优先，其次使用 FIFA 历史数据库，再其次使用项目 S3 的 EA 派生档案。空白值表示未找到可靠历史来源，不应视为 0。修改完成后可用于后续导入，但不要未经平衡审阅直接覆盖正式球员池。",
]];
summary.getRange("D4:H9").format = {
  fill:"#FFF8E1",
  font:{ color:"#4B3B00" },
  wrapText:true,
  verticalAlignment:"top",
};

summary.getRange("A10:H10").merge();
summary.getRange("A10").values = [["仍需补齐/确认"]];
summary.getRange("A10:H10").format = { fill:"#9E3D35", font:{ bold:true, color:"#FFFFFF" } };
const incomplete = payload.players.filter((player) => player.resolvedAttributeCount !== payload.coreAttributeKeys.length);
const reviews = payload.players.filter((player) => player.identityReview !== "已映射");
summary.getRange("B11:H11").merge();
summary.getRange("B12:H12").merge();
summary.getRange("B13:H13").merge();
summary.getRange("B14:H14").merge();
summary.getRange("A11:A14").values = [["缺少历史细项"], ["需确认身份"], ["法尔考"], ["数据边界"]];
summary.getRange("B11").values = [[incomplete.map((player) => player.inputName).join("、")]];
summary.getRange("B12").values = [[reviews.map((player) => `${player.inputName}→${player.displayNameZh}`).join("；")]];
summary.getRange("B13").values = [["已按用户确认映射为哥伦比亚前锋 Radamel Falcao"]];
summary.getRange("B14").values = [["来源评级仅作为参考，具体评级与强度由用户调整"]];
summary.getRange("A11:A14").format = { font:{ bold:true, color:"#9E3D35" } };
summary.getRange("B11:H14").format = { wrapText:true };
summary.getRange("A3:H14").format.verticalAlignment = "center";
summary.getRange("A1:H14").format.font.name = "Microsoft YaHei";
summary.getRange("A1:H14").format.autofitRows();
summary.getRange("A:A").format.columnWidth = 16;
summary.getRange("B:B").format.columnWidth = 18;
summary.getRange("C:C").format.columnWidth = 3;
summary.getRange("D:H").format.columnWidth = 16;

const attributeLabels = {
  passing:"传球", firstTouch:"停球", dribbling:"盘带", crossing:"传中", finishing:"射门",
  longShots:"远射", heading:"头球", setPieces:"定位球", tackling:"抢断", marking:"盯人",
  positioning:"站位", vision:"视野", decisions:"决策", composure:"冷静", offBall:"无球",
  discipline:"纪律", pace:"速度", acceleration:"加速", strength:"力量", stamina:"耐力",
  agility:"灵活", jumping:"弹跳", workRate:"投入", aggression:"侵略性", goalkeeping:"守门", reflexes:"反应",
};
const headers = [
  "序号", "名单名称", "中文全名", "英文名", "身份确认", "数据状态", "数据版本", "来源类型",
  "来源 OVR", "调整后 OVR", "评级", "位置池", "主位置", "副位置", "国籍", "俱乐部",
  "身高cm", "年龄", "惯用脚", "逆足", "花式",
  ...payload.coreAttributeKeys.map((key) => attributeLabels[key]),
  "来源 ID", "来源 URL", "数据集 URL", "备注",
];
const rows = payload.players.map((player) => [
  player.order, player.inputName, player.displayNameZh, player.sourceName, player.identityReview,
  player.dataReview, player.sourceVersion, player.sourceType, player.sourceOverall, player.proposedOverall,
  player.proposedGrade, player.pool, player.role, player.secondaryRole, player.nationality, player.club,
  player.heightCm, player.age, player.preferredFoot, player.weakFoot, player.skillMoves,
  ...payload.coreAttributeKeys.map((key) => player.attributes[key]),
  player.sourceId, player.sourceUrl, player.sourceDatasetUrl, player.note,
]);

const lastRow = rows.length + 1;
const lastColumn = headers.length;
const lastColumnLetter = columnLetter(lastColumn);
playersSheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
playersSheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
playersSheet.getRange(`A1:${lastColumnLetter}1`).format = {
  fill:"#17324D",
  font:{ bold:true, color:"#FFFFFF", name:"Microsoft YaHei" },
  wrapText:true,
  horizontalAlignment:"center",
  verticalAlignment:"center",
};
playersSheet.getRange(`A2:${lastColumnLetter}${lastRow}`).format.font.name = "Microsoft YaHei";
playersSheet.getRange(`A1:${lastColumnLetter}${lastRow}`).format.borders = {
  insideHorizontal:{ style:"thin", color:"#E5E7EB" },
  bottom:{ style:"thin", color:"#9CA3AF" },
};
playersSheet.getRange(`A2:A${lastRow}`).format.horizontalAlignment = "center";
playersSheet.getRange(`I2:AU${lastRow}`).format.horizontalAlignment = "center";
playersSheet.getRange(`I2:AU${lastRow}`).format.numberFormat = "0";
playersSheet.getRange(`J2:AU${lastRow}`).format.fill = "#FFF8E1";
playersSheet.getRange(`J1:AU1`).format.fill = "#8A6D1D";
playersSheet.getRange(`A1:${lastColumnLetter}${lastRow}`).format.verticalAlignment = "center";
playersSheet.getRange(`A1:${lastColumnLetter}${lastRow}`).format.autofitRows();
playersSheet.freezePanes.freezeRows(1);
playersSheet.freezePanes.freezeColumns(4);
playersSheet.tables.add(`A1:${lastColumnLetter}${lastRow}`, true, "PlayerDlcReview");
playersSheet.getRange(`K2:K${lastRow}`).dataValidation = { rule:{ type:"list", values:["S", "A", "B", "C", ""] } };
playersSheet.getRange(`J2:J${lastRow}`).dataValidation = { rule:{ type:"whole", operator:"between", formula1:1, formula2:99 } };
playersSheet.getRange(`V2:AU${lastRow}`).dataValidation = { rule:{ type:"whole", operator:"between", formula1:1, formula2:99 } };
playersSheet.getRange(`F2:F${lastRow}`).conditionalFormats.add("containsText", {
  text:"缺少",
  format:{ fill:"#FDE2E1", font:{ color:"#9E3D35", bold:true } },
});
playersSheet.getRange(`E2:E${lastRow}`).conditionalFormats.add("containsText", {
  text:"需确认",
  format:{ fill:"#FFF0C2", font:{ color:"#8A6D1D", bold:true } },
});
playersSheet.getRange(`G2:G${lastRow}`).conditionalFormats.add("containsText", {
  text:"EA SPORTS FC 26",
  format:{ fill:"#DDF4E7", font:{ color:"#176B45" } },
});
playersSheet.getRange(`A:A`).format.columnWidth = 7;
playersSheet.getRange(`B:C`).format.columnWidth = 14;
playersSheet.getRange(`D:D`).format.columnWidth = 22;
playersSheet.getRange(`E:H`).format.columnWidth = 18;
playersSheet.getRange(`I:U`).format.columnWidth = 11;
playersSheet.getRange(`V:AU`).format.columnWidth = 9;
playersSheet.getRange(`AV:AV`).format.columnWidth = 12;
playersSheet.getRange(`AW:AX`).format.columnWidth = 38;
playersSheet.getRange(`AY:AY`).format.columnWidth = 36;
playersSheet.getRange(`AW2:AY${lastRow}`).format.wrapText = true;

sourceSheet.getRange("A1:E1").values = [["优先级", "来源", "用途", "数据版本", "URL"]];
sourceSheet.getRange("A2:E5").values = [
  [1, "EAFC26 official ratings snapshot", "当前仍在官方普通球员库的球员", "EA SPORTS FC 26 / 2025-11-24", "https://www.ea.com/games/ea-sports-fc/ratings"],
  [2, "FIFA 22 historical database archive", "2021 年仍活跃的老将", "FIFA 22", "https://www.kaggle.com/datasets/cashncarry/fifa-22-complete-player-dataset"],
  [3, "FIFA historical database archive", "更早退役或离开主流联赛的球员", "FIFA 11–21 历史快照", "https://www.kaggle.com/datasets/ekrembayar/fifa-21-complete-player-dataset"],
  [4, "project S3 EA-derived profile", "项目已有的 EA 派生 26 项历史数据", "YellowDogs S3 archive", "D:\\Project\\game_test\\backups\\player-data\\S3-player-pool-700-20260725.json"],
];
sourceSheet.getRange("A1:E1").format = { fill:"#17324D", font:{ bold:true, color:"#FFFFFF", name:"Microsoft YaHei" } };
sourceSheet.getRange("A2:E5").format = { font:{ name:"Microsoft YaHei" }, wrapText:true, verticalAlignment:"top" };
sourceSheet.getRange("A1:E5").format.borders = { preset:"outside", style:"thin", color:"#9CA3AF" };
sourceSheet.getRange("A:A").format.columnWidth = 10;
sourceSheet.getRange("B:B").format.columnWidth = 34;
sourceSheet.getRange("C:C").format.columnWidth = 34;
sourceSheet.getRange("D:D").format.columnWidth = 28;
sourceSheet.getRange("E:E").format.columnWidth = 60;
sourceSheet.freezePanes.freezeRows(1);

await fs.mkdir(OUTPUT_DIR, { recursive:true });
const preview = await workbook.render({ sheetName:"说明与汇总", range:"A1:H14", scale:1.5, format:"png" });
await fs.writeFile(PREVIEW, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(OUTPUT);

const inspect = await workbook.inspect({
  kind:"table",
  range:"球员数据!A1:N8",
  include:"values,formulas",
  tableMaxRows:8,
  tableMaxCols:14,
});
const errors = await workbook.inspect({
  kind:"match",
  searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options:{ useRegex:true, maxResults:100 },
  summary:"final formula error scan",
});
console.log(JSON.stringify({ output:OUTPUT, preview:PREVIEW, inspect:inspect.ndjson, errors:errors.ndjson }, null, 2));

function columnLetter(columnNumber) {
  let result = "";
  let value = columnNumber;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
