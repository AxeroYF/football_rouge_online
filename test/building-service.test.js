import assert from "node:assert/strict";
import test from "node:test";
import { BuildingService } from "../server/application/building-service.mjs";
import { EconomyService } from "../server/application/economy-service.mjs";
import {
  BUILDING_RULES,
  BUILDING_TYPES,
} from "../shared/config/buildings.mjs";

function playerWorld(accountId = "player") {
  const territory = (territoryId, capitalOf = null) => ({
    territoryId,
    ownerType: "player",
    ownerId: accountId,
    capitalOf,
    buildings: [],
    version: 0,
  });
  return {
    schemaVersion: 4,
    revision: 0,
    territories: {
      home: territory("home", accountId),
      outpost: territory("outpost"),
      coast: territory("coast"),
      inland: territory("inland"),
    },
    players: {
      [accountId]: {
        playerId: accountId,
        capitalTerritoryId: "home",
        territoryIds: ["home", "outpost", "coast", "inland"],
      },
    },
  };
}

test("BuildingService migrates legacy territory data and creates the capital stadium", () => {
  let sequence = 0;
  const economy = new EconomyService({ now: () => 1_000 });
  const account = {
    id: "player",
    nickname: "测试经理",
    setupComplete: true,
    homeTerritoryId: "home",
    createdAt: 500,
    draft: { teamName: "黄狗队" },
  };
  economy.migrateAccount(account);
  const world = playerWorld(account.id);
  delete world.territories.home.buildings;
  world.territories.outpost.scoutingCenter = { level: 2, builtAt: 600 };
  const service = new BuildingService({
    economy,
    now: () => 1_000,
    createBuildingId: () => `building-${++sequence}`,
  });

  assert.equal(service.migrate({ accounts: new Map([[account.id, account]]), world }), true);
  assert.equal(world.schemaVersion, 4);
  assert.equal(world.territories.home.buildings[0].type, BUILDING_TYPES.MAIN_STADIUM);
  assert.equal(world.territories.home.buildings[0].name, "黄狗队主体育场");
  assert.equal(world.territories.outpost.buildings[0].type, BUILDING_TYPES.SCOUT_CENTER);
  assert.equal(world.territories.outpost.buildings[0].level, 2);
  assert.equal(Object.hasOwn(world.territories.outpost, "scoutingCenter"), false);
});

test("BuildingService enforces slots, ownership, coastlines, construction and stadium naming", () => {
  let now = 10_000;
  let sequence = 0;
  let saves = 0;
  const economy = new EconomyService({ now: () => now });
  const account = {
    id: "player",
    nickname: "测试经理",
    setupComplete: true,
    homeTerritoryId: "home",
    createdAt: 100,
    draft: { teamName: "黄狗队" },
  };
  economy.migrateAccount(account);
  const world = playerWorld(account.id);
  const service = new BuildingService({
    economy,
    now: () => now,
    createBuildingId: () => `building-${++sequence}`,
    isCoastal: (territoryId) => territoryId === "coast",
    save: () => { saves += 1; },
  });
  service.migrate({ accounts: new Map([[account.id, account]]), world });

  const homeBefore = service.territoryView(account, world, "home");
  assert.equal(homeBefore.slotLimit, BUILDING_RULES.capitalSlotLimit);
  assert.equal(homeBefore.occupiedSlots, 1);
  assert.ok(homeBefore.availableTypes.includes(BUILDING_TYPES.SCOUT_CENTER));
  assert.ok(!homeBefore.availableTypes.includes(BUILDING_TYPES.PORT));

  now += 1;
  const scout = service.build(account, world, "home", BUILDING_TYPES.SCOUT_CENTER);
  assert.equal(scout.building.level, 1);
  assert.equal(scout.building.status, "constructing");
  assert.equal(scout.building.remainingConstructionMs, 60_000);
  assert.equal(account.gold, 995_000);
  assert.equal(account.goldLedger.at(-1).reason, "building-build:scout-center");

  now += 1;
  assert.throws(() => service.upgrade(account, world, "home", scout.building.id), /暂未开放/);
  assert.equal(account.gold, 995_000);
  now += 60_000;
  assert.equal(service.settleConstructions(world), true);
  assert.equal(service.territoryView(account, world, "home").buildings.find((building) => building.id === scout.building.id).status, "active");

  const stadiumId = world.territories.home.buildings.find((building) => building.type === BUILDING_TYPES.MAIN_STADIUM).id;
  const renamed = service.rename(account, world, "home", stadiumId, "黄狗竞技场");
  assert.equal(renamed.building.name, "黄狗竞技场");
  assert.throws(() => service.rename(account, world, "home", scout.building.id, "不能改名"), /不支持自定义名称/);

  service.build(account, world, "outpost", BUILDING_TYPES.CLUB_SHOP);
  assert.throws(
    () => service.build(account, world, "outpost", BUILDING_TYPES.MEDICAL_CENTER),
    /没有可用建筑槽位/,
  );
  assert.throws(() => service.build(account, world, "inland", BUILDING_TYPES.PORT), /海岸线/);
  const port = service.build(account, world, "coast", BUILDING_TYPES.PORT);
  assert.equal(port.building.type, BUILDING_TYPES.PORT);
  assert.equal(account.gold, 985_000);
  assert.equal(saves, 5);

  const otherAccount = { id: "other", setupComplete: true };
  assert.equal(service.territoryView(otherAccount, world, "home").canManage, false);
  assert.throws(() => service.build(otherAccount, world, "home", BUILDING_TYPES.MEDICAL_CENTER), /只能管理自己的领地设施/);
});

test("building catalog exposes all seven parameterized facility types", () => {
  const service = new BuildingService({ economy: new EconomyService() });
  const catalog = service.catalog();
  assert.equal(catalog.length, 7);
  assert.deepEqual(new Set(catalog.map((entry) => entry.type)), new Set(Object.values(BUILDING_TYPES)));
  assert.ok(catalog.every((entry) => entry.iconPath.startsWith("/assets/building-icons-v2/")));
  assert.ok(catalog.every((entry) => entry.maxLevel === 5 && entry.costsGold.length === 5));
  assert.ok(catalog.every((entry) => entry.buildCostGold === 5_000));
  assert.ok(catalog.every((entry) => entry.constructionDurationMs === 60_000));
  assert.ok(catalog.every((entry) => entry.upgradeEnabled === false));
});
