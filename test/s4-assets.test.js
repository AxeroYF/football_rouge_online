import {addLegacyXPlayer} from "./helpers/legacy-x-player.js";
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clubNavMarkup } from "../versus/public/club-navigation.js";
import { knockoutCupMarkup } from "../versus/public/division-ui.js";
import { resolveInboxAction } from "../versus/public/inbox-rules.js";
import { competitionAvailability } from "../versus/public/lineup-competition.js";
import { createGameSettings, DEFAULT_GAME_SETTINGS } from "../versus/public/game-settings.js";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { ATTRIBUTE_NAMES, PLAYER_OVERALL_ATTRIBUTE_KEYS, playerOverallFromAttributes } from "../shared/football/schema.js";
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
  // A balance reduction must retain the player's existing portrait, including
  // players now below the automatic high-overall portrait threshold.
  assert.equal(new Set(entries.map((entry) => entry.fileName)).size, entries.length);
  const promotedProfiles = JSON.parse(readFileSync(new URL("../data/promoted-a-portrait-fallbacks.json", import.meta.url), "utf8"));
  for (const id of expectedPlayerIds) {
    if (!A_PLAYER_PROFILE_BY_PLAYER_ID[id]) assertOptimizedProfileAsset(promotedProfiles[id], "player_profiles");
  }
  for (const id of Object.keys(A_PLAYER_PROFILE_BY_PLAYER_ID)) {
    assert.ok(REAL_PLAYER_BY_ID[id], `Unknown portrait player: ${id}`);
  }
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

test("统一球员卡引用Rougelite原始盾形图层和等级配色", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/player-card-shield.css", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../versus/public/player-card-shield.js", import.meta.url), "utf8");
  assert.ok(appSource.includes('s4-player-card ydl-player-card player-card-shield'));
  assert.ok(appSource.includes('shieldCardContent({'));
  assert.ok(styles.includes('aspect-ratio:26/35!important'));
  assert.ok(styles.includes('border-radius:0!important'));
  assert.ok(renderer.includes("S:'s',X:'s',A:'a',B:'b',C:'c'"));
  assert.ok(renderer.includes('/versus/assets/card-frames/shield-v1/'));
  for (const color of ["#122c81", "#0c625b", "#513650", "#354f3e"]) assert.ok(styles.includes(color));
});

