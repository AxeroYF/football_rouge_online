import crypto from "node:crypto";
import { canAttack, captureTerritory, OWNER_TYPES } from "../../territory-model.js";
import {
  advanceCampaignLiveLeg,
  buildAccountMatchSeat,
  buildTerritoryDefenderSeat,
  createCampaignLiveLeg,
  finalizeCampaignLiveBattle,
  publicCampaignLiveLeg,
  restoreCampaignLiveLeg,
} from "../../engine/campaign-match-engine.mjs";
import {
  CAMPAIGN_EXTRA_TIME_LIVE_MS,
  CAMPAIGN_REGULATION_LIVE_MS,
  CHALLENGE_SECOND_LEG_COOLDOWN_MS,
} from "../../shared/config/challenge.mjs";

function compactBattleRecord(battle) {
  const { broadcasts: discardedBroadcasts, events: discardedEvents, ...battleRecord } = battle;
  battleRecord.events = (discardedEvents ?? [])
    .filter((event) => ["goal", "ownGoal", "red", "penalties", "fulltime"].includes(event.type))
    .slice(-12);
  return battleRecord;
}

export function publicChallengeView(challenge, now) {
  const phase = challenge.phase
    ?? (now < challenge.firstLegEndsAt ? "first-leg" : now < challenge.secondLegStartsAt ? "intermission" : "second-leg");
  return {
    id: challenge.id,
    territoryId: challenge.territoryId,
    attackerId: challenge.attackerId,
    attackerTeamName: challenge.attackerTeamName,
    defenderId: challenge.defenderId,
    defenderName: challenge.defenderName,
    startedAt: challenge.startedAt,
    firstLegEndsAt: challenge.firstLegEndsAt,
    secondLegStartsAt: challenge.secondLegStartsAt,
    settleAt: challenge.settleAt,
    phase,
    maritime: Boolean(challenge.maritimeRoute),
    sourceTerritoryId: challenge.fromTerritoryIds?.[0] ?? null,
  };
}

export class ChallengeService {
  constructor({
    world,
    accounts,
    territoryIndex,
    maritimePlanner = null,
    playerDatabase = [],
    ensureAiGarrison,
    getTerritoryWeather = () => ({ type:"sunny", label:"晴朗", icon:"☀", precipitation:0 }),
    save = () => {},
    now = Date.now,
    createChallengeId = (accountId) => `challenge:${crypto.randomBytes(8).toString("hex")}:${accountId}`,
  } = {}) {
    this.world = world;
    this.accounts = accounts;
    this.territoryIndex = territoryIndex;
    this.maritimePlanner = maritimePlanner;
    this.playerDatabase = playerDatabase;
    this.ensureAiGarrison = ensureAiGarrison;
    this.getTerritoryWeather = getTerritoryWeather;
    this.save = save;
    this.now = now;
    this.createChallengeId = createChallengeId;
    this.liveAdvanceCursor = 0;
  }

  restoreActiveChallenges() {
    for (const challenge of Object.values(this.world?.activeChallenges ?? {})) {
      if (challenge.live?.firstLeg) restoreCampaignLiveLeg(challenge.live.firstLeg);
      if (challenge.live?.secondLeg) restoreCampaignLiveLeg(challenge.live.secondLeg);
    }
  }

  territoryMetadata(territoryId) {
    const territory = this.territoryIndex?.territories.find((candidate) => candidate.territoryId === territoryId);
    if (!territory) throw new Error("目标地块不存在");
    return territory;
  }

  battleForChallenge(challenge) {
    if (challenge.battle) return challenge.battle;
    const live = challenge.live;
    if (!live?.firstLeg?.match?.finished || !live?.secondLeg?.match?.finished) return null;
    const battle = finalizeCampaignLiveBattle({
      territoryId: challenge.territoryId,
      seed: challenge.seed,
      attacker: live.attacker,
      defender: live.defender,
      firstLeg: live.firstLeg,
      secondLeg: live.secondLeg,
    });
    battle.challengeId = challenge.id;
    battle.playedAt = challenge.startedAt;
    battle.attackerId = challenge.attackerId;
    battle.defender = challenge.previousOwner;
    battle.fromTerritoryIds = challenge.fromTerritoryIds;
    battle.maritimeRoute = challenge.maritimeRoute;
    battle.captured = false;
    challenge.battle = battle;
    return battle;
  }

