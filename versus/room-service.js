import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_PLAYER_BY_ID, REAL_PLAYERS } from "./player-pool.js";
import { VERSUS_TRAIT_BY_ID, VERSUS_TRAIT_CARDS } from "./trait-pool.js";
import { createLineupSeed, parseLineupSeed } from "./lineup-seed.js";
import {
  advanceVersusMatch,
  createVersusMatch,
  drawVersusReferee,
  drawVersusWeather,
  publicMatch,
  requestTacticalPause,
  resumeVersusMatch,
  updatePausedTactics,
} from "./match-engine.js";
import {
  VERSUS_TEAM_SIZE,
  VERSUS_FOCUSES,
  VERSUS_STYLES,
  VERSUS_TACTICS,
  analyzeElevenFormation,
  defaultElevenPositions,
  drawUniquePlayers,
  hydrateSelectedPlayers,
  sanitizePositions,
} from "./rules.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINEUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const DRAFT_DURATION_MS = 120_000;
const TACTICS_DURATION_MS = 75_000;
const SPECTATOR_TTL_MS = 12_000;
const S_GRADE_PLAYERS = REAL_PLAYERS.filter((player) => player.grade === "S");
const DEFAULT_ACCOUNTS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/versus-accounts.json");
const SHARED_LINEUPS = new Map();

function token(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

function roomCode(random = Math.random) {
  return Array.from({ length: 6 }, () => ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)]).join("");
}

function lineupCode(lineups) {
  let code;
  do {
    code = Array.from({ length: 11 }, () => LINEUP_CODE_ALPHABET[Math.floor(Math.random() * LINEUP_CODE_ALPHABET.length)]).join("");
  } while (lineups.has(code) || !/[A-Z]/.test(code) || !/[0-9]/.test(code));
  return code;
}

function normalizeSummary(summary = {}) {
  return {
    played: Number(summary.played ?? 0), wins: Number(summary.wins ?? 0), losses: Number(summary.losses ?? 0),
    goalsFor: Number(summary.goalsFor ?? 0), goalsAgainst: Number(summary.goalsAgainst ?? 0),
    goals: Number(summary.goals ?? 0), assists: Number(summary.assists ?? 0),
  };
}

function cleanPlayerId(value) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(id)) throw new Error("玩家ID需为3至24位字母、数字、下划线或短横线");
  return id;
}

function generatedPlayerId(accounts) {
  let id;
  do id = `P-${randomBytes(5).toString("hex").toUpperCase()}`;
  while (accounts.has(id.toLowerCase()));
  return id;
}

function cleanRoomCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{6,20}$/.test(code)) throw new Error("自定义分享码需为6至20位字母、数字、下划线或短横线");
  return code;
}

function cleanName(value, fallback) {
  const name = String(value ?? "").trim().slice(0, 18);
  return name || fallback;
}

function createSeat(id, name, accountId = null) {
  return {
    id,
    name,
    accountId,
    selections: [],
    startingIds: [],
    draftBaseCount: 0,
    importedLineup: false,
    offer: null,
    guaranteedPlayerId: null,
    guaranteeShown: false,
    guaranteeResolved: false,
    positions: {},
    tactic: "balanced",
    style: "possession",
    attackFocus: "balanced",
    defenseFocus: "balanced",
    ready: false,
  };
}

function clone(value) {
  return structuredClone(value);
}

function selectedPlayerIds(room) {
  return room.players.flatMap((seat) => seat && !seat.importedLineup ? seat.selections.map((selection) => selection.playerId) : []);
}

function isTournamentSecondLeg(room) {
  return room.competitionMode === "tournament" && Number(room.legNumber) === 2;
}

function draftTarget(room) {
  return isTournamentSecondLeg(room) ? 16 : VERSUS_TEAM_SIZE;
}

function starterSelections(seat) {
  const ids = new Set(seat.startingIds?.length === VERSUS_TEAM_SIZE ? seat.startingIds : seat.selections.slice(0, VERSUS_TEAM_SIZE).map((selection) => selection.playerId));
  return seat.selections.filter((selection) => ids.has(selection.playerId)).slice(0, VERSUS_TEAM_SIZE);
}

