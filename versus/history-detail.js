import { positionFitScore } from "../game/public/schema.js";
import { REAL_PLAYER_BY_ID } from "./player-pool.js";
import { analyzeElevenFormation, defaultElevenPositions } from "./rules.js";

function validPosition(value) {
  return Number.isFinite(Number(value?.x)) && Number.isFinite(Number(value?.y));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function topRatedPlayer(team) {
  return [...(team?.players ?? [])]
    .filter((player) => Number.isFinite(Number(player.rating)))
    .sort((left, right) => finite(right.rating) - finite(left.rating))[0] ?? null;
}

function conversionText(stats) {
  const shots = finite(stats?.shots);
  const goals = finite(stats?.goals);
  return shots ? `${Math.round((goals / shots) * 100)}%` : "0%";
}

function comparisonMetric(label, ownValue, rivalValue, suffix = "") {
  const own = finite(ownValue);
  const rival = finite(rivalValue);
  return {
    label,
    own,
    rival,
    ownText:`${own}${suffix}`,
    rivalText:`${rival}${suffix}`,
    edge:own === rival ? "even" : own > rival ? "own" : "rival",
  };
}

function normalizeFit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 2 ? number / 100 : number;
}

function hydrateV2AnalysisTimeline(detail) {
  if (!Array.isArray(detail.analysisTimeline) || !String(detail.modelVersion ?? detail.engineVersion ?? "").includes("v2")) return;
  detail.analysisTimeline = detail.analysisTimeline.map((snapshot) => ({
    ...snapshot,
    teams:(snapshot.teams ?? []).map((team, teamIndex) => {
      const reportTeam = detail.teams?.[teamIndex] ?? {};
      const reportPlayers = new Map((reportTeam.players ?? []).map((player) => [player.id, player]));
      const activePlayers = (team.players ?? []).filter((player) => player.active !== false);
      const calculatedPositionFit = activePlayers.length ? activePlayers.reduce((sum, player) => {
        const source = reportPlayers.get(player.id) ?? REAL_PLAYER_BY_ID[player.id] ?? player;
        return sum + positionFitScore(source, player.assignedRole ?? source.assignedRole ?? source.role);
      }, 0) / activePlayers.length : 0;
      const positionFit = normalizeFit(team.positionFit) || calculatedPositionFit;
      const tacticalFit = normalizeFit(team.tacticalFit)
        || normalizeFit(reportTeam.tacticalFit)
        || normalizeFit(reportTeam.styleFit);
      const structureIndex = normalizeFit(team.structureIndex)
        || Math.max(.45, Math.min(1, positionFit * .35 + tacticalFit * .65));
      return {
        ...team,
        structureIndex:Number(structureIndex.toFixed(4)),
        positionFit:Number(positionFit.toFixed(4)),
        tacticalFit:Number(tacticalFit.toFixed(4)),
      };
    }),
  }));
}

function finalizeLossAttribution({ method, title, note, items, dataSources = [] }) {
  const weighted = items.map((item) => ({ ...item, value:Math.max(0, finite(item.value)) }));
  let total = weighted.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0.000001) {
    const fallback = weighted.find((item) => item.key === "finishing") ?? weighted.at(-1);
    if (fallback) fallback.value = 1;
    total = 1;
  }
  const exact = weighted.map((item) => ({ ...item, exact:item.value / total * 100 }));
  const rounded = exact.map((item) => Math.floor(item.exact));
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  exact
    .map((item, index) => ({ index, fraction:item.exact - rounded[index] }))
    .sort((left, right) => right.fraction - left.fraction)
    .forEach(({ index }) => {
      if (remainder > 0) {
        rounded[index] += 1;
        remainder -= 1;
      }
    });
  const normalizedItems = exact.map(({ exact:discardedExact, value:discardedValue, ...item }, index) => ({ ...item, percent:rounded[index] }));
  return {
    method,
    title,
    note,
    dataSources,
    items:normalizedItems,
    primary:normalizedItems.reduce((best, item) => item.percent > best.percent ? item : best, normalizedItems[0]),
  };
}

