import crypto from "node:crypto";
import {
  canChooseHome,
  claimHome,
  listAttackableTerritories,
  OWNER_TYPES,
} from "./territory-model.js";
import { CAMPAIGN_ENGINE } from "./engine/campaign-match-engine.mjs";
import { campaignWeatherHour, createCampaignWeatherSnapshot } from "./engine/campaign-weather.mjs";
import { createTerritoryAiGarrison, publicTerritoryAiIntel } from "./engine/territory-ai.mjs";
import { analyzeElevenBoardFormation, sanitizeFormationLines } from "./formation-rules.js";
import {
  CAMPAIGN_EXTRA_TIME_LIVE_MS,
  CAMPAIGN_REGULATION_LIVE_MS,
  CHALLENGE_FIRST_LEG_MS,
  CHALLENGE_SECOND_LEG_COOLDOWN_MS,
  CHALLENGE_SECOND_LEG_MS,
  CHALLENGE_TOTAL_DURATION_MS,
} from "./shared/config/challenge.mjs";
import { DRAFT_SIZE, GRADE_WEIGHTS, LINE_KEYS, LINE_WEIGHTS, MINIMUM_PLAYERS_PER_LINE } from "./shared/config/draft.mjs";
import { STARTING_GOLD } from "./shared/config/economy.mjs";
import { LINE_LABELS } from "./shared/football/labels.js";
import { createPlayerCardViewModel } from "./shared/player-card/player-card-contract.js";
import { ChallengeService, publicChallengeView } from "./server/application/challenge-service.mjs";
import { BuildingService } from "./server/application/building-service.mjs";
import { EconomyService } from "./server/application/economy-service.mjs";
import { nextAvailablePlayerMapColor } from "./server/domain/player-map-colors.mjs";
import { migrateCampaignSave } from "./server/infrastructure/campaign-save-migrations.mjs";
import { JsonCampaignRepository } from "./server/infrastructure/json-campaign-repository.mjs";

export const PLAYER_CATALOG_VERSION = "s4-production-2026-08-24";
export {
  CHALLENGE_FIRST_LEG_MS,
  CHALLENGE_SECOND_LEG_COOLDOWN_MS,
  CHALLENGE_SECOND_LEG_MS,
  CHALLENGE_TOTAL_DURATION_MS,
  DRAFT_SIZE,
  LINE_KEYS,
  LINE_LABELS,
  STARTING_GOLD,
};
function cleanText(value, label, { min = 1, max = 24 } = {}) {
  const text = String(value ?? "").trim();
  if (text.length < min) throw new Error(`${label}至少需要${min}个字符`);
  if (text.length > max) throw new Error(`${label}不能超过${max}个字符`);
  return text;
}

function defaultTacticsPositions(players = []) {
  const groups = { GK:[], DEF:[], MID:[], ATT:[] };
  players.forEach((player) => (groups[player.pool] ?? groups.MID).push(player));
  const result = {};
  [["GK",90],["DEF",68],["MID",44],["ATT",20]].forEach(([group,y]) => groups[group].forEach((player,index) => {
    result[player.id] = { x:Math.round(((index + 1) / (groups[group].length + 1)) * 76 + 12), y };
  }));
  return result;
}

function sanitizeTacticsPositions(players, positions = {}) {
  const fallback = defaultTacticsPositions(players);
  return Object.fromEntries(players.map((player) => {
    const value = positions?.[player.id] ?? fallback[player.id];
    return [player.id, {
      x:Math.round(Math.max(8, Math.min(92, Number(value?.x) || 50))),
      y:Math.round(Math.max(6, Math.min(94, Number(value?.y) || 50))),
    }];
  }));
}

function safeAccount(account) {
  return { id: account.id, nickname: account.nickname, createdAt: account.createdAt, wallet:{ gold:Number(account.gold ?? 0) } };
}

