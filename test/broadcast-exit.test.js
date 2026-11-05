import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
const refreshBroadcastSource = appSource.match(/async function refreshBroadcast\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";

function broadcastPollingHarness(apiImpl) {
  return Function("apiImpl", `
    let spectatorSession = { code:"YDL-TEST", token:"viewer-token" };
    let spectatorPolling = null;
    let spectatorPollingFailures = 0;
    const rendered = [];
    const scheduled = [];
    const toasts = [];
    const closes = [];
    const api = apiImpl;
    const document = { hidden:false };
    const renderBroadcast = (broadcast) => rendered.push(broadcast);
    const scheduleSpectatorPolling = (delay) => scheduled.push(delay);
    const clearTimeout = () => {};
    const showToast = (message) => toasts.push(message);
    const closeBroadcast = (notifyServer) => closes.push(notifyServer);
    ${refreshBroadcastSource}
    return {
      refreshBroadcast,
      exit:() => { spectatorSession = null; },
      hide:() => { document.hidden = true; },
      rendered,
      scheduled,
      toasts,
      closes,
    };
  `)(apiImpl);
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
