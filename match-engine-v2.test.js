import assert from "node:assert/strict";
import test from "node:test";
import { buildS4BalanceSeat } from "../versus/s4-balance-report.js";
import {
  advanceV2Match,
  autoSubstituteDismissedGoalkeeper,
  calibrateV2ShotXg,
  createV2Match,
  publicV2Match,
  simulateV2Match,
  v2HighLineBreakawayProfile,
  v2FatigueLoadMultiplier,
  v2MidfieldVacuumLongShotOpportunityProfile,
  v2PossessionDurationProfile,
  v2ShotBodyPartProfile,
  v2ShotOutcomeProfile,
  v2SetPieceChanceProfile,
  v2SetPieceTargetPool,
  v2TurnoverRestartZone,
} from "../versus/v2/match-engine-v2.js";
import { resolveV2MatchParameters } from "../versus/v2/match-parameters-v2.js";
import { v2RepeatYellowCardProbability } from "../versus/v2/possession-chain-v2.js";

const injuryImmuneTrait = "custom-dc038995-c237-4fa4-b29a-b0e5abf0921a";
const injuryTransferTrait = "custom-6d0bf2ee-2d26-4f56-9cb7-4c50960df85d";
const lightningProtectionTrait = "touchline-flywheel";

test("V2只在中场真空造成的前场受阻节点生成额外远射机会", () => {
  const exposedTurnover = {
    endZone:"finalThird:center",
    stages:[{
      stage:"finalThird",
      zone:"finalThird:center",
      outcome:"defensiveTurnover",
      turnover:{ teamIndex:1, playerId:"defender" },
      foul:{ occurred:false },
      defendingLongShotExposure:1,
    }],
  };
  const exposed = v2MidfieldVacuumLongShotOpportunityProfile(exposedTurnover, resolveV2MatchParameters(), 0);
  assert.equal(exposed.eligible, true);
  assert.equal(exposed.created, true);
  assert.equal(exposed.opportunityChance, 0.26);

  const intactMidfield = structuredClone(exposedTurnover);
  intactMidfield.stages[0].defendingLongShotExposure = 0.2;
  const intact = v2MidfieldVacuumLongShotOpportunityProfile(intactMidfield, resolveV2MatchParameters(), 0);
  assert.equal(intact.eligible, false);
  assert.equal(intact.created, false);

  const wideTurnover = structuredClone(exposedTurnover);
  wideTurnover.stages[0].zone = "finalThird:farLeft";
  const wide = v2MidfieldVacuumLongShotOpportunityProfile(wideTurnover, resolveV2MatchParameters(), 0);
  assert.equal(wide.eligible, true);
  assert.ok(wide.opportunityChance < exposed.opportunityChance);
});

test("V2中场真空远射机会会进入正式射门结算链", () => {
  const noMidfieldFormation = [
    ["GK", 50, 90],
    ["LB", 8, 72], ["CB", 20, 70], ["CB", 32, 71], ["CB", 44, 70],
    ["CB", 56, 70], ["CB", 68, 71], ["CB", 80, 70], ["RB", 92, 72],
    ["ST", 38, 18], ["ST", 62, 18],
  ];
  const matchSeats = seats("midfield-vacuum-shot-chain", {
    home:{ formation:"4-3-3", tactic:"balanced", style:"possession", lockTacticalProfile:true },
    away:{ formation:"4-3-3", formationSlots:noMidfieldFormation, tactic:"parkBus", style:"lowBlock", lockTacticalProfile:true },
  });
  const match = simulateV2Match(matchSeats, {
    seed:"midfield-vacuum-shot-chain",
    possessionChains:180,
    parameters:parameters({
      chain:{ longShot:{ midfieldVacuumMinimumExposure:0.55, midfieldVacuumBaseChance:1, midfieldVacuumMaximumChance:1, midfieldVacuumWideLaneMultiplier:1 } },
    }),
  });
  const generated = match.chains.filter((chain) => chain.attackingTeamIndex === 0 && chain.midfieldVacuumLongShot?.created);
  assert.ok(generated.length > 0);
  assert.ok(generated.every((chain) => chain.stages.at(-1)?.midfieldVacuumOpportunity === true));
  assert.ok(match.events.filter((event) => event.attackType === "longShot").length >= generated.length);
});

function parameters(overrides = {}) {
  return resolveV2MatchParameters({
    events:{ injuryPerChain:0, blackWhistlePerMatch:0 },
    environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:0, snow:0 } },
    ...overrides,
  });
}

function seats(seed, options = {}) {
  return [
    buildS4BalanceSeat(seed, "home", options.homeArchetype ?? "standard", options.home ?? {}),
    buildS4BalanceSeat(seed, "away", options.awayArchetype ?? "standard", options.away ?? {}),
  ];
}

