import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { ATTRIBUTE_NAMES, PLAYER_OVERALL_ATTRIBUTE_KEYS, playerOverallFromAttributes } from "../game/public/schema.js";
import { assertS4AssetInvariants, ownershipOwner } from "../versus/s4-assets.js";
import { isXPlayer, normalizedGameAttributes, REAL_PLAYER_BY_ID, REAL_PLAYERS, S4_PLAYER_DEFAULT_ATTRIBUTE_CAP } from "../versus/player-pool.js";
import { VERSUS_TRAIT_CARDS } from "../versus/trait-pool.js";
import { A_PLAYER_PROFILE_BY_PLAYER_ID } from "../versus/public/a-player-profiles.js";
import { LEGENDARY_PROFILE_BY_PLAYER_ID } from "../versus/public/legendary-profiles.js";
import { X_PLAYER_PROFILE_BY_PLAYER_ID } from "../versus/public/x-player-profiles.js";
import { advanceYdlLeagueV2Match } from "../versus/v2/ydl-league-engine-adapter.js";
import { CLUB_BADGES, COUNTRY_BADGES } from "../versus/cosmetic-items.js";

const NOW = Date.parse("2026-07-26T12:00:00+08:00");
const account = (id) => ({ id, nickname:id });

test("主任株式会社赞助商PNG具有真实透明背景", async () => {
  const image = sharp(readFileSync(new URL("../versus/public/assets/sponsors/zhuren-kabushiki-kaisha.png", import.meta.url)));
  const { channels } = await image.stats();
  assert.equal(channels.length, 4);
  assert.equal(channels[3].min, 0);
  assert.equal(channels[3].max, 255);
  assert.ok(channels[3].mean < 160);
});
function assertOptimizedProfileAsset(entry, directoryName) {
  assert.match(entry.optimizedFileName, /\.webp$/);
  assert.match(entry.imageUrl, /\/webp\/.+\.webp\?v=[a-f0-9]{12}$/);
  assert.ok(
    existsSync(new URL(`../${directoryName}/webp/${entry.optimizedFileName}`, import.meta.url)),
    entry.optimizedFileName,
  );
}

test("X级球员在仓库默认排序中优先于S级且磁贴使用淡红背景", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /PLAYER_GRADE_ORDER = Object\.freeze\(\{ X:0, S:1, A:2, B:3, C:4 \}\)/);
  assert.match(appSource, /comparePlayerGrade\(left, right\)/);
  assert.match(styles, /\.magnet\.grade-x\{[^}]*background:#efb7bc/);
  assert.doesNotMatch(styles, /\.magnet\.grade-x::after\{content:"★"/);
  assert.match(styles, /\.league-squad-magnet\.grade-x,\.league-bench-magnet\.grade-x/);
  assert.match(styles, /\.s4-player-card\.grade-x\.band-high\{[^}]*#fff/);
  assert.match(styles, /\.s4-player-card\.grade-x\.band-max\{[^}]*#ff8fc4/);
});

test("所有真人卡面统一移除中央评级圆圈且保留新版边框", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /const legendary = Boolean\(player\.legendary \?\? player\.legend \?\? player\.grade === "S"\)/);
  assert.match(appSource, /\$\{playerProfile \? "has-player-profile" : ""\}/);
  assert.match(styles, /\.s4-player-card::before\{[^}]*inset:5px[^}]*border-radius:23px/);
  assert.doesNotMatch(styles, /\.s4-player-card::before\{[^}]*width:190px/);
  assert.match(styles, /\.s4-player-card\.has-player-profile \.s4-player-card-grade\{visibility:hidden\}/);
  assert.doesNotMatch(styles, /\.s4-player-card\.(?:legendary-card|x-profile-card) \.s4-player-card-grade/);
});

test("李俊良X级卡绑定自定义头像并移除中央评级圆圈", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const profile = X_PLAYER_PROFILE_BY_PLAYER_ID["ydl-x-player-2"];
  assert.equal(profile.profileKey, "李俊良");
  assert.equal(profile.fileName, "李俊良.png");
  assert.equal(profile.xPercent, 51.1);
  assert.equal(profile.yPercent, 55.4);
  assert.equal(profile.widthPercent, 128);
  assertOptimizedProfileAsset(profile, "x_profile");
  assert.match(appSource, /\$\{playerProfile \? "has-player-profile" : ""\}/);
  assert.match(styles, /\.s4-player-card\.has-player-profile \.s4-player-card-grade\{visibility:hidden\}/);
});

test("黄威、李彬和金典X级卡绑定新增真人卡画", () => {
  const expected = {
    "ydl-x-player-3": { profileKey:"黄威", fileName:"huangwei.png", xPercent:41.9, yPercent:63.9, widthPercent:144 },
    "ydl-x-player-7": { profileKey:"李彬", fileName:"libin.png", xPercent:59.1, yPercent:64.1, widthPercent:128 },
    "ydl-x-player-10": { profileKey:"金典", fileName:"jindian.png", xPercent:53.2, yPercent:44.1, widthPercent:104 },
  };
  Object.entries(expected).forEach(([playerId, values]) => {
    const profile = X_PLAYER_PROFILE_BY_PLAYER_ID[playerId];
    Object.entries(values).forEach(([key, value]) => assert.equal(profile[key], value));
    assertOptimizedProfileAsset(profile, "x_profile");
  });
});

test("刘祖豪X级卡绑定DLC3真人卡画", () => {
  const profile = X_PLAYER_PROFILE_BY_PLAYER_ID["ydl-x-player-9"];
  assert.equal(profile.profileKey, "刘祖豪");
  assert.equal(profile.fileName, "liuzuhao.png");
  assert.equal(profile.xPercent, 47.9);
  assert.equal(profile.yPercent, 56.6);
  assert.equal(profile.widthPercent, 188);
  assertOptimizedProfileAsset(profile, "x_profile");
});

test("全部高能力A级球员均绑定真人卡面且人物位于文字下层", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const entries = Object.values(A_PLAYER_PROFILE_BY_PLAYER_ID);
  const contentOverrides = JSON.parse(readFileSync(new URL("../data/ydl-content-overrides.json", import.meta.url), "utf8")).players;
  const expectedPlayerIds = Object.values(REAL_PLAYER_BY_ID)
    .filter((player) => {
      const patch = contentOverrides[player.id] ?? {};
      const additionalProfilePlayerIds = ["s4-fc26-183898", "s4-fc26-239231", "s4-fc26-246104"];
      return ((patch.grade ?? player.grade) === "A" && Number(patch.overall ?? player.overall) >= 87)
        || additionalProfilePlayerIds.includes(player.id);
    })
    .map((player) => player.id)
    .sort();
  assert.equal(entries.length, expectedPlayerIds.length);
  assert.equal(new Set(entries.map((entry) => entry.fileName)).size, expectedPlayerIds.length);
  assert.deepEqual(Object.keys(A_PLAYER_PROFILE_BY_PLAYER_ID).sort(), expectedPlayerIds);
  for (const entry of entries) {
    assertOptimizedProfileAsset(entry, "A_profile");
    assert.ok(Number.isFinite(entry.xPercent));
    assert.ok(Number.isFinite(entry.yPercent));
    assert.ok(Number.isFinite(entry.widthPercent));
  }
  assert.match(appSource, /const aPlayerProfile = player\.grade === "A" \? aPlayerProfileForPlayer\(player\) : null/);
  assert.match(appSource, /legendaryProfile \?\? aPlayerProfile \?\? xPlayerProfile/);
  assert.match(styles, /\.s4-player-card\.grade-a \.s4-player-card-profile\{z-index:1\}/);
  assert.match(styles, /\.s4-player-card\.has-player-profile \.s4-player-card-grade\{visibility:hidden\}/);
});