function draftLineState(room, seat) {
  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  seat.selections.forEach((selection) => { counts[REAL_PLAYER_BY_ID[selection.playerId].pool] += 1; });
  if (isTournamentSecondLeg(room)) {
    const remaining = Math.max(0, draftTarget(room) - seat.selections.length);
    const guaranteedPlayer = REAL_PLAYER_BY_ID[seat.guaranteedPlayerId];
    const hasNewLegend = seat.selections.slice(seat.draftBaseCount ?? 0).some((selection) => REAL_PLAYER_BY_ID[selection.playerId].grade === "S");
    const forceGuaranteePool = guaranteedPlayer && !seat.guaranteeShown && !hasNewLegend && remaining <= 1;
    return { counts, missingPools: [], remaining, availablePools: forceGuaranteePool ? [guaranteedPlayer.pool] : Object.keys(counts) };
  }
  const missingPools = Object.keys(counts).filter((pool) => counts[pool] === 0);
  const remaining = draftTarget(room) - seat.selections.length;
  const poolsBelowLimit = Object.keys(counts).filter((pool) => pool !== "GK" || counts.GK < 1);
  let availablePools = remaining <= missingPools.length ? missingPools : poolsBelowLimit;
  const guaranteedPlayer = REAL_PLAYER_BY_ID[seat.guaranteedPlayerId];
  const hasSGradePlayer = seat.selections.slice(seat.draftBaseCount ?? 0).some((selection) => REAL_PLAYER_BY_ID[selection.playerId].grade === "S");
  const guaranteePending = guaranteedPlayer && !seat.guaranteeShown && !hasSGradePlayer;
  if (guaranteePending && availablePools.includes(guaranteedPlayer.pool) && remaining <= missingPools.length + 1 && (remaining > missingPools.length || missingPools.includes(guaranteedPlayer.pool))) {
    availablePools = [guaranteedPlayer.pool];
  }
  return {
    counts,
    missingPools,
    remaining,
    availablePools,
  };
}

function traitFitsPlayer(trait, player) {
  const eligible = trait.eligibleRoleGroups ?? [];
  return eligible.includes("ANY") || eligible.includes(player.pool) || eligible.includes(player.role);
}

function drawTraits(player, excludedIds = [], rng = Math.random) {
  const excluded = new Set(excludedIds);
  const compatible = VERSUS_TRAIT_CARDS.filter((trait) => traitFitsPlayer(trait, player) && !excluded.has(trait.id));
  const choices = [];
  while (choices.length < 3 && compatible.length) choices.push(compatible.splice(Math.floor(rng() * compatible.length), 1)[0]);
  return choices.map((trait) => trait.id);
}

function publicTrait(traitId) {
  const trait = VERSUS_TRAIT_BY_ID[traitId];
  return trait ? { id: trait.id, name: trait.name, summary: trait.summary, rarity: trait.rarity, category: trait.category } : null;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    pool: player.pool,
    role: player.role,
    secondaryRole: player.secondaryRole,
    preferredFoot: player.preferredFoot,
    heightCm: player.heightCm,
    nationality: player.nationality,
    club: player.club,
    overall: player.overall,
    grade: player.grade,
    attributes: player.attributes,
    signature: player.signature,
    archetype: player.archetype,
    individualized: player.individualized,
  };
}

function assignSGuarantees(room, rng) {
  const selected = new Set(selectedPlayerIds(room));
  const available = S_GRADE_PLAYERS.filter((player) => !selected.has(player.id));
  room.players.forEach((seat) => {
    const index = Math.floor(rng() * available.length);
    seat.guaranteedPlayerId = available.splice(index, 1)[0].id;
    seat.guaranteeShown = false;
    seat.guaranteeResolved = false;
  });
}

function unavailablePlayerIds(room, drawingSeat) {
  const reservedByOthers = room.players
    .filter((seat) => seat && seat !== drawingSeat && !seat.guaranteeResolved)
    .map((seat) => seat.guaranteedPlayerId)
    .filter(Boolean);
  return [...selectedPlayerIds(room), ...reservedByOthers];
}

export class VersusRoomService {
  constructor(options = {}) {
    this.rooms = new Map();
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    this.accountsPath = options.accountsPath === undefined ? DEFAULT_ACCOUNTS_PATH : options.accountsPath;
    this.accounts = new Map();
    this.lineups = options.lineups ?? SHARED_LINEUPS;
    if (this.accountsPath && existsSync(this.accountsPath)) {
      try {
        const saved = JSON.parse(readFileSync(this.accountsPath, "utf8"));
        Object.values(saved.accounts ?? {}).forEach((account) => {
          account.summary = normalizeSummary(account.summary);
          account.matches = (account.matches ?? []).map((match) => ({ ...match, result: match.result === "leg" ? "leg" : match.result === "win" ? "win" : "loss" }));
          this.accounts.set(account.key, account);
        });
        Object.entries(saved.lineups ?? {}).forEach(([code, seed]) => this.lineups.set(code, seed));
      } catch { this.accounts = new Map(); }
    }
  }

  saveAccounts() {
    if (!this.accountsPath) return;
    writeFileSync(this.accountsPath, JSON.stringify({ version: 3, accounts: Object.fromEntries(this.accounts), lineups: Object.fromEntries(this.lineups) }, null, 2));
  }

  bindAccount(playerIdValue, accountToken = null, nickname = "") {
    if (accountToken) {
      const existing = [...this.accounts.values()].find((candidate) => candidate.token === accountToken);
      if (!existing) throw new Error("设备绑定凭证无效，请清除本地账号数据后重试");
      if (nickname) existing.nickname = cleanName(nickname, existing.nickname);
      existing.lastSeenAt = this.now();
      this.saveAccounts();
      return { accountToken: existing.token, profile: this.publicProfile(existing) };
    }
    const id = playerIdValue ? cleanPlayerId(playerIdValue) : generatedPlayerId(this.accounts);
    const key = id.toLowerCase();
    let account = this.accounts.get(key);
    if (account) throw new Error("该玩家ID已经绑定");
    if (!account) {
      account = {
        key,
        id,
        token: token(24),
        nickname: cleanName(nickname, id),
        createdAt: this.now(),
        summary: normalizeSummary(),
        matches: [],
      };
      this.accounts.set(key, account);
    } else if (nickname) account.nickname = cleanName(nickname, account.nickname);
    account.lastSeenAt = this.now();
    this.saveAccounts();
    return { accountToken: account.token, profile: this.publicProfile(account) };
  }

