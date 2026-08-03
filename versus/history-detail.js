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

function buildLossAttribution(detail, viewerIndex, opponentIndex, outcome) {
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
  const total = weighted.reduce((sum, item) => sum + item.value, 0) || 1;
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
  const items = exact.map(({ exact:discardedExact, value:discardedValue, ...item }, index) => ({ ...item, percent:rounded[index] }));
  return {
    method:"timeline-estimate-v2",
    title:"失利因素估算",
    note:`按 ${totalMinutes} 分钟阶段快照加权计算；随机性只承担进球偏离xG、伤停判罚与事件抽样残差，并设置为不能掩盖已识别的阵型、体力和能力劣势。该结果是解释性估算，并非精确因果。`,
    items,
    primary:items.reduce((best, item) => item.percent > best.percent ? item : best, items[0]),
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
    lossAttribution:buildLossAttribution(detail, viewerIndex, opponentIndex, outcome),
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