function buildLegacyLossAttribution(detail, viewerIndex, opponentIndex, outcome) {
  if (outcome !== "loss") return null;
  const own = detail?.teams?.[viewerIndex];
  const rival = detail?.teams?.[opponentIndex];
  const timeline = Array.isArray(detail?.analysisTimeline) ? detail.analysisTimeline : [];
  if (timeline.length < 2) return null;
  const segments = timeline.slice(0, -1).map((snapshot, index) => {
    const next = timeline[index + 1];
    const duration = Math.max(0, finite(next?.minute) - finite(snapshot.minute));
    const goalsFor = Math.max(0, finite(next?.score?.[viewerIndex]) - finite(snapshot?.score?.[viewerIndex]));
    const goalsAgainst = Math.max(0, finite(next?.score?.[opponentIndex]) - finite(snapshot?.score?.[opponentIndex]));
    return {
      snapshot,
      duration,
      impactWeight:duration + Math.max(0, goalsAgainst - goalsFor) * 15,
    };
  }).filter((segment) => segment.duration > 0 && segment.snapshot?.teams?.[viewerIndex] && segment.snapshot?.teams?.[opponentIndex]);
  const totalMinutes = segments.reduce((sum, segment) => sum + segment.duration, 0);
  const totalImpactWeight = segments.reduce((sum, segment) => sum + segment.impactWeight, 0);
  if (!totalMinutes) return null;
  const weightedAverage = (teamIndex, key) => segments.reduce((sum, segment) =>
    sum + finite(segment.snapshot.teams[teamIndex]?.[key]) * segment.duration, 0) / totalMinutes;
  const weightedGap = (key, sensitivity = 1, transform = (value) => value) => segments.reduce((sum, segment) => {
    const ownValue = Math.max(0.01, transform(finite(segment.snapshot.teams[viewerIndex]?.[key])));
    const rivalValue = Math.max(0.01, transform(finite(segment.snapshot.teams[opponentIndex]?.[key])));
    return sum + Math.max(0, rivalValue / ownValue - 1) * sensitivity * segment.impactWeight;
  }, 0) / totalImpactWeight;

  const ownStructure = weightedAverage(viewerIndex, "structureIndex");
  const rivalStructure = weightedAverage(opponentIndex, "structureIndex");
  const ownPositionFit = weightedAverage(viewerIndex, "positionFit");
  const rivalPositionFit = weightedAverage(opponentIndex, "positionFit");
  const ownTacticalFit = weightedAverage(viewerIndex, "tacticalFit");
  const rivalTacticalFit = weightedAverage(opponentIndex, "tacticalFit");
  const ownOverall = weightedAverage(viewerIndex, "averageOverall");
  const rivalOverall = weightedAverage(opponentIndex, "averageOverall");
  const ownFitness = weightedAverage(viewerIndex, "averageFitness");
  const rivalFitness = weightedAverage(opponentIndex, "averageFitness");
  const openingOwn = timeline[0].teams[viewerIndex];
  const openingRival = timeline[0].teams[opponentIndex];

  const ownGoals = finite(detail?.score?.[viewerIndex] ?? detail?.aggregateScore?.[viewerIndex]);
  const rivalGoals = finite(detail?.score?.[opponentIndex] ?? detail?.aggregateScore?.[opponentIndex]);
  const ownXg = finite(own?.stats?.xg);
  const rivalXg = finite(rival?.stats?.xg);
  const formationWeight = weightedGap("structureIndex")
    + weightedGap("positionFit", 0.25)
    + weightedGap("tacticalFit", 0.58);
  const fitnessWeight = weightedGap("averageFitness", 1, (value) => 0.62 + value / 265);
  const abilityWeight = weightedGap("averageOverall", 1, (value) => 73 + (value - 73) * 0.33);
  const missedChanceVariance = Math.max(0, ownXg - ownGoals);
  const concededVariance = Math.max(0, rivalGoals - rivalXg);
  const adverseEvents = (detail?.importantEvents ?? []).filter((event) =>
    (Number(event.teamIndex) === viewerIndex && ["red", "injury", "lightning"].includes(event.type))
    || (Number(event.teamIndex) === opponentIndex && ["penaltyAwarded", "blackWhistle"].includes(event.type))).length;
  const rawRandomnessWeight = 0.005 + (missedChanceVariance + concededVariance) * 0.03 + adverseEvents * 0.018;
  const deterministicWeight = formationWeight + fitnessWeight + abilityWeight;
  const randomnessWeight = deterministicWeight > 0.005
    ? Math.min(rawRandomnessWeight, deterministicWeight * 0.45)
    : rawRandomnessWeight;
  const weighted = [
    {
      key:"formation",
      label:"阵型与战术",
      value:formationWeight,
      detail:`开局 ${openingOwn.formation ?? "未知"} ${finite(openingOwn.structureIndex).toFixed(2)} : ${openingRival.formation ?? "未知"} ${finite(openingRival.structureIndex).toFixed(2)} · 全场结构 ${ownStructure.toFixed(2)}:${rivalStructure.toFixed(2)} · 位置 ${Math.round(ownPositionFit * 100)}%:${Math.round(rivalPositionFit * 100)}% · 战术 ${Math.round(ownTacticalFit * 100)}%:${Math.round(rivalTacticalFit * 100)}%`,
    },
    {
      key:"fitness",
      label:"体力",
      value:fitnessWeight,
      detail:`全场平均 ${ownFitness.toFixed(1)} : ${rivalFitness.toFixed(1)}`,
    },
    {
      key:"ability",
      label:"球员能力",
      value:abilityWeight,
      detail:`平均能力 ${ownOverall.toFixed(1)} : ${rivalOverall.toFixed(1)}`,
    },
    {
      key:"randomness",
      label:"随机性",
      value:randomnessWeight,
      detail:`进球/xG ${ownGoals}/${ownXg.toFixed(2)} : ${rivalGoals}/${rivalXg.toFixed(2)}`,
    },
  ];
  return finalizeLossAttribution({
    method:"timeline-estimate-legacy",
    title:"失利因素估算",
    note:`按 ${totalMinutes} 分钟阶段快照加权计算；随机性只承担进球偏离xG、伤停判罚与事件抽样残差，并设置为不能掩盖已识别的阵型、体力和能力劣势。该结果是解释性估算，并非精确因果。`,
    items:weighted,
    dataSources:["阶段阵型快照", "球员能力与体力", "比分与xG"],
  });
}

function isV2Report(detail) {
  const versionText = `${detail?.modelVersion ?? ""} ${detail?.engineVersion ?? ""} ${detail?.engineProfile ?? ""}`.toLowerCase();
  return versionText.includes("v2") || /^2\./.test(String(detail?.engineVersion ?? "")) || Boolean(detail?.tacticalReview?.source === "v2-possession-chains");
}

function timelineAverage(detail, teamIndex, key) {
  const timeline = Array.isArray(detail?.analysisTimeline) ? detail.analysisTimeline : [];
  if (!timeline.length) return 0;
  if (timeline.length === 1) return finite(timeline[0]?.teams?.[teamIndex]?.[key]);
  let weighted = 0;
  let minutes = 0;
  for (let index = 0; index < timeline.length - 1; index += 1) {
    const duration = Math.max(0, finite(timeline[index + 1]?.minute) - finite(timeline[index]?.minute));
    if (!duration) continue;
    weighted += finite(timeline[index]?.teams?.[teamIndex]?.[key]) * duration;
    minutes += duration;
  }
  return minutes ? weighted / minutes : finite(timeline.at(-1)?.teams?.[teamIndex]?.[key]);
}

function zoneTotal(reviewTeam, key, bands = null) {
  return (reviewTeam?.zones ?? []).reduce((sum, zone) => {
    const band = String(zone?.zone ?? "").split(":")[0];
    return bands && !bands.includes(band) ? sum : sum + finite(zone?.[key]);
  }, 0);
}

function stageSnapshot(reviewTeam, stage) {
  const value = reviewTeam?.stages?.[stage] ?? {};
  return {
    attempts:finite(value.attempts),
    successes:finite(value.successes),
    rate:finite(value.rate),
  };
}

function percentage(value, total) {
  return total > 0 ? value / total * 100 : 0;
}

function dominantRoute(reviewTeam) {
  const labels = { structured:"阵地组织", counter:"快速反击", direct:"直接推进" };
  const entries = Object.entries(reviewTeam?.routes ?? {}).map(([key, value]) => ({ key, label:labels[key] ?? key, value:finite(value) }));
  const total = entries.reduce((sum, item) => sum + item.value, 0);
  const primary = entries.sort((left, right) => right.value - left.value)[0] ?? { key:"structured", label:"阵地组织", value:0 };
  return { ...primary, total, share:percentage(primary.value, total) };
}

function v2ReviewCoverage(detail) {
  const review = detail?.tacticalReview;
  const teams = review?.teams ?? [];
  const zoneComplete = teams.length === 2 && teams.every((team) => (team.zones ?? []).length >= 20);
  const stagesComplete = teams.length === 2 && teams.every((team) => ["buildUp", "progression", "finalThird", "chance", "shot"].every((stage) => team.stages?.[stage]));
  const statsComplete = (detail?.teams ?? []).length === 2 && detail.teams.every((team) => Number.isFinite(Number(team.stats?.xg)) && Number.isFinite(Number(team.stats?.shots)));
  const eventsComplete = Array.isArray(detail?.events);
  const timelineComplete = Array.isArray(detail?.analysisTimeline) && detail.analysisTimeline.length >= 2;
  const chainCount = finite(review?.chainCount);
  const score = (statsComplete ? .2 : 0)
    + (zoneComplete ? .25 : 0)
    + (stagesComplete ? .2 : 0)
    + (eventsComplete ? .15 : 0)
    + (timelineComplete ? .1 : 0)
    + (chainCount >= 120 ? .1 : chainCount > 0 ? .05 : 0);
  return {
    score:Number(score.toFixed(2)),
    label:score >= .85 ? "高" : score >= .6 ? "中" : "低",
    chainCount,
    zoneComplete,
    stagesComplete,
    statsComplete,
    eventsComplete,
    timelineComplete,
  };
}

function normalizedGap(ownValue, rivalValue, floor = 1) {
  const own = Math.max(0, finite(ownValue));
  const rival = Math.max(0, finite(rivalValue));
  return Math.max(0, rival - own) / Math.max(floor, own + rival);
}