  account(playerIdValue, accountToken) {
    const key = cleanPlayerId(playerIdValue).toLowerCase();
    const account = this.accounts.get(key);
    if (!account || account.token !== accountToken) throw new Error("玩家ID尚未绑定或绑定凭证无效");
    return account;
  }

  publicProfile(account) {
    const matches = account.matches.filter((match) => match.result !== "leg").slice(0, 20).map(({ detail, viewerIndex, ...match }) => ({
      ...match,
      hasDetails: Boolean(detail),
      ownFormation: detail?.teams?.[viewerIndex]?.formation ?? null,
      opponentFormation: detail?.teams?.[viewerIndex === 0 ? 1 : 0]?.formation ?? null,
    }));
    return clone({ id: account.id, nickname: account.nickname, summary: normalizeSummary(account.summary), matches });
  }

  profile(playerIdValue, accountToken) {
    return this.publicProfile(this.account(playerIdValue, accountToken));
  }

  profileMatch(playerIdValue, accountToken, matchId) {
    const account = this.account(playerIdValue, accountToken);
    const match = account.matches.find((candidate) => candidate.id === matchId);
    if (!match) throw new Error("找不到这场历史对局");
    if (!match.detail) throw new Error("这场对局来自旧版本，当时没有保存详细赛后数据");
    return clone({ ...match.detail, viewerIndex: match.viewerIndex });
  }

  cleanup() {
    const cutoff = this.now() - ROOM_TTL_MS;
    for (const [code, room] of this.rooms) if (room.updatedAt < cutoff) this.rooms.delete(code);
  }

  cleanupSpectators(room) {
    if (!room.spectators) return;
    const cutoff = this.now() - SPECTATOR_TTL_MS;
    Object.entries(room.spectators).forEach(([spectatorToken, spectator]) => {
      if (spectator.lastSeenAt < cutoff) delete room.spectators[spectatorToken];
    });
  }

  spectatorList(room) {
    this.cleanupSpectators(room);
    return Object.values(room.spectators ?? {}).map(({ name }) => ({ name }));
  }

  broadcasts() {
    this.cleanup();
    const broadcasts = [];
    for (const room of this.rooms.values()) {
      this.advanceRoom(room);
      if (room.phase !== "match" || !room.match) continue;
      this.cleanupSpectators(room);
      broadcasts.push({
        code: room.code,
        round: Number(room.round ?? 1),
        teams: room.match.teams.map((team) => ({ name: team.name, formation: analyzeElevenFormation(team.players.filter((player) => player.active), team.positions).name })),
        score: room.match.teams.map((team) => team.score),
        minute: room.match.minute,
        segment: room.match.segment,
        weather: room.match.weather,
        spectatorCount: Object.keys(room.spectators ?? {}).length,
      });
    }
    return clone(broadcasts);
  }

  broadcastView(room) {
    if (!room.match || !["match", "report"].includes(room.phase)) throw new Error("这场比赛尚未开始或已经结束");
    this.cleanupSpectators(room);
    return clone({
      code: room.code,
      round: Number(room.round ?? 1),
      live: room.phase === "match",
      spectators: this.spectatorList(room),
      match: publicMatch(room.match, this.now(), null, true),
    });
  }

  watch(codeValue, spectatorName, existingToken = null) {
    const room = this.getRoom(codeValue);
    if (room.phase !== "match" || !room.match) throw new Error("这场比赛当前不在直播中");
    room.spectators ??= {};
    let spectatorToken = existingToken && room.spectators[existingToken] ? existingToken : token(18);
    room.spectators[spectatorToken] = {
      name: cleanName(spectatorName, "匿名观众"),
      lastSeenAt: this.now(),
    };
    return { spectatorToken, broadcast: this.broadcastView(room) };
  }

  watchView(codeValue, spectatorToken) {
    const room = this.getRoom(codeValue);
    const spectator = room.spectators?.[spectatorToken];
    if (!spectator) throw new Error("观赛会话已过期，请重新进入直播");
    spectator.lastSeenAt = this.now();
    return this.broadcastView(room);
  }

  leaveWatch(codeValue, spectatorToken) {
    const room = this.getRoom(codeValue);
    if (room.spectators?.[spectatorToken]) delete room.spectators[spectatorToken];
    return { left: true };
  }