test("新版球员卡使用圆润双层边框并让+8卡回归统一细红金外框", () => {
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.s4-player-card\{[^}]*border-radius:29px/);
  assert.match(styles, /\.s4-player-card::before\{[^}]*border-radius:23px/);
  assert.match(styles, /\.s4-player-card\.band-high:not\(\.grade-x\)\{[^}]*#f5cc55/);
  assert.match(styles, /\.s4-player-card\.band-max\{[^}]*#e12438/);
  assert.match(styles, /\.s4-player-card\.band-max:not\(\.grade-x\)\{--stripe-accent:#e62b42;[^}]*linear-gradient\(132deg,#ffe98d 0 7%,#75000b 18%,#e12438 37%,#ffe78a 50%,#650008 59%,#c9182c 79%,#f5cc55\) border-box/);
  assert.doesNotMatch(styles, /\.s4-player-card\.grade-[sab]\.band-max[^}]*border-width:4px/);
  assert.doesNotMatch(styles, /\.s4-player-card\.grade-[sab]\.band-max::before/);
  assert.match(styles, /\.s4-player-card\.grade-x\.band-high\{[^}]*#a6e6e1/);
  assert.match(styles, /\.s4-player-card\.grade-x\.band-max\{[^}]*#ff8fc4/);
  assert.match(styles, /\.s4-player-card::after\{[^}]*opacity:0[^}]*animation:none/);
  assert.match(styles, /\.s4-player-card:hover::after\{[^}]*animation:s4-card-frame-sheen 4\.2s ease-in-out infinite/);
  assert.match(styles, /\.s4-player-card-upgrade\{[^}]*right:6px[^}]*top:6px[^}]*min-width:38px[^}]*height:30px/);
  assert.match(styles, /\.s4-player-card-upgrade\{[^}]*radial-gradient\([^}]*linear-gradient\([^}]*text-shadow:[^}]*0 2px 3px/);
  assert.match(styles, /\.s4-player-card-upgrade\{[^}]*rgba\(248,251,255,\.88\)[^}]*rgba\(185,197,209,\.88\)[^}]*rgba\(120,135,148,\.88\)/);
  assert.match(styles, /\.s4-player-card-upgrade\.band-mid\{[^}]*radial-gradient\([^}]*linear-gradient\([^}]*text-shadow:/);
  assert.match(styles, /\.s4-player-card-upgrade\.band-high\{[^}]*radial-gradient\([^}]*linear-gradient\([^}]*text-shadow:/);
  assert.match(styles, /\.s4-player-card-upgrade\.band-max\{[^}]*radial-gradient\([^}]*linear-gradient\([^}]*text-shadow:/);
  assert.match(styles, /\.s4-player-card-upgrade\.band-(?:mid|high|max)\{[^}]*rgba\([^)]+,\.88\)/);
  assert.match(styles, /\.s4-player-card-upgrade::after\{[^}]*opacity:0[^}]*animation:none/);
  assert.match(styles, /\.s4-player-card:hover \.s4-player-card-upgrade::after\{opacity:1;animation:s4-card-frame-sheen 4\.2s ease-in-out infinite/);
  assert.doesNotMatch(styles, /@keyframes s4-upgrade-badge-sheen/);
  assert.doesNotMatch(styles, /@media\(prefers-reduced-motion:reduce\)\{\.s4-player-card::after/);
  assert.match(styles, /\.s4-player-card\{[^}]*linear-gradient\(132deg,transparent 0 12%,color-mix\(in srgb,var\(--stripe-accent\)/);
  assert.match(styles, /\.s4-player-card\{[^}]*repeating-linear-gradient\(132deg/);
  for (const grade of ["x", "s", "a", "b", "c"]) {
    assert.match(styles, new RegExp(`\\.s4-player-card\\.grade-${grade}\\{[^}]*--stripe-accent:`));
  }
});

test("背包三选一卡包使用独立悬浮选择层且卡牌网格保留间距", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /function openS4PackChoiceDialog\(offer\)/);
  assert.match(appSource, /syncS4PackChoiceDialog\(\)/);
  assert.match(appSource, /overlay\.querySelectorAll\("\[data-s4-pack-choice\]"\)\.forEach\(\(button\) => \{\s*button\.onclick = \(\) => chooseS4PackCard\(button\)/);
  assert.match(appSource, /async function chooseS4PackCard\(button\)/);
  assert.match(appSource, /"s4-pack-choice-dialog",\s*\{ dismissOnBackdrop:false \}/);
  assert.doesNotMatch(appSource, /class="league-panel league-shop backpack-choice"/);
  assert.doesNotMatch(appSource, /data-league-reset/);
  assert.match(styles, /\.s4-pack-choice-overlay\{[^}]*place-items:center/);
  assert.match(styles, /\.s4-pack-choice-stage \.s4-player-card-choice-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[^}]*gap:22px/);
  assert.match(styles, /\.backpack-card-grid\{[^}]*gap:16px 14px/);
  assert.match(styles, /\.enhancement-card-grid\{[^}]*gap:14px 12px/);
  assert.match(styles, /\.s4-market-card-grid\{gap:14px 13px\}/);
});

test("背包球员卡详情复用YOOGLE档案并锁定实际强化等级", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /function overviewPlayerDetailMarkup\(player, \{ upgradeLevel = 0, bondPercent = 0, card = null \} = \{\}\)/);
  assert.match(appSource, /overviewPlayerDetailMarkup\(player, \{ card \}\)/);
  assert.match(appSource, /cardMode \? card\.upgradeLevel : upgradeLevel/);
  assert.match(appSource, /当前26项能力值/);
  assert.match(appSource, /详情已锁定为这张卡的实际强化效果/);
  const previewSource = appSource.slice(appSource.indexOf("function overviewPlayerPreviewValues"), appSource.indexOf("function addLeagueOverviewPlayerComparison"));
  assert.match(previewSource, /Math\.min\(99/);
  assert.doesNotMatch(appSource, /overflowRetention|overflowThreshold/);
  assert.match(appSource, /"overview-player-dialog s4-card-detail-dialog"/);
  const detailSource = appSource.slice(appSource.indexOf("function openS4CardDetail"), appSource.indexOf("function openS4PackResult"));
  assert.doesNotMatch(detailSource, /\bapi\(|renderLeague\(/);
  assert.doesNotMatch(detailSource, /playerDirectory/);
  assert.match(appSource, /overlay\.classList\.add\("s4-card-detail-overlay"\)/);
  assert.match(styles, /\.s4-card-detail-overlay\{display:grid;place-items:center\}/);
  assert.match(styles, /\.overview-player-card-level\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styles, /\.overview-player-ownership\.is-card-asset>section>div\{max-height:none;overflow:visible\}/);
});

test("完整球员目录从联赛主响应拆分并在使用时按需载入", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");

  assert.match(apiSource, /yellowDogsLeague\.view\(account, \{ developer, includePlayerDirectory:false \}\)/);
  assert.match(apiSource, /\/api\/versus\/league\/player-directory/);
  assert.match(serviceSource, /options\.includePlayerDirectory === false \? \{\} : \{ playerDirectory:publicS4PlayerDirectory/);
  assert.match(serviceSource, /playerDirectoryView\(account\)/);
  assert.match(appSource, /async function loadLeaguePlayerDirectory/);
  assert.match(appSource, /previousLeague\?\.playerDirectory/);
  assert.match(appSource, /data-overview-player-search[\s\S]*?loadLeaguePlayerDirectory/);
});

test("赛后双方阵型支持按实际出现的默认领先落后阶段切换", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /function historyStageViews\(detail, teamIndex\)/);
  assert.match(appSource, /opening:"默认站位", leading:"领先站位", trailing:"落后站位"/);
  assert.match(appSource, /disabled title="本场未出现"/);
  assert.match(appSource, /function switchHistoryStage\(button\)/);
  assert.match(appSource, /class="league-position-tabs history-stage-switch"/);
  assert.match(styles, /\.history-stage-switch\.league-position-tabs button:disabled\{[^}]*opacity:\.28/);
  assert.match(styles, /\.history-stage-panel\.active\{display:block\}/);
});

test("全部传奇球员均绑定存在的头像素材和定位参数", () => {
  const entries = Object.values(LEGENDARY_PROFILE_BY_PLAYER_ID);
  const contentOverrides = JSON.parse(readFileSync(new URL("../data/ydl-content-overrides.json", import.meta.url), "utf8")).players;
  const effectiveLegendIds = Object.values(REAL_PLAYER_BY_ID)
    .filter((player) => (contentOverrides[player.id]?.grade ?? player.grade) === "S")
    .map((player) => player.id)
    .sort();
  assert.equal(entries.length, effectiveLegendIds.length);
  assert.equal(new Set(entries.map((entry) => entry.fileName)).size, effectiveLegendIds.length);
  assert.deepEqual(Object.keys(LEGENDARY_PROFILE_BY_PLAYER_ID).sort(), effectiveLegendIds);
  for (const entry of entries) {
    assertOptimizedProfileAsset(entry, "legendary_profile");
    assert.ok(Number.isFinite(entry.xPercent));
    assert.ok(Number.isFinite(entry.yPercent));
    assert.ok(Number.isFinite(entry.widthPercent));
  }
});

test("版本化WebP真人卡面使用一年不可变缓存", () => {
  const serverSource = readFileSync(new URL("../devtool/server.js", import.meta.url), "utf8");
  assert.match(serverSource, /"\.webp": "image\/webp"/);
  assert.match(serverSource, /public, max-age=31536000, immutable/);
});

test("版本化国家和俱乐部徽章使用一年不可变缓存", () => {
  const serverSource = readFileSync(new URL("../devtool/server.js", import.meta.url), "utf8");
  assert.match(serverSource, /isVersionedBadgeAsset/);
  assert.match(serverSource, /country\|club/);
  for (const badge of [...COUNTRY_BADGES, ...CLUB_BADGES]) {
    assert.match(badge.imageUrl, /^\/versus\/assets\/(?:country|club)-badges\/[a-z0-9-]+\.webp\?v=[a-f0-9]{12}$/);
    assert.ok(existsSync(new URL(`../versus/public${badge.imageUrl.split("?")[0].slice("/versus".length)}`, import.meta.url)), badge.imageUrl);
  }
});

test("联赛AI球队固定佩戴系统专属徽章", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../devtool/server.js", import.meta.url), "utf8");
  const badgeUrl = appSource.match(/imageUrl:"(\/versus\/assets\/system-badges\/ai-team-badge\.png\?v=[a-f0-9]{12})"/)?.[1];

  assert.ok(badgeUrl);
  assert.ok(existsSync(new URL(`../versus/public${badgeUrl.split("?")[0].slice("/versus".length)}`, import.meta.url)));

  assert.match(appSource, /if \(team\?\.isAi\) \{\s*return `<img class="team-cosmetic-badge team-ai-badge/);
  assert.match(appSource, /AI球队专属徽章 · 永久佩戴/);
  assert.doesNotMatch(appSource, /team\.isAi \? `<span class="club-type">AI<\/span>`/);
  assert.match(styles, /\.team-ai-badge\{[^}]*linear-gradient\(145deg,#f5f7f6/);
  assert.match(serverSource, /system-badges\\\/ai-team-badge/);
});

test("商店桌面端使用四列并区分两类徽章包视觉", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /shop:"商店"/);
  assert.match(appSource, /data-league-tab="shop">商店<\/button>/);
  assert.ok(appSource.includes('tone === "country-badge" ? "NAT"'));
  assert.ok(appSource.includes('tone === "club-badge" ? "CLB"'));
  assert.match(styles, /league-pack-product-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /s4-pack-visual\.tone-country-badge/);
  assert.match(styles, /s4-pack-visual\.tone-club-badge/);
});

test("徽章包背包入口支持批量数量、连续选择进度和统一结果", () => {
  const serviceSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(serviceSource, /徽章包需要逐份开启/);
  assert.doesNotMatch(serviceSource, /徽章包暂不支持批量开启/);
  assert.match(serviceSource, /mode:"cosmetic-choice", complete:false/);
  assert.match(serviceSource, /batch\.results\.push\(\{ mode:"cosmetic-choice"/);
  assert.match(appSource, /batchHint = pack\.kind === "cosmetic"/);
  assert.match(appSource, /第 \$\{offer\.batchIndex\}\/\$\{offer\.batchTotal\} 份/);
  assert.match(appSource, /batch\.mode === "cosmetic-choice"/);
  assert.match(styles, /cosmetic-batch-results\{/);
});

test("交易市场增加徽章道具市场且积分榜隐藏玩家昵称", () => {
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(apiSource, /market\/list-cosmetic/);
  assert.match(appSource, /data-market-section="cosmetic"/);
  assert.match(appSource, /function leagueCosmeticMarketMarkup\(\)/);
  assert.match(appSource, /data-market-list-kind="cosmetic"/);
  assert.match(appSource, /const owner = badges \? `<small class="league-team-honors">\$\{badges\}<\/small>` : ""/);
  assert.doesNotMatch(appSource, /const owner = team\.ownerName \? `<small>\$\{escapeHtml\(team\.ownerName\)\}\$\{badges\}<\/small>`/);
  assert.match(styles, /market-entry-four>div\{[^}]*grid-template-columns:repeat\(4/);
  assert.match(styles, /cosmetic-market-visual\.category-club/);
});

test("梅老鼠除独立身份外完整复制梅西的球员信息", () => {
  const messi = REAL_PLAYER_BY_ID["legend-messi"];
  const messiRat = REAL_PLAYER_BY_ID["legend-messi-rat"];
  assert.equal(messiRat.name, "梅老鼠");
  assert.equal(messiRat.grade, "S");
  assert.equal(messiRat.legendary, true);
  const identityKeys = new Set(["id", "name", "sourceName", "sourceId", "cardFamilyId"]);
  const comparable = (player) => Object.fromEntries(Object.entries(player).filter(([key]) => !identityKeys.has(key)));
  assert.deepEqual(comparable(messiRat), comparable(messi));
  assert.equal(LEGENDARY_PROFILE_BY_PLAYER_ID[messiRat.id].profileKey, "MessiRat");
  assert.equal(LEGENDARY_PROFILE_BY_PLAYER_ID[messiRat.id].fileName, "MessiRat.png");
});

test("S4全部非X球员26项能力回归游戏卡面OVR", () => {
  const standardPlayers = REAL_PLAYERS.filter((player) => !isXPlayer(player));
  assert.ok(standardPlayers.length > 0);
  for (const player of standardPlayers) {
    assert.ok(player.overall <= S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, `${player.name} OVR超过默认上限`);
    assert.equal(ATTRIBUTE_NAMES.length, 26);
    for (const key of ATTRIBUTE_NAMES) {
      assert.ok(Number(player.attributes[key]) <= S4_PLAYER_DEFAULT_ATTRIBUTE_CAP, `${player.name} ${key}超过默认上限`);
      assert.equal(player.referenceAttributes[key], player.attributes[key], `${player.name} ${key}参考值未同步`);
    }
    assert.equal(playerOverallFromAttributes(player.attributes, player.role), player.overall, `${player.name}未按26项算法回归OVR`);
  }
});

test("游戏OVR与EA参考OVR差值先作用于全部26项再收敛位置核心能力", () => {
  const source = Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, 50]));
  const attributes = normalizedGameAttributes(source, "ST", 80, 70);
  const coreKeys = new Set(PLAYER_OVERALL_ATTRIBUTE_KEYS.ATT);
  for (const key of ATTRIBUTE_NAMES.filter((candidate) => !coreKeys.has(candidate))) {
    assert.equal(attributes[key], 60, key);
  }
  assert.equal(playerOverallFromAttributes(attributes, "ST"), 80);
});

function join(service, user) {
  service.beginDraft(user, `${user.id}-team`);
  service.autoDraft(user);
  service.finishDraft(user);
  return service.accountTeam(user.id);
}

function nonLegendBench(service, user) {
  const team = service.accountTeam(user.id);
  return team.rosterIds.find((playerId) => !team.preferredStarterIds.includes(playerId) && REAL_PLAYER_BY_ID[playerId].grade !== "S");
}

test("S4新赛季选秀为每名球员创建独立卡，并为非传奇建立有锚点卡的所有权", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("s4-owner");
  const team = join(service, user);
  const assets = service.view(user).ownTeam.s4Assets;
  const publicRoster = service.view(user).ownTeam.roster;

  assert.equal(assets.cards.length, 23);
  assert.equal(assets.rosterSlotsUsed, 22);
  assert.equal(new Set(assets.cards.map((card) => card.id)).size, 23);
  assert.ok(team.rosterIds.every((playerId) => REAL_PLAYER_BY_ID[playerId].grade === "S" || ownershipOwner(service.state, playerId) === user.id));
  assert.ok(publicRoster.every((player) => !("legendAbility" in player) && !("signature" in player)));
  assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
});

test("球员卡公开数据包含可直接展示的特性名称和说明", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("s4-trait-card-owner");
  join(service, user);
  const playerId = nonLegendBench(service, user);
  const card = service.representativeCard(user.id, playerId);
  const trait = VERSUS_TRAIT_CARDS[0];
  card.traitIds = [trait.id];

  const publicCard = service.view(user).ownTeam.roster.find((player) => player.id === playerId).cards.find((entry) => entry.id === card.id);
  assert.deepEqual(publicCard.traits, [{ id:trait.id, name:trait.name, summary:trait.summary }]);
});

test("球员信息目录公开所有权、持卡玩家和逐卡强化排名", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const firstUser = account("directory-first");
  const secondUser = account("directory-second");
  const firstTeam = join(service, firstUser);
  join(service, secondUser);
  const playerId = nonLegendBench(service, firstUser);
  const enhanced = service.grantS4Card(firstTeam, playerId, { grantOwnership:false, upgradeLevel:7, acquisitionSource:"repeat-pack" });

  const directory = service.view(firstUser).playerDirectory;
  const player = directory.players.find((entry) => entry.id === playerId);
  const rankedCard = directory.enhancementRanking.find((entry) => entry.cardId === enhanced.id);

  assert.equal(player.ownership.ownerName, firstUser.nickname);
  assert.equal(player.holders.find((holder) => holder.ownerId === firstUser.id).cardCount, 2);
  assert.equal(player.highestUpgradeLevel, 7);
  assert.equal(Object.keys(player.attributes).length, 26);
  assert.equal(player.heightCm, REAL_PLAYER_BY_ID[playerId].heightCm);
  assert.equal(player.preferredFoot, REAL_PLAYER_BY_ID[playerId].preferredFoot);
  assert.equal(rankedCard.upgradeLevel, 7);
  assert.equal(rankedCard.ownerName, firstUser.nickname);
  assert.ok(directory.players.length > firstTeam.rosterIds.length);
});

test("持有所有权的最后一张卡不能静默解约，确认后卡片与所有权同步回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("last-card-owner");
  join(service, user);
  const playerId = nonLegendBench(service, user);
  const card = service.representativeCard(user.id, playerId);

  assert.throws(() => service.releaseCard(user, card.id, false), /最后一张卡/);
  service.releaseCard(user, card.id, true);
  assert.equal(service.playerCards(user.id, playerId).length, 0);
  assert.equal(ownershipOwner(service.state, playerId), null);
  assert.ok(!service.accountTeam(user.id).rosterIds.includes(playerId));
});

test("+6单卡可以系统回收，+7及以上单卡不能回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("protected-card-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const recyclable = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:6, acquisitionSource:"repeat-pack" });
  const protectedCard = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:7, acquisitionSource:"repeat-pack" });

  service.releaseCard(user, recyclable.id, false);
  assert.equal(service.state.s4Assets.cards[recyclable.id].status, "recycled");
  assert.throws(() => service.releaseCard(user, protectedCard.id, false), /\+7及以上/);
  assert.equal(service.state.s4Assets.cards[protectedCard.id].status, "active");
  assert.match(readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8"), /\+7及以上不可回收/);
});

test("球员卡管理公开单卡回收资格和所有权回收明细", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("recovery-preview-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const extra = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:6, acquisitionSource:"repeat-pack" });

  const player = service.view(user).ownTeam.roster.find((entry) => entry.id === playerId);
  const base = player.cards.find((card) => card.upgradeLevel === 0);
  const enhanced = player.cards.find((card) => card.id === extra.id);

  assert.equal(base.systemRecyclable, true);
  assert.ok(base.systemRecoveryValue > 0);
  assert.equal(enhanced.systemRecyclable, true);
  assert.deepEqual(player.ownershipReturnPreview.retainedCardIds, [extra.id]);
  assert.equal(player.ownershipReturnPreview.recoveredCardCount, 1);
  assert.equal(player.ownershipReturnPreview.totalAmount, player.ownershipReturnPreview.recoveryAmount + player.ownershipReturnPreview.ownershipAmount);
});

test("批量单卡回收一次结算多张卡并保留球员所有权", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("batch-recovery-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const first = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:0, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:1, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(user.id).balance;

  const result = service.releaseCards(user, [first.id, second.id]);

  assert.equal(result.cardRecoveryResult.cardCount, 2);
  assert.ok(result.cardRecoveryResult.amount > 0);
  assert.equal(service.wallet(user.id).balance, balanceBefore + result.cardRecoveryResult.amount);
  assert.equal(service.state.s4Assets.cards[first.id].status, "recycled");
  assert.equal(service.state.s4Assets.cards[second.id].status, "recycled");
  assert.equal(ownershipOwner(service.state, playerId), user.id);
});

test("批量单卡回收包含高强化卡时整批拒绝且不改变资产", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("atomic-recovery-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const valid = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:6, acquisitionSource:"repeat-pack" });
  const invalid = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:7, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(user.id).balance;

  assert.throws(() => service.releaseCards(user, [valid.id, invalid.id]), /\+7及以上/);
  assert.equal(service.state.s4Assets.cards[valid.id].status, "active");
  assert.equal(service.state.s4Assets.cards[invalid.id].status, "active");
  assert.equal(service.wallet(user.id).balance, balanceBefore);
});

test("玩家卡片交易发起时托管金币，接受后交换卡片并结算金币", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-offer-sender");
  const receiver = account("trade-offer-receiver");
  const observer = account("trade-offer-observer");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  join(service, observer);
  const senderPlayerId = nonLegendBench(service, sender);
  const receiverPlayerId = nonLegendBench(service, receiver);
  const offered = service.grantS4Card(senderTeam, senderPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const material = service.grantS4Card(senderTeam, senderPlayerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, receiverPlayerId, { grantOwnership:false, upgradeLevel:6, acquisitionSource:"repeat-pack" });
  offered.traitIds = [VERSUS_TRAIT_CARDS[0].id];
  const senderBalance = service.wallet(sender.id).balance;
  const receiverBalance = service.wallet(receiver.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 1200);
  const pending = service.state.cardTradeOffers.find((offer) => offer.fromOwnerId === sender.id && offer.status === "pending");

  assert.equal(service.wallet(sender.id).balance, senderBalance - 1200);
  assert.throws(() => service.enhanceS4Card(sender, offered.id, material.id), /交易报价/);
  const receiverView = service.view(receiver);
  const tradeMail = receiverView.inbox.find((message) => message.type === "trade-offer" && message.payload.tradeOfferId === pending.id);
  assert.ok(tradeMail);
  assert.equal(tradeMail.payload.tradeOffer.offeredCards[0].player.overall, REAL_PLAYER_BY_ID[senderPlayerId].overall);
  assert.equal(tradeMail.payload.tradeOffer.offeredCards[0].player.grade, REAL_PLAYER_BY_ID[senderPlayerId].grade);
  assert.equal(tradeMail.payload.tradeOffer.offeredCards[0].card.traits[0].name, VERSUS_TRAIT_CARDS[0].name);
  assert.equal(tradeMail.payload.tradeOffer.requestedCards[0].card.upgradeLevel, 6);
  const cleanedInbox = service.deleteInboxBatch(receiver, "all");
  assert.ok(cleanedInbox.inbox.some((message) => message.id === tradeMail.id));

  service.resolveCardTradeOffer(receiver, pending.id, "accept");

  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, receiver.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, sender.id);
  assert.equal(service.wallet(receiver.id).balance, receiverBalance + 1200);
  assert.equal(pending.status, "accepted");
  const senderResultMail = service.view(sender).inbox.find((message) => message.id === `card-trade-accepted:${pending.id}`);
  const receiverResultMail = service.view(receiver).inbox.find((message) => message.id === `card-trade-accepted:${pending.id}:receiver`);
  assert.equal(senderResultMail.type, "trade-result");
  assert.equal(receiverResultMail.type, "trade-result");
  assert.equal(senderResultMail.payload.tradeOffer.offeredCards[0].card.upgradeLevel, 5);
  assert.equal(receiverResultMail.payload.tradeOffer.requestedCards[0].card.upgradeLevel, 6);
  const publicMail = service.view(observer).inbox.find((message) => message.type === "trade-public" && message.payload.tradeOfferId === pending.id);
  assert.ok(publicMail);
  assert.equal(publicMail.payload.tradeOffer.offeredCards[0].card.upgradeLevel, 5);
  assert.equal(publicMail.payload.tradeOffer.offeredCards[0].card.traits[0].name, VERSUS_TRAIT_CARDS[0].name);
  assert.equal(publicMail.payload.tradeOffer.requestedCards[0].card.upgradeLevel, 6);
  assert.equal(service.view(sender).inbox.some((message) => message.type === "trade-public" && message.payload.tradeOfferId === pending.id), false);
  assert.equal(service.view(receiver).inbox.some((message) => message.type === "trade-public" && message.payload.tradeOfferId === pending.id), false);
});

test("双方最高仅+4的玩家交易不会发送重要转会公示", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("ordinary-trade-sender");
  const receiver = account("ordinary-trade-receiver");
  const observer = account("ordinary-trade-observer");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  join(service, observer);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 0);
  const offer = service.state.cardTradeOffers.at(-1);
  service.resolveCardTradeOffer(receiver, offer.id, "accept");

  assert.equal(offer.status, "accepted");
  assert.equal(service.view(observer).inbox.some((message) => message.type === "trade-public"), false);
});

test("拒绝玩家卡片交易会退款并保留双方资产", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-reject-sender");
  const receiver = account("trade-reject-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 900);
  const offer = service.state.cardTradeOffers.at(-1);
  service.resolveCardTradeOffer(receiver, offer.id, "reject");

  assert.equal(service.wallet(sender.id).balance, balanceBefore);
  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, sender.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
  assert.equal(offer.status, "rejected");
});

test("发起方撤回玩家卡片交易会退款并通知接收方", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-withdraw-sender");
  const receiver = account("trade-withdraw-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 700);
  const offer = service.state.cardTradeOffers.at(-1);
  service.withdrawCardTradeOffer(sender, offer.id);

  assert.equal(service.wallet(sender.id).balance, balanceBefore);
  assert.equal(offer.status, "withdrawn");
  assert.ok(service.view(receiver).inbox.some((message) => message.id === `card-trade-withdrawn:${offer.id}`));
});

test("报价只锁定发起方卡片，接收方资产变化后接受会失败并退款", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-late-check-sender");
  const receiver = account("trade-late-check-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const senderBalance = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 600);
  const offer = service.state.cardTradeOffers.at(-1);

  assert.throws(() => service.listCard(sender, offered.id, 5000), /交易报价/);
  assert.doesNotThrow(() => service.listCard(receiver, requested.id, service.view(receiver).ownTeam.roster.find((player) => player.id === requested.playerId).cards.find((card) => card.id === requested.id).minimumListingPrice));
  service.resolveCardTradeOffer(receiver, offer.id, "accept");

  assert.equal(offer.status, "failed");
  assert.match(offer.failureReason, /挂牌/);
  assert.equal(service.wallet(sender.id).balance, senderBalance);
  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, sender.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
  assert.ok(service.state.listings.some((listing) => listing.cardId === requested.id && listing.status === "active"));
  assert.ok(service.view(sender).inbox.some((message) => message.id === `card-trade-failed:${offer.id}:sender`));
});

test("接收方所有权变化不会被报价阻止，但接受时交易失败并退款", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-rights-sender");
  const receiver = account("trade-rights-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const receiverPlayerId = nonLegendBench(service, receiver);
  const requested = service.grantS4Card(receiverTeam, receiverPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const senderBalance = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 800);
  const offer = service.state.cardTradeOffers.at(-1);

  assert.doesNotThrow(() => service.returnOwnership(receiver, receiverPlayerId));
  assert.equal(service.state.s4Assets.cards[requested.id].status, "active");
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
  service.resolveCardTradeOffer(receiver, offer.id, "accept");

  assert.equal(offer.status, "failed");
  assert.match(offer.failureReason, /所有权状态/);
  assert.equal(service.wallet(sender.id).balance, senderBalance);
  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, sender.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
});

test("已挂牌单卡及所有权挂牌球员不能加入交易报价", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-listed-sender");
  const receiver = account("trade-listed-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const senderPlayerId = nonLegendBench(service, sender);
  const receiverPlayerId = nonLegendBench(service, receiver);
  const offered = service.grantS4Card(senderTeam, senderPlayerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, receiverPlayerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  service.listCard(sender, offered.id, service.view(sender).ownTeam.roster.find((player) => player.id === offered.playerId).cards.find((card) => card.id === offered.id).minimumListingPrice);
  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 0), /挂牌/);
  service.cancelListing(sender, service.state.listings.find((listing) => listing.cardId === offered.id && listing.status === "active").id);
  service.listOwnership(receiver, receiverPlayerId, 5000);
  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 0), /挂牌/);
});

test("接收方卡可被多个报价索取，但其作为发起方资产锁定后不能成为新交易对象", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("multi-request-first");
  const second = account("multi-request-second");
  const target = account("multi-request-target");
  const firstTeam = join(service, first);
  const secondTeam = join(service, second);
  const targetTeam = join(service, target);
  const firstCard = service.grantS4Card(firstTeam, nonLegendBench(service, first), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const firstRequestedCard = service.grantS4Card(firstTeam, nonLegendBench(service, first), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const secondCard = service.grantS4Card(secondTeam, nonLegendBench(service, second), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const secondExtraCard = service.grantS4Card(secondTeam, nonLegendBench(service, second), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const targetCard = service.grantS4Card(targetTeam, nonLegendBench(service, target), { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const targetOfferCard = service.grantS4Card(targetTeam, nonLegendBench(service, target), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  assert.doesNotThrow(() => service.createCardTradeOffer(first, target.id, [firstCard.id], [targetCard.id], 0));
  assert.doesNotThrow(() => service.createCardTradeOffer(second, target.id, [secondCard.id], [targetCard.id], 0));
  service.createCardTradeOffer(target, first.id, [targetOfferCard.id], [firstRequestedCard.id], 0);

  assert.throws(() => service.createCardTradeOffer(second, target.id, [secondExtraCard.id], [targetOfferCard.id], 0), /其他交易/);
});

test("同一张接收方卡的多个报价中一笔成交后，其余报价立即失败退款并解锁发起方卡片", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("settle-first");
  const second = account("settle-second");
  const target = account("settle-target");
  const firstTeam = join(service, first);
  const secondTeam = join(service, second);
  const targetTeam = join(service, target);
  const firstCard = service.grantS4Card(firstTeam, nonLegendBench(service, first), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const secondCard = service.grantS4Card(secondTeam, nonLegendBench(service, second), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(targetTeam, nonLegendBench(service, target), { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const secondBalance = service.wallet(second.id).balance;

  service.createCardTradeOffer(first, target.id, [firstCard.id], [requested.id], 100);
  const accepted = service.state.cardTradeOffers.at(-1);
  service.createCardTradeOffer(second, target.id, [secondCard.id], [requested.id], 700);
  const superseded = service.state.cardTradeOffers.at(-1);

  service.resolveCardTradeOffer(target, accepted.id, "accept");

  assert.equal(accepted.status, "accepted");
  assert.equal(superseded.status, "failed");
  assert.match(superseded.failureReason, /另一笔交易/);
  assert.equal(service.wallet(second.id).balance, secondBalance);
  assert.equal(service.cardLockedByTrade(secondCard.id), false);
  assert.ok(service.view(second).inbox.some((message) => message.id === `card-trade-failed:${superseded.id}:sender`));
});

test("交易报价不能取走所有权持有人的最后一张锚点卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-anchor-sender");
  const receiver = account("trade-anchor-receiver");
  join(service, sender);
  const receiverTeam = join(service, receiver);
  const senderPlayerId = nonLegendBench(service, sender);
  const receiverCard = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const anchor = service.representativeCard(sender.id, senderPlayerId);
  anchor.upgradeLevel = 3;

  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [anchor.id], [receiverCard.id], 0), /锚点卡/);
  assert.equal(service.state.cardTradeOffers.length, 0);
});

test("交易附带金币必须非负且不能超过发起方余额", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-coins-sender");
  const receiver = account("trade-coins-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(sender.id).balance;

  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], -1), /大于等于0/);
  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], balanceBefore + 1), /金币不足/);
  assert.equal(service.wallet(sender.id).balance, balanceBefore);
  assert.equal(service.state.cardTradeOffers.length, 0);
});

test("非传奇+0卡不能进入单卡市场", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("last-card-seller");
  join(service, seller);
  const playerId = nonLegendBench(service, seller);
  const card = service.representativeCard(seller.id, playerId);

  assert.throws(() => service.listCard(seller, card.id, 5000), /传奇卡或强化卡/);
  assert.equal(card.status, "active");
});

test("传奇+0卡和非传奇强化卡可以进入单卡市场", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("eligible-card-seller");
  const team = join(service, seller);
  const playerId = nonLegendBench(service, seller);
  const enhanced = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:1, acquisitionSource:"repeat-pack" });
  const legendId = team.rosterIds.find((id) => REAL_PLAYER_BY_ID[id].grade === "S");
  const legend = service.representativeCard(seller.id, legendId);

  assert.ok(service.listCard(seller, enhanced.id, 5000).listings.some((entry) => entry.cardId === enhanced.id));
  service.cancelListing(seller, service.state.listings.find((entry) => entry.cardId === enhanced.id).id);
  assert.ok(service.listCard(seller, legend.id, 5000).listings.some((entry) => entry.cardId === legend.id));
});

test("强化卡参考价值和最低挂牌价随等级增长", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("enhanced-card-valuation");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const low = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:1, acquisitionSource:"repeat-pack" });
  const high = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const player = service.view(user).ownTeam.roster.find((entry) => entry.id === playerId);
  const lowView = player.cards.find((card) => card.id === low.id);
  const highView = player.cards.find((card) => card.id === high.id);

  assert.ok(highView.referenceValue > lowView.referenceValue);
  assert.ok(highView.minimumListingPrice > lowView.minimumListingPrice);
  assert.throws(() => service.listCard(user, high.id, lowView.minimumListingPrice), /卡片参考价值/);
  assert.doesNotThrow(() => service.listCard(user, high.id, highView.minimumListingPrice));
});

test("同名强化卡可以逐张独立挂牌，所有权挂牌仍锁定全部同名资产", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("multi-card-listing-seller");
  const team = join(service, seller);
  const playerId = nonLegendBench(service, seller);
  const first = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:8, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:7, acquisitionSource:"repeat-pack" });

  const firstMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === first.id).minimumListingPrice;
  const secondMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === second.id).minimumListingPrice;
  service.listCard(seller, first.id, firstMinimum);
  const view = service.listCard(seller, second.id, secondMinimum);

  assert.equal(view.listings.filter((entry) => entry.sellerId === seller.id && entry.playerId === playerId && entry.kind === "card").length, 2);
  assert.throws(() => service.listCard(seller, first.id, firstMinimum), /已经挂牌/);
  assert.throws(() => service.listOwnership(seller, playerId, 10000), /撤回.*挂牌/);
});

test("出售唯一一张+5单卡时卡片与所有权同步转移", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("single-plus-five-seller");
  const buyer = account("single-plus-five-buyer");
  join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const card = service.representativeCard(seller.id, playerId);
  card.upgradeLevel = 5;
  service.wallet(buyer.id).balance = 100000;

  const cardMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((entry) => entry.id === card.id).minimumListingPrice;
  const listing = service.listCard(seller, card.id, cardMinimum).listings.find((entry) => entry.cardId === card.id);
  assert.equal(listing.includesOwnership, true);
  service.buyListing(buyer, listing.id);

  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  assert.equal(service.playerCards(seller.id, playerId).length, 0);
  assert.equal(service.playerCards(buyer.id, playerId)[0].id, card.id);
  const buyerMail = service.view(buyer).inbox.find((message) => message.id === `transfer-buy:${listing.id}`);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(buyerMail.summary, /\+5单卡及所有权/);
  assert.match(buyerMail.body, /私有池归属已同步转移/);
  assert.equal(buyerMail.payload.transferredCardLevel, 5);
  assert.match(sellerMail.body, /最后一张.*卡片与所有权一并转移/);
  assert.equal(sellerMail.payload.totalSellerIncome, Math.floor(cardMinimum * .95));
});

test("单卡市场商品信息标记实际会同步转移的所有权", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");
  const listingSource = appSource.slice(appSource.indexOf("function marketListingCard"), appSource.indexOf("function leagueCardTradeMarkup"));

  assert.match(listingSource, /item\.includesOwnership \? " · 附带所有权" : ""/);
  assert.match(serviceSource, /const includesOwnership = listing\.kind === "card"[\s\S]*?ownershipOwner\(this\.state, listing\.playerId\) === listing\.sellerId[\s\S]*?assetStats\.cardCount === 1/);
});

test("市场实时所有权核对按卖家和球员复用持卡统计", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("listing-index");
  const team = join(service, seller);
  const playerId = nonLegendBench(service, seller);
  const first = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:8, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:7, acquisitionSource:"repeat-pack" });
  const rosterPlayer = service.view(seller).ownTeam.roster.find((player) => player.id === playerId);
  service.listCard(seller, first.id, rosterPlayer.cards.find((card) => card.id === first.id).minimumListingPrice);
  service.listCard(seller, second.id, rosterPlayer.cards.find((card) => card.id === second.id).minimumListingPrice);

  const playerCards = service.playerCards.bind(service);
  let playerCardQueries = 0;
  service.playerCards = (...args) => {
    playerCardQueries += 1;
    return playerCards(...args);
  };
  const listings = service.activeListingsView();

  assert.equal(listings.length, 2);
  assert.equal(playerCardQueries, 1);
  assert.ok(listings.every((listing) => listing.includesOwnership === false));
});

test("市场获得的+5以上单卡在买家没有所有权时不占33人大名单额度", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("enhanced-card-seller");
  const buyer = account("enhanced-card-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const enhanced = service.grantS4Card(sellerTeam, playerId, {
    grantOwnership:false,
    upgradeLevel:5,
    acquisitionSource:"repeat-pack",
  });
  const slotsBefore = service.rosterSlotsUsed(buyer.id);
  service.wallet(buyer.id).balance = 100000;

  const enhancedMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === enhanced.id).minimumListingPrice;
  const listing = service.listCard(seller, enhanced.id, enhancedMinimum).listings.find((entry) => entry.cardId === enhanced.id);
  service.buyListing(buyer, listing.id);
  const transferred = service.state.s4Assets.cards[enhanced.id];

  assert.equal(ownershipOwner(service.state, playerId), seller.id);
  assert.equal(transferred.ownerId, buyer.id);
  assert.equal(transferred.upgradeLevel, 5);
  assert.equal(service.view(buyer).ownTeam.roster.find((player) => player.id === playerId).cards[0].rosterExempt, true);
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore);
});

test("通过市场购买的任意等级传奇卡不占33人大名单额度", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("legend-card-seller");
  const buyer = account("legend-card-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const legendId = "legend-pele";
  const legendCard = service.grantS4Card(sellerTeam, legendId, {
    grantOwnership:false,
    upgradeLevel:0,
    acquisitionSource:"legend-market-test",
  });
  const slotsBefore = service.rosterSlotsUsed(buyer.id);
  const publicCard = service.view(seller).ownTeam.roster.find((player) => player.id === legendId).cards.find((card) => card.id === legendCard.id);
  service.wallet(buyer.id).balance = Math.max(100000, publicCard.minimumListingPrice);
  const listing = service.listCard(seller, legendCard.id, publicCard.minimumListingPrice).listings.find((entry) => entry.cardId === legendCard.id);

  service.buyListing(buyer, listing.id);

  const received = service.view(buyer).ownTeam.roster.find((player) => player.id === legendId).cards.find((card) => card.id === legendCard.id);
  assert.equal(received.rosterExempt, true);
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore);
});

test("无所有权的外部+3单卡占一个名单名额，同名多卡不重复占位", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const owner = account("external-plus-three-owner");
  const buyer = account("external-plus-three-buyer");
  const ownerTeam = join(service, owner);
  const buyerTeam = join(service, buyer);
  const playerId = nonLegendBench(service, owner);
  const first = service.grantS4Card(ownerTeam, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(ownerTeam, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const slotsBefore = service.rosterSlotsUsed(buyer.id);

  service.grantS4Card(buyerTeam, playerId, { grantOwnership:false, externalAcquisition:true, upgradeLevel:3, acquisitionSource:"test-external" });
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore + 1);
  service.grantS4Card(buyerTeam, playerId, { grantOwnership:false, externalAcquisition:true, upgradeLevel:3, acquisitionSource:"test-external" });
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore + 1);
  assert.equal(service.state.s4Assets.cards[first.id].ownerId, owner.id);
  assert.equal(service.state.s4Assets.cards[second.id].ownerId, owner.id);
});

test("玩家直接交易获得的+5以上单卡同样不占名单额度", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("direct-card-seller");
  const buyer = account("direct-card-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const enhanced = service.grantS4Card(sellerTeam, playerId, {
    grantOwnership:false,
    upgradeLevel:5,
    acquisitionSource:"repeat-pack",
  });
  const slotsBefore = service.rosterSlotsUsed(buyer.id);
  service.wallet(buyer.id).balance = 100000;

  const enhancedMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === enhanced.id).minimumListingPrice;
  service.wallet(buyer.id).balance = Math.max(service.wallet(buyer.id).balance, enhancedMinimum);
  service.directTradeCard(seller, buyer, enhanced.id, enhancedMinimum);

  const transferred = service.state.s4Assets.cards[enhanced.id];
  assert.equal(transferred.acquisitionSource, "direct-trade");
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore);
  assert.equal(service.view(buyer).ownTeam.roster.find((player) => player.id === playerId).cards[0].rosterExempt, true);
});

test("所有权出售保留卖家全部并列最高卡、给无卡买家系统基础锚点卡并回收低级卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("rights-seller");
  const buyer = account("rights-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const original = service.representativeCard(seller.id, playerId);
  const highestCards = Array.from({ length:3 }, () => service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" }));
  const middleCards = Array.from({ length:4 }, () => service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" }));
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  assert.equal(listing.retainedCardCount, 3);
  service.buyListing(buyer, listing.id);

  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  assert.deepEqual(service.playerCards(seller.id, playerId).map((card) => card.id).sort(), highestCards.map((card) => card.id).sort());
  const buyerCards = service.playerCards(buyer.id, playerId);
  assert.equal(buyerCards.length, 1);
  assert.equal(buyerCards[0].upgradeLevel, 0);
  assert.equal(buyerCards[0].acquisitionSource, "market-ownership-anchor");
  middleCards.forEach((card) => assert.equal(service.state.s4Assets.cards[card.id].status, "recycled"));
  assert.equal(service.state.s4Assets.cards[original.id].status, "recycled");
  assert.ok(service.state.listings.find((entry) => entry.id === listing.id).recoveryAmount > 0);
  const buyerMail = service.view(buyer).inbox.find((message) => message.id === `transfer-buy:${listing.id}`);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(buyerMail.body, /系统已向你发放一张\+0/);
  assert.equal(buyerMail.payload.buyerReceivedSystemAnchor, true);
  assert.match(sellerMail.body, /保留了3张最高等级\+5/);
  assert.match(sellerMail.body, /其余5张低等级卡已由系统回收/);
  assert.equal(sellerMail.payload.recoveredCardCount, 5);
  assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
});

test("所有权出售只有一张+5卡时允许零回收并让卖家免名单占位", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("zero-rights-seller");
  const buyer = account("zero-rights-buyer");
  join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const retained = service.representativeCard(seller.id, playerId);
  retained.upgradeLevel = 5;
  const slotsBefore = service.rosterSlotsUsed(seller.id);
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  service.buyListing(buyer, listing.id);
  const sold = service.state.listings.find((entry) => entry.id === listing.id);

  assert.equal(sold.recoveryAmount, 0);
  assert.deepEqual(sold.recoveredCardIds, []);
  assert.equal(service.playerCards(seller.id, playerId)[0].id, retained.id);
  assert.equal(service.rosterSlotsUsed(seller.id), slotsBefore - 1);
  assert.equal(service.view(seller).ownTeam.roster.find((player) => player.id === playerId).rosterSlotUsed, false);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(sellerMail.summary, /实际到账8550金币/);
  assert.match(sellerMail.body, /没有低等级卡需要回收，回收补偿为0金币/);
  assert.match(sellerMail.body, /当前不占用33人大名单名额/);
  assert.equal(sellerMail.payload.recoveryAmount, 0);
});

test("所有权出售只有+0基础卡时不保留卖家锚点卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("base-rights-seller");
  const buyer = account("base-rights-buyer");
  join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const baseCard = service.representativeCard(seller.id, playerId);
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  assert.equal(listing.retainedUpgradeLevel, null);
  assert.equal(listing.retainedCardCount, 0);
  service.buyListing(buyer, listing.id);

  assert.equal(service.state.s4Assets.cards[baseCard.id].status, "recycled");
  assert.equal(service.playerCards(seller.id, playerId).length, 0);
  assert.equal(service.playerCards(buyer.id, playerId).length, 1);
  assert.equal(service.playerCards(buyer.id, playerId)[0].upgradeLevel, 0);
  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(sellerMail.body, /没有强化过.*原有1张\+0基础锚点卡已由系统回收/);
  assert.equal(sellerMail.payload.retainedCardCount, 0);
});

test("失去所有权的+5卡降为+4后动态恢复名单占位", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 1 });
  const seller = account("downgrade-slot-seller");
  const buyer = account("downgrade-slot-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const main = service.representativeCard(seller.id, playerId);
  main.upgradeLevel = 5;
  const material = service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  service.wallet(buyer.id).balance = 100000;
  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  service.buyListing(buyer, listing.id);
  const exemptSlots = service.rosterSlotsUsed(seller.id);

  const result = service.enhanceS4Card(seller, main.id, material.id, false);

  assert.equal(result.enhancementResult.success, false);
  assert.equal(result.enhancementResult.afterLevel, 4);
  assert.equal(service.rosterSlotsUsed(seller.id), exemptSlots + 1);
  assert.equal(service.view(seller).ownTeam.roster.find((player) => player.id === playerId).rosterSlotUsed, true);
});

test("强化记录保存主副卡、道具价格、概率与结果且仅本人可见", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("enhancement-history-owner");
  const other = account("enhancement-history-other");
  const team = join(service, user);
  join(service, other);
  const playerId = nonLegendBench(service, user);
  const main = service.representativeCard(user.id, playerId);
  main.upgradeLevel = 5;
  const material = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"history-test" });

  const result = service.enhanceS4Card(user, main.id, material.id, true, { compact:true });
  const record = result.enhancementHistory[0];

  assert.equal(record.mainPlayer.id, playerId);
  assert.equal(record.mainCard.upgradeLevel, 5);
  assert.equal(record.materialPlayer.id, playerId);
  assert.equal(record.materialCard.upgradeLevel, 5);
  assert.equal(record.resultPlayer.id, playerId);
  assert.equal(record.resultCard.upgradeLevel, result.enhancementResult.afterLevel);
  assert.equal(record.protectionUsed, true);
  assert.ok(record.protectionCost > 0);
  assert.equal(record.chance, result.enhancementResult.chance);
  assert.equal(record.success, result.enhancementResult.success);
  assert.equal(record.afterLevel, result.enhancementResult.afterLevel);
  assert.equal(service.view(user).enhancement.history.length, 1);
  assert.equal(service.view(other).enhancement.history.length, 0);

  const serviceSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");
  const historySource = serviceSource.match(/  enhancementHistory\(accountId, limit = 50\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  const enhancementSource = serviceSource.match(/  enhanceS4Card\(account,[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.doesNotMatch(historySource, /\.sort\(/);
  assert.match(historySource, /entries\.length < limit/);
  assert.equal((enhancementSource.match(/cardsForOwner\(this\.state, account\.id, materialCard\.playerId\)/g) ?? []).length, 1);
});

test("pending trait offer is cancelled when its card is consumed as enhancement material", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const user = account("stale-offer-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const pendingCard = service.representativeCard(user.id, playerId);
  pendingCard.upgradeLevel = 3;
  const firstMaterial = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"trait-offer-test" });

  const firstResult = service.enhanceS4Card(user, pendingCard.id, firstMaterial.id, false, { compact:true });
  const pendingOffer = firstResult.enhancementResult.traitOffer;
  assert.equal(firstResult.enhancementResult.afterLevel, 4);
  assert.ok(pendingOffer);

  const nextMain = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"trait-offer-test" });
  nextMain.traitIds = [pendingOffer.traits[0]?.id ?? pendingOffer.traitIds?.[0]].filter(Boolean);
  const secondResult = service.enhanceS4Card(user, nextMain.id, pendingCard.id, false, { compact:true });

  assert.equal(service.state.s4Assets.cards[pendingCard.id].status, "recycled");
  assert.equal(service.state.s4Assets.traitOffers[pendingOffer.id].status, "cancelled");
  assert.equal(service.state.s4Assets.traitOffers[pendingOffer.id].cancelReason, "used-as-enhancement-material");
  assert.equal(secondResult.enhancementResult.traitOffer, null);
  assert.equal(service.view(user).enhancement.traitOffer, null);

  const lowMain = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:0, acquisitionSource:"trait-offer-test" });
  const lowMaterial = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:0, acquisitionSource:"trait-offer-test" });
  const lowResult = service.enhanceS4Card(user, lowMain.id, lowMaterial.id, false, { compact:true });
  assert.equal(lowResult.enhancementResult.afterLevel, 1);
  assert.equal(lowResult.enhancementResult.traitOffer, null);

  service.state.s4Assets.traitOffers[pendingOffer.id].status = "pending";
  assert.equal(service.view(user).enhancement.traitOffer, null);
  assert.equal(service.state.s4Assets.traitOffers[pendingOffer.id].cancelReason, "invalid-card-state");
});

test("强化页左下角使用个人记录并支持放大双卡滚轮视图", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const miniHistory = appSource.match(/function leagueEnhancementHistoryMarkup\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  const expandedHistory = appSource.match(/function openLeagueEnhancementHistory\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(miniHistory, /league\.enhancement\?\.history/);
  assert.match(miniHistory, /强化记录/);
  assert.match(miniHistory, /entry\.materialCard\?\.upgradeLevel/);
  assert.match(miniHistory, /entry\.protectionUsed \? `<span class="enhancement-history-protection">/);
  assert.match(miniHistory, /class="enhancement-history-chance"/);
  assert.doesNotMatch(miniHistory, /entry\.materialLevel/);
  assert.doesNotMatch(miniHistory, /完成合卡后会在这里保存最近记录/);
  assert.doesNotMatch(miniHistory, /enhancementRanking|全服强化排行榜/);
  assert.match(expandedHistory, /s4PlayerCardMarkup\(entry\.mainPlayer/);
  assert.match(expandedHistory, /s4PlayerCardMarkup\(entry\.materialPlayer/);
  assert.match(expandedHistory, /结果卡 · \+\$\{entry\.afterLevel\}/);
  assert.match(expandedHistory, /s4PlayerCardMarkup\(entry\.resultPlayer/);
  assert.match(expandedHistory, /强化道具/);
  assert.match(expandedHistory, /entry\.protectionUsed \? `<span>/);
  assert.doesNotMatch(expandedHistory, /: "未使用"/);
  assert.match(expandedHistory, /预期成功率/);
  assert.match(appSource, /data-enhancement-history-open/);
  assert.match(styles, /\.enhancement-history-overlay\{display:grid;place-items:center/);
  assert.match(styles, /\.enhancement-history-scroll\{[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/);
  assert.match(styles, /\.enhancement-history-card-pair/);
});

test("已挂牌强化卡和所有权挂牌球员不能进入强化流程", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("listed-enhancement-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const main = service.representativeCard(user.id, playerId);
  main.upgradeLevel = 5;
  const material = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  let listing = service.listCard(user, main.id, service.view(user).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === main.id).minimumListingPrice).listings.find((entry) => entry.cardId === main.id && entry.status === "active");
  assert.throws(() => service.enhanceS4Card(user, main.id, material.id), /撤回相关球员资产挂牌/);
  service.cancelListing(user, listing.id);

  listing = service.listCard(user, material.id, service.view(user).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === material.id).minimumListingPrice).listings.find((entry) => entry.cardId === material.id && entry.status === "active");
  assert.throws(() => service.enhanceS4Card(user, main.id, material.id), /撤回相关球员资产挂牌/);
  service.cancelListing(user, listing.id);

  service.listOwnership(user, playerId, 5000);
  assert.throws(() => service.enhanceS4Card(user, main.id, material.id), /撤回相关球员资产挂牌/);
});

test("主动返还所有权时保留最高卡并强制回收其余同名卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("rights-returner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const highest = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const extra = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });

  service.returnOwnership(user, playerId);

  assert.equal(ownershipOwner(service.state, playerId), null);
  assert.deepEqual(service.playerCards(user.id, playerId).map((card) => card.id), [highest.id]);
  assert.equal(service.state.s4Assets.cards[extra.id].status, "recycled");
  assert.equal(service.rosterSlotsUsed(user.id), 21);
});

test("主动返还所有权保留全部并列最高强化卡，只有基础卡时全部回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const enhancedUser = account("return-tied-highest");
  const enhancedTeam = join(service, enhancedUser);
  const enhancedPlayerId = nonLegendBench(service, enhancedUser);
  const original = service.representativeCard(enhancedUser.id, enhancedPlayerId);
  const first = service.grantS4Card(enhancedTeam, enhancedPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(enhancedTeam, enhancedPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });

  service.returnOwnership(enhancedUser, enhancedPlayerId);

  assert.deepEqual(service.playerCards(enhancedUser.id, enhancedPlayerId).map((card) => card.id).sort(), [first.id, second.id].sort());
  assert.equal(service.state.s4Assets.cards[original.id].status, "recycled");

  const baseUser = account("return-base-only");
  const baseTeam = join(service, baseUser);
  const basePlayerId = nonLegendBench(service, baseUser);
  const baseCard = service.representativeCard(baseUser.id, basePlayerId);

  service.returnOwnership(baseUser, basePlayerId);

  assert.equal(service.state.s4Assets.cards[baseCard.id].status, "recycled");
  assert.ok(!baseTeam.rosterIds.includes(basePlayerId));
  assert.equal(ownershipOwner(service.state, basePlayerId), null);
});

test("批量所有权回收会原子校验并一次结算多名球员", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("batch-rights-returner");
  const team = join(service, user);
  const playerIds = team.rosterIds.filter((id) => !isXPlayer(REAL_PLAYER_BY_ID[id]) && REAL_PLAYER_BY_ID[id].grade !== "S").slice(-2);
  const xPlayerId = team.rosterIds.find((id) => isXPlayer(REAL_PLAYER_BY_ID[id]));
  const balanceBefore = service.wallet(user.id).balance;

  assert.throws(() => service.returnOwnerships(user, [playerIds[0], xPlayerId]), /X级球员不可回收/);
  assert.equal(ownershipOwner(service.state, playerIds[0]), user.id);

  const result = service.returnOwnerships(user, playerIds);
  assert.equal(result.ownershipRecoveryResult.playerCount, 2);
  assert.equal(result.ownershipRecoveryResult.recoveredCardCount, 2);
  assert.equal(service.wallet(user.id).balance, balanceBefore + result.ownershipRecoveryResult.amount);
  playerIds.forEach((playerId) => {
    assert.equal(ownershipOwner(service.state, playerId), null);
    assert.equal(service.playerCards(user.id, playerId).length, 0);
  });
});
test("X级球员完成位置身高特性配置且全服唯一并免占名单", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("x-config-first");
  const second = account("x-config-second");
  service.beginDraft(first, "X First");
  service.autoDraft(first);
  const draft = service.state.drafts[first.id];
  const xPlayerId = draft.xPlayerId;
  service.configureXPlayer(first, { role:"GK", heightCm:186 });
  assert.throws(() => service.configureXPlayer(first, { role:"GK", secondaryRole:"CB", heightCm:180 }), /门将/);
  assert.throws(() => service.configureXPlayer(first, { role:"ST", secondaryRole:"LW", heightCm:187 }), /160-186/);
  const trait = service.eligibleXTraits("GK")[0];
  service.chooseXPlayerTrait(first, trait.id);
  service.finishDraft(first);

  const view = service.view(first);
  const xPlayer = view.ownTeam.roster.find((player) => player.id === xPlayerId);
  assert.equal(xPlayer.grade, "X");
  assert.equal(xPlayer.overall, 62);
  assert.equal(xPlayer.role, "GK");
  assert.equal(xPlayer.secondaryRole, null);
  assert.equal(xPlayer.heightCm, 186);
  assert.equal(xPlayer.cards[0].traits[0].id, trait.id);
  assert.equal(Object.keys(xPlayer.attributes).length, 26);
  assert.ok(new Set(Object.values(xPlayer.attributes)).size > 1);
  assert.ok(xPlayer.attributes.goalkeeping > xPlayer.attributes.finishing);
  assert.equal(view.ownTeam.s4Assets.rosterSlotsUsed, 22);
  assert.ok(view.playerDirectory.players.some((player) => player.id === xPlayerId && player.grade === "X"));

  service.beginDraft(second, "X Second");
  service.autoDraft(second);
  assert.notEqual(service.state.drafts[second.id].xPlayerId, xPlayerId);
});

test("X级球员不会进入普通卡包且不可后台发卡、挂牌或回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-protected-owner");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const xCard = service.representativeCard(user.id, xPlayerId);

  assert.ok(service.publicPackCandidates().every((player) => !isXPlayer(player)));
  assert.ok(service.privatePackCandidates(user.id, { pool:"MIXED" }).every((player) => !isXPlayer(player)));
  assert.throws(() => service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId:xPlayerId, upgradeLevel:0, quantity:1 }), /X级球员/);
  assert.throws(() => service.listCard(user, xCard.id, 10000), /不可挂牌/);
  assert.throws(() => service.listOwnership(user, xPlayerId, 10000), /不可挂牌所有权/);
  assert.throws(() => service.releaseCard(user, xCard.id, true), /不可回收/);
  assert.throws(() => service.releaseCards(user, [xCard.id]), /不可回收/);
  assert.throws(() => service.returnOwnership(user, xPlayerId), /不可回收/);
});

test("X球员成长任务、商店加成点与27项加点会实时生效", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-growth-owner");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const xPlayer = REAL_PLAYER_BY_ID[xPlayerId];
  const statKey = `${team.id}:${xPlayerId}`;
  service.state.playerStats[statKey] = { key:statKey, playerId:xPlayerId, teamId:team.id, appearances:1, goals:0, assists:0, saves:0, tackles:0, penaltiesWon:0, yellowCards:0, ratingTotal:7 };
  service.settleXGrowthTasks(xPlayerId);

  let view = service.view(user);
  assert.equal(view.xGrowth.player.id, xPlayerId);
  assert.equal(view.xGrowth.attributes.length, 26);
  assert.equal(view.xGrowth.height.key, "heightCm");
  assert.equal(view.xGrowth.height.maxValue, 230);
  assert.equal(view.xGrowth.points, 1);
  assert.equal(service.view(user).xGrowth.points, 1);

  const walletBefore = service.wallet(user.id).balance;
  view = service.buyXGrowthPoints(user, 6);
  assert.equal(view.wallet.balance, walletBefore - 18000);
  assert.equal(view.xGrowth.points, 7);
  const keysByGroup = { GK:["goalkeeping", "reflexes", "positioning", "composure"], DEF:["tackling", "marking", "positioning", "strength", "pace"], MID:["passing", "vision", "decisions", "firstTouch", "stamina"], ATT:["finishing", "offBall", "pace", "dribbling", "composure"] };
  const overallBefore = view.xGrowth.player.overall;
  keysByGroup[xPlayer.pool].forEach((attributeKey) => { view = service.spendXGrowthPoints(user, attributeKey, 1); });
  assert.ok(view.xGrowth.player.overall > overallBefore);
  keysByGroup[xPlayer.pool].forEach((attributeKey) => {
    assert.equal(view.xGrowth.attributes.find((attribute) => attribute.key === attributeKey).bonusPoints, 1);
  });
  assert.deepEqual(view.xGrowth.attributes.filter((attribute) => attribute.countsTowardOverall).map((attribute) => attribute.key).sort(), [...PLAYER_OVERALL_ATTRIBUTE_KEYS[xPlayer.pool]].sort());
  const overallAfterAbility = view.xGrowth.player.overall;
  const heightBefore = view.xGrowth.height.value;
  view = service.spendXGrowthPoints(user, "heightCm", 1);
  assert.equal(view.xGrowth.height.value, heightBefore + 1);
  assert.equal(view.xGrowth.height.bonusPoints, 1);
  assert.equal(view.xGrowth.height.countsTowardOverall, false);
  assert.equal(view.xGrowth.player.overall, overallAfterAbility);
  assert.equal(view.xGrowth.points, 7 - keysByGroup[xPlayer.pool].length - 1);

  service.xPlayerConfig(xPlayerId).heightCm = 229;
  xPlayer.heightCm = 229;
  service.xGrowthState(xPlayerId).points = 2;
  view = service.spendXGrowthPoints(user, "heightCm", 1);
  assert.equal(view.xGrowth.height.value, 230);
  assert.throws(() => service.spendXGrowthPoints(user, "heightCm", 1), /身高最高为230cm/);
});

test("X球员成长支持批量和最大加点并在保存前结算任务", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-growth-batch-owner");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const statKey = `${team.id}:${xPlayerId}`;
  service.state.playerStats[statKey] = { key:statKey, playerId:xPlayerId, teamId:team.id, appearances:1, goals:0, assists:0, saves:0, tackles:0, penaltiesWon:0, yellowCards:0, ratingTotal:7 };

  const growth = service.xGrowthState(xPlayerId);
  const passingBefore = service.xPlayerConfig(xPlayerId).attributes.passing;
  let pointsAtSave = null;
  let claimedAtSave = null;
  service.save = () => {
    pointsAtSave = growth.points;
    claimedAtSave = growth.taskClaims.appearances;
  };

  let view = service.spendXGrowthPoints(user, "passing", 1, { compact:true });
  assert.equal(pointsAtSave, 0);
  assert.equal(claimedAtSave, 1);
  assert.equal(view.xGrowth.points, 0);
  assert.equal(view.xGrowth.attributes.find((field) => field.key === "passing").value, passingBefore + 1);

  growth.points = 9;
  view = service.spendXGrowthPoints(user, "passing", 5, { compact:true });
  assert.equal(view.xGrowth.points, 4);
  assert.equal(view.xGrowth.attributes.find((field) => field.key === "passing").value, passingBefore + 6);
  view = service.spendXGrowthPoints(user, "passing", 4, { compact:true });
  assert.equal(view.xGrowth.points, 0);
  assert.equal(view.xGrowth.attributes.find((field) => field.key === "passing").value, passingBefore + 10);
});

test("X球员成长响应只查询一次代表卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-growth-card-query");
  join(service, user);
  const representativeCard = service.representativeCard.bind(service);
  let calls = 0;
  service.representativeCard = (...args) => {
    calls += 1;
    return representativeCard(...args);
  };

  service.publicXGrowth(user.id);
  assert.equal(calls, 1);
});

test("X球员洗点返还已用点数并切换位置", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-growth-reset-owner");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  service.buyXGrowthPoints(user, 2);
  service.spendXGrowthPoints(user, "passing", 1);
  service.spendXGrowthPoints(user, "heightCm", 1);
  const xCard = service.representativeCard(user.id, xPlayerId);
  const previousTraitId = xCard.traitIds[0];
  const traitId = service.eligibleXTraits("ST").find((trait) => trait.id !== previousTraitId).id;
  const before = service.wallet(user.id).balance;
  const view = service.resetXGrowth(user, "ST", "LW", { traitId });
  assert.equal(view.wallet.balance, before - 8000);
  assert.equal(view.xGrowth.player.role, "ST");
  assert.equal(view.xGrowth.player.secondaryRole, "LW");
  assert.equal(view.xGrowth.points, 2);
  assert.equal(view.xGrowth.spentPoints, 0);
  assert.equal(view.xGrowth.attributes.find((attribute) => attribute.key === "passing").bonusPoints, 0);
  assert.equal(view.xGrowth.height.bonusPoints, 0);
  assert.equal(xCard.traitIds[0], traitId);
  assert.equal(view.xGrowth.initialTraitId, traitId);
  assert.ok(view.xGrowth.traitCatalog.length > 3);
  assert.equal(service.state.ledger.filter((entry) => entry.type === "x-growth-reset").length, 1);
});

test("X球员洗点可从全部位置适配特性中自由选择并保留强化特性", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-trait-reset");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const xCard = service.representativeCard(user.id, xPlayerId);
  const initialTraitId = xCard.traitIds[0];
  const eligible = service.eligibleXTraits("ST");
  const nextTraitId = eligible.find((trait) => trait.id !== initialTraitId).id;
  const bonusTraitId = eligible.find((trait) => ![initialTraitId, nextTraitId].includes(trait.id)).id;
  xCard.traitIds.push(bonusTraitId);

  service.resetXGrowth(user, "ST", "LW", { traitId:nextTraitId });

  assert.deepEqual(xCard.traitIds, [nextTraitId, bonusTraitId]);
  const balanceBeforeInvalid = service.wallet(user.id).balance;
  const invalidTrait = VERSUS_TRAIT_CARDS.find((trait) => !service.eligibleXTraits("GK").some((candidate) => candidate.id === trait.id));
  assert.throws(() => service.resetXGrowth(user, "GK", null, { traitId:invalidTrait.id }), /适用于新主位置/);
  assert.equal(service.wallet(user.id).balance, balanceBeforeInvalid);
});

test("X球员成长操作可返回轻量响应并保留旧完整响应", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-growth-compact-owner");
  join(service, user);

  const compact = service.buyXGrowthPoints(user, 1, { compact:true });
  assert.ok(compact.wallet);
  assert.ok(compact.xGrowth);
  assert.equal(compact.serverTime, NOW);
  assert.equal("teams" in compact, false);
  assert.equal("playerDirectory" in compact, false);
  assert.equal("recentMatches" in compact, false);

  const full = service.spendXGrowthPoints(user, "passing", 1);
  assert.ok(full.teams);
  assert.ok(full.playerDirectory);
  assert.ok(full.xGrowth);
});

test("X球员洗点请求重试时不会重复扣费或重复写账", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-growth-idempotent-owner");
  join(service, user);
  service.buyXGrowthPoints(user, 1);
  service.spendXGrowthPoints(user, "passing", 1);
  const balanceBefore = service.wallet(user.id).balance;
  const options = { compact:true, requestId:"reset-request-1", traitId:service.eligibleXTraits("ST")[0].id };

  const first = service.resetXGrowth(user, "ST", "LW", options);
  const retried = service.resetXGrowth(user, "ST", "LW", options);

  assert.equal(first.wallet.balance, balanceBefore - 8000);
  assert.equal(retried.wallet.balance, first.wallet.balance);
  assert.equal(retried.xGrowth.growthEpoch, first.xGrowth.growthEpoch);
  assert.equal(service.state.ledger.filter((entry) => entry.type === "x-growth-reset" && entry.requestId === options.requestId).length, 1);
});

test("X球员成长前端会锁定慢请求、网络失败重试并合并轻量响应", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /if \(leagueXGrowthMutationPending\) return null/);
  assert.match(appSource, /crypto\?\.randomUUID\?\.\(\)/);
  assert.match(appSource, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(appSource, /body:leagueIdentity\(\{ \.\.\.body, requestId \}\)/);
  assert.match(appSource, /league = \{ \.\.\.league, updatedAt:growth\.updatedAt, serverTime:growth\.serverTime, wallet:growth\.wallet, xGrowth:growth\.xGrowth \}/);
  assert.match(appSource, /leagueXGrowthRequest\("\/buy"/);
  assert.match(appSource, /leagueXGrowthRequest\("\/spend"/);
  assert.match(appSource, /leagueXGrowthRequest\("\/reset"/);
  assert.doesNotMatch(appSource, /leagueRequest\("\/x-growth\//);
  assert.match(appSource, /data-x-growth-mode="one"[^>]*>\+1<\/button>/);
  assert.match(appSource, /data-x-growth-mode="five"[^>]*>\+5<\/button>/);
  assert.match(appSource, /data-x-growth-mode="max"[^>]*>最大<\/button>/);
  assert.match(appSource, /amount:leagueXGrowthPendingAmount/);
  const growthRequest = appSource.match(/async function leagueXGrowthRequest\(path, body = \{\}\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(growthRequest, /renderLeague\(\)/);
  assert.match(growthRequest, /syncLeagueXGrowthPendingUi\(\)/);
  assert.match(growthRequest, /syncLeagueXGrowthMutationUi\(path, body\.field\)/);
  assert.match(appSource, /if \(field\.key === fieldKey\)/);
  assert.match(styles, /\.x-growth-field-actions\{[^}]*grid-template-columns:repeat\(3/);
  assert.match(apiSource, /requestId:body\.requestId/);
  assert.match(apiSource, /traitId:body\.traitId/);
  assert.match(appSource, /function leagueXGrowthTraitChoicesMarkup/);
  assert.match(appSource, /growth\.traitCatalog/);
  assert.match(appSource, /name="x-growth-reset-trait"/);
  assert.match(appSource, /let leagueXGrowthResetTraitOpen = false/);
  assert.match(appSource, /data-x-growth-position-confirm/);
  assert.match(appSource, /leagueXGrowthResetTraitOpen \? `<section class="x-growth-reset-traits"/);
  assert.match(appSource, /选择特性并支付\$\{growth\.resetCost \?\? 8000\}金币/);
  assert.match(appSource, /data-x-growth-position-edit/);
  assert.match(appSource, /await leagueXGrowthRequest\("\/reset", \{ role, secondaryRole, traitId \}\)/);
  assert.match(styles, /\.x-growth-reset-traits>footer\{[^}]*justify-content:flex-end/);
  assert.match(styles, /\.x-growth-field\.is-pending/);
  assert.match(styles, /\.x-growth-reset\.is-pending/);
});

test("友谊赛邀请使用轻量响应并避免完整联赛重绘", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");
  assert.match(appSource, /function leagueFriendlyInviteRequest/);
  assert.match(appSource, /leagueFriendlyInviteRequest\(team\.id\)/);
  assert.match(appSource, /friendlyInvitations:invitation\.friendlyInvitations/);
  assert.match(appSource, /friendlyInvitationExpired/);
  assert.match(appSource, /expired:"已超时，无法接受"/);
  assert.match(appSource, /两小时内有效 · 有效至/);
  assert.match(apiSource, /createFriendlyInvitation\(account, body\.targetTeamId, \{ compact:true \}\)/);
  assert.match(serviceSource, /friendlyInvitationMutationView\(account\)/);
  assert.match(serviceSource, /const FRIENDLY_INVITATION_TTL_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(serviceSource, /expireFriendlyInvitations\(now/);
  assert.match(serviceSource, /this\.save\(\{ skipDailyBackup:true \}\)/);
});

test("细节战术保留八项连续滑杆并按比赛阶段保存持球与无球方案", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");
  const engineSource = readFileSync(new URL("../versus/v2/match-engine-v2.js", import.meta.url), "utf8");
  const profileSource = readFileSync(new URL("../versus/public/v2-tactical-profiles.js", import.meta.url), "utf8");
  assert.match(appSource, /<header><b>持球进攻<\/b><\/header>/);
  assert.match(appSource, /<header><b>无球防守<\/b><\/header>/);
  assert.match(appSource, /name="\$\{state\}InDetail_\$\{key\}"/);
  assert.match(appSource, /name="\$\{state\}OutDetail_\$\{key\}"/);
  assert.match(appSource, /<span>比赛心态<\/span><select name="\$\{state\}Tactic">/);
  assert.match(appSource, /<span>预设打法<\/span><select name="\$\{state\}Style">/);
  assert.doesNotMatch(appSource, /name="\$\{state\}(PossessionStyle|DefensiveBlock|TransitionStyle|DuelIntensity)"/);
  assert.match(appSource, /Object\.entries\(V2_TACTICAL_DIMENSIONS\)/);
  assert.match(appSource, /name="\$\{state\}Dimension_\$\{key\}" min="0" max="100" step="1"/);
  assert.match(appSource, /data-tactical-dimension-output/);
  assert.match(appSource, /scroll\.append\(summary, plans\)/);
  assert.doesNotMatch(appSource, /directionSection\.innerHTML = "<header><b>攻防方向<\/b><\/header>"/);
  assert.match(serviceSource, /IN_POSSESSION_PLANS\.has\(plans\[state\]\?\.inPossession\)/);
  assert.match(serviceSource, /OUT_OF_POSSESSION_PLANS\.has\(plans\[state\]\?\.outOfPossession\)/);
  assert.match(engineSource, /function tacticalDimensionsForPlan\(plan = \{\}\)/);
  assert.match(engineSource, /v2TacticalProfileAdjustments\(plan\.inPossession, plan\.outOfPossession\)/);
  assert.match(engineSource, /v2TacticalDetailAdjustments\(plan\.inPossessionDetails, plan\.outOfPossessionDetails\)/);
  assert.match(profileSource, /highPress:\{ pressing:22, defensiveLine:14, compactness:4 \}/);
  assert.match(profileSource, /chanceCreation:\{ patient:"耐心寻找", balanced:"均衡", shootOnSight:"尽快起脚" \}/);
  assert.match(profileSource, /lineStrategy:\{ drop:"回收", hold:"保持", offside:"造越位" \}/);
});
test("切换比赛心态或原有预设打法会同步刷新常驻的八项战术滑杆", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const presetSync = appSource.match(/function syncLeagueTacticalPresetControls\(control\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(presetSync, /Tactic\|Style/);
  assert.match(presetSync, /defaultV2TacticalDimensions\(tactic, style\)/);
  assert.match(presetSync, /draft\.tacticalPlans\[state\] = \{ \.\.\.draft\.tacticalPlans\[state\], tactic, style, tacticalDimensions \}/);
  assert.match(presetSync, /form\.elements\.namedItem\(name\)/);
  assert.match(presetSync, /data-tactical-dimension-output/);
  assert.match(appSource, /if \(syncLeagueTacticalPresetControls\(event\.target\)\) \{\s*scheduleLeagueTeamAutoSave\(260\);\s*return;/);
  assert.match(appSource, /function originalV2StyleForPlan\(plan = \{\}, fallbackStyle = "possession"\)/);
});
test("球员职责在电脑磁贴下循环切换并在手机底部面板单独编辑", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const dutyOptions = readFileSync(new URL("../versus/public/v2-player-duty-options.js", import.meta.url), "utf8");
  assert.match(appSource, /function leaguePlanStateForPositionPreset/);
  assert.match(appSource, /class="league-magnet-duty"/);
  assert.match(appSource, /data-league-duty-step="-1"/);
  assert.match(appSource, /data-league-duty-step="1"/);
  assert.match(appSource, /function leagueMobileDutySheetMarkup/);
  assert.match(appSource, /openLeagueMobileDutySheet\(playerId\)/);
  assert.match(appSource, /if \(event\.button !== 0 \|\| event\.target\.closest\("\[data-league-duty-step\]"\)\) return/);
  assert.match(styles, /#league-squad-form \.league-squad-magnet \.league-magnet-duty/);
  assert.match(styles, /\.league-magnet-duty\{[^}]*width:inherit/);
  assert.match(styles, /\.league-mobile-duty-backdrop\{position:fixed/);
  assert.match(styles, /@media\(max-width:1050px\),\(hover:none\) and \(pointer:coarse\)/);
  assert.match(dutyOptions, /targetForward:\{ label:"支点中锋"/);
  assert.match(dutyOptions, /v2PlayerDutyOptionsForRole/);
});
test("替补席按具体位置及强化后的真实能力值排序", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const comparator = appSource.slice(appSource.indexOf("function compareLeagueBenchPlayers"), appSource.indexOf("function leagueBenchMagnet"));
  const squadMarkup = appSource.slice(appSource.indexOf("function legacyLeagueSquadMarkup"), appSource.indexOf("function leagueSquadMarkup"));

  assert.match(appSource, /const LEAGUE_BENCH_ROLE_ORDER = Object\.freeze\(\["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"\]\)/);
  assert.match(comparator, /LEAGUE_BENCH_ROLE_RANK\.get\(leftRole\)/);
  assert.match(comparator, /right\.effectiveOverall \?\? right\.overall/);
  assert.match(comparator, /left\.effectiveOverall \?\? left\.overall/);
  assert.match(squadMarkup, /const bench = roster\.filter\(\(player\) => !startingSet\.has\(player\.id\)\)\.sort\(compareLeagueBenchPlayers\)/);
});
test("替补席提供可独立执行的自动替换与职责适配指导", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const guidance = readFileSync(new URL("../versus/public/v2-tactical-guidance.js", import.meta.url), "utf8");
  assert.match(appSource, /data-league-auto-lineup[^>]*>自动替换球员</);
  assert.match(appSource, /data-league-auto-duties[^>]*>适配职责</);
  assert.match(appSource, /function automaticallyOptimizeLeagueLineup/);
  assert.match(appSource, /function automaticallyAdaptLeagueDuties/);
  assert.match(appSource, /const canUseBench = leagueActivePositionPreset === "position1"/);
  assert.match(appSource, /const candidates = canUseBench \? roster : currentPlayers/);
  assert.match(appSource, /v2OptimalLineupAssignment\(slots, candidates/);
  assert.match(appSource, /if \(canUseBench\) \{\s*Object\.keys\(sourcePresets\)\.forEach\(applyAssignmentToPreset\);\s*leagueStartingIds = nextStarterIds;\s*\} else applyAssignmentToPreset\(leagueActivePositionPreset\)/);
  assert.match(appSource, /仅重排默认首发/);
  assert.match(appSource, /v2RecommendedPlayerDuties\(players, roles/);
  assert.match(styles, /\.league-bench>header>\.league-bench-guidance/);
  assert.match(styles, /grid-template-areas:"bench-title bench-guidance" "bench-subtitle bench-guidance"/);
  assert.match(guidance, /function maximumWeightAssignment/);
});
test("场上磁贴拖向替补席时预览保持标准磁贴尺寸并移除职责条", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const squadBinding = appSource.slice(appSource.indexOf("function bindLeagueSquad()"), appSource.indexOf("function leagueLeaderboardRows"));
  assert.match(squadBinding, /clone\.querySelector\("\.league-magnet-duty"\)\?\.remove\(\)/);
  assert.doesNotMatch(squadBinding, /clone\.classList\.remove\("league-squad-magnet"/);
  assert.match(styles, /\.league-field-drag-ghost\{[^}]*height:64px!important[^}]*max-height:64px!important/);
});
test("桌面战术板三栏使用完整球场高度并避免默认内部滚动", () => {
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const desktopTactics = styles.match(/@media\(min-width:1051px\)\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(desktopTactics, /\.league-lineup-workspace\{height:1040px/);
  assert.match(desktopTactics, /\.league-board-panel,\.league-bench,\.league-tactics-detail\{height:100%\}/);
  assert.match(desktopTactics, /scrollbar-gutter:auto/);
});
test("赛后复盘监听比赛历史更新并自动刷新友谊赛记录", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const fingerprint = appSource.match(/function leagueVisibleFingerprint\(view = league, tab = leagueTab\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(fingerprint, /review: \{ history:view\.reviewHistory, demo:view\.reviewDemo \}/);
});

test("旧X球员完成首日任务后会继续获得多日成长里程碑", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-growth-long-chain");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const statKey = `${team.id}:${xPlayerId}`;
  const growth = service.xGrowthState(xPlayerId);
  growth.taskClaims.appearances = 5;
  service.state.playerStats[statKey] = { key:statKey, playerId:xPlayerId, teamId:team.id, appearances:25, goals:0, assists:0, saves:0, tackles:0, penaltiesWon:0, yellowCards:0, ratingTotal:175 };

  const awarded = service.settleXGrowthTasks(xPlayerId);
  const appearanceTask = service.view(user).xGrowth.tasks.find((task) => task.id === "appearances");
  assert.equal(awarded, 2);
  assert.equal(appearanceTask.completed, 6);
  assert.equal(appearanceTask.complete, false);
  assert.equal(appearanceTask.nextTarget, 35);
  assert.equal(appearanceTask.milestones.at(-1), 90);
});

test("旧X球员存档重载后以62为基础总评并正确叠加强化", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ydl-x-overall-"));
  const statePath = path.join(directory, "league.json");
  try {
    const user = account("x-old-save-owner");
    const first = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const team = join(first, user);
    const xPlayerId = team.rosterIds.find(isXPlayer);
    const card = first.representativeCard(user.id, xPlayerId);
    card.upgradeLevel = 5;
    delete first.state.xPlayers.configs[xPlayerId].baseAbilityOverall;
    delete first.state.xPlayers.configs[xPlayerId].overall;
    first.save({ skipDailyBackup:true });

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const view = reloaded.view(user);
    const xPlayer = view.ownTeam.roster.find((player) => player.id === xPlayerId);
    assert.equal(view.xGrowth.player.overall, 69);
    assert.equal(xPlayer.baseOverall, 62);
    assert.equal(xPlayer.effectiveOverall, 69);
    assert.equal(xPlayer.cards[0].effectiveOverall, 69);
    assert.equal(view.xGrowth.baseOverall, 62);
    assert.equal(view.xGrowth.effectiveOverall, 69);
    assert.equal(view.xGrowth.upgradeLevel, 5);
    assert.ok(view.xGrowth.attributes.every((attribute) => attribute.effectiveValue === attribute.value + 7));
    assert.equal(view.xGrowth.height.effectiveValue, view.xGrowth.height.value);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("旧X门将存档优先使用实际初始能力计算成长基准", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ydl-x-gk-overall-"));
  const statePath = path.join(directory, "league.json");
  try {
    const user = account("x-old-gk-save-owner");
    const first = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const team = join(first, user);
    const xPlayerId = team.rosterIds.find(isXPlayer);
    const config = first.state.xPlayers.configs[xPlayerId];
    const baseAttributes = Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, 1]));
    Object.assign(baseAttributes, { goalkeeping:62, reflexes:66, positioning:62, composure:15 });
    const attributes = { ...baseAttributes, goalkeeping:96, reflexes:85, positioning:70 };
    Object.assign(config, { role:"GK", secondaryRole:null, baseAttributes, attributes, baseAbilityOverall:62, overall:67 });
    first.representativeCard(user.id, xPlayerId).upgradeLevel = 6;
    first.save({ skipDailyBackup:true });

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const view = reloaded.view(user);
    assert.equal(reloaded.state.xPlayers.configs[xPlayerId].baseAbilityOverall, 51);
    assert.equal(view.xGrowth.baseOverall, 78);
    assert.equal(view.xGrowth.effectiveOverall, 87);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("X级球员只能作为主卡并使用同位置普通卡强化至三特性", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const user = account("x-enhancement-owner");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const xPlayer = REAL_PLAYER_BY_ID[xPlayerId];
  const xCard = service.representativeCard(user.id, xPlayerId);
  const sameRolePlayerId = team.rosterIds.find((playerId) => !isXPlayer(playerId) && REAL_PLAYER_BY_ID[playerId].role === xPlayer.role);
  const wrongRolePlayerId = team.rosterIds.find((playerId) => !isXPlayer(playerId) && REAL_PLAYER_BY_ID[playerId].role !== xPlayer.role);
  const sameRoleMaterial = service.grantS4Card(team, sameRolePlayerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"test-material" });
  const wrongRoleMaterial = service.grantS4Card(team, wrongRolePlayerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"test-material" });

  assert.throws(() => service.enhanceS4Card(user, sameRoleMaterial.id, xCard.id), /只能作为强化主卡/);
  assert.throws(() => service.enhanceS4Card(user, xCard.id, wrongRoleMaterial.id), /相同位置/);

  xCard.upgradeLevel = 3;
  let result = service.enhanceS4Card(user, xCard.id, sameRoleMaterial.id);
  assert.equal(result.enhancementResult.afterLevel, 4);
  assert.equal(result.enhancementResult.chance, 85);
  assert.equal(result.enhancementResult.traitOffer.unlockLevel, 4);
  service.chooseS4EnhancementTrait(user, result.enhancementResult.traitOffer.id, result.enhancementResult.traitOffer.traits[0].id);
  assert.equal(xCard.traitIds.length, 2);

  xCard.upgradeLevel = 6;
  const maxMaterial = service.grantS4Card(team, sameRolePlayerId, { grantOwnership:false, upgradeLevel:6, acquisitionSource:"test-material" });
  result = service.enhanceS4Card(user, xCard.id, maxMaterial.id);
  service.chooseS4EnhancementTrait(user, result.enhancementResult.traitOffer.id, result.enhancementResult.traitOffer.traits[0].id);
  assert.equal(xCard.upgradeLevel, 7);
  assert.equal(result.enhancementResult.traitOffer.unlockLevel, 7);
  assert.equal(xCard.traitIds.length, 3);
});

test("X级强化不能消耗其他球员的最后一张所有权锚点卡", () => {
  [0, 1].forEach((roll, index) => {
    const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => roll });
    const user = account(`x-anchor-material-owner-${index}`);
    const team = join(service, user);
    const xPlayerId = team.rosterIds.find(isXPlayer);
    const xPlayer = REAL_PLAYER_BY_ID[xPlayerId];
    const xCard = service.representativeCard(user.id, xPlayerId);
    const materialPlayerId = team.rosterIds.find((playerId) => !isXPlayer(playerId) && REAL_PLAYER_BY_ID[playerId].grade !== "S");
    xPlayer.role = REAL_PLAYER_BY_ID[materialPlayerId].role;
    service.xPlayerConfig(xPlayerId).role = xPlayer.role;
    const anchorCard = service.representativeCard(user.id, materialPlayerId);
    const xLevelBefore = xCard.upgradeLevel;

    assert.equal(service.playerCards(user.id, materialPlayerId).length, 1);
    assert.equal(service.view(user).ownTeam.roster.find((player) => player.id === materialPlayerId).cards[0].ownershipAnchorRequired, true);
    assert.throws(() => service.enhanceS4Card(user, xCard.id, anchorCard.id), /最后一张锚点卡/);
    assert.equal(anchorCard.status, "active");
    assert.equal(xCard.upgradeLevel, xLevelBefore);
    assert.equal(ownershipOwner(service.state, materialPlayerId), user.id);
    assert.ok(team.rosterIds.includes(materialPlayerId));
    assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
  });
});

test("任意最后一张传奇卡作为X级副卡时都会同步移出名单并保持存档一致", () => {
  ["legend-messi-rat", "legend-pele"].forEach((legendId, index) => {
    const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
    const user = account(`x-legend-material-${index}`);
    const team = join(service, user);
    const xPlayerId = team.rosterIds.find(isXPlayer);
    const xPlayer = REAL_PLAYER_BY_ID[xPlayerId];
    const legendPlayer = REAL_PLAYER_BY_ID[legendId];
    const xCard = service.representativeCard(user.id, xPlayerId);
    const materialCard = service.playerCards(user.id, legendPlayer.id)[0]
      ?? service.grantS4Card(team, legendPlayer.id, { grantOwnership:false, acquisitionSource:"regression-test" });
    xPlayer.role = legendPlayer.role;
    service.xPlayerConfig(xPlayerId).role = legendPlayer.role;

    assert.equal(service.playerCards(user.id, legendPlayer.id).length, 1);
    assert.ok(team.rosterIds.includes(legendPlayer.id));
    service.enhanceS4Card(user, xCard.id, materialCard.id);

    assert.equal(materialCard.status, "recycled");
    assert.equal(service.playerCards(user.id, legendPlayer.id).length, 0);
    assert.equal(team.rosterIds.includes(legendPlayer.id), false);
    assert.equal(legendPlayer.id in team.playerState, false);
    assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
  });
});

test("X级球员只能无金币一换一且成交后完整交换归属", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("x-trade-first");
  const second = account("x-trade-second");
  const observer = account("x-trade-observer");
  const firstTeam = join(service, first);
  const secondTeam = join(service, second);
  join(service, observer);
  const firstXId = firstTeam.rosterIds.find(isXPlayer);
  const secondXId = secondTeam.rosterIds.find(isXPlayer);
  const firstCard = service.representativeCard(first.id, firstXId);
  const secondCard = service.representativeCard(second.id, secondXId);

  assert.throws(() => service.createCardTradeOffer(first, second.id, [firstCard.id], [secondCard.id], 1), /不能附带金币/);
  service.createCardTradeOffer(first, second.id, [firstCard.id], [secondCard.id], 0);
  const offer = service.state.cardTradeOffers.at(-1);
  assert.equal(offer.xTrade, true);
  service.resolveCardTradeOffer(second, offer.id, "accept");

  assert.equal(service.state.s4Assets.cards[firstCard.id].ownerId, second.id);
  assert.equal(service.state.s4Assets.cards[secondCard.id].ownerId, first.id);
  assert.equal(service.state.xPlayers.assignments[firstXId], second.id);
  assert.equal(service.state.xPlayers.assignments[secondXId], first.id);
  assert.equal(service.rosterSlotsUsed(first.id), 22);
  assert.equal(service.rosterSlotsUsed(second.id), 22);
  const publicMail = service.view(observer).inbox.find((message) => message.id.startsWith(`card-trade-public:${offer.id}:`));
  assert.equal(publicMail.type, "trade-public");
  assert.match(publicMail.body, /X级球员/);
});

test("开启全新赛季直接清空S4资产，不迁移旧名单", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("fresh-s4-owner");
  join(service, user);
  assert.ok(Object.keys(service.state.s4Assets.cards).length > 0);

  service.startFreshSeason();

  assert.equal(Object.keys(service.state.s4Assets.cards).length, 0);
  assert.equal(Object.keys(service.state.s4Assets.ownerships).length, 0);
  assert.equal(service.state.s4Assets.transactions.length, 0);
  assert.ok(service.state.teams.every((team) => !team.ownerId && team.rosterIds.length === 0));
});

test("桌面联赛浅色主题只在宽屏生效并记忆用户选择", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const lightThemeBlock = styles.slice(styles.indexOf("/* Desktop light appearance */"));
  const componentCompletionBlock = styles.slice(styles.indexOf("/* Desktop light appearance: component completion */"));

  assert.match(appSource, /LEAGUE_DESKTOP_THEME_KEY = "yellowdogs_league_desktop_theme_v1"/);
  assert.match(appSource, /localStorage\.getItem\(LEAGUE_DESKTOP_THEME_KEY\) === "dark" \? "dark" : "light"/);
  assert.match(appSource, /catch \{ return "light"; \}/);
  assert.match(appSource, /window\.matchMedia\("\(min-width: 1051px\)"\)/);
  assert.match(appSource, /data-league-theme-toggle aria-pressed=/);
  assert.match(appSource, /localStorage\.setItem\(LEAGUE_DESKTOP_THEME_KEY, leagueDesktopTheme\)/);
  assert.match(appSource, /class="league-board-controls"/);
  assert.match(appSource, /String\(bond\.name\)\.replace\(\/羁绊\$\/u, ""\)/);
  assert.doesNotMatch(appSource, /escapeHtml\(bond\.name\)\}羁绊/);
  assert.match(styles, /\.league-theme-toggle\{display:none\}/);
  assert.match(styles, /bottom:86px/);
  assert.match(lightThemeBlock, /^\/\* Desktop light appearance \*\/[\s\S]*@media\(min-width:1051px\)\{/);
  assert.match(lightThemeBlock, /html\[data-league-theme="light"\]/);
  for (const selector of [
    ".league-club-resources", ".report-rank", ".cup-tabs button", ".league-board-panel",
    ".backpack-page-tabs button", ".enhancement-composer", ".league-pack-product", ".player-directory-row",
    ".room-console", ".account-history", ".broadcast-hub", ".league-schedule-head",
    ".s4-player-card", ".prediction-dialog .prediction-investment input",
    ".broadcast-overlay", ".broadcast-toolbar", ".scoreboard>span", ".broadcast-team-panel",
    ".latest-event", ".match-event", ".live-stats", ".match-audience",
    ".pitch-lines", ".league-public-pitch", ".history-pitch", ".broadcast-pitch",
    ".league-team-detail-grid>section", ".league-public-roster", ".history-review",
    ".history-team", ".history-player-list", ".timeline-event",
    ".ydtv-hero", ".ydtv-tabs", ".ydtv-panel", ".ydtv-broadcast",
    ".league-magnet-tooltip", ".league-bond-ready span", ".league-board-controls",
    ".league-squad-magnet:not(.grade-x)", ".league-squad-magnet.grade-s",
  ]) assert.ok(componentCompletionBlock.includes(selector), `missing desktop light selector: ${selector}`);
  assert.match(lightThemeBlock, /@media\(min-width:1051px\)\{[\s\S]*html\[data-league-theme="light"\]/);
});
test("页面刷新仅在账号凭证明确失效时清除本地登录态", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../devtool/server.js", import.meta.url), "utf8");
  const roomServiceSource = readFileSync(new URL("../versus/room-service.js", import.meta.url), "utf8");

  assert.match(appSource, /if \(error\.status === 401\) \{[\s\S]*?storeAccount\(null\);[\s\S]*?storeSession\(null\);/);
  assert.match(serverSource, /sendJson\(response, error\.statusCode \?\? 400,/);
  assert.match(roomServiceSource, /凭证无效"\), \{ statusCode:401 \}\)/);
});

test("页面刷新按账号恢复联赛或黄狗TV的当前页面", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");

  assert.match(appSource, /APP_VIEW_KEY = "football_test1_versus_view_v1"/);
  assert.match(appSource, /return value\?\.playerId === account\?\.profile\?\.id \? value : null/);
  assert.match(appSource, /function storeLeagueView\(\) \{[\s\S]*?leagueTab,[\s\S]*?leagueCupPage,[\s\S]*?leagueBackpackPage,[\s\S]*?leagueInboxMessageId,/);
  assert.match(appSource, /function renderLeague\(\) \{[\s\S]*?storeLeagueView\(\)/);
  assert.match(appSource, /function renderYellowDogsTv\(\) \{[\s\S]*?storeAppView\("yellowDogsTv", \{ yellowDogsTvTab \}\)/);
  assert.match(appSource, /else if \(!\(await restoreAppView\(\)\)\) renderLanding\(\)/);
  assert.match(appSource, /function logoutAccount\(\) \{[\s\S]*?clearAppView\(\)/);
});

test("联赛结算沿用比赛播报中的伤停场数", () => {
  const leagueSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");

  assert.match(leagueSource, /function injuryAbsenceMatches\(player\)/);
  assert.equal((leagueSource.match(/injuryAbsenceMatches\(player\)/g) ?? []).length, 4);
  assert.doesNotMatch(leagueSource, /injuryRounds = Math\.max\([^\n]+1 \+ \((?:roundNumber|event\.round|this\.state\.season\.currentRound) % 3\)/);
});

test("战术板拖动球员时按主位置与副位置高亮可替换磁贴", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /data-primary-role=/);
  assert.match(appSource, /data-secondary-role=/);
  assert.match(appSource, /showRoleSwapHighlights\(magnet\)/);
  assert.match(appSource, /candidateRole === primaryRole/);
  assert.match(appSource, /candidateRole === secondaryRole/);
  assert.match(appSource, /clearRoleSwapHighlights\(\)/);
  assert.match(styles, /\.league-squad-magnet\.role-swap-primary/);
  assert.match(styles, /\.league-bench-magnet\.role-swap-secondary/);
});
test("桌面联赛使用顶部球队资源栏并保持侧边导航常驻", () => {
  const indexSource = readFileSync(new URL("../versus/public/index.html", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");

  assert.match(indexSource, /黄狗模拟经理/);
  assert.match(indexSource, /YD MANAGER/);
  assert.match(indexSource, /id="league-topbar-club"/);
  assert.doesNotMatch(appSource, /<header class="league-top">/);
  assert.match(appSource, /leagueTopbarClub\.innerHTML/);
  assert.doesNotMatch(appSource, /LEAGUE_DESKTOP_SIDEBAR_KEY/);
  assert.doesNotMatch(appSource, /data-league-sidebar-collapse/);
  assert.doesNotMatch(appSource, /sidebar-collapsed/);
  assert.doesNotMatch(styles, /league-sidebar-collapse/);
  assert.doesNotMatch(styles, /sidebar-collapsed/);
});
test("三栏数据榜单与强化排行榜限制在桌面可用高度内滚动", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /class="league-stats-grid"/);
  assert.match(appSource, /name:"联赛"/);
  assert.match(appSource, /name:"杯赛"/);
  assert.match(appSource, /name:"本队"/);
  assert.doesNotMatch(appSource, /data-league-stats-scope/);
  assert.doesNotMatch(appSource, /leagueStatsScope/);
  assert.match(appSource, /class="player-info-shell enhancement-ranking-page"/);
  assert.match(styles, /\.league-stats-page\{height:calc\(100dvh - 108px\);min-height:680px/);
  assert.match(styles, /\.league-stats-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);min-height:0\}/);
  assert.match(styles, /\.league-stats-scroll\{min-height:0;overflow:auto/);
  assert.match(styles, /\.enhancement-ranking-page\{box-sizing:border-box;height:calc\(100dvh - 108px\);min-height:680px/);
  assert.match(styles, /\.enhancement-ranking-page \.enhancement-ranking-table\{min-height:0;overflow:auto/);
  assert.match(styles, /\.league-board-controls\{width:100%;min-width:0;display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styles, /\.league-inbox\{height:calc\(100dvh - 108px\);min-height:680px\}/);
});
test("球员搜索与强化排行榜支持独立切换列表和球员卡展示", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /let leaguePlayerSearchView = "list"/);
  assert.match(appSource, /let leagueEnhancementRankingView = "list"/);
  assert.match(appSource, /data-player-search-view/);
  assert.match(appSource, /data-enhancement-ranking-view/);
  assert.match(appSource, /leaguePlayerSearchView === "cards"[\s\S]*player-directory-card-grid/);
  assert.match(appSource, /leagueEnhancementRankingView === "cards"[\s\S]*enhancement-ranking-card-grid/);
  assert.match(appSource, /s4PlayerCardMarkup\(player, \{ card:playerDirectoryCard\(player, player\.highestUpgradeLevel\)/);
  assert.match(appSource, /s4PlayerCardMarkup\(entry\.player, \{ card:playerDirectoryCard\(entry\.player, entry\.upgradeLevel, entry\.traits\)/);
  assert.match(appSource, /class="enhancement-ranking-card-item" data-player-directory-detail="\$\{escapeHtml\(entry\.player\.id\)\}" data-player-directory-upgrade="\$\{entry\.upgradeLevel\}"/);
  assert.match(styles, /\.player-directory-card-grid,\.enhancement-ranking-card-grid\{min-height:0;[^}]*overflow:auto/);
  assert.match(styles, /\.enhancement-ranking-page \.enhancement-ranking-card-grid\{min-height:0;overflow:auto\}/);
  assert.match(styles, /\.player-search-page>\.player-directory-card-grid\{overflow:visible;overscroll-behavior:auto;scrollbar-gutter:auto\}/);
  assert.doesNotMatch(styles, /\.player-search-page,\.enhancement-ranking-page\{box-sizing:border-box;height:calc\(100dvh - 108px\)/);
});
test("联赛总览提供YOOGLE常驻搜索和默认球员档案弹窗", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");

  assert.match(appSource, />YOOGLE</);
  assert.match(appSource, /data-overview-player-search/);
  assert.match(appSource, /data-overview-player-detail/);
  assert.match(appSource, /(?:默认|预览)26项能力值/);
  assert.match(appSource, /data-overview-preview-upgrade/);
  assert.match(appSource, /data-overview-preview-bond/);
  assert.match(appSource, /step="0\.5"/);
  assert.match(appSource, /overviewPlayerPreviewValues/);
  assert.match(appSource, /coreAttributes\.has\(key\)/);
  assert.match(appSource, /player\.heightCm/);
  assert.match(appSource, /player\.ownership/);
  assert.match(styles, /\.overview-player-search:not\(\.has-query\) \.overview-player-search-home\{min-height:220px;align-content:center/);
  assert.match(styles, /\.overview-player-dialog-overlay\{display:grid;place-items:center\}/);
});

test("YOOGLE与球员信息搜索统一使用强化及羁绊能力预览", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const sharedPreview = appSource.slice(appSource.indexOf("function openPlayerProfilePreview"), appSource.indexOf("function scheduleTimeText"));

  assert.match(sharedPreview, /overviewPlayerPreviewMarkup\(player, upgradeLevel, bondPercent\)/);
  assert.match(sharedPreview, /dataset\.overviewPlayerId = player\.id/);
  assert.match(sharedPreview, /data-overview-preview-upgrade/);
  assert.match(sharedPreview, /data-overview-preview-bond/);
  assert.match(sharedPreview, /function openOverviewPlayerDetail\(playerId\) \{\s*openPlayerProfilePreview\(playerId\);/);
  assert.match(sharedPreview, /function openPlayerDirectoryDetail\(playerId, upgradeLevel = 0\) \{\s*openPlayerProfilePreview\(playerId, \{ directory:true, upgradeLevel \}\);/);
  assert.doesNotMatch(sharedPreview, /playerDirectoryCard\(player, player\.highestUpgradeLevel\)/);
  assert.match(appSource, /openPlayerDirectoryDetail\(playerDirectoryDetail\.dataset\.playerDirectoryDetail, playerDirectoryDetail\.dataset\.playerDirectoryUpgrade\)/);
});
test("背包所有权回收支持多选且传奇基础卡进入单卡市场", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  assert.match(appSource, /leagueBackpackSelectedOwnershipIds = new Set\(\)/);
  assert.match(appSource, /leaguePlayerIds:players\.map/);
  assert.match(appSource, /\/ownership\/return-batch/);
  assert.match(appSource, /player\.legendary \|\| player\.grade === "S"/);
  assert.match(apiSource, /ownership\/return-batch/);
  assert.match(apiSource, /cards\/release"\) result = \{ league:yellowDogsLeague\.releaseCards\(account, body\.cardIds, \{ compact:true \}\) \}/);
  assert.match(apiSource, /ownership\/return-batch"\) result = \{ league:yellowDogsLeague\.returnOwnerships\(account, body\.leaguePlayerIds, \{ compact:true \}\) \}/);
});
test("背包子页面按需计算且开包流程只做局部更新", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function leagueBackpackCardSectionMarkup\(allCards = leagueBackpackCardEntries\(\)\)/);
  assert.match(appSource, /function leagueBackpackPackSectionMarkup\(inventory = league\.s4Packs\?\.inventory \?\? \[\]\)/);
  assert.match(appSource, /const allCards = leagueBackpackPage === "cards" \? leagueBackpackCardEntries\(\) : null/);
  assert.match(appSource, /leagueBackpackPage === "cards"[\s\S]*leagueBackpackCardSectionMarkup\(allCards\)[\s\S]*leagueBackpackPackSectionMarkup\(inventory\)/);
  assert.match(appSource, /function syncLeagueBackpackPackMutationInPlace\(\)[\s\S]*currentSection\.outerHTML = leagueBackpackPackSectionMarkup\(inventory\)/);
  assert.match(appSource, /leagueRequest\("\/packs\/open", \{ packId:s4PackOpen\.dataset\.s4PackOpen \}, \{ render:false \}\)[\s\S]*syncLeagueBackpackPackMutationInPlace\(\)/);
  assert.match(appSource, /leagueRequest\("\/packs\/open-batch", \{ packIds \}, \{ render:false \}\)[\s\S]*syncLeagueBackpackPackMutationInPlace\(\)/);
  const choosePack = appSource.match(/async function chooseS4PackCard\(button\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(choosePack, /\{ render:false \}/);
  assert.match(choosePack, /syncLeagueBackpackPackMutationInPlace\(\)/);
  assert.doesNotMatch(choosePack, /renderLeague\(\)/);
});
test("开包紧凑响应会清除上一次批量结果避免旧弹窗重复出现", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const requestSource = appSource.match(/async function leagueRequest\(path, body = \{\}, options = \{\}\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(requestSource, /packOpening:previousPackOpening/);
  assert.match(requestSource, /packBatchOpening:previousPackBatchOpening/);
  assert.match(requestSource, /league = \{ \.\.\.stableLeague, \.\.\.nextLeague \}/);
  assert.ok(requestSource.indexOf("packBatchOpening:previousPackBatchOpening") < requestSource.indexOf("...nextLeague"));
});
test("友谊赛预约与满名单开包不会锁死主要操作页面", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /const weather = next\.weather[\s\S]*友谊赛天气将在比赛开始时确定/);
  assert.match(appSource, /const referee = next\.referee[\s\S]*友谊赛裁判将在比赛开始时确定/);
  assert.match(appSource, /data-s4-pack-manage-roster/);
  assert.match(appSource, /leagueBackpackPage = "cards";[\s\S]*closeLeagueDialog\(\);[\s\S]*renderLeague\(\)/);
  assert.match(appSource, /leagueTab === "backpack" && leagueBackpackPage === "packs" \? league\.s4Packs\?\.offer : null/);
  assert.match(styles, /\.s4-pack-choice-footer\{[^}]*display:flex[^}]*justify-content:space-between/);
});
test("战术板场上磁贴松手后只做局部同步而不整页重绘", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function refreshLeagueSquadPositionUi\(\)/);
  assert.match(appSource, /currentMagnet\.innerHTML = nextMagnet\.innerHTML/);
  assert.match(appSource, /currentLines\.replaceWith\(nextLines\.cloneNode\(true\)\)/);
  const dropRefresh = appSource.match(/if \(moved\) \{\s*leagueEditorDirty = true;[\s\S]*?scheduleLeagueTeamAutoSave\(180\);\s*\}/)?.[0] ?? "";
  assert.match(dropRefresh, /refreshLeagueSquadPositionUi\(\)/);
  assert.doesNotMatch(dropRefresh, /renderLeague\(\)/);
});

test("强化页局部刷新会同步复用卡片的等级与卡面内容", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const syncCard = appSource.match(/function syncEnhancementCardAttributes\(card, source\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(syncCard, /card\.innerHTML !== source\.innerHTML/);
  assert.match(syncCard, /card\.innerHTML = source\.innerHTML/);
  assert.match(appSource, /leagueEnhancementPhase = leagueEnhancementResult\?\.success \? "success" : "failure";[\s\S]*?requestAnimationFrame[\s\S]*?renderLeagueEnhancementInPlace\(\)/);
  assert.match(appSource, /function leagueEnhancementRevealDelay\(afterLevel\)[\s\S]*?level < 4\) return 420;[\s\S]*?1440[\s\S]*?360/);
  assert.match(appSource, /const enhancement = value\.enhancement/);
  assert.match(appSource, /syncLeagueEnhancementPhaseInPlace\(\{ clearResult:true \}\)/);
  assert.match(appSource, /syncLeagueEnhancementPhaseInPlace\(\{ restoreSubmit:true \}\)/);
  assert.match(appSource, /leagueEnhancementPhase = "idle";\s*syncLeagueEnhancementPhaseInPlace\(\)/);
  const performEnhancement = appSource.match(/async function performLeagueEnhancement\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.equal((performEnhancement.match(/renderLeagueEnhancementInPlace\(\)/g) ?? []).length, 1);
  assert.match(appSource, /const revealDelay = leagueEnhancementRevealDelay\(leagueEnhancementResult\?\.afterLevel\)/);
  assert.match(appSource, /function showLeagueEnhancementCelebration\(result\)[\s\S]*?level < 4[\s\S]*?level >= 8 \? "is-max" : "is-high"/);
  assert.match(appSource, /const cardMarkup = s4PlayerCardMarkup\(result\.player, \{ card:result\.card \}\)/);
  assert.match(appSource, /enhancement-celebration-card-glint[\s\S]*?\$\{cardMarkup\}/);
  assert.doesNotMatch(appSource, /enhancement-celebration-copy[\s\S]*?<strong>\+\$\{level\}<\/strong>/);
  assert.match(styles, /\.enhancement-celebration\.is-max/);
  assert.match(appSource, /enhancement-celebration-meteors/);
  assert.match(appSource, /Array\.from\(\{ length:48 \}/);
  assert.match(appSource, /--meteor-y:\$\{startY\}vh/);
  assert.doesNotMatch(appSource, /点击画面继续/);
  assert.match(appSource, /celebration\.addEventListener\("click", \(event\) =>[\s\S]*?celebration\.classList\.contains\("traits-open"\)/);
  assert.doesNotMatch(appSource, /const duration = level >= 8/);
  assert.match(styles, /@keyframes enhancement-celebration-meteor/);
  assert.match(styles, /\.enhancement-celebration-meteors i/);
  assert.match(styles, /\.enhancement-celebration\{[^}]*pointer-events:auto[^}]*cursor:pointer/);
  assert.doesNotMatch(styles, /enhancement-celebration-sweep/);
  assert.match(styles, /\.enhancement-celebration\{[^}]*background:#000/);
  assert.match(styles, /\.enhancement-celebration\.is-max\{background:#000\}/);
  assert.match(styles, /@keyframes enhancement-celebration-card-in/);
  assert.match(styles, /\.enhancement-celebration-card-glint:before/);
  assert.match(appSource, /function returnLeagueEnhancementResultToWarehouse\(cardId\)[\s\S]*?请先为这张强化卡绑定特性[\s\S]*?leagueEnhancementResult = null/);
  assert.match(appSource, /app\.addEventListener\("dblclick"[\s\S]*?data-enhancement-result-card[\s\S]*?returnLeagueEnhancementResultToWarehouse/);
  assert.match(appSource, /data-enhancement-result-pending title="请先绑定强化特性"/);
  assert.match(appSource, /title="双击或拖回球员卡仓库"/);
  assert.match(styles, /\[data-enhancement-result-pending\]\{cursor:not-allowed/);
  assert.match(appSource, /enhancement-celebration-bind/);
  assert.match(appSource, /enhancement-celebration-traits/);
  assert.match(appSource, /celebration\.classList\.add\("traits-open"\)/);
  assert.match(appSource, /function recoverPendingLeagueEnhancementResult\(\)[\s\S]*?league\.enhancement\?\.traitOffer[\s\S]*?leagueEnhancementCardEntry\(traitOffer\.cardId\)[\s\S]*?traitOffer,/);
  assert.match(appSource, /const recovered = !leagueEnhancementResult;[\s\S]*?const pendingResult = leagueEnhancementResult \?\? recoverPendingLeagueEnhancementResult\(\);[\s\S]*?showLeagueEnhancementCelebration\(pendingResult\)[\s\S]*?if \(recovered\)[\s\S]*?classList\.add\("traits-open"\)/);
  assert.match(appSource, /待绑定特性对应的球员卡不存在，请刷新页面后重试/);
  assert.match(appSource, /celebration\.querySelector\("\[data-celebration-bind\]"\)\?\.remove\(\);[\s\S]*?celebration\.classList\.remove\("traits-open", "trait-resolving"\)/);
  assert.match(styles, /\.traits-open \.enhancement-celebration-stage\{opacity:0/);
  assert.match(styles, /@keyframes enhancement-celebration-trait-in/);
  assert.match(styles, /@keyframes enhancement-celebration-trait-collect/);
  assert.match(styles, /@keyframes enhancement-celebration-main-return/);
  assert.match(appSource, /function broadcastMagnet\(player\)[\s\S]*?const position = player\.position \?\? \{ x:50, y:50 \}[\s\S]*?left:\$\{position\.x\}%/);
  assert.match(appSource, /const materialLevelTooHigh = compatibleCards && materialLevel > mainLevel/);
  assert.match(appSource, /const canEnhance = compatibleCards && !materialLevelTooHigh/);
  assert.match(appSource, /const enhancementHint = materialLevelTooHigh \? ""/);
  assert.match(appSource, /<strong>\$\{materialLevelTooHigh \? ""/);
  assert.match(appSource, /Number\(main\.card\.upgradeLevel \?\? 0\) < Number\(material\.card\.upgradeLevel \?\? 0\)/);
  assert.doesNotMatch(styles, /\.enhancement-action>small\.warning/);
  assert.match(appSource, /const secondaryRole = player\.secondaryRole && player\.secondaryRole !== player\.role/);
  assert.match(appSource, /const roleDisplay = secondaryRole \? `\$\{primaryRole\} \/ \$\{secondaryRole\}` : primaryRole/);
  assert.match(appSource, /<dt>主位置 \/ 副位置<\/dt>/);
});

test("观赛加载完成后会移除居中加载布局并恢复全宽直播画面", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const renderBroadcastSource = appSource.match(/function renderBroadcast\(broadcast\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(renderBroadcastSource, /overlay\.classList\.remove\("broadcast-loading"\)/);
  assert.match(appSource, /class="broadcast-overlay broadcast-loading"/);
});

test("tactical board formation reference lines are draggable and persisted per match plan", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /formationReferenceLinesMarkup\(formationLines\)/);
  assert.match(appSource, /data-formation-line=/);
  assert.match(appSource, /moveFormationLine\(leagueFormationLinePresets\[leagueActivePositionPreset\], key, y\)/);
  assert.match(appSource, /formationLinePresets:structuredClone\(leagueFormationLinePresets\)/);
  assert.match(appSource, /requestAnimationFrame/);
  assert.match(appSource, /data-league-role-zones-toggle/);
  assert.match(appSource, /class="league-relationship-controls"/);
  assert.match(appSource, /class="league-board-tool-stack"/);
  assert.match(appSource, /class="league-relationship-controls">\$\{relationshipControls\}\$\{fitnessControl\}/);
  assert.doesNotMatch(appSource, /STARTING XI · POSITION AUTO DETECTION|<h2>首发战术板<\/h2>/);
  assert.match(appSource, /name="leadingTriggerGoalDifference"/);
  assert.match(appSource, /name="trailingTriggerGoalDifference"/);
  assert.doesNotMatch(appSource, /各比赛阶段独立保存并按比分差距自动切换/);
  assert.match(appSource, /formationRoleZonesMarkup\(formationLines\)/);
  assert.doesNotMatch(appSource, /<span>\$\{labels\[key\]\}<\/span>/);
  assert.match(styles, /\.formation-reference-line/);
  assert.match(styles, /\.formation-role-zones/);
  assert.match(styles, /data-league-theme="light"\] \.formation-role-zone\{color:#263343/);
  assert.match(styles, /\.league-board-side>\.league-bond-ready\{grid-column:2;grid-row:1/);
  assert.match(styles, /cursor:pointer/);
});

test("战术板体力条按数字体力红线变色并在输入时即时刷新", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /function leagueMagnetFitnessMarkup\(fitnessValue\)/);
  assert.match(appSource, /const low = fitness < threshold/);
  assert.match(appSource, /data-magnet-fitness="\$\{fitness\}"/);
  assert.match(appSource, /function refreshLeagueMagnetFitnessColors\(thresholdValue\)/);
  assert.match(appSource, /refreshLeagueMagnetFitnessColors\(threshold\)/);
  assert.match(appSource, /type="number" inputmode="numeric" name="fitnessThreshold" min="45" max="100" step="1"/);
  assert.doesNotMatch(appSource, /type="range" name="fitnessThreshold"/);
  assert.doesNotMatch(appSource, /data-fitness-threshold-output/);
  assert.match(appSource, /numeric < 45 \|\| numeric > 100/);
  assert.match(styles, /\.league-magnet-fitness\.is-below-threshold>span\{background:linear-gradient\(90deg,#ef4438 0%,#f06b36 48%,#f2bd3f 100%\)/);
});

test("inbox classification keeps reads local and uses compact single or batch receipts", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /async function leagueInboxReadRequest\(messageId\)/);
  assert.match(appSource, /message\.readAt = optimisticReadAt;[\s\S]*?refreshLeagueInboxInPlace\(\);[\s\S]*?inboxRead/);
  assert.doesNotMatch(appSource, /leagueRequest\("\/inbox\/read"/);
  assert.match(apiSource, /readInbox\(account, body\.messageId, \{ compact:true \}\)/);
  assert.match(apiSource, /readInboxBatch\(account, body\.messageIds\)/);
  assert.match(appSource, /\{ id:"action", label:"待处理" \}/);
  assert.match(appSource, /"trade-offer":\{ label:"交易报价", category:"trades" \}/);
  assert.match(appSource, /announcement:\{ label:"全服公告", category:"announcements" \}/);
  assert.match(appSource, /"admin-update":\{ label:"管理员公告", category:"announcements" \}/);
  assert.match(appSource, /data-league-inbox-category/);
  assert.match(appSource, /data-league-inbox-unread/);
  assert.match(appSource, /data-league-inbox-read-batch/);
  assert.match(styles, /\.league-mail-categories\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.league-mail-categories button\{min-height:38px;font-size:11px;font-weight:900\}/);
  assert.match(styles, /\.league-mail-categories button>b\{min-width:21px;height:21px;font-size:9px\}/);
  assert.match(styles, /grid-template-rows:auto auto auto auto minmax\(0,1fr\)/);
});

test("tactical board tooltip uses the assigned position core attributes", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const tooltipBlock = appSource.slice(appSource.indexOf("function leaguePlayerTooltip"), appSource.indexOf("function leagueBoardMagnet"));
  assert.match(appSource, /MID:Object\.freeze\(\["passing", "vision", "decisions", "firstTouch", "stamina"\]\)/);
  assert.match(appSource, /DEF:Object\.freeze\(\["tackling", "marking", "positioning", "strength", "pace"\]\)/);
  assert.match(tooltipBlock, /assignedRole === "GK"/);
  assert.match(tooltipBlock, /LEAGUE_ROLE_CORE_ATTRIBUTES\[assignedGroup\]/);
  assert.doesNotMatch(tooltipBlock, /player\.pool/);
});

test("mobile league screens retain card traits, inbox details, and cup records", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const cupSource = appSource.slice(appSource.indexOf("function leagueCupOverviewMarkup()"), appSource.indexOf("function updateLeagueScheduleClock()"));

  assert.ok(appSource.includes("leagueInboxReadRequest(leagueInboxMessageId)"));
  assert.ok(appSource.includes('const inboxMessage = event.target.closest("[data-league-inbox-message]");'));
  assert.ok(appSource.includes('scrollIntoView({ behavior:"smooth", block:"start" })'));
  assert.match(cupSource, /cup-standing-mobile-meta/);
  assert.match(cupSource, /cup-standings-table/);
  assert.match(styles, /.enhancement-card-grid .s4-player-card-traits{display:block/);
  assert.match(styles, /.cup-standings-table{min-width:0;table-layout:fixed/);
  assert.match(styles, /.cup-standing-mobile-meta{display:block!important/);
});

test("tactical board bond bonus display is optional and disabled by default", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /let leagueShowBondBonuses = false/);
  assert.match(appSource, /data-league-bond-bonus-toggle/);
  assert.match(appSource, /applyS4BondBonuses\(starters\.map/);
  assert.match(appSource, /leagueOverallFromAttributes\(player\.attributes, player\.role\)/);
  assert.doesNotMatch(appSource, /\.\.\/\.\.\/game\/public\/schema\.js/);
});

test("tactical board exposes trait-adjusted height and familiar positions", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("trait-board");
  const team = join(service, user);
  const playerId = team.rosterIds.find((id) => !isXPlayer(id));
  const baseHeightCm = REAL_PLAYER_BY_ID[playerId].heightCm;
  const card = service.representativeCard(user.id, playerId);

  card.traitIds = ["custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20"];
  let player = service.view(user).ownTeam.roster.find((entry) => entry.id === playerId);
  assert.equal(player.baseHeightCm, baseHeightCm);
  assert.equal(player.effectiveHeightCm, baseHeightCm - 10);

  card.traitIds = ["aerial-beacon"];
  player = service.view(user).ownTeam.roster.find((entry) => entry.id === playerId);
  assert.equal(player.effectiveHeightCm, baseHeightCm + 20);
  assert.deepEqual(player.traitPositionFit.familiarRoles, ["ST"]);

  card.traitIds = ["utility-player"];
  player = service.view(user).ownTeam.roster.find((entry) => entry.id === playerId);
  assert.equal(player.traitPositionFit.ignoreOutOfPositionPenalty, true);
  assert.deepEqual(player.traitPositionFit.eligibleRoleGroups, ["DEF", "MID", "ATT"]);

  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /player\.effectiveHeightCm \?\? player\.heightCm/);
  assert.match(appSource, /traitFit\.familiarRoles\?\.includes\(assignedRole\)/);
  assert.match(appSource, /traitFit\.ignoreOutOfPositionPenalty/);
});

test("996 uses fixed fitness for the tactical board and pre-match red-line rotation", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("fixed-fitness");
  const team = join(service, user);
  const starterId = team.preferredStarterIds.find((id) => !isXPlayer(id) && team.rosterIds.some((candidateId) => (
    !team.preferredStarterIds.includes(candidateId)
    && REAL_PLAYER_BY_ID[candidateId].role === REAL_PLAYER_BY_ID[id].role
  )));
  assert.ok(starterId);
  const card = service.representativeCard(user.id, starterId);
  card.traitIds = ["stoppage-time-expert"];
  team.playerState[starterId].fitness = 79;
  team.fitnessThreshold = 85;

  const player = service.view(user).ownTeam.roster.find((entry) => entry.id === starterId);
  assert.equal(player.state.fitness, 79);
  assert.equal(player.fixedFitness, 90);
  assert.equal(player.effectiveFitness, 90);

  const selection = service.selectActualLineup(team, 1, "league");
  assert.equal(selection.rotations.some((entry) => entry.outId === starterId), false);
  assert.equal(selection.lineup.find((entry) => entry.id === starterId)?.state.fitness, 90);

  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /player\.effectiveFitness \?\? player\.state\?\.fitness/);
  assert.match(appSource, /player\.effectiveFitness \?\? player\.state\.fitness/);
});

test("mobile tactical controls avoid full-form work during pointer frames", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const inputHandler = appSource.slice(appSource.indexOf('app.addEventListener("input"'), appSource.indexOf('app.addEventListener("keydown"'));
  const squadBinding = appSource.slice(appSource.indexOf("function bindLeagueSquad()"), appSource.indexOf("function leagueLeaderboardRows"));

  assert.match(appSource, /scheduleLeagueTeamAutoSave\(420, \{ lightweight:true \}\)/);
  assert.match(inputHandler, /syncLeagueTacticalDimensionControl\(event\.target\)/);
  assert.doesNotMatch(inputHandler, /captureLeagueTacticalControls\(\)/);
  assert.match(squadBinding, /function frameThrottlePointerMove|frameThrottlePointerMove\(applyMove\)/);
  assert.match(squadBinding, /benchTargetSnapshot\(\)/);
  assert.doesNotMatch(squadBinding, /elementFromPoint/);
  assert.match(appSource, /matchMedia\("\(hover: none\), \(pointer: coarse\)"\)/);
  assert.match(styles, /\.league-mobile-plan-tabs\{display:none\}/);
  assert.match(styles, /max-height:min\(48dvh,360px\)/);
  assert.match(styles, /data-active-mobile-plan="opening"/);
  assert.match(styles, /@media\(hover:none\) and \(pointer:coarse\)/);
});

test("tactical autosave status is prominent at the bottom of the bench panel", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const squadMarkup = appSource.slice(appSource.indexOf("function legacyLeagueSquadMarkup"), appSource.indexOf("function aiTrainingOptionMarkup"));

  assert.match(squadMarkup, /\$\{matchPlans\}\$\{autosaveFooter\}<\/aside>/);
  assert.match(squadMarkup, /bench\?\.querySelector\("\[data-league-autosave-status\]"\)/);
  assert.doesNotMatch(squadMarkup, /league-tactics-detail-footer/);
  assert.doesNotMatch(squadMarkup, /\.append\(saveStatus\)/);
  assert.match(appSource, /status\.querySelector\("\[data-league-autosave-label\]"\)/);
  assert.match(appSource, /if \(label\) label\.textContent = textValue/);
  assert.match(styles, /\.league-autosave-footer\{[^}]*justify-content:flex-start/);
  assert.match(styles, /\.league-autosave-status\{[^}]*width:min\(230px,100%\)[^}]*min-height:54px/);
  assert.match(styles, /\.league-autosave-copy b\{[^}]*font-size:14px/);
});

test("prediction page refresh uses the compact endpoint and updates only prediction containers", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const refreshSource = appSource.slice(appSource.indexOf("async function refreshPredictionsSilently()"), appSource.indexOf("async function placePrediction"));
  const renderSource = appSource.slice(appSource.indexOf("function renderPredictionsInPlace()"), appSource.indexOf("async function refreshPredictionsSilently()"));

  assert.match(refreshSource, /\/api\/versus\/league\/predictions/);
  assert.doesNotMatch(refreshSource, /api\("\/api\/versus\/league"/);
  assert.match(refreshSource, /renderPredictionsInPlace\(\)/);
  assert.doesNotMatch(refreshSource, /renderLeague\(\)/);
  assert.match(renderSource, /data-prediction-grid/);
  assert.match(renderSource, /data-prediction-ranking/);
  assert.match(renderSource, /data-prediction-wallet/);
  assert.match(renderSource, /existingCards = new Map/);
  assert.match(renderSource, /current\.outerHTML !== markup/);
});

test("prediction page displays the exact handicap and final locked odds", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const displaySource = appSource.slice(appSource.indexOf("function predictionHandicapText"), appSource.indexOf("function predictionLeaderboardMarkup"));
  const dialogSource = appSource.slice(appSource.indexOf("function openPredictionMarket"), appSource.indexOf("function leagueCupOverviewMarkup"));

  assert.match(displaySource, /handicap < 0\) return `主队让 \$\{Math\.abs\(handicap\)\} 球`/);
  assert.match(displaySource, /handicap > 0\) return `客队让 \$\{handicap\} 球`/);
  assert.match(displaySource, /return "零球盘 · 0球"/);
  assert.match(displaySource, /predictionPayoutText\(bet\.payoutRate\)/);
  assert.match(displaySource, /rate\.toFixed\(2\)/);
  assert.doesNotMatch(displaySource, /toFixed\(2\)\}倍/);
  assert.match(dialogSource, /predictionPayoutText\(option\.payoutRate\)/);
  assert.match(dialogSource, /"result", "goals", "cards", "halfFull"/);
  assert.doesNotMatch(dialogSource, /"shotsOnTarget"/);
  assert.match(dialogSource, /45分钟结果和90分钟常规时间结果结算/);
  assert.match(dialogSource, /显示赔率提交后锁定/);
  assert.doesNotMatch(dialogSource, /data-prediction-return|updateReturn|命中预计返还/);
});

test("单卡合成在超时重试时复用requestId并由API传给服务端", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const performEnhancement = appSource.match(/async function performLeagueEnhancement\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(appSource, /let leagueEnhancementPendingRequest = null/);
  assert.match(performEnhancement, /leagueEnhancementPendingRequest\?\.key !== requestKey/);
  assert.match(performEnhancement, /requestId:leagueEnhancementPendingRequest\.requestId/);
  assert.match(performEnhancement, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(performEnhancement, /startsWith\("请求超时"\)/);
  assert.match(performEnhancement, /leagueEnhancementPendingRequest = null/);
  assert.match(apiSource, /enhanceS4Card\(account, body\.mainCardId, body\.materialCardId, body\.useProtection === true, \{ compact:true, requestId:body\.requestId \}\)/);
});
test("enhancement result never falls back to a stale account trait offer", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /const traitOffer = result \? result\.traitOffer \?\? null : league\.enhancement\?\.traitOffer \?\? null/);
  assert.match(appSource, /const traitOffer = result\.traitOffer \?\? null/);
  assert.doesNotMatch(appSource, /result\.traitOffer \?\? league\.enhancement\?\.traitOffer/);
});

test("V2 formal match stats update X player save tasks", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-v2-save-task-owner");
  service.beginDraft(user, "X V2 Save Task FC");
  service.autoDraft(user);
  service.configureXPlayer(user, { role:"GK", heightCm:186 });
  service.chooseXPlayerTrait(user, service.eligibleXTraits("GK")[0].id);
  service.finishDraft(user);

  const team = service.accountTeam(user.id);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const replacedGoalkeeperId = team.preferredStarterIds.find((playerId) => REAL_PLAYER_BY_ID[playerId]?.role === "GK");
  team.preferredStarterIds = team.preferredStarterIds.map((playerId) => playerId === replacedGoalkeeperId ? xPlayerId : playerId);
  Object.values(team.positionPresets).forEach((preset) => {
    preset[xPlayerId] = preset[replacedGoalkeeperId];
    delete preset[replacedGoalkeeperId];
  });
  team.positions = structuredClone(team.positionPresets.position1);

  const fixture = service.state.rounds[0].fixtures.find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const created = service.createFixtureMatch(fixture, 1, NOW, { matchEngine:"v2" });
  advanceYdlLeagueV2Match(created.match, NOW + 300_000, { maximumChains:Infinity });
  const teamIndex = fixture.homeId === team.id ? 0 : 1;
  const reportPlayer = created.match.report.teams[teamIndex].players.find((player) => player.id === xPlayerId);
  assert.ok(reportPlayer.stats.saves > 0);

  const statKey = `${team.id}:${xPlayerId}`;
  const savesBefore = Math.max(0, 5 - reportPlayer.stats.saves);
  service.state.playerStats[statKey] = { key:statKey, playerId:xPlayerId, teamId:team.id, appearances:0, goals:0, assists:0, saves:savesBefore, tackles:0, penaltiesWon:0, yellowCards:0, redCards:0, ratingTotal:0 };
  service.finalizeFixture(fixture, 1, created.match);

  assert.equal(service.xFormalStats(xPlayerId).saves, savesBefore + reportPlayer.stats.saves);
  assert.equal(service.view(user).xGrowth.tasks.find((task) => task.id === "saves").completed, 1);
});

test("世界杯模式和国家队战术板已从玩家端与服务接口移除", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const adminApiSource = readFileSync(new URL("../versus/admin-api.js", import.meta.url), "utf8");
  const adminSource = readFileSync(new URL("../admin/public/app.js", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /worldCup|world-cup|worldcup|世界杯|国家队战术板/);
  assert.doesNotMatch(apiSource, /world-cup/);
  assert.doesNotMatch(adminApiSource, /world-cup/);
  assert.doesNotMatch(adminSource, /world-cup|世界杯/);
});

test("杯赛页面展示9轮联赛阶段、八强奖励和既有淘汰赛结构", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const cupSource = appSource.slice(appSource.indexOf("function leagueCupOverviewMarkup()"), appSource.indexOf("function updateLeagueScheduleClock()"));

  assert.match(cupSource, /leagueRounds/);
  assert.match(cupSource, /LEAGUE STAGE · 9 ROUNDS/);
  assert.doesNotMatch(cupSource, /league-cup-reward-note|第1至第4名另获10000金币|第5至第8名另获6000金币/);
  assert.match(cupSource, /八强和半决赛两回合，决赛单场决胜/);
  assert.doesNotMatch(cupSource, /瑞士轮/);
});

test("新版电视台复用现有转播资源并把双方阵型压缩到各自半场", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /function broadcastCombinedPosition[\s\S]*?y:50 \+ y \* \.5[\s\S]*?x:100 - x, y:50 - y \* \.5/);
  assert.match(appSource, /function broadcastCombinedPitchMarkup[\s\S]*?broadcastMagnet[\s\S]*?pitchMarkup/);
  assert.match(appSource, /function broadcastV2MatchLayoutMarkup[\s\S]*?matchEventMarkup[\s\S]*?matchStatsMarkup/);
  assert.match(appSource, /legacyLayout\.outerHTML = broadcastV2MatchLayoutMarkup/);
  assert.match(styles, /\.broadcast-v2-layout\{display:grid;grid-template-columns:/);
  assert.match(styles, /\.broadcast-overlay \.broadcast-v2-pitch\{[^}]*aspect-ratio:\.64/);
  assert.match(styles, /\.broadcast-v2-sidebar\{[^}]*grid-template-rows:/);
  assert.match(styles, /@media\(min-width:821px\)\{\.broadcast-v2-sidebar\{height:auto;max-height:none;min-height:0;align-self:stretch;grid-template-rows:minmax\(0,1\.72fr\) minmax\(0,1fr\);overflow:hidden;contain:size/);
  assert.match(styles, /\.broadcast-v2-commentary \.event-feed\{[^}]*overflow-y:auto/);
  assert.match(styles, /@media\(max-width:820px\)\{\.broadcast-v2-sidebar\{height:auto[^}]*\}\.broadcast-overlay \.broadcast-v2-commentary\{height:520px/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet\{box-sizing:border-box;width:80px;min-height:42px;padding:5px 27px 8px 6px\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet>i\{right:5px;top:5px;min-width:23px;font-size:14px/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet\{min-height:40px;padding:3px 27px 6px 6px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet \.league-magnet-role\{margin:0;padding:1px 3px;font-size:8px[^}]*\}\.broadcast-v2-pitch \.s4-broadcast-magnet b\{width:100%;font-size:9px/);
  assert.match(styles, /\.broadcast-overlay \.scoreboard>div:last-child\{grid-template-columns:auto minmax\(0,1fr\)\}/);
  assert.match(styles, /\.broadcast-overlay \.scoreboard>div:last-child>b\{grid-column:1;grid-row:1\/3;text-align:left\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet\{min-height:46px;padding:4px 27px 8px 6px;gap:2px\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet \.league-magnet-upgrade\{right:-4px;bottom:-5px;min-width:22px;height:16px[^}]*font-size:8px\}/);
  assert.match(appSource, /function dockBroadcastTeamStrategies[\s\S]*?heading\.after\(dock\)[\s\S]*?source\.remove\(\)/);
  assert.match(appSource, /dockBroadcastTeamStrategies\(overlay\);/);
  assert.match(styles, /\.broadcast-v2-stadium\{width:100%;height:100%;min-height:0;margin:0;display:grid;place-items:center/);
  assert.match(styles, /\.broadcast-v2-commentary>header\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(appSource, /function fieldRoleAbbreviation[\s\S]*?return String\(matchedCode \?\? raw\)\.toUpperCase\(\)/);
  assert.match(appSource, /function leagueBoardMagnet[\s\S]*?<span class="league-magnet-role">\$\{ROLE_LABELS\[assignedRole\] \?\? assignedRole\}<\/span>/);
  assert.match(appSource, /function broadcastMagnet[\s\S]*?<span class="league-magnet-role">\$\{escapeHtml\(fieldRoleAbbreviation\(assignedRole\)\)\}<\/span>/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet \.league-magnet-role\{margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none/);
  assert.match(styles, /\.broadcast-v2-team-strategies>div>span\{[^}]*display:flex[^}]*white-space:nowrap\}[\s\S]*?\.broadcast-v2-team-strategies small\{[^}]*font-size:9px[^}]*white-space:nowrap/);
  assert.match(styles, /@media\(min-width:821px\)\{\.broadcast-v2-sidebar\{grid-template-rows:minmax\(0,1\.45fr\) minmax\(390px,1fr\)\}\}[\s\S]*?\.broadcast-v2-data-panel \.live-stats\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.broadcast-v2-ad,\.broadcast-v2-half-label\{display:none\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.pitch-penalty-arc\{width:28%\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.pitch-penalty-arc-top\{top:2%;clip-path:inset\(78% 0 0 0\)\}/);
});

test("mirror batch UI exposes the player compute node market and discounted self-hosted pricing", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../devtool/server.js", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../devtool/mirror-batch-worker.js", import.meta.url), "utf8");
  const tacticsToolbarSource = appSource.slice(appSource.indexOf("const aiTrainingButton ="), appSource.indexOf("detail.innerHTML", appSource.indexOf("const aiTrainingButton =")));
  const aiDialogSource = appSource.slice(appSource.indexOf("function aiTrainingDialogMarkup"), appSource.indexOf("function openAiTrainingDialog"));
  assert.match(appSource, /function openMirrorBatchCapacityDialog\(entries = \[\]\)/);
  assert.match(appSource, /name="executionNode" data-ai-training-node-select/);
  assert.match(appSource, /玩家计算节点市场/);
  assert.doesNotMatch(tacticsToolbarSource, /data-compute-nodes-open/);
  assert.match(aiDialogSource, /data-compute-nodes-open>管理计算节点/);
  assert.match(appSource, /overlay\.querySelector\("\[data-compute-nodes-open\]"\)\?\.addEventListener\("click", openComputeNodeMarketDialog\)/);
  assert.match(appSource, /compute-node\/save/);
  assert.match(appSource, /Math\.round\(price \* batchCount \/ batchPriceDivisor\)/);
  assert.match(appSource, /系统AI与玩家镜像均支持高速节点/);
  assert.match(appSource, /系统AI批量模拟\$\{batchCount\}场免费/);
  assert.match(appSource, /本次密钥有效至\$\{escapeHtml\(expiresAt\)\}（12小时）/);
  assert.match(appSource, /自有节点免服务费/);
  assert.match(appSource, /batchPriceDivisor/);
  assert.match(appSource, /data-ai-training-node-status/);
  assert.match(appSource, /在线待机 · 未接受任务/);
  assert.match(appSource, /acceptingJobs === false/);
  assert.match(workerSource, /YDL_MIRROR_WORKER_ACCEPT_JOBS/);
  assert.match(appSource, /executionNode \}/);
  assert.match(appSource, /error\.status === 409 && Array\.isArray\(error\.details\)/);
  assert.match(appSource, /还剩 \$\{Number\(entry\.remainingMatches \?\? 0\)\} 场/);
  assert.match(styles, /\.ai-training-node-option\{/);
  assert.match(styles, /\.ai-training-node-option>span\{[^}]*font-size:12px/);
  assert.match(styles, /\.compute-node-market\{[^}]*font-size:13px/);
  assert.match(styles, /\.compute-node-market li b\{font-size:14px\}/);
  assert.match(styles, /\.mirror-batch-capacity-body\{/);
  assert.match(serverSource, /YDL_MIRROR_WORKER_TOKEN/);
  assert.match(serverSource, /authenticateMirrorComputeNode/);
  assert.match(serverSource, /\/api\/worker\/mirror-batches\/complete/);
  assert.match(workerSource, /MIRROR_BATCH_DIRECTOR_CONCURRENCY/);
  assert.match(workerSource, /runMirrorBatchWorkerMatch/);
});