function buildV2LossAttribution(detail, viewerIndex, opponentIndex, outcome) {
  if (outcome !== "loss") return null;
  const own = detail?.teams?.[viewerIndex] ?? {};
  const rival = detail?.teams?.[opponentIndex] ?? {};
  const ownStats = own.stats ?? {};
  const rivalStats = rival.stats ?? {};
  const ownReview = detail?.tacticalReview?.teams?.[viewerIndex] ?? {};
  const rivalReview = detail?.tacticalReview?.teams?.[opponentIndex] ?? {};
  const events = Array.isArray(detail?.events) ? detail.events : (detail?.importantEvents ?? []);
  const score = detail?.score ?? detail?.aggregateScore ?? [0, 0];
  const ownGoals = finite(score[viewerIndex]);
  const rivalGoals = finite(score[opponentIndex]);
  const ownXg = finite(ownStats.xg);
  const rivalXg = finite(rivalStats.xg);
  const ownShots = finite(ownStats.shots);
  const rivalShots = finite(rivalStats.shots);
  const ownOnTarget = finite(ownStats.shotsOnTarget);
  const rivalOnTarget = finite(rivalStats.shotsOnTarget);

  const ownBuildUp = stageSnapshot(ownReview, "buildUp");
  const rivalBuildUp = stageSnapshot(rivalReview, "buildUp");
  const ownProgression = stageSnapshot(ownReview, "progression");
  const rivalProgression = stageSnapshot(rivalReview, "progression");
  const ownFinalThird = stageSnapshot(ownReview, "finalThird");
  const rivalFinalThird = stageSnapshot(rivalReview, "finalThird");
  const ownChance = stageSnapshot(ownReview, "chance");
  const rivalChance = stageSnapshot(rivalReview, "chance");
  const ownTurnovers = zoneTotal(ownReview, "turnovers", ["buildUp", "finalThird", "box"]);
  const rivalTurnovers = zoneTotal(rivalReview, "turnovers", ["buildUp", "finalThird", "box"]);
  const ownTerritory = zoneTotal(ownReview, "actions", ["finalThird", "box"]);
  const rivalTerritory = zoneTotal(rivalReview, "actions", ["finalThird", "box"]);
  const buildupWeight = Math.max(0, rivalBuildUp.rate - ownBuildUp.rate) / 100 * .7
    + Math.max(0, rivalProgression.rate - ownProgression.rate) / 100 * 1.1
    + normalizedGap(rivalTurnovers, ownTurnovers) * .55
    + normalizedGap(ownTerritory, rivalTerritory) * .35;

  const ownBoxXg = zoneTotal(ownReview, "xg", ["box"]);
  const rivalBoxXg = zoneTotal(rivalReview, "xg", ["box"]);
  const ownBoxActions = zoneTotal(ownReview, "actions", ["box"]);
  const rivalBoxActions = zoneTotal(rivalReview, "actions", ["box"]);
  const chanceWeight = Math.max(0, rivalFinalThird.rate - ownFinalThird.rate) / 100 * .55
    + Math.max(0, rivalChance.rate - ownChance.rate) / 100 * .85
    + normalizedGap(ownXg, rivalXg) * 1.05
    + normalizedGap(ownShots, rivalShots) * .25
    + normalizedGap(ownBoxXg, rivalBoxXg) * .5
    + normalizedGap(ownBoxActions, rivalBoxActions) * .3;

  const ownAccuracy = ownShots ? ownOnTarget / ownShots : 0;
  const rivalAccuracy = rivalShots ? rivalOnTarget / rivalShots : 0;
  const missedChanceVariance = Math.max(0, ownXg - ownGoals);
  const concededVariance = Math.max(0, rivalGoals - rivalXg);
  const finishingWeight = missedChanceVariance / Math.max(.5, ownXg) * .7
    + concededVariance / Math.max(.5, rivalXg) * .65
    + Math.max(0, rivalAccuracy - ownAccuracy) * .3
    + normalizedGap(finite(ownStats.saves), finite(rivalStats.saves)) * .12;

  const ownRecoveries = zoneTotal(ownReview, "recoveries");
  const rivalRecoveries = zoneTotal(rivalReview, "recoveries");
  const ownTransitionXg = finite(ownStats.transitionXg);
  const rivalTransitionXg = finite(rivalStats.transitionXg);
  const ownTransitionShots = finite(ownStats.transitionShots);
  const rivalTransitionShots = finite(rivalStats.transitionShots);
  const adverseEvents = events.filter((event) =>
    (Number(event?.teamIndex) === viewerIndex && ["red", "injury", "lightning", "ownGoal"].includes(event?.type))
    || (Number(event?.teamIndex) === opponentIndex && ["penaltyAwarded", "blackWhistle"].includes(event?.type)));
  const adverseEventWeight = adverseEvents.reduce((sum, event) => sum + ({ red:.75, injury:.28, lightning:.4, ownGoal:.65, penaltyAwarded:.45, blackWhistle:.45 }[event.type] ?? 0), 0);
  const transitionDefenseWeight = normalizedGap(ownTransitionXg, rivalTransitionXg, .25) * .8
    + normalizedGap(ownTransitionShots, rivalTransitionShots) * .35
    + normalizedGap(ownBoxActions, rivalBoxActions) * .45
    + normalizedGap(ownRecoveries, rivalRecoveries) * .25
    + normalizedGap(finite(own.activeCount, 11), finite(rival.activeCount, 11), 11) * .6;

  const ownStructure = timelineAverage(detail, viewerIndex, "structureIndex");
  const rivalStructure = timelineAverage(detail, opponentIndex, "structureIndex");
  const ownPositionFit = timelineAverage(detail, viewerIndex, "positionFit");
  const rivalPositionFit = timelineAverage(detail, opponentIndex, "positionFit");
  const ownTacticalFit = timelineAverage(detail, viewerIndex, "tacticalFit");
  const rivalTacticalFit = timelineAverage(detail, opponentIndex, "tacticalFit");
  const ownFitness = timelineAverage(detail, viewerIndex, "averageFitness");
  const rivalFitness = timelineAverage(detail, opponentIndex, "averageFitness");
  const executionWeight = Math.max(0, rivalTacticalFit - ownTacticalFit) * .65
    + Math.max(0, rivalStructure - ownStructure) * .45
    + Math.max(0, rivalPositionFit - ownPositionFit) * .3
    + Math.max(0, rivalFitness - ownFitness) / 100 * .25
    + adverseEventWeight * .38
    + normalizedGap(finite(rivalStats.fouls), finite(ownStats.fouls)) * .12;

  const coverage = v2ReviewCoverage(detail);
  const result = finalizeLossAttribution({
    method:"v2-engine-evidence-attribution-v2",
    title:"V2比赛实录归因",
    note:"百分比表示各类已观测劣势在本场解释信号中的相对占比，不代表把该因素消除后比分一定改变。OVR不单独重复计权；能力、特性和体能已经通过V2控球链、空间对抗与事件结果体现。",
    dataSources:["V2六阶段控球链", "V2 20区域行动与失误", "阵地/转换射门与xG", "V2防守及纪律事件", "V2战术阶段快照"],
    items:[
      {
        key:"buildup",
        label:"出球与推进",
        value:buildupWeight,
        detail:`组织 ${ownBuildUp.rate.toFixed(1)}%:${rivalBuildUp.rate.toFixed(1)}% · 推进 ${ownProgression.rate.toFixed(1)}%:${rivalProgression.rate.toFixed(1)}% · 高位丢失 ${ownTurnovers}:${rivalTurnovers}`,
        evidence:[`推进成功 ${ownProgression.successes}/${ownProgression.attempts}，对手 ${rivalProgression.successes}/${rivalProgression.attempts}`, `前场与禁区行动 ${ownTerritory}:${rivalTerritory}`],
        sources:["控球链阶段", "20区域失误"],
      },
      {
        key:"chance",
        label:"阵地机会",
        value:chanceWeight,
        detail:`机会阶段 ${ownChance.rate.toFixed(1)}%:${rivalChance.rate.toFixed(1)}% · xG ${ownXg.toFixed(2)}:${rivalXg.toFixed(2)} · 禁区xG ${ownBoxXg.toFixed(2)}:${rivalBoxXg.toFixed(2)}`,
        evidence:[`进入禁区后的行动 ${ownBoxActions}:${rivalBoxActions}`, `射门 ${ownShots}:${rivalShots}`],
        sources:["机会阶段", "区域xG"],
      },
      {
        key:"finishing",
        label:"终结与门将",
        value:finishingWeight,
        detail:`进球/xG ${ownGoals}/${ownXg.toFixed(2)}:${rivalGoals}/${rivalXg.toFixed(2)} · 射正 ${ownOnTarget}:${rivalOnTarget} · 扑救 ${finite(ownStats.saves)}:${finite(rivalStats.saves)}`,
        evidence:[`本方低于xG ${missedChanceVariance.toFixed(2)}`, `对手高于xG ${concededVariance.toFixed(2)}`],
        sources:["射门事件", "门将事件"],
      },
      {
        key:"transitionDefense",
        label:"转换与防守",
        value:transitionDefenseWeight,
        detail:`转换xG ${ownTransitionXg.toFixed(2)}:${rivalTransitionXg.toFixed(2)} · 转换射门 ${ownTransitionShots}:${rivalTransitionShots} · 夺回 ${ownRecoveries}:${rivalRecoveries}`,
        evidence:[`对手禁区行动 ${rivalBoxActions}`, `本方有效人数 ${finite(own.activeCount, 11)}`],
        sources:["转换进攻来源", "区域夺回"],
      },
      {
        key:"execution",
        label:"战术与纪律",
        value:executionWeight,
        detail:`结构 ${ownStructure.toFixed(2)}:${rivalStructure.toFixed(2)} · 位置 ${Math.round(ownPositionFit * 100)}%:${Math.round(rivalPositionFit * 100)}% · 不利事件 ${adverseEvents.length}`,
        evidence:[`战术适配 ${Math.round(ownTacticalFit * 100)}%:${Math.round(rivalTacticalFit * 100)}%`, `全场体能 ${ownFitness.toFixed(1)}:${rivalFitness.toFixed(1)}`],
        sources:["战术快照", "纪律与伤停"],
      },
    ],
  });
  return { ...result, version:2, confidence:coverage };
}