  create(playerName, customCode = null, playerId = null, accountToken = null, competitionMode = "quick") {
    this.cleanup();
    const account = playerId ? this.account(playerId, accountToken) : null;
    let code = customCode ? cleanRoomCode(customCode) : roomCode(this.rng);
    if (customCode && this.rooms.has(code)) throw new Error("该分享码正在使用，请换一个");
    while (this.rooms.has(code)) code = roomCode(Math.random);
    const hostToken = token();
    const now = this.now();
    const room = {
      code,
      version: 1,
      phase: "lobby",
      createdAt: now,
      updatedAt: now,
      players: [createSeat(hostToken, cleanName(playerName, account?.nickname ?? "房主"), account?.key), null],
      round: 1,
      competitionMode: competitionMode === "tournament" ? "tournament" : "quick",
      legNumber: 1,
      firstLeg: null,
      rematchReady: [false, false],
    };
    this.rooms.set(code, room);
    return { token: hostToken, room: this.view(room, hostToken) };
  }

  join(codeValue, playerName, playerId = null, accountToken = null) {
    const room = this.getRoom(codeValue);
    if (room.players[1]) throw new Error("房间已满");
    const account = playerId ? this.account(playerId, accountToken) : null;
    if (account && room.players[0]?.accountId === account.key) throw new Error("同一玩家ID不能同时占用两个位置");
    const guestToken = token();
    room.players[1] = createSeat(guestToken, cleanName(playerName, account?.nickname ?? "好友"), account?.key);
    assignSGuarantees(room, this.rng);
    room.phase = "draft";
    room.phaseDeadline = this.now() + DRAFT_DURATION_MS;
    room.updatedAt = this.now();
    return { token: guestToken, room: this.view(room, guestToken) };
  }

  createDeveloperRoom(playerName, quickStart = false) {
    const created = this.create(playerName);
    const room = this.rooms.get(created.room.code);
    room.developerMode = true;
    room.players[1] = createSeat(token(), "开发测试对手");
    assignSGuarantees(room, this.rng);
    room.phase = "draft";
    room.phaseDeadline = this.now() + DRAFT_DURATION_MS;
    this.autoCompleteDraft(room, room.players[1]);
    if (quickStart) {
      this.autoCompleteDraft(room, room.players[0]);
      this.beginTactics(room);
      room.players.forEach((seat) => { seat.ready = true; });
      this.beginMatch(room);
    }
    room.updatedAt = this.now();
    return { token: room.players[0].id, room: this.view(room, room.players[0].id) };
  }

  getRoom(codeValue) {
    this.cleanup();
    const code = String(codeValue ?? "").trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new Error("房间不存在或已过期");
    this.advanceRoom(room);
    return room;
  }

  advanceRoom(room) {
    const now = this.now();
    if (room.phase === "draft" && now >= room.phaseDeadline) {
      room.players.forEach((seat) => this.autoCompleteDraft(room, seat));
      this.beginTactics(room, now);
    }
    if (room.phase === "tactics" && now >= room.phaseDeadline) {
      room.players.forEach((seat) => {
        const players = hydrateSelectedPlayers(starterSelections(seat));
        if (!analyzeElevenFormation(players, seat.positions).valid) seat.positions = defaultElevenPositions(players);
        seat.ready = true;
      });
      this.beginMatch(room, now);
    }
    if (room.phase === "match") {
      advanceVersusMatch(room.match, now);
      if (room.match.finished) {
        room.phase = "report";
        if (room.competitionMode === "tournament" && room.legNumber === 1) {
          room.firstLeg = { score: [...room.match.report.score], report: clone(room.match.report) };
          this.recordMatch(room, false);
        } else this.recordMatch(room, true);
      }
    }
  }

