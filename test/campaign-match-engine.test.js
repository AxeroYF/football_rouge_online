import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAccountMatchSeat,
  buildTerritoryDefenderSeat,
  simulateCampaignTerritoryMatch,
} from "../engine/campaign-match-engine.mjs";
import { AI_FORMATIONS, createTerritoryAiGarrison } from "../engine/territory-ai.mjs";

const catalog = JSON.parse(readFileSync(new URL("../assets/data/s4-player-catalog.json", import.meta.url), "utf8")).filter((player) => player.isX !== true);

function balancedRoster() {
  return [
    ...catalog.filter((player) => player.pool === "GK").slice(0, 2),
    ...catalog.filter((player) => player.pool === "DEF").slice(0, 7),
    ...catalog.filter((player) => player.pool === "MID").slice(0, 7),
    ...catalog.filter((player) => player.pool === "ATT").slice(0, 6),
  ];
}

test("migrated S4 V2.1 engine independently settles a campaign territory match", () => {
  const attacker = buildAccountMatchSeat({ id:"player-1", nickname:"测试经理", draft:{ teamName:"黄狗测试队", roster:balancedRoster() } });
  const territory = { territoryId:"test-territory", country:"测试国", name:"测试省", initialOwner:{ name:"中立地区" } };
  const defender = buildTerritoryDefenderSeat({ catalog, territory, territoryState:{ ownerType:"neutral", ownerId:null }, seed:"campaign-v21-test" });
  const result = simulateCampaignTerritoryMatch({
    attacker,
    defender,
    territoryId:territory.territoryId,
    seed:"campaign-v21-test",
    possessionChains:12,
    weather:{ type:"storm", precipitation:84 },
  });

  assert.equal(result.engine.modelVersion, "match-engine-v2.1");
  assert.equal(result.engine.profile, "v2.1-stable-dynamic.2");
  assert.equal(result.teams.length, 2);
  assert.equal(result.teams[0].name, "黄狗测试队");
  assert.ok(["win", "draw", "loss"].includes(result.outcome));
  assert.ok(result.events.some((event) => event.type === "fulltime"));
  assert.equal(result.broadcasts.length, 1);
  assert.equal(result.broadcasts[0].environment.weather, "storm");
  assert.equal(result.broadcasts[0].environment.precipitation, 84);
  assert.equal(result.broadcasts[0].teams.length, 2);
  assert.ok(result.broadcasts[0].teams.every((team) => Number(team.stats.possession) >= 0));
  assert.ok(result.broadcasts[0].teams.every((team) => team.activeCount >= 0 && team.players.length === 11));
  assert.ok(result.broadcasts[0].teams.flatMap((team) => team.players).every((player) => player.position && Number.isFinite(player.overall) && Number.isFinite(player.rating)));
});

test("territory AI uses diverse coordinate formations and exact primary-position players", () => {
  assert.ok(Object.keys(AI_FORMATIONS).length >= 10);
  const formations = new Set();
  for (let index=0;index<80;index+=1) {
    const territory={territoryId:`ai-${index}`,countryCode:index%2?"GBR":"ALB",name:`区域${index}`};
    const garrison=createTerritoryAiGarrison({catalog,territory,territoryState:{ownerType:"neutral"},generationSeed:"formation-test"});
    formations.add(garrison.formation);
    assert.equal(garrison.lineup.length,11);
    assert.equal(garrison.lineup.filter((slot)=>slot.role==="GK").length,1);
    for (const slot of garrison.lineup) assert.equal(catalog.find((player)=>player.id===slot.playerId)?.role,slot.role);
  }
  assert.ok(formations.size >= 8);
});
