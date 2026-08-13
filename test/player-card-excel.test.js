import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import { buildPlayerImportWorkbook, parsePlayerImportWorkbook } from "../versus/player-card-excel.js";

test("球员Excel模板可生成并解析总评回归与完整26项能力", async () => {
  const template = await buildPlayerImportWorkbook();
  assert.ok(template.length > 5000);
  const preview = await parsePlayerImportWorkbook(template);
  assert.equal(preview.validRows, 0);
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(template);
  templateWorkbook.getWorksheet("球员导入").addRow(["", "示例球员", "Example Player", 82, "B", "ST", "RW", "示例国籍", "示例俱乐部", 183, "right"]);
  const filledPreview = await parsePlayerImportWorkbook(Buffer.from(await templateWorkbook.xlsx.writeBuffer()));
  assert.equal(filledPreview.validRows, 1);
  assert.equal(filledPreview.rows[0].sourceName, "Example Player");
  assert.equal(filledPreview.rows[0].attributeMode, "regress");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("球员导入");
  const headers = ["球员ID（可留空）", "中文名", "英文名", "游戏总评", "等级", "主位置", "副位置（可留空）", "国籍", "俱乐部", "身高cm", "惯用脚", ...ATTRIBUTE_NAMES];
  sheet.addRow(headers);
  sheet.addRow(["", "批量测试", "Batch Test", 85, "A", "AM", "", "测试国", "测试队", 181, "左脚", ...ATTRIBUTE_NAMES.map((_, index) => 70 + index % 16)]);
  const parsed = await parsePlayerImportWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(parsed.invalidRows, 0);
  assert.equal(parsed.rows[0].attributeMode, "manual");
  assert.equal(Object.keys(parsed.rows[0].attributes).length, 26);
  assert.equal(parsed.rows[0].preferredFoot, "left");
});

test("Excel导入会阻止只填写部分能力值", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("球员导入");
  sheet.addRow(["中文名", "英文名", "游戏总评", "等级", "主位置", "国籍", "俱乐部", "身高cm", "passing"]);
  sheet.addRow(["错误示例", "Broken Example", 80, "B", "ST", "测试国", "测试队", 180, 90]);
  const parsed = await parsePlayerImportWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(parsed.validRows, 0);
  assert.match(parsed.errors[0].errors.join(" "), /只填写了1项/);
});