  settleChallenge(challenge) {
    const current = this.world?.activeChallenges?.[challenge.territoryId];
    if (!current || current.id !== challenge.id) return null;
    const computed = this.battleForChallenge(challenge);
    if (!computed) return null;
    const targetState = this.world.territories[challenge.territoryId];
    const ownerUnchanged = targetState.ownerType === challenge.previousOwner.type
      && (targetState.ownerId ?? null) === (challenge.previousOwner.id ?? null);
    const battle = { ...computed, captured: false, settledAt: this.now() };
    if (battle.outcome === "win" && ownerUnchanged) {
      captureTerritory(this.territoryIndex, this.world, challenge.attackerId, challenge.territoryId, {
        permission: { allowed: true, reason: null, fromTerritoryIds: challenge.fromTerritoryIds ?? [] },
      });
      battle.captured = true;
    } else {
      this.world.revision += 1;
    }
    const attacker = this.accounts.get(challenge.attackerId);
    if (attacker) {
      attacker.battleHistory ??= [];
      attacker.battleHistory.push(compactBattleRecord(battle));
      attacker.battleHistory = attacker.battleHistory.slice(-50);
    }
    delete this.world.activeChallenges[challenge.territoryId];
    this.save();
    return battle;
  }

  settleDueChallenges() {
    if (!this.world?.activeChallenges) return [];
    const now = this.now();
    const settled = [];
    for (const challenge of Object.values(this.world.activeChallenges)) {
      if (!challenge.live && challenge.battle && now >= Number(challenge.settleAt ?? Infinity)) {
        const battle = this.settleChallenge(challenge);
        if (battle) settled.push(battle);
      }
    }
    return settled;
  }

  status(account, challengeIdValue) {
    const challengeId = String(challengeIdValue ?? "");
    const challenge = Object.values(this.world?.activeChallenges ?? {}).find((candidate) => candidate.id === challengeId);
    if (!challenge) {
      const completed = (account.battleHistory ?? [])
        .find((battle) => battle.challengeId === challengeId || battle.id === challengeId);
      if (!completed) throw Object.assign(new Error("进行中的挑战不存在或已经结束"), { statusCode: 404 });
      return { completed: true, challenge: null, live: null, battle: completed };
    }
    const live = challenge.live;
    const currentLeg = challenge.phase === "second-leg" ? live?.secondLeg : live?.firstLeg;
    return {
      completed: false,
      challenge: publicChallengeView(challenge, this.now()),
      live: currentLeg ? {
        key: `${challenge.id}:leg-${currentLeg.legNumber}`,
        phase: challenge.phase,
        legNumber: currentLeg.legNumber,
        secondLegStartsAt: challenge.secondLegStartsAt,
        broadcast: publicCampaignLiveLeg(currentLeg),
      } : null,
      battle: null,
    };
  }

