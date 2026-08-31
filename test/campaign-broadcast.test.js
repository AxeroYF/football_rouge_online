import assert from "node:assert/strict";
import test from "node:test";
import { CAMPAIGN_LIVE_POLL_MS, campaignPlaybackTickMs } from "../campaign-broadcast.js";

test("campaign television uses a fixed S4-style server snapshot cadence", () => {
  assert.equal(CAMPAIGN_LIVE_POLL_MS,1000);
  for (const eventCount of [0,24,80,180,360]) {
    assert.equal(campaignPlaybackTickMs(eventCount),CAMPAIGN_LIVE_POLL_MS);
  }
});