  recordMatch(room, countsForCareer = true) {
    if (room.historyRecorded || !room.match?.report) return;
    const report = room.match.report;
    const playedAt = this.now();
    const matchId = room.matchHistoryId ?? `${room.code}-${room.round ?? 1}-${token(9)}`;
    room.matchHistoryId = matchId;
    const detail = {
      id: matchId,
      roomCode: room.code,
      round: Number(room.round ?? 1),
      playedAt,
      score: [...report.score],
      aggregateBaseScore: report.aggregateBaseScore ? [...report.aggregateBaseScore] : null,
      aggregateScore: report.aggregateScore ? [...report.aggregateScore] : null,
      competitionMode: room.competitionMode ?? "quick",
      legNumber: Number(room.legNumber ?? 1),
      firstLeg: room.firstLeg?.report ?? null,
      penalties: report.penalties ? [...report.penalties] : null,
      winnerIndex: report.winnerIndex,
      weather: report.weather,
      referee: report.referee,
      blackWhistle: report.blackWhistle,
      teams: report.teams.map((team) => ({
        name: team.name,
        importedLineup: team.importedLineup,
        tactic: team.tactic,
        style: team.style,
        attackFocus: team.attackFocus,
        defenseFocus: team.defenseFocus,
        styleFit: team.styleFit,
        markingTargetName: team.markingTargetName,
        formation: team.formation,
        activeCount: team.activeCount,
        stats: team.stats,
        players: team.players.map((player) => ({
          id: player.id,
          name: player.name,
          role: player.role,
          rating: player.rating,
          fitness: player.fitness,
          active: player.active,
          sentOff: player.sentOff,
          injury: player.injury,
          stats: player.stats,
        })),
      })),
      importantEvents: report.importantEvents,
    };
    room.players.forEach((seat, index) => {
      if (!seat.accountId) return;
      const account = this.accounts.get(seat.accountId);
      if (!account) return;
      const opponentIndex = index === 0 ? 1 : 0;
      const team = report.teams[index];
      const opponent = room.players[opponentIndex];
      const firstLegTeam = countsForCareer && room.competitionMode === "tournament" ? room.firstLeg?.report?.teams?.[index] : null;
      const goals = team.players.reduce((sum, player) => sum + Number(player.stats?.goals ?? 0), 0)
        + (firstLegTeam?.players ?? []).reduce((sum, player) => sum + Number(player.stats?.goals ?? 0), 0);
      const assists = team.players.reduce((sum, player) => sum + Number(player.stats?.assists ?? 0), 0)
        + (firstLegTeam?.players ?? []).reduce((sum, player) => sum + Number(player.stats?.assists ?? 0), 0);
      const won = report.winnerIndex === index;
      const recordedScore = report.aggregateScore ?? report.score;
      if (countsForCareer) {
        account.summary.played += 1;
        account.summary.wins += won ? 1 : 0;
        account.summary.losses += won ? 0 : 1;
        account.summary.goalsFor += recordedScore[index];
        account.summary.goalsAgainst += recordedScore[opponentIndex];
        account.summary.goals += goals;
        account.summary.assists += assists;
      }
      account.matches.unshift({
        id: matchId,
        roomCode: room.code,
        round: Number(room.round ?? 1),
        playedAt,
        opponentId: opponent?.accountId ? this.accounts.get(opponent.accountId)?.id ?? null : null,
        opponentName: opponent?.name ?? "好友",
        scoreFor: recordedScore[index],
        scoreAgainst: recordedScore[opponentIndex],
        result: countsForCareer ? (won ? "win" : "loss") : "leg",
        goals,
        assists,
        viewerIndex: index,
        detail,
      });
      account.matches = account.matches.slice(0, 100);
    });
    room.historyRecorded = true;
    this.saveAccounts();
  }

  autoCompleteDraft(room, seat) {
    seat.offer = null;
    const target = draftTarget(room);
    if (seat.selections.length >= target) {
      const starters = hydrateSelectedPlayers(starterSelections(seat));
      seat.positions = sanitizePositions(starters, seat.positions);
      return;
    }
    const targetCounts = { GK: 1, DEF: 4, MID: 3, ATT: 3 };
    let guaranteedPlayer = REAL_PLAYER_BY_ID[seat.guaranteedPlayerId];
    const hasSGradePlayer = seat.selections.slice(seat.draftBaseCount ?? 0).some((selection) => REAL_PLAYER_BY_ID[selection.playerId].grade === "S");
    const draftState = draftLineState(room, seat);
    if (guaranteedPlayer && !draftState.availablePools.includes(guaranteedPlayer.pool)) {
      guaranteedPlayer = S_GRADE_PLAYERS.find((player) => draftState.availablePools.includes(player.pool) && !unavailablePlayerIds(room, seat).includes(player.id));
      seat.guaranteedPlayerId = guaranteedPlayer?.id ?? seat.guaranteedPlayerId;
    }
    if (!hasSGradePlayer && guaranteedPlayer && draftState.availablePools.includes(guaranteedPlayer.pool) && !selectedPlayerIds(room).includes(guaranteedPlayer.id)) {
      seat.selections.push({ playerId: guaranteedPlayer.id, traitIds: [drawTraits(guaranteedPlayer, [], this.rng)[0]] });
      seat.guaranteeShown = true;
      seat.guaranteeResolved = true;
    }
    while (seat.selections.length < target) {
      const state = draftLineState(room, seat);
      const greatestDeficit = Math.max(...state.availablePools.map((pool) => targetCounts[pool] - state.counts[pool]));
      const preferredPools = isTournamentSecondLeg(room) ? state.availablePools : state.availablePools.filter((pool) => targetCounts[pool] - state.counts[pool] === greatestDeficit);
      const pool = preferredPools[Math.floor(this.rng() * preferredPools.length)];
      const player = drawUniquePlayers(pool, unavailablePlayerIds(room, seat), this.rng, 1)[0];
      if (!player) throw new Error("自动选秀时可用球员不足");
      const innateTraitId = drawTraits(player, [], this.rng)[0];
      seat.selections.push({ playerId: player.id, traitIds: [innateTraitId] });
    }
    if (!isTournamentSecondLeg(room)) {
      seat.startingIds = seat.selections.map((selection) => selection.playerId);
      seat.positions = defaultElevenPositions(hydrateSelectedPlayers(seat.selections));
    }
    seat.ready = false;
  }

  beginTactics(room, now = this.now()) {
    room.phase = "tactics";
    room.phaseDeadline = now + TACTICS_DURATION_MS;
    room.weather ??= drawVersusWeather(this.rng);
    room.referee ??= drawVersusReferee(this.rng);
    room.players.forEach((seat) => {
      const players = hydrateSelectedPlayers(starterSelections(seat));
      if (!Object.keys(seat.positions).length) seat.positions = defaultElevenPositions(players);
      seat.ready = false;
    });
    if (room.developerMode) room.players[1].ready = true;
  }