test("背包三选一卡包使用独立悬浮选择层且卡牌网格保留间距", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /function openS4PackChoiceDialog\(offer\)/);
  assert.match(appSource, /syncS4PackChoiceDialog\(\)/);
  assert.match(appSource, /overlay\.querySelectorAll\("\[data-s4-pack-choice\]"\)\.forEach\(\(button\) => \{\s*button\.onclick = \(event\) => \{ event\.stopPropagation\(\); void chooseS4PackCard\(button\); \}/);
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
  const previewSource = readFileSync(new URL("../versus/public/player-preview.js", import.meta.url), "utf8");
  assert.match(previewSource, /Math\.min\(99/);
  assert.doesNotMatch(appSource, /overflowRetention|overflowThreshold/);
  assert.match(appSource, /"overview-player-dialog s4-card-detail-dialog"/);
  const detailSource = appSource.match(/function openS4CardDetail\(cardId, playerId\) \{[\s\S]*?\n\}/)?.[0] ?? "";
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

test("联赛 AI 在积分榜与档案佩戴本俱乐部徽章", () => {
  const service = new YellowDogsLeagueService({statePath:null, now:() => NOW, rng:() => .37});
  const viewer = account("crest-observer");
  const teams = service.view(viewer).teams;
  assert.equal(teams.length, 16);
  for (const team of teams) {
    const badge = CLUB_BADGES.find(item => item.clubName === team.name);
    assert.ok(badge, team.name);
    assert.equal(team.equippedClubBadge.id, badge.id);
    assert.equal(service.teamDetail(viewer, team.id).equippedClubBadge.imageUrl, badge.imageUrl);
  }
});

test("商店展柜随宽度排列并区分两类徽章包视觉", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /shop:"商店"/);
  assert.match(clubNavMarkup("shop"), /data-league-tab="shop"[^>]*aria-current="page"/);
  assert.ok(appSource.includes('tone === "country-badge" ? "NAT"'));
  assert.ok(appSource.includes('tone === "club-badge" ? "CLB"'));
  const shopStyles = readFileSync(new URL("../versus/public/club-interface.css", import.meta.url), "utf8");
  assert.match(shopStyles, /\.league-pack-product-grid\s*\{[^}]*repeat\(auto-fill,minmax\(/);
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

test("交易市场下架徽章道具且积分榜保持隐藏玩家昵称", () => {
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(apiSource, /market\/list-cosmetic/);
  assert.doesNotMatch(appSource, /data-market-section="cosmetic"/);
  assert.doesNotMatch(appSource, /function leagueCosmeticMarketMarkup\(\)/);
  assert.doesNotMatch(appSource, /data-market-list-kind="cosmetic"/);
  assert.match(appSource, /const owner = badges \? `<small class="league-team-honors">\$\{badges\}<\/small>` : ""/);
  assert.doesNotMatch(appSource, /const owner = team\.ownerName \? `<small>\$\{escapeHtml\(team\.ownerName\)\}\$\{badges\}<\/small>`/);
  assert.match(styles, /market-entry-three>div\{[^}]*grid-template-columns:repeat\(3/);
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

  assert.equal(assets.cards.length, 22);
  assert.equal(assets.rosterSlotsUsed, 22);
  assert.equal(new Set(assets.cards.map((card) => card.id)).size, 22);
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
  const listingSource = appSource.slice(appSource.indexOf("function marketListingCard"), appSource.indexOf("function leagueCardTradeMarkup"));

  assert.match(listingSource, /item\.includesOwnership \? " · 附带所有权" : ""/);
});

test("所有权成交前保护十一人下限，保留强化卡则不误拦", () => {
  const service = new YellowDogsLeagueService({statePath:null,now:()=>NOW,rng:()=>.37});
  const seller = account("floor-seller"), buyer = account("floor-buyer");
  const team = join(service,seller); join(service,buyer);
  while (team.rosterIds.length > 11) {
    const id = team.rosterIds.find(playerId=>!team.preferredStarterIds.includes(playerId) && !isXPlayer(playerId));
    service.releaseCard(seller,service.representativeCard(seller.id,id).id,true,{compact:true});
  }
  const playerId = team.rosterIds.find(id=>REAL_PLAYER_BY_ID[id].grade !== "S" && !isXPlayer(id));
  const {listing} = service.listOwnership(seller,playerId,20000,null,{compact:true});
  const before = JSON.stringify(service.state);
  assert.throws(()=>service.buyListing(buyer,listing.id),/11名/);
  assert.equal(JSON.stringify(service.state),before);
  service.grantS4Card(team,playerId,{grantOwnership:false,upgradeLevel:1});
  service.buyListing(buyer,listing.id);
  assert.equal(team.rosterIds.length,11);
  assert.equal(ownershipOwner(service.state,playerId),buyer.id);
});

test("所有权挂牌只锁卖家自己的同名资产", () => {
  const service = new YellowDogsLeagueService({statePath:null,now:()=>NOW,rng:()=>.37});
  const owner = account("scope-owner"), holder = account("scope-holder");
  join(service,owner); const team = join(service,holder);
  const playerId = nonLegendBench(service,owner);
  const grant = ()=>service.grantS4Card(team,playerId,{grantOwnership:false,upgradeLevel:1});
  const card = grant(), material = grant(), spare = grant();
  const single = service.listCard(holder,card.id,20000,{compact:true}).listing;
  assert.equal(service.s4PlayerAssetDelta(owner.id,playerId).listed,false);
  const rights = service.listOwnership(owner,playerId,20000,null,{compact:true}).listing;
  service.cancelListing(holder,single.id);
  assert.equal(service.ownTeamView(holder).roster.find(player=>player.id===playerId).listed,false);
  service.validateTradeCards(holder.id,[card.id],"报价");
  service.releaseCard(holder,spare.id,false,{compact:true});
  service.enhanceS4Card(holder,card.id,material.id,false,{compact:true});
  service.listCard(holder,card.id,20000,{compact:true});
  service.cancelListing(owner,rights.id);
  service.returnOwnerships(owner,[playerId]);
  assert.equal(service.playerCards(holder.id,playerId).length,1);
});

test("单卡附权条件双向变化均自动撤单，旧报价不能成交，重新定价可成交", () => {
  const service = new YellowDogsLeagueService({statePath:null,now:()=>NOW,rng:()=>.37});
  const seller = account("terms-seller"), buyer = account("terms-buyer");
  const team = join(service,seller); join(service,buyer);
  const playerId = nonLegendBench(service,seller);
  const card = service.representativeCard(seller.id,playerId);
  card.upgradeLevel = 1;
  const list = price=>service.listCard(seller,card.id,price,{compact:true}).listing;
  const first = list(18000);
  assert.equal(first.includesOwnership,true);
  const extra = service.grantS4Card(team,playerId,{grantOwnership:false});
  service.save();
  const second = list(19000);
  assert.equal(second.includesOwnership,false);
  const released = service.releaseCard(seller,extra.id,false,{compact:true});
  assert.ok(released.listings.every(item=>item.id!==second.id));
  for (const old of [first,second]) {
    const closed = service.state.listings.find(item=>item.id===old.id);
    assert.equal(closed.status,"cancelled");
    assert.equal(closed.cancelReason,"ownership-terms-changed");
    const before = JSON.stringify(service.state);
    assert.throws(()=>service.buyListing(buyer,old.id));
    assert.equal(JSON.stringify(service.state),before);
    assert.equal(service.state.inbox[team.id].filter(mail=>mail.id==="listing-terms:"+old.id).length,1);
  }
  const current = list(22000);
  assert.equal(current.includesOwnership,true);
  const balance = service.wallet(buyer.id).balance;
  service.buyListing(buyer,current.id);
  assert.equal(service.wallet(buyer.id).balance,balance-22000);
  assert.equal(ownershipOwner(service.state,playerId),buyer.id);
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

test("成交兜底校验拒绝未刷新旧报价，旧存档缺失附权快照时不推测卖家意愿", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(),"ydl-terms-"));
  const options = {statePath:path.join(dir,"league.json"),backupDir:null,now:()=>NOW,rng:()=>.37};
  try {
    const service = new YellowDogsLeagueService(options);
    const seller = account("stale-seller"), buyer = account("stale-buyer");
    const team = join(service,seller); join(service,buyer);
    const playerId = nonLegendBench(service,seller);
    const first = service.representativeCard(seller.id,playerId);
    first.upgradeLevel = 1;
    const listing = service.listCard(seller,first.id,20000,{compact:true}).listing;
    const second = service.grantS4Card(team,playerId,{grantOwnership:false,upgradeLevel:1});
    const wallet = service.wallet(buyer.id).balance;
    assert.throws(()=>service.buyListing(buyer,listing.id),/自动撤回/);
    assert.equal(service.wallet(buyer.id).balance,wallet);
    assert.equal(first.ownerId,seller.id);
    assert.equal(ownershipOwner(service.state,playerId),seller.id);
    const next = service.listCard(seller,second.id,21000,{compact:true}).listing;
    const legacy = JSON.parse(readFileSync(options.statePath,"utf8"));
    delete legacy.listings.find(item=>item.id===next.id).includesOwnership;
    writeFileSync(options.statePath,JSON.stringify(legacy));
    const restored = new YellowDogsLeagueService(options);
    assert.equal(restored.activeListingsView().length,0);
    assert.equal(JSON.parse(readFileSync(options.statePath,"utf8")).listings.find(item=>item.id===next.id).status,"cancelled");
  } finally { rmSync(dir,{recursive:true,force:true}); }
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
  const team = join(service, user); addLegacyXPlayer(service, user);
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
function legacyXFixture(t, ownerId, role = "ST") {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account(ownerId);
  const team = join(service, user);
  const player = REAL_PLAYERS.find(p => isXPlayer(p) && !service.state.xPlayers.assignments[p.id]);
  const original = { ...player };
  t.after(() => {
    for (const key of Object.keys(player)) if (!(key in original)) delete player[key];
    Object.assign(player, original);
  });
  const id = addLegacyXPlayer(service, user, {role});
  return {service, user, team, id, card:service.representativeCard(user.id, id)};
}

test("旧X球员保留位置、身高、特性和免占名单待遇，新队无法重复领取", t => {
  const {service, user, team, id, card} = legacyXFixture(t, "x-config-first", "GK");
  const ownTeam = service.view(user).ownTeam;
  const player = ownTeam.roster.find(p => p.id === id);
  assert.deepEqual([player.grade, player.role, player.secondaryRole, player.heightCm], ["X","GK",null,180]);
  assert.deepEqual(player.cards[0].traits.map(trait => trait.id), card.traitIds);
  assert.equal(ownTeam.s4Assets.rosterSlotsUsed, team.rosterIds.length - 1);
  const other = account("x-config-second");
  const otherTeam = join(service, other);
  assert.ok(otherTeam.rosterIds.every(playerId => !isXPlayer(playerId)));
  assert.throws(() => service.chooseXPlayer(other, id), /新获取已暂停/);
  assert.equal(service.state.xPlayers.assignments[id], user.id);
});

test("X级球员不会进入普通卡包且不可后台发卡、挂牌或回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-protected-owner");
  const team = join(service, user); addLegacyXPlayer(service, user);
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

test("旧X球员的26项能力和身高可读取，购点与加点暂停", t => {
  const {service, user, id} = legacyXFixture(t, "x-growth-owner");
  const before = service.publicXGrowth(user.id);
  assert.deepEqual(before.attributes.map(a => a.key).sort(), [...ATTRIBUTE_NAMES].sort());
  assert.equal(before.height.key, "heightCm");
  const balance = service.wallet(user.id).balance;
  assert.throws(() => service.buyXGrowthPoints(user, 6), /巨星之路暂时关闭/);
  for (const field of [...ATTRIBUTE_NAMES, "heightCm"]) {
    assert.throws(() => service.spendXGrowthPoints(user, field, 1), /巨星之路暂时关闭/);
  }
  assert.equal(service.publicXGrowth(user.id).player.id, id);
  assert.deepEqual(service.publicXGrowth(user.id), before);
  assert.equal(service.wallet(user.id).balance, balance);
});

test("旧X球员批量和用尽余额加点均不消耗点数或触发保存", t => {
  const {service, user, id} = legacyXFixture(t, "x-growth-batch-owner");
  const growth = service.xGrowthState(id);
  growth.points = 9;
  const before = service.publicXGrowth(user.id);
  let saves = 0;
  service.save = () => { saves++; };
  for (const amount of [5, growth.points]) {
    assert.throws(() => service.spendXGrowthPoints(user, "passing", amount, {compact:true}), /巨星之路暂时关闭/);
    assert.deepEqual(service.publicXGrowth(user.id), before);
  }
  assert.equal(saves, 0);
});

test("读取旧X球员成长数据只查询一次代表卡", t => {
  const {service, user, id} = legacyXFixture(t, "x-growth-card-query");
  const representativeCard = service.representativeCard.bind(service);
  const calls = [];
  service.representativeCard = (...args) => {
    calls.push(args);
    return representativeCard(...args);
  };
  assert.equal(service.publicXGrowth(user.id).player.id, id);
  assert.deepEqual(calls, [[user.id, id]]);
});

test("旧X球员洗点关闭后保留投入和位置", t => {
  const {service, user, id} = legacyXFixture(t, "x-growth-reset-owner");
  const growth = service.xGrowthState(id);
  Object.assign(growth, {points:3, spentPoints:7});
  const before = structuredClone(service.xPlayerConfig(id));
  const wallet = service.wallet(user.id).balance;
  assert.throws(() => service.resetXGrowth(user, "GK", null), /巨星之路暂时关闭/);
  assert.deepEqual(service.xPlayerConfig(id), before);
  assert.deepEqual([growth.points,growth.spentPoints,service.wallet(user.id).balance], [3,7,wallet]);
});

test("旧X球员洗点关闭后保留初始特性与强化特性", t => {
  const {service, user, card} = legacyXFixture(t, "x-trait-reset");
  const alternatives = service.eligibleXTraits("ST").filter(trait => !card.traitIds.includes(trait.id));
  card.traitIds.push(alternatives[0].id);
  const before = [...card.traitIds];
  assert.throws(() => service.resetXGrowth(user, "ST", "LW", {traitId:alternatives[1].id}), /巨星之路暂时关闭/);
  assert.deepEqual(card.traitIds, before);
});

test("轻量与完整响应都隐藏旧X成长入口，写入请求均被拒绝", t => {
  const {service, user} = legacyXFixture(t, "x-growth-compact-owner");
  const compact = service.xGrowthMutationView(user);
  assert.equal(compact.xGrowth, null);
  assert.ok(compact.wallet && !("teams" in compact));
  const full = service.view(user);
  assert.equal(full.xGrowth, null);
  assert.ok(full.teams);
  for (const compact of [true, false]) {
    assert.throws(() => service.buyXGrowthPoints(user, 1, {compact}), /巨星之路暂时关闭/);
  }
});

test("旧X球员用同一请求重试洗点两次均不扣费、不写账", t => {
  const {service, user, id} = legacyXFixture(t, "x-growth-idempotent-owner");
  const growth = service.xGrowthState(id);
  growth.growthEpoch = 3;
  const balance = service.wallet(user.id).balance;
  const ledger = structuredClone(service.state.ledger);
  const options = {compact:true, requestId:"reset-request-1", traitId:service.eligibleXTraits("ST")[0].id};
  for (let i = 0; i < 2; i++) {
    assert.throws(() => service.resetXGrowth(user, "ST", "LW", options), /巨星之路暂时关闭/);
  }
  assert.equal(service.wallet(user.id).balance, balance);
  assert.equal(growth.growthEpoch, 3);
  assert.deepEqual(service.state.ledger, ledger);
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
  const service = new YellowDogsLeagueService({statePath:null, now:() => NOW, rng:() => .37});
  const sender = account("invite-from"), recipient = account("invite-to");
  join(service, sender);
  const result = service.createFriendlyInvitation(sender, join(service, recipient).id, {compact:true});
  assert.equal(result.compact, true);
  assert.equal(result.teams, undefined);
  const [invitation] = result.friendlyInvitations;
  assert.equal(invitation.expiresAt, NOW + 2 * 3600000);
  const status = (now, item = invitation) => resolveInboxAction({type:"friendly-invite"}, {invitation:item, now}).status;
  assert.equal(status(invitation.expiresAt - 1), "pending");
  assert.equal(status(invitation.expiresAt), "expired");
  assert.equal(status(invitation.expiresAt, {...invitation, status:"accepted"}), "accepted");
  assert.match(apiSource, /createFriendlyInvitation\(account, body\.targetTeamId, \{ compact:true \}\)/);
  assert.match(serviceSource, /friendlyInvitationMutationView\(account\)/);
  assert.match(serviceSource, /const FRIENDLY_INVITATION_TTL_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(serviceSource, /expireFriendlyInvitations\(now/);
  assert.match(serviceSource, /this\.save\(\{ skipDailyBackup:true \}\)/);
});

test("战术原则界面保留分阶段详细指令与七项高级微调", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../versus/public/tactics-interface.js", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");
  assert.ok(ui.includes("有球进攻") && ui.includes("无球防守"));
  assert.ok(ui.includes('"InDetail"') && ui.includes('"OutDetail"'));
  assert.ok(ui.includes("TACTICAL_DIMENSION_LABELS") && ui.includes("data-tactical-dimension-output"));
  assert.ok(ui.includes("data-tactical-mentality") && ui.includes("data-league-principle"));
  assert.ok(appSource.includes("principlePlanMarkup(state, label, plan, effectiveLeaguePlanDimensions(plan))"));
  assert.ok(serviceSource.includes("tacticalPrincipleFields(plans[state], fallback)"));
});
test("新版心态与原则控件不再进入旧版整体滑杆重置入口", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.ok(appSource.includes("applyLeaguePrincipleChange(mentalityButton.dataset.planState"));
  assert.ok(appSource.includes("changeTacticalPrinciple(previous, key, value"));
  assert.ok(!appSource.includes("syncLeagueTacticalPresetControls"));
  assert.ok(appSource.includes("function originalV2StyleForPlan("));
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
  assert.match(appSource, /if \(event\.button !== 0 \|\| event\.target\.closest\("\[data-league-duty-step\], \[data-league-duty-open\]"\)\) return/);
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
  assert.match(appSource, /function renderLeagueReviewPanel\(/);
  assert.match(appSource, /reviewHistory/);
});

test("旧X球员达到下一出场里程碑仍保留已领奖进度，重复结算不发点", t => {
  const {service, user, team, id} = legacyXFixture(t, "x-growth-long-chain");
  const key = team.id + ":" + id;
  service.state.playerStats[key] = {key, playerId:id, teamId:team.id, appearances:25};
  const growth = service.xGrowthState(id);
  Object.assign(growth, {points:4, earnedPoints:8, taskClaims:{appearances:5}});
  const before = structuredClone(growth);
  for (let i = 0; i < 2; i++) assert.equal(service.settleXGrowthTasks(id), 0);
  assert.deepEqual(service.xGrowthState(id), before);
  const task = service.publicXGrowth(user.id).tasks.find(task => task.id === "appearances");
  assert.equal(task.value, 25);
  assert.equal(task.completed, 5);
});

test("旧X球员存档重载后以62为基础总评并正确叠加强化", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ydl-x-overall-"));
  const statePath = path.join(directory, "league.json");
  try {
    const user = account("x-old-save-owner");
    const first = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const team = join(first, user); addLegacyXPlayer(first, user);
    const xPlayerId = team.rosterIds.find(isXPlayer);
    const card = first.representativeCard(user.id, xPlayerId);
    card.upgradeLevel = 5;
    delete first.state.xPlayers.configs[xPlayerId].baseAbilityOverall;
    delete first.state.xPlayers.configs[xPlayerId].overall;
    first.save({ skipDailyBackup:true });

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const view = reloaded.view(user);
    assert.equal(view.xGrowth,null);
    const savedGrowth = reloaded.publicXGrowth(user.id);
    const xPlayer = view.ownTeam.roster.find((player) => player.id === xPlayerId);
    assert.equal(savedGrowth.player.overall, 69);
    assert.equal(xPlayer.baseOverall, 62);
    assert.equal(xPlayer.effectiveOverall, 69);
    assert.equal(xPlayer.cards[0].effectiveOverall, 69);
    assert.equal(savedGrowth.baseOverall, 62);
    assert.equal(savedGrowth.effectiveOverall, 69);
    assert.equal(savedGrowth.upgradeLevel, 5);
    assert.ok(savedGrowth.attributes.every((attribute) => attribute.effectiveValue === attribute.value + 7));
    assert.equal(savedGrowth.height.effectiveValue, savedGrowth.height.value);
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
    const team = join(first, user); addLegacyXPlayer(first, user);
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
    assert.equal(view.xGrowth,null);
    const savedGrowth = reloaded.publicXGrowth(user.id);
    assert.equal(reloaded.state.xPlayers.configs[xPlayerId].baseAbilityOverall, 51);
    assert.equal(savedGrowth.baseOverall, 78);
    assert.equal(savedGrowth.effectiveOverall, 87);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("旧X球员不能作副卡，作主卡也不能突破解锁特性的强化档", t => {
  const {service, user, team, id, card} = legacyXFixture(t, "x-enhancement-owner");
  const materialId = team.rosterIds.find(playerId => !isXPlayer(playerId) && REAL_PLAYER_BY_ID[playerId].role === "ST");
  const material = service.grantS4Card(team, materialId, {grantOwnership:false, upgradeLevel:3});
  assert.throws(() => service.enhanceS4Card(user, material.id, card.id), /只能作为强化主卡/);
  for (const level of [3,6]) {
    card.upgradeLevel = level;
    const before = structuredClone(service.state.s4Assets);
    assert.throws(() => service.enhanceS4Card(user, card.id, material.id), /成长暂时关闭/);
    assert.deepEqual(service.state.s4Assets, before);
    assert.equal(service.representativeCard(user.id, id).upgradeLevel, level);
  }
});

test("旧X主卡强化被拒后保留普通球员最后一张所有权锚点卡", t => {
  const {service, user, team, card} = legacyXFixture(t, "x-anchor-material");
  const playerId = team.rosterIds.find(id => !isXPlayer(id) && REAL_PLAYER_BY_ID[id].grade !== "S");
  const anchor = service.representativeCard(user.id, playerId);
  assert.equal(service.playerCards(user.id, playerId).length, 1);
  assert.throws(() => service.enhanceS4Card(user, card.id, anchor.id), /成长暂时关闭/);
  assert.equal(anchor.status, "active");
  assert.equal(ownershipOwner(service.state, playerId), user.id);
  assert.ok(team.rosterIds.includes(playerId));
  assertS4AssetInvariants(service.state);
});

test("旧X主卡强化被拒后最后一张传奇材料仍留在名单和存档", t => {
  const {service, user, team, card} = legacyXFixture(t, "x-legend-material");
  for (const legendId of ["legend-messi-rat", "legend-pele"]) {
    const material = service.playerCards(user.id, legendId)[0] ??
      service.grantS4Card(team, legendId, {grantOwnership:false, acquisitionSource:"regression-test"});
    assert.equal(service.playerCards(user.id, legendId).length, 1);
    const before = structuredClone(team.playerState[legendId]);
    assert.ok(before);
    assert.throws(() => service.enhanceS4Card(user, card.id, material.id), /成长暂时关闭/);
    assert.equal(service.playerCards(user.id, legendId)[0].id, material.id);
    assert.ok(team.rosterIds.includes(legendId));
    assert.deepEqual(team.playerState[legendId], before);
    assertS4AssetInvariants(service.state);
  }
});

test("X级球员只能无金币一换一且成交后完整交换归属", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("x-trade-first");
  const second = account("x-trade-second");
  const observer = account("x-trade-observer");
  const firstTeam = join(service, first); addLegacyXPlayer(service, first);
  const secondTeam = join(service, second); addLegacyXPlayer(service, second);
  join(service, observer); addLegacyXPlayer(service, observer);
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
  assert.equal(service.state.teams.length, 16);
  assert.ok(service.state.teams.every(team => !team.ownerId && new Set(team.rosterIds).size === 23));
});

test("联赛主题默认深色，读回用户选择并兼容旧偏好", () => {
  const values = new Map();
  const env = {localStorage:{getItem:key => values.get(key), setItem:(key, value) => values.set(key, value)}};
  assert.equal(createGameSettings(env).value.theme, "dark");
  values.set("yellowdogs_league_desktop_theme_v1", "light");
  const settings = createGameSettings(env);
  assert.equal(settings.value.theme, "light");
  for (const theme of ["dark", "light"]) {
    assert.equal(settings.update({theme}).saved, true);
    assert.equal(createGameSettings(env).value.theme, theme);
    assert.equal(values.get("yellowdogs_league_desktop_theme_v1"), theme);
  }
});
test("页面刷新仅在账号凭证明确失效时清除本地登录态", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../devtool/server.js", import.meta.url), "utf8");
  const roomServiceSource = readFileSync(new URL("../versus/room-service.js", import.meta.url), "utf8");

  assert.match(appSource, /if \(error\.status === 401\) \{[\s\S]*?storeAccount\(null\);[\s\S]*?storeSession\(null\);/);
  assert.match(serverSource, /sendJson\(response, error\.statusCode \?\? 400,/);
  assert.match(roomServiceSource, /凭证无效"\), \{ statusCode:401 \}\)/);
});

test("页面刷新按账号恢复联赛或YFFM1 TV的当前页面", () => {
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
  assert.ok((leagueSource.match(/injuryAbsenceMatches\(player\)/g) ?? []).length >= 4);
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

  assert.match(indexSource, /YFFM1/);
  assert.match(indexSource, /YFFM1/);
  assert.match(indexSource, /id="league-topbar-club"/);
  assert.doesNotMatch(appSource, /<header class="league-top">/);
  assert.match(appSource, /patchHtmlChildren\(leagueTopbarClub,/);
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
  assert.match(appSource, /function syncLeagueBackpackPackMutationInPlace\(\{ syncPackDialog = true \} = \{\}\)[\s\S]*currentSection\.outerHTML = leagueBackpackPackSectionMarkup\(inventory\)/);
  const openPack = appSource.match(/async function openLeaguePlayerPack\(packId, trigger = null\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(openPack, /leagueRequest\('\/packs\/open', \{ packId \}, \{ render:false, ignoreStale:true \}\)/);
  assert.match(openPack, /syncLeagueBackpackPackMutationInPlace\(\{ syncPackDialog:false \}\)/);
  assert.doesNotMatch(openPack, /renderLeague\(\)/);
  assert.match(appSource, /leagueRequest\("\/packs\/open-batch", \{ packIds \}, \{ render:false, ignoreStale:true \}\)[\s\S]*syncLeagueBackpackPackMutationInPlace\(\{ syncPackDialog:false \}\)/);
  const choosePack = appSource.match(/async function chooseS4PackCard\(button\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(choosePack, /\{ render:false, ignoreStale:true \}/);
  assert.match(choosePack, /syncLeagueBackpackPackMutationInPlace\(\{ syncPackDialog:false \}\)/);
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
  assert.match(appSource, /const weather = next\.weather[\s\S]*天气待公布/);
  assert.match(appSource, /const referee = next\.referee[\s\S]*友谊赛裁判将在比赛开始时确定/);
  assert.match(appSource, /data-s4-pack-manage-roster/);
  assert.match(appSource, /leagueBackpackPage = ['"]cards['"];[\s\S]*closeLeagueDialog\(\);[\s\S]*renderLeague\(\)/);
  const syncChoice = appSource.match(/function syncS4PackChoiceDialog\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(syncChoice, /leagueTab !== "backpack" \|\| leagueBackpackPage !== "packs"[\s\S]*closeLeagueDialog\(\)[\s\S]*return;/);
  assert.match(syncChoice, /const offer = league\.s4Packs\?\.offer/);
  assert.match(styles, /\.s4-pack-choice-footer\{[^}]*display:flex[^}]*justify-content:space-between/);
});
test("战术板场上磁贴松手后只做局部同步而不整页重绘", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function refreshLeagueSquadPositionUi\(\)/);
  assert.match(appSource, /patchDomElement\(currentMagnet, nextMagnet\)/);
  assert.match(appSource, /patchDomElement\(currentLines, nextLines\)/);
  const drops = [...appSource.matchAll(/if \(moved\) \{([\s\S]*?)\n      \}/g)];
  assert.equal(drops.length, 2);
  for (const [, body] of drops) {
    assert.match(body, /leagueEditorDirty = true/);
    assert.match(body, /refreshLeagueSquadPositionUi\(\)/);
    assert.match(body, /scheduleLeagueTeamAutoSave\(180\)/);
    assert.doesNotMatch(body, /renderLeague\(\)/);
  }
});

test("强化页局部刷新会同步复用卡片的等级与卡面内容", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /patchHtmlElement\(current, leagueEnhancementMarkup\(\)\)/);
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
  assert.match(appSource, /const low = belowFitnessThreshold\(fitness,threshold\)/);
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
  const rulesSource = readFileSync(new URL("../versus/public/inbox-rules.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /async function leagueInboxReadRequest\(messageId\)/);
  assert.match(appSource, /inboxReadSync\.read\(\[messageId\], \{single:true\}\)/);
  assert.doesNotMatch(appSource, /leagueRequest\("\/inbox\/read"/);
  assert.match(apiSource, /readInbox\(account, body\.messageId, \{ compact:true,expectedUpdatedAt:body.expectedUpdatedAt \}\)/);
  assert.match(apiSource, /readInboxBatch\(account, body\.messageIds, \{category:body.category\}\)/);
  assert.match(rulesSource, /id:'action',label:'待处理'/);
  assert.match(rulesSource, /'trade-offer':\{label:'交易报价',category:'trades'\}/);
  assert.match(rulesSource, /announcement:\{label:'全服公告',category:'announcements'\}/);
  assert.match(rulesSource, /'admin-update':\{label:'管理员公告',category:'announcements'\}/);
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
  const tie = {teams:[{id:"a",name:"A"},{id:"b",name:"B"}], winnerId:"a", legs:[
    {number:1,homeName:"A",awayName:"B",score:[2,0],matchId:"first-leg"},
    {number:2,homeName:"B",awayName:"A",score:[1,1],matchId:"return-leg"},
  ]};
  const bracket = knockoutCupMarkup({cup:{knockout:{semifinals:[tie]}}}, String, (_,name) => name, String);
  assert.match(bracket, /class="knockout-scroll"/);
  assert.match(bracket, /data-league-match-detail="first-leg"/);
  assert.match(bracket, /data-league-match-detail="return-leg"/);
  assert.match(bracket, /总比分 3 : 1/);
  assert.match(bracket, /晋级：A/);
  assert.ok(appSource.includes("leagueInboxReadRequest(leagueInboxMessageId)"));
  assert.ok(appSource.includes('const inboxMessage = event.target.closest("[data-league-inbox-message]");'));
  assert.ok(appSource.includes('scrollIntoView({ behavior:"smooth", block:"start" })'));
  assert.match(styles, /.enhancement-card-grid .s4-player-card-traits{display:block/);
});

test("tactical board bond bonus display is optional and disabled by default", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.equal(DEFAULT_GAME_SETTINGS.bondBonuses, false);
  assert.match(appSource, /data-league-bond-bonus-toggle/);
  assert.match(appSource, /applyTacticalBondBonuses\(starters\.map/);
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
  assert.equal(player.effectiveHeightCm, baseHeightCm - 5);

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
  assert.equal(player.fixedFitness, 94);
  assert.equal(player.effectiveFitness, 94);

  const selection = service.selectActualLineup(team, 1, "league");
  assert.equal(selection.rotations.some((entry) => entry.outId === starterId), false);
  assert.equal(selection.lineup.find((entry) => entry.id === starterId)?.state.fitness, 94);

  assert.equal(competitionAvailability(player, "league").fitness, 94);
  assert.equal(competitionAvailability(player, "league").unavailable, false);
});

test("mobile tactical controls avoid full-form work during pointer frames", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const inputHandler = appSource.slice(appSource.indexOf('app.addEventListener("input"'), appSource.indexOf('app.addEventListener("keydown"', appSource.indexOf('app.addEventListener("input"')));
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
  assert.match(appSource, /function predictionPayoutText[\s\S]*?toFixed\(2\)/);
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

test("existing X goalkeeper still plays formal matches while growth rewards stay paused", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-v2-save-task-owner");
  const team = join(service,user);
  const xPlayerId = addLegacyXPlayer(service,user,{role:"GK"});
  const replacedGoalkeeperId = team.preferredStarterIds.find((playerId) => REAL_PLAYER_BY_ID[playerId]?.role === "GK");
  team.preferredStarterIds = team.preferredStarterIds.map((playerId) => playerId === replacedGoalkeeperId ? xPlayerId : playerId);
  Object.values(team.positionPresets).forEach((preset) => {
    preset[xPlayerId] = preset[replacedGoalkeeperId];
    delete preset[replacedGoalkeeperId];
  });
  team.positions = structuredClone(team.positionPresets.position1);

  service.saveTeam(user, { starterIds:team.preferredStarterIds, positionPresets:team.positionPresets, formationLinePresets:team.formationLinePresets, tacticalPlans:team.tacticalPlans });
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
  assert.equal(service.view(user).xGrowth,null);
  assert.equal(service.xGrowthState(xPlayerId).earnedPoints,0);
});

test("保留现有世界杯模式和国家队战术接口", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const adminApiSource = readFileSync(new URL("../versus/admin-api.js", import.meta.url), "utf8");
  const adminSource = readFileSync(new URL("../admin/public/app.js", import.meta.url), "utf8");

  assert.match(appSource, /worldCup/);
  assert.match(apiSource, /world-cup\/roster/);
  assert.match(apiSource, /world-cup\/tactics/);
});

test("冠军杯按十六强、八强、半决赛与单场决赛呈现对阵", () => {
  const service = new YellowDogsLeagueService({statePath:null, now:() => NOW});
  const league = service.view(account("cup-observer"));
  const html = knockoutCupMarkup(league, String, (_, name) => name, String);
  const stages = [...html.matchAll(/data-cup-stage="([^"]+)">([\s\S]*?)(?=<\/section>)/g)];
  assert.deepEqual(stages.map(([,id]) => id), ["roundOf16", "quarterfinals", "semifinals", "final"]);
  assert.deepEqual(stages.map(([, ,body]) => (body.match(/<article /g) ?? []).length), [8,4,2,1]);
  for (const [,id,body] of stages) assert.match(body, id === "final" ? /单场/ : /两回合/);
});

test("新版电视台复用现有转播资源并把双方阵型压缩到各自半场", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /function broadcastCombinedPosition[\s\S]*?y:50 \+ y \* \.5[\s\S]*?x:100 - x, y:50 - y \* \.5/);
  assert.match(appSource, /function broadcastCombinedPitchMarkup[\s\S]*?broadcastMagnet[\s\S]*?pitchMarkup/);
  assert.match(appSource, /function broadcastV2MatchLayoutMarkup[\s\S]*?matchEventMarkup[\s\S]*?matchStatsMarkup/);
  assert.match(appSource, /\$\{broadcastV2MatchLayoutMarkup\(match, broadcast, highlight\)\}/);
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
  assert.match(appSource, /broadcast-v2-commentary[\s\S]*?<h2>\$\{broadcast\.live[^\n]*?<div class="broadcast-v2-team-strategies">/);
  assert.doesNotMatch(appSource, /legacyLayout\.outerHTML|dockBroadcastTeamStrategies\(content\)/);
  assert.match(styles, /\.broadcast-v2-stadium\{width:100%;height:100%;min-height:0;margin:0;display:grid;place-items:center/);
  assert.match(styles, /\.broadcast-v2-commentary>header\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(appSource, /function fieldRoleAbbreviation[\s\S]*?return dutyFieldPosition\(matchedCode \?\? raw, duty\)/);
  assert.match(appSource, /function leagueBoardMagnet[\s\S]*?<span class="league-magnet-role">\$\{escapeHtml\(fieldRoleAbbreviation\(assignedRole, leaguePlayerDutySelection\(player.id, assignedRole\)\)\)\}<\/span>/);
  assert.match(appSource, /function broadcastMagnet[\s\S]*?<span class="league-magnet-role">\$\{escapeHtml\(fieldPosition\)\}<\/span>/);
  assert.match(styles, /\.broadcast-v2-pitch \.s4-broadcast-magnet \.league-magnet-role\{margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none/);
  assert.match(styles, /\.broadcast-v2-team-strategies>div>span\{[^}]*display:flex[^}]*white-space:nowrap\}[\s\S]*?\.broadcast-v2-team-strategies small\{[^}]*font-size:9px[^}]*white-space:nowrap/);
  assert.match(styles, /@media\(min-width:821px\)\{\.broadcast-v2-sidebar\{grid-template-rows:minmax\(0,1\.45fr\) minmax\(390px,1fr\)\}\}[\s\S]*?\.broadcast-v2-data-panel \.live-stats\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.broadcast-v2-ad,\.broadcast-v2-half-label\{display:none\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.pitch-penalty-arc\{width:28%\}/);
  assert.match(styles, /\.broadcast-v2-pitch \.pitch-penalty-arc-top\{top:2%;clip-path:inset\(78% 0 0 0\)\}/);
});

test("AI training hides batch and compute controls while retaining their implementation and single mirrors", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../devtool/server.js", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../devtool/mirror-batch-worker.js", import.meta.url), "utf8");
  const tacticsToolbarSource = appSource.slice(appSource.indexOf("const aiTrainingButton ="), appSource.indexOf("detail.innerHTML", appSource.indexOf("const aiTrainingButton =")));
  const aiDialogSource = appSource.slice(appSource.indexOf("function aiTrainingDialogMarkup"), appSource.indexOf("function openAiTrainingDialog"));
  assert.match(appSource, /const LEAGUE_AI_BATCH_UI_ENABLED = false;/);
  assert.match(aiDialogSource, /if \(LEAGUE_AI_BATCH_UI_ENABLED\) \{/);
  assert.match(aiDialogSource, /\$\{batchControls\}<button type="submit"/);
  assert.match(aiDialogSource, /休赛期玩家镜像/);
  assert.match(appSource, /function openMirrorBatchCapacityDialog\(entries = \[\]\)/);
  assert.match(appSource, /name="executionNode" data-ai-training-node-select/);
  assert.match(appSource, /玩家计算节点市场/);
  assert.doesNotMatch(tacticsToolbarSource, /data-compute-nodes-open/);
  assert.match(aiDialogSource, /data-compute-nodes-open>管理计算节点/);
  assert.match(appSource, /overlay\.querySelector\("\[data-compute-nodes-open\]"\)\?\.addEventListener\("click", openComputeNodeMarketDialog\)/);
  assert.match(appSource, /compute-node\/save/);
  assert.match(appSource, /Math\.round\(price \* batchCount \/ batchPriceDivisor\)/);
  assert.match(aiDialogSource, /data-ai-training-node-select/);
  assert.match(appSource, /系统AI批量模拟\$\{batchCount\}场免费/);
  assert.match(appSource, /本次密钥有效至\$\{escapeHtml\(expiresAt\)\}（12小时）/);
  assert.match(appSource, /自有节点免服务费/);
  assert.match(appSource, /batchPriceDivisor/);
  assert.match(appSource, /data-ai-training-node-status/);
  assert.match(appSource, /在线待机 · 未接受任务/);
  assert.match(appSource, /acceptingJobs === false/);
  assert.match(workerSource, /YDL_MIRROR_WORKER_ACCEPT_JOBS/);
  assert.match(appSource, /executionNode[,:]/);
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