const DIAGNOSIS_LEVELS = Object.freeze([
  { minimum:45, key:"critical", label:"主要问题" },
  { minimum:22, key:"warning", label:"需要调整" },
  { minimum:0, key:"stable", label:"不是主因" },
]);

function diagnosisLevel(score) {
  return DIAGNOSIS_LEVELS.find((level) => score >= level.minimum) ?? DIAGNOSIS_LEVELS.at(-1);
}

function diagnosisZoneLabel(zoneId, defending = false) {
  const [band, lane] = String(zoneId ?? "").split(":");
  const bandLabels = { defensiveThird:"后场", buildUp:"中场", finalThird:"前场", box:"禁区" };
  const laneLabels = defending
    ? { farLeft:"本方右路", leftHalfSpace:"本方右肋", center:"本方中路", rightHalfSpace:"本方左肋", farRight:"本方左路" }
    : { farLeft:"左路", leftHalfSpace:"左肋", center:"中路", rightHalfSpace:"右肋", farRight:"右路" };
  return `${bandLabels[band] ?? band}${laneLabels[lane] ?? lane}`;
}

function zoneAdvice(zoneId, type) {
  const [band, lane] = String(zoneId ?? "").split(":");
  const central = ["leftHalfSpace", "center", "rightHalfSpace"].includes(lane);
  if (type === "midfield") return central
    ? "增加一名中场接应点，降低出球节奏或直传风险，避免后场球员被迫越级传球。"
    : "让同侧边后卫与边锋形成近距离接应，避免边线附近形成孤立持球。";
  if (type === "attack") return central
    ? "增加肋部交叉跑动或将一名中场前移接应，避免禁区前沿只有单点进攻。"
    : "保留边路宽度后优先寻找倒三角和后点，不要连续低质量传中。";
  if (type === "defense") return central || band === "box"
    ? "收紧中路与肋部距离，保留后腰屏障，避免中卫被拉出后直接暴露禁区。"
    : "降低同侧边后卫前插幅度，并要求边锋回防形成二对二保护。";
  return "优先调整该区域附近的站位距离与接应关系。";
}

function buildProblemAreas(ownReview, rivalReview) {
  const midfield = (ownReview?.zones ?? []).filter((zone) => String(zone.zone).startsWith("buildUp:") && finite(zone.actions) >= 4).map((zone) => {
    const actions = Math.max(1, finite(zone.actions));
    const successRate = percentage(finite(zone.successes), actions);
    const turnoverRate = percentage(finite(zone.turnovers), actions);
    return {
      type:"midfield",
      zone:zone.zone,
      label:diagnosisZoneLabel(zone.zone),
      score:(100 - successRate) * .5 + turnoverRate * .5,
      title:`${diagnosisZoneLabel(zone.zone)}出球受压`,
      evidence:`行动 ${actions} 次，成功率 ${successRate.toFixed(0)}%，失误率 ${turnoverRate.toFixed(0)}%。`,
      advice:zoneAdvice(zone.zone, "midfield"),
    };
  });
  const attack = (ownReview?.zones ?? []).filter((zone) => ["finalThird", "box"].includes(String(zone.zone).split(":")[0]) && finite(zone.actions) >= 3).map((zone) => {
    const actions = Math.max(1, finite(zone.actions));
    const successRate = percentage(finite(zone.successes), actions);
    const turnoverRate = percentage(finite(zone.turnovers), actions);
    return {
      type:"attack",
      zone:zone.zone,
      label:diagnosisZoneLabel(zone.zone),
      score:(100 - successRate) * .42 + turnoverRate * .28 + (finite(zone.shots) ? 0 : 18),
      title:`${diagnosisZoneLabel(zone.zone)}进攻转化偏低`,
      evidence:`行动 ${actions} 次，形成 ${finite(zone.shots)} 次射门、${finite(zone.xg).toFixed(2)} xG，丢失 ${finite(zone.turnovers)} 次。`,
      advice:zoneAdvice(zone.zone, "attack"),
    };
  });
  const defense = (rivalReview?.zones ?? []).filter((zone) => ["finalThird", "box"].includes(String(zone.zone).split(":")[0]) && (finite(zone.actions) >= 3 || finite(zone.shots) > 0)).map((zone) => ({
    type:"defense",
    zone:zone.zone,
    label:diagnosisZoneLabel(zone.zone, true),
    score:Math.min(100, finite(zone.xg) * 55 + finite(zone.shots) * 12 + finite(zone.goals) * 18 + finite(zone.actions) * 1.2),
    title:`${diagnosisZoneLabel(zone.zone, true)}承受威胁`,
    evidence:`对手在此行动 ${finite(zone.actions)} 次，完成 ${finite(zone.shots)} 次射门、${finite(zone.xg).toFixed(2)} xG。`,
    advice:zoneAdvice(zone.zone, "defense"),
  }));
  const candidates = [...midfield, ...attack, ...defense]
    .filter((area) => area.score >= 28)
    .sort((left, right) => right.score - left.score);
  const selected = [];
  for (const area of candidates) {
    if (selected.some((item) => item.type === area.type && item.label === area.label)) continue;
    selected.push({ ...area, severity:diagnosisLevel(area.score).key, score:Math.round(area.score) });
    if (selected.length >= 4) break;
  }
  return selected;
}

