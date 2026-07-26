import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.resolve(here, "../data/s4-player-metadata-review.csv");
const referencePath = path.resolve(here, "../data/players_database-reference.csv");
const outputPath = path.resolve(here, "../data/s4-player-metadata-merged.csv");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted && character === '"' && next === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; continue; }
    cell += character;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function clean(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s·.()（）,'’_-]/g, "");
}

const records = parseCsv(await readFile(inputPath, "utf8").then(text => text.replace(/^\ufeff/, "")));
const referenceRecords = parseCsv(await readFile(referencePath, "utf8").then(text => text.replace(/^\ufeff/, "")));
const referenceByName = new Map(referenceRecords.map(record => [clean(record.database_name), record]));
let matched = 0;
let ambiguous = 0;
for (const record of records) {
  const databaseName = clean(record.database_name);
  if (!databaseName) continue;
  const databaseRecord = referenceByName.get(databaseName);
  if (!databaseRecord) { ambiguous += 1; continue; }
  matched += 1;
  record.database_uid ||= databaseRecord.database_uid;
  record.database_ca ||= databaseRecord.database_ca;
  record.database_pa ||= databaseRecord.database_pa;
  record.database_nationality ||= databaseRecord.database_nationality;
  record.database_club ||= databaseRecord.database_club;
  record.nationality ||= databaseRecord.database_nationality;
  record.club ||= databaseRecord.database_club;
  record.review_status = "数据库已匹配，待人工审阅";
}
const headers = Object.keys(records[0] ?? {});
const output = [headers, ...records.map(record => headers.map(header => record[header]))]
  .map(row => row.map(csvCell).join(",")).join("\r\n");
await writeFile(outputPath, `\ufeff${output}\r\n`, "utf8");
console.log(`${outputPath}\nrecords=${records.length}\nmatched=${matched}\nunmatchedDatabaseNames=${ambiguous}`);
