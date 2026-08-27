import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LeagueShardStore } from "../versus/league-shard-store.js";
import { REAL_PLAYERS, isXPlayer } from "../versus/player-pool.js";
import { repairOfflineAiRoster } from "../offline/ai-roster-repair.js";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function fail(message) {
  throw new Error(message);
}

function clone(value) {
  return structuredClone(value);
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive:true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stableToken(ownerId) {
  return `ydl-offline-${createHash("sha256").update(`YDL-S4-OFFLINE:${ownerId}`).digest("base64url")}`;
}

const source = path.resolve(argument("source") ?? "");
const output = path.resolve(argument("output") ?? "");
const force = process.argv.includes("--force");
if (!source || source === path.parse(source).root || !existsSync(source)) fail("必须提供有效的 --source 数据目录");
if (!output || output === path.parse(output).root) fail("必须提供有效的 --output 数据目录");
if (existsSync(output)) {
  if (!force) fail(`输出目录已经存在：${output}`);
  rmSync(output, { recursive:true, force:true });
}

const sourceShards = path.join(source, "yellowdogs-league-shards");
const sourceStore = new LeagueShardStore(sourceShards, { backupDir:null });
const state = clone(sourceStore.load());
if (!state?.teams?.length) fail("无法从服务器快照加载球队数据");

const importedAt = Date.now();
for (const team of state.teams) {
  if (team.ownerId) continue;
  team.ownerId = `YDL-OFFLINE-${team.id}`;
  team.ownerName = team.ownerName || `${team.name}（本地 AI）`;
  team.joinedAt ??= importedAt;
  state.wallets[team.ownerId] ??= { balance:0 };
}
const repairedOfflineAiTeams = state.teams.filter((team) => repairOfflineAiRoster(team, REAL_PLAYERS.map((player) => ({ ...player, isXPlayer:isXPlayer(player) })))).map((team) => team.name);
const before = {
  teams:state.teams.length,
  matches:state.matches?.length ?? 0,
  archives:state.archives?.length ?? 0,
  ledger:state.ledger?.length ?? 0,
  assetTransactions:state.s4Assets?.transactions?.length ?? 0,
  inboxMessages:Object.values(state.inbox ?? {}).reduce((sum, messages) => sum + (messages?.length ?? 0), 0),
  adminCoinGrants:state.adminCoinGrants?.length ?? 0,
  adminCoinPenalties:state.adminCoinPenalties?.length ?? 0,
  adminXGrowthGrants:state.adminXGrowthGrants?.length ?? 0,
  adminMailBroadcasts:state.adminMailBroadcasts?.length ?? 0,
  mirrorJobs:state.mirrorMarketplace?.batchJobs?.length ?? 0,
  computeNodes:Object.keys(state.mirrorMarketplace?.computeNodes ?? {}).length,
};

const removedLedgerTypes = new Set([
  "admin-player-card-grant",
  "admin-coin-grant",
  "admin-coin-penalty",
  "admin-x-growth-grant",
  "discipline-reward-withheld",
  "admin-team-dissolution-card-recovery",
  "admin-team-dissolution-liquidation",
  "admin-team-dissolution-compensation",
  "director-mirror-worker-service-fee",
  "director-mirror-worker-revenue",
  "compute-node-service-fee",
  "compute-node-revenue",
]);
state.ledger = (state.ledger ?? []).filter((entry) => !removedLedgerTypes.has(entry.type));
for (const team of state.teams) {
  if (!team.ownerId) continue;
  state.ledger.push({
    id:`offline-import-genesis:${team.ownerId}`,
    accountId:team.ownerId,
    amount:0,
    balance:Number(state.wallets?.[team.ownerId]?.balance ?? 0),
    type:"offline-import-genesis",
    teamId:team.id,
    createdAt:importedAt,
  });
}

state.adminPackGrants = [];
state.adminCoinGrants = [];
state.adminCoinPenalties = [];
state.adminXGrowthGrants = [];
state.adminMailBroadcasts = [];
state.discipline = { rewardSuspensions:{}, actions:[], withheldRewards:[] };
state.s4RosterEnforcement = {
  ...(state.s4RosterEnforcement ?? {}),
  audit:[],
  runId:null,
  seed:null,
  appliedAt:null,
};
state.friendlyInvitations = [];
state.friendlyFixtures = [];
state.liveFriendlies = [];
state.lineupShares = {};
state.inbox = {};
state.inboxDeleted = {};
state.reports = {};
state.liveRound = null;
state.liveCupRound = null;
state.liveSeasonFinalRound = null;
state.liveWorldCupRound = null;
state.completedBroadcasts = [];
state.mirrorMarketplace = { uploads:{}, usageByDate:{}, settledDates:[], batchJobs:[], batchReceipts:[], computeNodes:{} };
state.dailyAutomation = {
  enabled:false,
  activatedAt:null,
  initializedDate:new Date(importedAt).toISOString().slice(0, 10),
  lastRewardedSeasonId:state.season?.id ?? null,
  lastResetDate:null,
  lastCupStartDate:null,
  settlements:[],
};
state.matchPredictions = { schemaVersion:1, markets:{}, bets:[], distributions:[] };
if (state.ballonDor?.reconciliation) delete state.ballonDor.reconciliation;
if (state.honorRoom?.reconciliation) delete state.honorRoom.reconciliation;
if (state.s4Assets) {
  state.s4Assets.transactions = [];
  for (const card of Object.values(state.s4Assets.cards ?? {})) {
    if (String(card.acquisitionSource ?? "").startsWith("admin")) card.acquisitionSource = "offline-import";
  }
}
if (state.s4Packs) {
  state.s4Packs.grants = [];
  state.s4Packs.cardGrants = [];
  state.s4Packs.batchOpenings = {};
}
state.offline = {
  schemaVersion:1,
  mode:"ydl-sandbox",
  importedAt,
  sourceSeasonId:state.season?.id ?? null,
  sourceSeasonCompletedAt:state.season?.completedAt ?? null,
  automaticTimePaused:true,
};
state.updatedAt = importedAt;

mkdirSync(output, { recursive:true });
const outputStore = new LeagueShardStore(path.join(output, "yellowdogs-league-shards"), { backupDir:null });
outputStore.save(state, { forceFull:true });

const accounts = {};
for (const team of state.teams) {
  if (!team.ownerId) continue;
  const key = String(team.ownerId).toLowerCase();
  accounts[key] = {
    key,
    id:team.ownerId,
    token:stableToken(team.ownerId),
    nickname:team.ownerName || team.name,
    createdAt:importedAt,
    lastSeenAt:importedAt,
    summary:{ played:0, wins:0, losses:0, goals:0, assists:0 },
    matches:[],
    offlineTeamId:team.id,
  };
}
writeJson(path.join(output, "versus-accounts.json"), { version:5, accounts, lineups:{} });

for (const fileName of ["ydl-content-overrides.json", "ydl-player-card-studio.json"]) {
  const sourceFile = path.join(source, fileName);
  if (!existsSync(sourceFile)) fail(`服务器完整球员库文件缺失：${fileName}`);
  cpSync(sourceFile, path.join(output, fileName));
}

const content = JSON.parse(readFileSync(path.join(output, "ydl-content-overrides.json"), "utf8"));
const studio = JSON.parse(readFileSync(path.join(output, "ydl-player-card-studio.json"), "utf8"));
const reloaded = new LeagueShardStore(path.join(output, "yellowdogs-league-shards"), { backupDir:null }).load();
const after = {
  teams:reloaded.teams.length,
  matches:reloaded.matches?.length ?? 0,
  archives:reloaded.archives?.length ?? 0,
  ledger:reloaded.ledger?.length ?? 0,
  assetTransactions:reloaded.s4Assets?.transactions?.length ?? 0,
  accounts:Object.keys(accounts).length,
  playerOverrides:Object.keys(content.players ?? {}).length,
  traitOverrides:Object.keys(content.traits ?? {}).length,
  traitDrafts:Object.keys(content.traitDrafts ?? {}).length,
  studioDrafts:Object.keys(studio.drafts ?? {}).length,
  studioProfiles:Object.keys(studio.profiles ?? {}).length,
};
if (after.teams !== before.teams || after.matches !== before.matches || after.archives !== before.archives) {
  fail("离线快照重载校验失败：球队、比赛或赛季档案数量发生变化");
}
const report = {
  schemaVersion:1,
  generatedAt:new Date(importedAt).toISOString(),
  sourceLabel:"server-final-backup:data",
  outputLabel:"ydl-offline-seed",
  repairedOfflineAiTeams,
  before,
  after,
  removed:{
    originalAccounts:true,
    passwordHashes:true,
    accountTokens:true,
    accountMatchHistory:true,
    inbox:true,
    adminOperations:true,
    discipline:true,
    friendlies:true,
    liveMatches:true,
    computeMarketplace:true,
    assetTransactionAudit:true,
  },
  preserved:{
    teams:true,
    wallets:true,
    rosters:true,
    cards:true,
    packs:true,
    publicListings:true,
    matches:true,
    archives:true,
    honors:true,
    serverPlayerOverrides:true,
    serverPlayerStudio:true,
  },
};
writeJson(path.join(output, "OFFLINE_MIGRATION_REPORT.json"), report);
console.log(JSON.stringify(report, null, 2));