function buildV2GuidanceDiagnosis(detail, viewerIndex, opponentIndex, outcome) {
  const own = detail?.teams?.[viewerIndex] ?? {};
  const rival = detail?.teams?.[opponentIndex] ?? {};
  const ownStats = own.stats ?? {};
  const rivalStats = rival.stats ?? {};
  const ownReview = detail?.tacticalReview?.teams?.[viewerIndex] ?? {};
  const rivalReview = detail?.tacticalReview?.teams?.[opponentIndex] ?? {};
  const score = detail?.score ?? detail?.aggregateScore ?? [0, 0];
  const ownGoals = finite(score[viewerIndex]);
  const rivalGoals = finite(score[opponentIndex]);
  const ownXg = finite(ownStats.xg);
  const rivalXg = finite(rivalStats.xg);
  const ownShots = finite(ownStats.shots);
  const rivalShots = finite(rivalStats.shots);
  const ownOnTarget = finite(ownStats.shotsOnTarget);
  const rivalOnTarget = finite(rivalStats.shotsOnTarget);
  const ownBuild = stageSnapshot(ownReview, "buildUp");
  const rivalBuild = stageSnapshot(rivalReview, "buildUp");
  const ownProgression = stageSnapshot(ownReview, "progression");
  const rivalProgression = stageSnapshot(rivalReview, "progression");
  const ownFinalThird = stageSnapshot(ownReview, "finalThird");
  const rivalFinalThird = stageSnapshot(rivalReview, "finalThird");
  const ownChance = stageSnapshot(ownReview, "chance");
  const rivalChance = stageSnapshot(rivalReview, "chance");
  const ownBoxActions = zoneTotal(ownReview, "actions", ["box"]);
  const rivalBoxActions = zoneTotal(rivalReview, "actions", ["box"]);
  const ownTurnovers = zoneTotal(ownReview, "turnovers", ["buildUp", "finalThird", "box"]);
  const rivalTurnovers = zoneTotal(rivalReview, "turnovers", ["buildUp", "finalThird", "box"]);
  const ownTransitionXg = finite(ownStats.transitionXg);
  const rivalTransitionXg = finite(rivalStats.transitionXg);
  const ownPossession = finite(ownStats.possession);
  const rivalPossession = finite(rivalStats.possession);
  const ownShotQuality = ownShots ? ownXg / ownShots : 0;
  const rivalShotQuality = rivalShots ? rivalXg / rivalShots : 0;
  const ownAccuracy = ownShots ? ownOnTarget / ownShots : 0;
  const rivalAccuracy = rivalShots ? rivalOnTarget / rivalShots : 0;
  const ownStructure = timelineAverage(detail, viewerIndex, "structureIndex");
  const rivalStructure = timelineAverage(detail, opponentIndex, "structureIndex");
  const ownPositionFit = timelineAverage(detail, viewerIndex, "positionFit");
  const rivalPositionFit = timelineAverage(detail, opponentIndex, "positionFit");
  const ownTacticalFit = timelineAverage(detail, viewerIndex, "tacticalFit");
  const rivalTacticalFit = timelineAverage(detail, opponentIndex, "tacticalFit");
  const adverseEvents = (detail?.events ?? detail?.importantEvents ?? []).filter((event) => Number(event?.teamIndex) === viewerIndex && ["red", "injury", "lightning", "ownGoal"].includes(event?.type));
  const gap = (ownValue, rivalValue) => Math.max(0, rivalValue - ownValue) / 100;
  const attackScore = Math.min(100, 100 * (
    gap(ownFinalThird.rate, rivalFinalThird.rate) * .35
    + gap(ownChance.rate, rivalChance.rate) * .5
    + normalizedGap(ownXg, rivalXg, .5) * .35
    + normalizedGap(ownBoxActions, rivalBoxActions) * .25
    + Math.max(0, .1 - ownShotQuality) * 2
  ));
  const finishingScore = Math.min(100, 100 * (
    Math.max(0, ownXg - ownGoals) / Math.max(.75, ownXg) * .62
    + Math.max(0, rivalGoals - rivalXg) / Math.max(.75, rivalXg) * .38
    + Math.max(0, rivalAccuracy - ownAccuracy) * .22
  ));
  const midfieldScore = Math.min(100, 100 * (
    gap(ownBuild.rate, rivalBuild.rate) * .25
    + gap(ownProgression.rate, rivalProgression.rate) * .55
    + Math.max(0, rivalPossession - ownPossession) / 100 * .35
    + normalizedGap(rivalTurnovers, ownTurnovers) * .3
  ));
  const defenseScore = Math.min(100, 100 * (
    gap(ownChance.rate, rivalChance.rate) * .28
    + normalizedGap(ownBoxActions, rivalBoxActions) * .3
    + normalizedGap(ownTransitionXg, rivalTransitionXg, .2) * .32
    + Math.max(0, rivalShotQuality - .12) * 1.4
    + normalizedGap(finite(own.activeCount, 11), finite(rival.activeCount, 11), 11) * .35
  ));
  const tacticsScore = Math.min(100, 100 * (
    Math.max(0, rivalTacticalFit - ownTacticalFit) * .42
    + Math.max(0, rivalStructure - ownStructure) * .35
    + Math.max(0, rivalPositionFit - ownPositionFit) * .2
    + adverseEvents.length * .18
  ));
  const unit = (key, label, scoreValue, verdict, evidence, advice) => {
    const level = diagnosisLevel(scoreValue);
    return { key, label, score:Math.round(scoreValue), status:level.key, statusLabel:level.label, verdict, evidence, advice };
  };
  const units = [
    unit(
      "attack",
      "进攻组织",
      attackScore,
      attackScore >= 22
        ? ownShotQuality < .1 ? "射门不少，但大量起脚来自低价值位置。" : "进入前场后没有稳定转化为禁区威胁。"
        : "机会制造与禁区进入不是本场主要短板。",
      [`机会阶段 ${ownChance.rate.toFixed(1)}%:${rivalChance.rate.toFixed(1)}%`, `禁区行动 ${ownBoxActions}:${rivalBoxActions}`, `每次射门xG ${ownShotQuality.toFixed(2)}`],
      ownShotQuality < .1
        ? "减少禁区外仓促起脚，改用耐心创造、肋部渗透或倒三角寻找更高质量机会。"
        : "增加前腰与边锋在肋部的接应，优先改善机会阶段，而不是单纯增加前锋人数。",
    ),
    unit(
      "finishing",
      "终结效率",
      finishingScore,
      finishingScore >= 22 ? `创造 ${ownXg.toFixed(2)} xG 仅打进 ${ownGoals} 球，机会没有充分兑现。` : "实际进球与机会质量基本匹配。",
      [`进球/xG ${ownGoals}/${ownXg.toFixed(2)}`, `射正率 ${percentage(ownOnTarget, ownShots).toFixed(0)}%`, `对方门将扑救 ${finite(rivalStats.saves)} 次`],
      "阵型不必因此大改；优先检查中锋终结与冷静属性，并让射门更多发生在禁区中央。",
    ),
    unit(
      "midfield",
      "中场控制",
      midfieldScore,
      midfieldScore >= 22 ? "中场出球或向前推进受压，前后场连接不够稳定。" : "中场没有被持续压制，推进链条基本成立。",
      [`控球 ${ownPossession.toFixed(1)}%:${rivalPossession.toFixed(1)}%`, `推进成功率 ${ownProgression.rate.toFixed(1)}%:${rivalProgression.rate.toFixed(1)}%`, `高位丢失 ${ownTurnovers}:${rivalTurnovers}`],
      "增加CM/DM接应点，缩短后卫与中场距离；若直接打法失误过多，降低直传倾向和比赛节奏。",
    ),
    unit(
      "defense",
      "防守稳定",
      defenseScore,
      defenseScore >= 22 ? rivalTransitionXg > ownTransitionXg + .15 ? "攻守转换保护不足，对手反击进入危险区域。" : "对手在禁区和机会阶段获得了过多空间。" : "防守并未暴露持续性结构问题。",
      [`对手xG/射门 ${rivalXg.toFixed(2)}/${rivalShots}`, `对手禁区行动 ${rivalBoxActions}`, `对手转换xG ${rivalTransitionXg.toFixed(2)}`],
      rivalTransitionXg > ownTransitionXg + .15
        ? "避免两侧同时前插，至少保留两名后卫加一名后腰；必要时降低防线和压迫强度。"
        : "优先保护中路和肋部，缩短后腰与中卫距离，再决定是否扩大防守宽度。",
    ),
    unit(
      "tactics",
      "阵型与战术",
      tacticsScore,
      tacticsScore >= 22 ? "阵型结构或球员职责适配低于对手，战术执行放大了其他环节的问题。" : "阵型结构和职责适配不是失利主因。",
      [`结构 ${ownStructure.toFixed(2)}:${rivalStructure.toFixed(2)}`, `位置适配 ${Math.round(ownPositionFit * 100)}%:${Math.round(rivalPositionFit * 100)}%`, `战术适配 ${Math.round(ownTacticalFit * 100)}%:${Math.round(rivalTacticalFit * 100)}%`],
      ownPositionFit + .03 < rivalPositionFit
        ? "先修正客串位置与球员职责，再调整整体战术；不要用更激进心态掩盖站位不适配。"
        : "检查三线距离与阵型宽度，让当前打法对应的关键位置获得足够支援。",
    ),
  ].sort((left, right) => right.score - left.score);
  const primary = units[0];
  const problemAreas = buildProblemAreas(ownReview, rivalReview);
  const actionable = units.filter((item) => item.score >= 18).slice(0, 3);
  const recommendations = (actionable.length ? actionable : [units[0]]).map((item, index) => ({
    priority:index + 1,
    target:item.label,
    title:index === 0 ? `优先修正${item.label}` : `随后检查${item.label}`,
    action:item.advice,
    reason:item.verdict,
  }));
  const causeChains = {
    attack:["进入前场后的连接不足", "禁区行动或射门质量下降", "xG积累受限", "难以追回比分"],
    finishing:["机会已经形成", "射正与门将环节未兑现", "实际进球低于机会质量", "比分被终结效率决定"],
    midfield:["中场接应点不足或受压", "推进阶段失误增加", "前场获得球权次数下降", "进攻端持续缺少支援"],
    defense:["丢球后阵型未及时回收", "对手进入肋部或禁区", "形成高质量射门", "防守端承担决定性损失"],
    tactics:["阵型结构或职责不适配", "局部区域失去人数与距离保护", "攻防效率同时下降", "战术问题放大比分差距"],
  };
  const structuralIssue = primary.score >= 22;
  return {
    version:1,
    method:"v2-coach-guidance-v1",
    outcome,
    primary:{ ...primary, structuralIssue },
    summary:structuralIssue
      ? `主要问题是${primary.label}：${primary.verdict}`
      : "本场没有识别出明显结构性短板，结果更接近关键事件与终结波动。",
    causeChain:causeChains[primary.key] ?? causeChains.tactics,
    units,
    problemAreas,
    recommendations,
    confidence:v2ReviewCoverage(detail),
  };
}

