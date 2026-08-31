import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  filterYooglePlayers,
  sortYooglePlayers,
  yooglePlayerPreviewMarkup,
  YOOGLE_ATTRIBUTE_LABELS,
  YOOGLE_RESULT_LIMIT,
} from "../client/yoogle/yoogle-controller.js";

const players = [
  { id:"one", name:"阿利松", club:"利物浦", nationality:"巴西", role:"GK", secondaryRole:null, overall:89, grade:"A", pool:"GK", attributes:{ goalkeeping:89 } },
  { id:"two", name:"萨拉赫", club:"利物浦", nationality:"埃及", role:"RW", secondaryRole:"ST", overall:91, grade:"S", pool:"ATT", attributes:{ finishing:92 }, inRoster:true },
  { id:"three", name:"托尼·克罗斯", club:"皇家马德里", nationality:"德国", role:"CM", secondaryRole:"DM", overall:93, grade:"S", pool:"MID", attributes:{ passing:96 } },
];

test("YOOGLE keeps the mature S4 name, club, country and exact role searches", () => {
  assert.equal(YOOGLE_RESULT_LIMIT, 10);
  assert.deepEqual(filterYooglePlayers(players, "萨拉赫").map((player) => player.id), ["two"]);
  assert.deepEqual(filterYooglePlayers(players, "利物浦").map((player) => player.id), ["two", "one"]);
  assert.deepEqual(filterYooglePlayers(players, "德国").map((player) => player.id), ["three"]);
  assert.deepEqual(filterYooglePlayers(players, "st").map((player) => player.id), ["two"]);
  assert.deepEqual(filterYooglePlayers(players, "g").map((player) => player.id), []);
});

test("YOOGLE ranks real card art before overall ability for multi-player searches", () => {
  const ranked = sortYooglePlayers([
    { id:"no-art-99", name:"无卡高分", nationality:"巴西", role:"ST", overall:99 },
    { id:"art-82", name:"有卡低分", nationality:"巴西", role:"ST", overall:82, portrait:"/assets/art-82.png" },
    { id:"art-94", name:"有卡高分", nationality:"巴西", role:"ST", overall:94, portrait:"/assets/art-94.png" },
  ]);
  assert.deepEqual(ranked.map((player) => player.id), ["art-94", "art-82", "no-art-99"]);
  assert.deepEqual(filterYooglePlayers(ranked, "巴西").map((player) => player.id), ["art-94", "art-82", "no-art-99"]);
});

test("YOOGLE preview uses the standard player card and renders all 26 values", () => {
  const markup = yooglePlayerPreviewMarkup(players[1]);
  assert.match(markup, /ydl-player-card/);
  assert.doesNotMatch(markup, /YOOGLE · YDL PLAYER DATABASE/);
  assert.match(markup, /我的球队球员/);
  assert.match(markup, /26 项基础能力值/);
  assert.equal(Object.keys(YOOGLE_ATTRIBUTE_LABELS).length, 26);
  assert.equal((markup.match(/<dt>/g) ?? []).length, 35);
});

