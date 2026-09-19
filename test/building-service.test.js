import { STARTING_GOLD } from '../shared/config/economy.mjs';
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

test("BuildingService migrates legacy territory data and creates the capital headquarters", () => {
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
  assert.equal(world.territories.home.buildings[0].type, BUILDING_TYPES.CLUB_HEADQUARTERS);
  assert.equal(world.territories.home.buildings[0].name, null);
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
  const scout = service.build(account, world, "home", BUILDING_TYPES.SCOUT_CENTER, "gold");
  assert.equal(scout.building.level, 1);
  assert.equal(scout.building.status, "active");
  assert.equal(scout.building.remainingConstructionMs, 0);
  assert.equal(account.gold, STARTING_GOLD - 5_000);
  assert.equal(account.goldLedger.at(-1).reason, "building-build:scout-center");

  now += 1;
  assert.throws(() => service.upgrade(account, world, "home", scout.building.id), /请选择金币升级或生产力升级/);
  assert.equal(account.gold, STARTING_GOLD - 5_000);
  now += 60_000;
  assert.equal(service.settleConstructions(world), false);
  assert.equal(service.territoryView(account, world, "home").buildings.find((building) => building.id === scout.building.id).status, "active");

  const stadiumId = service.build(account,world,"home",BUILDING_TYPES.MAIN_STADIUM,"gold").building.id;
  const renamed = service.rename(account, world, "home", stadiumId, "黄狗竞技场");
  assert.equal(renamed.building.name, "黄狗竞技场");
  assert.throws(() => service.rename(account, world, "home", scout.building.id, "不能改名"), /不支持自定义名称/);

  service.build(account, world, "outpost", BUILDING_TYPES.CLUB_SHOP, "gold");
  assert.throws(
    () => service.build(account, world, "outpost", BUILDING_TYPES.MEDICAL_CENTER, "gold"),
    /没有可用建筑槽位/,
  );
  assert.throws(() => service.build(account, world, "inland", BUILDING_TYPES.PORT, "gold"), /海岸线/);
  const port = service.build(account, world, "coast", BUILDING_TYPES.PORT, "gold");
  assert.equal(port.building.type, BUILDING_TYPES.PORT);
  assert.equal(account.gold, STARTING_GOLD - 20_000);
  assert.equal(saves, 5);

  const otherAccount = { id: "other", setupComplete: true };
  assert.equal(service.territoryView(otherAccount, world, "home").canManage, false);
  assert.throws(() => service.build(otherAccount, world, "home", BUILDING_TYPES.MEDICAL_CENTER, "gold"), /只能管理自己的领地设施/);
});

test("building catalog exposes all twelve parameterized facility types", () => {
  const service = new BuildingService({ economy: new EconomyService() });
  const catalog = service.catalog();
  assert.equal(catalog.length, 12);
  assert.deepEqual(new Set(catalog.map((entry) => entry.type)), new Set(Object.values(BUILDING_TYPES)));
  assert.ok(catalog.every((entry) => entry.iconPath.startsWith("/assets/facilities/icons/")));
  assert.ok(catalog.every((entry) => entry.maxLevel === (['oil-well','airport'].includes(entry.type)?1:5) && entry.costsGold.length === entry.maxLevel));
  assert.ok(catalog.filter(entry=>entry.buildable).every((entry) => entry.buildCostGold === (entry.type==='airport'?18_000:['factory','university'].includes(entry.type)?8_000:5_000)));
  assert.ok(catalog.filter(entry => entry.buildable).every((entry) => entry.buildCostProduction > 0));
  assert.ok(catalog.every((entry) => entry.upgradeEnabled === (!['oil-well','airport'].includes(entry.type))));
});


test("capital has three total slots including its stadium, all other territories have one",()=>{
  const economy=new EconomyService({now:()=>1000});
  const account={id:"player",setupComplete:true,homeTerritoryId:"home",nickname:"test",createdAt:1};
  economy.migrateAccount(account);
  const world=playerWorld();let sequence=0;
  const service=new BuildingService({economy,now:()=>1000,createBuildingId:()=>`slot-${++sequence}`});
  service.migrate({accounts:new Map([[account.id,account]]),world});
  assert.equal(service.territoryView(account,world,"home").slotLimit,3);
  assert.equal(service.territoryView(account,world,"home").availableSlots,2);
  service.build(account,world,"home",BUILDING_TYPES.SCOUT_CENTER, "gold");
  service.build(account,world,"home",BUILDING_TYPES.TRAINING_CENTER, "gold");
  const gold=account.gold;
  assert.equal(service.territoryView(account,world,"home").availableSlots,0);
  assert.deepEqual(service.territoryView(account,world,"home").availableTypes,[]);
  assert.throws(()=>service.build(account,world,"home",BUILDING_TYPES.MEDICAL_CENTER, "gold"),/没有可用建筑槽位/);
  assert.equal(account.gold,gold);
  assert.equal(world.territories.home.buildings.length,3);
  assert.equal(service.territoryView(account,world,"outpost").slotLimit,1);
});

test('non-allied building views hide exact construction and upgrade schedules',()=>{
 const world=playerWorld('owner'),owner={id:'owner'},viewer={id:'viewer'},service=new BuildingService({economy:{},now:()=>1000});world.territories.home.buildings=[{id:'private',type:'training-center',status:'constructing',level:1,constructionStartedAt:100,completesAt:2000,productionWork:{completed:123,required:456},upgradeStartedAt:234}];
 const value=service.territoryView(viewer,world,'home').buildings[0];assert.equal(value.progressHidden,true);for(const key of ['productionWork','completesAt','constructionStartedAt','remainingConstructionMs','upgradeStartedAt'])assert.equal(Object.hasOwn(value,key),false);
 world.diplomacy={relationships:{pair:{players:['owner','viewer'],state:'alliance'}}};assert.equal(service.territoryView(viewer,world,'home').buildings[0].completesAt,2000);assert.equal(service.territoryView(owner,world,'home').buildings[0].productionWork.completed,123);
});
