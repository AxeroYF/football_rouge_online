import test from "node:test";
import assert from "node:assert/strict";
import { calculateV2DutyFit, calculateV2TacticalFit } from "../versus/public/v2-tactical-fit.js";
import { applyV2TacticalProfiles, DEFAULT_IN_POSSESSION_DETAILS, DEFAULT_OUT_OF_POSSESSION_DETAILS } from "../versus/public/v2-tactical-profiles.js";

const roles = { gk:"GK", lb:"LB", cb1:"CB", cb2:"CB", rb:"RB", dm:"DM", cm:"AM", lm:"LM", rm:"RM", st1:"ST", st2:"ST" };
const positions = {
  gk:{ x:50, y:90 }, lb:{ x:14, y:67 }, cb1:{ x:38, y:68 }, cb2:{ x:62, y:68 }, rb:{ x:86, y:67 },
  dm:{ x:50, y:51 }, cm:{ x:50, y:39 }, lm:{ x:20, y:44 }, rm:{ x:80, y:44 }, st1:{ x:40, y:20 }, st2:{ x:60, y:20 },
};
const formationLines = { attack:20, midfield:44, defense:68, goalkeeper:90 };
const attributes = ["passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces", "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline", "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression", "goalkeeping", "reflexes"];
const players = (value) => Object.keys(roles).map((id) => ({ id, overall:value, attributes:Object.fromEntries(attributes.map((key) => [key, value])) }));
const dimensions = { tempo:58, directness:45, attackingWidth:55, defensiveLine:58, pressing:62, compactness:60, counterAttack:50, timeWasting:10 };

test("V2战术适配度使用球员26项执行能力而非旧版单一打法分数", () => {
  const plan = { tactic:"positive", style:"possession", inPossession:"shortPassing", outOfPossession:"highPress" };
  const elite = calculateV2TacticalFit(players(92), roles, positions, formationLines, plan, dimensions);
  const limited = calculateV2TacticalFit(players(55), roles, positions, formationLines, plan, dimensions);
  assert.ok(elite > limited + 25);
  assert.ok(elite <= 99 && limited >= 45);
});

test("V2战术适配度会评价阵型线与防线、宽度及紧凑度参数的一致性", () => {
  const plan = { tactic:"balanced", style:"possession", inPossession:"balanced", outOfPossession:"highPress" };
  const highCompactDimensions = { ...dimensions, defensiveLine:88, compactness:86, attackingWidth:50 };
  const alignedLines = { attack:28, midfield:39, defense:48, goalkeeper:88 };
  const disconnectedLines = { attack:8, midfield:47, defense:82, goalkeeper:92 };
  const aligned = calculateV2TacticalFit(players(78), roles, positions, alignedLines, plan, highCompactDimensions);
  const disconnected = calculateV2TacticalFit(players(78), roles, positions, disconnectedLines, plan, highCompactDimensions);
  assert.ok(aligned > disconnected);
});

test("保留的详细持球与无球指令会转换为V2连续战术参数", () => {
  const detailed = applyV2TacticalProfiles(
    { tempo:50, directness:50, attackingWidth:50, defensiveLine:50, pressing:50, compactness:50, counterAttack:50, timeWasting:20 },
    "balanced",
    "balanced",
    { ...DEFAULT_IN_POSSESSION_DETAILS, tempo:"extreme", directness:"direct", chanceCreation:"shootOnSight", crossing:"increase" },
    { ...DEFAULT_OUT_OF_POSSESSION_DETAILS, pressing:"relentless", compactness:"tight", marking:"man", lineStrategy:"offside" },
  );
  assert.equal(detailed.tempo, 57);
  assert.equal(detailed.directness, 54);
  assert.equal(detailed.attackingWidth, 59);
  assert.equal(detailed.defensiveLine, 68);
  assert.equal(detailed.pressing, 58);
  assert.equal(detailed.compactness, 45);
});

test("球员职责按26项能力与位置适配度进入战术适配度", () => {
  const basePlayers = players(70);
  const striker = basePlayers.find((player) => player.id === "st1");
  Object.assign(striker.attributes, {
    strength:96, heading:94, jumping:93, firstTouch:91, passing:86,
    decisions:88, composure:90, offBall:87, finishing:48, pace:52, acceleration:50,
  });
  const plan = {
    tactic:"balanced",
    style:"longBall",
    inPossession:"longBall",
    outOfPossession:"midBlock",
    playerDuties:{ st1:"targetForward" },
  };
  const dutyFit = calculateV2DutyFit(basePlayers, roles, plan);
  const tacticalFit = calculateV2TacticalFit(basePlayers, roles, positions, formationLines, plan, dimensions);
  const mismatchedPlan = { ...plan, playerDuties:{ st1:"advancedForward" } };
  const mismatchedDutyFit = calculateV2DutyFit(basePlayers, roles, mismatchedPlan);
  const mismatchedTacticalFit = calculateV2TacticalFit(basePlayers, roles, positions, formationLines, mismatchedPlan, dimensions);

  assert.ok(dutyFit > mismatchedDutyFit + 15);
  assert.ok(tacticalFit > mismatchedTacticalFit);
  assert.equal(calculateV2DutyFit(basePlayers, roles, { ...plan, playerDuties:{} }), null);
});