  beginMatch(room, now = this.now()) {
    room.phase = "match";
    room.phaseDeadline = null;
    room.match = createVersusMatch(room.players.map((seat) => ({
      name: seat.name,
      players: hydrateSelectedPlayers(starterSelections(seat)),
      positions: seat.positions,
      tactic: seat.tactic,
      style: seat.style,
      attackFocus: seat.attackFocus,
      defenseFocus: seat.defenseFocus,
      importedLineup: seat.importedLineup,
    })), {
      now, seed: `${room.code}:${room.createdAt}:${room.round ?? 1}:${room.legNumber ?? 1}`,
      weather: room.weather?.key, referee: room.referee?.key,
      competitionMode: room.competitionMode,
      legNumber: room.legNumber,
      regulationOnly: room.competitionMode === "tournament" && room.legNumber === 1,
      aggregateBaseScore: room.competitionMode === "tournament" && room.legNumber === 2 ? room.firstLeg?.score : null,
    });
    room.updatedAt = now;
  }

  seat(room, playerToken) {
    const index = room.players.findIndex((seat) => seat?.id === playerToken);
    if (index < 0) throw new Error("房间身份无效");
    return { seat: room.players[index], index };
  }

  drawPlayers(code, playerToken, pool) {
    const room = this.getRoom(code);
    const { seat } = this.seat(room, playerToken);
    if (room.phase !== "draft") throw new Error("当前不在选人阶段");
    if (seat.selections.length >= draftTarget(room)) throw new Error("本阶段选人次数已经用完");
    if (seat.offer) throw new Error("本轮球员三选一已经锁定");
    if (!draftLineState(room, seat).availablePools.includes(pool)) throw new Error("剩余名额必须用于补齐缺失阵线");
    const guaranteedPlayer = REAL_PLAYER_BY_ID[seat.guaranteedPlayerId];
    const guaranteeApplies = !seat.guaranteeShown && guaranteedPlayer?.pool === pool;
    const unavailable = unavailablePlayerIds(room, seat);
    const choices = drawUniquePlayers(pool, unavailable, this.rng, 3, guaranteeApplies ? [guaranteedPlayer] : []);
    if (choices.length < 3) throw new Error("该位置池可用球员不足");
    if (choices.some((player) => player.grade === "S")) seat.guaranteeShown = true;
    seat.offer = { type: "player", pool, choiceIds: choices.map((player) => player.id), guaranteeOffer: choices.some((player) => player.grade === "S") };
    room.updatedAt = this.now();
    return this.view(room, playerToken);
  }

  choosePlayer(code, playerToken, playerId) {
    const room = this.getRoom(code);
    const { seat } = this.seat(room, playerToken);
    if (seat.offer?.type !== "player" || !seat.offer.choiceIds.includes(playerId)) throw new Error("球员不在当前三选一中");
    if (selectedPlayerIds(room).includes(playerId)) {
      seat.offer = null;
      room.updatedAt = this.now();
      throw new Error("该球员刚刚被好友选走，请重新抽取");
    }
    const player = REAL_PLAYER_BY_ID[playerId];
    if (!isTournamentSecondLeg(room) && player.pool === "GK" && draftLineState(room, seat).counts.GK >= 1) {
      seat.offer = null;
      room.updatedAt = this.now();
      throw new Error("每支球队只能选择一名门将");
    }
    if (seat.offer.guaranteeOffer && player.grade === "S") seat.guaranteeResolved = true;
    if (seat.offer.guaranteeOffer && player.grade !== "S") {
      const unavailable = unavailablePlayerIds(room, seat);
      const goalkeeperFilled = !isTournamentSecondLeg(room) && (player.pool === "GK" || draftLineState(room, seat).counts.GK >= 1);
      const replacement = S_GRADE_PLAYERS.find((candidate) => (candidate.pool !== "GK" || !goalkeeperFilled) && !unavailable.includes(candidate.id));
      seat.guaranteedPlayerId = replacement?.id ?? seat.guaranteedPlayerId;
      seat.guaranteeShown = false;
      seat.guaranteeResolved = false;
    }
    const innateTraitId = drawTraits(player, [], this.rng)[0];
    if (!innateTraitId) throw new Error("没有可用的适配特性卡");
    seat.selections.push({ playerId, traitIds: [innateTraitId] });
    seat.offer = null;
    seat.ready = false;
    if (seat.selections.length === draftTarget(room) && !isTournamentSecondLeg(room)) {
      const players = hydrateSelectedPlayers(seat.selections);
      seat.startingIds = seat.selections.map((selection) => selection.playerId);
      seat.positions = defaultElevenPositions(players);
    }
    if (room.players.every((entry) => entry?.selections.length === draftTarget(room))) this.beginTactics(room);
    room.updatedAt = this.now();
    return this.view(room, playerToken);
  }

  chooseTrait() {
    throw new Error("特性卡选择环节已移除");
  }

