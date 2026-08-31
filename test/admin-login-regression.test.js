import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AdminService, DEFAULT_ADMIN_PASSWORD } from "../server/application/admin-service.mjs";

test("persisted bootstrap admin is synchronized to the configured default password", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ydl-admin-password-"));
  const dataPath = path.join(root, "admin-state.json");
  try {
    const old = new AdminService({ dataPath, bootstrapPassword:"old-password" });
    assert.equal(old.login("admin", "old-password").profile.role, "superadmin");
    const restarted = new AdminService({ dataPath, bootstrapPassword:DEFAULT_ADMIN_PASSWORD });
    assert.equal(restarted.login("admin", "19971019").profile.username, "admin");
    assert.throws(() => restarted.login("admin", "old-password"), /账号或密码错误/);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test("admin login page is a single card with the YellowDogs logo and default hint", () => {
  const html = fs.readFileSync(new URL("../admin-v2.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../admin-v2.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /class="login-brand"/);
  assert.match(html, /assets\/yellowdog-logo-transparent\.png/);
  assert.match(html, /默认密码 <b>19971019<\/b>/);
  assert.match(css, /Compact YellowDogs admin login/);
  assert.match(css, /\.login-shell\{min-height:100vh;padding:32px;display:grid;grid-template-columns:1fr;place-items:center/);
});