test("V2 定位球主罚者不会成为自己的传中接应点", () => {
  const taker = { id:"taker", role:"RB" };
  const striker = { id:"striker", role:"ST" };
  const midfielder = { id:"midfielder", role:"DM" };

  assert.deepEqual(v2SetPieceTargetPool([taker, striker, midfielder], taker), [striker]);
  assert.deepEqual(v2SetPieceTargetPool([taker, midfielder], taker), [midfielder]);
  assert.deepEqual(v2SetPieceTargetPool([taker], taker), []);
});

test("V2定位球质量、争顶和防守压力共同决定射门形成与xG", () => {
  const strong = v2SetPieceChanceProfile({ kind:"freeKick", sourceLane:"center", delivery:92, directAbility:94, targetAerial:91, markerAerial:64, targetMovement:88 }, parameters());
  const weak = v2SetPieceChanceProfile({ kind:"freeKick", sourceLane:"farLeft", delivery:58, directAbility:58, targetAerial:60, markerAerial:88, targetMovement:58 }, parameters());
  const corner = v2SetPieceChanceProfile({ kind:"corner", sourceLane:"center", delivery:82, directAbility:95, targetAerial:82, markerAerial:72, targetMovement:80 }, parameters());

  assert.ok(strong.deliveryProbability > weak.deliveryProbability);
  assert.ok(strong.duelProbability > weak.duelProbability);
  assert.ok(strong.shotCreationProbability > weak.shotCreationProbability);
  assert.ok(strong.headerXg > weak.headerXg);
  assert.ok(strong.directFreeKickChance > 0);
  assert.ok(strong.directFreeKickXg > weak.directFreeKickXg);
  assert.equal(weak.directFreeKickChance, 0);
  assert.equal(corner.directFreeKickChance, 0);
});

test("V2断球后把事件区域转换到新控球方视角", () => {
  assert.equal(v2TurnoverRestartZone("box:leftHalfSpace"), "defensiveThird:rightHalfSpace");
  assert.equal(v2TurnoverRestartZone("finalThird:farRight"), "buildUp:farLeft");
  assert.equal(v2TurnoverRestartZone("buildUp:center"), "finalThird:center");
});

test("V2控球时长区分耐心组织、直接进攻和快速转换", () => {
  const structuredChain = {
    possessionType:"normal",
    stages:[
      { stage:"possession" },
      ...["buildUp", "progression", "finalThird", "chance", "shot"].map((stage) => ({ stage, connection:{ routeType:"structured" } })),
    ],
  };
  const directChain = {
    possessionType:"normal",
    stages:[{ stage:"possession" }, { stage:"buildUp", connection:{ routeType:"direct" } }, { stage:"progression", turnover:{ teamIndex:1 } }],
  };
  const possessionTeam = { style:"possession", tacticalDimensions:{ directness:28, tempo:42, timeWasting:15 } };
  const counterTeam = { style:"counterAttack", tacticalDimensions:{ directness:64, tempo:58, timeWasting:15 } };
  const patient = v2PossessionDurationProfile(structuredChain, possessionTeam);
  const direct = v2PossessionDurationProfile(directChain, counterTeam);
  const transition = v2PossessionDurationProfile({ ...directChain, possessionType:"transition" }, counterTeam);

  assert.ok(patient.weight > direct.weight * 1.8);
  assert.ok(transition.weight < direct.weight);
  assert.ok(patient.retentionMultiplier > direct.retentionMultiplier);
});

test("V2 控球优势会同时扩大控球权选择与单次控球时长", () => {
  const strongControl = {
    possessionType:"normal",
    stages:[
      { stage:"possession", probability:0.66 },
      { stage:"buildUp", connection:{ routeType:"structured" } },
      { stage:"progression", connection:{ routeType:"structured" } },
    ],
  };
  const evenControl = structuredClone(strongControl);
  evenControl.stages[0].probability = 0.5;
  const team = { style:"possession", tacticalDimensions:{ directness:40, tempo:48, timeWasting:15 } };

  const strong = v2PossessionDurationProfile(strongControl, team);
  const even = v2PossessionDurationProfile(evenControl, team);

  assert.ok(strong.controlMultiplier > 1);
  assert.ok(strong.weight > even.weight * 1.15);
});

test("V2 对已染黄球员降低再次出示黄牌概率但保留直接红牌概率", () => {
  const firstCard = v2RepeatYellowCardProbability(0.2, 0.002, 0);
  const repeatCard = v2RepeatYellowCardProbability(0.2, 0.002, 1);

  assert.equal(firstCard, 0.2);
  assert.ok(repeatCard < firstCard * 0.5);
  assert.ok(repeatCard >= 0.002);
});

