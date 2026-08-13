import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

test("管理员API以二进制流上传卡画并返回轻量概况", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydl-admin-card-upload-"));
  process.env.YDL_PLAYER_CARD_STUDIO_PATH = path.join(root, "studio.json");
  process.env.YDL_PLAYER_PROFILE_ROOT = path.join(root, "profiles");
  const { handleAdminApi } = await import(`../versus/admin-api.js?upload=${Date.now()}`);
  const { REAL_PLAYERS } = await import("../versus/player-pool.js");
  const png = await sharp({ create:{ width:180, height:320, channels:4, background:{ r:220, g:90, b:70, alpha:0.8 } } }).png().toBuffer();

  async function call(pathname, { method = "GET", token = "", headers = {}, body = {}, buffer = Buffer.alloc(0) } = {}) {
    let sent;
    const request = { method, headers:{ ...headers, ...(token ? { authorization:`Bearer ${token}` } : {}) }, socket:{ remoteAddress:"127.0.0.33" } };
    await handleAdminApi(request, {}, pathname, async () => body, (_response, statusCode, value) => { sent = { statusCode, value }; }, async () => buffer);
    return sent;
  }

  const login = await call("/api/admin/login", { method:"POST", body:{ password:"19971019" } });
  const player = REAL_PLAYERS.find((entry) => entry.grade === "B");
  const result = await call(`/api/admin/content/player-profiles/${encodeURIComponent(player.id)}/image`, {
    method:"POST",
    token:login.value.token,
    buffer:png,
    headers:{
      "content-type":"image/png",
      "x-ydl-file-name":encodeURIComponent("测试卡画.png"),
      "x-ydl-profile-x":"47.5",
      "x-ydl-profile-y":"54",
      "x-ydl-profile-width":"192",
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.value.profile.xPercent, 47.5);
  assert.equal(result.value.profile.yPercent, 54);
  assert.equal(result.value.profile.widthPercent, 192);
  assert.ok(result.value.summary.overview.profileCount >= 1);
  assert.equal("players" in result.value.summary, false);
  const webp = await readFile(path.join(root, "profiles", "webp", result.value.profile.optimizedFileName));
  assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
});
