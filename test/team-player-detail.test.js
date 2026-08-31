import test from "node:test";
import assert from "node:assert/strict";
import { PLAYER_ATTRIBUTE_LABELS, teamPlayerDetailMarkup } from "../client/team/team-controller-ydl.js";
import { playerDetailBodyMarkup } from "../client/player-card/player-detail-window.js";

const attributes = Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map((key, index) => [key, 60 + index]));

test("team player detail renders all 26 YDL attributes and effective values", () => {
  const markup = teamPlayerDetailMarkup({
    id:"p1", name:"测试球员", role:"AM", secondaryRole:"RW", pool:"MID", overall:80, effectiveOverall:84,
    baseOverall:80, upgradeLevel:2, grade:"A", nationality:"中国", club:"黄狗竞技", heightCm:181,
    preferredFoot:"both", attributes, effectiveAttributes:{ ...attributes, passing:99 }, traits:[{ name:"组织核心" }],
    state:{ fitness:96, form:72, injury:{ matchesRemaining:0 }, suspension:{ matchesRemaining:0 } },
  });
  assert.equal(Object.keys(PLAYER_ATTRIBUTE_LABELS).length, 26);
  for (const label of Object.values(PLAYER_ATTRIBUTE_LABELS)) assert.match(markup, new RegExp(`>${label}<`));
  assert.match(markup, /当前 26 项能力值/);
  assert.match(markup, /<dt>传球<\/dt><dd>99<\/dd>/);
  assert.match(markup, /<div class="core"><dt>传球/);
  assert.match(markup, /前腰 \/ 右边锋/);
  assert.match(markup, /强化 \+2/);
  assert.match(markup, /组织核心/);
  assert.match(markup, /data-small-window-close/);
  assert.doesNotMatch(markup, /class="team-player-detail-overlay" data-team-detail-close/);
});

test("team player detail escapes player-owned text and highlights goalkeeper core values", () => {
  const markup = teamPlayerDetailMarkup({ id:"gk", name:"<门将>", role:"GK", overall:90, grade:"S", club:'A&B', nationality:'中国', attributes });
  assert.doesNotMatch(markup, /<门将>/);
  assert.match(markup, /&lt;门将&gt;/);
  assert.match(markup, /A&amp;B/);
  assert.match(markup, /<div class="core"><dt>守门/);
  assert.match(markup, /<div class="core"><dt>反应/);
});

test("shared player detail body supports readable inline previews without duplicating the small window shell", () => {
  const markup = playerDetailBodyMarkup({ id:"inline", name:"预览球员", role:"AM", overall:88, grade:"A", club:"黄狗竞技", nationality:"中国", attributes }, {
    showCardStatus:false,
    showProfileHeading:true,
    cardInteractive:true,
    cardAction:"yoogle-detail",
    compact:true,
  });
  assert.match(markup, /player-detail-inline-header/);
  assert.match(markup, /player-detail-inline-header is-compact/);
  assert.match(markup, /player-detail-inline-facts/);
  assert.match(markup, /黄狗竞技 · 中国/);
  assert.match(markup, /data-player-card-action="yoogle-detail"/);
  assert.doesNotMatch(markup, /YDL PLAYER PROFILE|当前 26 项能力值|浅金色项目为该位置的关键属性/);
  assert.equal((markup.match(/<dt>/g) ?? []).length, 30);
  assert.equal((markup.match(/player-detail-inline-identity/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /class="team-player-detail-facts"/);
  assert.doesNotMatch(markup, /team-player-detail-overlay|team-player-detail-level|team-player-detail-traits/);
});