  importLineup(code, playerToken, seedValue) {
    const room = this.getRoom(code);
    const { seat } = this.seat(room, playerToken);
    if (room.phase !== "draft") throw new Error("只能在开局选秀阶段导入阵容");
    if (seat.selections.length || seat.offer) throw new Error("只有尚未开始选秀时才能导入阵容");
    const enteredCode = String(seedValue ?? "").trim().toUpperCase();
    const isShortCode = /^[A-Z0-9]{11}$/.test(enteredCode);
    const storedSeed = isShortCode ? this.lineups.get(enteredCode) : null;
    if (isShortCode && !storedSeed) throw new Error("阵容ID不存在或已失效");
    const lineup = parseLineupSeed(storedSeed ?? seedValue);
    seat.selections = lineup.selections;
    seat.positions = lineup.positions;
    seat.tactic = lineup.tactic;
    seat.style = lineup.style;
    seat.attackFocus = lineup.attackFocus;
    seat.defenseFocus = lineup.defenseFocus;
    seat.importedLineup = true;
    seat.guaranteeShown = true;
    seat.guaranteeResolved = true;
    seat.ready = false;
    room.updatedAt = this.now();
    seat.startingIds = seat.selections.map((selection) => selection.playerId);
    if (room.players.every((entry) => entry?.selections.length === draftTarget(room))) this.beginTactics(room);
    return this.view(room, playerToken);
  }

  exportLineup(code, playerToken) {
    const room = this.getRoom(code);
    const { seat, index } = this.seat(room, playerToken);
    if (room.phase !== "report" || !room.match?.report) throw new Error("比赛结束后才能导出阵容");
    const team = room.match.teams[index];
    const seed = createLineupSeed({
      selections: starterSelections(seat),
      positions: team.positions,
      tactic: team.tactic,
      style: team.style,
      attackFocus: team.attackFocus,
      defenseFocus: team.defenseFocus,
    });
    const codeValue = lineupCode(this.lineups);
    this.lineups.set(codeValue, seed);
    this.saveAccounts();
    return { seed: codeValue, formation: analyzeElevenFormation(team.players, team.positions).name };
  }

  requestRematch(code, playerToken) {
    const room = this.getRoom(code);
    const { index } = this.seat(room, playerToken);
    if (room.phase !== "report") throw new Error("比赛结束后才能申请再来一局");
    room.rematchReady ??= [false, false];
    room.rematchReady[index] = true;
    if (room.developerMode) room.rematchReady[index === 0 ? 1 : 0] = true;
    if (room.rematchReady.every(Boolean)) {
      const now = this.now();
      const beginsSecondLeg = room.competitionMode === "tournament" && room.legNumber === 1;
      if (beginsSecondLeg) {
        room.legNumber = 2;
        room.players.forEach((seat) => {
          seat.offer = null;
          seat.ready = false;
          seat.draftBaseCount = seat.selections.length;
          seat.startingIds = seat.selections.slice(0, VERSUS_TEAM_SIZE).map((selection) => selection.playerId);
          seat.guaranteeShown = false;
          seat.guaranteeResolved = false;
          seat.importedLineup = false;
        });
      } else {
        room.players = room.players.map((seat) => createSeat(seat.id, seat.name, seat.accountId));
        room.round = Number(room.round ?? 1) + 1;
        room.legNumber = 1;
        room.firstLeg = null;
      }
      assignSGuarantees(room, this.rng);
      room.phase = "draft";
      room.phaseDeadline = now + DRAFT_DURATION_MS;
      room.weather = null;
      room.referee = null;
      room.match = null;
      room.matchHistoryId = null;
      room.spectators = {};
      room.historyRecorded = false;
      room.rematchReady = [false, false];
      room.updatedAt = now;
    } else {
      room.updatedAt = this.now();
    }
    return this.view(room, playerToken);
  }

  saveTactics(code, playerToken, payload = {}) {
    const room = this.getRoom(code);
    const { seat } = this.seat(room, playerToken);
    if (room.phase !== "tactics" || seat.selections.length !== draftTarget(room)) throw new Error("阵容尚未完成");
    if (isTournamentSecondLeg(room)) {
      const selectedIds = new Set(seat.selections.map((selection) => selection.playerId));
      const startingIds = [...new Set(payload.startingIds ?? seat.startingIds ?? [])];
      if (startingIds.length !== VERSUS_TEAM_SIZE || startingIds.some((id) => !selectedIds.has(id))) throw new Error("第二回合必须从16人名单中选择11名首发");
      seat.startingIds = startingIds;
    }
    const players = hydrateSelectedPlayers(starterSelections(seat));
    const positions = sanitizePositions(players, payload.positions);
    const formation = analyzeElevenFormation(players, positions);
    const attackFocus = payload.attackFocus ?? seat.attackFocus ?? "balanced";
    const defenseFocus = payload.defenseFocus ?? seat.defenseFocus ?? "balanced";
    if (payload.ready && !formation.valid) throw new Error(formation.message);
    if (!VERSUS_TACTICS.includes(payload.tactic)) throw new Error("无效比赛思路");
    if (!VERSUS_STYLES.includes(payload.style)) throw new Error("无效比赛战术");
    if (!VERSUS_FOCUSES.includes(attackFocus)) throw new Error("无效主攻方向");
    if (!VERSUS_FOCUSES.includes(defenseFocus)) throw new Error("无效主守方向");
    seat.positions = positions;
    seat.tactic = payload.tactic;
    seat.style = payload.style;
    seat.attackFocus = attackFocus;
    seat.defenseFocus = defenseFocus;
    seat.ready = Boolean(payload.ready);
    room.updatedAt = this.now();
    if (room.players.every((player) => player?.ready)) this.beginMatch(room);
    return this.view(room, playerToken);
  }

