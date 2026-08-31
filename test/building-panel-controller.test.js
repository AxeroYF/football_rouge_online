import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildingPanelMarkup,
  formatConstructionTime,
} from "../client/buildings/building-panel-controller.js";

const catalog = [{
  type: "scout-center",
  label: "球探中心",
  iconPath: "/assets/building-icons-v2/scout-center.png",
  buildable: true,
  buildCostGold: 5_000,
  constructionDurationMs: 60_000,
  coastalOnly: false,
}];

test("building panel renders preview, one-minute construction and no upgrade action", () => {
  const now = 100_000;
  const markup = buildingPanelMarkup({
    view: {
      canManage: true,
      slotLimit: 7,
      occupiedSlots: 1,
      availableSlots: 6,
      availableTypes: ["scout-center"],
      buildings: [{
        id: "building-1",
        type: "main-stadium",
        label: "主体育场",
        name: "测试主体育场",
        level: 1,
        status: "constructing",
        constructionStartedAt: now - 30_000,
        completesAt: now + 30_000,
      }],
    },
    catalog,
    territoryLabel: "英国 - 高地",
    walletGold: 1_000_000,
    now,
  });
  assert.match(markup, /测试主体育场/);
  assert.match(markup, /building-preview-meta/);
  assert.match(markup, /LV\.1/);
  assert.match(markup, /施工中 · 00:30/);
  assert.match(markup, /5,000/);
  assert.match(markup, /data-build-type="scout-center"/);
  assert.doesNotMatch(markup, /data-upgrade|升级设施|立即升级/);
  assert.equal(formatConstructionTime(60_000), "01:00");
});

test("building panel hides construction menu for territory visitors", () => {
  const markup = buildingPanelMarkup({
    view: { canManage: false, slotLimit: null, buildings: [], availableTypes: [] },
    catalog,
  });
  assert.match(markup, /仅可预览/);
  assert.doesNotMatch(markup, /data-build-type/);
});

test("app statically wires building drawer, polling and build endpoint", () => {
  const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const stylesSource = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(appSource, /createBuildingPanelController/);
  assert.match(appSource, /buildingPanelController\?\.refreshFromState\(\)/);
  assert.match(indexSource, /id="building-panel"/);
  assert.match(indexSource, /id="territory-building-button"/);
  assert.match(stylesSource, /\.building-build-option/);
});
