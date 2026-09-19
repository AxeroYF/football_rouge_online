import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoutingDetailMarkup, scoutingProgress, scoutingGradeProbabilities, scoutingPoolMarkup, scoutingCountryProbabilities, scoutMovementProgress } from "../client/buildings/scouting-controller.js";
import { SCOUTING_RULES, scoutingLevel } from "../shared/config/scouting.mjs";
import { meteorLayer } from "../client/ui/meteor-background.js";

const view = { kind:"unit", canDiscover:true, scout:{id:"u",name:"Oliver Reed",level:1,status:"idle",movableTerritoryIds:["b"]}, building: { level: 1, status: "active" }, rules: SCOUTING_RULES, levelRules: scoutingLevel(1), coreCountry: true, country: "西班牙", territoryLabel: "西班牙 · 马德里", ownedCenters: 1 };
test("scout detail shows price, time and location and disables unavailable actions", () => {
  const idle = scoutingDetailMarkup(view, { gold: SCOUTING_RULES.costGold });
  assert.match(idle, /700 金币/); assert.match(idle, /10 分钟/); assert.match(idle, /西班牙 · 马德里/);
  assert.doesNotMatch(idle, /普通候选|强化概率|设施升级|下一位新成员|独立卡片/);
  assert.doesNotMatch(idle, /data-scout-start disabled/);
  assert.match(scoutingDetailMarkup(view, { gold: SCOUTING_RULES.costGold - 1 }), /data-scout-start disabled/);
  assert.match(scoutingDetailMarkup({ ...view, canDiscover:false }, { gold: SCOUTING_RULES.costGold }), /data-scout-start disabled/);

});
test("candidate cards retain strengthened legends and the original direct selection", () => {
  const task = { id: "task", status: "ready", cards: [0, 1, 2].map((i) => ({ id: `card-${i}`, name: i === 0 ? '<script>alert(1)</script>' : `球员${i}`, grade: "S", upgradeLevel: 3, overall: 94, attributes: {} })) };
  task.cards = task.cards.map((c) => ({ ...c, playerId: c.id }));
  const html = scoutingDetailMarkup({ ...view, task }, { showSelection: true });
  assert.equal((html.match(/data-scout-select=/g) ?? []).length, 3);
  assert.doesNotMatch(html, /data-scout-confirm-choice/); assert.match(html, /强化加3/);
  assert.match(html, /inventory-choice-grid/);
  assert.doesNotMatch(html, /<script>/);
  const pending = scoutingDetailMarkup({ ...view, task }, { selectedCardId: "card-1", pending: true, showSelection: true });
  assert.equal((pending.match(/ disabled/g) ?? []).length, 3);
  assert.match(pending, /aria-busy="true"/);
});
test("task progress clamps and shared meteor layer is reused by both card-selection flows", () => {
  const task = { startedAt: 1000, completesAt: 601000 };
  assert.equal(scoutingProgress(task, 301000).percent, 50);
  assert.equal(scoutingProgress(task, 0).percent, 0);
  assert.equal(scoutingProgress(task, 701000).percent, 100);
  assert.equal((meteorLayer().match(/<i /g) ?? []).length, 16);
  for (const file of ["client/buildings/scouting-controller.js", "client/inventory/inventory-controller.js"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /import \{ meteorLayer \} from "\.\.\/ui\/meteor-background.js"/);
  }
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /id="campaign-notifications"/); assert.match(index, /id="scouting-notifications"/);
  assert.doesNotMatch(index, /map-zoom-indicator/);
  const selection = index.match(/<section id="scouting-selection"[\s\S]*?<\/section>/)[0];
  assert.match(selection, /inventory-opening-stage-root/);
  assert.match(selection, /inventory-opening-surface/);
  assert.doesNotMatch(selection, /standard-window|scouting-header/);
});

