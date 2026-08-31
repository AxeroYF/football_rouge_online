import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeService } from "../server/application/challenge-service.mjs";
import { EconomyService } from "../server/application/economy-service.mjs";
import { migrateCampaignSave } from "../server/infrastructure/campaign-save-migrations.mjs";
import {
  challengeSchedulerTimings,
  createChallengeScheduler,
} from "../server/scheduler/challenge-scheduler.mjs";

test("EconomyService owns account migration, spending and ledger limits", () => {
  let now = 10;
  let sequence = 0;
  const economy = new EconomyService({
    now: () => now,
    startingGold: 100,
    ledgerLimit: 2,
    createEntryId: () => `entry-${++sequence}`,
  });
  const account = {};

  assert.equal(economy.migrateAccount(account), true);
  assert.equal(account.gold, 100);
  assert.deepEqual(account.goldLedger.map((entry) => entry.id), ["entry-1"]);
  now += 1;
  assert.deepEqual(economy.adjust(account, 25, "reward"), { gold: 125 });
  now += 1;
  assert.deepEqual(economy.spend(account, 20, "wages"), { gold: 105 });
  assert.deepEqual(account.goldLedger.map((entry) => entry.id), ["entry-2", "entry-3"]);
  assert.throws(() => economy.spend(account, 106, "too-much"), /金币不足/);
});

test("campaign save migrations report applied steps and hydrate account data", () => {
  const economy = new EconomyService({
    now: () => 100,
    createEntryId: () => "migration-entry",
  });
  const playerDatabase = [{
    id: "player-1",
    pool: "GK",
    grade: "A",
    overall: 88,
    state: { fitness: 100 },
    effectiveAttributes: { passing: 80 },
    effectiveOverall: 88,
    effectiveHeightCm: 190,
  }];
  const saved = {
    accounts: {
      account: {
        id: "account",
        draft: {
          roster: [{ id: "player-1", overall: 60, state: { fitness: 70 } }],
          offer: [],
        },
      },
    },
  };

  const result = migrateCampaignSave({
    saved,
    territoryIndex: null,
    playerDatabase,
    playerCatalogVersion: "catalog-v2",
    economy,
  });
  const account = result.accounts.get("account");
  assert.deepEqual(result.appliedMigrations, [
    "account-defaults",
    "account-economy",
    "player-catalog",
  ]);
  assert.equal(account.homeTerritoryId, null);
  assert.ok(account.mapColor);
  assert.equal(account.gold, economy.startingGold);
  assert.equal(account.playerCatalogVersion, "catalog-v2");
  assert.equal(account.draft.roster[0].overall, 88);
  assert.equal(account.draft.roster[0].state.fitness, 70);
});

test("ChallengeScheduler advances cheaply and persists only dirty progress", () => {
  let advances = 0;
  let saves = 0;
  const campaign = {
    advanceActiveChallenges(now, limits) {
      advances += 1;
      assert.equal(now, 500);
      assert.deepEqual(limits, { maximumMatches: 1, maximumChainsPerMatch: 1 });
      return advances === 1;
    },
    save() {
      saves += 1;
    },
  };
  const scheduler = createChallengeScheduler({ campaign, now: () => 500, autoStart: false });

  assert.equal(scheduler.advance(), true);
  assert.equal(scheduler.persist(), true);
  assert.equal(saves, 1);
  assert.equal(scheduler.persist(), false);
  assert.equal(saves, 1);
  assert.equal(scheduler.advance(), false);
});

test("ChallengeScheduler clamps runtime timing overrides", () => {
  assert.deepEqual(challengeSchedulerTimings({
    CAMPAIGN_LIVE_SLICE_MS: "1",
    CAMPAIGN_LIVE_PERSIST_MS: "999999",
  }), {
    sliceIntervalMs: 100,
    persistIntervalMs: 30000,
  });
});

test("ChallengeService independently settles due legacy battles", () => {
  let saves = 0;
  const account = { id: "player", battleHistory: [] };
  const challenge = {
    id: "challenge-1",
    territoryId: "target",
    attackerId: "player",
    previousOwner: { type: "neutral", id: null },
    fromTerritoryIds: ["home"],
    battle: { id: "battle-1", outcome: "loss", events: [{ type: "fulltime" }] },
    settleAt: 100,
  };
  const world = {
    revision: 0,
    territories: {
      target: { territoryId: "target", ownerType: "neutral", ownerId: null },
    },
    activeChallenges: { target: challenge },
  };
  const service = new ChallengeService({
    world,
    accounts: new Map([[account.id, account]]),
    territoryIndex: { territories: [] },
    now: () => 100,
    save: () => { saves += 1; },
  });

  const settled = service.settleDueChallenges();
  assert.equal(settled.length, 1);
  assert.equal(settled[0].captured, false);
  assert.equal(world.activeChallenges.target, undefined);
  assert.equal(world.revision, 1);
  assert.equal(account.battleHistory[0].challengeId, undefined);
  assert.equal(account.battleHistory[0].events[0].type, "fulltime");
  assert.equal(saves, 1);
});

test("ChallengeService filters occupied maritime targets", () => {
  const world = {
    territories: {},
    activeChallenges: { occupied: { id: "active" } },
  };
  const maritimePlanner = {
    routesFrom: () => ({
      sourceTerritoryId: "source",
      sourcePoint: [0, 0],
      routes: [
        { targetTerritoryId: "open" },
        { targetTerritoryId: "occupied" },
      ],
    }),
  };
  const service = new ChallengeService({
    world,
    accounts: new Map(),
    territoryIndex: { territories: [] },
    maritimePlanner,
  });

  const result = service.maritimeRoutes({ id: "player" }, "source", [0, 0]);
  assert.deepEqual(result.routes.map((route) => route.targetTerritoryId), ["open"]);
});
