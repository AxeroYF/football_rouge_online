import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAdminData, normalizeCatalog, normalizeRegistry } from "../scripts/normalize-ydl-player-library.mjs";

test("normalizes historical player and card-art sources to YDL without changing ids", () => {
  const catalog = normalizeCatalog([{ id:"s4-old-id", name:"球员", batchId:"DLC4" }, { id:"ydl-custom-id", name:"新球员" }]);
  assert.deepEqual(catalog.map((player) => player.id), ["s4-old-id", "ydl-custom-id"]);
  assert.deepEqual(catalog.map((player) => player.librarySource), ["YDL", "YDL"]);
  assert.equal(catalog.some((player) => Object.hasOwn(player, "batchId")), false);
  const registry = normalizeRegistry({ schemaVersion:1, profiles:{ a:{ sourceGroup:"legendary" }, b:{ sourceGroup:"s4-studio" } } });
  assert.deepEqual(Object.values(registry.profiles).map((profile) => profile.sourceGroup), ["YDL", "YDL"]);
});

test("removes completed historical batches but preserves batches used by current drafts", () => {
  const admin = normalizeAdminData({
    batches:{ old:{ id:"old", status:"published" }, current:{ id:"current", status:"staging" } },
    drafts:{ p1:{ id:"p1", batchId:"current" } }, recovery:{ source:"S4" },
  }, "2026-08-30T00:00:00.000Z");
  assert.deepEqual(Object.keys(admin.batches), ["current"]);
  assert.equal(admin.librarySource, "YDL");
  assert.equal(Object.hasOwn(admin, "recovery"), false);
});
