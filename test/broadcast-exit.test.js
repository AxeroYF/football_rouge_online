import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
const refreshBroadcastSource = appSource.match(/async function refreshBroadcast\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";

function broadcastPollingHarness(apiImpl, privateMatch = false) {
  return Function("apiImpl", "privateMatch", `
    let spectatorSession = { code:"YDL-TEST", token:"viewer-token" };
    if (privateMatch) spectatorSession.aiTraining = true;
    const account = { profile:{ id:"owner" }, accountToken:"owner-auth" };
    const leagueIdentity = () => ({ playerId:account.profile.id, accountToken:account.accountToken });
    let spectatorPolling = null;
    let spectatorPollingFailures = 0;
    const rendered = [];
    const scheduled = [];
    const toasts = [];
    const closes = [];
    const api = apiImpl;
    const document = { hidden:false };
    const renderBroadcast = (broadcast) => rendered.push(broadcast);
    const uiMotion = {resetBroadcast(){}};
    const scheduleSpectatorPolling = (delay) => scheduled.push(delay);
    const clearTimeout = () => {};
    const showToast = (message) => toasts.push(message);
    const closeBroadcast = (notifyServer) => closes.push(notifyServer);
    ${refreshBroadcastSource}
    return {
      refreshBroadcast,
      exit:() => { spectatorSession = null; },
      hide:() => { document.hidden = true; },
      show:() => { document.hidden = false; },
      session:() => spectatorSession,
      rendered,
      scheduled,
      toasts,
      closes,
    };
  `)(apiImpl, privateMatch);
}

test("退出观赛后忽略仍在途的直播轮询响应", async () => {
  let resolveRequest;
  const harness = broadcastPollingHarness(() => new Promise((resolve) => { resolveRequest = resolve; }));
  const pending = harness.refreshBroadcast();
  harness.exit();
  resolveRequest({ broadcast:{ live:true, code:"YDL-TEST" } });
  await pending;
  assert.deepEqual(harness.rendered, []);
  assert.deepEqual(harness.scheduled, []);
  assert.deepEqual(harness.toasts, []);
  assert.deepEqual(harness.closes, []);
});

test("后台观赛页面跳过轮询，并忽略切入后台前的响应", async () => {
  let calls = 0;
  const hidden = broadcastPollingHarness(() => { calls++; });
  hidden.hide();
  await hidden.refreshBroadcast();
  assert.equal(calls, 0);
  let resolveRequest;
  const pending = broadcastPollingHarness(() => new Promise(resolve => { resolveRequest = resolve; }));
  const request = pending.refreshBroadcast();
  pending.hide();
  resolveRequest({ broadcast:{ live:true } });
  await request;
  assert.deepEqual(pending.rendered, []);
  assert.deepEqual(pending.scheduled, []);
});

test("过期观赛自动恢复原比赛，私有训练携带账号身份", async () => {
  const calls = [];
  const harness = broadcastPollingHarness(async (path, options) => {
    calls.push({ path, options });
    if (calls.length === 1) throw Object.assign(new Error("过期"), { code:"BROADCAST_SESSION_EXPIRED" });
    return { spectatorToken:"restored-token", broadcast:{ live:true } };
  }, true);
  await harness.refreshBroadcast();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/api/versus/watch/resume");
  assert.equal(calls[1].options.body.playerId, "owner");
  assert.equal(calls[1].options.body.spectatorToken, "viewer-token");
  assert.equal(harness.session().token, "restored-token");
  assert.equal(harness.rendered.length, 1);
  assert.deepEqual(harness.closes, []);
});

test("前后台交错时不会重叠读取或让旧响应覆盖，恢复请求结束后补读", async () => {
  let resolve, calls = 0;
  const harness = broadcastPollingHarness(() => { calls++; return new Promise(r => { resolve = r; }); });
  const pending = harness.refreshBroadcast();
  harness.hide(); harness.show();
  await harness.refreshBroadcast();
  assert.equal(calls, 1);
  resolve({ broadcast:{ live:true } });
  await pending;
  assert.equal(harness.rendered.length, 1);
  assert.equal(harness.scheduled.at(-1), 0);
});

test("恢复途中退出时清理新会话；权限拒绝不会循环重新开赛", async () => {
  let resolve;
  const calls = [];
  const harness = broadcastPollingHarness(async path => {
    calls.push(path);
    if (calls.length === 1) throw Object.assign(new Error("过期"), { code:"BROADCAST_SESSION_EXPIRED" });
    if (calls.length === 2) return new Promise(r => { resolve = r; });
    return {};
  });
  const pending = harness.refreshBroadcast();
  await new Promise(r => setImmediate(r));
  harness.exit(); resolve({ spectatorToken:"new-token", broadcast:{ live:true } });
  await pending;
  assert.equal(calls.at(-1), "/api/versus/watch/YDL-TEST/leave-watch");
  assert.deepEqual(harness.rendered, []);
  const denied = broadcastPollingHarness(async () => { throw Object.assign(new Error("无权限"), { code:"BROADCAST_FORBIDDEN" }); });
  await denied.refreshBroadcast();
  assert.deepEqual(denied.closes, [false]);
  assert.deepEqual(denied.scheduled, []);
});
