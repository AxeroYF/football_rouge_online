import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const seasons = Math.max(1, Number(process.env.YDL_PREDICTION_SIM_SEASONS ?? 18));
const seasonOffset = Math.max(0, Math.floor(Number(process.env.YDL_PREDICTION_SIM_SEASON_OFFSET ?? 0)));
const roundLimit = Math.max(1, Math.floor(Number(process.env.YDL_PREDICTION_SIM_ROUND_LIMIT ?? Number.MAX_SAFE_INTEGER)));
const quiet = process.env.YDL_PREDICTION_SIM_QUIET === "1";
const outputPath = path.resolve(process.env.YDL_PREDICTION_SIM_OUTPUT ?? "outputs/prediction-market-simulation.json");
const startAt = Date.parse("2026-09-01T10:00:00+08:00");
const records = [];
const startedAt = Date.now();
let completedRounds = 0;
let totalRounds = null;

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--:--:--";
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function renderProgress(status = "运行中") {
  if (quiet) return;
  const progress = completedRounds / Math.max(1, totalRounds);
  const barWidth = 30;
  const filled = Math.min(barWidth, Math.round(progress * barWidth));
  const elapsed = Date.now() - startedAt;
  const remaining = completedRounds > 0 ? elapsed * (totalRounds - completedRounds) / completedRounds : Number.NaN;
  const line = `[${"=".repeat(filled)}${"-".repeat(barWidth - filled)}] ${(progress * 100).toFixed(1).padStart(5)}% ${completedRounds}/${totalRounds}轮 已用 ${formatDuration(elapsed)} 剩余 ${formatDuration(remaining)} ${status}`;
  process.stdout.write(`${line}\n`);
}

function resultLabel(value) {
  return value === "home" ? "home" : value === "away" ? "away" : "draw";
}

function addMetric(map, key, prediction, outcome, payoutRate) {
  const metric = map[key] ??= { key, bets:0, wins:0, stake:0, payout:0, payoutRateSum:0 };
  metric.bets += 1;
  metric.wins += Number(prediction === outcome);
  metric.stake += 1;
  metric.payout += prediction === outcome ? payoutRate : 0;
  metric.payoutRateSum += payoutRate;
}

function marketRtp(rates) {
  const inverseTotal = Object.values(rates ?? {}).reduce((sum, rateValue) => {
    const rate = Number(rateValue);
    return Number.isFinite(rate) && rate > 0 ? sum + 1 / rate : sum;
  }, 0);
  return inverseTotal > 0 ? 1 / inverseTotal : 0;
}

for (let localSeasonIndex = 0; localSeasonIndex < seasons; localSeasonIndex += 1) {
  const seasonIndex = seasonOffset + localSeasonIndex;
  const now = startAt + seasonIndex * 24 * 60 * 60 * 1000;
  const service = new YellowDogsLeagueService({ statePath:null, backupDir:null, now:() => now, rng:() => 0.37 });
  service.state.season.nextRoundAt = now + 60 * 60 * 1000;
  service.state.season.firstRoundAt = service.state.season.nextRoundAt;
  service.state.teams.forEach((team) => { team.ownerId = null; team.ownerName = null; });
  const simulationRounds = service.state.rounds.slice(0, roundLimit);
  totalRounds ??= seasons * simulationRounds.length;
  if (completedRounds === 0) renderProgress("正在计算第1轮");

  for (let roundIndex = 0; roundIndex < simulationRounds.length; roundIndex += 1) {
    const round = simulationRounds[roundIndex];
    const entries = round.fixtures.map((fixture) => ({
      id:service.predictionMarketId("league", `R${round.number}`, fixture),
      competition:"league",
      competitionName:"simulation",
      round:round.number,
      stage:null,
      leg:1,
      roundKey:`R${round.number}`,
      fixture,
      startsAt:now + 60 * 60 * 1000,
      matchOptions:{ competitionMode:"league", regulationOnly:true },
    }));
    const roundRecords = new Map();
    entries.forEach((entry) => {
      const market = service.generatePredictionMarket(entry);
      const forecast = {
        result:{ ...market.simulation.probabilities.result },
        goals:{ ...market.simulation.probabilities.goals },
        cards:{ ...market.simulation.probabilities.cards },
        halfFull:{ ...market.simulation.probabilities.halfFull },
      };
      const pricingForecast = {
        ...forecast,
        halfFull:{ ...market.simulation.pricingProbabilities.halfFull },
      };
      const payoutRates = {
        result:{ ...market.payoutRates.result },
        goals:{ ...market.payoutRates.goals },
        cards:{ ...market.payoutRates.cards },
        halfFull:{ ...market.payoutRates.halfFull },
      };
      const rawPayoutRates = {
        result:{ ...market.rawPayoutRates.result },
        goals:{ ...market.rawPayoutRates.goals },
        cards:{ ...market.rawPayoutRates.cards },
        halfFull:{ ...market.rawPayoutRates.halfFull },
      };
      service.state.matchPredictions.markets[market.id].status = "open";
      service.state.matchPredictions.markets[market.id].closesAt = now + 30 * 60 * 1000;
      service.state.matchPredictions.markets[market.id].startsAt = now + 60 * 60 * 1000;
      const record = {
        seasonIndex,
        round:round.number,
        marketId:market.id,
        pricingVersion:market.pricingVersion,
        homeId:entry.fixture.homeId,
        awayId:entry.fixture.awayId,
        resultHandicap:market.resultHandicap,
        forecast,
        pricingForecast,
        rawPayoutRates,
        payoutRates,
        marketRtp:Object.fromEntries(Object.entries(payoutRates).map(([category, rates]) => [category, marketRtp(rates)])),
        samples:market.simulation.samples,
        actual:null,
      };
      records.push(record);
      roundRecords.set(entry.id, record);
    });

    service.simulateNextRound();
    entries.forEach((entry) => {
      const market = service.state.matchPredictions.markets[entry.id];
      const match = service.state.matches.find((candidate) => candidate.id === entry.fixture.matchId || (candidate.homeId === entry.fixture.homeId && candidate.awayId === entry.fixture.awayId && candidate.round === round.number));
      if (!market || !match?.report) return;
      const record = roundRecords.get(entry.id);
      if (!record) return;
      const totalGoals = match.score[0] + match.score[1];
      const totalCards = match.report.teams.reduce((sum, team) => sum + Number(team.stats.yellowCards ?? 0) + Number(team.stats.redCards ?? 0), 0);
      const halfFull = service.predictionHalfFullOutcome(match.report);
      const actualResult = service.predictionResult(match.score, record.resultHandicap);
      record.actual = {
        result:actualResult,
        goals:service.predictionGoalBand(totalGoals),
        cards:service.predictionCardBand(totalCards),
        halfFull:halfFull.outcome,
        score:[...match.score],
        totalGoals,
        totalCards,
        halfTimeScore:halfFull.halfTimeScore,
        regulationScore:halfFull.regulationScore,
      };
      record.realized = {};
      for (const category of ["result", "goals", "cards", "halfFull"]) {
        record.realized[category] = Object.fromEntries(Object.entries(record.payoutRates[category]).map(([selection, rate]) => [selection, {
          outcome:record.actual[category],
          won:selection === record.actual[category],
          payoutIfUnitBet:selection === record.actual[category] ? rate : 0,
          roiIfUnitBet:selection === record.actual[category] ? rate - 1 : -1,
        }]));
      }
    });
    completedRounds += 1;
    renderProgress();
  }
}

