import test from "node:test";
import assert from "node:assert/strict";
import { LEGEND_PROFILES } from "../shared/football/legends.js";

test("传奇池包含指定的十四名球星且身份唯一", () => {
  assert.equal(LEGEND_PROFILES.length, 14);
  assert.equal(new Set(LEGEND_PROFILES.map((player) => player.id)).size, 14);
  assert.deepEqual(
    new Set(LEGEND_PROFILES.map((player) => player.name)),
    new Set(["梅西", "姆巴佩", "C罗", "库尔图瓦", "哈兰德", "莫德里奇", "克罗斯", "贝利", "齐达内", "贝肯鲍尔", "大罗", "罗纳尔迪尼奥", "马拉多纳", "贝克汉姆"]),
  );
});
