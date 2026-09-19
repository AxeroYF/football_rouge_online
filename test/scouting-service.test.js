import assert from "node:assert/strict";
import test from "node:test";
import { ScoutingService } from "../server/application/scouting-service.mjs";
import { BuildingService } from "../server/application/building-service.mjs";
import { EconomyService } from "../server/application/economy-service.mjs";
import { SCOUTING_RULES, scoutingLevel } from "../shared/config/scouting.mjs";
import { coreCountryForNationality } from "../shared/config/countries.mjs";
import { CampaignService } from "../campaign-service.mjs";

function fixture({ recruit = true } = {}) {
  let clock = 1000, saved = null, failSave = false;
  const catalog = ["C", "B", "A", "S"].flatMap((grade) => ["西班牙", "德国", "中国"].flatMap((nationality) => Array.from({ length: 4 }, (_, i) => ({
    id: `${grade}-${nationality}-${i}`, name: `${nationality}${i}`, grade, nationality, pool: "ATT", role: "ST", overall: 80, attributes: { passing: 98, finishing: 80 }, state: { fitness: 100 },
  }))));
  const account = { id: "p", nickname: "test", gold: 10_000, setupComplete: true, draft: { roster: [...catalog], offer: [] } };
  const building = { id: "scout-1", type: "scout-center", level: 1, status: "active" };
  const world = { revision: 0, territories: { home: { territoryId: "home", ownerType: "player", ownerId: "p", capitalOf: "p", buildings: [building] } }, players: { p: { territoryIds: ["home"] } } };
  const territoryIndex = { territories: [{ territoryId: "home", countryCode: "ESP", country: "西班牙", name: "马德里" }] };
  const economy = new EconomyService({ now: () => clock });
  const buildings = new BuildingService({ economy, now: () => clock });
  const save = () => { if (failSave) throw new Error("disk failure"); saved = structuredClone(account); };
  const service = new ScoutingService({ playerDatabase: catalog, buildings, economy, territoryIndex, random: () => 0.5, now: () => clock, save });
  const scoutId = recruit ? service.recruit(account, world, { territoryId:"home", buildingId:"scout-1", count:1, requestId:"recruit-one" })[0].id : null;
  const start = (requestId = "request-one") => service.start(account, world, { territoryId: "home", scoutId, requestId });
  return { scoutId, account, catalog, building, world, territoryIndex, service, buildings, start, setTime: (value) => { clock = value; }, saved: () => saved, failSave: (value) => { failSave = value; } };
}

test("paid scouting hides fixed candidates until ten minutes, persists and issues only one independent card", () => {
  const f = fixture(), before = f.account.draft.roster.length;
  const task = f.start();
  assert.equal(f.account.gold, 9300);
  assert.equal(task.completesAt - task.startedAt, 600_000);
  assert.deepEqual(task.cards, []);
  assert.equal(f.start().id, task.id);
  assert.equal(f.account.gold, 9300);
  assert.throws(() => f.start("request-two"), /选择球员/);
  const stored = f.saved().scouting.tasks[task.id];
  assert.equal(new Set(stored.candidates.map((p) => p.cardDefinitionId)).size, 3);
  assert.ok(stored.candidates.every((p) => f.catalog.some((source) => source.id === p.cardDefinitionId)));
  assert.throws(() => f.service.choose(f.account, task.id, stored.candidates[0].id), /尚未完成/);
  f.setTime(task.completesAt);
  const reloaded = structuredClone(f.saved());
  assert.equal(f.service.publicState(reloaded).tasks[0].status, "ready");
  assert.deepEqual(f.service.publicState(reloaded).tasks[0].cards.map((p) => p.playerId), stored.candidates.map((p) => p.id));
  assert.throws(() => f.service.choose(f.account, task.id, "foreign-card"), /不在本次候选/);
  const card = f.service.choose(f.account, task.id, stored.candidates[0].id);
  assert.equal(f.account.draft.roster.length, before + 1);
  assert.notEqual(card.playerId, card.cardDefinitionId);
  assert.equal(card.cardInstanceId, card.playerId);
  assert.deepEqual(f.service.choose(f.account, task.id, card.playerId), card);
  assert.equal(f.account.draft.roster.length, before + 1);
  assert.throws(() => f.service.choose(f.account, task.id, stored.candidates[1].id), /已经选择/);
  assert.equal(f.service.publicState(f.account).tasks.length, 0);
  f.start("request-next");
  assert.equal(f.account.gold, 8600);
});

