import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../admin-v2.html",import.meta.url),"utf8");
const source = await readFile(new URL("../admin-v2.js",import.meta.url),"utf8");
const styles = await readFile(new URL("../admin-v2.css",import.meta.url),"utf8");

test("Admin login binds before optional player-card studio code and shows progress", () => {
  assert.match(html,/id="login-submit"[^>]*type="submit"/);
  assert.match(html,/admin-v2\.js\?v=20260901-pack-grants-v2/);
  assert.doesNotMatch(source,/^import\s+\{\s*playerCardMarkup/m);
  const binding = source.indexOf('$("#login-form").addEventListener("submit",login)');
  const optionalStudioImport = source.indexOf('import("./client/player-card/player-card.js")');
  assert.ok(binding >= 0 && optionalStudioImport > binding);
  assert.match(source,/button\.textContent = "正在登录…"/);
  assert.match(source,/正在验证管理员身份/);
  assert.match(source,/工作台数据加载失败/);
});

test("Admin login view is removed from layout after authentication", () => {
  assert.match(html,/admin-v2\.css\?v=20260901-pack-grants-v2/);
  assert.match(html,/id="admin-view" hidden/);
  assert.match(source,/\$\("#login-view"\)\.hidden = true/);
  assert.match(source,/\$\("#admin-view"\)\.hidden = false/);
  assert.match(styles,/\[hidden\]\{display:none!important\}/);
});

test("Admin exposes a searchable audited player-pack grant workspace", () => {
  assert.match(html,/data-page="packs"[^>]*>[\s\S]*?卡包发放/);
  assert.match(source,/api\("\/api\/admin\/player-packs"/);
  assert.match(source,/function renderPlayerPackManagement/);
  assert.match(source,/function grantPlayerPacks/);
  assert.match(source,/window\.confirm/);
  assert.match(source,/后台运营发放/);
  assert.match(source,/id="pack-account-all"/);
  assert.match(source,/name="scope" value="\$\{allPlayers\?"all":"player"\}"/);
  assert.match(source,/确认向所有 \$\{recipientCount\} 名玩家/);
  assert.match(source,/recipientCount\*data\.count/);
  assert.match(styles,/\.pack-admin-layout/);
  assert.match(styles,/\.pack-all-target/);
});