test("V2 全力进攻高压组合承担额外体能成本", () => {
  const resolved = parameters();
  const balanced = v2FatigueLoadMultiplier({ pressing:50, mentality:50 }, resolved);
  const allOutPress = v2FatigueLoadMultiplier({ pressing:100, mentality:92 }, resolved);

  assert.ok(allOutPress > balanced + 0.25);
});

test("V2增量比赛执行会完成动态战术切换并生成全场播报", () => {
  const dynamicSeats = seats("incremental-dynamic");
  dynamicSeats.forEach((seat) => {
    seat.formationLinePresets = {
      position1:{ attack:20, midfield:44, defense:68, goalkeeper:90 },
      position2:{ attack:16, midfield:38, defense:60, goalkeeper:88 },
      position3:{ attack:24, midfield:48, defense:72, goalkeeper:92 },
    };
  });
  const match = createV2Match(dynamicSeats, {
    possessionChains:4,
    parameters:parameters(),
    rng:() => 0,
  });

  assert.deepEqual(match.teams[0].formationLines, dynamicSeats[0].formationLinePresets.position1);
  advanceV2Match(match, 1);
  assert.deepEqual(match.score, [1, 0]);
  assert.equal(match.finished, false);

  advanceV2Match(match, 2);
  assert.equal(match.teams[0].activePlan, "leading");
  assert.equal(match.teams[1].activePlan, "trailing");
  assert.deepEqual(match.teams[0].formationLines, dynamicSeats[0].formationLinePresets.position2);
  assert.deepEqual(match.teams[1].formationLines, dynamicSeats[1].formationLinePresets.position3);
  assert.ok(match.events.some((event) => event.type === "tactical" && event.plan === "leading"));
  assert.ok(match.events.some((event) => event.type === "tactical" && event.plan === "trailing"));

  advanceV2Match(match, 4);
  assert.equal(match.finished, true);
  assert.equal(match.minute, 90);
  assert.equal(match.events.at(-1).type, "fulltime");
  assert.equal(match.commentary.length, match.events.length);
  assert.equal(publicV2Match(match).substitutionsAllowed, true);
  const goal = match.events.find((event) => event.type === "goal");
  assert.ok(goal.assistId);
  assert.ok(["header", "leftFoot", "rightFoot", "other"].includes(goal.bodyPart));
  assert.match(goal.text, /以(?:头球|左脚|右脚|其他部位)破门/);
  assert.match(goal.text, /助攻：/);
  assert.match(goal.detail, /射手：.+机会质量：xG/);
});

test("V2 tactical plans wait for each configured goal-difference node", () => {
  const dynamicSeats = seats("configured-tactical-nodes");
  dynamicSeats.forEach((seat) => {
    seat.tacticalPlans.leading.triggerGoalDifference = 3;
    seat.tacticalPlans.trailing.triggerGoalDifference = 4;
  });
  const match = createV2Match(dynamicSeats, { possessionChains:6, parameters:parameters(), rng:() => .99 });
  const setScore = (home, away) => {
    match.teams[0].score = home;
    match.teams[1].score = away;
    match.score = [home, away];
  };

  setScore(2, 0);
  advanceV2Match(match, 1);
  assert.equal(match.teams[0].activePlan, "opening");
  setScore(3, 0);
  advanceV2Match(match, 2);
  assert.equal(match.teams[0].activePlan, "leading");
  setScore(0, 3);
  advanceV2Match(match, 3);
  assert.equal(match.teams[0].activePlan, "opening");
  setScore(0, 4);
  advanceV2Match(match, 4);
  assert.equal(match.teams[0].activePlan, "trailing");
});

test("V2续赛会为旧直播对象回填持球时间和来源统计", () => {
  const match = createV2Match(seats("possession-source-backfill"), {
    possessionChains:4,
    parameters:parameters(),
    rng:() => 0,
  });
  advanceV2Match(match, 2);
  for (const team of match.teams) {
    for (const key of ["normalPossessions", "transitionPossessions", "possessionSeconds", "normalPossessionSeconds", "transitionPossessionSeconds", "normalShots", "transitionShots", "normalXg", "transitionXg"]) delete team.stats[key];
  }

  advanceV2Match(match, 3);

  assert.equal(match.teams.reduce((sum, team) => sum + team.stats.possessionSeconds, 0), 3 / 4 * 90 * 60);
  assert.equal(match.teams.reduce((sum, team) => sum + team.stats.normalPossessions + team.stats.transitionPossessions, 0), 3);
  assert.equal(match.teams.reduce((sum, team) => sum + team.stats.normalShots + team.stats.transitionShots, 0), match.teams.reduce((sum, team) => sum + team.stats.shots, 0));
});

