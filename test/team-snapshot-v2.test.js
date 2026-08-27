import assert from "node:assert/strict";
import test from "node:test";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import { createS4BondCatalog } from "../versus/public/bond-rules.js";
import { buildV2TeamSnapshots } from "../versus/v2/team-snapshot-v2.js";

function player(id, role, options = {}) {
  return {
    id,
    name:id,
    role,
    heightCm:options.heightCm ?? 180,
    nationality:options.nationality ?? "测试国",
    club:options.club ?? "测试队",
    traits:options.traits ?? [],
    attributes:Object.fromEntries(ATTRIBUTE_NAMES.map((attribute) => [attribute, options.value ?? 70])),
    state:{ fitness:options.fitness ?? 100 },
  };
}

function team(name, players, style = "possession") {
  return {
    name,
    players,
    positions:Object.fromEntries(players.map((entry, index) => [entry.id, { x:15 + index * 7, y:index === 0 ? 90 : index < 5 ? 69 : index < 8 ? 45 : 19 }])),
    tactic:"balanced",
    style,
    bondCatalog:createS4BondCatalog(players, 1),
  };
}
test("队长风格只在指定队长仍在场时提供加成", () => {
  const homePlayers = Array.from({ length:11 }, (_, index) => player(`home-${index}`, index === 0 ? "GK" : "DM", { value:80 }));
  const awayPlayers = Array.from({ length:11 }, (_, index) => player(`away-${index}`, index === 0 ? "GK" : "DM"));
  const home = {
    ...team("home", homePlayers),
    captainId:"home-4",
    captainStyle:"commanding",
    bondCatalog:[],
  };
  const away = { ...team("away", awayPlayers), bondCatalog:[] };

  const active = buildV2TeamSnapshots([home, away]);
  assert.equal(active[0].v2Snapshot.captaincy.active, true);
  assert.equal(active[0].v2Snapshot.captaincy.captainId, "home-4");
  assert.equal(active[0].players.find((entry) => entry.id === "home-4").captain, true);
  assert.ok(active[0].v2Snapshot.captaincy.stage.shot > 0);

  home.players.find((entry) => entry.id === "home-4").active = false;
  const departed = buildV2TeamSnapshots([home, away]);
  assert.equal(departed[0].v2Snapshot.captaincy.active, false);
  assert.equal(departed[0].v2Snapshot.captaincy.captainId, null);
  assert.equal(departed[0].v2Snapshot.captaincy.leadership, 0);
  assert.deepEqual(departed[0].v2Snapshot.captaincy.stage, { buildUp:0, progression:0, finalThird:0, chance:0, shot:0 });
});

test("V2球队快照接入属性型和条件型特性", () => {
  const homePlayers = [
    player("trait", "ST", { traits:["custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20", "rain-boots"] }),
    ...["GK", "CB", "CB", "CB", "CB", "DM", "DM", "DM", "ST", "ST"].map((role, index) => ({ ...player(`home-${index}`, role), upgradeLevel:1 })),
  ];
  homePlayers[0].upgradeLevel = 1;
  const awayPlayers = Array.from({ length:11 }, (_, index) => player(`away-${index}`, index === 0 ? "GK" : "DM", { nationality:"对手国", club:"对手队" }));
  const home = team("home", homePlayers);
  const away = team("away", awayPlayers);
  home.bondCatalog = [];
  away.bondCatalog = [];
  const snapshots = buildV2TeamSnapshots([home, away], { environment:{ weather:"rain" } });
  const traitPlayer = snapshots[0].players.find((entry) => entry.id === "trait");
  assert.equal(traitPlayer.attributes.finishing, 82.5);
  assert.equal(traitPlayer.attributes.pace, 82.5);
  assert.equal(traitPlayer.attributes.passing, 77);
  assert.deepEqual(traitPlayer.v2AppliedTraitIds, ["custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20", "rain-boots"]);
});

