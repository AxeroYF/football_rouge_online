import assert from "node:assert/strict";
import test from "node:test";
import { buildS4BalanceSeat } from "../versus/s4-balance-report.js";
import {
  advanceV2Match,
  calibrateV2ShotXg,
  createV2Match,
  publicV2Match,
  simulateV2Match,
  v2SetPieceTargetPool,
  v2TurnoverRestartZone,
} from "../versus/v2/match-engine-v2.js";
import { resolveV2MatchParameters } from "../versus/v2/match-parameters-v2.js";

const injuryImmuneTrait = "custom-dc038995-c237-4fa4-b29a-b0e5abf0921a";

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

test("V2断球后把事件区域转换到新控球方视角", () => {
  assert.equal(v2TurnoverRestartZone("box:leftHalfSpace"), "defensiveThird:rightHalfSpace");
  assert.equal(v2TurnoverRestartZone("finalThird:farRight"), "buildUp:farLeft");
  assert.equal(v2TurnoverRestartZone("buildUp:center"), "finalThird:center");
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
  assert.equal(publicV2Match(match).substitutionsAllowed, false);
  const goal = match.events.find((event) => event.type === "goal");
  assert.ok(goal.assistId);
  assert.match(goal.text, /助攻：/);
  assert.match(goal.detail, /射手：.+机会质量：xG/);
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
  const match = simulateV2Match(seats("red-sample-0", {
    home:{ style:"roughPlay" },
    away:{ style:"roughPlay" },
  }), {
    seed:"red-sample-0",
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

test("V2完整射门流程记录射门、射正、扑救或补射和进球结果", () => {
  const match = simulateV2Match(seats("save-sample-0"), {
    seed:"save-sample-0",
    possessionChains:48,
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
  assert.equal(match.commentary.at(-1).type, "fulltime");
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

test("V2 records each defensive turnover as a player tackle", () => {
  const match = simulateV2Match(seats("tackle-stat-collection"), {
    seed:"tackle-stat-collection",
    possessionChains:180,
    weather:"sunny",
    referee:"standard",
    parameters:parameters(),
  });
  const turnovers = match.chains.filter((chain) => chain.stages.at(-1)?.turnover?.playerId).length;
  const tackles = match.teams.flatMap((team) => team.players).reduce((sum, player) => sum + Number(player.matchStats.tackles ?? 0), 0);
  assert.ok(turnovers > 0);
  assert.equal(tackles, turnovers);
});