function passwordDigest(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function weightedPick(weights, random = Math.random) {
  const target = random() * Object.values(weights).reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  for (const [key, weight] of Object.entries(weights)) {
    cursor += weight;
    if (target <= cursor) return key;
  }
  return Object.keys(weights).at(-1);
}

function rosterCounts(roster) {
  return Object.fromEntries(LINE_KEYS.map((line) => [line, roster.filter((player) => player.pool === line).length]));
}

function missingMinimums(roster) {
  const counts = rosterCounts(roster);
  return Object.fromEntries(LINE_KEYS.map((line) => [line, Math.max(0, MINIMUM_PLAYERS_PER_LINE - counts[line])]));
}

function publicDraft(account) {
  const draft = account.draft;
  if (!draft) return null;
  const playerWithCard = (player) => ({ ...player, card:createPlayerCardViewModel(player) });
  return {
    teamName: draft.teamName,
    roster: draft.roster.map(playerWithCard),
    offer: draft.offer.map(playerWithCard),
    pickNumber: draft.roster.length + (account.setupComplete ? 0 : 1),
    totalPicks: DRAFT_SIZE,
    counts: rosterCounts(draft.roster),
    complete: account.setupComplete === true,
  };
}

export class CampaignService {
  constructor({ dataPath, repository = null, economy = null, buildings = null, challenges = null, catalog, territoryIndex = null, maritimePlanner = null, random = Math.random, now = Date.now } = {}) {
    this.repository = repository ?? new JsonCampaignRepository({ dataPath });
    this.dataPath = this.repository.dataPath ?? dataPath ?? null;
    this.random = random;
    this.now = now;
    this.economy = economy ?? new EconomyService({ now });
    this.territoryIndex = territoryIndex;
    this.maritimePlanner = maritimePlanner;
    this.playerLibrary = Array.isArray(catalog) ? catalog : [];
    this.playerDatabase = this.playerLibrary.filter((player) => LINE_KEYS.includes(player.pool) && player.isX !== true);
    this.catalog = this.playerDatabase.filter((player) => ["A", "B", "C"].includes(player.grade));
    const saved = this.repository.load();
    const migration = migrateCampaignSave({
      saved,
      territoryIndex: this.territoryIndex,
      playerDatabase: this.playerDatabase,
      playerCatalogVersion: PLAYER_CATALOG_VERSION,
      economy: this.economy,
    });
    this.accounts = migration.accounts;
    this.world = migration.world;
    this.weatherSnapshots = new Map();
    this.buildings = buildings ?? new BuildingService({
      economy: this.economy,
      now: this.now,
      isCoastal: (territoryId) => this.maritimePlanner?.isCoastal?.(territoryId) === true,
      save: () => this.save(),
    });
    const buildingsChanged = this.buildings.migrate({ accounts: this.accounts, world: this.world });
    this.challenges = challenges ?? new ChallengeService({
      world: this.world,
      accounts: this.accounts,
      territoryIndex: this.territoryIndex,
      maritimePlanner: this.maritimePlanner,
      playerDatabase: this.playerDatabase,
      ensureAiGarrison: (territoryId) => this.ensureAiGarrison(territoryId),
      getTerritoryWeather: (territoryId, timestamp) => this.territoryWeather(territoryId, timestamp),
      save: () => this.save(),
      now: this.now,
    });
    this.challenges.restoreActiveChallenges();
    if (migration.changed || buildingsChanged) this.save();
  }

  nextMapColor() {
    return nextAvailablePlayerMapColor(this.accounts);
  }

  save() {
    this.repository.save({ accounts: Object.fromEntries(this.accounts), world: this.world });
  }

  adjustGold(account, deltaValue, reasonValue = "system") {
    const result = this.economy.adjust(account, deltaValue, reasonValue);
    this.save();
    return result;
  }

  spendGold(account, amountValue, reasonValue) {
    const result = this.economy.spend(account, amountValue, reasonValue);
    this.save();
    return result;
  }

  accountByNickname(nickname) {
    return [...this.accounts.values()].find((account) => account.nickname === nickname) ?? null;
  }

  register(nicknameValue, passwordValue) {
    const nickname = cleanText(nicknameValue, "昵称", { min: 2, max: 16 });
    const password = cleanText(passwordValue, "密码", { min: 6, max: 72 });
    if (this.accountByNickname(nickname)) throw new Error("该昵称已经注册");
    const id = `YF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const salt = crypto.randomBytes(16).toString("hex");
    const account = {
      id,
      nickname,
      passwordSalt: salt,
      passwordHash: passwordDigest(password, salt),
      token: crypto.randomBytes(24).toString("base64url"),
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      setupComplete: false,
      homeTerritoryId: null,
      mapColor: this.nextMapColor(),
      draft: null,
    };
    this.economy.migrateAccount(account);
    this.accounts.set(id, account);
    this.save();
    return this.session(account);
  }

  login(nicknameValue, passwordValue) {
    const nickname = cleanText(nicknameValue, "昵称", { min: 2, max: 16 });
    const password = cleanText(passwordValue, "密码", { min: 1, max: 72 });
    const account = this.accountByNickname(nickname);
    if (!account || passwordDigest(password, account.passwordSalt) !== account.passwordHash) throw new Error("昵称或密码错误");
    account.token = crypto.randomBytes(24).toString("base64url");
    account.lastSeenAt = Date.now();
    account.mapColor ??= this.nextMapColor();
    account.homeTerritoryId ??= null;
    this.save();
    return this.session(account);
  }

  authenticate(tokenValue) {
    const account = [...this.accounts.values()].find((candidate) => candidate.token === String(tokenValue ?? ""));
    if (!account) throw Object.assign(new Error("登录已失效，请重新登录"), { statusCode: 401 });
    account.lastSeenAt = Date.now();
    return account;
  }

  session(account) {
    return { token: account.token, profile: safeAccount(account), state: this.state(account) };
  }

  battleForChallenge(challenge) {
    return this.challenges.battleForChallenge(challenge);
  }

  settleChallenge(challenge) {
    return this.challenges.settleChallenge(challenge);
  }

  settleDueChallenges() {
    return this.challenges.settleDueChallenges();
  }

  challengeStatus(account, challengeIdValue) {
    return this.challenges.status(account, challengeIdValue);
  }

  advanceActiveChallenges(now = this.now(), { maximumMatches = 1, maximumChainsPerMatch = 1 } = {}) {
    return this.challenges.advance(now, { maximumMatches, maximumChainsPerMatch });
  }

  completeTerritoryChallenge(account, challengeIdValue) {
    const result = this.challenges.complete(account, challengeIdValue);
    return {
      state: this.state(account),
      battle: result.battle,
      ...(result.alreadyCompleted ? { alreadyCompleted: true } : {}),
    };
  }

  campaignWeather(timestamp = this.now()) {
    const clock = campaignWeatherHour(timestamp);
    const cached = this.weatherSnapshots.get(clock.hourKey);
    if (cached) return cached;
    const snapshot = createCampaignWeatherSnapshot({
      territoryIndex: this.territoryIndex,
      timestamp: clock.observedAt,
      seed: `${this.world?.seasonId ?? "season"}:${this.world?.aiGenerationSeed ?? "ydl"}`,
    });
    this.weatherSnapshots.set(clock.hourKey, snapshot);
    while (this.weatherSnapshots.size > 3) this.weatherSnapshots.delete(this.weatherSnapshots.keys().next().value);
    return snapshot;
  }

  territoryWeather(territoryId, timestamp = this.now()) {
    return this.campaignWeather(timestamp).territories[String(territoryId)]
      ?? { type:"sunny", label:"晴朗", icon:"☀", precipitation:0 };
  }

  publicWorld() {
    if (!this.world) return null;
    const now = this.now();
    const territories = Object.fromEntries(Object.entries(this.world.territories).filter(([, state]) => state.ownerType !== OWNER_TYPES.NEUTRAL));
    const players = Object.fromEntries(Object.entries(this.world.players).map(([playerId, player]) => {
      const account = this.accounts.get(playerId);
      return [playerId, {
        playerId,
        nickname: account?.nickname ?? playerId,
        teamName: account?.draft?.teamName ?? "未命名球队",
        color: account?.mapColor ?? "#4fa86d",
        homeTerritoryId: account?.homeTerritoryId ?? player.capitalTerritoryId ?? null,
        territoryIds: player.territoryIds ?? [],
      }];
    }));
    const activeChallenges = Object.fromEntries(Object.entries(this.world.activeChallenges ?? {}).map(([territoryId, challenge]) => [territoryId, publicChallengeView(challenge, now)]));
    const weather = this.campaignWeather(now);
    return { revision: this.world.revision, territories, players, activeChallenges, weather };
  }

  territoryMetadata(territoryId) {
    const territory = this.territoryIndex?.territories.find((candidate) => candidate.territoryId === territoryId);
    if (!territory) throw new Error("目标地块不存在");
    return territory;
  }

  ensureAiGarrison(territoryId) {
    const territory = this.territoryMetadata(territoryId);
    const territoryState = this.world?.territories?.[territoryId];
    if (!territoryState) throw new Error("目标地块不存在");
    if (territoryState.ownerType === OWNER_TYPES.PLAYER) return null;
    const current = this.world.aiGarrisons?.[territoryId];
    if (current?.schemaVersion === 2 && current.generatedForSeason === this.world.seasonId) return current;
    this.world.aiGarrisons ??= {};
    this.world.aiGarrisons[territoryId] = createTerritoryAiGarrison({ catalog:this.playerDatabase,territory,territoryState,seasonId:this.world.seasonId,generationSeed:this.world.aiGenerationSeed });
    this.save();
    return this.world.aiGarrisons[territoryId];
  }

  territoryIntel(account, territoryIdValue) {
    if (!this.world || !account.setupComplete) throw new Error("请先完成初始建队");
    const territoryId=String(territoryIdValue??"");
    const state=this.world.territories[territoryId];
    if (!state) throw new Error("目标地块不存在");
    if (state.ownerType===OWNER_TYPES.PLAYER) return {territoryId,ownerType:state.ownerType,ai:null};
    return {territoryId,ownerType:state.ownerType,ai:publicTerritoryAiIntel(this.ensureAiGarrison(territoryId),this.playerDatabase)};
  }

  buildingCatalog() {
    return this.buildings.catalog();
  }

  playerDirectory(account) {
    const rosterIds = new Set((account?.draft?.roster ?? []).map((player) => String(player.id)));
    const players = this.playerLibrary
      .filter((player) => LINE_KEYS.includes(player.pool))
      .map((player) => {
        const card = createPlayerCardViewModel(player);
        return {
          ...card,
          id: card.playerId,
          secondaryRole: player.secondaryRole ?? null,
          heightCm: Number(player.heightCm) || null,
          preferredFoot: player.preferredFoot ?? null,
          weakFoot: Number.isFinite(Number(player.weakFoot)) ? Number(player.weakFoot) : null,
          skillMoves: Number.isFinite(Number(player.skillMoves)) ? Number(player.skillMoves) : null,
          isX: player.isX === true,
          legendary: player.legendary === true,
          librarySource: "YDL",
          inRoster: rosterIds.has(String(player.id)),
        };
      });
    return { catalogVersion: PLAYER_CATALOG_VERSION, total: players.length, players };
  }

  territoryBuildings(account, territoryIdValue) {
    this.buildings.settleConstructions(this.world);
    return this.buildings.territoryView(account, this.world, territoryIdValue);
  }

  buildTerritoryBuilding(account, territoryIdValue, typeValue) {
    const result = this.buildings.build(account, this.world, territoryIdValue, typeValue);
    return { state: this.state(account), ...result };
  }

  upgradeTerritoryBuilding(account, territoryIdValue, buildingIdValue) {
    const result = this.buildings.upgrade(account, this.world, territoryIdValue, buildingIdValue);
    return { state: this.state(account), ...result };
  }

  renameTerritoryBuilding(account, territoryIdValue, buildingIdValue, nameValue) {
    const result = this.buildings.rename(account, this.world, territoryIdValue, buildingIdValue, nameValue);
    return { state: this.state(account), ...result };
  }

  state(account) {
    this.settleDueChallenges();
    this.buildings.settleConstructions(this.world);
    const setupComplete = account.setupComplete === true;
    const activeChallenge=Object.values(this.world?.activeChallenges ?? {}).find((challenge)=>challenge.attackerId===account.id) ?? null;
    const canExpand = Boolean(this.world && setupComplete && account.homeTerritoryId && this.world.players[account.id] && !activeChallenge);
    return {
      modeName: "黄狗风云",
      playerId: account.id,
      nickname: account.nickname,
      playerColor: account.mapColor,
      wallet:{ gold:Number(account.gold ?? 0) },
      buildings: setupComplete && this.world
        ? this.buildings.accountView(account, this.world)
        : { rules:null, catalog:this.buildings.catalog(), territories:{} },
      setupComplete,
      homeSelectionRequired: Boolean(this.world && setupComplete && !account.homeTerritoryId),
      homeTerritoryId: account.homeTerritoryId ?? null,
      draft: publicDraft(account),
      tactics: account.tactics ?? null,
      world: setupComplete ? this.publicWorld() : null,
      activeChallengeId:activeChallenge?.id ?? null,
      attackableTerritoryIds: canExpand ? listAttackableTerritories(this.territoryIndex, this.world, account.id).filter((territoryId) => !this.world.activeChallenges?.[territoryId]) : [],
      coastalTerritoryIds: this.maritimePlanner?.coastalTerritoryIds ?? [],
      battleHistory: (account.battleHistory ?? []).slice(-20).reverse(),
      primaryMatchEngine: CAMPAIGN_ENGINE,
    };
  }

  saveTactics(account, value = {}) {
    if (!account.setupComplete || !account.draft?.roster?.length) throw new Error("请先完成初始建队");
    const rosterIds = new Set(account.draft.roster.map((player) => player.id));
    const normalizeIds = (items) => [...new Set((Array.isArray(items) ? items : []).map(String).filter((id) => rosterIds.has(id)))];
    const starters = normalizeIds(value.starters);
    if (starters.length !== 11) throw new Error("必须从当前球员名单中选择恰好11名首发球员");
    const players = starters.map((id) => account.draft.roster.find((player) => player.id === id));
    const planSnapshots = value.planSnapshots && typeof value.planSnapshots === "object" ? structuredClone(value.planSnapshots) : {};
    const embedded = planSnapshots.__s4V2 && typeof planSnapshots.__s4V2 === "object" ? planSnapshots.__s4V2 : {};
    const presetKeys = ["position1","position2","position3"];
    const formationLinePresets = Object.fromEntries(presetKeys.map((key) => [key, sanitizeFormationLines(embedded.formationLinePresets?.[key] ?? value.formationLines)]));
    const positionPresets = Object.fromEntries(presetKeys.map((key) => {
      const source = embedded.positionPresets?.[key] ?? value.positions;
      const sanitized = sanitizeTacticsPositions(players, source);
      const formation = analyzeElevenBoardFormation(players, sanitized, formationLinePresets[key]);
      const validOutfieldLines = [formation.counts.DEF,formation.counts.MID,formation.counts.ATT].every((count) => count >= 1);
      if (formation.counts.GK !== 1 || (key === "position1" && !validOutfieldLines)) {
        const label = key === "position1" ? "默认站位" : key === "position2" ? "领先站位" : "落后站位";
        throw new Error(`${label}：门将必须且只能有一人${key === "position1" ? "，并保留前场、中场、后场三条外场线" : ""}`);
      }
      return [key,sanitized];
    }));
    const captainId = String(embedded.captainId ?? "");
    if (captainId && !starters.includes(captainId)) throw new Error("队长必须来自当前11人首发阵容");
    planSnapshots.__s4V2 = { ...embedded, starters:[...starters], positionPresets, formationLinePresets, captainId:captainId || starters[0] };
    const bench = account.draft.roster.map((player) => player.id).filter((id) => !starters.includes(id));
    const openingFormation = analyzeElevenBoardFormation(players, positionPresets.position1, formationLinePresets.position1);
    account.tactics = { formation:openingFormation.name, attackStyle: String(value.attackStyle || "balanced"), defenseStyle: String(value.defenseStyle || "possession"), starters, bench, positions:positionPresets.position1, formationLines:formationLinePresets.position1, tacticalBars: value.tacticalBars && typeof value.tacticalBars === "object" ? value.tacticalBars : {}, planSnapshots, activePlan: String(value.activePlan || "opening"), updatedAt: Date.now() };
    this.save();
    return this.state(account);
  }

  beginDraft(account, teamNameValue) {
    if (account.setupComplete) return this.state(account);
    if (!account.draft) {
      account.draft = { teamName: cleanText(teamNameValue, "球队名称", { min: 2, max: 20 }), roster: [], offer: [] };
      account.draft.offer = this.drawOffer(account.draft);
      this.save();
    }
    return this.state(account);
  }

  drawOffer(draft) {
    const chosenIds = new Set(draft.roster.map((player) => player.id));
    const remainingPicks = DRAFT_SIZE - draft.roster.length;
    const missing = missingMinimums(draft.roster);
    const totalMissing = Object.values(missing).reduce((sum, value) => sum + value, 0);
    const forcedLines = LINE_KEYS.filter((line) => missing[line] > 0);
    const forcedLine = remainingPicks <= totalMissing && forcedLines.length ? forcedLines.sort((left, right) => missing[right] - missing[left])[0] : null;
    const offer = [];
    while (offer.length < 3) {
      const line = forcedLine ?? weightedPick(LINE_WEIGHTS, this.random);
      const grade = weightedPick(GRADE_WEIGHTS, this.random);
      const blocked = new Set([...chosenIds, ...offer.map((player) => player.id)]);
      const exact = this.catalog.filter((player) => player.pool === line && player.grade === grade && !blocked.has(player.id));
      const sameLine = this.catalog.filter((player) => player.pool === line && !blocked.has(player.id));
      const any = this.catalog.filter((player) => !blocked.has(player.id));
      const candidates = exact.length ? exact : sameLine.length ? sameLine : any;
      if (!candidates.length) throw new Error("球员池不足，无法继续生成候选");
      offer.push(candidates[Math.floor(this.random() * candidates.length)]);
    }
    return offer;
  }

  choose(account, playerIdValue) {
    if (account.setupComplete) return this.state(account);
    if (!account.draft) throw new Error("请先建立球队并开始选人");
    const selected = account.draft.offer.find((player) => player.id === playerIdValue);
    if (!selected) throw new Error("该球员不在本轮候选中");
    account.draft.roster.push(selected);
    if (account.draft.roster.length === DRAFT_SIZE) {
      const counts = rosterCounts(account.draft.roster);
      const invalidLine = LINE_KEYS.find((line) => counts[line] < MINIMUM_PLAYERS_PER_LINE);
      if (invalidLine) throw new Error(`${LINE_LABELS[invalidLine]}至少需要${MINIMUM_PLAYERS_PER_LINE}名球员`);
      account.draft.offer = [];
      account.setupComplete = true;
    } else {
      account.draft.offer = this.drawOffer(account.draft);
    }
    this.save();
    return this.state(account);
  }

  chooseHome(account, territoryIdValue) {
    if (!this.world || !this.territoryIndex) throw new Error("共享世界尚未初始化");
    if (!account.setupComplete) throw new Error("请先完成初始球员选择");
    if (account.homeTerritoryId) throw new Error("主场已经确定，无法更改");
    const territoryId = String(territoryIdValue ?? "");
    const permission = canChooseHome(this.territoryIndex, this.world, account.id, territoryId);
    if (!permission.allowed) {
      const messages = {
        "player-already-has-territory": "你已经拥有主场，无法再次选择",
        "territory-not-spawnable": "该地块属于豪门中立势力，不能建立主场",
        "territory-not-neutral": "该地块已经被其他势力占据",
        "adjacent-to-neutral-club": "主场不能与黄色豪门中立区域直接接壤",
      };
      throw new Error(messages[permission.reason] ?? "该地块不能建立主场");
    }
    claimHome(this.territoryIndex, this.world, account.id, territoryId);
    account.homeTerritoryId = territoryId;
    this.buildings.ensureCapitalStadium(account, this.world, territoryId);
    this.save();
    return this.state(account);
  }

  maritimeRoutes(account, sourceTerritoryIdValue, pointValue) {
    return this.challenges.maritimeRoutes(account, sourceTerritoryIdValue, pointValue);
  }

  challengeTerritory(account, territoryIdValue, options = {}) {
    const result = this.challenges.begin(account, territoryIdValue, options);
    return { state: this.state(account), ...this.challengeStatus(account, result.challengeId) };
  }
}
