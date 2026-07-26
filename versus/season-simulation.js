import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { YellowDogsLeagueService } from "./league-service.js";
import { REAL_PLAYER_BY_ID } from "./player-pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.join(here, "season-simulation-config-s3.json");

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function freshTable() {
  return { played:0, won:0, drawn:0, lost:0, goalsFor:0, goalsAgainst:0, points:0 };
}

function roundRobin(teamIds) {
  const rotation = [...teamIds];
  const firstHalf = [];
  for (let round = 0; round < rotation.length - 1; round += 1) {
    const fixtures = [];
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      fixtures.push({ homeId:round % 2 === 0 ? left : right, awayId:round % 2 === 0 ? right : left, matchId:null });
    }
    firstHalf.push(fixtures);
    rotation.splice(1, 0, rotation.pop());
  }
  return [...firstHalf, ...firstHalf.map((fixtures) => fixtures.map((fixture) => ({ homeId:fixture.awayId, awayId:fixture.homeId, matchId:null })))]
    .map((fixtures, index) => ({ number:index + 1, status:"pending", fixtures }));
}

function seededRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function assertConfig(config) {
  if (!Number.isInteger(config.iterations) || config.iterations < 1) throw new Error("iterations必须是正整数");
  if (!Array.isArray(config.teams) || config.teams.length !== 10) throw new Error("赛季模拟需要正好10支球队");
  const teamIds = new Set(config.teams.map((team) => team.id));
  if (teamIds.size !== 10) throw new Error("球队ID必须唯一");
  for (const team of config.teams) {
    if (!team.name || !Array.isArray(team.rosterIds) || !Array.isArray(team.preferredStarterIds)) throw new Error(`球队配置不完整：${team.id}`);
    if (team.preferredStarterIds.length !== 11 || new Set(team.preferredStarterIds).size !== 11) throw new Error(`${team.name}必须配置11名不同首发`);
    if (team.preferredStarterIds.some((id) => !team.rosterIds.includes(id))) throw new Error(`${team.name}的首发不在球队名单中`);
    const unknown = team.rosterIds.filter((id) => !REAL_PLAYER_BY_ID[id]);
    if (unknown.length) throw new Error(`${team.name}包含未知球员：${unknown.join(", ")}`);
    if (team.preferredStarterIds.some((id) => !team.positions?.[id])) throw new Error(`${team.name}缺少首发战术板位置`);
  }
}

function emptyCup() {
  return { status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null };
}

function configuredTeam(source, index) {
  return {
    id:source.id,
    name:source.name,
    ownerId:`simulation-owner-${index + 1}`,
    ownerName:source.coach ?? `模拟教练${index + 1}`,
    joinedAt:0,
    rosterIds:[...source.rosterIds],
    preferredStarterIds:[...source.preferredStarterIds],
    positions:structuredClone(source.positions),
    positionPresets:structuredClone(source.positionPresets ?? { position1:source.positions, position2:source.positions, position3:source.positions }),
    tactic:source.tactic,
    style:source.style,
    attackFocus:source.attackFocus ?? "balanced",
    defenseFocus:source.defenseFocus ?? "balanced",
    fitnessThreshold:Number(source.fitnessThreshold ?? 65),
    tacticalPlans:structuredClone(source.tacticalPlans),
    playerState:Object.fromEntries(source.rosterIds.map((id) => [id, { fitness:100, suspension:0, cupSuspension:0, injuryRounds:0 }])),
    chemistry:{},
    championBadges:[],
    table:freshTable(),
    form:[],
  };
}

function simulationS4Assets(teams, now) {
  const cards = {};
  const ownerships = {};
  let sequence = 1;
  teams.forEach((team) => team.rosterIds.forEach((playerId) => {
    const id = `simulation-card-${sequence++}`;
    cards[id] = {
      id,
      playerId,
      ownerId:team.ownerId,
      upgradeLevel:0,
      traitIds:[],
      acquisitionSource:"season-simulation",
      externalAcquisition:false,
      status:"active",
      createdAt:now,
      acquiredAt:now,
    };
    if (!REAL_PLAYER_BY_ID[playerId]?.legendAbility && !ownerships[playerId]) ownerships[playerId] = team.ownerId;
  }));
  return { schemaVersion:1, nextCardSequence:sequence, ownerships, cards, transactions:[] };
}

