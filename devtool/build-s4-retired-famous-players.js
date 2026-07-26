import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BACKUP = path.resolve(ROOT, "..", "..", "backups", "player-data", "S3-player-pool-700-20260725.json");
const OUTPUT = path.join(ROOT, "data", "s4-retired-famous-players-50.json");

const SELECTION = [
  ["Gianluigi Buffon", "布冯"], ["Iker Casillas", "卡西利亚斯"], ["Petr Čech", "切赫"],
  ["Edwin van der Sar", "范德萨"], ["Oliver Kahn", "卡恩"],

  ["Paolo Maldini", "马尔蒂尼"], ["Franco Baresi", "巴雷西"], ["Alessandro Nesta", "内斯塔"],
  ["Fabio Cannavaro", "卡纳瓦罗"], ["Carles Puyol", "普约尔"], ["Rio Ferdinand", "费迪南德"],
  ["John Terry", "特里"], ["Nemanja Vidić", "维迪奇"], ["Philipp Lahm", "拉姆"],
  ["Cafu", "卡福"], ["Javier Zanetti", "萨内蒂"], ["Marcelo", "马塞洛"],
  ["Roberto Carlos", "罗伯特·卡洛斯"], ["Ashley Cole", "阿什利·科尔"], ["Giorgio Chiellini", "基耶利尼"],

  ["Xavi", "哈维"], ["Andrés Iniesta", "伊涅斯塔"], ["Andrea Pirlo", "皮尔洛"],
  ["Paul Scholes", "斯科尔斯"], ["Steven Gerrard", "杰拉德"], ["Frank Lampard", "兰帕德"],
  ["Patrick Vieira", "维埃拉"], ["Claude Makélélé", "马克莱莱"], ["Yaya Touré", "亚亚·图雷"],
  ["Kaká", "卡卡"], ["Luís Figo", "菲戈"], ["Pavel Nedvěd", "内德维德"],
  ["Clarence Seedorf", "西多夫"], ["Juan Román Riquelme", "里克尔梅"], ["Gennaro Gattuso", "加图索"],

  ["Thierry Henry", "亨利"], ["Wayne Rooney", "鲁尼"], ["Didier Drogba", "德罗巴"],
  ["Samuel Eto'o", "埃托奥"], ["Andriy Shevchenko", "舍甫琴科"], ["Zlatan Ibrahimović", "伊布拉希莫维奇"],
  ["Sergio Agüero", "阿圭罗"], ["Fernando Torres", "托雷斯"], ["Gabriel Batistuta", "巴蒂斯图塔"],
  ["Dennis Bergkamp", "博格坎普"], ["Eusébio", "尤西比奥"], ["Marco van Basten", "范巴斯滕"],
  ["Johan Cruyff", "克鲁伊夫"], ["George Best", "乔治·贝斯特"], ["Romário", "罗马里奥"],
];

const IDENTITY_OVERRIDES = {
  "Giorgio Chiellini": { nationality:"意大利", club:"尤文图斯" },
  "Gennaro Gattuso": { nationality:"意大利", club:"AC米兰" },
  "George Best": { nationality:"北爱尔兰", club:"曼联" },
};
const GRADE_TARGETS = {
  GK:{ A:2, B:3 },
  DEF:{ A:5, B:10 },
  MID:{ A:5, B:10 },
  ATT:{ A:5, B:10 },
};

function slug(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const backup = JSON.parse(await fs.readFile(BACKUP, "utf8"));
const oldByName = new Map(backup.players.map((player) => [player.name, player]));
const players = SELECTION.map(([sourceName, oldName]) => {
  const old = oldByName.get(oldName);
  if (!old) throw new Error(`retired player source is missing: ${oldName}`);
  const identity = IDENTITY_OVERRIDES[sourceName] ?? {};
  return {
    id:`s4-retired-${slug(sourceName)}`,
    sourceId:`retired-${slug(sourceName)}`,
    sourceRank:null,
    sourceName,
    displayName:sourceName,
    displayNameZh:"",
    isLegend:false,
    isRetiredFamous:true,
    pool:old.pool,
    role:old.role,
    secondaryRole:old.secondaryRole,
    secondaryRoleSource:"archived YellowDogs League profile",
    sourceMainPosition:old.role,
    sourceAlternativePositions:old.secondaryRole ? [old.secondaryRole] : [],
    referenceOverall:old.overall,
    suggestedOverall:null,
    suggestedGrade:null,
    nationality:identity.nationality ?? old.nationality,
    club:identity.club ?? old.club,
    league:"退役名将",
    heightCm:old.heightCm,
    age:null,
    preferredFoot:old.preferredFoot,
    weakFoot:null,
    skillMoves:null,
    attributes:{ ...old.attributes },
    attributesSchema:"core",
    sourceUrl:"",
    sourceDataset:"Archived YellowDogs League player profile",
    sourceUpdatedAt:backup.createdAt,
    sourceLicense:"project-internal",
    reviewStatus:"待中文名与能力复核",
  };
});

for (const pool of ["GK", "DEF", "MID", "ATT"]) {
  const ranked = players.filter((player) => player.pool === pool)
    .sort((left, right) => right.referenceOverall - left.referenceOverall || left.sourceName.localeCompare(right.sourceName));
  let offset = 0;
  for (const grade of ["A", "B"]) {
    const count = GRADE_TARGETS[pool][grade];
    const maximum = grade === "A" ? 89 : 85;
    const minimum = grade === "A" ? 86 : 80;
    ranked.slice(offset, offset + count).forEach((player, rank) => {
      player.suggestedGrade = grade;
      player.suggestedOverall = count <= 1
        ? maximum
        : Math.round(maximum - rank / (count - 1) * (maximum - minimum));
    });
    offset += count;
  }
}

const countsByPool = Object.fromEntries(["GK", "DEF", "MID", "ATT"].map((pool) => [
  pool,
  players.filter((player) => player.pool === pool).length,
]));
if (players.length !== 50) throw new Error(`retired player list must contain 50 players, received ${players.length}`);
if (new Set(players.map((player) => player.id)).size !== 50) throw new Error("retired player IDs must be unique");
if (JSON.stringify(countsByPool) !== JSON.stringify({ GK:5, DEF:15, MID:15, ATT:15 })) {
  throw new Error(`retired player pool split is invalid: ${JSON.stringify(countsByPool)}`);
}

const output = {
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  sourceBackup:path.relative(ROOT, BACKUP).replaceAll("\\", "/"),
  countsByPool,
  players,
};
await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath:OUTPUT,
  total:players.length,
  countsByPool,
  grades:Object.fromEntries(["A", "B"].map((grade) => [grade, players.filter((player) => player.suggestedGrade === grade).length])),
}, null, 2));
