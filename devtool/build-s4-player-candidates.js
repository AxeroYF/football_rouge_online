import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGEND_PROFILES } from "../game/public/legends.js";
import { REAL_PLAYERS } from "../versus/player-pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../data/sources/eafc26-player-database-20251124/EAFC26-Men.csv");
const jsonOutputPath = path.resolve(here, "../data/s4-player-candidates-500.json");
const csvOutputPath = path.resolve(here, "../data/s4-player-candidates-500.csv");

const SOURCE_URL = "https://www.kaggle.com/datasets/flynn28/eafc26-player-database";
const SOURCE_UPDATED_AT = "2025-11-24";
const SOURCE_LICENSE = "GPL-3.0";
const POOL_TARGETS = Object.freeze({ GK:50, DEF:150, MID:150, ATT:150 });

const LEGEND_SOURCE_ALIASES = new Set([
  "lionelmessi",
  "kylianmbappe",
  "cristianoronaldo",
  "thibautcourtois",
  "erlinghaaland",
  "lukamodric",
  "tonikroos",
  "pele",
  "zinedinezidane",
  "franzbeckenbauer",
  "ronaldo",
  "ronaldinho",
  "diegomaradona",
  "davidbeckham",
]);
const LEGEND_EAFC_NAMES = new Map([
  ["库尔图瓦", "Thibaut Courtois"],
  ["莫德里奇", "Luka Modrić"],
  ["梅西", "Lionel Messi"],
  ["C罗", "Cristiano Ronaldo"],
  ["姆巴佩", "Kylian Mbappé"],
  ["哈兰德", "Erling Haaland"],
]);
const LEGEND_EAFC_BY_ID = new Map([
  ["courtois", "Thibaut Courtois"],
  ["modric", "Luka Modrić"],
  ["messi", "Lionel Messi"],
  ["cristiano-ronaldo", "Cristiano Ronaldo"],
  ["mbappe", "Kylian Mbappé"],
  ["haaland", "Erling Haaland"],
]);

const NORMAL_GRADE_TARGETS = Object.freeze({
  GK: Object.freeze({ A:10, B:20, C:19 }),
  DEF: Object.freeze({ A:30, B:60, C:59 }),
  MID: Object.freeze({ A:30, B:60, C:55 }),
  ATT: Object.freeze({ A:30, B:60, C:53 }),
});

const GRADE_BANDS = Object.freeze({
  A: Object.freeze({ maximum:89, minimum:86 }),
  B: Object.freeze({ maximum:85, minimum:80 }),
  C: Object.freeze({ maximum:79, minimum:75 }),
});

const POSITION_MAP = Object.freeze({
  GK:"GK",
  CB:"CB",
  LB:"LB",
  LWB:"LB",
  RB:"RB",
  RWB:"RB",
  CDM:"DM",
  CM:"AM",
  CAM:"AM",
  LM:"LM",
  RM:"RM",
  ST:"ST",
  LW:"LW",
  RW:"RW",
});