test("game topbar wires YOOGLE immediately before the wallet and opens a standard window", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../client/yoogle/yoogle-controller.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/yoogle.css", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="yoogle-search"') < html.indexOf('id="topbar-wallet"'));
  assert.match(html, /class="yoogle-logo"[^>]*id="yoogle-window-trigger"[^>]*><i>Y<\/i>OOGLE/);
  assert.match(html, /class="yoogle-searchbox"[\s\S]*id="yoogle-search-panel"/);
  assert.match(html, /id="yoogle-window" class="yoogle-window standard-window" data-standard-window="yoogle"/);
  assert.match(html, /class="yoogle-window-logo"[^>]*[\s\S]*id="yoogle-window-input"/);
  assert.match(html, /id="yoogle-window-detail-layer"/);
  assert.match(app, /createYoogleController/);
  assert.match(app, /windowRoot: document\.querySelector\("#yoogle-window"\)/);
  assert.match(app, /yoogleController\.initialize\(\)/);
  assert.doesNotMatch(controller, /搜索 YDL 球员库/);
  assert.match(controller, /registerStandardWindow\(windowRoot/);
  assert.match(controller, /playerDetailBodyMarkup\(player, \{ showCardStatus:false, showProfileHeading:true, cardInteractive:true, cardAction:"yoogle-detail", compact:true \}\)/);
  assert.doesNotMatch(controller, /YDL 公共球员库<\/small>/);
  assert.match(controller, /function showTopConfirmation\(playerId\)/);
  assert.match(controller, /panel\.addEventListener\("pointerdown"/);
  assert.match(controller, /showTopConfirmation\(playerButton\.dataset\.yooglePlayer\)/);
  assert.doesNotMatch(controller, /openWindow\(\{ query:input\.value, selectedPlayerId:playerButton\.dataset\.yooglePlayer \}\)/);
  assert.match(controller, /playerDetailWindowMarkup\(selected\)/);
  assert.match(controller, /bindSmallWindow\(overlay/);
  assert.match(controller, /slice\(0, YOOGLE_RESULT_LIMIT\)/);
  assert.match(controller, /windowResultRowsMarkup\(matches, windowActiveIndex\)/);
  assert.doesNotMatch(controller, /显示最相关的前 10 名/);
  assert.match(controller, /addEventListener\("compositionstart"/);
  assert.match(controller, /addEventListener\("compositionend"/);
  assert.match(controller, /event\.isComposing/);
  assert.match(controller, /let windowSubmittedQuery = ""/);
  assert.match(controller, /showTopConfirmation\(playerId\)/);
  assert.match(controller, /windowSubmittedQuery = windowInput\.value\.trim\(\)/);
  assert.match(controller, /const query = windowSubmittedQuery/);
  assert.doesNotMatch(controller, /windowSelectedPlayerId = results\[windowActiveIndex\]/);
  assert.match(styles, /\.yoogle-dropdown\{[^}]*width:100%/);
  assert.match(styles, /\.yoogle-window-search\{[^}]*justify-content:center/);
  assert.match(styles, /\.yoogle-window\.has-query \.yoogle-window-search/);
  assert.match(styles, /\.yoogle-page-results\{[^}]*grid-template-columns:1fr/);
  assert.match(styles, /\.yoogle-full-result \.team-player-detail-body\{[^}]*grid-template-columns:/);
  assert.match(styles, /\.yoogle-full-result \.team-player-attributes dl\{[^}]*grid-template-columns:repeat\(9/);
  assert.match(styles, /\.yoogle-full-result \.team-player-detail-card>\.s4-player-card\{[^}]*width:165px/);
  assert.match(styles, /\.team-player-detail-card>\.s4-player-card \.s4-player-card-name\{[^}]*position:absolute[^}]*bottom:34px/);
  assert.match(styles, /\.team-player-detail-card>\.s4-player-card footer\{[^}]*position:absolute[^}]*bottom:10px/);
  assert.match(styles, /\.player-detail-inline-header\.is-compact\{[^}]*min-height:46px/);
  assert.match(styles, /\.player-detail-inline-header\.is-compact\{[^}]*width:100%/);
  assert.match(styles, /\.player-detail-inline-header\.is-compact>\.player-detail-inline-identity\{[^}]*display:flex/);
  assert.match(styles, /\.yoogle-full-result \.player-detail-inline-facts\{[^}]*display:grid/);
  assert.match(styles, /\.yoogle-full-result \.player-detail-inline-facts>div\{[^}]*display:flex/);
  assert.match(styles, /\.yoogle-full-result \.player-detail-inline-facts dt\{[^}]*font-size:11px/);
  assert.match(styles, /\.yoogle-full-result \.team-player-detail-facts\{[^}]*display:flex/);
  assert.match(styles, /\.yoogle-full-result \.team-player-attributes dl>div\{[^}]*min-height:39px/);
  assert.match(styles, /\.yoogle-full-result \.team-player-attributes dt\{[^}]*font-size:11px/);
  assert.doesNotMatch(styles, /\.yoogle-page-result\{/);
});