test("V2伤病会按位置自动换人并分别播报伤退与替补登场", () => {
  const substitutionSeats = seats("injury-substitution");
  const injured = substitutionSeats[0].players[0];
  const substitute = { ...structuredClone(injured), id:"injury-substitute", name:"伤病替补", active:false };
  substitutionSeats[0].players.push(substitute);
  const match = createV2Match(substitutionSeats, {
    possessionChains:1,
    parameters:parameters({ events:{ injuryPerChain:1, blackWhistlePerMatch:0 } }),
    rng:() => 0,
  });

  advanceV2Match(match, 1);

  const injuredPlayer = match.teams[0].players.find((player) => player.id === injured.id);
  const incomingPlayer = match.teams[0].players.find((player) => player.id === substitute.id);
  assert.equal(injuredPlayer.active, false);
  assert.equal(injuredPlayer.injury.severity, "matchEnding");
  assert.equal(incomingPlayer.active, true);
  assert.equal(incomingPlayer.enteredAsSubstitute, true);
  assert.equal(match.teams[0].stats.substitutions, 1);
  assert.ok(match.events.some((event) => event.type === "injury" && event.injuredPlayerId === injured.id));
  assert.ok(match.events.some((event) => event.type === "substitution" && event.incomingPlayerId === substitute.id && event.outgoingPlayerId === injured.id));
  const injuryEvent = match.events.find((event) => event.type === "injury" && event.injuredPlayerId === injured.id);
  assert.match(injuryEvent.text, /无对抗|变向|落地|旧伤/);
  assert.match(injuryEvent.detail, /伤病原因：无对抗意外受伤/);
  assert.equal(match.commentary.find((event) => event.id === injuryEvent.id).detail, injuryEvent.detail);
});

test("V2门将被红牌罚下后换下低评分中后卫并启用替补门将", () => {
  const substitutionSeats = seats("goalkeeper-red-substitution");
  const startingGoalkeeper = substitutionSeats[0].players.find((player) => player.role === "GK");
  const substitute = { ...structuredClone(startingGoalkeeper), id:"reserve-goalkeeper", name:"替补门将", active:false };
  substitutionSeats[0].players.push(substitute);
  const match = createV2Match(substitutionSeats, {
    possessionChains:1,
    parameters:parameters(),
    rng:() => 0,
  });
  const team = match.teams[0];
  const dismissed = team.players.find((player) => player.id === startingGoalkeeper.id);
  const centerBacks = team.players.filter((player) => player.active && player.id !== dismissed.id).slice(0, 2);
  assert.equal(centerBacks.length, 2);
  centerBacks.forEach((player) => { player.assignedRole = "CB"; });
  centerBacks[0].overall = 88;
  centerBacks[1].overall = 80;
  const dismissedPosition = structuredClone(team.positions[dismissed.id]);
  dismissed.active = false;
  dismissed.sentOff = true;

  const result = autoSubstituteDismissedGoalkeeper(match, team, dismissed);

  assert.equal(result.substitute.id, substitute.id);
  assert.equal(result.outgoingCenterBack.id, centerBacks[1].id);
  assert.equal(result.substitute.active, true);
  assert.equal(result.substitute.assignedRole, "GK");
  assert.equal(result.outgoingCenterBack.active, false);
  assert.equal(team.stats.substitutions, 1);
  assert.deepEqual(team.positions[result.substitute.id], dismissedPosition);
  assert.equal(team.positions[result.outgoingCenterBack.id], undefined);
  assert.equal(team.players.filter((player) => player.active).length, 10);
  assert.ok(match.events.some((event) => event.type === "substitution"
    && event.reason === "goalkeeperRedCard"
    && event.incomingPlayerId === substitute.id
    && event.outgoingPlayerId === centerBacks[1].id));
});

test("V2普通恶劣天气影响会详细播报且不会额外改变比分", () => {
  const match = simulateV2Match(seats("weather-impact"), {
    seed:"weather-impact",
    weather:"rain",
    possessionChains:1,
    parameters:parameters({ events:{ weatherImpactPerMatch:1 } }),
    rng:() => 0.9,
  });

  const event = match.events.find((entry) => entry.type === "weather");
  assert.ok(event);
  assert.match(event.text, /湿滑|雨水/);
  assert.match(event.detail, /不额外改变比赛结果/);
  assert.deepEqual(event.score, undefined);
});

