import test from "node:test";
import assert from "node:assert/strict";
import {
  hasTraitRule,
  hydratePlayerTraits,
  traitAdjustedAttribute,
  traitAffinityMatches,
  traitPositionFit,
} from "../game/public/trait-runtime.js";
import { REAL_PLAYER_POOLS } from "../versus/player-pool.js";
import {
  REGULAR_DURATION_MS,
  advanceVersusMatch,
  createVersusMatch,
} from "../versus/match-engine.js";
import { defaultElevenPositions } from "../versus/rules.js";
import { YDL_TRAIT_CARDS, YDL_TRAIT_IDS } from "../versus/trait-pool.js";

const EXPECTED_NAMES = [
  "激素紧缺",
  "打点激素",
  "避雷针",
  "都是哥们",
  "因凡蒂诺救救我",
  "反向晴天娃娃",
  "本质大心脏",
  "变色龙",
  "跳水王子",
  "铁血蓝白",
  "996",
  "借过一下",
  "全能战士",
  "一夫当关",
  "普拉蒂尼是我爹",
];

function carrier(traitIds, overrides = {}) {
  return hydratePlayerTraits({
    id:"ydl-trait-carrier",
    role:"RW",
    assignedRole:"RW",
    heightCm:170,
    state:{ fitness:74 },
    attributes:{},
    traits:traitIds,
    ...overrides,
  }, YDL_TRAIT_CARDS, "ydl-traits");
}

function matchSeat(name, offset, playerTraits = {}) {
  const players = [
    REAL_PLAYER_POOLS.GK[offset],
    ...REAL_PLAYER_POOLS.DEF.slice(offset, offset + 4),
    ...REAL_PLAYER_POOLS.MID.slice(offset, offset + 3),
    ...REAL_PLAYER_POOLS.ATT.slice(offset, offset + 3),
  ].map((player) => ({ ...player, traits:[...(playerTraits[player.id] ?? [])] }));
  return { name, players, positions:defaultElevenPositions(players), tactic:"balanced", style:"possession" };
}

test("YDL后台和强化池包含15张已实现特性卡", () => {
  assert.equal(YDL_TRAIT_CARDS.length, 15);
  assert.deepEqual(YDL_TRAIT_CARDS.map((trait) => trait.name), EXPECTED_NAMES);
  assert.equal(new Set(YDL_TRAIT_IDS).size, 15);
  assert.ok(YDL_TRAIT_CARDS.every((trait) => trait.rules.length > 0));
});

test("YDL数值、身高、位置、羁绊和固定体力规则按说明执行", () => {
  const shortage = carrier(["custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20"], { attributes:{ finishing:70, pace:71, dribbling:72 } });
  assert.equal(shortage.heightCm, 160);
  assert.equal(traitAdjustedAttribute(shortage, "finishing", 70), 75);
  assert.equal(traitAdjustedAttribute(shortage, "pace", 71), 76);
  assert.equal(traitAdjustedAttribute(shortage, "dribbling", 72), 77);

  const target = carrier(["aerial-beacon", "rain-boots", "sweeper-keeper", "opening-sprint", "stoppage-time-expert", "lone-finisher"]);
  assert.equal(target.heightCm, 190);
  assert.equal(target.state.fitness, 90);
  assert.equal(traitPositionFit({ ...target, assignedRole:"ST" }, 0.56), 1);
  assert.equal(traitAdjustedAttribute(target, "finishing", 80, { minute:20, weather:{ type:"rain" }, teamStyle:"balanced" }), 88);
  assert.equal(traitAdjustedAttribute(target, "finishing", 80, { minute:80, weather:{ type:"sunny" }, teamStyle:"balanced" }), 88);
  assert.equal(traitAdjustedAttribute(target, "finishing", 80, { minute:20, weather:{ type:"sunny" }, teamStyle:"roughPlay" }), 84);
  assert.equal(traitAffinityMatches(target, "club", "任意俱乐部"), true);
  assert.equal(traitAffinityMatches(target, "nationality", "任意国家队"), true);

  const wing = carrier(["double-edged-core"], { assignedRole:"LW", attributes:{ pace:70 } });
  assert.equal(traitPositionFit(wing, 0.56), 1);
  assert.equal(traitAdjustedAttribute(wing, "pace", 70), 75);

  const utility = carrier(["utility-player"], { assignedRole:"CB" });
  assert.equal(traitPositionFit(utility, 0.56), 1);
  assert.equal(traitPositionFit({ ...utility, assignedRole:"GK" }, 0.35), 0.35);
});

