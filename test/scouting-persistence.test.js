import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonCampaignRepository } from "../server/infrastructure/json-campaign-repository.mjs";

test("atomic campaign saving preserves previous file on serialization or rename failure", (t) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "scout-save-"));
  const dataPath = path.join(directory, "account.json");
  const repository = new JsonCampaignRepository({ dataPath });
  try {
    repository.save({ accounts: { player: { gold: 500 } }, world: {} });
    const original = fs.readFileSync(dataPath, "utf8");
    assert.throws(() => repository.save({ accounts: { invalid: 1n }, world: {} }));
    assert.equal(fs.readFileSync(dataPath, "utf8"), original);
    t.mock.method(fs, "renameSync", () => { throw new Error("rename failed"); });
    assert.throws(() => repository.save({ accounts: { player: { gold: 0 } }, world: {} }), /rename failed/);
    assert.equal(fs.readFileSync(dataPath, "utf8"), original);
    assert.deepEqual(fs.readdirSync(directory), ["account.json"]);
    t.mock.restoreAll();
    repository.save({ accounts: { player: { gold: 0 } }, world: {} });
    assert.equal(repository.load().accounts.player.gold, 0);
  } finally { t.mock.restoreAll(); fs.rmSync(directory, { recursive: true, force: true }); }
});
