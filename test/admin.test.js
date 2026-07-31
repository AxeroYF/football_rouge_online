import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleAdminApi } from "../versus/admin-api.js";

async function request(pathname, { method = "GET", token = "", body = {}, address = "127.0.0.1" } = {}) {
  let sent;
  const requestValue = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: address } };
  await handleAdminApi(requestValue, {}, pathname, async () => body, (_response, statusCode, value) => { sent = { statusCode, value }; });
  return sent;
}

test("联赛旧数据冲突时后台提供开启全新赛季的恢复入口", () => {
  const source = readFileSync(new URL("../admin/public/app.js", import.meta.url), "utf8");
  assert.match(source, /function renderLeagueRecovery\(error\)/);
  assert.match(source, /开启全新黄狗联赛赛季/);
  assert.match(source, /\/api\/admin\/league\/fresh-season/);
  assert.match(source, /else renderLeagueRecovery\(error\)/);
  assert.match(source, /league-x-growth-grant-form/);
  assert.match(source, /\/api\/admin\/league\/x-growth\/grant/);
  assert.match(source, /discipline-coins/);
  assert.match(source, /\/coins\/remove/);
  assert.match(source, /\/login-cooldown/);
  assert.match(source, /\/rewards\/suspension/);
  assert.match(source, /发送全服邮件通告/);
});

test("管理员后台拒绝错误密码和未授权数据访问", async () => {
  const unauthorized = await request("/api/admin/dashboard");
  assert.equal(unauthorized.statusCode, 401);
  const wrong = await request("/api/admin/login", { method:"POST", body:{ password:"wrong" } });
  assert.equal(wrong.statusCode, 401);
});

test("管理员登录后可以读取去敏玩家列表和竞技统计", async () => {
  const login = await request("/api/admin/login", { method:"POST", body:{ password:"19971019" }, address:"127.0.0.2" });
  assert.equal(login.statusCode, 200);
  assert.match(login.value.token, /^[A-Za-z0-9_-]+$/);
  const dashboard = await request("/api/admin/dashboard", { token:login.value.token });
  assert.equal(dashboard.statusCode, 200);
  assert.ok(Array.isArray(dashboard.value.dashboard.players));
  assert.ok(Array.isArray(dashboard.value.dashboard.formations));
  assert.ok(dashboard.value.dashboard.players.every((player) => !("token" in player)));
  const league = await request("/api/admin/league", { token:login.value.token });
  assert.equal(league.statusCode, 200);
  assert.equal(league.value.league.teams.length, 10);
  assert.ok(league.value.league.pools.ATT.total > 0);
  assert.equal(league.value.league.s4Assets.schemaVersion, 1);
  assert.equal(league.value.league.s4PlayerCatalog.length, 602);
  assert.ok(league.value.league.s4PlayerCatalog.some((player) => player.name === "梅西"));
  assert.ok(league.value.league.s4PlayerCatalog.some((player) => player.name === "梅老鼠"));
  assert.ok(Array.isArray(league.value.league.s4CardGrants));
  assert.ok(Array.isArray(league.value.league.coinGrants));
  const content = await request("/api/admin/content", { token:login.value.token });
  assert.equal(content.statusCode, 200);
  assert.equal(content.value.content.players.length, 602);
  assert.ok(content.value.content.traits.length > 0);
  assert.deepEqual(content.value.content.roleGroups, ["ANY", "GK", "DEF", "MID", "ATT"]);
  assert.deepEqual(content.value.content.playerRoles, ["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
  assert.ok(content.value.content.traits.every((trait) => !("rarity" in trait)));
  assert.ok(content.value.content.traits.filter((trait) => trait.status === "active").every((trait) => trait.rules.length > 0));
  assert.ok(content.value.content.players.find((entry) => entry.name === "布冯" && entry.overall === 90));
  const player = dashboard.value.dashboard.players[0];
  if (player) {
    const detail = await request(`/api/admin/players/${encodeURIComponent(player.id)}`, { token:login.value.token });
    assert.equal(detail.statusCode, 200);
    assert.equal("token" in detail.value.player, false);
  }
  const logout = await request("/api/admin/logout", { method:"POST", token:login.value.token });
  assert.equal(logout.statusCode, 200);
  assert.equal((await request("/api/admin/dashboard", { token:login.value.token })).statusCode, 401);
});

test("后台球员数值保存以26项为权威并自动适配总评", () => {
  const storeSource = readFileSync(new URL("../versus/ydl-content-store.js", import.meta.url), "utf8");
  assert.match(storeSource, /player\.overall = playerOverallFromAttributes\(player\.attributes, player\.role\)/);
  assert.match(storeSource, /S4_PLAYER_DEFAULT_ATTRIBUTE_CAP/);
  assert.match(storeSource, /player\.referenceAttributes = clone\(player\.attributes\)/);
  assert.match(storeSource, /cleanPatch\.overall = player\.overall/);
  assert.match(storeSource, /cleanPatch\.attributes = clone\(player\.attributes\)/);
  assert.match(storeSource, /applyPlayerPatch\(player, patch, \{ preserveOverall:true \}\)/);
  assert.match(storeSource, /migrated = applyOverrides\(\) \|\| migrated/);
});