test("recruitment validates center ownership and construction; discovery validates wallet and identity", () => {
  const f = fixture({recruit:false});
  const recruit = () => f.service.recruit(f.account,f.world,{territoryId:"home",buildingId:"scout-1",count:1,requestId:"recruit-one"});
  f.world.territories.home.ownerId = "other";
  assert.throws(recruit,/自己的/);
  f.world.territories.home.ownerId = "p";
  f.building.status = "constructing"; f.building.completesAt = 100_000;
  assert.throws(recruit,/尚未建成/);
  f.building.status = "inactive"; assert.throws(recruit,/尚未建成/);
  f.building.status = "active";
  const scoutId = recruit()[0].id;
  const start = requestId => f.service.start(f.account,f.world,{scoutId,territoryId:"home",requestId});
  f.account.gold = 499;
  assert.throws(()=>start("request-one"),/金币不足/);
  assert.equal(f.account.gold,499);
  f.account.gold = 1000; assert.throws(()=>start("x"),/请求编号/);
  start("request-one");
  assert.throws(()=>f.service.start(f.account,f.world,{scoutId:"other",requestId:"request-one"}),/另一名/);
  assert.throws(()=>f.service.start(f.account,f.world,{territoryId:"home",buildingId:"scout-1",requestId:"old-api-call"}),/先招募/);
  assert.throws(()=>f.service.choose({id:"other"},f.service.publicState(f.account).tasks[0].id,"anything"),/不存在/);
});

test("national bias applies within grade; British constituent countries count as core", () => {
  const f = fixture();
  f.service.random = () => 0.5;
  assert.ok(f.service.draw(1, "ESP").every((p) => p.nationality === "西班牙"));
  assert.ok(f.service.draw(1, "ISL").every((p) => p.nationality === "中国"));
  assert.equal(coreCountryForNationality("英格兰"), "GBR");
  assert.equal(coreCountryForNationality("苏格兰"), "GBR");
  assert.equal(coreCountryForNationality("威尔士"), "GBR");
  assert.equal(coreCountryForNationality("Northern Ireland"), "GBR");
  assert.equal(coreCountryForNationality("中国"), null);
  f.service.playerDatabase = f.catalog.filter((p) => p.nationality !== "中国");
  assert.equal(f.service.draw(1, "ISL").length, 3);
});

test("facility grade ranges, rare legends and independent +1 through +3 enhancement are respected", () => {
  const f = fixture();
  f.service.random = () => 0.9;
  assert.ok(f.service.draw(1, "ESP").every((p) => p.grade === "B"));
  assert.ok(f.service.draw(5, "ESP").every((p) => p.grade === "A"));
  assert.equal(scoutingLevel(0), scoutingLevel(1));
  assert.equal(scoutingLevel(99), scoutingLevel(5));
  for (const [roll, expected] of [[0.95, 1], [0.99, 2], [0.999, 3]]) {
    let index = 0;
    const rolls = [0, 0, 0, roll]; // legendary, preferred country, player, enhancement
    f.service.random = () => rolls[index++ % rolls.length];
    const cards = f.service.draw(1, "ESP");
    assert.ok(cards.every((p) => p.grade === "S" && p.upgradeLevel === expected));
    assert.ok(cards.every((p) => p.overall === 80 + expected && p.attributes.passing === 99 && p.attributes.finishing === 80 + expected));
    assert.equal(f.catalog[0].attributes.passing, 98);
  }
});

test("save failure rolls back spending or reward, allowing a safe retry", () => {
  const f = fixture();
  f.failSave(true);
  assert.throws(() => f.start(), /disk failure/);
  assert.equal(f.account.gold, 10_000);
  assert.deepEqual(f.account.scouting.tasks, {});
  assert.equal(f.service.units(f.account).length, 1);
  f.failSave(false);
  const task = f.start();
  f.setTime(task.completesAt);
  const card = f.service.publicState(f.account).tasks[0].cards[0];
  const count = f.account.draft.roster.length;
  f.failSave(true);
  assert.throws(() => f.service.choose(f.account, task.id, card.playerId), /disk failure/);
  assert.equal(f.account.draft.roster.length, count);
  assert.equal(f.service.publicState(f.account).tasks[0].status, "ready");
  f.failSave(false);
  f.service.choose(f.account, task.id, card.playerId);
  assert.equal(f.account.draft.roster.length, count + 1);
});

