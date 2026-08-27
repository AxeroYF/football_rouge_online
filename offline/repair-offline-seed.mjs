import path from "node:path";
import { LeagueShardStore } from "../versus/league-shard-store.js";
import { REAL_PLAYERS, REAL_PLAYER_BY_ID, isXPlayer } from "../versus/player-pool.js";
import { repairOfflineAiRoster } from "./ai-roster-repair.js";
import { createS4Card } from "../versus/s4-assets.js";
import { isS4Legend } from "../versus/player-pool.js";

const root = path.resolve(process.argv[2] ?? "");
if (!root) throw new Error("seed root required");
const store = new LeagueShardStore(path.join(root, "yellowdogs-league-shards"), { backupDir:null });
const state = store.load();
const players = REAL_PLAYERS.map((player) => ({ ...player, isXPlayer:isXPlayer(player) }));
const repairedTeams = state.teams.filter((team) => repairOfflineAiRoster(team, players));
const repaired = repairedTeams.map((team) => team.name);
let cardsCreated = 0;
for (const team of state.teams) {
  for (const playerId of team.rosterIds ?? []) {
    if (Object.values(state.s4Assets.cards ?? {}).some((card) => card.status !== "recycled" && card.ownerId === team.ownerId && card.playerId === playerId)) continue;
    const currentOwner = state.s4Assets?.ownerships?.[playerId];
    createS4Card(state, {
      playerId,
      ownerId:team.ownerId,
      grantOwnership:!isS4Legend(REAL_PLAYER_BY_ID[playerId]) && (!currentOwner || currentOwner === team.ownerId),
      externalAcquisition:Boolean(currentOwner && currentOwner !== team.ownerId),
      upgradeLevel:5,
      acquisitionSource:"offline-ai-roster-repair",
      acquiredAt:Date.now(),
    });
    cardsCreated += 1;
  }
}
if (repaired.length || cardsCreated) store.save(state, { forceFull:true });
console.log(JSON.stringify({ repaired }));









