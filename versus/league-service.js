import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { advanceVersusMatch, createVersusMatch, drawVersusReferee, drawVersusWeather, publicMatch, REGULAR_DURATION_MS, HALFTIME_ADJUSTMENT_MS } from "./match-engine.js";
import { hydrateHistoricalMatchDetail } from "./history-detail.js";
import { REAL_PLAYER_BY_ID, REAL_PLAYER_POOLS, REAL_PLAYERS } from "./player-pool.js";
import { analyzeElevenFormation, drawUniquePlayers, inferElevenBoardRoles, sanitizePositions } from "./rules.js";
import { roleGroup } from "../game/public/schema.js";

const DEFAULT_STATE_PATH = process.env.YELLOWDOGS_LEAGUE_PATH
  ? path.resolve(process.env.YELLOWDOGS_LEAGUE_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/yellowdogs-league.json");
const TEAM_COUNT = 10;
const DRAFT_ROSTER_SIZE = 22;
const CLUB_ROSTER_LIMIT = 33;
const PACK_TIERS = Object.freeze({
  standard:Object.freeze({ id:"standard", name:"基础卡包", price:2500, guaranteeGrades:[], guarantee:"随机品质" }),
  advanced:Object.freeze({ id:"advanced", name:"进阶卡包", price:3500, guaranteeGrades:["S", "A", "B"], guarantee:"至少1名B级以上" }),
  elite:Object.freeze({ id:"elite", name:"精英卡包", price:5000, guaranteeGrades:["S", "A"], guarantee:"至少1名A级以上" }),
});
const BACKUP_RETENTION_DAYS = 7;
const ROUND_INTERVAL_MS = 20 * 60 * 1000;
const ACTIVE_START_HOUR = 10;
const ACTIVE_END_HOUR = 22;
const LEAGUE_FITNESS_DRAIN_FACTOR = 0.36;
const CHEMISTRY_GAIN_PER_MATCH = 6;
const CHEMISTRY_VISIBLE_THRESHOLD = 30;
const CHEMISTRY_MAX_BONUS = 0.015;
const INITIAL_WALLET_BALANCE = 10000;
const DEFAULT_FITNESS_THRESHOLD = 65;
const REWARD_MULTIPLIER = 5;
const CHAMPION_BADGE_SEASONS = Object.freeze(["S0", "S1", "S2"]);
const rewardPackCount = (roundNumber) => roundNumber % 3 === 0 ? 2 : 1;
const TEAM_NAMES = ["上海海港", "上海申花", "北京国安", "山东泰山", "成都蓉城", "天津津门虎", "浙江队", "河南队", "武汉三镇", "深圳新鹏城"];
const TACTICS = new Set(["allOutAttack", "positive", "balanced", "defensive", "parkBus"]);
const STYLES = new Set(["possession", "longBall", "wingPlay", "counterAttack", "highPress", "lowBlock", "roughPlay"]);
const FOCUSES = new Set(["balanced", "left", "center", "right"]);

const clone = (value) => structuredClone(value);
const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const playerSummary = (player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, pool:player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club, heightCm:player.heightCm, preferredFoot:player.preferredFoot, attributes:clone(player.attributes ?? {}) });
const publicPackTier = (tier) => ({ id:tier.id, name:tier.name, price:tier.price, guarantee:tier.guarantee });

function makeId(prefix, value) {
  return `${prefix}-${String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(-28)}-${Date.now().toString(36)}`;
}

function roundRobin(teamIds) {
  const rotation = [...teamIds];
  const firstHalf = [];
  for (let round = 0; round < rotation.length - 1; round += 1) {
    const fixtures = [];
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      fixtures.push({ homeId:round % 2 === 0 ? left : right, awayId:round % 2 === 0 ? right : left, matchId:null });
    }
    firstHalf.push(fixtures);
    rotation.splice(1, 0, rotation.pop());
  }
  return [...firstHalf, ...firstHalf.map((fixtures) => fixtures.map((fixture) => ({ homeId:fixture.awayId, awayId:fixture.homeId, matchId:null })))]
    .map((fixtures, index) => ({ number:index + 1, status:"pending", fixtures }));
}

function freshTable() {
  return { played:0, won:0, drawn:0, lost:0, goalsFor:0, goalsAgainst:0, points:0 };
}

function initialTeam(index) {
  return {
    id:`ydl-team-${index + 1}`,
    name:TEAM_NAMES[index],
    ownerId:null,
    ownerName:null,
    joinedAt:null,
    rosterIds:[],
    preferredStarterIds:[],
    positions:{},
    tactic:["positive", "balanced", "defensive", "balanced", "allOutAttack"][index % 5],
    style:["possession", "wingPlay", "counterAttack", "highPress", "longBall", "lowBlock"][index % 6],
    attackFocus:["balanced", "left", "center", "right"][index % 4],
    defenseFocus:"balanced",
    fitnessThreshold:DEFAULT_FITNESS_THRESHOLD,
    tacticalPlans:{
      opening:{ tactic:["positive", "balanced", "defensive", "balanced", "allOutAttack"][index % 5], style:["possession", "wingPlay", "counterAttack", "highPress", "longBall", "lowBlock"][index % 6] },
      leading:{ tactic:"defensive", style:"counterAttack" },
      trailing:{ tactic:"positive", style:"highPress" },
    },
    playerState:{},
    chemistry:{},
    championBadges:[],
    table:freshTable(),
    form:[],
  };
}

function createState(now) {
  const teams = Array.from({ length:TEAM_COUNT }, (_, index) => initialTeam(index));
  return {
    version:1,
    season:{ id:`S1-${localDateKey(new Date(now))}`, name:"S1", date:localDateKey(new Date(now)), status:"active", currentRound:0, totalRounds:18, nextRoundAt:null, startedAt:now, completedAt:null },
    teams,
    rounds:roundRobin(teams.map((team) => team.id)),
    matches:[],
    playerStats:{},
    drafts:{},
    wallets:{},
    ledger:[],
    listings:[],
    reports:{},
    inbox:{},
    inboxDeleted:{},
    shopOffers:{},
    rewardOffers:{},
    adminPackGrants:[],
    liveRound:null,
    archives:[],
    updatedAt:now,
  };
}

function nextSlot(now) {
  const date = new Date(now);
  const start = new Date(date); start.setHours(ACTIVE_START_HOUR, 0, 0, 0);
  const end = new Date(date); end.setHours(ACTIVE_END_HOUR, 0, 0, 0);
  if (date < start) return start.getTime();
  if (date >= end) { start.setDate(start.getDate() + 1); return start.getTime(); }
  const elapsed = date.getTime() - start.getTime();
  return start.getTime() + (Math.floor(elapsed / ROUND_INTERVAL_MS) + 1) * ROUND_INTERVAL_MS;
}

