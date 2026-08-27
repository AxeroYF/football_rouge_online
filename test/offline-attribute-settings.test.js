import test from "node:test";
import assert from "node:assert/strict";
import { applyS4Enhancement } from "../versus/s4-balance.js";
import {
  offlineDisplayAttributeValue,
  offlineEngineAttributeValue,
  resolveOfflineAttributeSettings,
} from "../versus/offline-attribute-settings.js";
import { V2_MATCH_PARAMETERS, v2EngineAttributeValue } from "../versus/v2/match-parameters-v2.js";

const settings = (rate) => resolveOfflineAttributeSettings({
  YDL_OFFLINE_MODE:"1",
  YDL_OFFLINE_ATTRIBUTE_UNCAP:"1",
  YDL_OFFLINE_OVERCAP_RATE:String(rate),
});

test("offline attribute unlock is disabled outside offline mode", () => {
  const resolved = resolveOfflineAttributeSettings({ YDL_OFFLINE_ATTRIBUTE_UNCAP:"1", YDL_OFFLINE_OVERCAP_RATE:"1" });
  assert.equal(resolved.unlocked, false);
  assert.equal(offlineDisplayAttributeValue(112, resolved), 99);
  assert.equal(offlineEngineAttributeValue(112, resolved), 99);
});

test("offline display preserves the real enhanced value", () => {
  const resolved = settings(1);
  const player = applyS4Enhancement({ overall:99, attributes:{ finishing:99, pace:97 } }, 8, { attributeSettings:resolved });
  assert.deepEqual(player.attributes, { finishing:112, pace:110 });
});

for (const [rate, expected] of [[1, 112], [0.5, 105.5], [0.3, 102.9]]) {
  test(`V2.1 retains ${rate * 100}% of the value above 99`, () => {
    const resolved = settings(rate);
    assert.equal(offlineEngineAttributeValue(112, resolved), expected);
    assert.equal(v2EngineAttributeValue(112, V2_MATCH_PARAMETERS, resolved), expected);
  });
}
