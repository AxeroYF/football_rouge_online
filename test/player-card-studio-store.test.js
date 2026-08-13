import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

test("球员卡工作台支持全等级WebP、26项回归、暂存和批量上线", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydl-player-card-studio-"));
  process.env.YDL_PLAYER_CARD_STUDIO_PATH = path.join(root, "studio.json");
  process.env.YDL_PLAYER_PROFILE_ROOT = path.join(root, "profiles");
  const studio = await import(`../versus/player-card-studio-store.js?test=${Date.now()}`);
  const { ATTRIBUTE_NAMES, playerOverallFromAttributes } = await import("../game/public/schema.js");
  const { REAL_PLAYER_BY_ID, REAL_PLAYERS } = await import("../versus/player-pool.js");

  const regression = studio.regressPlayerAttributes("AM", 84);
  assert.equal(Object.keys(regression.attributes).length, 26);
  assert.deepEqual(Object.keys(regression.attributes), [...ATTRIBUTE_NAMES]);
  assert.equal(playerOverallFromAttributes(regression.attributes, "AM"), 84);
  assert.ok(Object.values(regression.attributes).every((value) => value >= 1 && value <= 96));

  const png = await sharp({
    create:{ width:480, height:720, channels:4, background:{ r:40, g:180, b:120, alpha:0.72 } },
  }).png().toBuffer();
  const imageDataUrl = `data:image/png;base64,${png.toString("base64")}`;
  for (const grade of ["X", "S", "A", "B", "C"]) {
    const owner = REAL_PLAYERS.find((player) => player.grade === grade);
    assert.ok(owner, `缺少${grade}级测试球员`);
    const profile = await studio.savePlayerCardProfile(owner.id, {
      ...(grade === "X" ? { imageBuffer:png, mimeType:"image/png" } : { imageDataUrl }),
      sourceFileName:`${grade}.png`,
      xPercent:48.5,
      yPercent:55.5,
      widthPercent:188,
    });
    assert.equal(profile.grade, grade);
    assert.match(profile.imageUrl, /^\/versus\/player_profiles\/webp\/[a-f0-9]{24}\.webp\?v=[a-f0-9]{12}$/);
    const file = path.join(root, "profiles", "webp", profile.optimizedFileName);
    assert.ok((await stat(file)).size < png.length);
    const header = await readFile(file);
    assert.equal(header.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(header.subarray(8, 12).toString("ascii"), "WEBP");
    assert.equal(REAL_PLAYER_BY_ID[owner.id].cardProfile.imageUrl, profile.imageUrl);
  }

  const batch = await studio.createPlayerCardBatch({ name:"自动测试发布批次", description:"测试批量制卡" });
  const [draft] = await studio.createPlayerCardDrafts([{
    name:"后台测试球员",
    sourceName:"Admin Test Player",
    overall:82,
    grade:"B",
    role:"ST",
    nationality:"测试国籍",
    club:"测试俱乐部",
    heightCm:183,
    preferredFoot:"left",
    attributeMode:"regress",
  }], batch.id);
  assert.equal(draft.status, "draft");
  assert.equal(Object.keys(draft.attributes).length, 26);
  assert.equal(playerOverallFromAttributes(draft.attributes, "ST"), 82);
  assert.equal(draft.batchId, batch.id);
  await studio.savePlayerCardProfile(draft.id, { imageDataUrl, sourceFileName:"draft.png" });
  const published = await studio.publishPlayerCardBatch(batch.id);
  assert.equal(published.players.length, 1);
  assert.equal(published.batch.status, "published");
  assert.equal(REAL_PLAYER_BY_ID[draft.id].customPlayer, true);
  assert.equal(studio.playerCardStudioView().drafts.some((entry) => entry.id === draft.id), false);
  assert.ok(studio.playerCardStudioView().published.some((entry) => entry.id === draft.id));
  assert.equal(studio.playerCardStudioView().batches.find((entry) => entry.id === batch.id).publishedCount, 1);
});