test("only one owned scout center is allowed after an instant build on non-capital land", () => {
  const f = fixture();
  f.world.territories.t2 = {ownerType:"player",ownerId:"p",buildings:[],version:0};
  f.world.territories.t3 = {ownerType:"player",ownerId:"p",buildings:[],version:0};
  f.account.gold = 100_000;
  assert.equal(SCOUTING_RULES.maxCentersPerPlayer,1);
  assert.throws(()=>f.buildings.build(f.account,f.world,"t2","scout-center", "gold"),/最多修建 1/);
  assert.equal(f.account.gold,100_000);
  assert.ok(!f.buildings.territoryView(f.account,f.world,"t2").availableTypes.includes("scout-center"));
  f.world.territories.home.ownerId = "other";
  assert.ok(f.buildings.territoryView(f.account,f.world,"t2").availableTypes.includes("scout-center"));
  f.buildings.build(f.account,f.world,"t2","scout-center", "gold");
  assert.equal(f.world.territories.t2.buildings[0].status,"active");
  assert.throws(()=>f.buildings.build(f.account,f.world,"t3","scout-center", "gold"),/最多修建 1/);
});

test("paid discovery stays with its player after territory loss", () => {
  const f = fixture(), task = f.start();
  f.world.territories.home.ownerId = "other";
  f.setTime(task.completesAt);
  const card = f.service.publicState(f.account).tasks[0].cards[0];
  assert.ok(f.service.choose(f.account, task.id, card.playerId));
  assert.throws(() => f.start("new-request"), /自己或盟友/);
});

test("campaign restart preserves task snapshots and enhanced duplicate roster instances", () => {
  const f = fixture();
  let rollIndex = 0;
  f.service.random = () => [0, 0, 0, .999][rollIndex++ % 4];
  const task = f.start(); f.setTime(task.completesAt);
  const selected = f.service.publicState(f.account).tasks[0].cards[0];
  f.service.choose(f.account, task.id, selected.playerId);
  const saved = { accounts: { p: f.account }, world: null };
  const campaign = new CampaignService({ catalog: f.catalog, repository: { load: () => structuredClone(saved), save() {} } });
  const restored = campaign.accounts.get("p").draft.roster.find((p) => p.id === selected.playerId);
  assert.equal(restored.upgradeLevel, 3);
  assert.equal(restored.cardDefinitionId, selected.cardDefinitionId);
  assert.equal(restored.attributes.finishing, 83);
  assert.equal(campaign.state(campaign.accounts.get("p")).scouting.tasks.length, 0);
  assert.ok(campaign.chooseScoutingPlayer(campaign.accounts.get("p"), task.id, selected.playerId));
});

test("enhancement roll intervals yield configured 94/4.5/1.2/0.3 distribution through complete draws", () => {
  const f = fixture();
  let index = 0;
  // Sweep equally spaced midpoints of enhancement intervals; other rolls stay non-legendary.
  f.service.random = () => {
    const call = index++;
    return call % 5 === 4 ? ((Math.floor(call / 5) % 1000) + 0.5) / 1000 : 0.5;
  };
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let trial = 0; trial < 1000; trial += 1) {
    for (const card of f.service.draw(1, "ESP")) counts[card.upgradeLevel] += 1;
  }
  assert.deepEqual(counts, { 0: 2820, 1: 135, 2: 36, 3: 9 });
});



test('upgrading the center updates existing scouts on their next task, with frozen current tasks and dynamic capacity',()=>{
 const f=fixture();const first=f.start();f.building.level=5;
 assert.equal(f.service.publicState(f.account,f.world).capacity,4);
 assert.equal(f.service.unitDetails(f.account,f.world,f.scoutId).rules.costGold,700);
 assert.equal(f.service.publicTask(f.account.scouting.tasks[first.id]).level,1);
 f.setTime(first.completesAt);const existing=f.account.scouting.tasks[first.id];f.service.choose(f.account,first.id,existing.candidates[0].id);
 const second=f.start('upgraded-scouting-task');assert.equal(second.level,5);assert.equal(f.account.scouting.units[f.scoutId].level,5);assert.equal(f.account.gold,8600);
});
