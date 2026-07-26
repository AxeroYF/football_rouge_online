import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configFromState, runSeasonSimulation } from "../versus/season-simulation.js";
import { REAL_PLAYER_POOLS } from "../versus/player-pool.js";
import { defaultElevenPositions } from "../versus/rules.js";

test("赛季模拟配置可以从正式状态的非敏感阵容字段生成", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../versus/season-simulation-config-s3.json", import.meta.url), "utf8"));
  const state = {
    season:{ id:"test-season", name:"S3" },
    updatedAt:0,
    teams:snapshot.teams.map((team) => ({ ...team, ownerName:team.coach })),
  };
  const config = configFromState(state, { iterations:1 });
  assert.equal(config.teams.length, 10);
  assert.equal(config.teams.every((team) => team.preferredStarterIds.length === 11), true);
  assert.equal(config.teams.some((team) => "ownerId" in team), false);
  assert.equal(config.teams.some((team) => "playerState" in team), false);
});

test("赛季模拟以固定种子输出完整联赛和杯赛概率", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../versus/season-simulation-config-s3.json", import.meta.url), "utf8"));
  const teams = snapshot.teams.map((team, teamIndex) => {
    const goalkeeper = REAL_PLAYER_POOLS.GK.slice(teamIndex, teamIndex + 1);
    const defenders = REAL_PLAYER_POOLS.DEF.slice(teamIndex * 8, teamIndex * 8 + 8);
    const midfielders = REAL_PLAYER_POOLS.MID.slice(teamIndex * 8, teamIndex * 8 + 8);
    const attackers = REAL_PLAYER_POOLS.ATT.slice(teamIndex * 8, teamIndex * 8 + 8);
    const roster = [...goalkeeper, ...defenders, ...midfielders, ...attackers];
    const starters = [...goalkeeper, ...defenders.slice(0, 4), ...midfielders.slice(0, 3), ...attackers.slice(0, 3)];
    return {
      ...team,
      rosterIds:roster.map((player) => player.id),
      preferredStarterIds:starters.map((player) => player.id),
      positions:defaultElevenPositions(starters),
    };
  });
  const config = { ...snapshot, teams, iterations:1, seed:"season-simulation-test", sampleSeasonCount:1 };
  const result = runSeasonSimulation(config);
  assert.equal(result.iterations, 1);
  assert.equal(result.teams.length, 10);
  assert.equal(result.teams.reduce((sum, team) => sum + team.league.titleRatePercent, 0), 100);
  assert.equal(result.teams.reduce((sum, team) => sum + team.cup.championRatePercent, 0), 100);
  assert.equal(result.samples[0].league.length, 10);
  assert.equal(Object.keys(result.samples[0].cup).length, 10);
});
