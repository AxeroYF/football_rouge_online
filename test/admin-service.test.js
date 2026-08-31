import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { AdminService } from "../server/application/admin-service.mjs";

test("AdminService bootstraps from environment password, audits tasks and adjusts gold", () => {
  const dataPath = path.join(os.tmpdir(), `ydl-admin-${Date.now()}-${Math.random()}.json`);
  const account = { id: "YF-1", gold: 100 };
  const campaign = { accounts: new Map([[account.id, account]]), adjustGold(target, delta) { target.gold += delta; return { gold: target.gold }; } };
  const admin = new AdminService({ dataPath, campaign, bootstrapPassword: "secret", now: () => 1000 });
  const session = admin.login("admin", "secret");
  const actor = admin.authenticate(session.token);
  const task = admin.createTask(actor, { type: "rebuild", idempotencyKey: "once" });
  assert.equal(admin.createTask(actor, { type: "other", idempotencyKey: "once" }).id, task.id);
  assert.equal(admin.adjustPlayerGold(actor, account.id, 50, "compensation").gold, 150);
  assert.equal(admin.listAudit().length, 2);
  fs.rmSync(dataPath, { force: true });
});
