// This worker has no league service, account store or persistence access.
import { parentPort, workerData } from "node:worker_threads";
import { createVersusMatch, advanceVersusMatch, REGULAR_DURATION_MS, HALFTIME_ADJUSTMENT_MS } from "./match-engine.js";

const { seats, options, marketId, samples } = workerData;
const reports = [];
for (let index = 0; index < samples; index += 1) {
  const match = createVersusMatch(seats, { ...options, seed:`prediction:${marketId}:${index + 1}` });
  let now = options.now + REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + 1;
  for (let attempt = 0; attempt < 5 && !match.finished; attempt += 1) {
    advanceVersusMatch(match, now);
    now += 60_000;
  }
  if (!match.finished || !match.report) throw new Error("预测模拟未能完成结算");
  const { score, halfTimeScore, regulationScore, events, teams } = match.report;
  reports.push({ score, halfTimeScore, regulationScore, events,
    teams:teams.map(({ stats }) => ({ stats:{ xg:stats.xg, yellowCards:stats.yellowCards, redCards:stats.redCards } })) });
}
parentPort.postMessage(reports);
