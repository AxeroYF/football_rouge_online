import assert from "node:assert/strict";
import test from "node:test";
import { buildMatchReview } from "../versus/history-detail.js";

const BANDS = ["defensiveThird", "buildUp", "finalThird", "box"];
const LANES = ["farLeft", "leftHalfSpace", "center", "rightHalfSpace", "farRight"];

function stages(values = {}) {
  return Object.fromEntries(["buildUp", "progression", "finalThird", "chance", "shot"].map((key) => {
    const rate = Number(values[key] ?? 60);
    return [key, { attempts:20, successes:Math.round(rate / 5), rate }];
  }));
}

function zones(overrides = {}) {
  return BANDS.flatMap((band) => LANES.map((lane) => {
    const zone = `${band}:${lane}`;
    return { zone, starts:0, actions:0, successes:0, turnovers:0, recoveries:0, shots:0, xg:0, goals:0, ...(overrides[zone] ?? {}) };
  }));
}

function teamReview({ stageValues, zoneValues } = {}) {
  return { stages:stages(stageValues), zones:zones(zoneValues), routes:{ structured:80, counter:20, direct:10 } };
}

function detail({ score = [1, 2], ownStats = {}, rivalStats = {}, ownReview = {}, rivalReview = {}, ownTimeline = {}, rivalTimeline = {} } = {}) {
  const stats = { possession:50, xg:1, shots:10, shotsOnTarget:4, saves:3, transitionXg:.2, transitionShots:2 };
  const snapshot = { structureIndex:.8, positionFit:.8, tacticalFit:.8, averageFitness:90 };
  return {
    modelVersion:"match-engine-v2.1",
    engineProfile:"v2.1-stable-dynamic.2",
    score,
    teams:[
      { name:"本方", activeCount:11, stats:{ ...stats, ...ownStats }, players:[] },
      { name:"对手", activeCount:11, stats:{ ...stats, ...rivalStats }, players:[] },
    ],
    tacticalReview:{
      version:2,
      source:"v2-possession-chains",
      chainModelVersion:"possession-chain-v2.1",
      spatialModelVersion:"spatial-v2.1-stable-dynamic.2",
      chainCount:180,
      teams:[teamReview(ownReview), teamReview(rivalReview)],
    },
    analysisTimeline:[
      { minute:0, teams:[{ ...snapshot, ...ownTimeline }, { ...snapshot, ...rivalTimeline }] },
      { minute:90, teams:[{ ...snapshot, ...ownTimeline }, { ...snapshot, ...rivalTimeline }] },
    ],
    events:[],
    importantEvents:[],
  };
}

function guidanceFor(options) {
  return buildMatchReview(detail(options), 0).guidance;
}

test("V2教练复盘输出五项判断、因果链和优先建议", () => {
  const guidance = guidanceFor();
  assert.equal(guidance.method, "v2-coach-guidance-v1");
  assert.deepEqual(guidance.units.map((item) => item.key).sort(), ["attack", "defense", "finishing", "midfield", "tactics"]);
  assert.equal(guidance.causeChain.length, 4);
  assert.ok(guidance.recommendations.length >= 1 && guidance.recommendations.length <= 3);
  assert.equal(guidance.confidence.label, "高");
  assert.ok(guidance.units.every((item) => item.verdict && item.evidence.length === 3 && item.advice));
});

test("高xG未进球时明确诊断为终结效率", () => {
  const guidance = guidanceFor({
    score:[0, 1],
    ownStats:{ xg:2.4, shots:12, shotsOnTarget:2, possession:52 },
    rivalStats:{ xg:1, shots:10, shotsOnTarget:4, possession:48 },
  });
  assert.equal(guidance.primary.key, "finishing");
  assert.match(guidance.summary, /终结效率/);
  assert.match(guidance.primary.advice, /阵型不必因此大改/);
});

test("推进受压和高位丢失时明确诊断为中场控制", () => {
  const guidance = guidanceFor({
    score:[1, 2],
    ownStats:{ possession:42, xg:1, shots:10 },
    rivalStats:{ possession:58, xg:2, shots:12 },
    ownReview:{
      stageValues:{ buildUp:50, progression:35, finalThird:60, chance:60 },
      zoneValues:{ "buildUp:center":{ actions:12, successes:5, turnovers:8 } },
    },
    rivalReview:{
      stageValues:{ buildUp:75, progression:75, finalThird:60, chance:60 },
      zoneValues:{ "buildUp:center":{ actions:12, successes:10, turnovers:2 } },
    },
  });
  assert.equal(guidance.primary.key, "midfield");
  assert.match(guidance.primary.advice, /CM\/DM接应点/);
  assert.ok(guidance.problemAreas.some((area) => area.title.includes("中场中路出球受压")));
});

test("对手转换和禁区威胁过高时明确诊断为防守问题并定位区域", () => {
  const guidance = guidanceFor({
    score:[1, 3],
    ownStats:{ xg:1.5, shots:10, transitionXg:.05 },
    rivalStats:{ xg:1.8, shots:10, transitionXg:.9 },
    ownReview:{ zoneValues:{ "box:center":{ actions:4, successes:3, shots:2, xg:.5 } } },
    rivalReview:{ zoneValues:{ "box:farLeft":{ actions:14, successes:10, shots:4, xg:1.1, goals:2 } } },
  });
  assert.equal(guidance.primary.key, "defense");
  assert.match(guidance.primary.verdict, /反击/);
  assert.ok(guidance.problemAreas.some((area) => area.title.includes("本方右路")), "对手左路必须镜像为本方右路");
});

test("结构和职责适配明显落后时明确诊断为阵型与战术", () => {
  const guidance = guidanceFor({
    score:[1, 2],
    ownStats:{ xg:1, shots:10 },
    rivalStats:{ xg:2, shots:12 },
    ownTimeline:{ structureIndex:.45, positionFit:.45, tacticalFit:.45 },
    rivalTimeline:{ structureIndex:.9, positionFit:.9, tacticalFit:.9 },
  });
  assert.equal(guidance.primary.key, "tactics");
  assert.match(guidance.primary.verdict, /阵型结构|职责适配/);
  assert.match(guidance.primary.advice, /客串位置与球员职责/);
});
