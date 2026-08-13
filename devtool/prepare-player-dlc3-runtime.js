import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const INPUT = path.join(ROOT, "player_dlc3", "DLC3球员_S4耦合回归复核版.json");
const OUTPUT = path.join(ROOT, "data", "player-dlc3-s4-final.json");

const source = JSON.parse(await readFile(INPUT, "utf8"));
const players = source.players.map((player) => ({
  inputName: player.input,
  displayNameZh: player.input,
  sourceName: player.nameEn,
  overall: player.targetOverall,
  grade: player.grade,
  pool: player.pool,
  role: player.role,
  secondaryRole: player.secondaryRole || null,
  nationality: player.nationality,
  club: player.peakClub,
  heightCm: player.heightCm,
  age: player.peakAge,
  preferredFoot: player.preferredFoot,
  weakFoot: player.weakFoot ?? null,
  skillMoves: player.skillMoves ?? null,
  attributes: player.attributes,
  source: {
    id: player.source?.sourceId ?? "",
    type: player.source?.type ?? "S4 DLC3 reviewed regression",
    overall: player.source?.overall ?? player.targetOverall,
    url: player.source?.sourceUrl ?? "",
    note: player.note ?? "",
  },
}));

const output = {
  schemaVersion: 1,
  generatedAt: "2026-08-08",
  source: path.relative(ROOT, INPUT).replaceAll("\\", "/"),
  players,
};

await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`已生成 DLC3 运行时数据：${players.length} 人 -> ${OUTPUT}`);