  advance(now = this.now(), { maximumMatches = 1, maximumChainsPerMatch = 1 } = {}) {
    const challenges = Object.values(this.world?.activeChallenges ?? {}).filter((challenge) => challenge.live);
    if (!challenges.length) return false;
    const limit = Math.max(1, Math.floor(Number(maximumMatches) || 1));
    const start = this.liveAdvanceCursor % challenges.length;
    let processed = 0;
    let changed = false;
    for (let offset = 0; offset < challenges.length && processed < limit; offset += 1) {
      const index = (start + offset) % challenges.length;
      const challenge = challenges[index];
      const live = challenge.live;
      if (challenge.phase === "first-leg") {
        const before = Number(live.firstLeg.match.nextChainIndex ?? 0);
        advanceCampaignLiveLeg(live.firstLeg, now, { maximumChains: maximumChainsPerMatch });
        changed = changed || Number(live.firstLeg.match.nextChainIndex ?? 0) > before;
        if (live.firstLeg.match.finished) {
          challenge.phase = "intermission";
          challenge.firstLegEndsAt = Number(now);
          challenge.secondLegStartsAt = Number(now) + CHALLENGE_SECOND_LEG_COOLDOWN_MS;
          challenge.settleAt = challenge.secondLegStartsAt + CAMPAIGN_REGULATION_LIVE_MS + CAMPAIGN_EXTRA_TIME_LIVE_MS;
          changed = true;
        }
      } else if (challenge.phase === "intermission" && now >= Number(challenge.secondLegStartsAt)) {
        const firstScore = [...live.firstLeg.match.score];
        live.secondLeg = createCampaignLiveLeg({
          home: live.defender,
          away: live.attacker,
          seed: String(challenge.seed) + ":leg-2",
          legNumber: 2,
          startedAt: challenge.secondLegStartsAt,
          aggregateBaseScore: [firstScore[1], firstScore[0]],
          knockout: true,
          weather: this.getTerritoryWeather(challenge.territoryId, challenge.secondLegStartsAt),
        });
        challenge.phase = "second-leg";
        changed = true;
      } else if (challenge.phase === "second-leg" && live.secondLeg) {
        const before = Number(live.secondLeg.match.nextChainIndex ?? 0);
        advanceCampaignLiveLeg(live.secondLeg, now, { maximumChains: maximumChainsPerMatch });
        changed = changed || Number(live.secondLeg.match.nextChainIndex ?? 0) > before;
        if (live.secondLeg.match.finished) {
          challenge.phase = "finished";
          this.battleForChallenge(challenge);
          this.settleChallenge(challenge);
          changed = true;
        }
      }
      processed += 1;
      this.liveAdvanceCursor = (index + 1) % Math.max(1, challenges.length);
    }
    return changed;
  }

  complete(account, challengeIdValue) {
    const challengeId = String(challengeIdValue ?? "");
    const challenge = Object.values(this.world?.activeChallenges ?? {}).find((candidate) => candidate.id === challengeId);
    if (!challenge) {
      const completed = (account.battleHistory ?? [])
        .find((battle) => battle.challengeId === challengeId || battle.id === challengeId);
      if (completed) return { battle: completed, alreadyCompleted: true };
      throw Object.assign(new Error("进行中的挑战不存在或已经结束"), { statusCode: 404 });
    }
    if (challenge.attackerId !== account.id) {
      throw Object.assign(new Error("只有发起挑战的球队可以完成结算"), { statusCode: 403 });
    }
    if (!challenge.live?.secondLeg?.match?.finished && !(challenge.battle && this.now() >= Number(challenge.settleAt))) {
      throw Object.assign(new Error("比赛仍在服务器实时推进中"), { statusCode: 409 });
    }
    return { battle: this.settleChallenge(challenge), alreadyCompleted: false };
  }

  maritimeRoutes(account, sourceTerritoryIdValue, pointValue) {
    if (!this.maritimePlanner || !this.world) throw new Error("海上航线系统尚未初始化");
    const requestedPoint = Array.isArray(pointValue) ? pointValue.map(Number) : [];
    if (requestedPoint.length !== 2 || !requestedPoint.every(Number.isFinite)) {
      throw new Error("请选择有效的海岸出发点");
    }
    this.settleDueChallenges();
    const result = this.maritimePlanner.routesFrom(
      this.world,
      account.id,
      String(sourceTerritoryIdValue ?? ""),
      requestedPoint,
    );
    return {
      ...result,
      routes: result.routes.filter((route) => !this.world.activeChallenges?.[route.targetTerritoryId]),
    };
  }

