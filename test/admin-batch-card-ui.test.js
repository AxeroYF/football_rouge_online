import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("管理员后台提供Excel、PNG匹配和发布批次完整入口", () => {
  const source = readFileSync(new URL("../admin/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../admin/public/league.css", import.meta.url), "utf8");
  assert.match(source, /data-content-tab="batch"/);
  assert.match(source, /批量制卡中心/);
  assert.match(source, /player-import\/template/);
  assert.match(source, /player-import\/preview/);
  assert.match(source, /player-import\/commit/);
  assert.match(source, /function matchBatchImages\(files\)/);
  assert.match(source, /Math\.min\(3, pending\.length\)/);
  assert.match(source, /player-batches\/\$\{encodeURIComponent\(batch\.id\)\}\/publish/);
  assert.match(styles, /\.batch-flow/);
  assert.match(styles, /\.batch-image-results/);
  assert.match(styles, /\.batch-draft-table/);
});
