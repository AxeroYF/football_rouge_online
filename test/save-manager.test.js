import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySaveStore,
  normalizeSaveStore,
  removeRunSave,
  upsertRunSave,
} from "../game/public/save-manager.js";

function run(saveId, name) {
  return { version: 9, saveId, name, stage: 1, players: [], createdAt: "2026-07-16T00:00:00.000Z" };
}

test("新征程会创建独立存档槽而不是覆盖旧档", () => {
  const first = upsertRunSave(emptySaveStore(), run("save-a", "甲队"), "2026-07-16T01:00:00.000Z");
  const second = upsertRunSave(first, run("save-b", "乙队"), "2026-07-16T02:00:00.000Z");
  assert.equal(second.saves.length, 2);
  assert.equal(second.activeSaveId, "save-b");
  assert.deepEqual(second.saves.map((entry) => entry.run.name), ["乙队", "甲队"]);
});

test("保存同一征程只更新对应槽位", () => {
  let store = upsertRunSave(emptySaveStore(), run("save-a", "甲队"), "2026-07-16T01:00:00.000Z");
  store = upsertRunSave(store, { ...run("save-a", "甲队"), stage: 8 }, "2026-07-16T03:00:00.000Z");
  assert.equal(store.saves.length, 1);
  assert.equal(store.saves[0].run.stage, 8);
});

test("删除当前存档后会安全切换到最近的剩余存档", () => {
  const store = normalizeSaveStore({
    activeSaveId: "save-b",
    saves: [
      { id: "save-b", updatedAt: "2026-07-16T02:00:00.000Z", run: run("save-b", "乙队") },
      { id: "save-a", updatedAt: "2026-07-16T01:00:00.000Z", run: run("save-a", "甲队") },
    ],
  });
  const remaining = removeRunSave(store, "save-b");
  assert.equal(remaining.saves.length, 1);
  assert.equal(remaining.activeSaveId, "save-a");
});
