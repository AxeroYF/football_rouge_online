import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE,
  PLAYER_PACK_DEFINITIONS,
  PLAYER_PACK_GRADE_WEIGHTS,
  PLAYER_PACK_TYPES,
  neutralConquestRewardForDifficulty,
} from "../shared/config/player-packs.mjs";
import {
  PLAYER_INVENTORY_SCHEMA_VERSION,
  PlayerPackService,
} from "../server/application/player-pack-service.mjs";

function player(id, grade, overall) {
  return {
    id,
    name:`球员${id}`,
    role:"ST",
    pool:"ATT",
    grade,
    overall,
    club:"测试队",
    nationality:"中国",
    attributes:{},
    state:{ fitness:100 },
  };
}

const catalog = [
  ...["s1","s2","s3","s4"].map((id) => player(id,"S",92)),
  ...["a1","a2","a3","a4"].map((id) => player(id,"A",86)),
  ...["b1","b2","b3","b4"].map((id) => player(id,"B",81)),
  ...["c1","c2","c3","c4"].map((id) => player(id,"C",76)),
];

test("four player pack tiers expose their fixed names and grade odds", () => {
  assert.deepEqual(
    Object.values(PLAYER_PACK_DEFINITIONS).map(({ type,name }) => [type,name]),
    [
      [PLAYER_PACK_TYPES.LEGENDARY,"传奇球员卡包"],
      [PLAYER_PACK_TYPES.EXOTIC,"珍奇球员卡包"],
      [PLAYER_PACK_TYPES.RARE,"稀有球员卡包"],
      [PLAYER_PACK_TYPES.COMMON,"普通球员卡包"],
    ],
  );
  assert.deepEqual(PLAYER_PACK_GRADE_WEIGHTS[PLAYER_PACK_TYPES.LEGENDARY],{ S:35,A:50,B:12,C:3 });
  assert.deepEqual(PLAYER_PACK_GRADE_WEIGHTS[PLAYER_PACK_TYPES.EXOTIC],{ S:10,A:75,B:13,C:2 });
  assert.deepEqual(PLAYER_PACK_GRADE_WEIGHTS[PLAYER_PACK_TYPES.RARE],{ S:2,A:8,B:75,C:15 });
  assert.deepEqual(PLAYER_PACK_GRADE_WEIGHTS[PLAYER_PACK_TYPES.COMMON],{ S:0.2,A:1.8,B:23,C:75 });
});

test("new territory conquest rewards only grant exotic packs from one to five stars", () => {
  assert.deepEqual(
    [1,2,3,4,5].map((difficulty) => neutralConquestRewardForDifficulty(difficulty)),
    [
      { difficulty:1, gold:2_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:1 },
      { difficulty:2, gold:4_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:2 },
      { difficulty:3, gold:6_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:3 },
      { difficulty:4, gold:8_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:4 },
      { difficulty:5, gold:10_000, packType:PLAYER_PACK_TYPES.EXOTIC, packCount:5 },
    ],
  );
});

test("legacy conquest packs migrate one for one to exotic packs without duplicating", () => {
  const service = new PlayerPackService({ playerDatabase:catalog });
  const account = {
    inventory:{
      schemaVersion:1,
      packs:{
        [LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE]:3,
        [PLAYER_PACK_TYPES.COMMON]:2,
      },
      pendingOpening:{
        id:"legacy-opening",
        packType:LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE,
        candidateIds:["a1","a2","a3"],
        openedAt:123,
      },
    },
  };

  assert.equal(service.migrateAccount(account),true);
  assert.equal(account.inventory.schemaVersion,PLAYER_INVENTORY_SCHEMA_VERSION);
  assert.equal(account.inventory.packs[PLAYER_PACK_TYPES.EXOTIC],3);
  assert.equal(account.inventory.packs[PLAYER_PACK_TYPES.COMMON],2);
  assert.equal(account.inventory.packs[LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE],undefined);
  assert.equal(account.inventory.pendingOpening.packType,PLAYER_PACK_TYPES.EXOTIC);
  assert.equal(service.migrateAccount(account),false);
  assert.equal(account.inventory.packs[PLAYER_PACK_TYPES.EXOTIC],3);
});

test("player pack inventory persists one opening and adds exactly one chosen player", () => {
  let openingSequence = 0;
  const service = new PlayerPackService({
    playerDatabase:catalog,
    random:() => 0.5,
    now:() => 1234,
    createOpeningId:() => `opening-${++openingSequence}`,
  });
  const account = {
    setupComplete:true,
    draft:{ teamName:"测试队", roster:[structuredClone(catalog[0])], offer:[] },
  };

  assert.equal(service.migrateAccount(account),true);
  assert.equal(account.inventory.schemaVersion,PLAYER_INVENTORY_SCHEMA_VERSION);
  assert.equal(service.publicInventory(account).totalPacks,0);
  service.addPacks(account,PLAYER_PACK_TYPES.EXOTIC,2);

  const opening = service.open(account,PLAYER_PACK_TYPES.EXOTIC);
  assert.equal(opening.id,"opening-1");
  assert.equal(opening.cards.length,3);
  assert.equal(new Set(opening.cards.map((card) => card.playerId)).size,3);
  assert.ok(opening.cards.every((card) => card.grade === "A"));
  assert.ok(opening.cards.every((card) => card.playerId !== "s1"));
  assert.equal(service.publicInventory(account).totalPacks,1);

  const resumed = service.open(account,PLAYER_PACK_TYPES.EXOTIC);
  assert.equal(resumed.id,opening.id);
  assert.equal(service.publicInventory(account).totalPacks,1);

  const selected = service.choose(account,opening.id,opening.cards[0].playerId);
  assert.equal(selected.playerId,opening.cards[0].playerId);
  assert.equal(account.draft.roster.length,2);
  assert.equal(service.publicInventory(account).pendingOpening,null);
  assert.equal(service.publicInventory(account).totalPacks,1);
  assert.throws(() => service.choose(account,opening.id,opening.cards[1].playerId),/待选择的卡包不存在/);
});