  begin(account, territoryIdValue, options = {}) {
    if (!this.world || !this.territoryIndex) throw new Error("共享世界尚未初始化");
    if (!account.setupComplete || !account.draft?.roster?.length) throw new Error("请先完成初始建队");
    if (!account.homeTerritoryId) throw new Error("请先选择永久主场");
    this.settleDueChallenges();
    const territoryId = String(territoryIdValue ?? "");
    const existingChallenge = Object.values(this.world.activeChallenges ?? {})
      .find((challenge) => challenge.attackerId === account.id);
    if (existingChallenge) {
      throw Object.assign(new Error("你已有一场板块挑战正在进行，比赛结束前不能发起新的挑战"), { statusCode: 409 });
    }
    if (this.world.activeChallenges?.[territoryId]) {
      throw Object.assign(new Error("该板块正在被其他球队挑战，请等待本场争夺结束"), { statusCode: 409 });
    }
    const territory = this.territoryMetadata(territoryId);
    let permission = canAttack(this.territoryIndex, this.world, account.id, territoryId);
    let maritimeRoute = null;
    if (!permission.allowed && permission.reason === "not-adjacent" && options.maritimeRoute) {
      const routeResult = this.maritimeRoutes(
        account,
        options.maritimeRoute.sourceTerritoryId,
        options.maritimeRoute.sourcePoint,
      );
      maritimeRoute = routeResult.routes.find((route) => route.targetTerritoryId === territoryId) ?? null;
      if (maritimeRoute) {
        permission = {
          allowed: true,
          reason: null,
          fromTerritoryIds: [routeResult.sourceTerritoryId],
          maritime: true,
        };
      }
    }
    if (!permission.allowed) {
      const messages = {
        "already-owned": "该地块已经属于你",
        "territory-protected": "该地块仍在保护期内",
        "not-adjacent": "该地块既不与领土陆地相邻，也不在当前直线航线内",
      };
      throw new Error(messages[permission.reason] ?? "当前不能挑战该地块");
    }

    const targetState = this.world.territories[territoryId];
    const attacker = buildAccountMatchSeat(account);
    const defendingAccount = targetState.ownerType === OWNER_TYPES.PLAYER
      ? this.accounts.get(targetState.ownerId)
      : null;
    const now = this.now();
    const seed = `${this.world.seasonId}:${this.world.revision + 1}:${account.id}:${territoryId}:${now}`;
    const garrison = defendingAccount ? null : this.ensureAiGarrison(territoryId);
    const defender = defendingAccount?.draft?.roster?.length >= 11
      ? buildAccountMatchSeat(defendingAccount)
      : buildTerritoryDefenderSeat({
        catalog: this.playerDatabase,
        territory,
        territoryState: targetState,
        seed,
        garrison,
      });
    const previousOwner = { type: targetState.ownerType, id: targetState.ownerId };
    const challengeId = this.createChallengeId(account.id);
    const firstLeg = createCampaignLiveLeg({
      home: attacker,
      away: defender,
      seed: `${seed}:leg-1`,
      legNumber: 1,
      startedAt: now,
      weather: this.getTerritoryWeather(territoryId, now),
    });
    const challenge = {
      id: challengeId,
      territoryId,
      attackerId: account.id,
      attackerTeamName: account.draft?.teamName ?? account.nickname,
      defenderId: previousOwner.id ?? null,
      defenderName: defender.name,
      startedAt: now,
      firstLegEndsAt: now + CAMPAIGN_REGULATION_LIVE_MS,
      secondLegStartsAt: now + CAMPAIGN_REGULATION_LIVE_MS + CHALLENGE_SECOND_LEG_COOLDOWN_MS,
      settleAt: now + CAMPAIGN_REGULATION_LIVE_MS + CHALLENGE_SECOND_LEG_COOLDOWN_MS
        + CAMPAIGN_REGULATION_LIVE_MS + CAMPAIGN_EXTRA_TIME_LIVE_MS,
      phase: "first-leg",
      seed,
      fromTerritoryIds: permission.fromTerritoryIds,
      maritimeRoute,
      previousOwner,
      live: { attacker, defender, firstLeg, secondLeg: null },
    };
    this.world.activeChallenges ??= {};
    this.world.activeChallenges[territoryId] = challenge;
    this.world.revision += 1;
    this.save();
    return { challengeId, challenge };
  }
}
