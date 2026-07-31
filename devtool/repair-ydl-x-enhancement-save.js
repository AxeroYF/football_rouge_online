import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertS4AssetInvariants } from "../versus/s4-assets.js";
import { REAL_PLAYER_BY_ID } from "../versus/player-pool.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const outputIndex = args.indexOf("--output");
const outputArg = outputIndex >= 0 ? args[outputIndex + 1] : null;
const sourceArg = args.find((value, index) => value !== "--write" && value !== "--output" && index !== outputIndex + 1);
if (!sourceArg) throw new Error("用法：node devtool/repair-ydl-x-enhancement-save.js <存档路径> [--write] [--output <输出路径>]");

const sourcePath = path.resolve(sourceArg);
const outputPath = outputArg ? path.resolve(outputArg) : sourcePath;
const state = JSON.parse(readFileSync(sourcePath, "utf8"));
const cards = Object.values(state.s4Assets?.cards ?? {});
const activeFamiliesByOwner = new Map();
cards.filter((card) => card.status === "active").forEach((card) => {
  const families = activeFamiliesByOwner.get(card.ownerId) ?? new Set();
  families.add(card.playerId);
  activeFamiliesByOwner.set(card.ownerId, families);
});

const mismatches = (state.teams ?? []).filter((team) => team.ownerId).map((team) => {
  const activeFamilies = activeFamiliesByOwner.get(team.ownerId) ?? new Set();
  const rosterFamilies = new Set(team.rosterIds ?? []);
  return {
    team,
    rosterOnly:(team.rosterIds ?? []).filter((playerId) => !activeFamilies.has(playerId)),
    cardsOnly:[...activeFamilies].filter((playerId) => !rosterFamilies.has(playerId)),
  };
}).filter(({ rosterOnly, cardsOnly }) => rosterOnly.length || cardsOnly.length);

let invariantError = null;
try { assertS4AssetInvariants(state); }
catch (error) { invariantError = error.message; }

const playerLabel = (playerId) => `${REAL_PLAYER_BY_ID[playerId]?.name ?? "未知球员"}（${playerId}）`;
const mousePlayerIds = Object.values(REAL_PLAYER_BY_ID).filter((player) => player.name === "梅老鼠").map((player) => player.id);
const mouseCards = cards.filter((card) => mousePlayerIds.includes(card.playerId));
const mouseCardIds = new Set(mouseCards.map((card) => card.id));
const mouseEnhancements = (state.ledger ?? []).filter((entry) => entry.type === "s4-card-enhancement" && mouseCardIds.has(entry.materialCardId));
console.log(JSON.stringify({
  sourcePath,
  invariantError,
  mismatches:mismatches.map(({ team, rosterOnly, cardsOnly }) => ({
    teamId:team.id,
    teamName:team.name,
    ownerId:team.ownerId,
    ownerName:team.ownerName,
    rosterOnly:rosterOnly.map(playerLabel),
    cardsOnly:cardsOnly.map(playerLabel),
  })),
  mousePlayerIds,
  mouseCards:mouseCards.map((card) => ({ id:card.id, ownerId:card.ownerId, status:card.status, upgradeLevel:card.upgradeLevel, recycledAt:card.recycledAt, recycleReason:card.recycleReason })),
  mouseEnhancements:mouseEnhancements.slice(-20),
}, null, 2));

if (!write) process.exit(0);
if (!mismatches.length) {
  if (outputPath !== sourcePath) copyFileSync(sourcePath, outputPath);
  console.log(JSON.stringify({ repaired:false, validated:true, sourcePath, outputPath }, null, 2));
  process.exit(0);
}
if (mismatches.some(({ cardsOnly }) => cardsOnly.length)) throw new Error("发现卡片存在但球队名单缺失的复杂冲突，已拒绝自动写入");

for (const { team, rosterOnly } of mismatches) {
  const removed = new Set(rosterOnly);
  team.rosterIds = team.rosterIds.filter((playerId) => !removed.has(playerId));
  team.preferredStarterIds = (team.preferredStarterIds ?? []).filter((playerId) => !removed.has(playerId));
  Object.keys(team.positionPresets ?? {}).forEach((preset) => {
    removed.forEach((playerId) => delete team.positionPresets[preset]?.[playerId]);
  });
  removed.forEach((playerId) => {
    delete team.positions?.[playerId];
    delete team.playerState?.[playerId];
    Object.keys(team.chemistry ?? {}).forEach((key) => {
      if ((team.chemistry[key]?.playerIds ?? []).includes(playerId)) delete team.chemistry[key];
    });
  });
}

assertS4AssetInvariants(state);
const backupPath = outputPath === sourcePath ? `${sourcePath}.repair-backup` : null;
if (backupPath) copyFileSync(sourcePath, backupPath);
writeFileSync(outputPath, JSON.stringify(state, null, 2));
console.log(JSON.stringify({ repaired:true, sourcePath, outputPath, backupPath }, null, 2));
