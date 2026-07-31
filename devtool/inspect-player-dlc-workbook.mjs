import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const input = path.join(root, "outputs", "player-dlc-review-20260731", "球员DLC-EA数据与26项属性审阅.xlsx");
const output = path.join(root, "outputs", "player-dlc-review-20260731", "edited-workbook-extract.json");
const preview = path.join(root, "outputs", "player-dlc-review-20260731", "edited-workbook-preview.png");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const sheet = workbook.worksheets.getItem("球员数据");
const used = sheet.getUsedRange();
const values = used.values;
const formulas = used.formulas;
const styles = await workbook.inspect({
  kind:"computedStyle",
  sheetId:"球员数据",
  range:"A1:AY8",
  maxChars:12000,
});
const image = await workbook.render({ sheetName:"球员数据", range:"A1:AY12", scale:1, format:"png" });
await fs.writeFile(preview, new Uint8Array(await image.arrayBuffer()));
await fs.writeFile(output, `${JSON.stringify({ values, formulas, styles:styles.ndjson }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  preview,
  rows:values.length,
  columns:values[0]?.length ?? 0,
  headers:values[0],
}, null, 2));
