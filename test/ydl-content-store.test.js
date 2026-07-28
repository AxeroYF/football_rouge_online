import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("YDL后台允许主副位置选择任意位置并同步迁移球员池", async () => {
  const directory = path.join(os.tmpdir(), `ydl-content-position-${process.pid}`);
  const contentPath = path.join(directory, "content.json");
  process.env.YDL_CONTENT_OVERRIDES_PATH = contentPath;
  await mkdir(directory, { recursive:true });
  await writeFile(contentPath, JSON.stringify({
    schemaVersion:1,
    players:{},
    traits:{
      "aerial-beacon":{
        name:"打点激素",
        summary:"旧说明保留",
        eligibleRoleGroups:["ATT"],
        rules:[{ hook:"attribute", add:{ pace:-20 } }],
      },
      "chameleon-role":{
        name:"变色龙2",
        eligibleRoleGroups:["ANY"],
        rules:[{ hook:"position", minimumFit:0.7 }],
      },
    },
  }), "utf8");

  const [{ createYdlTraitDraft, updateYdlPlayer, updateYdlTrait, ydlContentView }, { REAL_PLAYER_POOLS }] = await Promise.all([
    import("../versus/ydl-content-store.js"),
    import("../versus/player-pool.js"),
  ]);
  const player = REAL_PLAYER_POOLS.GK.find((candidate) => candidate.grade !== "S");
  const original = {
    role:player.role,
    secondaryRole:player.secondaryRole,
    grade:player.grade,
  };

  try {
    const updated = await updateYdlPlayer(player.id, { role:"ST", secondaryRole:"GK" });
    assert.equal(updated.role, "ST");
    assert.equal(updated.secondaryRole, "GK");
    assert.equal(updated.pool, "ATT");
    assert.ok(REAL_PLAYER_POOLS.ATT.some((candidate) => candidate.id === player.id));
    assert.ok(!REAL_PLAYER_POOLS.GK.some((candidate) => candidate.id === player.id));

    const promoted = await updateYdlPlayer(player.id, { grade:"S" });
    assert.equal(promoted.grade, "S");
    assert.equal(promoted.isLegend, true);
    assert.equal(player.legendary, true);
    assert.equal(player.legendAbility, null);
    assert.equal("legendAbility" in promoted, false);

    const wingBack = await updateYdlPlayer(player.id, { role:"LWB", secondaryRole:"RWB" });
    assert.equal(wingBack.role, "LWB");
    assert.equal(wingBack.secondaryRole, "RWB");
    assert.equal(wingBack.pool, "DEF");
    assert.equal(ydlContentView().traits.length, 15);
    const migratedTrait = ydlContentView().traits.find((trait) => trait.id === "aerial-beacon");
    assert.equal(migratedTrait.summary, "旧说明保留");
    assert.deepEqual(migratedTrait.eligibleRoleGroups, ["ATT"]);
    assert.deepEqual(migratedTrait.rules, [
      { hook:"height", addCm:20 },
      { hook:"position", familiarRoles:["ST"] },
      { hook:"attribute", add:{ heading:5, jumping:5 } },
    ]);
    assert.equal(ydlContentView().traits.some((trait) => trait.id === "chameleon-role"), false);
    const migratedFile = JSON.parse(await readFile(contentPath, "utf8"));
    assert.equal(migratedFile.schemaVersion, 2);
    assert.equal("rules" in migratedFile.traits["aerial-beacon"], false);
    assert.equal("chameleon-role" in migratedFile.traits, false);

    const draft = await createYdlTraitDraft({
      name:"测试新卡",
      summary:"比赛第80分钟后提升射门",
      eligibleRoleGroups:["ATT"],
    });
    assert.match(draft.id, /^custom-/);
    assert.equal(draft.status, "draft");
    assert.equal(draft.custom, true);
    assert.deepEqual(draft.rules, []);
    assert.equal(ydlContentView().traits.length, 16);
    await assert.rejects(() => updateYdlTrait("clean-tackle", { name:"不应进入YDL" }), /不存在/);
  } finally {
    await updateYdlPlayer(player.id, original);
    await rm(directory, { recursive:true, force:true });
  }
});