const enabledCategories = ["result", "goals", "cards", "halfFull"];
const summary = {
  schemaVersion:4,
  generatedAt:new Date().toISOString(),
  predictionEngine:"v1",
  actualEngine:"v2",
  pricingVersion:records[0]?.pricingVersion ?? null,
  predictionSamplesPerMarket:records[0]?.samples ?? null,
  seasons,
  markets:records.filter((record) => record.actual),
  enabledCategories,
  categoryDefinitions:{
    result:["home", "draw", "away"],
    goals:["0-3", "4-5", "6+"],
    cards:["0", "1", "2", "3", "4+"],
    halfFull:["home-home", "home-draw", "home-away", "draw-home", "draw-draw", "draw-away", "away-home", "away-draw", "away-away"],
  },
  halfFullSettlement:{ perspective:"home", halfTimeMinute:45, fullTimeMinute:90, excludesExtraTime:true, excludesPenaltyShootout:true },
  handicaps:{},
  marketRtp:{},
  categories:{},
};
summary.handicaps = Object.fromEntries([...new Set(summary.markets.map((record) => record.resultHandicap))]
  .sort((left, right) => left - right)
  .map((handicap) => [String(handicap), summary.markets.filter((record) => record.resultHandicap === handicap).length]));
for (const category of enabledCategories) {
  const rtpValues = summary.markets.map((record) => marketRtp(record.payoutRates[category])).filter(Number.isFinite);
  summary.marketRtp[category] = {
    markets:rtpValues.length,
    average:rtpValues.reduce((sum, value) => sum + value, 0) / Math.max(1, rtpValues.length),
    minimum:rtpValues.length ? Math.min(...rtpValues) : null,
    maximum:rtpValues.length ? Math.max(...rtpValues) : null,
  };
  const selections = new Set(summary.markets.flatMap((record) => Object.keys(record.payoutRates[category])));
  summary.categories[category] = Object.fromEntries([...selections].map((selection) => {
    const rows = summary.markets.map((record) => ({ record, rate:record.payoutRates[category][selection] })).filter((row) => Number.isFinite(row.rate));
    const wins = rows.filter(({ record }) => record.actual[category] === selection).length;
    const payout = rows.reduce((sum, { record, rate }) => sum + (record.actual[category] === selection ? rate : 0), 0);
    const averageRawPayoutRate = rows.reduce((sum, { record }) => sum + Number(record.rawPayoutRates[category][selection]), 0) / Math.max(1, rows.length);
    const averagePayoutRate = rows.reduce((sum, { rate }) => sum + rate, 0) / Math.max(1, rows.length);
    return [selection, { bets:rows.length, wins, hitRate:wins / Math.max(1, rows.length), theoreticalRoi:rows.reduce((sum, { record, rate }) => sum + (record.pricingForecast[category][selection] * rate - 1), 0) / Math.max(1, rows.length), realizedRoi:(payout - rows.length) / Math.max(1, rows.length), averageRawPayoutRate, averagePayoutRate, averageDiscount:averagePayoutRate / Math.max(.001, averageRawPayoutRate) }];
  }));
}

mkdirSync(path.dirname(outputPath), { recursive:true });
writeFileSync(outputPath, `${JSON.stringify({ summary, records }, null, 2)}\n`, "utf8");
if (!quiet) console.log(JSON.stringify({ output:outputPath, schemaVersion:summary.schemaVersion, pricingVersion:summary.pricingVersion, seasons, markets:summary.markets.length, enabledCategories, handicaps:summary.handicaps, marketRtp:summary.marketRtp, categories:summary.categories }, null, 2));
