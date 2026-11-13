import test from "node:test";
import assert from "node:assert/strict";
import { startLocalServer } from "./helpers/local-server.js";

test("admin HTTP season controls and old replay aliases share the preserve-coins policy", async t => {
  const server = await startLocalServer({ publicOnly:false }); t.after(() => server.stop());
  const call = async (route, body, token) => {
    const response = await fetch(server.url + route, { method:body ? "POST" : "GET", headers:{ "content-type":"application/json", ...(token ? { authorization:`Bearer ${token}` } : {}) }, body:body ? JSON.stringify(body) : undefined });
    return { status:response.status, ...await response.json() };
  };
  assert.equal((await call("/api/admin/league/season-controls/preview")).status, 401);
  const admin = await call("/api/admin/login", { password:"isolated-test-password-only" });
  const user = await call("/api/versus/register", { nickname:"Admin Reset Runtime", password:"reset-runtime-password" });
  const identity = { playerId:user.profile.id, accountToken:user.accountToken };
  await call("/api/versus/league/draft/start", { ...identity, teamName:"Reset Runtime FC" });
  await call("/api/versus/league/draft/auto", identity); await call("/api/versus/league/draft/finish", identity);
  await call("/api/admin/league/coins/grant", { amount:12345 }, admin.token);
  const initial = (await call("/api/admin/league", null, admin.token)).league.economy.find(entry => entry.accountId === identity.playerId).balance;
  const preview = async () => (await call("/api/admin/league/season-controls/preview", null, admin.token)).preview;
  const command = async action => {
    const value = await preview();
    assert.deepEqual(value.operations.map(entry => entry.id), ["replay", "next", "full"]);
    const operation = value.operations.find(entry => entry.id === action);
    return call("/api/admin/league/season-controls", { action, confirm:operation.confirmation, seasonId:value.seasonId, revision:value.revision }, admin.token);
  };
  for (const action of ["replay", "next"]) {
    const result = await command(action);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.league.season.status, "registration");
    assert.equal(result.league.economy.find(entry => entry.accountId === identity.playerId).balance, initial);
  }
  for (const [route, confirm] of [["restart", "RESTART"], ["daily-reset", "DAILY_RESET_YDL"]]) {
    const result = await call(`/api/admin/league/${route}`, { confirm }, admin.token);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.league.economy.find(entry => entry.accountId === identity.playerId).balance, initial);
  }
  const stale = await preview();
  await call("/api/admin/league/coins/grant", { amount:1 }, admin.token);
  assert.equal((await call("/api/admin/league/season-controls", { action:"replay", confirm:"重赛当前赛季", seasonId:stale.seasonId, revision:stale.revision }, admin.token)).status, 409);
  const full = await command("full");
  assert.equal(full.ok, true, full.error);
  assert.equal(full.league.economy.length, 0);
  assert.equal(full.league.teams.filter(team => !team.isAi).length, 0);
  assert.equal((await call("/api/versus/profile", identity)).ok, true, "player login account survives full reset");
});