test("YDL事件型特性规则进入十一人模拟且正式比赛会清除旧传奇能力", () => {
  const homeBase = matchSeat("避雷甲", 0);
  const awayBase = matchSeat("避雷乙", 12);
  homeBase.players[1].traits = ["touchline-flywheel"];
  awayBase.players[1].traits = ["touchline-flywheel"];
  homeBase.players[1].legendAbility = { id:"test-legend", name:"测试传奇能力" };
  homeBase.players[1].traits.push("rain-boots");
  const storm = createVersusMatch([homeBase, awayBase], { now:0, seed:"ydl-lightning-protection", weather:"storm", competitionMode:"league" });
  storm.lightningMinute = 1;
  advanceVersusMatch(storm, 2_000);
  assert.ok(storm.events.some((event) => event.type === "lightning" && event.prevented));
  assert.equal(storm.teams.flatMap((team) => team.players).filter((player) => !player.active).length, 0);
  const legendCarrier = storm.teams[0].players.find((player) => player.id === homeBase.players[1].id);
  assert.equal(legendCarrier.legendAbility, null);
  assert.deepEqual(legendCarrier.traitDefinitions.map((trait) => trait.id), ["touchline-flywheel", "rain-boots"]);

  const fixedSeat = matchSeat("996队", 0);
  fixedSeat.players[1].traits = ["stoppage-time-expert"];
  const fixedMatch = createVersusMatch([fixedSeat, matchSeat("对手", 12)], { now:0, seed:"ydl-fixed-fitness", weather:"sunny" });
  advanceVersusMatch(fixedMatch, REGULAR_DURATION_MS / 4);
  assert.equal(fixedMatch.teams[0].players.find((player) => player.id === fixedSeat.players[1].id).state.fitness, 90);
});

test("因凡蒂诺与一夫当关会改变黑哨和第一粒点球结果", () => {
  const favored = matchSeat("救援队", 0);
  const punished = matchSeat("少阿根廷队", 12);
  favored.players.forEach((player) => { player.nationality = null; });
  punished.players.forEach((player) => { player.nationality = null; });
  punished.players[1].nationality = "阿根廷";
  favored.players[1].traits = ["set-piece-toolbox"];
  punished.players[0].traits = ["muddy-knees"];
  const match = createVersusMatch([favored, punished], { now:0, seed:"ydl-black-whistle-traits", weather:"sunny", referee:"strict" });
  match.blackWhistleMinute = 1;
  advanceVersusMatch(match, 2_000);
  const blackWhistle = match.events.find((event) => event.type === "blackWhistle");
  const penalty = match.events.find((event) => event.type === "penalty");
  assert.equal(blackWhistle.teamIndex, 0);
  assert.deepEqual(blackWhistle.argentinaCounts, [11, 1]);
  assert.equal(penalty.scored, false);
  assert.equal(penalty.traitName, "一夫当关");
});

test("跳水、默契和红牌免疫规则均由模拟核心识别", () => {
  const target = carrier(["big-stage", "shadow-marker", "pace-budget"]);
  assert.ok(hasTraitRule(target, "penaltyDraw", (rule) => rule.penaltyMultiplier > 1));
  assert.ok(hasTraitRule(target, "chemistry", (rule) => rule.linkNearby && rule.value === 100));
  assert.ok(hasTraitRule(target, "redCardImmune", (rule) => rule.immune));
});
