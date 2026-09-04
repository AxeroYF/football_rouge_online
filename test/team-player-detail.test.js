import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_ATTRIBUTE_LABELS, sortTeamPlayers, teamPlayerDetailMarkup, teamPlayerListMarkup } from "../client/team/team-controller-ydl.js";
import { playerDetailBodyMarkup } from "../client/player-card/player-detail-window.js";

const attributes = Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map((key, index) => [key, 60 + index]));
const teamSource = await readFile(new URL("../client/team/team-controller-ydl.js",import.meta.url),"utf8");
const teamStyles = await readFile(new URL("../styles.css",import.meta.url),"utf8");

test("team roster sorts attack first, goalkeeper last, then by effective overall", () => {
  const players = [
    { id:"st-low", name:"前锋乙", role:"ST", overall:75 },
    { id:"gk-low", name:"门将乙", role:"GK", overall:80 },
    { id:"cb", name:"中卫", role:"CB", overall:99 },
    { id:"gk-high", name:"门将甲", role:"GK", overall:70, effectiveOverall:88 },
    { id:"st-high", name:"前锋甲", role:"ST", overall:91 },
  ];
  assert.deepEqual(sortTeamPlayers(players).map((player) => player.id),["st-high","st-low","cb","gk-high","gk-low"]);
});

test("team management defaults to a continuous position list and can switch to player cards", () => {
  const markup = teamPlayerListMarkup([
    { id:"gk", name:"门将", sourceName:"Goalkeeper", role:"GK", grade:"A", overall:86, club:"黄狗", nationality:"中国", attributes },
    { id:"st", name:"中锋", sourceName:"Striker", role:"ST", secondaryRole:"RW", grade:"S", overall:92, club:"黄狗", nationality:"中国", attributes },
  ],{ st:"expedition", gk:"garrison" });
  assert.ok(markup.indexOf("<h3>ST</h3>") < markup.indexOf("<h3>GK</h3>"));
  for (const position of ["ST","LW","RW","AM","LM","RM","DM","LB","RB","CB","GK"]) assert.match(markup,new RegExp(`<h3>${position}<\\/h3>`));
  for (const unsupported of ["CM","LWB","RWB"]) assert.doesNotMatch(markup,new RegExp(`<h3>${unsupported}<\\/h3>`));
  for (const heading of ["球员","编队","评级 / 能力","主 / 副位置","俱乐部","国籍","关键属性"]) assert.match(markup,new RegExp(`>${heading.replace("/","\\/")}<`));
  assert.equal((markup.match(/team-list-columns/g) ?? []).length,1);
  assert.equal((markup.match(/team-player-list-row/g) ?? []).length,2);
  assert.equal((markup.match(/team-position-empty/g) ?? []).length,9);
  assert.match(markup,/<h3>LW<\/h3><\/div><div class="team-position-empty">暂无球员<\/div>/);
  assert.doesNotMatch(markup,/team-position-group|team-position-players|<h3>GK<\/h3><b>/);
  assert.match(markup,/<div class="team-position-row"[^>]*><h3>ST<\/h3><\/div><div class="team-player-list-row(?: [^"]+)?">/);
  assert.match(markup,/中锋<\/strong><em>Striker<\/em>/);
  assert.equal((markup.match(/data-team-squad-player=/g) ?? []).length,2);
  assert.match(markup,/data-team-squad-player="st"[^>]*>[\s\S]*?<option value="expedition" selected>远征<\/option>/);
  assert.match(markup,/data-team-squad-player="gk"[^>]*>[\s\S]*?<option value="garrison" selected>留守<\/option>/);
  assert.match(markup,/class="team-player-list-row is-squad-expedition"/);
  assert.doesNotMatch(markup,/class="team-player-list-row is-squad-garrison"/);
  assert.match(teamStyles,/\.team-player-list-row\.is-squad-expedition\{background:linear-gradient\(90deg,rgba\(174,119,42/);
  assert.doesNotMatch(teamStyles,/\.team-player-list-row\.is-squad-garrison/);
  assert.ok(markup.indexOf('data-team-squad-player="st"') < markup.indexOf('class="team-list-rating"'));
  assert.doesNotMatch(markup,/<button[^>]*class="team-player-list-row"/);
  assert.match(markup,/team-list-positions"><b>ST<\/b><i>\/<\/i><span>RW<\/span>/);
  assert.match(markup,/data-player-card-action="team-detail"/);
  assert.match(markup,/守门|反应|射门|无球/);
  assert.match(teamSource,/let viewMode = "list"/);
  assert.match(teamSource,/data-team-view="list"/);
  assert.match(teamSource,/data-team-view="cards"/);
  assert.match(teamSource,/let filters = \{ squad:"all"/);
  assert.match(teamSource,/data-team-filter="squad"/);
  assert.doesNotMatch(teamSource,/未编队|value="unassigned"|filters\.squad === "unassigned"/);
  assert.match(teamSource,/class="team-squad-summary" aria-label="编队人数"/);
  assert.match(teamSource,/if \(Object\.hasOwn\(squadCounts,squadId\)\) squadCounts\[squadId\] \+= 1/);
  assert.match(teamSource,/const preservedScroll = \{ scrollTop:scrollContainer\?\.scrollTop \?\? 0, scrollLeft:scrollContainer\?\.scrollLeft \?\? 0 \}/);
  assert.match(teamSource,/render\(preservedScroll\)/);
  assert.match(teamSource,/scrollContainer\.scrollTop = scrollTop/);
  assert.match(teamStyles,/label\.team-search\{[^}]*flex:0 1 380px[^}]*width:380px/);
  assert.match(teamStyles,/\.team-squad-summary\{[^}]*margin-left:auto/);
  assert.match(teamStyles,/\.team-squad-summary \.is-expedition\{[^}]*background:rgba\(29,126,154/);
  assert.match(teamStyles,/\.team-squad-summary \.is-garrison\{[^}]*background:rgba\(174,119,42/);
  assert.doesNotMatch(markup,/YDL|PLAYER|PROFILE|点击|查看球员库/);
  assert.match(teamStyles,/\.team-list-name\{[^}]*font-size:18px/);
  assert.match(teamStyles,/\.team-list-rating>strong\{[^}]*font-size:22px/);
  assert.match(teamStyles,/\.team-list-squad\{[^}]*height:36px/);
  assert.match(teamStyles,/\.team-list-rating>b\{color:var\(--ink/);
  assert.doesNotMatch(teamStyles,/\.team-list-rating>b\{[^}]*border:/);
  assert.match(teamStyles,/\.team-management-toolbar input,\.team-management-toolbar select\{[^}]*border-radius:8px[^}]*font:600 14px/);
  assert.doesNotMatch(teamStyles,/\.team-position-group/);
});

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