test("V2乌龙球每场最多一次并正确记录比分与责任球员", () => {
  const match = simulateV2Match(seats("forced-own-goal"), {
    seed:"forced-own-goal",
    forceOwnGoal:true,
    possessionChains:8,
    parameters:parameters(),
    rng:() => 0.99,
  });

  const ownGoals = match.events.filter((event) => event.type === "ownGoal");
  assert.equal(ownGoals.length, 1);
  assert.equal(match.score.reduce((sum, score) => sum + score, 0), 1);
  const scorer = match.teams.flatMap((team) => team.players).find((player) => player.id === ownGoals[0].actorId);
  assert.equal(scorer.matchStats.ownGoals, 1);
  assert.match(ownGoals[0].detail, /乌龙球员|受益球队/);
});

test("V2雷暴每场最多雷击一名球员并明确播报雷击伤病", () => {
  const match = simulateV2Match(seats("single-lightning"), {
    weather:"storm",
    possessionChains:8,
    parameters:parameters({ environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:1, snow:0 } } }),
    rng:() => 0,
  });

  const lightningEvents = match.events.filter((event) => event.type === "lightning");
  const lightningInjuries = match.postMatchConsequences.injuries.filter((injury) => injury.reason === "lightningInjury");
  assert.equal(lightningEvents.length, 1);
  assert.equal(lightningInjuries.length, 1);
  assert.match(lightningEvents[0].text, /雷电击中/);
  assert.ok(match.events.some((event) => event.type === "injury" && event.cause === "lightningInjury" && /遭到雷击/.test(event.text)));
});

test("V2避雷针只拦截本队雷击且不会把雷击转移给对手", () => {
  const protectedSeats = seats("protected-lightning");
  protectedSeats[0].players[0].traits = [lightningProtectionTrait];
  const match = simulateV2Match(protectedSeats, {
    weather:"storm",
    possessionChains:8,
    parameters:parameters({ environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:1, snow:0 } } }),
    rng:() => 0,
  });

  const lightningEvents = match.events.filter((event) => event.type === "lightning");
  assert.equal(lightningEvents.length, 1);
  assert.equal(lightningEvents[0].teamIndex, 0);
  assert.equal(lightningEvents[0].prevented, true);
  assert.match(lightningEvents[0].text, /保护了全队/);
  assert.equal(match.postMatchConsequences.injuries.filter((injury) => injury.reason === "lightningInjury").length, 0);
});

test("V2压缩超低质量射门且不削弱常规机会", () => {
  assert.ok(calibrateV2ShotXg(0.015) < 0.005);
  assert.ok(calibrateV2ShotXg(0.03) < 0.015);
  assert.ok(calibrateV2ShotXg(0.05) < 0.035);
  assert.equal(calibrateV2ShotXg(0.08), 0.08);
  assert.equal(calibrateV2ShotXg(0.24), 0.24);
  assert.equal(calibrateV2ShotXg(0.24, "throughBall", 0.7), 0.168);
  assert.equal(calibrateV2ShotXg(0.76, "penalty"), 0.76);
});

test("V2机会xG不再随射手和门将变化，射正与扑救分别判定", () => {
  const baseline = v2ShotOutcomeProfile(0.24, 70, 70);
  const eliteShooter = v2ShotOutcomeProfile(0.24, 95, 70);
  const eliteKeeper = v2ShotOutcomeProfile(0.24, 70, 95);

  assert.equal(baseline.xg, 0.24);
  assert.equal(eliteShooter.xg, baseline.xg);
  assert.equal(eliteKeeper.xg, baseline.xg);
  assert.ok(eliteShooter.onTargetProbability > baseline.onTargetProbability);
  assert.ok(eliteShooter.goalProbability > baseline.goalProbability);
  assert.ok(eliteKeeper.saveProbabilityGivenOnTarget > baseline.saveProbabilityGivenOnTarget);
  assert.ok(eliteKeeper.goalProbability < baseline.goalProbability);
  assert.ok(baseline.goalProbability < baseline.onTargetProbability);
  assert.ok(baseline.onTargetProbability >= 0.3 && baseline.onTargetProbability <= 0.45);
  assert.equal(v2ShotOutcomeProfile(0.76, 70, 70, "penalty").goalProbability, 0.76);
});

test("V2射门部位区分头球、惯用脚、逆足和其他部位", () => {
  const leftFooted = { preferredFoot:"left", weakFoot:3, attributes:{ heading:88 } };

  assert.equal(v2ShotBodyPartProfile(leftFooted, "cross", 0).bodyPart, "header");
  assert.equal(v2ShotBodyPartProfile(leftFooted, "throughBall", 0.2).bodyPart, "rightFoot");
  assert.equal(v2ShotBodyPartProfile(leftFooted, "throughBall", 0.8).bodyPart, "leftFoot");
  assert.equal(v2ShotBodyPartProfile(leftFooted, "rebound", 0.2).bodyPart, "other");
});

