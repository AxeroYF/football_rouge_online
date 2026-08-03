import assert from "node:assert/strict";
import test from "node:test";
import { buildS4BalanceSeat } from "../versus/s4-balance-report.js";
import { hydrateHistoricalMatchDetail } from "../versus/history-detail.js";
import { advanceYdlLeagueV2Match, createYdlLeagueV2Match, publicYdlLeagueV2Match, v2PenaltyShootout } from "../versus/v2/ydl-league-engine-adapter.js";

test("YDL V2直播保持战术板边界站位与位置职责一致", () => {
  const seats = [
    buildS4BalanceSeat("ydl-v2-position-sync", "home", "traitHeavy"),
    buildS4BalanceSeat("ydl-v2-position-sync", "away", "enhanced"),
  ];
  const layout = [
    { x:50, y:85 },
    { x:40, y:60 }, { x:60, y:60 }, { x:20, y:54 }, { x:80, y:54 },
    { x:50, y:48 }, { x:30, y:40 }, { x:70, y:40 }, { x:50, y:34 },
    { x:40, y:22 }, { x:60, y:22 },
  ];
  seats.forEach((seat) => {
    seat.positions = Object.fromEntries(seat.players.map((player, index) => [player.id, layout[index]]));
    seat.positionPresets = { position1:structuredClone(seat.positions) };
    seat.formationLinePresets = { position1:{ attack:22, midfield:41, defense:57, goalkeeper:85 } };
    seat.tacticalPlans = { opening:{ tactic:seat.tactic, style:seat.style, positionPreset:"position1" } };
  });

  const match = createYdlLeagueV2Match(seats, { now:1_800_000_000_000, seed:"position-sync" });
  const view = publicYdlLeagueV2Match(match, match.startedAt, 0, true);
  const home = view.teams[0];

  assert.equal(home.formation, "4-4-2");
  assert.ok(home.tacticalFit >= 45 && home.tacticalFit <= 99);
  assert.equal(home.styleFit, Number((home.tacticalFit / 100).toFixed(3)));
  assert.deepEqual(home.positions, seats[0].positions);
  assert.deepEqual(home.formationLines, seats[0].formationLinePresets.position1);
  assert.equal(home.players.find((player) => player.id === seats[0].players[1].id).assignedRole, "CB");
  assert.equal(home.players.find((player) => player.id === seats[0].players[3].id).assignedRole, "LWB");
});

test("YDL V2 联赛适配器生成可结算和可观赛的完整报告", () => {
  const seats = [
    buildS4BalanceSeat("ydl-v2-adapter", "home", "traitHeavy"),
    buildS4BalanceSeat("ydl-v2-adapter", "away", "enhanced"),
  ];
  const startedAt = 1_800_000_000_000;
  const match = createYdlLeagueV2Match(seats, {
    now:startedAt,
    seed:"ydl-v2-adapter-match",
    weather:"rain",
    referee:"strict",
    competitionMode:"league",
  });

  advanceYdlLeagueV2Match(match, startedAt + 120_001, { maximumChains:Infinity });
  const view = publicYdlLeagueV2Match(match, startedAt + 120_001, null, true);

  assert.equal(match.version, 2);
  assert.equal(match.finished, true);
  assert.equal(match.report.modelVersion, "match-engine-v2-alpha.15");
  assert.equal(view.minute, 90);
  assert.ok(Number.isInteger(view.minute));
  assert.ok(view.events.every((event) => Number.isInteger(event.minute)));
  assert.ok(view.report.events.every((event) => Number.isInteger(event.minute)));
  assert.deepEqual(view.weather, { key:"rain", name:"雨天", precipitation:72, wind:18 });
  assert.equal(view.referee.key, "strict");
  assert.equal(view.referee.name, "严格");
  assert.match(view.referee.description, /身体接触/);
  assert.equal(view.report.score.length, 2);
  assert.equal(view.teams.length, 2);
  assert.ok(view.events.some((event) => event.type === "fulltime"));
  assert.ok(match.report.teams.every((team) => team.players.length === 11));
  assert.ok(match.report.teams.every((team) => team.players.every((player) => Number.isFinite(player.rating) && Number.isFinite(player.stats.goals))));
  assert.ok(match.report.teams.every((team) => Number.isFinite(team.stats.possession) && Number.isFinite(team.stats.xg)));
  assert.ok(match.report.teams.every((team) => team.tacticalFit >= 45 && team.tacticalFit <= 99 && team.styleFit > 0));
  assert.equal(match.report.tacticalReview.version, 1);
  assert.deepEqual(match.report.tacticalReview.teams.map((team) => team.zones.length), [20, 20]);
  assert.deepEqual(match.report.tacticalReview.teams.map((team) => team.zones.reduce((sum, zone) => sum + zone.starts, 0)), match.report.teams.map((team) => team.stats.possessions));
  assert.deepEqual(match.report.tacticalReview.teams.map((team) => team.zones.reduce((sum, zone) => sum + zone.shots, 0)), match.report.teams.map((team) => team.stats.shots));
  assert.ok(match.report.analysisTimeline.length >= 1);
  assert.ok(match.report.analysisTimeline.every((snapshot) => snapshot.teams.every((team) => team.positions
    && team.players.length === 11
    && team.structureIndex >= .45
    && team.positionFit >= .35
    && team.tacticalFit >= .45)));

  const oldV2Report = structuredClone(match.report);
  oldV2Report.analysisTimeline.forEach((snapshot) => snapshot.teams.forEach((team) => {
    delete team.structureIndex;
    delete team.positionFit;
    delete team.tacticalFit;
  }));
  oldV2Report.score = [0, 1];
  oldV2Report.aggregateScore = null;
  oldV2Report.winnerIndex = 1;
  const hydrated = hydrateHistoricalMatchDetail({ ...oldV2Report, viewerIndex:0 });
  assert.ok(hydrated.analysisTimeline.every((snapshot) => snapshot.teams.every((team) => team.structureIndex > 0 && team.positionFit > 0 && team.tacticalFit > 0)));
  assert.ok(hydrated.review.lossAttribution.items.find((item) => item.key === "formation").detail.includes("位置 0%") === false);
});

