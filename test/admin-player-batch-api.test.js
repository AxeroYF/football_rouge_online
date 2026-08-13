import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import sharp from "sharp";

test("管理员批量制卡API完成模板、预览、导入、卡画和整批上线", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydl-admin-player-batch-"));
  process.env.YDL_PLAYER_CARD_STUDIO_PATH = path.join(root, "studio.json");
  process.env.YDL_PLAYER_PROFILE_ROOT = path.join(root, "profiles");
  const { handleAdminApi } = await import(`../versus/admin-api.js?batch=${Date.now()}`);

  async function call(pathname, { method = "GET", token = "", headers = {}, body = {}, buffer = Buffer.alloc(0) } = {}) {
    let sent;
    const request = { method, headers:{ ...headers, ...(token ? { authorization:`Bearer ${token}` } : {}) }, socket:{ remoteAddress:"127.0.0.44" } };
    const response = {
      writeHead(statusCode, responseHeaders) { sent = { statusCode, headers:responseHeaders, body:null }; },
      end(responseBody) { sent.body = Buffer.from(responseBody ?? ""); },
    };
    await handleAdminApi(request, response, pathname, async () => body, (_response, statusCode, value) => { sent = { statusCode, value }; }, async () => buffer);
    return sent;
  }

  const login = await call("/api/admin/login", { method:"POST", body:{ password:"19971019" } });
  const token = login.value.token;
  const created = await call("/api/admin/content/player-batches", { method:"POST", token, body:{ name:"API测试批次", description:"完整流水线" } });
  assert.equal(created.statusCode, 201);
  const batchId = created.value.batch.id;

  const template = await call("/api/admin/content/player-import/template", { token });
  assert.equal(template.statusCode, 200);
  assert.ok(template.body.length > 5000);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template.body);
  workbook.getWorksheet("球员导入").addRow(["", "API测试球员", "API Test Player", 82, "B", "ST", "RW", "测试国", "测试队", 183, "right"]);
  const filledWorkbook = Buffer.from(await workbook.xlsx.writeBuffer());
  const preview = await call("/api/admin/content/player-import/preview", { method:"POST", token, buffer:filledWorkbook });
  assert.equal(preview.value.preview.validRows, 1);

  const imported = await call("/api/admin/content/player-import/commit", { method:"POST", token, body:{ batchId, rows:preview.value.preview.rows } });
  assert.equal(imported.statusCode, 201);
  assert.equal(imported.value.drafts.length, 1);
  assert.equal(imported.value.studio.playerBatches.find((batch) => batch.id === batchId).issueCount, 1);
  const draft = imported.value.drafts[0];

  const png = await sharp({ create:{ width:220, height:380, channels:4, background:{ r:50, g:170, b:210, alpha:0.75 } } }).png().toBuffer();
  const uploaded = await call(`/api/admin/content/player-profiles/${encodeURIComponent(draft.id)}/image`, {
    method:"POST", token, buffer:png,
    headers:{ "content-type":"image/png", "x-ydl-file-name":"Example_Player.png", "x-ydl-profile-x":"50", "x-ydl-profile-y":"52", "x-ydl-profile-width":"200" },
  });
  assert.equal(uploaded.statusCode, 200);
  const published = await call(`/api/admin/content/player-batches/${encodeURIComponent(batchId)}/publish`, { method:"POST", token, body:{} });
  assert.equal(published.statusCode, 200);
  assert.equal(published.value.batch.status, "published");
  assert.equal(published.value.players.length, 1);
  assert.equal(published.value.studio.playerBatches.find((batch) => batch.id === batchId).publishedCount, 1);
});