test("V2打穿高位防线只提高既有单刀xG而不生成额外射门", () => {
  const baseChain = {
    possessionType:"transition",
    stages:[{
      defendingBacklineExposure:0.5,
      defendingBacklineExposureBreakdown:{ highLineRisk:0 },
      defendingLine:50,
      connection:{ routeType:"counter" },
    }],
  };
  const highLineChain = structuredClone(baseChain);
  highLineChain.stages[0].defendingBacklineExposureBreakdown.highLineRisk = 0.9;
  highLineChain.stages[0].defendingLine = 88;
  const highPressChain = structuredClone(baseChain);
  highPressChain.stages[0].defendingStyle = "highPress";
  highPressChain.stages[0].defendingTacticalDimensions = { pressing:96, defensiveLine:90 };
  const normal = v2HighLineBreakawayProfile(0.12, baseChain, "throughBall", parameters());
  const brokenHighLine = v2HighLineBreakawayProfile(0.12, highLineChain, "throughBall", parameters());
  const exposedHighPress = v2HighLineBreakawayProfile(0.12, highPressChain, "throughBall", parameters());

  assert.equal(normal.breakaway, false);
  assert.equal(brokenHighLine.breakaway, true);
  assert.ok(brokenHighLine.xg > normal.xg);
  assert.ok(exposedHighPress.xg > normal.xg);
  assert.ok(exposedHighPress.highPressSeverity > 0);
  assert.ok(brokenHighLine.xg <= 0.5);
});

test("V2禁区外远射记录真实起脚区域并使用较低xG", () => {
  const longShotSeats = seats("forced-long-shot", {
    home:{ tactic:"positive", style:"possession" },
    away:{ tactic:"parkBus", style:"lowBlock" },
  });
  const match = simulateV2Match(longShotSeats, {
    seed:"forced-long-shot",
    possessionChains:8,
    rng:() => 0,
    parameters:parameters({
      chain:{
        longShot:{ baseDecisionChance:1, minimumDecisionChance:1, maximumDecisionChance:1 },
        route:{ directMaximumChance:0, counterMinimumChance:0, counterMaximumChance:0 },
      },
    }),
  });
  const shots = match.events.filter((event) => ["goal", "miss", "save"].includes(event.type) && event.attackType === "longShot");
  assert.ok(shots.length > 0);
  assert.ok(shots.every((event) => event.zone.startsWith("finalThird:")));
  assert.ok(shots.every((event) => event.xg > 0 && event.xg < 0.1));
});

test("V2红牌会移除球员并记录赛后停赛", () => {
  const match = simulateV2Match(seats("red-pipeline-0", {
    home:{ style:"roughPlay" },
    away:{ style:"roughPlay" },
  }), {
    seed:"red-pipeline-0",
    possessionChains:48,
    weather:"sunny",
    referee:"strict",
    parameters:parameters({
      environment:{
        cardProbability:{ lenient:1, standard:1, strict:1 },
        directRedProbability:{ lenient:1, standard:1, strict:1 },
      },
    }),
  });
  const red = match.events.find((event) => event.type === "red");
  assert.ok(red);
  const dismissed = match.teams.flatMap((team) => team.players).find((player) => player.id === red.actorId);
  assert.equal(dismissed.active, false);
  assert.equal(dismissed.sentOff, true);
  assert.ok(match.postMatchConsequences.suspensions.some((entry) => entry.teamIndex === red.teamIndex
    && entry.playerId === red.actorId && entry.matches === 1 && entry.reason === "redCard"));
  assert.ok(match.postMatchConsequences.suspensions.every((entry) => entry.matches === 1 && entry.reason === "redCard"));
});

test("V2伤病会导致少一人并记录伤停后果，伤病免疫特性生效", () => {
  const immuneSeats = seats("injury-immune");
  immuneSeats[0].players.forEach((player) => { player.traits = [injuryImmuneTrait]; });
  const match = simulateV2Match(immuneSeats, {
    seed:"injury-immune",
    possessionChains:1,
    weather:"sunny",
    parameters:resolveV2MatchParameters({
      events:{ injuryPerChain:1, blackWhistlePerMatch:0 },
      environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:0, snow:0 } },
    }),
  });
  assert.equal(match.teams[0].players.filter((player) => !player.active).length, 0);
  assert.equal(match.teams[1].players.filter((player) => !player.active).length, 1);
  assert.equal(match.postMatchConsequences.injuries.length, 1);
  assert.equal(match.postMatchConsequences.injuries[0].matches, 1);
  assert.equal(match.events.some((event) => event.type === "injury"), true);
});