test("YDL V2 公开直播使用整数分钟和完整中文互动播报", () => {
  const seats = [
    buildS4BalanceSeat("ydl-v2-commentary", "home", "traitHeavy"),
    buildS4BalanceSeat("ydl-v2-commentary", "away", "enhanced"),
  ];
  const startedAt = 1_800_000_000_000;
  const match = createYdlLeagueV2Match(seats, {
    now:startedAt,
    seed:"commentary-smoke",
    weather:"sunny",
    referee:"lenient",
    competitionMode:"league",
  });

  advanceYdlLeagueV2Match(match, startedAt + 61_000, { maximumChains:Infinity });
  const view = publicYdlLeagueV2Match(match, startedAt + 61_000, null, true);
  const playerNames = seats.flatMap((seat) => seat.players.map((player) => player.name));
  const interactionEvents = view.events.filter((event) => ["attack", "duel", "counter"].includes(event.type));

  assert.ok(Number.isInteger(view.minute));
  assert.ok(view.minute > 0 && view.minute < 90);
  assert.ok(view.events.every((event) => Number.isInteger(event.minute)));
  assert.equal(view.referee.key, "lenient");
  assert.equal(view.referee.name, "宽松");
  assert.ok(interactionEvents.some((event) => playerNames.filter((name) => event.text.includes(name)).length >= 2));
  assert.doesNotMatch(view.events.map((event) => event.text).join("\n"), /throughBall|cutback|longShot|setPiece|rebound|counter|opening|leading|trailing/);
});

test("YDL V2 默认分批推进适合整轮多场并行直播", () => {
  const startedAt = 1_800_000_000_000;
  const matches = Array.from({ length:5 }, (_, index) => createYdlLeagueV2Match([
    buildS4BalanceSeat(`parallel-${index}`, "home", "traitHeavy"),
    buildS4BalanceSeat(`parallel-${index}`, "away", "enhanced"),
  ], { now:startedAt, seed:`parallel-${index}`, competitionMode:"league" }));

  const before = performance.now();
  matches.forEach((match) => advanceYdlLeagueV2Match(match, startedAt + 60_000));
  const elapsed = performance.now() - before;

  assert.ok(matches.every((match) => match.nextChainIndex === 8));
  assert.ok(elapsed < 5_000, `5场V2分批推进耗时${elapsed.toFixed(0)}ms`);
});

