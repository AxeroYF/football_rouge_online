import test from "node:test";
import assert from "node:assert/strict";
import { ATTRIBUTE_NAMES, normalizePlayerSchema, playerAerialAbility, playerPhysicalQuality } from "../shared/football/schema.js";

function makePlayer(name, role, rating, overrides = {}) {
  return normalizePlayerSchema({ id:name, name, role, ...overrides, attributes:{...Object.fromEntries(ATTRIBUTE_NAMES.map(key => [key, rating])), ...overrides.attributes} });
}

test("旧球员会补齐精神、隐藏性格、伤病与成长结构", () => {
  const player = normalizePlayerSchema({ id: "legacy-systems", name: "旧球员", role: "ST", attributes: { attack: 70 } });
  assert.ok(Number.isFinite(player.hidden.mentality));
  assert.ok(player.hidden.personality);
  assert.equal(player.state.injury.severity, "none");
  assert.equal(player.state.injury.matchesRemaining, 0);
  assert.equal(player.state.suspension.matchesRemaining, 0);
  assert.ok(player.development.age >= 16);
  assert.ok(player.development.potential >= 40);
});

test("相同头球技术下身高会显著提高制空能力", () => {
  const base = makePlayer("制空测试", "ST", 70, { heightCm: 180, attributes: { heading: 72, jumping: 72, strength: 72 } });
  const short = normalizePlayerSchema({ ...base, id: "short-aerial", heightCm: 165 });
  const tall = normalizePlayerSchema({ ...base, id: "tall-aerial", heightCm: 200 });
  assert.ok(playerAerialAbility(tall) >= playerAerialAbility(short) + 18);
});

test("身体素质由力量耐力速度等共同决定", () => {
  const weak = makePlayer("身体弱", "DM", 55, { attributes: { strength: 30, stamina: 35, pace: 35, acceleration: 35, agility: 35, jumping: 30, workRate: 35 } });
  const strong = makePlayer("身体强", "DM", 55, { attributes: { strength: 88, stamina: 88, pace: 82, acceleration: 82, agility: 78, jumping: 86, workRate: 90 } });
  assert.ok(playerPhysicalQuality(strong) > playerPhysicalQuality(weak) + 40);
});
