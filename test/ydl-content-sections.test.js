import assert from "node:assert/strict";
import test from "node:test";
import { ydlContentSection, ydlContentView } from "../versus/ydl-content-store.js";

test("管理员球员内容按模块加载并避免重复传输26项能力", () => {
  const summary = ydlContentSection("summary");
  const players = ydlContentSection("players");
  const studio = ydlContentSection("studio");
  const analytics = ydlContentSection("analytics");
  const traits = ydlContentSection("traits");

  assert.ok(summary.overview.totalPlayers > 0);
  assert.equal("players" in summary, false);
  assert.equal(Object.keys(players.players[0].attributes).length, 26);
  assert.equal("attributes" in studio.profilePlayers[0], false);
  assert.ok(Array.isArray(studio.playerBatches));
  assert.ok(Array.isArray(studio.playerDrafts));
  assert.ok(Array.isArray(analytics.analytics.nationality));
  assert.ok(Array.isArray(traits.traits));

  const initialStudioBytes = Buffer.byteLength(JSON.stringify({ ...summary, ...studio }));
  const legacyFullBytes = Buffer.byteLength(JSON.stringify(ydlContentView()));
  assert.ok(initialStudioBytes < legacyFullBytes * 0.4, `${initialStudioBytes} should be < 40% of ${legacyFullBytes}`);
});
