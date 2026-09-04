import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAccountMatchSeat,
  buildTerritoryDefenderSeat,
  simulateCampaignTerritoryMatch,
} from "../engine/campaign-match-engine.mjs";
import {
  AI_FORMATIONS,
  createTerritoryAiGarrison,
  createTerritoryDifficulty,
  NEUTRAL_DIFFICULTY_WEIGHTS,
  TERRITORY_AI_SCHEMA_VERSION,
} from "../engine/territory-ai.mjs";
import { autoCompletePlayerSquads } from "../shared/config/player-squads.mjs";

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

test("player attacks use expedition while player defenses use a disjoint garrison", () => {
  const roster=balancedRoster();
  const completed=autoCompletePlayerSquads(null,roster);
  const assignments=completed.playerSquads.assignments;
  const ids=(squadId)=>roster.filter((player)=>assignments[player.id]===squadId).map((player)=>player.id);
  const account={ id:"dual-squad",nickname:"双阵容经理",playerSquads:completed.playerSquads,draft:{teamName:"双阵容队",roster},tactics:{squads:{expedition:{starters:ids("expedition"),attackStyle:"positive"},garrison:{starters:ids("garrison"),attackStyle:"defensive"}}} };
  const expedition=buildAccountMatchSeat(account,"expedition");
  const garrison=buildAccountMatchSeat(account,"garrison");
  assert.equal(expedition.tactic,"positive");
  assert.equal(garrison.tactic,"defensive");
  assert.deepEqual(expedition.players.map((player)=>player.id).filter((id)=>garrison.players.some((player)=>player.id===id)),[]);
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

test("neutral territory difficulty targets a 3.5-star weighted distribution", () => {
  assert.deepEqual(NEUTRAL_DIFFICULTY_WEIGHTS,[10,15,20,25,30]);
  const counts=[0,0,0,0,0];
  for (let index=0;index<10000;index+=1) {
    const difficulty=createTerritoryDifficulty({territoryId:`distribution-${index}`,generationSeed:"difficulty-test"});
    counts[difficulty-1]+=1;
  }
  const average=counts.reduce((sum,count,index)=>sum+count*(index+1),0)/10000;
  assert.ok(counts[0]+counts[1]<counts[2]+counts[3]+counts[4]);
  assert.ok(Math.abs(average-3.5)<0.05,`expected average difficulty near 3.5, received ${average}`);
});

test("club territory difficulty remains one star above its neutral roll and garrisons use the current schema", () => {
  for (let index=0;index<100;index+=1) {
    const options={territoryId:`club-${index}`,generationSeed:"difficulty-test"};
    const neutral=createTerritoryDifficulty(options);
    const club=createTerritoryDifficulty({...options,clubOwned:true});
    assert.equal(club,Math.min(5,neutral+1));
  }
  const garrison=createTerritoryAiGarrison({catalog,territory:{territoryId:"schema-test",countryCode:"ALB"},territoryState:{ownerType:"neutral"}});
  assert.equal(garrison.schemaVersion,TERRITORY_AI_SCHEMA_VERSION);
});