function buildV2MatchReview(detail, viewerIndex, opponentIndex, outcome) {
  const own = detail?.teams?.[viewerIndex] ?? {};
  const rival = detail?.teams?.[opponentIndex] ?? {};
  const ownStats = own.stats ?? {};
  const rivalStats = rival.stats ?? {};
  const ownReview = detail?.tacticalReview?.teams?.[viewerIndex] ?? {};
  const rivalReview = detail?.tacticalReview?.teams?.[opponentIndex] ?? {};
  const score = detail?.score ?? detail?.aggregateScore ?? [0, 0];
  const ownGoals = finite(score[viewerIndex]);
  const rivalGoals = finite(score[opponentIndex]);
  const ownXg = finite(ownStats.xg);
  const rivalXg = finite(rivalStats.xg);
  const ownShots = finite(ownStats.shots);
  const rivalShots = finite(rivalStats.shots);
  const ownOnTarget = finite(ownStats.shotsOnTarget);
  const rivalOnTarget = finite(rivalStats.shotsOnTarget);
  const ownPossession = finite(ownStats.possession);
  const rivalPossession = finite(rivalStats.possession);
  const ownBoxActions = zoneTotal(ownReview, "actions", ["box"]);
  const rivalBoxActions = zoneTotal(rivalReview, "actions", ["box"]);
  const ownFinalThirdActions = zoneTotal(ownReview, "actions", ["finalThird"]);
  const rivalFinalThirdActions = zoneTotal(rivalReview, "actions", ["finalThird"]);
  const ownHighTurnovers = zoneTotal(ownReview, "turnovers", ["buildUp", "finalThird", "box"]);
  const rivalHighTurnovers = zoneTotal(rivalReview, "turnovers", ["buildUp", "finalThird", "box"]);
  const ownRecoveries = zoneTotal(ownReview, "recoveries");
  const rivalRecoveries = zoneTotal(rivalReview, "recoveries");
  const stages = [
    { key:"buildUp", label:"后场组织" },
    { key:"progression", label:"向前推进" },
    { key:"finalThird", label:"进入前场" },
    { key:"chance", label:"形成机会" },
    { key:"shot", label:"完成射门" },
  ].map(({ key, label }) => {
    const ownStage = stageSnapshot(ownReview, key);
    const rivalStage = stageSnapshot(rivalReview, key);
    return {
      key,
      label,
      own:ownStage,
      rival:rivalStage,
      delta:Number((ownStage.rate - rivalStage.rate).toFixed(1)),
      edge:ownStage.rate === rivalStage.rate ? "even" : ownStage.rate > rivalStage.rate ? "own" : "rival",
    };
  });
  const ownRoute = dominantRoute(ownReview);
  const rivalRoute = dominantRoute(rivalReview);
  const normalSource = {
    key:"normal",
    label:"阵地进攻",
    own:{ shots:finite(ownStats.normalShots, ownShots), xg:finite(ownStats.normalXg, ownXg) },
    rival:{ shots:finite(rivalStats.normalShots, rivalShots), xg:finite(rivalStats.normalXg, rivalXg) },
  };
  const transitionSource = {
    key:"transition",
    label:"转换进攻",
    own:{ shots:finite(ownStats.transitionShots), xg:finite(ownStats.transitionXg) },
    rival:{ shots:finite(rivalStats.transitionShots), xg:finite(rivalStats.transitionXg) },
  };
  const allEvents = Array.isArray(detail?.events) ? detail.events : (detail?.importantEvents ?? []);
  const importantEvents = Array.isArray(detail?.importantEvents) ? detail.importantEvents : allEvents;
  const goals = importantEvents.filter((event) => ["goal", "butterFingers", "ownGoal", "superWorldie"].includes(event?.type));
  const winningTeamIndex = ownGoals === rivalGoals ? null : ownGoals > rivalGoals ? viewerIndex : opponentIndex;
  const decisiveGoal = outcome === "draw" ? goals.at(-1) : [...goals].reverse().find((event) => Number(event.teamIndex) === winningTeamIndex);
  const redCard = importantEvents.find((event) => event?.type === "red");
  const tacticalChange = importantEvents.find((event) => event?.type === "tactical" && (event.plan || event.tactic || event.style || event.formation));
  const turningPoint = decisiveGoal ?? redCard ?? tacticalChange ?? importantEvents[0] ?? null;
  const ownBest = topRatedPlayer(own);
  const xgDelta = ownXg - rivalXg;
  const closeXg = Math.abs(xgDelta) < .2;
  const headline = outcome === "loss"
    ? xgDelta > .25
      ? "机会质量占优，但终结结果与关键防守未能兑现"
      : closeXg
        ? "机会质量接近，关键事件和终结差异决定失利"
        : "对手在推进后的机会质量上建立了实质优势"
    : outcome === "win"
      ? xgDelta < -.25
        ? "承受更多高质量机会，但把握效率和防守结果更好"
        : "从机会制造到终结兑现形成了胜势"
      : closeXg
        ? "双方机会质量接近，平局基本符合比赛过程"
        : xgDelta > 0 ? "本方机会质量占优，但未能转化为胜势" : "对手机会质量更高，本方守住平局";
  const weakestStage = [...stages].sort((left, right) => left.delta - right.delta)[0];
  const strongestStage = [...stages].sort((left, right) => right.delta - left.delta)[0];
  const stageInsight = weakestStage.delta < -1
    ? `${weakestStage.label}是最明显瓶颈，成功率 ${weakestStage.own.rate.toFixed(1)}%:${weakestStage.rival.rate.toFixed(1)}%。`
    : strongestStage.delta > 1
      ? `${strongestStage.label}表现最好，成功率 ${strongestStage.own.rate.toFixed(1)}%:${strongestStage.rival.rate.toFixed(1)}%。`
      : "双方五个推进阶段的成功率整体接近。";
  const ownTransitionShare = percentage(transitionSource.own.xg, ownXg);
  const rivalTransitionShare = percentage(transitionSource.rival.xg, rivalXg);
  const sourceInsight = `转换进攻贡献本方 ${ownTransitionShare.toFixed(0)}% xG、对手 ${rivalTransitionShare.toFixed(0)}% xG；主要路线为${ownRoute.label}。`;
  const turningPointText = turningPoint
    ? `${finite(turningPoint.minute)}′ ${turningPoint.text ?? "出现本场关键事件"}`
    : "没有记录到单一决定性事件，结果来自全场累计差异。";
  const playerText = ownBest
    ? `${ownBest.name}评分 ${finite(ownBest.rating).toFixed(1)}，${finite(ownBest.stats?.goals)}球 ${finite(ownBest.stats?.assists)}助，防守动作 ${["tackles", "interceptions", "clearances", "blocks", "pressuresWon"].reduce((sum, key) => sum + finite(ownBest.stats?.[key]), 0)}次。`
    : "没有足够的V2球员评分数据。";
  const coverage = v2ReviewCoverage(detail);
  const guidance = buildV2GuidanceDiagnosis(detail, viewerIndex, opponentIndex, outcome);

  return {
    version:3,
    source:"v2-engine-report",
    outcome,
    headline:outcome === "loss" ? guidance.summary : headline,
    summary:outcome === "loss" ? guidance.primary.advice : `控球 ${ownPossession.toFixed(1)}%:${rivalPossession.toFixed(1)}%，xG ${ownXg.toFixed(2)}:${rivalXg.toFixed(2)}，禁区行动 ${ownBoxActions}:${rivalBoxActions}。`,
    engineFacts:{
      engineProfile:detail?.engineProfile ?? detail?.modelVersion ?? "V2",
      chainModelVersion:detail?.tacticalReview?.chainModelVersion ?? "possession-chain-v2.1",
      spatialModelVersion:detail?.tacticalReview?.spatialModelVersion ?? detail?.dynamicShapeModelVersion ?? "V2 spatial",
      chainCount:coverage.chainCount,
      confidence:coverage,
    },
    metrics:[
      comparisonMetric("控球率", ownPossession, rivalPossession, "%"),
      { ...comparisonMetric("预期进球", ownXg, rivalXg), ownText:ownXg.toFixed(2), rivalText:rivalXg.toFixed(2) },
      comparisonMetric("射正", ownOnTarget, rivalOnTarget),
      comparisonMetric("禁区行动", ownBoxActions, rivalBoxActions),
      comparisonMetric("前场行动", ownFinalThirdActions, rivalFinalThirdActions),
      comparisonMetric("区域夺回", ownRecoveries, rivalRecoveries),
    ],
    phaseComparisons:stages,
    attackSources:[normalSource, transitionSource],
    zoneComparison:{
      own:{ finalThirdActions:ownFinalThirdActions, boxActions:ownBoxActions, highTurnovers:ownHighTurnovers, recoveries:ownRecoveries },
      rival:{ finalThirdActions:rivalFinalThirdActions, boxActions:rivalBoxActions, highTurnovers:rivalHighTurnovers, recoveries:rivalRecoveries },
    },
    routeProfile:{ own:ownRoute, rival:rivalRoute },
    guidance,
    insights:[
      { tone:weakestStage.delta < -1 ? "warning" : "positive", title:"阶段对抗", text:stageInsight },
      { tone:ownTransitionShare >= rivalTransitionShare ? "positive" : "warning", title:"进攻来源", text:sourceInsight },
      { tone:turningPoint?.teamIndex === viewerIndex ? "positive" : turningPoint?.teamIndex === opponentIndex ? "warning" : "neutral", title:"关键节点", text:turningPointText },
      { tone:"neutral", title:"本方代表", text:playerText },
    ],
    efficiency:{ own:conversionText({ shots:ownShots, goals:ownGoals }), rival:conversionText({ shots:rivalShots, goals:rivalGoals }) },
    lossAttribution:buildV2LossAttribution(detail, viewerIndex, opponentIndex, outcome),
  };
}