const FALLBACK_SECONDARY_ROLE = Object.freeze({
  CB:"DM",
  LB:"LM",
  RB:"RM",
  DM:"CB",
  AM:"DM",
  LM:"LW",
  RM:"RW",
  ST:"AM",
  LW:"LM",
  RW:"RM",
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted && character === '"' && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift().map((header) => header.replace(/^\ufeff/, ""));
  return rows
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHeight(value) {
  const match = String(value ?? "").match(/(\d{3})\s*cm/i);
  return match ? Number(match[1]) : null;
}

function parseAlternativePositions(value) {
  return String(value ?? "")
    .replace(/[\[\]'"]/g, "")
    .split(",")
    .map((position) => position.trim())
    .filter(Boolean);
}

function poolForRole(role) {
  if (role === "GK") return "GK";
  if (["CB", "LB", "RB"].includes(role)) return "DEF";
  if (["DM", "AM", "LM", "RM"].includes(role)) return "MID";
  if (["ST", "LW", "RW"].includes(role)) return "ATT";
  return null;
}

function mapSourceRole(sourcePosition) {
  return POSITION_MAP[String(sourcePosition ?? "").trim()] ?? null;
}

function preferredFoot(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "left") return "left";
  if (normalized === "right") return "right";
  return "right";
}

function suggestedOverall(grade, gradeIndex, gradeCount) {
  const band = GRADE_BANDS[grade];
  const span = band.maximum - band.minimum + 1;
  return Math.max(
    band.minimum,
    band.maximum - Math.floor((gradeIndex * span) / Math.max(1, gradeCount)),
  );
}

function aggregateAttributes(row) {
  return {
    pace:number(row.PAC),
    shooting:number(row.SHO),
    passing:number(row.PAS),
    dribbling:number(row.DRI),
    defending:number(row.DEF),
    physical:number(row.PHY),
    acceleration:number(row.Acceleration),
    sprintSpeed:number(row["Sprint Speed"]),
    positioning:number(row.Positioning),
    finishing:number(row.Finishing),
    shotPower:number(row["Shot Power"]),
    longShots:number(row["Long Shots"]),
    volleys:number(row.Volleys),
    penalties:number(row.Penalties),
    vision:number(row.Vision),
    crossing:number(row.Crossing),
    freeKickAccuracy:number(row["Free Kick Accuracy"]),
    shortPassing:number(row["Short Passing"]),
    longPassing:number(row["Long Passing"]),
    curve:number(row.Curve),
    agility:number(row.Agility),
    balance:number(row.Balance),
    reactions:number(row.Reactions),
    ballControl:number(row["Ball Control"]),
    composure:number(row.Composure),
    interceptions:number(row.Interceptions),
    headingAccuracy:number(row["Heading Accuracy"]),
    defensiveAwareness:number(row["Def Awareness"]),
    standingTackle:number(row["Standing Tackle"]),
    slidingTackle:number(row["Sliding Tackle"]),
    jumping:number(row.Jumping),
    stamina:number(row.Stamina),
    strength:number(row.Strength),
    aggression:number(row.Aggression),
    goalkeeping:number(row["GK Diving"]),
    goalkeeperDiving:number(row["GK Diving"]),
    goalkeeperHandling:number(row["GK Handling"]),
    goalkeeperKicking:number(row["GK Kicking"]),
    goalkeeperPositioning:number(row["GK Positioning"]),
    goalkeeperReflexes:number(row["GK Reflexes"]),
  };
}

function buildNormalCandidate(row) {
  const role = mapSourceRole(row.Position);
  const pool = poolForRole(role);
  const sourceAlternativePositions = parseAlternativePositions(row["Alternative positions"]);
  const mappedAlternativeRoles = [...new Set(
    sourceAlternativePositions.map(mapSourceRole).filter((candidate) => candidate && candidate !== role),
  )];
  const secondaryRole = mappedAlternativeRoles[0] ?? FALLBACK_SECONDARY_ROLE[role] ?? null;
  return {
    id:`s4-fc26-${row.ID}`,
    sourceId:String(row.ID),
    sourceRank:number(row.Rank),
    sourceName:row.Name,
    displayName:row.Name,
    displayNameZh:"",
    isLegend:false,
    pool,
    role,
    secondaryRole,
    secondaryRoleSource:mappedAlternativeRoles.length ? "FC26 alternative position" : secondaryRole ? "game fallback" : "none",
    sourceMainPosition:row.Position,
    sourceAlternativePositions,
    referenceOverall:number(row.OVR),
    suggestedOverall:null,
    suggestedGrade:null,
    nationality:row.Nation,
    club:row.Team,
    league:row.League,
    heightCm:parseHeight(row.Height),
    weightKg:number(row.Weight),
    age:number(row.Age),
    preferredFoot:preferredFoot(row["Preferred foot"]),
    weakFoot:number(row["Weak foot"]),
    skillMoves:number(row["Skill moves"]),
    attributes:aggregateAttributes(row),
    sourceUrl:row.url || SOURCE_URL,
    sourceDataset:"EAFC26 Player Database",
    sourceUpdatedAt:SOURCE_UPDATED_AT,
    sourceLicense:SOURCE_LICENSE,
    reviewStatus:"待中文名与能力审阅",
  };
}

const sourceRows = parseCsv(await readFile(sourcePath, "utf8"));
const normalCandidates = sourceRows
  .filter((row) => String(row.GENDER).toUpperCase() === "M")
  .filter((row) => !LEGEND_SOURCE_ALIASES.has(normalizeName(row.Name)))
  .map(buildNormalCandidate)
  .filter((player) => player.pool && player.role)
  .filter((player) => player.referenceOverall !== null)
  .filter((player) => player.heightCm !== null && player.heightCm >= 155 && player.heightCm <= 210)
  .filter((player) => player.nationality && player.club)
  .sort((left, right) =>
    right.referenceOverall - left.referenceOverall
    || (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER)
    || left.sourceName.localeCompare(right.sourceName),
  );

const selectedNormals = [];
for (const pool of ["GK", "DEF", "MID", "ATT"]) {
  const poolTarget = Object.values(NORMAL_GRADE_TARGETS[pool]).reduce((sum, count) => sum + count, 0);
  const selected = normalCandidates.filter((player) => player.pool === pool).slice(0, poolTarget);
  if (selected.length !== poolTarget) {
    throw new Error(`${pool} requires ${poolTarget} normal candidates, received ${selected.length}`);
  }
  let offset = 0;
  for (const grade of ["A", "B", "C"]) {
    const count = NORMAL_GRADE_TARGETS[pool][grade];
    selected.slice(offset, offset + count).forEach((player, gradeIndex) => {
      player.suggestedGrade = grade;
      player.suggestedOverall = suggestedOverall(grade, gradeIndex, count);
    });
    offset += count;
  }
  selectedNormals.push(...selected);
}

const currentLegendByName = new Map(
  REAL_PLAYERS.filter((player) => player.legendAbility).map((player) => [player.name, player]),
);
const legendCandidates = LEGEND_PROFILES.map((profile) => {
  const current = currentLegendByName.get(profile.name);
  if (!current) throw new Error(`existing legend is missing from current S4 pool: ${profile.name}`);
  const eafcName = LEGEND_EAFC_BY_ID.get(profile.id) ?? LEGEND_EAFC_NAMES.get(profile.name);
  const eafcRow = eafcName ? sourceRows.find((row) => normalizeName(row.Name) === normalizeName(eafcName)) : null;
  return {
    id:`legend-${profile.id}`,
    sourceId:profile.id,
    sourceRank:null,
    sourceName:profile.name,
    displayName:profile.name,
    displayNameZh:profile.name,
    isLegend:true,
    pool:current.pool,
    role:current.role,
    secondaryRole:current.secondaryRole,
    secondaryRoleSource:"existing legend profile",
    sourceMainPosition:eafcRow?.Position ?? profile.role,
    sourceAlternativePositions:eafcRow
      ? parseAlternativePositions(eafcRow["Alternative positions"])
      : profile.secondaryRole ? [profile.secondaryRole] : [],
    referenceOverall:eafcRow ? number(eafcRow.OVR) : current.overall,
    suggestedOverall:current.overall,
    suggestedGrade:"S",
    nationality:current.nationality,
    club:current.club,
    league:"传奇",
    heightCm:current.heightCm,
    age:null,
    preferredFoot:current.preferredFoot,
    weakFoot:null,
    skillMoves:null,
    attributes:current.attributes,
    eafcReferenceAttributes:eafcRow ? aggregateAttributes(eafcRow) : null,
    sourceUrl:eafcRow?.url ?? "",
    sourceDataset:eafcRow ? "EAFC26 Player Database + Existing YellowDogs League legend" : "Existing YellowDogs League legend",
    sourceUpdatedAt:eafcRow ? SOURCE_UPDATED_AT : "2026-07-26",
    sourceLicense:eafcRow ? SOURCE_LICENSE : "project-internal",
    reviewStatus:eafcRow ? "EAFC26现役数据适配传奇强度" : "强制保留现有传奇",
  };
});

const candidates = [...legendCandidates, ...selectedNormals].sort((left, right) =>
  ["GK", "DEF", "MID", "ATT"].indexOf(left.pool) - ["GK", "DEF", "MID", "ATT"].indexOf(right.pool)
  || Number(right.isLegend) - Number(left.isLegend)
  || right.suggestedOverall - left.suggestedOverall
  || right.referenceOverall - left.referenceOverall
  || left.displayName.localeCompare(right.displayName),
);

const countsByPool = Object.fromEntries(
  ["GK", "DEF", "MID", "ATT"].map((pool) => [pool, candidates.filter((player) => player.pool === pool).length]),
);
const countsByGrade = Object.fromEntries(
  ["S", "A", "B", "C"].map((grade) => [grade, candidates.filter((player) => player.suggestedGrade === grade).length]),
);

if (candidates.length !== 500) throw new Error(`candidate database must contain 500 players, received ${candidates.length}`);
if (new Set(candidates.map((player) => player.id)).size !== 500) throw new Error("candidate IDs must be unique");
if (legendCandidates.length !== 14) throw new Error(`candidate database must preserve 14 legends, received ${legendCandidates.length}`);
if (Object.entries(POOL_TARGETS).some(([pool, target]) => countsByPool[pool] !== target)) {
  throw new Error(`position pool targets were not met: ${JSON.stringify({ expected:POOL_TARGETS, actual:countsByPool })}`);
}
if (candidates.some((player) => !player.role || (player.role !== "GK" && !player.secondaryRole))) {
  throw new Error("every outfield candidate must have a primary and secondary role");
}
if (candidates.some((player) => !Number.isFinite(player.referenceOverall))) {
  throw new Error("every candidate must have a reference overall");
}

const payload = {
  schemaVersion:1,
  label:"S4 500-player rebuild candidates",
  generatedAt:new Date().toISOString(),
  source:{
    name:"EAFC26 Player Database",
    url:SOURCE_URL,
    updatedAt:SOURCE_UPDATED_AT,
    license:SOURCE_LICENSE,
    rawFile:"data/sources/eafc26-player-database-20251124/EAFC26-Men.csv",
  },
  selection:{
    total:500,
    legends:14,
    normalPlayers:486,
    poolTargets:POOL_TARGETS,
    countsByPool,
    countsByGrade,
    rule:"Preserve all 14 existing legends; select highest-reference-overall eligible male players in each positional pool; exclude active-source duplicates of fixed legends.",
  },
  players:candidates,
};

const csvHeaders = [
  "id", "display_name", "display_name_zh", "is_legend", "pool", "primary_role", "secondary_role", "secondary_role_source",
  "source_main_position", "source_alternative_positions", "reference_overall", "suggested_overall", "suggested_grade",
  "nationality", "club", "league", "height_cm", "age", "preferred_foot", "weak_foot", "skill_moves",
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "source_id", "source_rank", "source_url", "review_status",
];
const csvRows = candidates.map((player) => [
  player.id,
  player.displayName,
  player.displayNameZh,
  player.isLegend,
  player.pool,
  player.role,
  player.secondaryRole ?? "",
  player.secondaryRoleSource,
  player.sourceMainPosition,
  player.sourceAlternativePositions,
  player.referenceOverall,
  player.suggestedOverall,
  player.suggestedGrade,
  player.nationality,
  player.club,
  player.league,
  player.heightCm,
  player.age ?? "",
  player.preferredFoot,
  player.weakFoot ?? "",
  player.skillMoves ?? "",
  player.attributes.pace ?? "",
  player.attributes.shooting ?? "",
  player.attributes.passing ?? "",
  player.attributes.dribbling ?? "",
  player.attributes.defending ?? "",
  player.attributes.physical ?? "",
  player.sourceId,
  player.sourceRank ?? "",
  player.sourceUrl,
  player.reviewStatus,
]);

await writeFile(jsonOutputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile(
  csvOutputPath,
  `\ufeff${[csvHeaders, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`,
  "utf8",
);

console.log(JSON.stringify({
  jsonOutputPath,
  csvOutputPath,
  total:candidates.length,
  legends:legendCandidates.length,
  countsByPool,
  countsByGrade,
}, null, 2));