test("V2球队快照复用正式国家与俱乐部羁绊并只叠加前两条", () => {
  const homePlayers = Array.from({ length:11 }, (_, index) => player(`home-${index}`, index === 0 ? "GK" : index < 5 ? "CB" : index < 8 ? "DM" : "ST"));
  const awayPlayers = Array.from({ length:11 }, (_, index) => player(`away-${index}`, index === 0 ? "GK" : "DM", { nationality:"对手国", club:"对手队" }));
  const snapshots = buildV2TeamSnapshots([team("home", homePlayers), team("away", awayPlayers)]);
  const snapshot = snapshots[0];
  assert.equal(snapshot.v2Snapshot.activeBonds.length, 2);
  assert.ok(snapshot.players.every((entry) => entry.attributes.passing > 70));
  assert.ok(snapshot.players.every((entry) => entry.ydlBondIds.length === 2));
});

test("V2球队快照对基础值和所有叠加后的单项能力统一封顶99", () => {
  const homePlayers = Array.from({ length:11 }, (_, index) => player(`home-${index}`, index === 0 ? "GK" : "DM", { value:109 }));
  const awayPlayers = Array.from({ length:11 }, (_, index) => player(`away-${index}`, index === 0 ? "GK" : "DM", { value:70, nationality:"对手国", club:"对手队" }));
  const snapshots = buildV2TeamSnapshots([
    { ...team("home", homePlayers), bondCatalog:[] },
    { ...team("away", awayPlayers), bondCatalog:[] },
  ]);
  assert.equal(snapshots[0].players[0].displayAttributes.passing, 99);
  assert.equal(snapshots[0].players[0].attributes.passing, 99);
  assert.ok(snapshots.flatMap((entry) => entry.players).every((entry) => Object.values(entry.attributes).every((value) => Number(value) <= 99)));
});

test("固定体能和比分条件特性使用当前比赛状态", () => {
  const homePlayers = [
    player("fixed", "ST", { traits:["stoppage-time-expert"], fitness:30 }),
    ...Array.from({ length:10 }, (_, index) => player(`home-${index}`, index === 0 ? "GK" : "DM")),
  ];
  const awayPlayers = Array.from({ length:11 }, (_, index) => player(`away-${index}`, index === 0 ? "GK" : "DM", { nationality:"对手国", club:"对手队" }));
  const snapshots = buildV2TeamSnapshots([team("home", homePlayers), team("away", awayPlayers)], { state:{ minute:80, score:[0, 1] } });
  assert.equal(snapshots[0].players.find((entry) => entry.id === "fixed").state.fitness, 90);
  assert.equal(snapshots[0].v2Snapshot.scoreState, "trailing");
  assert.equal(snapshots[1].v2Snapshot.scoreState, "leading");
});

test("YDL新增三张特性卡按比分和战术条件生效", () => {
  const homePlayers = [
    player("score-state", "ST", { traits:["custom-d98bfc9a-2168-4e80-982d-c1cebef18e80"] }),
    player("park-bus", "CB", { traits:["custom-3b12d163-d3d9-47df-b6b7-e1d124abcb62"] }),
    ...Array.from({ length:9 }, (_, index) => player(`home-${index}`, index === 0 ? "GK" : "DM")),
  ];
  const awayPlayers = Array.from({ length:11 }, (_, index) => player(`away-${index}`, index === 0 ? "GK" : "DM", { nationality:"对手国", club:"对手队" }));
  const snapshots = buildV2TeamSnapshots([
    { ...team("home", homePlayers), tactic:"parkBus", bondCatalog:[] },
    { ...team("away", awayPlayers), bondCatalog:[] },
  ], { state:{ minute:30, score:[1, 0] } });
  const scoreState = snapshots[0].players.find((entry) => entry.id === "score-state");
  const parkBus = snapshots[0].players.find((entry) => entry.id === "park-bus");
  assert.equal(scoreState.attributes.finishing, 79.31);
  assert.equal(parkBus.attributes.strength, 82.92);

  const trailing = buildV2TeamSnapshots([
    { ...team("home", homePlayers), tactic:"balanced", bondCatalog:[] },
    { ...team("away", awayPlayers), bondCatalog:[] },
  ], { state:{ minute:30, score:[0, 1] } });
  assert.equal(trailing[0].players.find((entry) => entry.id === "score-state").attributes.finishing, 61.29);
});
