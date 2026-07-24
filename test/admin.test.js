import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminApi } from "../versus/admin-api.js";

async function request(pathname, { method = "GET", token = "", body = {}, address = "127.0.0.1" } = {}) {
  let sent;
  const requestValue = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: address } };
  await handleAdminApi(requestValue, {}, pathname, async () => body, (_response, statusCode, value) => { sent = { statusCode, value }; });
  return sent;
}

test("管理员后台拒绝错误密码和未授权数据访问", async () => {
  const unauthorized = await request("/api/admin/dashboard");
  assert.equal(unauthorized.statusCode, 401);
  const wrong = await request("/api/admin/login", { method:"POST", body:{ password:"wrong" } });
  assert.equal(wrong.statusCode, 401);
});

test("管理员登录后可以读取去敏玩家列表和竞技统计", async () => {
  const login = await request("/api/admin/login", { method:"POST", body:{ password:"19971027" }, address:"127.0.0.2" });
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