export function buildMatchReview(detail, viewerIndexValue = detail?.viewerIndex ?? 0) {
  const viewerIndex = Number(viewerIndexValue) === 1 ? 1 : 0;
  const opponentIndex = viewerIndex === 0 ? 1 : 0;
  const own = detail?.teams?.[viewerIndex] ?? {};
  const rival = detail?.teams?.[opponentIndex] ?? {};
  const ownStats = own.stats ?? {};
  const rivalStats = rival.stats ?? {};
  const score = detail?.score ?? detail?.aggregateScore ?? [0, 0];
  const ownGoals = finite(score[viewerIndex]);
  const rivalGoals = finite(score[opponentIndex]);
  const ownXg = finite(ownStats.xg);
  const rivalXg = finite(rivalStats.xg);
  const ownShots = finite(ownStats.shots);
  const rivalShots = finite(rivalStats.shots);
  const ownPossession = finite(ownStats.possession);
  const rivalPossession = finite(rivalStats.possession);
  const outcome = ownGoals === rivalGoals ? "draw" : ownGoals > rivalGoals ? "win" : "loss";
  const v2Report = isV2Report(detail);
  if (v2Report) return buildV2MatchReview(detail, viewerIndex, opponentIndex, outcome);
  const winningTeamIndex = ownGoals === rivalGoals ? null : ownGoals > rivalGoals ? viewerIndex : opponentIndex;
  const ownBest = topRatedPlayer(own);
  const allEvents = Array.isArray(detail?.events) ? detail.events : (detail?.importantEvents ?? []);
  const importantEvents = Array.isArray(detail?.importantEvents) ? detail.importantEvents : allEvents;
  const goals = importantEvents.filter((event) => ["goal", "butterFingers", "ownGoal", "superWorldie"].includes(event?.type));
  const decisiveGoal = outcome === "draw"
    ? goals.at(-1)
    : [...goals].reverse().find((event) => Number(event.teamIndex) === winningTeamIndex);
  const redCard = importantEvents.find((event) => event?.type === "red");
  const tacticalChange = importantEvents.find((event) =>
    event?.type === "tactical"
    && Number.isInteger(Number(event.teamIndex))
    && (event.plan || event.tactic || event.style || event.formation));
  const turningPoint = decisiveGoal ?? redCard ?? tacticalChange ?? importantEvents[0] ?? null;
  const chanceEdge = ownXg === rivalXg ? "双方机会质量接近" : ownXg > rivalXg ? "本方创造了更高质量的机会" : "对手创造了更高质量的机会";
  const controlEdge = ownPossession === rivalPossession ? "控球基本均衡" : ownPossession > rivalPossession ? "本方掌握更多球权" : "对手掌握更多球权";
  const scoreVerdict = outcome === "win"
    ? "最终守住了胜果"
    : outcome === "loss"
      ? "最终未能扭转比分"
      : "双方都没有建立决定性优势";
  const turningPointText = turningPoint
    ? `${finite(turningPoint.minute)}′ ${turningPoint.text ?? "出现了本场关键事件"}`
    : "本场没有记录到明确的关键转折。";
  const playerText = ownBest
    ? `${ownBest.name}以 ${finite(ownBest.rating).toFixed(1)} 分成为本方评分最高球员，贡献 ${finite(ownBest.stats?.goals)} 球 ${finite(ownBest.stats?.assists)} 助。`
    : "本场旧记录没有足够的球员评分数据。";

  return {
    version:1,
    source:"legacy-match-report",
    outcome,
    headline:`${chanceEdge}，${scoreVerdict}`,
    summary:`${controlEdge}；射门 ${ownShots}:${rivalShots}，预期进球 ${ownXg.toFixed(2)}:${rivalXg.toFixed(2)}。`,
    metrics:[
      comparisonMetric("控球率", ownPossession, rivalPossession, "%"),
      comparisonMetric("射门", ownShots, rivalShots),
      {
        ...comparisonMetric("预期进球", ownXg, rivalXg),
        ownText:ownXg.toFixed(2),
        rivalText:rivalXg.toFixed(2),
      },
    ],
    conclusions:[
      {
        tone:ownXg >= rivalXg ? "positive" : "warning",
        title:"机会质量",
        text:`${chanceEdge}，xG 为 ${ownXg.toFixed(2)}:${rivalXg.toFixed(2)}。`,
      },
      {
        tone:turningPoint?.teamIndex === viewerIndex ? "positive" : turningPoint?.teamIndex === opponentIndex ? "warning" : "neutral",
        title:"关键转折",
        text:turningPointText,
      },
      {
        tone:"neutral",
        title:"本方最佳",
        text:playerText,
      },
    ],
    efficiency:{
      own:conversionText({ shots:ownShots, goals:ownGoals }),
      rival:conversionText({ shots:rivalShots, goals:rivalGoals }),
    },
    lossAttribution:buildLegacyLossAttribution(detail, viewerIndex, opponentIndex, outcome),
  };
}