  requestPause(code, playerToken) {
    const room = this.getRoom(code);
    const { index } = this.seat(room, playerToken);
    if (room.phase !== "match") throw new Error("当前没有进行中的比赛");
    requestTacticalPause(room.match, index, this.now());
    room.updatedAt = this.now();
    return this.view(room, playerToken);
  }

  saveLiveTactics(code, playerToken, payload = {}) {
    const room = this.getRoom(code);
    const { index } = this.seat(room, playerToken);
    if (room.phase !== "match") throw new Error("当前没有进行中的比赛");
    updatePausedTactics(room.match, index, payload);
    room.updatedAt = this.now();
    return this.view(room, playerToken);
  }

  resumeMatch(code, playerToken) {
    const room = this.getRoom(code);
    const { index } = this.seat(room, playerToken);
    if (room.phase !== "match") throw new Error("当前没有进行中的比赛");
    resumeVersusMatch(room.match, index, this.now());
    room.updatedAt = this.now();
    return this.view(room, playerToken);
  }

  view(room, playerToken = null) {
    this.advanceRoom(room);
    this.cleanupSpectators(room);
    const now = this.now();
    const viewerIndex = room.players.findIndex((seat) => seat?.id === playerToken);
    const players = room.players.map((seat, index) => {
      if (!seat) return null;
      const hydrated = hydrateSelectedPlayers(seat.selections);
      const startingIdSet = new Set(starterSelections(seat).map((selection) => selection.playerId));
      const starters = hydrated.filter((player) => startingIdSet.has(player.id));
      const formation = starters.length === VERSUS_TEAM_SIZE ? analyzeElevenFormation(starters, seat.positions) : null;
      const isViewer = index === viewerIndex;
      const opponentLineupVisible = ["match", "report"].includes(room.phase);
      const lineupVisible = isViewer || opponentLineupVisible;
      return {
        name: seat.name,
        playerId: seat.accountId ? this.accounts.get(seat.accountId)?.id ?? null : null,
        selectionCount: seat.selections.length,
        draftLines: isViewer ? draftLineState(room, seat) : null,
        ready: seat.ready,
        importedLineup: isViewer || opponentLineupVisible ? seat.importedLineup : null,
        tactic: isViewer ? seat.tactic : null,
        style: isViewer ? seat.style : null,
        attackFocus: isViewer ? seat.attackFocus : null,
        defenseFocus: isViewer ? seat.defenseFocus : null,
        formation: lineupVisible && formation ? { valid: formation.valid, name: formation.name, counts: formation.counts, message: formation.message } : null,
        roster: lineupVisible
          ? hydrated.map((player, playerIndex) => ({
              ...publicPlayer(player),
              traits: seat.selections[playerIndex].traitIds.map(publicTrait).filter(Boolean),
              position: seat.positions[player.id] ?? null,
              starter: startingIdSet.has(player.id),
            }))
          : [],
      };
    });
    const ownSeat = viewerIndex >= 0 ? room.players[viewerIndex] : null;
    let offer = null;
    if (ownSeat?.offer?.type === "player") offer = { type: "player", pool: ownSeat.offer.pool, choices: ownSeat.offer.choiceIds.map((id) => publicPlayer(REAL_PLAYER_BY_ID[id])) };
    return clone({
      code: room.code,
      competitionMode: room.competitionMode ?? "quick",
      legNumber: Number(room.legNumber ?? 1),
      firstLegScore: room.firstLeg?.score ?? null,
      draftTarget: draftTarget(room),
      phase: room.phase,
      viewerIndex,
      updatedAt: room.updatedAt,
      players,
      offer,
      bothReady: room.players.every((seat) => seat?.ready),
      rematchReady: room.phase === "report" ? [...(room.rematchReady ?? [false, false])] : null,
      weather: ["tactics", "match", "report"].includes(room.phase) ? room.weather ?? room.match?.weather ?? null : null,
      referee: ["tactics", "match", "report"].includes(room.phase) ? room.referee ?? room.match?.referee ?? null : null,
      timer: room.phaseDeadline ? { remainingMs: Math.max(0, room.phaseDeadline - now), durationMs: room.phase === "draft" ? DRAFT_DURATION_MS : TACTICS_DURATION_MS } : null,
      match: room.match ? publicMatch(room.match, now, viewerIndex) : null,
      spectators: room.phase === "match" ? this.spectatorList(room) : [],
      profile: ownSeat?.accountId && this.accounts.has(ownSeat.accountId) ? this.publicProfile(this.accounts.get(ownSeat.accountId)) : null,
    });
  }
}

export const versusRooms = new VersusRoomService();