test("YDL V2 杯赛在两回合总比分打平后先踢加时赛再点球决胜", () => {
  const startedAt = 1_800_000_000_000;
  const match = createYdlLeagueV2Match([
    buildS4BalanceSeat("cup-tie", "home", "traitHeavy"),
    buildS4BalanceSeat("cup-tie", "away", "enhanced"),
  ], {
    now:startedAt,
    seed:"cup-aggregate-penalties",
    competitionMode:"cup",
    legNumber:2,
    regulationOnly:false,
    aggregateBaseScore:[1, 0],
  });
  match.teams[0].score = 0;
  match.teams[1].score = 1;
  match.score = [0, 1];
  match.nextChainIndex = 180;
  advanceYdlLeagueV2Match(match, startedAt + 120_001, { maximumChains:Infinity });

  assert.equal(match.finished, false);
  assert.equal(match.segment, "extraTimeFirstHalf");
  assert.deepEqual(match.regulationScore, [0, 1]);
  assert.equal(match.events.at(-1).type, "extraTimeStart");

  match.nextChainIndex = match.possessionChainCount;
  advanceYdlLeagueV2Match(match, startedAt + 180_000, { maximumChains:Infinity });

  assert.deepEqual(match.report.aggregateBaseScore, [1, 0]);
  assert.deepEqual(match.report.aggregateScore, [1, 1]);
  assert.equal(match.report.extraTimePlayed, true);
  assert.deepEqual(match.report.extraTimeScore, [0, 0]);
  assert.ok(Number.isInteger(match.report.winnerIndex));
  assert.ok(match.report.penalties[0] !== match.report.penalties[1]);
  assert.ok(match.report.events.some((event) => event.type === "extraTimeHalfTime" && event.minute === 105));
  assert.ok(match.report.events.some((event) => event.type === "penaltyShootoutStart" && event.minute === 120));
  assert.ok(match.report.events.some((event) => event.type === "penaltyShootoutKick" && event.minute === 120));
  assert.match(match.report.events.at(-1).text, /点球大战结束/);
});

test("YDL V2 加时赛执行60条真实控球链并覆盖90至120分钟", () => {
  const startedAt = 1_800_000_000_000;
  const match = createYdlLeagueV2Match([
    buildS4BalanceSeat("extra-time-chains", "home", "traitHeavy"),
    buildS4BalanceSeat("extra-time-chains", "away", "enhanced"),
  ], { now:startedAt, seed:"extra-time-chains", competitionMode:"cup", regulationOnly:false });
  match.nextChainIndex = 180;
  match.score = [0, 0];
  match.teams.forEach((team) => { team.score = 0; });

  advanceYdlLeagueV2Match(match, startedAt + 140_000, { maximumChains:Infinity });
  assert.equal(match.nextChainIndex, 210);
  assert.equal(match.segment, "extraTimeSecondHalf");
  assert.equal(match.events.some((event) => event.type === "extraTimeHalfTime" && event.minute === 105), true);
  assert.equal(match.chains.length, 30);
  assert.ok(match.events.filter((event) => !["kickoff", "extraTimeStart", "extraTimeHalfTime"].includes(event.type)).every((event) => event.minute >= 90 && event.minute <= 105));

  advanceYdlLeagueV2Match(match, startedAt + 160_001, { maximumChains:Infinity });
  assert.equal(match.finished, true);
  assert.equal(match.minute, 120);
  assert.equal(match.nextChainIndex, 240);
  assert.equal(match.report.extraTimePlayed, true);
  assert.ok(match.report.events.some((event) => event.type === "fulltime" && event.minute === 120));
});

test("YDL V2 点球大战按IFAB规则交替主罚、人数均等且球员轮完前不重复", () => {
  const match = createYdlLeagueV2Match([
    buildS4BalanceSeat("shootout-laws", "home", "traitHeavy"),
    buildS4BalanceSeat("shootout-laws", "away", "enhanced"),
  ], { seed:"shootout-laws", competitionMode:"cup", regulationOnly:false });
  match.teams[0].players.find((player) => player.role !== "GK").active = false;

  const shootout = v2PenaltyShootout(match);
  assert.deepEqual(shootout.eligiblePlayerIds.map((ids) => ids.length), [10, 10]);
  assert.deepEqual(shootout.excludedPlayerIds.map((ids) => ids.length), [0, 1]);
  assert.ok(shootout.eligiblePlayerIds.every((ids, teamIndex) => ids.includes(match.teams[teamIndex].players.find((player) => player.role === "GK").id)));
  assert.notEqual(shootout.scores[0], shootout.scores[1]);
  shootout.kicks.forEach((kick, index) => {
    if (index > 0) assert.notEqual(kick.teamIndex, shootout.kicks[index - 1].teamIndex);
  });
  for (const teamIndex of [0, 1]) {
    const firstCycle = shootout.kicks.filter((kick) => kick.teamIndex === teamIndex).slice(0, shootout.eligiblePlayerIds[teamIndex].length);
    assert.equal(new Set(firstCycle.map((kick) => kick.takerId)).size, firstCycle.length);
  }
  assert.equal(match.events.filter((event) => event.type === "penaltyShootoutKick").length, shootout.kicks.length);
  assert.equal(match.events.at(-1).type, "penalties");
});