function activeTime(now) {
  const date = new Date(now);
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= ACTIVE_START_HOUR * 60 && minutes <= ACTIVE_END_HOUR * 60;
}

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  if (existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak`);
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2), "utf8");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  renameSync(temporary, filePath);
}

function loadState(filePath, now) {
  if (!filePath || !existsSync(filePath)) return createState(now);
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      const state = JSON.parse(readFileSync(candidate, "utf8"));
      if (state?.version === 1 && state?.teams?.length === TEAM_COUNT) return state;
    } catch { /* 尝试备份文件 */ }
  }
  throw new Error("YellowDogs League 存档损坏，主文件和备份均无法读取");
}

function minimumPrice(player) {
  const base = { S:9000, A:4500, B:1800, C:800 }[player.grade] ?? 800;
  return Math.ceil((base + Math.max(0, player.overall - 75) * 120) / 100) * 100;
}

function minimumListingPrice(player) {
  return Math.ceil(minimumPrice(player) * .8);
}

function chemistryPairKey(firstId, secondId) {
  return [firstId, secondId].sort().join("::");
}

function eligibleChemistryPairs(players, positions) {
  const roles = inferElevenBoardRoles(players.map((player) => ({ id:player.id, position:positions[player.id] })));
  const pairs = [];
  for (let first = 0; first < players.length; first += 1) {
    for (let second = first + 1; second < players.length; second += 1) {
      const left = players[first];
      const right = players[second];
      const leftPosition = positions[left.id];
      const rightPosition = positions[right.id];
      const group = roleGroup(roles[left.id]);
      if (!leftPosition || !rightPosition || group === "GK" || group !== roleGroup(roles[right.id])) continue;
      const xDistance = Math.abs(leftPosition.x - rightPosition.x);
      const yDistance = Math.abs(leftPosition.y - rightPosition.y);
      if (yDistance > 12 || Math.hypot(xDistance, yDistance) > 36) continue;
      pairs.push({ key:chemistryPairKey(left.id, right.id), playerIds:[left.id, right.id].sort(), group });
    }
  }
  return pairs;
}

function publicChemistryLinks(team, starterIds = team.preferredStarterIds, positions = team.positions) {
  const starters = starterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean);
  const eligibleKeys = new Set(eligibleChemistryPairs(starters, positions).map((pair) => pair.key));
  return Object.entries(team.chemistry ?? {})
    .filter(([key, relation]) => eligibleKeys.has(key) && Number(relation.value ?? 0) >= CHEMISTRY_VISIBLE_THRESHOLD)
    .map(([, relation]) => ({
      playerIds:[...relation.playerIds],
      appearances:Number(relation.appearances ?? 0),
      value:Number(relation.value ?? 0),
      bonus:Number(Math.min(CHEMISTRY_MAX_BONUS, Number(relation.value ?? 0) / 100 * CHEMISTRY_MAX_BONUS).toFixed(4)),
    }))
    .sort((left, right) => right.value - left.value);
}

function removePlayerChemistry(team, playerId) {
  Object.entries(team.chemistry ?? {}).forEach(([key, relation]) => {
    if (relation.playerIds?.includes(playerId)) delete team.chemistry[key];
  });
}

function mostCommon(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), "zh-CN"))[0]?.[0] ?? null;
}

function draftCounts(ids) {
  return ids.reduce((counts, id) => {
    const pool = REAL_PLAYER_BY_ID[id]?.pool;
    if (pool) counts[pool] += 1;
    return counts;
  }, { GK:0, DEF:0, MID:0, ATT:0 });
}

function validDraft(ids) {
  return ids.length === DRAFT_ROSTER_SIZE && new Set(ids).size === DRAFT_ROSTER_SIZE;
}

function seededConditions(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return { weather:drawVersusWeather(rng), referee:drawVersusReferee(rng) };
}

function pickStartingIds(rosterIds) {
  const chosen = [];
  const take = (pool, count) => rosterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter((player) => player?.pool === pool && !chosen.includes(player.id)).sort((a,b) => b.overall - a.overall).slice(0, count).forEach((player) => chosen.push(player.id));
  take("GK", 1); take("DEF", 4); take("MID", 3); take("ATT", 3);
  if (chosen.length < 11) rosterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean).sort((a,b) => b.overall - a.overall).forEach((player) => { if (chosen.length < 11 && !chosen.includes(player.id)) chosen.push(player.id); });
  return chosen;
}

function leagueBoardPositions(players) {
  const slots = [
    { x:50, y:90 },
    { x:18, y:69 }, { x:39, y:69 }, { x:61, y:69 }, { x:82, y:69 },
    { x:24, y:45 }, { x:50, y:45 }, { x:76, y:45 },
    { x:22, y:19 }, { x:50, y:19 }, { x:78, y:19 },
  ];
  return Object.fromEntries(players.slice(0, 11).map((player, index) => [player.id, slots[index]]));
}

function playerRoleFit(player, assignedRole) {
  if (player.role === assignedRole) return 4;
  if (player.secondaryRole === assignedRole) return 3;
  if ((assignedRole === "LWB" && [player.role, player.secondaryRole].includes("LB")) || (assignedRole === "RWB" && [player.role, player.secondaryRole].includes("RB"))) return 3;
  return roleGroup(player.role) === roleGroup(assignedRole) ? 2 : 0;
}

function removeRosterPlayerPreservingShape(team, playerId) {
  const wasStarter = team.preferredStarterIds.includes(playerId);
  const vacatedPosition = team.positions[playerId] ? { ...team.positions[playerId] } : null;
  const roles = inferElevenBoardRoles(team.preferredStarterIds.map((id) => ({ id, position:team.positions[id] })));
  const assignedRole = roles[playerId] ?? REAL_PLAYER_BY_ID[playerId]?.role;
  team.rosterIds = team.rosterIds.filter((id) => id !== playerId);
  team.preferredStarterIds = team.preferredStarterIds.filter((id) => id !== playerId);
  delete team.positions[playerId];
  if (!wasStarter) return;
  const replacement = team.rosterIds
    .filter((id) => !team.preferredStarterIds.includes(id))
    .map((id) => REAL_PLAYER_BY_ID[id])
    .filter(Boolean)
    .sort((left, right) => playerRoleFit(right, assignedRole) - playerRoleFit(left, assignedRole) || right.overall - left.overall)[0];
  if (!replacement) return;
  team.preferredStarterIds.push(replacement.id);
  team.positions[replacement.id] = vacatedPosition ?? { x:50, y:50 };
}

function aiLineup(teamIndex, roundNumber, humanOwned) {
  const choose = (pool, count, offset) => {
    const candidates = REAL_PLAYER_POOLS[pool].filter((player) => !humanOwned.has(player.id));
    return Array.from({ length:count }, (_, index) => candidates[(offset + index * 7) % candidates.length]);
  };
  const offset = teamIndex * 13 + roundNumber * 5;
  return [...choose("GK", 1, offset), ...choose("DEF", 4, offset + 3), ...choose("MID", 3, offset + 6), ...choose("ATT", 3, offset + 9)];
}

function publicTeam(team, includeRoster = false) {
  return {
    id:team.id, name:team.name, isAi:!team.ownerId, ownerId:team.ownerId, ownerName:team.ownerName, championBadges:clone(team.championBadges ?? []), table:{ ...team.table }, form:[...team.form], tactic:team.tactic, style:team.style, attackFocus:team.attackFocus, defenseFocus:team.defenseFocus,
    fitnessThreshold:team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD,
    tacticalPlans:clone(team.tacticalPlans ?? { opening:{ tactic:team.tactic, style:team.style }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"highPress" } }),
    roster:includeRoster ? team.rosterIds.map((id) => ({ ...playerSummary(REAL_PLAYER_BY_ID[id]), state:{ fitness:100, suspension:0, injuryRounds:0, ...(team.playerState[id] ?? {}) }, starter:team.preferredStarterIds.includes(id), listed:false })) : undefined,
    positions:includeRoster ? { ...team.positions } : undefined,
    chemistryLinks:includeRoster ? publicChemistryLinks(team) : undefined,
    formation:team.preferredStarterIds.length === 11 ? analyzeElevenFormation(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]), team.positions).name : null,
  };
}

export class YellowDogsLeagueService {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.rng = options.rng ?? Math.random;
    this.statePath = options.statePath === undefined ? DEFAULT_STATE_PATH : options.statePath;
    this.backupDir = options.backupDir === undefined && this.statePath
      ? path.join(path.dirname(this.statePath), "yellowdogs-league-backups")
      : options.backupDir;
    this.lastBackupMaintenanceDate = null;
    this.state = loadState(this.statePath, this.now());
    this.state.shopOffers ??= {};
    this.state.rewardOffers ??= {};
    this.state.adminPackGrants ??= [];
    this.state.liveRound ??= null;
    this.state.reports ??= {};
    this.state.inbox ??= {};
    this.state.inboxDeleted ??= {};
    this.state.teams.forEach((team) => {
      team.chemistry ??= {};
      team.championBadges ??= [];
      team.fitnessThreshold = Math.max(45, Math.min(90, Number(team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD)));
      team.tacticalPlans ??= { opening:{ tactic:team.tactic, style:team.style }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"highPress" } };
    });
    if (!this.state.season.nextRoundAt || this.state.season.nextRoundAt < this.now()) this.state.season.nextRoundAt = nextSlot(this.now());
  }

  backupFile(name) {
    if (!this.statePath || !this.backupDir || !existsSync(this.statePath)) return null;
    mkdirSync(this.backupDir, { recursive:true });
    const target = path.join(this.backupDir, name);
    if (!existsSync(target)) copyFileSync(this.statePath, target);
    return target;
  }

  maintainBackups() {
    if (!this.backupDir) return [];
    const date = localDateKey(new Date(this.now()));
    const dailyName = `${date}.json`;
    if (this.lastBackupMaintenanceDate === date && existsSync(path.join(this.backupDir, dailyName))) {
      return readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort();
    }
    this.backupFile(dailyName);
    if (!existsSync(this.backupDir)) return [];
    const cutoff = new Date(this.now());
    cutoff.setDate(cutoff.getDate() - (BACKUP_RETENTION_DAYS - 1));
    const cutoffKey = localDateKey(cutoff);
    for (const name of readdirSync(this.backupDir)) {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (match && match[1] < cutoffKey) unlinkSync(path.join(this.backupDir, name));
    }
    this.lastBackupMaintenanceDate = date;
    return readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort();
  }

  save(options = {}) {
    this.state.updatedAt = this.now();
    if (this.statePath) {
      atomicWrite(this.statePath, this.state);
      if (!options.skipDailyBackup) this.maintainBackups();
    }
  }

  ownedPlayerIds(exceptAccountId = null) {
    return new Set(this.state.teams.filter((team) => team.ownerId && team.ownerId !== exceptAccountId).flatMap((team) => team.rosterIds));
  }

  reservedPlayerIds(exceptAccountId = null) {
    return new Set([
      ...Object.entries(this.state.drafts).filter(([accountId]) => accountId !== exceptAccountId).flatMap(([, draft]) => draft.selectedIds),
      ...Object.entries(this.state.shopOffers).filter(([accountId]) => accountId !== exceptAccountId).flatMap(([, offer]) => offer.playerIds ?? []),
      ...Object.entries(this.state.rewardOffers).filter(([accountId]) => accountId !== exceptAccountId).flatMap(([, offers]) => (offers ?? []).flatMap((offer) => offer.playerIds ?? [])),
    ]);
  }

  unavailablePlayerIds(exceptAccountId = null) {
    return new Set([...this.ownedPlayerIds(exceptAccountId), ...this.reservedPlayerIds(exceptAccountId)]);
  }

  accountTeam(accountId) {
    return this.state.teams.find((team) => team.ownerId === accountId) ?? null;
  }

  wallet(accountId) {
    if (!this.state.wallets[accountId]) this.state.wallets[accountId] = { balance:INITIAL_WALLET_BALANCE };
    return this.state.wallets[accountId];
  }

  pushInbox(team, message) {
    if (!team?.ownerId) return null;
    const inbox = this.state.inbox[team.id] ?? (this.state.inbox[team.id] = []);
    const deletedIds = new Set(this.state.inboxDeleted[team.id] ?? []);
    const messageId = message.id ?? makeId("mail", `${team.id}-${message.type}`);
    if (deletedIds.has(messageId)) return null;
    const entry = {
      id:messageId,
      type:message.type ?? "notice",
      title:String(message.title ?? "联赛通知"),
      summary:String(message.summary ?? ""),
      body:String(message.body ?? ""),
      createdAt:Number(message.createdAt ?? this.now()),
      round:message.round ?? null,
      matchId:message.matchId ?? null,
      report:message.report ? clone(message.report) : null,
      payload:message.payload ? clone(message.payload) : null,
      readAt:null,
    };
    const index = inbox.findIndex((item) => item.id === entry.id);
    if (index >= 0) inbox[index] = entry;
    else inbox.push(entry);
    this.state.inbox[team.id] = inbox.sort((left, right) => left.createdAt - right.createdAt).slice(-120);
    return entry;
  }

  notifyLegendSigning(team, player, source) {
    if (!team?.ownerId || player?.grade !== "S") return;
    this.state.teams.filter((entry) => entry.ownerId && entry.ownerId !== team.ownerId).forEach((recipient) => this.pushInbox(recipient, {
      id:makeId("legend-signing", `${team.id}-${player.id}`),
      type:"notice",
      title:`${team.name}签下传奇球员`,
      summary:`${team.ownerName ?? "玩家"}获得了 ${player.name}（能力 ${player.overall}）。`,
      body:`${team.name}通过${source}签下S级传奇球员 ${player.name}，他的主位置是${player.role}，综合能力为 ${player.overall}。`,
      payload:{ teamId:team.id, teamName:team.name, ownerName:team.ownerName, playerId:player.id, playerName:player.name, overall:player.overall, source },
    }));
  }

  inbox(team) {
    return clone((this.state.inbox[team.id] ?? []).slice().sort((left, right) => right.createdAt - left.createdAt));
  }

  readInbox(account, messageIdValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const message = (this.state.inbox[team.id] ?? []).find((entry) => entry.id === String(messageIdValue ?? ""));
    if (!message) throw new Error("找不到这封邮件");
    if (!message.readAt) {
      message.readAt = this.now();
      this.save();
    }
    return this.view(account);
  }

  deleteInbox(account, messageIdValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const messageId = String(messageIdValue ?? "");
    const inbox = this.state.inbox[team.id] ?? [];
    if (!inbox.some((entry) => entry.id === messageId)) throw new Error("找不到这封邮件");
    this.state.inbox[team.id] = inbox.filter((entry) => entry.id !== messageId);
    const deleted = this.state.inboxDeleted[team.id] ?? (this.state.inboxDeleted[team.id] = []);
    if (!deleted.includes(messageId)) deleted.push(messageId);
    this.state.inboxDeleted[team.id] = deleted.slice(-500);
    this.save();
    return this.view(account);
  }

  view(account, options = {}) {
    const team = this.accountTeam(account.id);
    if (team && this.ensureRewardPacks(account.id)) this.save();
    const draft = this.state.drafts[account.id] ?? null;
    const listingByPlayer = new Map(this.state.listings.filter((item) => item.status === "active").map((item) => [item.playerId, item]));
    const ownTeam = team ? publicTeam(team, true) : null;
    if (ownTeam) ownTeam.roster.forEach((player) => {
      const source = REAL_PLAYER_BY_ID[player.id];
      player.listed = listingByPlayer.has(player.id);
      player.referencePrice = minimumPrice(source);
      player.minimumPrice = minimumListingPrice(source);
      player.releaseValue = Math.floor(minimumPrice(source) * .6);
    });
    return clone({
      season:this.state.season,
      schedule:{ activeHours:"10:00 - 22:00", intervalMinutes:20, serverPause:true },
      teams:this.standings().map((entry) => ({ ...publicTeam(this.state.teams.find((teamEntry) => teamEntry.id === entry.id)), rank:entry.rank })),
      ownTeam,
      draft:draft ? {
        teamId:draft.teamId,
        selectedIds:[...draft.selectedIds],
        selectedPlayers:draft.selectedIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
        counts:draftCounts(draft.selectedIds),
        offerPool:draft.offerPool ?? null,
        offer:(draft.offerIds ?? []).map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
        allowedPools:this.allowedDraftPools(draft),
      } : null,
      aiSlotsRemaining:this.state.teams.filter((entry) => !entry.ownerId && !Object.values(this.state.drafts).some((item) => item.teamId === entry.id)).length,
      wallet:this.wallet(account.id),
      shop:{
        tiers:Object.values(PACK_TIERS).map(publicPackTier),
        offer:this.state.shopOffers[account.id] ? {
          pool:this.state.shopOffers[account.id].pool,
          tier:publicPackTier(PACK_TIERS[this.state.shopOffers[account.id].tierId] ?? PACK_TIERS.standard),
          players:this.state.shopOffers[account.id].playerIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
        } : null,
      },
      leaderboards:this.leaderboards(),
      teamLeaderboards:team ? this.leaderboards(team.id) : { scorers:[], assists:[], ratings:[], saves:[], cards:[] },
      matchRounds:this.matchRounds(),
      recentMatches:this.state.matches.slice().reverse().map((match) => this.matchSummary(match)),
      rewardOffers:(this.state.rewardOffers[account.id] ?? []).map((offer) => {
        const tier = PACK_TIERS[offer.tierId] ?? PACK_TIERS.standard;
        return { ...offer, tierId:tier.id, tier:publicPackTier(tier), players:(offer.playerIds ?? []).map((id) => playerSummary(REAL_PLAYER_BY_ID[id])), playerIds:undefined };
      }),
      listings:this.state.listings.filter((item) => item.status === "active").map((item) => ({ ...item, player:playerSummary(REAL_PLAYER_BY_ID[item.playerId]), sellerTeamName:this.state.teams.find((entry) => entry.id === item.sellerTeamId)?.name ?? "未知球队" })),
      inbox:team ? this.inbox(team) : [],
      inboxUnreadCount:team ? (this.state.inbox[team.id] ?? []).filter((message) => !message.readAt).length : 0,
      report:team ? this.teamReport(team) : null,
      reportHistory:team ? clone((this.state.reports[team.id] ?? []).slice(-7).reverse()) : [],
      developer:Boolean(options.developer),
    });
  }

  standings() {
    return [...this.state.teams].sort((a,b) => b.table.points - a.table.points || (b.table.goalsFor - b.table.goalsAgainst) - (a.table.goalsFor - a.table.goalsAgainst) || b.table.goalsFor - a.table.goalsFor || a.name.localeCompare(b.name, "zh-CN"))
      .map((team, index) => ({ id:team.id, rank:index + 1 }));
  }

  leaderboards(teamId = null) {
    const entries = Object.values(this.state.playerStats).filter((entry) => !teamId || entry.teamId === teamId).map((entry) => ({ ...entry, averageRating:entry.appearances ? Number((entry.ratingTotal / entry.appearances).toFixed(2)) : 0 }));
    const limit = teamId ? CLUB_ROSTER_LIMIT : 20;
    const sort = (field) => [...entries].filter((entry) => entry[field] > 0).sort((a,b) => b[field] - a[field] || b.averageRating - a.averageRating).slice(0, limit);
    return { scorers:sort("goals"), assists:sort("assists"), ratings:[...entries].filter((entry) => entry.appearances >= Math.max(1, Math.ceil(this.state.season.currentRound * .25))).sort((a,b) => b.averageRating - a.averageRating).slice(0,limit), saves:sort("saves"), cards:[...entries].filter((entry) => entry.yellowCards || entry.redCards).sort((a,b) => b.redCards - a.redCards || b.yellowCards - a.yellowCards).slice(0,limit) };
  }

  matchSummary(match) {
    const home = this.state.teams.find((team) => team.id === match.homeId);
    const away = this.state.teams.find((team) => team.id === match.awayId);
    return {
      id:match.id,
      round:match.round,
      playedAt:match.playedAt,
      homeId:match.homeId,
      awayId:match.awayId,
      homeName:home?.name ?? match.homeName ?? "未知球队",
      awayName:away?.name ?? match.awayName ?? "未知球队",
      score:[...(match.score ?? [0, 0])],
      formations:[...(match.formations ?? [])],
      hasPlayerTeam:Boolean(home?.ownerId || away?.ownerId),
      hasDetails:Boolean(match.report),
    };
  }

  matchRounds() {
    const grouped = new Map();
    for (const match of this.state.matches) {
      if (!grouped.has(match.round)) grouped.set(match.round, []);
      grouped.get(match.round).push(this.matchSummary(match));
    }
    return [...grouped.entries()].sort((left, right) => right[0] - left[0]).map(([round, matches]) => ({ round, matches }));
  }

  teamHistory(teamId) {
    return this.state.matches
      .filter((match) => match.homeId === teamId || match.awayId === teamId)
      .sort((left, right) => right.round - left.round || right.playedAt - left.playedAt)
      .map((match) => this.matchSummary(match));
  }

  teamDetail(account, teamIdValue) {
    const team = this.state.teams.find((entry) => entry.id === String(teamIdValue ?? ""));
    if (!team) throw new Error("找不到这支球队");
    const lineup = team.ownerId
      ? team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean)
      : this.actualLineup(team, Math.max(1, this.state.season.currentRound + 1));
    const positions = this.actualPositions(team, lineup);
    const roster = team.ownerId
      ? team.rosterIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id]))
      : lineup.map(playerSummary);
    return clone({
      id:team.id,
      name:team.name,
      isAi:!team.ownerId,
      ownerName:team.ownerName,
      table:{ ...team.table },
      formation:lineup.length === 11 ? analyzeElevenFormation(lineup, positions).name : null,
      starters:lineup.map((player) => ({ ...playerSummary(player), position:{ ...positions[player.id] } })),
      roster,
      history:this.teamHistory(team.id),
      isOwn:team.ownerId === account.id,
    });
  }

  matchDetail(account, matchIdValue) {
    const match = this.state.matches.find((entry) => entry.id === String(matchIdValue ?? ""));
    if (!match?.report) throw new Error("找不到这场比赛的详细记录");
    const ownTeam = this.accountTeam(account.id);
    const viewerIndex = ownTeam?.id === match.awayId ? 1 : 0;
    const detail = hydrateHistoricalMatchDetail({
      ...match.report,
      playedAt:match.playedAt,
      roomCode:`YDL · 第${match.round}轮`,
      round:match.round,
      viewerIndex,
    });
    if (detail.teams?.[0]) detail.teams[0].name = this.state.teams.find((team) => team.id === match.homeId)?.name ?? detail.teams[0].name;
    if (detail.teams?.[1]) detail.teams[1].name = this.state.teams.find((team) => team.id === match.awayId)?.name ?? detail.teams[1].name;
    return clone(detail);
  }

  beginDraft(account, teamNameValue) {
    if (this.accountTeam(account.id)) throw new Error("你已经拥有一支 YellowDogs League 球队");
    if (this.state.drafts[account.id]) return this.view(account);
    const teamName = String(teamNameValue ?? "").trim();
    if (!teamName) throw new Error("球队名称不能为空");
    if (teamName.length > 30) throw new Error("球队名称最多30个字符");
    const normalizedName = teamName.toLocaleLowerCase("zh-CN");
    if (this.state.teams.some((team) => team.name.toLocaleLowerCase("zh-CN") === normalizedName)
      || Object.values(this.state.drafts).some((draft) => draft.teamName.toLocaleLowerCase("zh-CN") === normalizedName)) throw new Error("该球队名称已经被使用");
    const reservedTeamIds = new Set(Object.values(this.state.drafts).map((draft) => draft.teamId));
    const team = this.state.teams.find((entry) => !entry.ownerId && !reservedTeamIds.has(entry.id));
    if (!team) throw new Error("当前10支球队都已由真人接管");
    this.state.drafts[account.id] = { teamId:team.id, teamName, selectedIds:[], offerIds:[], offerPool:null, startedAt:this.now() };
    this.save();
    return this.view(account);
  }

  allowedDraftPools(draft) {
    return draft.selectedIds.length < DRAFT_ROSTER_SIZE ? ["ATT", "MID", "DEF", "GK"] : [];
  }

  drawDraft(account, pool) {
    const draft = this.state.drafts[account.id];
    if (!draft || !REAL_PLAYER_POOLS[pool]) throw new Error("当前没有可用的选秀位置");
    if (draft.offerIds?.length) throw new Error("请先从当前三张卡牌中签下一人");
    if (!this.allowedDraftPools(draft).includes(pool)) throw new Error("注册名单已经选满22人");
    const unavailable = [...this.unavailablePlayerIds(account.id), ...draft.selectedIds];
    const choices = drawUniquePlayers(pool, unavailable, this.rng, 3);
    if (choices.length !== 3) throw new Error("该位置已经没有足够的唯一球员可供翻卡");
    draft.offerPool = pool;
    draft.offerIds = choices.map((player) => player.id);
    this.save();
    return this.view(account);
  }

  chooseDraft(account, playerId) {
    const draft = this.state.drafts[account.id];
    if (!draft?.offerIds?.includes(playerId)) throw new Error("只能选择本次翻开的三张卡牌");
    if (draft.selectedIds.length >= DRAFT_ROSTER_SIZE) throw new Error("建队选秀最多22人");
    if (this.unavailablePlayerIds(account.id).has(playerId)) {
      draft.offerIds = [];
      draft.offerPool = null;
      this.save();
      throw new Error("该球员刚刚被其他真人球队签下，请重新翻卡");
    }
    draft.selectedIds.push(playerId);
    draft.offerIds = [];
    draft.offerPool = null;
    this.save();
    return this.view(account);
  }

  resetDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft) throw new Error("当前没有可重置的选秀");
    draft.selectedIds = [];
    draft.offerIds = [];
    draft.offerPool = null;
    draft.startedAt = this.now();
    this.save();
    return this.view(account);
  }

  autoDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft) throw new Error("当前没有可用的选秀");
    const targets = { GK:2, DEF:8, MID:7, ATT:5 };
    draft.offerIds = [];
    draft.offerPool = null;
    while (draft.selectedIds.length < DRAFT_ROSTER_SIZE) {
      const counts = draftCounts(draft.selectedIds);
      const pool = Object.keys(targets).find((key) => counts[key] < targets[key]) ?? this.allowedDraftPools(draft)[0];
      const unavailable = [...this.unavailablePlayerIds(account.id), ...draft.selectedIds];
      const choices = drawUniquePlayers(pool, unavailable, this.rng, 3);
      if (!choices.length) throw new Error("自动选秀无法补齐阵容");
      choices.sort((a,b) => b.overall - a.overall);
      draft.selectedIds.push(choices[0].id);
    }
    this.save();
    return this.view(account);
  }

  finishDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft || draft.offerIds?.length || !validDraft(draft.selectedIds)) throw new Error("需要完成全部22次三选一");
    if (draft.selectedIds.some((id) => this.unavailablePlayerIds(account.id).has(id))) throw new Error("选秀期间有球员被其他球队签下，请重新选择");
    const team = this.state.teams.find((entry) => entry.id === draft.teamId && !entry.ownerId);
    if (!team) throw new Error("AI球队席位已经不可用");
    const replacedTeamName = team.name;
    const existingPlayerTeams = this.state.teams.filter((entry) => entry.ownerId && entry.ownerId !== account.id);
    const joinRound = Math.min(this.state.season.totalRounds, this.state.season.currentRound + 1);
    team.name = draft.teamName;
    team.ownerId = account.id;
    team.ownerName = account.nickname;
    team.joinedAt = this.now();
    team.rosterIds = [...draft.selectedIds];
    team.preferredStarterIds = pickStartingIds(team.rosterIds);
    team.positions = leagueBoardPositions(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]));
    team.playerState = Object.fromEntries(team.rosterIds.map((id) => [id, { fitness:100, suspension:0, injuryRounds:0 }]));
    delete this.state.drafts[account.id];
    this.wallet(account.id);
    if (this.state.season.currentRound > 0) {
      existingPlayerTeams.forEach((recipient) => this.pushInbox(recipient, {
        id:`league-join:${this.state.season.id}:${account.id}`,
        type:"notice",
        title:`新玩家将于第${joinRound}轮加入联赛`,
        summary:`${team.name}接管了原AI球队${replacedTeamName}的联赛席位。`,
        body:`玩家${account.nickname}创建的${team.name}将于第${joinRound}轮加入联赛，接管原AI球队${replacedTeamName}的席位，并继承该席位此前的战绩和积分。`,
        round:joinRound,
        payload:{ accountId:account.id, ownerName:account.nickname, teamId:team.id, teamName:team.name, replacedTeamName, joinRound },
      }));
    }
    team.rosterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter((player) => player?.grade === "S").forEach((player) => this.notifyLegendSigning(team, player, "建队选秀"));
    this.updateDailyReports();
    this.save();
    return this.view(account);
  }

  saveTeam(account, body) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const starters = [...new Set(body.starterIds ?? [])];
    if (starters.length !== 11 || starters.some((id) => !team.rosterIds.includes(id))) throw new Error("必须从注册名单中选择11名首发");
    const players = starters.map((id) => REAL_PLAYER_BY_ID[id]);
    const positions = sanitizePositions(players, body.positions ?? team.positions);
    const formation = analyzeElevenFormation(players, positions);
    if (!formation.valid) throw new Error(formation.message);
    team.preferredStarterIds = starters;
    team.positions = positions;
    if (TACTICS.has(body.tactic)) team.tactic = body.tactic;
    if (STYLES.has(body.style)) team.style = body.style;
    if (FOCUSES.has(body.attackFocus)) team.attackFocus = body.attackFocus;
    if (FOCUSES.has(body.defenseFocus)) team.defenseFocus = body.defenseFocus;
    const threshold = Number(body.fitnessThreshold);
    if (Number.isFinite(threshold)) team.fitnessThreshold = Math.max(45, Math.min(90, Math.round(threshold / 5) * 5));
    const plans = body.tacticalPlans ?? {};
    team.tacticalPlans = Object.fromEntries(["opening", "leading", "trailing"].map((state) => {
      const fallback = state === "opening" ? { tactic:team.tactic, style:team.style } : team.tacticalPlans?.[state] ?? { tactic:state === "leading" ? "defensive" : "positive", style:state === "leading" ? "counterAttack" : "highPress" };
      return [state, { tactic:TACTICS.has(plans[state]?.tactic) ? plans[state].tactic : fallback.tactic, style:STYLES.has(plans[state]?.style) ? plans[state].style : fallback.style }];
    }));
    team.tactic = team.tacticalPlans.opening.tactic;
    team.style = team.tacticalPlans.opening.style;
    this.save();
    return this.view(account);
  }

  renameTeam(account, nameValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const name = String(nameValue ?? "").trim();
    if (!name) throw new Error("球队名称不能为空");
    if (name.length > 30) throw new Error("球队名称最多30个字符");
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    if (this.state.teams.some((entry) => entry.id !== team.id && entry.name.toLocaleLowerCase("zh-CN") === normalizedName)
      || Object.values(this.state.drafts).some((draft) => draft.teamName.toLocaleLowerCase("zh-CN") === normalizedName)) throw new Error("该球队名称已经被使用");
    team.name = name;
    Object.values(this.state.playerStats).forEach((entry) => { if (entry.teamId === team.id) entry.teamName = name; });
    this.state.listings.forEach((entry) => { if (entry.sellerTeamId === team.id) entry.sellerTeamName = name; });
    (this.state.reports[team.id] ?? []).forEach((report) => { report.teamName = name; });
    this.save();
    return this.view(account);
  }

  buyPack(account, pool, tierId = "standard") {
    const team = this.accountTeam(account.id);
    const tier = PACK_TIERS[tierId];
    if (!team || !REAL_PLAYER_POOLS[pool]) throw new Error("请选择有效的位置卡包");
    if (!tier) throw new Error("请选择有效的卡包档位");
    if (this.state.shopOffers[account.id]) return this.view(account);
    if (team.rosterIds.length >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，请先出售或解约一名球员");
    const wallet = this.wallet(account.id);
    if (wallet.balance < tier.price) throw new Error("金币不足");
    const unavailable = [...this.unavailablePlayerIds(account.id), ...team.rosterIds];
    const guaranteedCandidates = tier.guaranteeGrades.length
      ? REAL_PLAYER_POOLS[pool].filter((player) => tier.guaranteeGrades.includes(player.grade) && !unavailable.includes(player.id))
      : [];
    if (tier.guaranteeGrades.length && !guaranteedCandidates.length) throw new Error("该位置暂时没有符合保底品质的唯一球员");
    const guaranteed = guaranteedCandidates.length ? guaranteedCandidates[Math.floor(this.rng() * guaranteedCandidates.length)] : null;
    const choices = drawUniquePlayers(pool, unavailable, this.rng, 3, guaranteed ? [guaranteed] : []);
    if (choices.length !== 3) throw new Error("该位置暂时没有足够的唯一球员可供开包");
    wallet.balance -= tier.price;
    this.state.shopOffers[account.id] = { pool, tierId:tier.id, playerIds:choices.map((player) => player.id), purchasedAt:this.now() };
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-pack`), accountId:account.id, amount:-tier.price, type:"pack-buy", pool, tierId:tier.id, createdAt:this.now() });
    this.save();
    return this.view(account);
  }

  choosePack(account, playerId) {
    const team = this.accountTeam(account.id);
    const offer = this.state.shopOffers[account.id];
    if (!team || !offer?.playerIds.includes(playerId)) throw new Error("只能选择当前卡包中的球员");
    if (team.rosterIds.length >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，请先腾出一个位置");
    if (this.unavailablePlayerIds(account.id).has(playerId)) throw new Error("该球员已经被其他玩家签下");
    team.rosterIds.push(playerId);
    team.playerState[playerId] = { fitness:100, suspension:0, injuryRounds:0 };
    delete this.state.shopOffers[account.id];
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-${playerId}`), accountId:account.id, amount:0, type:"pack-sign", playerId, tierId:offer.tierId ?? "standard", createdAt:this.now() });
    this.notifyLegendSigning(team, REAL_PLAYER_BY_ID[playerId], "球员商店卡包");
    this.save();
    return this.view(account);
  }

  listPlayer(account, playerId, priceValue) {
    const team = this.accountTeam(account.id);
    const player = REAL_PLAYER_BY_ID[playerId];
    const price = Math.floor(Number(priceValue));
    if (!team?.rosterIds.includes(playerId) || !player) throw new Error("球员不在你的注册名单中");
    if (!Number.isFinite(price) || price < minimumListingPrice(player)) throw new Error(`挂牌价不能低于参考身价的80%（${minimumListingPrice(player)}金币）`);
    if (this.state.listings.some((item) => item.status === "active" && item.playerId === playerId)) throw new Error("球员已经挂牌");
    this.state.listings.push({ id:makeId("listing", playerId), playerId, sellerId:account.id, sellerTeamId:team.id, price, status:"active", createdAt:this.now() });
    this.save();
    return this.view(account);
  }

  cancelListing(account, listingId) {
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (!listing || listing.sellerId !== account.id) throw new Error("找不到你的这笔挂牌");
    listing.status = "cancelled";
    listing.closedAt = this.now();
    this.save();
    return this.view(account);
  }

  releasePlayer(account, playerId) {
    const team = this.accountTeam(account.id);
    const player = REAL_PLAYER_BY_ID[playerId];
    if (!team?.rosterIds.includes(playerId) || team.rosterIds.length <= 11) throw new Error("不能解约该球员");
    if (this.state.listings.some((item) => item.status === "active" && item.playerId === playerId)) throw new Error("请先撤回球员挂牌");
    removeRosterPlayerPreservingShape(team, playerId);
    delete team.playerState[playerId];
    removePlayerChemistry(team, playerId);
    const amount = Math.floor(minimumPrice(player) * .6);
    this.wallet(account.id).balance += amount;
    this.state.ledger.push({ id:makeId("ledger", playerId), accountId:account.id, amount, type:"release", createdAt:this.now() });
    this.save();
    return this.view(account);
  }

  buyListing(account, listingId) {
    const buyer = this.accountTeam(account.id);
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (!buyer || !listing || listing.sellerId === account.id) throw new Error("当前无法购买这名球员");
    const seller = this.state.teams.find((team) => team.id === listing.sellerTeamId && team.ownerId === listing.sellerId);
    if (!seller?.rosterIds.includes(listing.playerId) || seller.rosterIds.length <= 11) throw new Error("卖方必须保留至少11名注册球员");
    if (buyer.rosterIds.length >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，请先解约或出售一名球员");
    if (this.wallet(account.id).balance < listing.price) throw new Error("金币不足");
    this.wallet(account.id).balance -= listing.price;
    this.wallet(listing.sellerId).balance += Math.floor(listing.price * .95);
    buyer.rosterIds.push(listing.playerId);
    buyer.playerState[listing.playerId] = seller.playerState[listing.playerId] ?? { fitness:100, suspension:0, injuryRounds:0 };
    removeRosterPlayerPreservingShape(seller, listing.playerId);
    delete seller.playerState[listing.playerId];
    removePlayerChemistry(seller, listing.playerId);
    listing.status = "sold";
    listing.buyerId = account.id;
    listing.closedAt = this.now();
    this.state.ledger.push({ id:makeId("ledger", listing.id), accountId:account.id, amount:-listing.price, type:"transfer-buy", createdAt:this.now() }, { id:makeId("ledger", `${listing.id}-seller`), accountId:listing.sellerId, amount:Math.floor(listing.price * .95), type:"transfer-sale", createdAt:this.now() });
    const player = REAL_PLAYER_BY_ID[listing.playerId];
    this.pushInbox(buyer, {
      id:`transfer-buy:${listing.id}`,
      type:"transfer",
      title:`签下 ${player.name}`,
      summary:`转会费 ${listing.price} 金币，球员已加入注册名单。`,
      body:`${player.name}（能力 ${player.overall}）已从 ${seller.name} 转入球队。新球员需要通过共同比赛逐步建立默契。`,
    });
    this.pushInbox(seller, {
      id:`transfer-sale:${listing.id}`,
      type:"transfer",
      title:`${player.name} 转会完成`,
      summary:`扣除手续费后到账 ${Math.floor(listing.price * .95)} 金币。`,
      body:`${player.name} 已转会至 ${buyer.name}，他在本队积累的默契关系已经清除。`,
    });
    this.save();
    return this.view(account);
  }

  selectActualLineup(team, roundNumber) {
    const humanOwned = this.ownedPlayerIds();
    if (!team.ownerId) return { lineup:aiLineup(this.state.teams.indexOf(team), roundNumber, humanOwned), rotations:[] };
    const desired = team.preferredStarterIds.filter((id) => team.rosterIds.includes(id));
    const threshold = Number(team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD);
    const hardAvailable = (id) => {
      const state = team.playerState[id] ?? {};
      return Number(state.suspension ?? 0) <= 0 && Number(state.injuryRounds ?? 0) <= 0 && Number(state.fitness ?? 100) >= 45;
    };
    const assignedRoles = inferElevenBoardRoles(desired.map((id) => ({ id, position:team.positions[id] })));
    const selected = [];
    const rotations = [];
    const bench = team.rosterIds.filter((id) => !desired.includes(id) && hardAvailable(id));
    const takeReplacement = (starterId, requireFresh) => {
      const assignedRole = assignedRoles[starterId] ?? REAL_PLAYER_BY_ID[starterId]?.role;
      const candidates = bench
        .filter((id) => !requireFresh || Number(team.playerState[id]?.fitness ?? 100) > threshold)
        .map((id) => REAL_PLAYER_BY_ID[id])
        .filter((player) => player && (!requireFresh || playerRoleFit(player, assignedRole) >= 2))
        .sort((left, right) => playerRoleFit(right, assignedRole) - playerRoleFit(left, assignedRole)
          || Number(team.playerState[right.id]?.fitness ?? 100) - Number(team.playerState[left.id]?.fitness ?? 100)
          || right.overall - left.overall)[0];
      if (!candidates) return null;
      bench.splice(bench.indexOf(candidates.id), 1);
      return candidates.id;
    };
    for (const starterId of desired) {
      const state = team.playerState[starterId] ?? {};
      const fitness = Number(state.fitness ?? 100);
      const forcedOut = !hardAvailable(starterId);
      const atRedLine = !forcedOut && fitness <= threshold;
      const substitute = forcedOut ? takeReplacement(starterId, false) : atRedLine ? takeReplacement(starterId, true) : null;
      if (substitute) {
        selected.push(substitute);
        rotations.push({ outId:starterId, outName:REAL_PLAYER_BY_ID[starterId]?.name, inId:substitute, inName:REAL_PLAYER_BY_ID[substitute]?.name, reason:forcedOut ? (Number(state.suspension ?? 0) > 0 ? "停赛" : Number(state.injuryRounds ?? 0) > 0 ? "伤缺" : "体能不足45") : `体能${Math.round(fitness)}达到红线${threshold}` });
      } else if (!forcedOut) selected.push(starterId);
    }
    while (selected.length < 11 && bench.length) selected.push(bench.shift());
    return {
      lineup:selected.slice(0,11).map((id) => ({ ...REAL_PLAYER_BY_ID[id], state:{ ...REAL_PLAYER_BY_ID[id].state, fitness:team.playerState[id]?.fitness ?? 100 } })),
      rotations,
    };
  }

  actualLineup(team, roundNumber) {
    return this.selectActualLineup(team, roundNumber).lineup;
  }

  actualPositions(team, lineup) {
    const fallback = leagueBoardPositions(lineup);
    if (!team.ownerId) return fallback;
    const lineupIds = new Set(lineup.map((player) => player.id));
    const replacementSlots = team.preferredStarterIds
      .filter((id) => !lineupIds.has(id) && team.positions[id])
      .map((id) => ({ ...team.positions[id] }));
    return Object.fromEntries(lineup.map((player) => [player.id, team.positions[player.id]
      ? { ...team.positions[player.id] }
      : replacementSlots.shift() ?? fallback[player.id]]));
  }

  recordChemistry(team, lineup, positions) {
    if (!team.ownerId) return;
    team.chemistry ??= {};
    eligibleChemistryPairs(lineup, positions).forEach((pair) => {
      const relation = team.chemistry[pair.key] ?? { playerIds:pair.playerIds, appearances:0, value:0 };
      relation.appearances += 1;
      relation.value = Math.min(100, relation.value + CHEMISTRY_GAIN_PER_MATCH);
      relation.updatedAt = this.now();
      team.chemistry[pair.key] = relation;
    });
  }

  chemistryAdjustedLineup(team, lineup, positions) {
    if (!team.ownerId) return lineup;
    const links = publicChemistryLinks(team, lineup.map((player) => player.id), positions);
    const valuesByPlayer = new Map();
    links.forEach((link) => link.playerIds.forEach((id) => {
      const values = valuesByPlayer.get(id) ?? [];
      values.push(link.value);
      valuesByPlayer.set(id, values);
    }));
    return lineup.map((player) => {
      const values = valuesByPlayer.get(player.id) ?? [];
      if (!values.length) return player;
      const chemistry = values.reduce((sum, value) => sum + value, 0) / values.length;
      const bonus = Math.min(CHEMISTRY_MAX_BONUS, chemistry / 100 * CHEMISTRY_MAX_BONUS);
      return {
        ...player,
        attributes:Object.fromEntries(Object.entries(player.attributes).map(([key, value]) => [key, Number.isFinite(value) ? Math.min(99, Number((value * (1 + bonus)).toFixed(2))) : value])),
        leagueChemistryBonus:Number(bonus.toFixed(4)),
      };
    });
  }

  fixtureSeed(fixture, roundNumber) {
    return `${this.state.season.id}:${roundNumber}:${fixture.homeId}:${fixture.awayId}`;
  }

  fixtureConditions(fixture, roundNumber) {
    return seededConditions(this.fixtureSeed(fixture, roundNumber));
  }

  createFixtureMatch(fixture, roundNumber, startedAt = this.now()) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const selections = [home, away].map((team) => this.selectActualLineup(team, roundNumber));
    const lineups = selections.map((selection) => selection.lineup);
    const positions = [home, away].map((team, index) => this.actualPositions(team, lineups[index]));
    const seats = [home, away].map((team, index) => ({ name:team.name, players:this.chemistryAdjustedLineup(team, lineups[index], positions[index]), positions:positions[index], tactic:team.tacticalPlans?.opening?.tactic ?? team.tactic, style:team.tacticalPlans?.opening?.style ?? team.style, tacticalPlans:team.tacticalPlans, attackFocus:team.attackFocus, defenseFocus:team.defenseFocus, preserveFitness:true }));
    const conditions = this.fixtureConditions(fixture, roundNumber);
    const match = createVersusMatch(seats, { now:startedAt, seed:this.fixtureSeed(fixture, roundNumber), weather:conditions.weather.key, referee:conditions.referee.key, regulationOnly:true, competitionMode:"league" });
    match.leagueAutoRotations = selections.map((selection) => selection.rotations);
    return { home, away, match, startedAt };
  }

  finalizeFixture(fixture, roundNumber, match) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const report = match.report;
    const id = `${this.state.season.id}-R${roundNumber}-${home.id}-${away.id}`;
    const record = { id, round:roundNumber, playedAt:this.now(), homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name, score:[...report.score], formations:report.teams.map((team) => team.formation), autoRotations:clone(match.leagueAutoRotations ?? [[], []]), report };
    this.state.matches.push(record);
    fixture.matchId = id;
    [home, away].forEach((team, index) => {
      const own = report.score[index]; const against = report.score[index === 0 ? 1 : 0];
      team.table.played += 1; team.table.goalsFor += own; team.table.goalsAgainst += against;
      if (own > against) { team.table.won += 1; team.table.points += 3; team.form.push("W"); }
      else if (own === against) { team.table.drawn += 1; team.table.points += 1; team.form.push("D"); }
      else { team.table.lost += 1; team.form.push("L"); }
      team.form = team.form.slice(-5);
      report.teams[index].players.forEach((player) => {
        const key = `${team.id}:${player.id}`;
        const stat = this.state.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, yellowCards:0, redCards:0, ratingTotal:0 };
        stat.appearances += 1; stat.goals += player.stats.goals; stat.assists += player.stats.assists; stat.saves += player.stats.saves; stat.yellowCards += player.stats.yellowCards; stat.redCards += player.stats.redCards; stat.ratingTotal += player.rating;
        this.state.playerStats[key] = stat;
        if (team.ownerId && team.playerState[player.id]) {
          const state = team.playerState[player.id];
          const beforeMatch = Number(state.fitness ?? 100);
          const engineFitness = Number(player.fitness ?? beforeMatch);
          const matchDrain = Math.max(0, beforeMatch - engineFitness);
          state.fitness = Math.max(35, Math.min(100, Number((beforeMatch - matchDrain * LEAGUE_FITNESS_DRAIN_FACTOR).toFixed(1))));
          if (player.stats.redCards) state.suspension = Math.max(state.suspension ?? 0, 1);
          if (player.stats.redCards) this.roundNewUnavailable?.add(`${team.id}:${player.id}:suspension`);
          if (player.injury) {
            state.injuryRounds = Math.max(state.injuryRounds ?? 0, 1 + (roundNumber % 3));
            this.roundNewUnavailable?.add(`${team.id}:${player.id}:injury`);
          }
        }
      });
      const chemistryLineup = report.teams[index].players.map((player) => REAL_PLAYER_BY_ID[player.id]).filter(Boolean);
      const chemistryPositions = Object.fromEntries(report.teams[index].players.map((player) => [player.id, player.position]));
      this.recordChemistry(team, chemistryLineup, chemistryPositions);
    });
    return record;
  }

  simulateFixture(fixture, roundNumber) {
    const created = this.createFixtureMatch(fixture, roundNumber);
    advanceVersusMatch(created.match, created.startedAt + REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + 1);
    return this.finalizeFixture(fixture, roundNumber, created.match);
  }

  recoverFitness() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, injuryRounds:0 });
      const current = Number(state.fitness ?? 100);
      const starterRecovery = current < 70 ? 12 : 6;
      state.fitness = Math.min(100, current + (team.preferredStarterIds.includes(id) ? starterRecovery : 18));
    }));
  }

  advanceAvailability() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, injuryRounds:0 });
      if (!this.roundNewUnavailable?.has(`${team.id}:${id}:suspension`)) state.suspension = Math.max(0, Number(state.suspension ?? 0) - 1);
      if (!this.roundNewUnavailable?.has(`${team.id}:${id}:injury`)) state.injuryRounds = Math.max(0, Number(state.injuryRounds ?? 0) - 1);
    }));
  }

  payRewards(roundNumber) {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      let amount = 0; let wins = 0; let draws = 0;
      if (roundNumber % 3 === 0) {
        const recent = this.state.matches.filter((match) => match.round > roundNumber - 3 && (match.homeId === team.id || match.awayId === team.id));
        recent.forEach((match) => { const index = match.homeId === team.id ? 0 : 1; if (match.score[index] > match.score[index === 0 ? 1 : 0]) wins += 1; else if (match.score[0] === match.score[1]) draws += 1; });
        amount = (300 + wins * 90 + draws * 35) * REWARD_MULTIPLIER;
        this.wallet(team.ownerId).balance += amount;
        this.state.ledger.push({ id:makeId("ledger", `${team.id}-${roundNumber}`), accountId:team.ownerId, amount, type:"three-round-reward", round:roundNumber, createdAt:this.now() });
      }
      this.state.ledger.push({ id:makeId("ledger", `${team.id}-${roundNumber}-packs`), accountId:team.ownerId, amount:0, type:"round-pack-reward", round:roundNumber, createdAt:this.now() });
      const offers = Array.from({ length:rewardPackCount(roundNumber) }, (_, slot) => this.createRewardPack(team.ownerId, roundNumber, slot)).filter(Boolean);
      this.pushInbox(team, {
        id:`reward:${this.state.season.id}:${roundNumber}`,
        type:"reward",
        title:`第${roundNumber}轮比赛奖励已送达`,
        summary:`获得 ${offers.length} 份随机位置球员卡包${amount ? `和 ${amount} 金币` : ""}。`,
        body:amount
          ? `最近三轮取得 ${wins} 胜 ${draws} 平，阶段金币已经到账。${offers.length}份本轮赠送卡包已放入背包。`
          : `${offers.length}份本轮赠送卡包已放入背包。金币将在每三轮比赛后统一结算。`,
        round:roundNumber,
        payload:{ amount, wins, draws, offerIds:offers.map((offer) => offer.id), pools:offers.map((offer) => offer.pool) },
      });
    });
  }

  createRewardPack(accountId, roundNumber, slot = 0) {
    const team = this.accountTeam(accountId);
    if (!team) return null;
    this.state.rewardOffers[accountId] ??= [];
    if (this.rewardPackSlots(accountId, roundNumber).has(slot)) return null;
    const pools = ["ATT", "MID", "DEF", "GK"];
    const pool = pools[Math.floor(this.rng() * pools.length)];
    const offer = { id:makeId("reward", `${accountId}-${roundNumber}-${slot}`), round:roundNumber, slot, pool, tierId:"standard", playerIds:[], createdAt:this.now() };
    this.state.rewardOffers[accountId].push(offer);
    return offer;
  }

  openRewardPack(account, offerIdValue) {
    const team = this.accountTeam(account.id);
    const offer = (this.state.rewardOffers[account.id] ?? []).find((entry) => entry.id === offerIdValue);
    if (!team || !offer) throw new Error("找不到这份赠送卡包");
    if ((offer.playerIds ?? []).length === 3) return this.view(account);
    const ownReserved = [
      ...(this.state.shopOffers[account.id]?.playerIds ?? []),
      ...(this.state.rewardOffers[account.id] ?? []).filter((entry) => entry.id !== offer.id).flatMap((entry) => entry.playerIds ?? []),
    ];
    const unavailable = [...this.unavailablePlayerIds(account.id), ...team.rosterIds, ...ownReserved];
    const choices = drawUniquePlayers(offer.pool, unavailable, this.rng, 3);
    if (choices.length !== 3) throw new Error("该位置暂时没有足够的唯一球员可供开包");
    offer.playerIds = choices.map((player) => player.id);
    offer.openedAt = this.now();
    this.save();
    return this.view(account);
  }

  rewardPackSlots(accountId, roundNumber) {
    const issued = [
      ...(this.state.rewardOffers[accountId] ?? []).filter((offer) => offer.round === roundNumber && offer.source !== "admin"),
      ...this.state.ledger.filter((entry) => entry.accountId === accountId && ["round-pack-sign", "three-round-pack-sign"].includes(entry.type) && entry.round === roundNumber && entry.source !== "admin"),
    ];
    const slots = new Set(issued.map((entry) => Number(entry.slot ?? entry.rewardSlot)).filter(Number.isInteger));
    const legacyCount = issued.filter((entry) => !Number.isInteger(Number(entry.slot ?? entry.rewardSlot))).length;
    for (let index = 0; index < legacyCount; index += 1) {
      let slot = 0;
      while (slots.has(slot)) slot += 1;
      slots.add(slot);
    }
    return slots;
  }

  ensureRewardPacks(accountId) {
    const rewardRounds = new Set(this.state.ledger
      .filter((entry) => entry.accountId === accountId && ["round-pack-reward", "three-round-reward"].includes(entry.type))
      .map((entry) => entry.round));
    let changed = false;
    rewardRounds.forEach((roundNumber) => {
      for (let slot = 0; slot < rewardPackCount(roundNumber); slot += 1) {
        if (!this.rewardPackSlots(accountId, roundNumber).has(slot) && this.createRewardPack(accountId, roundNumber, slot)) changed = true;
      }
    });
    return changed;
  }

  createAdminRewardPack(accountId, grant) {
    const team = this.accountTeam(accountId);
    const tier = PACK_TIERS[grant.tierId];
    if (!team || !tier || !REAL_PLAYER_POOLS[grant.pool]) return null;
    this.state.rewardOffers[accountId] ??= [];
    if (this.state.rewardOffers[accountId].some((offer) => offer.grantId === grant.id)) return null;
    const unavailable = [
      ...this.unavailablePlayerIds(accountId),
      ...team.rosterIds,
      ...(this.state.shopOffers[accountId]?.playerIds ?? []),
      ...(this.state.rewardOffers[accountId] ?? []).flatMap((offer) => offer.playerIds ?? []),
    ];
    const guaranteedCandidates = tier.guaranteeGrades.length
      ? REAL_PLAYER_POOLS[grant.pool].filter((player) => tier.guaranteeGrades.includes(player.grade) && !unavailable.includes(player.id))
      : [];
    if (tier.guaranteeGrades.length && !guaranteedCandidates.length) return null;
    const guaranteed = guaranteedCandidates.length ? guaranteedCandidates[Math.floor(this.rng() * guaranteedCandidates.length)] : null;
    const choices = drawUniquePlayers(grant.pool, unavailable, this.rng, 3, guaranteed ? [guaranteed] : []);
    if (choices.length !== 3) return null;
    const offer = {
      id:makeId("admin-reward", `${grant.id}-${accountId}`),
      round:grant.round,
      pool:grant.pool,
      tierId:tier.id,
      source:"admin",
      grantId:grant.id,
      playerIds:choices.map((player) => player.id),
      createdAt:this.now(),
    };
    this.state.rewardOffers[accountId].push(offer);
    return offer;
  }

  dispatchAdminRewardGrants(roundNumber) {
    this.state.adminPackGrants.filter((grant) => grant.status === "scheduled" && grant.round === roundNumber).forEach((grant) => {
      let recipientCount = 0;
      let failedCount = 0;
      this.state.teams.filter((team) => team.ownerId).forEach((team) => {
        const offer = this.createAdminRewardPack(team.ownerId, grant);
        if (!offer) { failedCount += 1; return; }
        recipientCount += 1;
        const tier = PACK_TIERS[grant.tierId];
        this.pushInbox(team, {
          id:`admin-pack:${grant.id}:${team.id}`,
          type:"reward",
          title:`第${grant.round}轮全服卡包奖励`,
          summary:`开发者发放了1份${tier.name}（${grant.pool}）。`,
          body:`这份奖励已进入背包，可从三名${grant.pool}位置球员中选择一人签下。`,
          round:grant.round,
          payload:{ offerId:offer.id, grantId:grant.id, pool:grant.pool, tierId:grant.tierId },
        });
      });
      grant.status = "sent";
      grant.sentAt = this.now();
      grant.recipientCount = recipientCount;
      grant.failedCount = failedCount;
    });
  }

  scheduleAdminRewardPack(body = {}) {
    const round = Math.floor(Number(body.round));
    const pool = String(body.pool ?? "");
    const tierId = String(body.tierId ?? "standard");
    if (!Number.isInteger(round) || round < 1 || round > this.state.season.totalRounds) throw new Error("请选择有效的联赛轮次");
    if (!REAL_PLAYER_POOLS[pool]) throw new Error("请选择有效的位置卡包");
    if (!PACK_TIERS[tierId]) throw new Error("请选择有效的卡包档位");
    const grant = {
      id:makeId("admin-pack-grant", `${this.state.season.id}-${round}-${pool}-${tierId}`),
      seasonId:this.state.season.id,
      round,
      pool,
      tierId,
      status:"scheduled",
      createdAt:this.now(),
      sentAt:null,
      recipientCount:0,
      failedCount:0,
    };
    this.state.adminPackGrants.push(grant);
    if (round <= this.state.season.currentRound) this.dispatchAdminRewardGrants(round);
    this.save();
    return this.adminView();
  }

  awardChampionBadge(body = {}) {
    const accountId = String(body.accountId ?? "");
    const season = String(body.season ?? "").toUpperCase();
    const team = this.accountTeam(accountId);
    if (!team) throw new Error("请选择已经加入联赛的玩家");
    if (!CHAMPION_BADGE_SEASONS.includes(season)) throw new Error("冠军徽章只支持S0、S1或S2赛季");
    team.championBadges ??= [];
    if (team.championBadges.some((badge) => badge.season === season)) throw new Error(`该玩家已经拥有${season}冠军徽章`);
    const badge = { id:`champion-${season.toLowerCase()}`, type:"champion", season, awardedAt:this.now() };
    team.championBadges.push(badge);
    this.pushInbox(team, {
      id:`champion-badge:${season}:${team.id}`,
      type:"notice",
      title:`${season}冠军徽章已授予`,
      summary:`${team.ownerName}获得${season}赛季冠军徽章。`,
      body:`这枚皇冠冠军徽章已经加入你的联赛荣誉，并会展示在积分榜玩家ID旁。`,
      payload:{ badge },
    });
    this.save();
    return this.adminView();
  }

  chooseRewardPack(account, offerIdValue, playerId) {
    const team = this.accountTeam(account.id);
    const offers = this.state.rewardOffers[account.id] ?? [];
    const offer = offers.find((entry) => entry.id === offerIdValue);
    if (!team || !offer?.playerIds.includes(playerId)) throw new Error("只能选择赠送卡包中的球员");
    if (team.rosterIds.length >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，请先腾出一个位置");
    if (team.rosterIds.includes(playerId) || this.unavailablePlayerIds(account.id).has(playerId)) throw new Error("该球员已经被其他玩家签下");
    team.rosterIds.push(playerId);
    team.playerState[playerId] = { fitness:100, suspension:0, injuryRounds:0 };
    this.state.rewardOffers[account.id] = offers.filter((entry) => entry.id !== offer.id);
    this.state.ledger.push({ id:makeId("ledger", `${offer.id}-${playerId}`), accountId:account.id, amount:0, type:offer.source === "admin" ? "three-round-pack-sign" : "round-pack-sign", round:offer.round, source:offer.source, grantId:offer.grantId, rewardSlot:Number.isInteger(Number(offer.slot)) ? Number(offer.slot) : undefined, playerId, createdAt:this.now() });
    this.notifyLegendSigning(team, REAL_PLAYER_BY_ID[playerId], offer.source === "admin" ? "开发者奖励卡包" : "每轮比赛奖励卡包");
    this.save();
    return this.view(account);
  }

  finishRound(round) {
    this.advanceAvailability();
    this.roundNewUnavailable = null;
    round.status = "complete";
    this.state.season.currentRound = round.number;
    this.payRewards(round.number);
    this.dispatchAdminRewardGrants(round.number);
    if (round.number >= this.state.season.totalRounds) { this.state.season.status = "completed"; this.state.season.completedAt = this.now(); }
    else this.state.season.nextRoundAt = nextSlot(this.now());
    this.createRoundInbox(round.number);
    this.updateDailyReports();
    this.state.liveRound = null;
    this.save();
  }

  createRoundInbox(roundNumber) {
    const results = this.state.matches.filter((match) => match.round === roundNumber).map((match) => this.matchSummary(match));
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const ownMatch = results.find((match) => match.homeId === team.id || match.awayId === team.id);
      if (!ownMatch) return;
      const ownIndex = ownMatch.homeId === team.id ? 0 : 1;
      const opponentName = ownIndex === 0 ? ownMatch.awayName : ownMatch.homeName;
      const ownScore = ownMatch.score[ownIndex];
      const opponentScore = ownMatch.score[ownIndex === 0 ? 1 : 0];
      const matchRecord = this.state.matches.find((match) => match.id === ownMatch.id);
      const autoRotations = matchRecord?.autoRotations?.[ownIndex] ?? [];
      const resultText = ownScore > opponentScore ? "取胜" : ownScore === opponentScore ? "战平" : "失利";
      const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
      const injured = team.rosterIds.filter((id) => Number(team.playerState[id]?.injuryRounds ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].injuryRounds }));
      const suspended = team.rosterIds.filter((id) => Number(team.playerState[id]?.suspension ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].suspension }));
      const next = this.nextOpponent(team.id);
      this.pushInbox(team, {
        id:`matchweek:${this.state.season.id}:${roundNumber}`,
        type:"matchweek",
        title:`第${roundNumber}轮比赛周战报`,
        summary:`${team.name} ${ownScore}:${opponentScore} ${opponentName}，本轮${resultText}。`,
        body:`球队目前排名第 ${rank}，积 ${team.table.points} 分。${next ? `下一轮将${next.venue === "home" ? "主场" : "客场"}迎战 ${next.name}。` : "本赛季赛程已经完成。"}`,
        round:roundNumber,
        matchId:ownMatch.id,
        payload:{ results, rank, points:team.table.points, injured, suspended, next, autoRotations },
      });
      if (autoRotations.length) {
        const details = autoRotations.map((rotation) => `${rotation.outName}因${rotation.reason}由${rotation.inName}自动替换`).join("；");
        this.pushInbox(team, {
          id:`rotation:${this.state.season.id}:${roundNumber}`,
          type:"lineup",
          title:`第${roundNumber}轮自动轮换报告`,
          summary:`系统在赛前完成 ${autoRotations.length} 处自动换人。`,
          body:`${details}。这些调整只对本轮实际出场阵容生效，不会改变你保存的主力阵容。`,
          round:roundNumber,
          matchId:ownMatch.id,
          payload:{ autoRotations },
        });
      }
      if (injured.length || suspended.length) {
        this.pushInbox(team, {
          id:`availability:${this.state.season.id}:${roundNumber}`,
          type:"medical",
          title:"下一轮阵容可用性提醒",
          summary:`${injured.length}人伤缺，${suspended.length}人停赛。`,
          body:`${[...injured.map((player) => `${player.name}伤缺${player.rounds}轮`), ...suspended.map((player) => `${player.name}停赛${player.rounds}轮`)].join("；")}。系统会按位置从替补席自动补位。`,
          round:roundNumber,
          payload:{ injured, suspended },
        });
      }
    });
  }

  simulateNextRound() {
    if (this.state.season.status === "completed") throw new Error("本赛季已经结束");
    const round = this.state.rounds[this.state.season.currentRound];
    if (!round || round.status === "complete") throw new Error("没有可模拟的轮次");
    round.status = "running";
    this.recoverFitness();
    this.roundNewUnavailable = new Set();
    round.fixtures.forEach((fixture) => this.simulateFixture(fixture, round.number));
    this.finishRound(round);
    return round.number;
  }

  startScheduledRound() {
    const round = this.state.rounds[this.state.season.currentRound];
    if (!round || round.status !== "pending") return false;
    round.status = "running";
    this.recoverFitness();
    this.roundNewUnavailable = new Set();
    const liveMatches = [];
    round.fixtures.forEach((fixture, fixtureIndex) => {
      const created = this.createFixtureMatch(fixture, round.number);
      if (created.home.ownerId || created.away.ownerId) {
        liveMatches.push({ code:`YDL-${this.state.season.name}-R${round.number}-M${fixtureIndex + 1}`, fixtureIndex, match:created.match, spectators:{} });
      } else {
        advanceVersusMatch(created.match, created.startedAt + REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + 1);
        this.finalizeFixture(fixture, round.number, created.match);
      }
    });
    if (!liveMatches.length) {
      this.finishRound(round);
      return true;
    }
    this.state.liveRound = { roundNumber:round.number, startedAt:this.now(), matches:liveMatches, newUnavailable:[...this.roundNewUnavailable] };
    this.save();
    return true;
  }

  advanceLiveRound(now = this.now()) {
    const liveRound = this.state.liveRound;
    if (!liveRound) return false;
    const round = this.state.rounds.find((entry) => entry.number === liveRound.roundNumber);
    this.roundNewUnavailable = new Set(liveRound.newUnavailable ?? []);
    for (const live of liveRound.matches) {
      if (live.completed) continue;
      advanceVersusMatch(live.match, now);
      if (live.match.report) {
        this.finalizeFixture(round.fixtures[live.fixtureIndex], round.number, live.match);
        live.completed = true;
      }
    }
    liveRound.newUnavailable = [...this.roundNewUnavailable];
    if (liveRound.matches.every((entry) => entry.completed)) this.finishRound(round);
    else this.save({ skipDailyBackup:true });
    return true;
  }

  liveMatch(codeValue) {
    this.advanceLiveRound(this.now());
    const code = String(codeValue ?? "").toUpperCase();
    const live = this.state.liveRound?.matches.find((entry) => entry.code.toUpperCase() === code && !entry.completed);
    if (!live) throw new Error("这场联赛直播已经结束");
    return live;
  }

  cleanupLiveSpectators(live) {
    const cutoff = this.now() - 30_000;
    Object.entries(live.spectators ?? {}).forEach(([token, spectator]) => {
      if (spectator.lastSeenAt < cutoff) delete live.spectators[token];
    });
  }

  broadcasts() {
    this.advanceLiveRound(this.now());
    return clone((this.state.liveRound?.matches ?? []).filter((live) => !live.completed).map((live) => {
      this.cleanupLiveSpectators(live);
      const snapshot = publicMatch(live.match, this.now(), null, true);
      return {
        code:live.code,
        round:this.state.liveRound.roundNumber,
        teams:snapshot.teams.map((team) => ({ name:team.name, formation:team.formation })),
        score:[...snapshot.score],
        minute:snapshot.minute,
        segment:snapshot.segment,
        weather:snapshot.weather,
        spectatorCount:Object.keys(live.spectators ?? {}).length,
        competition:"YellowDogs League",
      };
    }));
  }

  broadcastView(live) {
    this.cleanupLiveSpectators(live);
    return clone({
      code:live.code,
      round:this.state.liveRound?.roundNumber ?? 0,
      live:!live.completed && !live.match.report,
      spectators:Object.values(live.spectators ?? {}).map(({ name }) => ({ name })),
      match:publicMatch(live.match, this.now(), null, true),
      competition:"YellowDogs League",
    });
  }

  watch(code, spectatorName, existingToken = null) {
    const live = this.liveMatch(code);
    live.spectators ??= {};
    const spectatorToken = existingToken && live.spectators[existingToken] ? existingToken : makeId("viewer", code);
    live.spectators[spectatorToken] = { name:String(spectatorName ?? "匿名观众").trim().slice(0, 30) || "匿名观众", lastSeenAt:this.now() };
    return { spectatorToken, broadcast:this.broadcastView(live) };
  }

  watchView(code, spectatorToken) {
    const live = this.liveMatch(code);
    if (!live.spectators?.[spectatorToken]) throw new Error("观赛会话已过期，请重新进入直播");
    live.spectators[spectatorToken].lastSeenAt = this.now();
    return this.broadcastView(live);
  }

  leaveWatch(code, spectatorToken) {
    const live = this.liveMatch(code);
    delete live.spectators?.[spectatorToken];
    return { left:true };
  }

  tick() {
    const now = this.now();
    if (this.statePath && localDateKey(new Date(now)) !== this.lastBackupMaintenanceDate) this.maintainBackups();
    if (this.state.liveRound) return this.advanceLiveRound(now);
    if (this.state.season.status !== "active" || !activeTime(now) || now < this.state.season.nextRoundAt) return false;
    return this.startScheduledRound();
  }

  buildDailyReport(team, date = localDateKey(new Date(this.now()))) {
    const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
    const matches = this.state.matches.filter((match) => localDateKey(new Date(match.playedAt)) === date && (match.homeId === team.id || match.awayId === team.id));
    const playerTotals = new Map();
    const results = matches.map((match) => {
      const index = match.homeId === team.id ? 0 : 1;
      const opponentIndex = index === 0 ? 1 : 0;
      const own = match.score[index];
      const against = match.score[opponentIndex];
      const reportTeam = match.report?.teams?.[index];
      reportTeam?.players?.forEach((player) => {
        const current = playerTotals.get(player.id) ?? { id:player.id, name:player.name, appearances:0, goals:0, assists:0, ratingTotal:0 };
        current.appearances += 1;
        current.goals += Number(player.stats?.goals ?? 0);
        current.assists += Number(player.stats?.assists ?? 0);
        current.ratingTotal += Number(player.rating ?? 0);
        playerTotals.set(player.id, current);
      });
      return {
        matchId:match.id,
        round:match.round,
        opponentName:index === 0 ? match.awayName : match.homeName,
        venue:index === 0 ? "home" : "away",
        scoreFor:own,
        scoreAgainst:against,
        result:own > against ? "W" : own === against ? "D" : "L",
        formation:reportTeam?.formation ?? match.formations?.[index] ?? "未知",
        tactic:reportTeam?.tactic ?? team.tactic,
        style:reportTeam?.style ?? team.style,
      };
    });
    const topPlayers = [...playerTotals.values()].map((player) => ({
      ...player,
      averageRating:Number((player.ratingTotal / Math.max(1, player.appearances)).toFixed(2)),
    })).sort((left, right) => right.averageRating - left.averageRating || right.goals - left.goals || right.assists - left.assists).slice(0, 3);
    const wins = results.filter((entry) => entry.result === "W").length;
    const draws = results.filter((entry) => entry.result === "D").length;
    const losses = results.length - wins - draws;
    const goalsFor = results.reduce((sum, entry) => sum + entry.scoreFor, 0);
    const goalsAgainst = results.reduce((sum, entry) => sum + entry.scoreAgainst, 0);
    const players = team.rosterIds.map((id) => ({ ...playerSummary(REAL_PLAYER_BY_ID[id]), state:{ fitness:100, suspension:0, injuryRounds:0, ...(team.playerState[id] ?? {}) } }));
    const injured = players.filter((player) => player.state.injuryRounds > 0).map((player) => ({ id:player.id, name:player.name, rounds:player.state.injuryRounds }));
    const suspended = players.filter((player) => player.state.suspension > 0).map((player) => ({ id:player.id, name:player.name, rounds:player.state.suspension }));
    const lowFitness = players.filter((player) => player.state.fitness < 60 && !player.state.injuryRounds && !player.state.suspension).sort((left, right) => left.state.fitness - right.state.fitness).map((player) => ({ id:player.id, name:player.name, fitness:Math.round(player.state.fitness) }));
    const coinChange = this.state.ledger.filter((entry) => entry.accountId === team.ownerId && localDateKey(new Date(entry.createdAt)) === date).reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
    const headline = !results.length ? "备战日" : wins > losses ? "状态上扬" : losses > wins ? "需要调整" : "表现平稳";
    const managerNote = injured.length || suspended.length
      ? `下一轮有${injured.length + suspended.length}名球员无法出场，系统将优先从替补席按位置补位。`
      : lowFitness.length
        ? `有${lowFitness.length}名球员体能低于60，建议检查首发和轮换安排。`
        : results.length
          ? `今日${wins}胜${draws}平${losses}负，球队阵容完整，可以继续围绕当前战术准备下一轮。`
          : "今日尚无比赛，球队阵容完整，可以调整首发和战术等待下一轮。";
    return {
      date,
      generatedAt:this.now(),
      teamId:team.id,
      teamName:team.name,
      headline,
      rank,
      points:team.table.points,
      record:`${team.table.won}胜 ${team.table.drawn}平 ${team.table.lost}负`,
      goalDifference:team.table.goalsFor - team.table.goalsAgainst,
      today:{ played:results.length, wins, draws, losses, goalsFor, goalsAgainst, results },
      bestPlayer:topPlayers[0] ? { name:topPlayers[0].name, averageRating:topPlayers[0].averageRating } : null,
      topPlayers,
      tactics:{ formation:mostCommon(results.map((entry) => entry.formation)) ?? (team.preferredStarterIds.length === 11 ? analyzeElevenFormation(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]), team.positions).name : null), tactic:mostCommon(results.map((entry) => entry.tactic)) ?? team.tactic, style:mostCommon(results.map((entry) => entry.style)) ?? team.style },
      availability:{ total:players.length, available:players.length - injured.length - suspended.length, averageFitness:players.length ? Math.round(players.reduce((sum, player) => sum + Number(player.state.fitness ?? 100), 0) / players.length) : 0, injured, suspended, lowFitness },
      economy:{ coinChange },
      managerNote,
      nextOpponent:this.nextOpponent(team.id),
    };
  }

  updateDailyReports(date = localDateKey(new Date(this.now()))) {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const reports = this.state.reports[team.id] ?? (this.state.reports[team.id] = []);
      const report = this.buildDailyReport(team, date);
      const index = reports.findIndex((entry) => entry.date === date);
      if (index >= 0) reports[index] = report;
      else reports.push(report);
      this.state.reports[team.id] = reports.sort((left, right) => left.date.localeCompare(right.date)).slice(-14);
      this.pushInbox(team, {
        id:`daily:${this.state.season.id}:${date}`,
        type:"daily-report",
        title:`${date} 球队当日报告`,
        summary:`${report.headline} · 今日 ${report.today.wins}胜${report.today.draws}平${report.today.losses}负`,
        body:report.managerNote,
        report,
      });
    });
  }

  teamReport(team) {
    return this.buildDailyReport(team);
  }

  nextOpponent(teamId) {
    const round = this.state.rounds.find((entry) => entry.status === "pending" && entry.fixtures.some((fixture) => fixture.homeId === teamId || fixture.awayId === teamId));
    const fixture = round?.fixtures.find((entry) => entry.homeId === teamId || entry.awayId === teamId);
    if (!fixture) return null;
    const opponentId = fixture.homeId === teamId ? fixture.awayId : fixture.homeId;
    const conditions = this.fixtureConditions(fixture, round.number);
    return {
      round:round.number,
      startsAt:this.state.season.nextRoundAt,
      name:this.state.teams.find((team) => team.id === opponentId)?.name ?? "待定",
      opponentId,
      venue:fixture.homeId === teamId ? "home" : "away",
      weather:conditions.weather,
      referee:conditions.referee,
    };
  }

  archiveSeason(reason) {
    this.state.archives ??= [];
    this.state.archives.push({
      reason,
      archivedAt:this.now(),
      season:clone(this.state.season),
      standings:this.standings().map((entry) => ({ ...entry, team:publicTeam(this.state.teams.find((team) => team.id === entry.id)) })),
      matches:clone(this.state.matches),
      playerStats:clone(this.state.playerStats),
    });
    this.state.archives = this.state.archives.slice(-12);
  }

  resetCompetition(name, reason) {
    this.archiveSeason(reason);
    this.state.teams.forEach((team) => {
      team.table = freshTable();
      team.form = [];
      if (team.ownerId) {
        this.wallet(team.ownerId).balance = INITIAL_WALLET_BALANCE;
        team.rosterIds.forEach((id) => {
          team.playerState[id] = { fitness:100, suspension:0, injuryRounds:0 };
        });
      }
    });
    const startedAt = this.now();
    this.state.season = { id:`${name}-${localDateKey(new Date(startedAt))}-${startedAt.toString(36)}`, name, date:localDateKey(new Date(startedAt)), status:"active", currentRound:0, totalRounds:18, nextRoundAt:nextSlot(startedAt), startedAt, completedAt:null };
    this.state.rounds = roundRobin(this.state.teams.map((team) => team.id));
    this.state.matches = [];
    this.state.playerStats = {};
    this.state.ledger = [];
    this.state.adminPackGrants = [];
    this.state.reports = {};
    this.state.liveRound = null;
    this.save();
    return this.adminView();
  }

  restartSeason() {
    return this.resetCompetition(this.state.season.name, "restarted");
  }

  startNewSeason() {
    const current = Number(String(this.state.season.name).match(/\d+/)?.[0] ?? 1);
    return this.resetCompetition(`S${current + 1}`, "new-season");
  }

  fullReset() {
    const resetAt = this.now();
    this.backupFile(`before-full-reset-${localDateKey(new Date(resetAt))}-${resetAt}.json`);
    this.state = createState(resetAt);
    this.state.season.nextRoundAt = nextSlot(resetAt);
    this.state.lastFullResetAt = resetAt;
    this.save();
    return this.adminView();
  }

  backupView() {
    if (!this.backupDir || !existsSync(this.backupDir)) return { directory:this.backupDir, retentionDays:BACKUP_RETENTION_DAYS, files:[] };
    return {
      directory:this.backupDir,
      retentionDays:BACKUP_RETENTION_DAYS,
      files:readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort().reverse().slice(0, 14),
    };
  }

  adminView() {
    const owned = new Map();
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => owned.set(id, team)));
    const reserved = new Map();
    Object.entries(this.state.drafts).forEach(([accountId, draft]) => draft.selectedIds.forEach((id) => reserved.set(id, { accountId, teamName:draft.teamName })));
    const pools = Object.fromEntries(Object.entries(REAL_PLAYER_POOLS).map(([pool, players]) => {
      const selected = players.filter((player) => owned.has(player.id)).length;
      const drafting = players.filter((player) => reserved.has(player.id)).length;
      return [pool, { total:players.length, selected, drafting, available:players.length - selected - drafting }];
    }));
    const allocations = REAL_PLAYERS.filter((player) => owned.has(player.id) || reserved.has(player.id)).map((player) => {
      const team = owned.get(player.id);
      const draft = reserved.get(player.id);
      return { ...playerSummary(player), status:team ? "owned" : "drafting", teamId:team?.id ?? null, teamName:team?.name ?? draft?.teamName ?? null, ownerName:team?.ownerName ?? null };
    });
    return clone({
      season:this.state.season,
      schedule:{ activeHours:"10:00 - 22:00", intervalMinutes:20 },
      teams:this.standings().map((entry) => {
        const team = this.state.teams.find((candidate) => candidate.id === entry.id);
        return { ...entry, ...publicTeam(team), ownerId:team.ownerId, rosterCount:team.rosterIds.length };
      }),
      pools,
      allocations,
      drafts:Object.entries(this.state.drafts).map(([accountId, draft]) => ({ accountId, teamName:draft.teamName, selectedCount:draft.selectedIds.length, startedAt:draft.startedAt })),
      matches:this.state.matches.length,
      backups:this.backupView(),
      packTiers:Object.values(PACK_TIERS).map(publicPackTier),
      rewardGrants:(this.state.adminPackGrants ?? []).slice().sort((left, right) => right.createdAt - left.createdAt),
      lastFullResetAt:this.state.lastFullResetAt ?? null,
      archives:(this.state.archives ?? []).map((archive) => ({ reason:archive.reason, archivedAt:archive.archivedAt, season:archive.season, matchCount:archive.matches?.length ?? 0 })),
    });
  }
}

export const yellowDogsLeague = new YellowDogsLeagueService();
