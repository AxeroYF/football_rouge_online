import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { AdminService } from "../server/application/admin-service.mjs";

test("AdminService bootstraps from environment password, audits tasks and adjusts gold", () => {
  const dataPath = path.join(os.tmpdir(), `ydl-admin-${Date.now()}-${Math.random()}.json`);
  const account = { id: "YF-1", nickname:"测试玩家", gold: 100, packs:0 };
  const campaign = {
    accounts: new Map([[account.id, account]]),
    adjustGold(target, delta) { target.gold += delta; return { gold: target.gold }; },
    adminPlayerPackManagement() { return { players:[{ id:account.id,nickname:account.nickname,totalPacks:account.packs }],packTypes:[
      { type:"legendary-player-pack",name:"传奇球员卡包" },
      { type:"exotic-player-pack",name:"珍奇球员卡包" },
      { type:"rare-player-pack",name:"稀有球员卡包" },
      { type:"common-player-pack",name:"普通球员卡包" },
    ],maxGrantCount:999 }; },
    grantPlayerPacksToAccount(accountId, packType, count) { assert.equal(accountId,account.id);account.packs+=count;return { player:{ id:account.id,nickname:account.nickname,packs:[{ type:packType,count:account.packs }] },grant:{ type:packType,name:"珍奇球员卡包",count } }; },
    grantPlayerPacksToAllAccounts(packType,count) { account.packs+=count;return { grant:{ type:packType,name:"普通球员卡包",count },recipientCount:1,totalPacksGranted:count }; },
  };
  const admin = new AdminService({ dataPath, campaign, bootstrapPassword: "secret", now: () => 1000 });
  const session = admin.login("admin", "secret");
  const actor = admin.authenticate(session.token);
  const task = admin.createTask(actor, { type: "rebuild", idempotencyKey: "once" });
  assert.equal(admin.createTask(actor, { type: "other", idempotencyKey: "once" }).id, task.id);
  assert.equal(admin.adjustPlayerGold(actor, account.id, 50, "compensation").gold, 150);
  const management=admin.playerPackManagement(actor);
  assert.equal(management.players[0].id,account.id);
  assert.equal(management.packTypes.length,4);
  const granted=admin.grantPlayerPacks(actor,{ accountId:account.id,packType:"exotic-player-pack",count:3,reason:"活动补偿" });
  assert.equal(granted.player.packs[0].count,3);
  assert.equal(admin.listAudit().length, 3);
  assert.equal(admin.listAudit()[0].action,"player.pack.grant");
  const batch=admin.grantPlayerPacks(actor,{ scope:"all",packType:"common-player-pack",count:2,reason:"全服补偿" });
  assert.equal(batch.recipientCount,1);
  assert.equal(batch.totalPacksGranted,2);
  assert.equal(admin.listAudit().length,4);
  assert.equal(admin.listAudit()[0].action,"player.pack.grant-all");
  assert.throws(()=>admin.grantPlayerPacks(actor,{ accountId:account.id,packType:"legendary-player-pack",count:1000 }),/1 至 999/);
  fs.rmSync(dataPath, { force: true });
});
