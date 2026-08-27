import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
const functionSource = (name) => appSource.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";

test("YOOGLE搜索结果提供双人对比入口和右下角对比托盘", () => {
  assert.match(appSource, /data-overview-compare-add/);
  assert.match(appSource, /data-overview-compare-tray/);
  assert.match(appSource, /data-overview-compare-open/);
  assert.match(appSource, /leagueOverviewPlayerComparison\.length >= 2/);
  assert.match(stylesSource, /\.overview-player-search\{height:220px;min-height:220px;max-height:220px\}/);
  assert.match(stylesSource, /\.overview-player-search\.has-query \.overview-player-results\{height:auto;min-height:0;max-height:none;flex:1;overflow:auto\}/);
  assert.match(stylesSource, /\.overview-player-search\.has-query \.overview-player-search-home\{min-height:64px;[^}]*grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(stylesSource, /@media\(min-width:901px\)\{\.league-dashboard-side\{height:100%;min-height:0;display:flex;flex-direction:column\}/);
  assert.match(stylesSource, /\.league-dashboard-side>\.overview-player-search\{height:0;min-height:220px;max-height:none;flex:1 1 220px\}/);
  assert.match(stylesSource, /\.overview-player-comparison-stat strong\.is-higher\{color:#83e6a1\}/);
  assert.match(stylesSource, /\.overview-player-comparison-dialog\{width:min\(1760px,100%\)\}/);
  assert.match(stylesSource, /\.overview-player-comparison-bar\{[^}]*grid-template-columns:1fr 1fr/);
  assert.match(stylesSource, /\.overview-player-comparison-stat>dd\{min-width:0;grid-template-columns:32px minmax\(36px,1fr\) 32px/);
});

test("YOOGLE对比独立计算两侧强化并将26项能力及身高的较高值显示为浅绿色", () => {
  const attributes = Object.fromEntries(Array.from({ length:26 }, (_, index) => [`stat${index + 1}`, 70]));
  const players = [
    { id:"left", name:"左侧球员", club:"A队", role:"ST", grade:"A", overall:70, heightCm:177, attributes },
    { id:"right", name:"右侧球员", club:"B队", role:"ST", grade:"A", overall:70, heightCm:183, attributes },
  ];
  const markup = Function("players", `
    const league = { enhancement:{ abilityBonuses:[0,1,2,3,5,7,9,11,13] }, playerDirectory:{ players } };
    const leagueOverviewPlayerComparison = [
      { playerId:"left", upgradeLevel:1, bondPercent:0 },
      { playerId:"right", upgradeLevel:3, bondPercent:0 },
    ];
    const ROLE_LABELS = { ST:"前锋" };
    const STAT_LABELS = Object.fromEntries(Array.from({ length:26 }, (_, index) => [\`stat\${index + 1}\`, \`能力\${index + 1}\`]));
    const escapeHtml = (value) => String(value);
    const s4PlayerCardMarkup = (player, { card }) => \`<article class="s4-player-card"><b>\${player.name}</b><strong>\${card.effectiveOverall}</strong></article>\`;
    ${functionSource("overviewPlayerPreviewValues")}
    ${functionSource("overviewPlayerComparisonValue")}
    ${functionSource("overviewPlayerComparisonBar")}
    ${functionSource("overviewPlayerComparisonMarkup")}
    return overviewPlayerComparisonMarkup();
  `)(players);

  assert.match(markup, /强化能力 \+1/);
  assert.match(markup, /强化能力 \+3/);
  assert.equal((markup.match(/class="overview-player-comparison-stat/g) ?? []).length, 27);
  assert.equal((markup.match(/class="overview-player-comparison-bar"/g) ?? []).length, 27);
  assert.equal((markup.match(/class="is-higher"/g) ?? []).length, 27);
  assert.doesNotMatch(markup, /overview-player-comparison-up|↑/);
  assert.equal((markup.match(/class="s4-player-card"/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /overview-player-facts|overview-player-ownership|class="core"/);
  assert.match(markup, /<strong>71<\/strong>/);
  assert.match(markup, /<strong class="is-higher">73<\/strong>/);
  assert.match(markup, /<dd><span><strong>71<\/strong><\/span><div class="overview-player-comparison-bar"[^>]*><span class="bar-left"><i style="width:0%"><\/i><\/span><span class="bar-right"><i style="width:7%"><\/i><\/span><\/div><span><strong class="is-higher">73/);
  assert.match(markup, /<dt>身高<\/dt><dd><span><strong>177<\/strong><\/span><div class="overview-player-comparison-bar"[^>]*><span class="bar-left"><i style="width:0%"><\/i><\/span><span class="bar-right"><i style="width:20%"><\/i><\/span><\/div><span><strong class="is-higher">183<\/strong>/);
  assert.doesNotMatch(markup, /177 cm|183 cm/);
});
