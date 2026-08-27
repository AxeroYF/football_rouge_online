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
    const renderBroadcast = (broadcast) => rendered.push(broadcast);
    const scheduleSpectatorPolling = (delay) => scheduled.push(delay);
    const clearTimeout = () => {};
    const showToast = (message) => toasts.push(message);
    const closeBroadcast = (notifyServer) => closes.push(notifyServer);
    ${refreshBroadcastSource}
    return {
      refreshBroadcast,
      exit:() => { spectatorSession = null; },
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
