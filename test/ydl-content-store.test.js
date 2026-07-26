import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("YDL后台允许主副位置选择任意位置并同步迁移球员池", async () => {
  const directory = path.join(os.tmpdir(), `ydl-content-position-${process.pid}`);
  const contentPath = path.join(directory, "content.json");
  process.env.YDL_CONTENT_OVERRIDES_PATH = contentPath;

  const [{ updateYdlPlayer, updateYdlTrait, ydlContentView }, { REAL_PLAYER_POOLS }] = await Promise.all([
    import("../versus/ydl-content-store.js"),
    import("../versus/player-pool.js"),
  ]);
  const player = REAL_PLAYER_POOLS.GK[0];
  const original = {
    role:player.role,
    secondaryRole:player.secondaryRole,
  };

  try {
    const updated = await updateYdlPlayer(player.id, { role:"ST", secondaryRole:"GK" });
    assert.equal(updated.role, "ST");
    assert.equal(updated.secondaryRole, "GK");
    assert.equal(updated.pool, "ATT");
    assert.ok(REAL_PLAYER_POOLS.ATT.some((candidate) => candidate.id === player.id));
    assert.ok(!REAL_PLAYER_POOLS.GK.some((candidate) => candidate.id === player.id));

    const wingBack = await updateYdlPlayer(player.id, { role:"LWB", secondaryRole:"RWB" });
    assert.equal(wingBack.role, "LWB");
    assert.equal(wingBack.secondaryRole, "RWB");
    assert.equal(wingBack.pool, "DEF");
    assert.equal(ydlContentView().traits.length, 14);
    await assert.rejects(() => updateYdlTrait("clean-tackle", { name:"不应进入YDL" }), /不存在/);
  } finally {
    await updateYdlPlayer(player.id, original);
    await rm(directory, { recursive:true, force:true });
  }
});