function buildService(config, iteration) {
  let now = Date.UTC(2026, 0, 1, 2, 0, 0) + iteration * 86_400_000;
  const service = new YellowDogsLeagueService({ statePath:null, backupDir:null, now:() => now, rng:seededRandom(`${config.seed}:rng:${iteration}`) });
  const teams = config.teams.map(configuredTeam);
  const seasonId = `simulation-${config.seed}-${iteration}`;
  service.state = {
    version:2,
    ruleset:"S4",
    season:{ id:seasonId, name:"SIM", date:localDateKey(new Date(now)), status:"active", currentRound:0, totalRounds:18, nextRoundAt:now, firstRoundAt:now, startedAt:now, completedAt:null },
    teams,
    rounds:roundRobin(teams.map((team) => team.id)),
    matches:[],
    playerStats:{},
    drafts:{},
    wallets:{},
    ledger:[],
    listings:[],
    reports:{},
    inbox:{},
    inboxDeleted:{},
    shopOffers:{},
    rewardOffers:{},
    adminPackGrants:[],
    s4Packs:{ schemaVersion:1, nextSequence:1, inventory:{}, offers:{}, grants:[], legacyRetiredAt:now },
    s4Assets:simulationS4Assets(teams, now),
    liveRound:null,
    liveCupRound:null,
    cup:emptyCup(),
    completedBroadcasts:[],
    archives:[],
    updatedAt:now,
  };
  service.recordMatchEvents = false;
  service.save = () => {};
  service.payRewards = () => {};
  service.dispatchAdminRewardGrants = () => {};
  service.createRoundInbox = () => {};
  service.updateDailyReports = () => {};
  service.createCupMatchInbox = () => {};
  service.grantCupReward = () => null;
  return { service, advanceClock:() => { now += 20 * 60 * 1000; } };
}

function knockoutParticipants(ties = []) {
  return new Set(ties.flatMap((tie) => tie.teams ?? []));
}

function cupPlacements(cup) {
  const quarterfinalists = knockoutParticipants(cup.knockout.quarterfinals);
  const semifinalists = knockoutParticipants(cup.knockout.semifinals);
  const finalists = knockoutParticipants(cup.knockout.final);
  const championId = cup.championId;
  const result = {};
  for (const teamId of cup.participants) {
    if (teamId === championId) result[teamId] = { stage:"champion", rankEquivalent:1 };
    else if (finalists.has(teamId)) result[teamId] = { stage:"runnerUp", rankEquivalent:2 };
    else if (semifinalists.has(teamId)) result[teamId] = { stage:"semifinal", rankEquivalent:3.5 };
    else if (quarterfinalists.has(teamId)) result[teamId] = { stage:"quarterfinal", rankEquivalent:6.5 };
    else result[teamId] = { stage:"swiss", rankEquivalent:9.5 };
  }
  return result;
}

function simulateSeason(config, iteration) {
  const { service, advanceClock } = buildService(config, iteration);
  const cupEnabled = config.cup?.enabled !== false;
  const cupStartAfterRound = Math.max(0, Math.min(18, Number(config.cup?.startAfterLeagueRound ?? 0)));
  while (service.state.season.status === "active") {
    if (cupEnabled && service.state.cup.status === "waiting" && service.state.season.currentRound >= cupStartAfterRound) service.startCup();
    service.simulateNextRound();
    advanceClock();
  }
  if (cupEnabled && service.state.cup.status === "waiting") service.startCup();
  let cupGuard = 0;
  while (cupEnabled && service.state.cup.status === "active" && cupGuard < 20) {
    service.simulatePendingCupEvent();
    advanceClock();
    cupGuard += 1;
  }
  if (cupEnabled && service.state.cup.status !== "completed") throw new Error(`第${iteration + 1}次模拟的杯赛未能完成`);
  const standings = service.standings();
  const cup = cupEnabled ? cupPlacements(service.state.cup) : {};
  return {
    iteration:iteration + 1,
    league:standings.map((standing) => {
      const team = service.state.teams.find((entry) => entry.id === standing.id);
      return { id:team.id, name:team.name, rank:standing.rank, played:team.table.played, won:team.table.won, drawn:team.table.drawn, lost:team.table.lost, goalsFor:team.table.goalsFor, goalsAgainst:team.table.goalsAgainst, goalDifference:team.table.goalsFor - team.table.goalsAgainst, points:team.table.points };
    }),
    cup,
    leagueChampionId:standings[0].id,
    cupChampionId:service.state.cup.championId,
    matchCount:service.state.matches.length,
  };
}

