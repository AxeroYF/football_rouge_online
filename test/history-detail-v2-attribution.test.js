import assert from "node:assert/strict";
import test from "node:test";
import { buildMatchReview } from "../versus/history-detail.js";

const stageRates = (buildUp, progression, finalThird, chance, shot) => ({
  buildUp:{ rate:buildUp },
  progression:{ rate:progression },
  finalThird:{ rate:finalThird },
  chance:{ rate:chance },
  shot:{ rate:shot },
});

function reviewTeam({ stages, turnovers, territory, recoveries }) {
  return {
    stages,
    zones:[
      { zone:"buildUp:center", actions:4, turnovers, recoveries },
      { zone:"finalThird:center", actions:territory, turnovers, recoveries:0, xg:0.35 },
      { zone:"box:center", actions:territory, turnovers:0, recoveries:0, xg:0.65 },
    ],
  };
}

function v2LossDetail() {
  const player = (name, overall, defensiveActions) => ({
    name,
    overall,
    rating:6.5,
    stats:{ tackles:defensiveActions, interceptions:0, clearances:0, blocks:0, pressuresWon:0 },
  });
  return {
    modelVersion:"match-engine-v2.1",
    engineProfile:"v2.1-stable-dynamic.2",
    score:[0, 1],
    teams:[
      {
        name:"本方",
        activeCount:11,
        stats:{ possession:50, xg:1, shots:10, shotsOnTarget:3, saves:3 },
        players:[player("本方球员", 40, 3)],
      },
      {
        name:"对手",
        activeCount:11,
        stats:{ possession:50, xg:1, shots:10, shotsOnTarget:3, saves:3 },
        players:[player("对手球员", 95, 3)],
      },
    ],
    tacticalReview:{
      version:2,
      source:"v2-possession-chains",
      chainModelVersion:"possession-chain-v2.1",
      teams:[
        reviewTeam({ stages:stageRates(55, 35, 25, 15, 10), turnovers:5, territory:2, recoveries:3 }),
        reviewTeam({ stages:stageRates(82, 72, 61, 48, 30), turnovers:1, territory:8, recoveries:3 }),
      ],
    },
    analysisTimeline:[
      { minute:0, teams:[
        { structureIndex:.8, positionFit:.8, tacticalFit:.8, averageFitness:96 },
        { structureIndex:.8, positionFit:.8, tacticalFit:.8, averageFitness:96 },
      ] },
      { minute:90, teams:[
        { structureIndex:.8, positionFit:.8, tacticalFit:.8, averageFitness:84 },
        { structureIndex:.8, positionFit:.8, tacticalFit:.8, averageFitness:84 },
      ] },
    ],
    events:[],
    importantEvents:[],
  };
}

test("V2失利归因由控球链和区域实录驱动，不再独立读取OVR", () => {
  const detail = v2LossDetail();
  const review = buildMatchReview(detail, 0);
  const original = review.lossAttribution;
  const originalProgression = original.items.find((item) => item.key === "buildup");

  assert.equal(review.version, 3);
  assert.equal(review.source, "v2-engine-report");
  assert.equal(review.phaseComparisons.length, 5);
  assert.equal(review.attackSources.length, 2);
  assert.equal(review.guidance.method, "v2-coach-guidance-v1");
  assert.ok(review.guidance.primary.key);
  assert.equal(review.guidance.units.length, 5);
  assert.equal(review.guidance.causeChain.length, 4);
  assert.ok(review.guidance.recommendations.length > 0);
  assert.equal(original.method, "v2-engine-evidence-attribution-v2");
  assert.deepEqual(original.items.map((item) => item.key), ["buildup", "chance", "finishing", "transitionDefense", "execution"]);
  assert.equal(original.items.reduce((sum, item) => sum + item.percent, 0), 100);
  assert.ok(originalProgression.percent > 0);
  assert.ok(original.dataSources.includes("V2六阶段控球链"));
  assert.ok(original.dataSources.includes("V2 20区域行动与失误"));
  assert.equal(original.confidence.label, "中");
  assert.ok(original.items.every((item) => item.evidence.length === 2 && item.sources.length === 2));

  const changedOverall = structuredClone(detail);
  changedOverall.teams[0].players[0].overall = 99;
  assert.deepEqual(
    buildMatchReview(changedOverall, 0).lossAttribution.items,
    original.items,
    "只改变球员OVR不应改变V2实录归因",
  );

  const equalizedChains = structuredClone(detail);
  equalizedChains.tacticalReview.teams[0] = structuredClone(equalizedChains.tacticalReview.teams[1]);
  const equalizedProgression = buildMatchReview(equalizedChains, 0).lossAttribution.items.find((item) => item.key === "buildup");
  assert.ok(equalizedProgression.percent < originalProgression.percent, "消除V2推进差距后，推进归因应下降");
});
