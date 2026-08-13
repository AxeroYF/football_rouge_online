import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const NOW = Date.parse("2026-08-12T00:05:00+08:00");

function ownTeam(service, ownerId, ownerName, teamName) {
  const team = service.state.teams[0];
  Object.assign(team, { ownerId, ownerName, name:teamName });
  return team;
}

test("荣誉室使用恢复的13季队史并展示玩家当前最高强化卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const account = { id:"P-A927135074", nickname:"Akira" };
  const team = ownTeam(service, account.id, account.nickname, "芋泥暖香柑");
  service.grantS4Card(team, "legend-cristiano-ronaldo", { grantOwnership:false, upgradeLevel:3, acquisitionSource:"honor-test" });
  service.grantS4Card(team, "legend-cristiano-ronaldo", { grantOwnership:false, upgradeLevel:7, acquisitionSource:"honor-test" });

  const honorRoom = service.honorRoomView(account);
  assert.equal(honorRoom.seasonCount, 13);
  assert.deepEqual(honorRoom.honors.league, ["S2","S6","S8","S9","S10","S12"]);
  assert.deepEqual(honorRoom.appearances.map((entry) => entry.player.name), ["鲁本迪亚斯","维蒂尼亚","C罗"]);
  assert.equal(honorRoom.appearances[2].card.upgradeLevel, 7);
  assert.equal(honorRoom.appearances[2].card.effectiveOverall > honorRoom.appearances[2].player.overall, true);
  assert.equal(honorRoom.ballonDor.record.player.name, "C罗");
});

test("每日完赛快照合并联赛杯赛且按赛季ID幂等更新荣誉室", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const account = { id:"honor-daily-owner", nickname:"队史玩家" };
  const team = ownTeam(service, account.id, account.nickname, "每日荣誉队");
  team.table.points = 99;
  team.table.goalsFor = 30;
  service.state.season.status = "completed";
  service.state.season.completedAt = NOW - 60_000;
  service.state.playerStats[`${team.id}:legend-messi`] = { playerId:"legend-messi", playerName:"梅西", teamId:team.id, teamName:team.name, appearances:18, goals:12, assists:7, ratingTotal:129.6 };
  service.state.cup.status = "completed";
  service.state.cup.championId = team.id;
  service.state.cup.playerStats[`${team.id}:legend-messi`] = { playerId:"legend-messi", playerName:"梅西", teamId:team.id, teamName:team.name, appearances:6, goals:5, assists:3, ratingTotal:45.6 };
  service.state.ballonDor.results.push({ seasonId:service.state.season.id, status:"completed", winner:{ ownerId:account.id, playerId:"legend-messi", playerName:"梅西" } });

  const completedSeasonId = service.state.season.id;
  service.resetDailyCompetitions({ manual:true, skipRewardCheck:true, skipBackup:true, skipArchive:true, skipSave:true, skipView:true });
  const honorRoom = service.honorRoomView(account);
  assert.deepEqual(honorRoom.honors.league, ["S14"]);
  assert.deepEqual(honorRoom.honors.cup, ["S14"]);
  assert.deepEqual([honorRoom.scorer.appearances, honorRoom.scorer.goals, honorRoom.scorer.assists], [24,17,10]);
  assert.equal(honorRoom.ballonDor.season, "S14");
  assert.equal(service.state.honorRoom.processedSeasonIds.filter((id) => id === completedSeasonId).length, 1);
  assert.equal(service.updateHonorRoomForCompletedSeason(), false);
});

test("正式导航包含荣誉室且奖杯铭牌仅显示放大的赛季", () => {
  const app = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../versus/public/index.html", import.meta.url), "utf8");
  const demo = readFileSync(new URL("../versus/public/honor-room-demo.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/honor-room.css", import.meta.url), "utf8");
  assert.match(app, /data-league-tab="honorRoom">荣誉室/);
  assert.match(index, /\/versus\/honor-room\.css/);
  assert.doesNotMatch(`${app}\n${demo}`, /每一座奖杯对应一次冠军|俱乐部正式比赛出场纪录前三名/);
  assert.doesNotMatch(app, /<figcaption><b>\$\{escapeHtml\(season\)\}<\/b><small>/);
  assert.match(styles, /\.honor-trophy figcaption b \{[^}]*font:700 18px/);
});

test("荣誉室按每日版本按需加载并延迟高清资源解码", () => {
  const app = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const api = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("../versus/league-service.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../versus/public/honor-room.css", import.meta.url), "utf8");
  const viewSource = service.slice(service.indexOf("  view(account, options = {})"), service.indexOf("  standings()"));

  assert.doesNotMatch(viewSource, /honorRoom:this\.honorRoomView/);
  assert.match(viewSource, /honorRoomUpdatedAt:this\.state\.honorRoom\.updatedAt/);
  assert.match(api, /\/api\/versus\/league\/honor-room/);
  assert.match(app, /async function loadLeagueHonorRoom/);
  assert.match(app, /cached\?\.updatedAt === withDirectory\.honorRoomUpdatedAt/);
  assert.match(app, /loading="lazy" fetchpriority="low"/);
  assert.match(app, /const HONOR_TROPHY_DIMENSIONS/);
  assert.match(styles, /content-visibility:auto/);
  assert.match(styles, /contain-intrinsic-size:auto 820px/);
});
