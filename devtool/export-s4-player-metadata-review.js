import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_PLAYERS } from "../versus/player-pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(here, "../data/s4-player-metadata-review.csv");
const headers = [
  "id", "name", "pool", "role", "overall", "grade",
  "original_nationality", "original_club", "nationality", "club", "review_status", "notes",
  "database_name", "database_uid", "database_ca", "database_pa", "database_nationality", "database_club",
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const reviewPlayers = REAL_PLAYERS;

const rows = [headers, ...reviewPlayers.map((player) => [
  player.id,
  player.name,
  player.pool,
  player.role,
  player.overall,
  player.grade,
  player.nationality,
  player.club,
  String(player.nationality).includes("未登记") ? "" : player.nationality,
  String(player.club).includes("未登记") || player.club === "传奇球员" ? "" : player.club,
  "待审阅",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
])];

await mkdir(path.dirname(outputPath), { recursive:true });
await writeFile(outputPath, `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, "utf8");
console.log(`${outputPath}\nplayers=${reviewPlayers.length}`);