test("V2别打我大哥会把场上队友的伤病转移给特性持有者", () => {
  const transferSeats = seats("injury-transfer");
  transferSeats.forEach((seat) => seat.players.forEach((player) => { player.traits = [injuryTransferTrait]; }));
  const match = simulateV2Match(transferSeats, {
    seed:"injury-transfer",
    possessionChains:1,
    weather:"sunny",
    parameters:resolveV2MatchParameters({
      events:{ injuryPerChain:1, blackWhistlePerMatch:0 },
      environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:0, snow:0 } },
    }),
  });
  const transferEvent = match.events.find((event) => event.type === "trait" && event.traitName === "别打我大哥");
  const injuryEvent = match.events.find((event) => event.type === "injury" && event.injuryTransferred);
  assert.ok(transferEvent);
  assert.ok(injuryEvent);
  assert.notEqual(transferEvent.actorId, transferEvent.protectedPlayerId);
  assert.equal(injuryEvent.injuredPlayerId, transferEvent.actorId);
  assert.equal(injuryEvent.transferredFromPlayerId, transferEvent.protectedPlayerId);
  assert.equal(match.teams.flatMap((team) => team.players).find((player) => player.id === transferEvent.protectedPlayerId)?.active, true);
  assert.equal(match.postMatchConsequences.injuries.length, 1);
  assert.equal(match.postMatchConsequences.injuries[0].playerId, transferEvent.actorId);
  assert.equal(match.postMatchConsequences.injuries[0].injuryTransferred, true);
});

test("V2别打我大哥与赖着不死组合会先转移伤病再免疫，双方均不伤退", () => {
  const combinedSeats = seats("injury-transfer-immune");
  combinedSeats.forEach((seat) => {
    seat.players.forEach((player, index) => {
      player.traits = index === 0 ? [injuryTransferTrait, injuryImmuneTrait] : [];
    });
  });
  const match = simulateV2Match(combinedSeats, {
    seed:"injury-transfer-immune",
    possessionChains:1,
    weather:"sunny",
    parameters:resolveV2MatchParameters({
      events:{ injuryPerChain:1, blackWhistlePerMatch:0 },
      environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:0, snow:0 } },
    }),
  });
  const transferEvents = match.events.filter((event) => event.type === "trait" && event.traitName === "别打我大哥");
  const immunityEvents = match.events.filter((event) => event.type === "trait" && event.traitName === "赖着不死");
  assert.ok(transferEvents.length >= 1);
  assert.equal(immunityEvents.length, transferEvents.length);
  transferEvents.forEach((event) => {
    assert.notEqual(event.actorId, event.protectedPlayerId);
    assert.ok(immunityEvents.some((immunity) => immunity.actorId === event.actorId));
  });
  assert.equal(match.teams.flatMap((team) => team.players).some((player) => player.injury), false);
  assert.equal(match.teams.flatMap((team) => team.players).some((player) => !player.active), false);
  assert.equal(match.postMatchConsequences.injuries.length, 0);
  assert.equal(match.events.some((event) => event.type === "injury"), false);
});

test("V2定位球执行链包含点球、门将扑救和正式播报", () => {
  const matchSeats = seats("penalty-save", {
    home:{ nationality:"阿根廷" },
    away:{ nationality:"测试国" },
  });
  matchSeats[1].players[0].traits = ["muddy-knees"];
  const match = simulateV2Match(matchSeats, {
    seed:"penalty-save",
    possessionChains:1,
    weather:"sunny",
    forceBlackWhistle:true,
    parameters:parameters(),
  });
  assert.ok(match.events.some((event) => event.type === "penaltyAwarded"));
  assert.ok(match.events.some((event) => event.type === "save" && event.attackType === "penalty" && event.traitName === "一夫当关"));
  assert.equal(match.teams[0].stats.penalties, 1);
  assert.equal(match.teams[1].stats.saves, 1);
  assert.equal(match.events.at(-1).type, "fulltime");
});