export function hydrateHistoricalMatchDetail(detail) {
  const hydrated = structuredClone(detail);
  if (!Array.isArray(hydrated.teams)) return hydrated;
  hydrated.teams = (hydrated.teams ?? []).map((team) => {
    const players = (team.players ?? []).map((player) => {
      const catalogPlayer = REAL_PLAYER_BY_ID[player.id];
      const { legendAbility:discardedLegendAbility, signature:discardedSignature, ...publicPlayer } = player;
      return {
        ...publicPlayer,
        role: player.role ?? catalogPlayer?.role ?? "AM",
        assignedRole: player.assignedRole ?? player.role ?? catalogPlayer?.role ?? "AM",
        overall: Number.isFinite(Number(player.overall)) ? Number(player.overall) : Number(catalogPlayer?.overall ?? 0),
      };
    });
    const fallbackPositions = defaultElevenPositions(players);
    const positions = Object.fromEntries(players.map((player) => {
      const savedPosition = validPosition(player.position)
        ? player.position
        : validPosition(team.positions?.[player.id])
          ? team.positions[player.id]
          : fallbackPositions[player.id];
      return [player.id, { x: Number(savedPosition.x), y: Number(savedPosition.y) }];
    }));
    const formation = analyzeElevenFormation(players, positions);
    return {
      ...team,
      formation: team.formation ?? formation.name,
      positions,
      players: players.map((player) => ({
        ...player,
        assignedRole: player.assignedRole ?? formation.roles[player.id],
        position: { ...positions[player.id] },
      })),
    };
  });
  hydrateV2AnalysisTimeline(hydrated);
  hydrated.review = buildMatchReview(hydrated);
  return hydrated;
}