test("grade pie uses unconditional per-candidate probabilities that total 100 at every facility level", () => {
  assert.deepEqual(scoutingGradeProbabilities(scoutingLevel(1)), [
    { grade: "C", percent: 74.625 }, { grade: "B", percent: 24.875 }, { grade: "S", percent: 0.5 },
  ]);
  for (let level = 1; level <= 5; level += 1) {
    const entries = scoutingGradeProbabilities(scoutingLevel(level));
    assert.ok(Math.abs(entries.reduce((sum, entry) => sum + entry.percent, 0) - 100) < 1e-9);
    const html = scoutingPoolMarkup(level, scoutingLevel(level));
    const displayed = [...html.matchAll(/<strong>([0-9]+\.[0-9])%<\/strong>/g)];
    assert.equal(displayed.length, entries.length);
    assert.match(html, /conic-gradient/); assert.match(html, /role="img"/);
    assert.match(html, /每名候选/); assert.match(html, new RegExp(`LV.${level}`));
  }
  const idle = scoutingDetailMarkup(view, { gold: SCOUTING_RULES.costGold });
  assert.match(idle, /74\.6%/); assert.match(idle, /24\.9%/); assert.match(idle, /0.5%/);
});


test("country forecast follows the core-country and non-core grouping with configurable bias",()=>{
  const core=scoutingCountryProbabilities({countryCode:"ESP",rules:SCOUTING_RULES});
  assert.deepEqual(core.map(({label,percent})=>[label,Math.round(percent)]),[["西班牙",80],["其他国家",20]]);
  const noncore=scoutingCountryProbabilities({countryCode:"NOR",rules:SCOUTING_RULES});
  assert.deepEqual(noncore.map(({label,percent})=>[label,Math.round(percent)]),[["非核心国家",80],["核心国家",20]]);
  assert.equal(scoutingCountryProbabilities({countryCode:"GBR"})[0].label,"英国");
  assert.equal(scoutingCountryProbabilities({countryCode:"DEU",rules:{regionalBias:.7}})[0].percent,70);
  assert.deepEqual(scoutingCountryProbabilities({}),[]);
  const html=scoutingDetailMarkup({...view,countryCode:"NOR"},{gold:500});
  assert.equal((html.match(/class="scout-pool-pie"/g)??[]).length,2);
  assert.match(html,/预计国家分布/);assert.match(html,/非核心国家 80%/);
  assert.doesNotMatch(html,/<small>/);
});
test("moving panel and movement confirmation hide both forecasts and show the fixed journey endpoints",()=>{
  const movement={id:"journey",fromTerritoryId:"a",toTerritoryId:"b",startedAt:1000,arrivesAt:121000};
  const html=scoutingDetailMarkup({...view,sourceLabel:"起点区域",destinationLabel:"终点区域",scout:{...view.scout,movement}},{gold:500});
  assert.doesNotMatch(html,/scout-pool|conic-gradient/);
  assert.match(html,/起点区域/);assert.match(html,/终点区域/);
  assert.match(html,/data-scout-move-progress/);assert.doesNotMatch(html,/data-scout-move-percent/);assert.ok(html.includes(">中止</button>"));
  assert.match(html,/data-scout-movement-id="journey"/);
  const plan=scoutingDetailMarkup(view,{movementPlan:{fromLabel:"起点区域",territoryLabel:"终点区域",durationMs:120000}});
  assert.doesNotMatch(plan,/scout-pool/);assert.match(plan,/起点区域/);assert.match(plan,/终点区域/);
  assert.deepEqual(scoutMovementProgress(movement,31000),{percent:25,remaining:90000});
  assert.equal(scoutMovementProgress(movement,0).percent,0);
  assert.deepEqual(scoutMovementProgress(movement,200000),{percent:100,remaining:0});
});
test("active discovery country forecast uses its paid task snapshot after a unit is relocated",()=>{
  const html=scoutingDetailMarkup({...view,countryCode:"DEU",task:{id:"old",countryCode:"ESP",status:"working",startedAt:1000,completesAt:601000}},{gold:500});
  assert.match(html,/西班牙 80%/);assert.doesNotMatch(html,/德国 80%/);
});



test('compact scout controls keep queue totals and clearly disable neutral excavation without explanatory paragraphs',()=>{
 const html=scoutingDetailMarkup({...view,neutralTerritory:true,canDiscover:false},{gold:20000,queueRounds:20});
 assert.doesNotMatch(html,/一次预付|全部完成后|可继续移动|scout-queue-note/);assert.match(html,/中立地块不可发掘/);assert.match(html,/data-scout-start disabled/);assert.match(html,/200 分钟/);assert.match(html,/14,000 金币/);assert.match(html,/value="20" selected/);
});