function percentage(value, total) {
  return Number((value / total * 100).toFixed(2));
}

function durationText(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}时${String(minutes).padStart(2, "0")}分${String(seconds).padStart(2, "0")}秒`;
  if (minutes) return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  return `${seconds}秒`;
}

function terminalProgress(startedAt) {
  let lastLoggedPercent = -5;
  return (completed, total) => {
    const ratio = completed / total;
    const percent = Math.floor(ratio * 100);
    const elapsed = Date.now() - startedAt;
    const remaining = completed ? elapsed / completed * (total - completed) : 0;
    if (!process.stdout.isTTY) {
      if (percent >= lastLoggedPercent + 5 || completed === total) {
        lastLoggedPercent = percent;
        console.log(`赛季模拟进度：${completed}/${total} (${percent}%)，已用${durationText(elapsed)}，预计剩余${durationText(remaining)}`);
      }
      return;
    }
    const width = 30;
    const filled = Math.min(width, Math.round(ratio * width));
    const bar = `${"=".repeat(filled)}${" ".repeat(width - filled)}`;
    process.stdout.write(`\r[${bar}] ${String(percent).padStart(3, " ")}%  ${completed}/${total}  已用 ${durationText(elapsed)}  剩余 ${durationText(remaining)}`);
    if (completed === total) process.stdout.write("\n");
  };
}

function aggregateResults(config, seasons) {
  const totals = new Map(config.teams.map((team) => [team.id, {
    id:team.id,
    name:team.name,
    coach:team.coach ?? null,
    leagueRanks:Array(10).fill(0),
    leagueTitles:0,
    leagueTop3:0,
    points:0,
    goalsFor:0,
    goalsAgainst:0,
    cupRanks:0,
    cupStages:{ champion:0, runnerUp:0, semifinal:0, quarterfinal:0, swiss:0 },
    doubles:0,
  }]));
  for (const season of seasons) {
    for (const team of season.league) {
      const total = totals.get(team.id);
      total.leagueRanks[team.rank - 1] += 1;
      total.leagueTitles += team.rank === 1 ? 1 : 0;
      total.leagueTop3 += team.rank <= 3 ? 1 : 0;
      total.points += team.points;
      total.goalsFor += team.goalsFor;
      total.goalsAgainst += team.goalsAgainst;
      const cup = season.cup[team.id];
      if (cup) {
        total.cupRanks += cup.rankEquivalent;
        total.cupStages[cup.stage] += 1;
      }
      total.doubles += team.rank === 1 && season.cupChampionId === team.id ? 1 : 0;
    }
  }
  return [...totals.values()].map((total) => ({
    id:total.id,
    name:total.name,
    coach:total.coach,
    league:{
      averageRank:Number((total.leagueRanks.reduce((sum, count, index) => sum + count * (index + 1), 0) / seasons.length).toFixed(3)),
      titleRatePercent:percentage(total.leagueTitles, seasons.length),
      top3RatePercent:percentage(total.leagueTop3, seasons.length),
      averagePoints:Number((total.points / seasons.length).toFixed(3)),
      averageGoalsFor:Number((total.goalsFor / seasons.length).toFixed(3)),
      averageGoalsAgainst:Number((total.goalsAgainst / seasons.length).toFixed(3)),
      averageGoalDifference:Number(((total.goalsFor - total.goalsAgainst) / seasons.length).toFixed(3)),
      rankDistributionPercent:Object.fromEntries(total.leagueRanks.map((count, index) => [String(index + 1), percentage(count, seasons.length)])),
    },
    cup:{
      averageRankEquivalent:Number((total.cupRanks / seasons.length).toFixed(3)),
      championRatePercent:percentage(total.cupStages.champion, seasons.length),
      finalRatePercent:percentage(total.cupStages.champion + total.cupStages.runnerUp, seasons.length),
      semifinalRatePercent:percentage(total.cupStages.champion + total.cupStages.runnerUp + total.cupStages.semifinal, seasons.length),
      stageDistributionPercent:Object.fromEntries(Object.entries(total.cupStages).map(([stage, count]) => [stage, percentage(count, seasons.length)])),
    },
    doubleChampionRatePercent:percentage(total.doubles, seasons.length),
  })).sort((left, right) => left.league.averageRank - right.league.averageRank || right.league.titleRatePercent - left.league.titleRatePercent);
}

export function runSeasonSimulation(config, options = {}) {
  const iterations = Number(options.iterations ?? config.iterations);
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("iterations必须是正整数");
  const effectiveConfig = { ...config, iterations };
  assertConfig(effectiveConfig);
  const seasons = [];
  const progress = options.progress ?? (() => {});
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    seasons.push(simulateSeason(effectiveConfig, iteration));
    progress(iteration + 1, iterations);
  }
  return {
    outputVersion:effectiveConfig.outputVersion ?? "ydl-season-simulation-v1",
    generatedAt:new Date().toISOString(),
    seed:effectiveConfig.seed,
    iterations,
    design:{ league:"10队双循环18轮", cup:"黄狗冠军杯：改良瑞士轮、八强和半决赛两回合、决赛单场", fitness:"联赛和杯赛共享体力与伤病", lineup:"使用配置中的完整名单、首发、战术板和三阶段战术" },
    sourceSnapshot:effectiveConfig.sourceSnapshot ?? null,
    teams:aggregateResults(effectiveConfig, seasons),
    samples:seasons.slice(0, Math.max(0, Number(effectiveConfig.sampleSeasonCount ?? 3))),
  };
}

export function configFromState(state, options = {}) {
  const teams = state.teams.map((team) => ({
    id:team.id,
    name:team.name,
    coach:team.ownerName ?? null,
    rosterIds:[...team.rosterIds],
    preferredStarterIds:[...team.preferredStarterIds],
    positions:structuredClone(team.positions),
    positionPresets:structuredClone(team.positionPresets ?? { position1:team.positions, position2:team.positions, position3:team.positions }),
    tactic:team.tactic,
    style:team.style,
    attackFocus:team.attackFocus,
    defenseFocus:team.defenseFocus,
    fitnessThreshold:team.fitnessThreshold,
    tacticalPlans:structuredClone(team.tacticalPlans),
  }));
  return {
    outputVersion:options.outputVersion ?? `${state.season?.name?.toLowerCase() ?? "ydl"}-final-squads-v1`,
    seed:options.seed ?? `${state.season?.id ?? "ydl-season"}-monte-carlo`,
    iterations:Number(options.iterations ?? 1000),
    sampleSeasonCount:3,
    outputPath:options.outputPath ?? "../outputs/ydl-season-simulation.json",
    sourceSnapshot:{ seasonId:state.season?.id ?? null, seasonName:state.season?.name ?? null, capturedAt:new Date(Number(state.updatedAt ?? Date.now())).toISOString(), policy:"使用赛季结束后的完整名单和当前首发；体力、伤停、停赛、默契及积分重置" },
    cup:{ enabled:true, startAfterLeagueRound:0 },
    teams,
  };
}

async function main() {
  const configPath = path.resolve(here, argumentValue("config") ?? defaultConfigPath);
  const snapshotPath = argumentValue("create-config-from-state");
  if (snapshotPath) {
    const statePath = path.resolve(here, snapshotPath);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const config = configFromState(state, { outputPath:"../outputs/ydl-s3-final-squads-season-simulation.json" });
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(`已生成赛季模拟配置：${configPath}`);
    return;
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const override = argumentValue("iterations");
  const startedAt = Date.now();
  const result = runSeasonSimulation(config, {
    iterations:override ? Number(override) : undefined,
    progress:terminalProgress(startedAt),
  });
  result.elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
  const outputPath = path.resolve(path.dirname(configPath), config.outputPath ?? "../outputs/ydl-season-simulation.json");
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`模拟完成：${result.iterations}个赛季，耗时${result.elapsedSeconds}秒`);
  console.log(`结果文件：${outputPath}`);
  console.table(result.teams.map((team) => ({ 球队:team.name, 联赛平均排名:team.league.averageRank, 联赛冠军率:`${team.league.titleRatePercent}%`, 平均积分:team.league.averagePoints, 杯赛冠军率:`${team.cup.championRatePercent}%`, 杯赛平均名次:team.cup.averageRankEquivalent })));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(error); process.exitCode = 1; });