test("V2黑哨事件按固定种子分布到全场而不是固定发生在第1分钟", () => {
  const matchSeats = seats("black-whistle-timing", {
    home:{ nationality:"阿根廷" },
    away:{ nationality:"测试国" },
  });
  const options = {
    seed:"black-whistle-any-minute",
    possessionChains:90,
    weather:"sunny",
    forceBlackWhistle:true,
    parameters:parameters(),
  };
  const first = simulateV2Match(matchSeats, options);
  const second = simulateV2Match(matchSeats, options);
  const firstEvent = first.events.find((event) => event.type === "blackWhistle");
  const secondEvent = second.events.find((event) => event.type === "blackWhistle");
  assert.ok(firstEvent);
  assert.ok(firstEvent.minute > 1 && firstEvent.minute <= 90);
  assert.equal(secondEvent.minute, firstEvent.minute);
  assert.equal(first.blackWhistleChainIndex, second.blackWhistleChainIndex);
});

test("V2完整射门流程记录射门、射正、扑救或补射和进球结果", () => {
  const match = simulateV2Match(seats("save-sample-0"), {
    seed:"save-sample-0",
    possessionChains:180,
    weather:"sunny",
    referee:"standard",
    parameters:parameters(),
  });
  const totalShots = match.teams.reduce((sum, team) => sum + team.stats.shots, 0);
  const totalOnTarget = match.teams.reduce((sum, team) => sum + team.stats.shotsOnTarget, 0);
  const totalSaves = match.teams.reduce((sum, team) => sum + team.stats.saves, 0);
  assert.ok(totalShots > 0);
  assert.ok(totalOnTarget > 0);
  assert.ok(totalSaves > 0);
  assert.ok(match.events.some((event) => ["goal", "miss", "save"].includes(event.type)));
  assert.ok(match.events.filter((event) => ["miss", "save"].includes(event.type)).every((event) => event.detail && event.zone && Number.isFinite(event.xg)));
  assert.equal(match.commentary.at(-1).type, "fulltime");
});

test("V2助攻只归属于真实进攻链球员且无助攻进球不再冒用配合标签", () => {
  const seed = "assist-attribution-4";
  const assistSeats = seats(seed);
  assistSeats.forEach((seat) => { seat.attackFocus = "balanced"; seat.defenseFocus = "balanced"; });
  const match = simulateV2Match(assistSeats, {
    seed,
    possessionChains:48,
    weather:"sunny",
    referee:"standard",
    parameters:parameters(),
  });
  const goals = match.events.filter((event) => event.type === "goal");
  const collaborativeTypes = new Set(["throughBall", "cross", "cutback", "counter", "setPiece"]);
  const selfCreated = goals.find((event) => !event.assistId);

  assert.ok(selfCreated);
  assert.ok(["individual", "soloCounter", "rebound", "penalty"].includes(selfCreated.attackType));
  assert.ok(goals.filter((event) => collaborativeTypes.has(event.attackType)).every((event) => event.assistId));
  assert.ok(goals.filter((event) => !event.assistId).every((event) => !collaborativeTypes.has(event.attackType)));
  assert.match(selfCreated.text, /个人突破|抢断后单刀|补射|点球/);
});

test("V2全场体能只按实时球员状态消耗一次且保留后段比赛能力", () => {
  const match = simulateV2Match(seats("single-fatigue-owner"), {
    seed:"single-fatigue-owner",
    possessionChains:180,
    weather:"sunny",
    referee:"standard",
    parameters:parameters(),
  });
  const activeFitness = match.teams.flatMap((team) => team.players.filter((player) => player.active).map((player) => player.state.fitness));
  const averageFitness = activeFitness.reduce((sum, value) => sum + value, 0) / activeFitness.length;
  assert.ok(averageFitness >= 80 && averageFitness <= 92);
  assert.ok(Math.min(...activeFitness) >= 75);
});

test("V2把防守夺回球权区分为抢断、拦截和解围", () => {
  const match = simulateV2Match(seats("tackle-stat-collection"), {
    seed:"tackle-stat-collection",
    possessionChains:180,
    weather:"sunny",
    referee:"standard",
    parameters:parameters(),
  });
  const turnovers = match.chains.filter((chain) => chain.stages.at(-1)?.turnover?.playerId).length;
  const defensiveStats = match.teams.flatMap((team) => team.players).reduce((totals, player) => {
    for (const key of ["tackles", "interceptions", "clearances", "setPieceClearances", "pressuresWon"]) totals[key] += Number(player.matchStats[key] ?? 0);
    return totals;
  }, { tackles:0, interceptions:0, clearances:0, setPieceClearances:0, pressuresWon:0 });
  assert.ok(turnovers > 0);
  const creditedOpenPlayActions = defensiveStats.tackles + defensiveStats.interceptions + defensiveStats.clearances - defensiveStats.setPieceClearances;
  assert.ok(creditedOpenPlayActions > 0);
  assert.ok(creditedOpenPlayActions < turnovers * 0.6);
  assert.ok(defensiveStats.tackles > 0);
  assert.ok(defensiveStats.interceptions > 0);
});
