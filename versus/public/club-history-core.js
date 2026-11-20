// YFFM1 「俱乐部数据」核心计算与筛选引擎（纯函数，无 DOM 依赖）
// 严格遵循统一口径：
// - 胜率 = 胜场 / 已完赛总场次（平局计入分母，0 场显示 "—"）
// - 点球大战前的终场比分（含加时）决定本场胜平负，点球比分与晋级结果另列
// - 场均评分榜满 5 场有效评分入榜；并列主要指标显示并列名次
// - 缺失指标显示 "—"，有记录且数值为 0 显示 0

export const RATING_MIN_APPEARANCES = 5;

export function getOwnResult(match) {
  const own = match.venue === "home" ? match.homeGoals : match.awayGoals;
  const opp = match.venue === "home" ? match.awayGoals : match.homeGoals;
  if (own > opp) return "W";
  if (own < opp) return "L";
  return "D";
}

export function getOwnAndOppGoals(match) {
  return match.venue === "home"
    ? { own: Number(match.homeGoals) || 0, opp: Number(match.awayGoals) || 0 }
    : { own: Number(match.awayGoals) || 0, opp: Number(match.homeGoals) || 0 };
}

export function formatWinRate(wins, total) {
  if (!total) return "—";
  return `${((wins / total) * 100).toFixed(1)}%`;
}

export function formatPerGame(value, apps) {
  if (!apps || value == null) return "—";
  return (value / apps).toFixed(2);
}

export function competitionScopeLabel(competition) {
  return (
    {
      official: "正式比赛",
      league_A: "甲级联赛 (A)",
      league_B: "乙级联赛 (B)",
      cup: "冠军杯",
      "season-final": "赛季总决赛",
      worldcup: "黄狗世界杯",
      legacyLeague: "旧制联赛",
      friendly: "友谊赛",
      all: "全部赛事（含友谊赛）",
    }[competition] ?? "正式比赛"
  );
}

export function filterMatches(matches, filters = {}, opponentMap = new Map()) {
  const {
    seasonId = "all",
    competition = "official",
    venue = "all",
    opponentId = "all",
    opponentQuery = "",
    result = "all",
  } = filters;
  const q = String(opponentQuery ?? "").trim().toLowerCase();

  return (matches ?? [])
    .filter((m) => {
      if (seasonId !== "all" && m.seasonId !== seasonId) return false;
      if (competition === "official" && m.competition === "friendly") return false;
      if (competition === "league_A" && !(m.competition === "league" && m.division === "A")) return false;
      if (competition === "league_B" && !(m.competition === "league" && m.division === "B")) return false;
      if (competition === "legacyLeague" && (m.competition !== "league" || m.division)) return false;
      if (["cup","worldcup","season-final"].includes(competition) && m.competition !== competition) return false;
      if (competition === "friendly" && m.competition !== "friendly") return false;
      if (venue !== "all" && m.venue !== venue) return false;
      if (opponentId !== "all" && m.opponentId !== opponentId) return false;
      if (result !== "all" && getOwnResult(m) !== result) return false;
      if (q) {
        const opp = opponentMap.get(m.opponentId);
        const names = [opp?.name ?? "", ...(opp?.previousNames ?? []), m.competitionName ?? "", m.round ?? ""];
        if (!names.some((n) => n.toLowerCase().includes(q))) return false;
      }
      return true;
    })
    .sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0) || String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
}

export function computeSummary(matches) {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let withPlayerDetails = 0;

  for (const m of matches) {
    const res = getOwnResult(m);
    if (res === "W") wins += 1;
    else if (res === "D") draws += 1;
    else losses += 1;
    const { own, opp } = getOwnAndOppGoals(m);
    goalsFor += own;
    goalsAgainst += opp;
    if (m.hasPlayerDetails) withPlayerDetails += 1;
  }

  const total = wins + draws + losses;
  return {
    total,
    wins,
    draws,
    losses,
    winRate: formatWinRate(wins, total),
    winRateNum: total ? (wins / total) * 100 : 0,
    goalsFor,
    goalsAgainst,
    goalDiff: goalsFor - goalsAgainst,
    withPlayerDetails,
    missingPlayerDetails: total - withPlayerDetails,
  };
}

export function computeHeadToHead(matches, opponents = []) {
  const oppMap = new Map(opponents.map((o) => [o.id, o]));
  const buckets = new Map();

  for (const m of matches) {
    if (!buckets.has(m.opponentId)) buckets.set(m.opponentId, []);
    buckets.get(m.opponentId).push(m);
  }

  const list = [];
  for (const [opponentId, oppMatches] of buckets.entries()) {
    const sorted = [...oppMatches].sort(
      (a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0) || String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))
    );
    const total = computeSummary(sorted);
    const home = computeSummary(sorted.filter((m) => m.venue === "home"));
    const away = computeSummary(sorted.filter((m) => m.venue === "away"));
    const last5 = sorted.slice(0, 5).map((m) => ({ matchId: m.id, result: getOwnResult(m) }));
    const latest = sorted[0];
    const opp = oppMap.get(opponentId) ?? { id: opponentId, name: opponentId, previousNames: [], short: "客", color: "#64748b" };

    list.push({
      opponent: opp,
      matches: sorted,
      total,
      home,
      away,
      last5,
      latest,
    });
  }

  return list.sort(
    (a, b) =>
      b.total.total - a.total.total ||
      b.total.winRateNum - a.total.winRateNum ||
      a.opponent.name.localeCompare(b.opponent.name, "zh-CN")
  );
}

export const LEADERBOARD_CONFIGS = [
  { key: "scorers", label: "射手榜", primaryLabel: "进球", auxLabels: ["出场", "场均进球"] },
  { key: "assists", label: "助攻榜", primaryLabel: "助攻", auxLabels: ["出场", "场均助攻"] },
  { key: "contributions", label: "进球参与榜", primaryLabel: "参与", auxLabels: ["进球", "助攻"] },
  { key: "appearances", label: "出场榜", primaryLabel: "出场", auxLabels: ["效力赛季", "状态"] },
  { key: "saves", label: "扑救榜", primaryLabel: "扑救", auxLabels: ["出场", "场均扑救"] },
  { key: "rating", label: "场均评分榜", primaryLabel: "场均评分", auxLabels: ["有效评分场次", "达标门槛"] },
];

function emptyTotals() {
  return {appearances:0,starts:0,subs:0,goals:0,assists:0,saves:0,ratingSum:0,ratedApps:0};
}

function accumulate(total, appearance) {
  total.appearances++;
  if (appearance.started === true) total.starts++;
  if (appearance.started === false) total.subs++;
  for (const key of ['goals','assists','saves']) {
    total[key] = total[key] === null || !Number.isFinite(appearance[key]) ? null : total[key] + appearance[key];
  }
  if (Number.isFinite(appearance.rating)) {
    total.ratingSum += appearance.rating;
    total.ratedApps++;
  }
}

function contributions(row) {
  return row.goals === null || row.assists === null ? null : row.goals + row.assists;
}

export function computePlayerLeaderboards(matches, players = [], boardKey = "scorers") {
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const statsMap = new Map();
  for (const m of matches) {
    for (const ps of m.playerStats ?? []) {
      const agg = statsMap.get(ps.playerId) ?? {...emptyTotals(),playerId:ps.playerId,seasons:new Set()};
      accumulate(agg,ps);
      agg.seasons.add(m.seasonId);
      statsMap.set(ps.playerId,agg);
    }
  }

  let rows = [...statsMap.values()].map((agg) => {
    const player = playerMap.get(agg.playerId) ?? {
      id: agg.playerId,
      name: agg.playerId,
      role: "—",
      roleLabel: "未知",
      grade: "C",
      status: "departed",
      stints: [],
    };
    const avgRating = agg.ratedApps > 0 ? agg.ratingSum / agg.ratedApps : null;
    return {
      player,
      appearances: agg.appearances,
      starts: agg.starts,
      subs: agg.subs,
      goals: agg.goals,
      assists: agg.assists,
      contributions: contributions(agg),
      saves: agg.saves,
      ratedApps: agg.ratedApps,
      avgRating,
      seasonCount: agg.seasons.size,
    };
  });

  if (boardKey === "saves") {
    rows = rows.filter((r) => r.player.role === "GK" || r.saves > 0);
  } else if (boardKey === "rating") {
    rows = rows.filter((r) => r.ratedApps >= RATING_MIN_APPEARANCES && r.avgRating !== null);
  }

  const metricOf = (r) => {
    switch (boardKey) {
      case "scorers":
        return r.goals;
      case "assists":
        return r.assists;
      case "contributions":
        return r.contributions;
      case "appearances":
        return r.appearances;
      case "saves":
        return r.saves;
      case "rating":
        return Number(r.avgRating.toFixed(2));
      default:
        return r.goals;
    }
  };

  rows = rows.filter(r => metricOf(r) !== null && metricOf(r) > 0);
  rows.sort(
    (a, b) =>
      metricOf(b) - metricOf(a) ||
      b.appearances - a.appearances ||
      a.player.name.localeCompare(b.player.name, "zh-CN")
  );

  // 标准体育并列名次（1, 1, 3）
  let prevMetric = null;
  let currentRank = 0;
  return rows.map((row, index) => {
    const m = metricOf(row);
    if (prevMetric === null || m !== prevMetric) {
      currentRank = index + 1;
      prevMetric = m;
    }
    return { ...row, rank: currentRank, primaryMetric: m };
  });
}

export function computePlayerCareer(matches, seasons, player) {
  const seasonOrder = new Map(seasons.map((s, idx) => [s.id, idx]));
  const seasonMap = new Map(seasons.map((s) => [s.id, s]));
  const bySeason = new Map();

  const total = emptyTotals();
  for (const m of matches) {
    const ps = m.playerStats?.find(entry => entry.playerId === player.id);
    if (!ps) continue;
    const row = bySeason.get(m.seasonId) ?? {...emptyTotals(),season:seasonMap.get(m.seasonId) ?? {id:m.seasonId,name:m.seasonId,divisionName:"—"}};
    accumulate(row,ps);
    accumulate(total,ps);
    bySeason.set(m.seasonId,row);
  }

  const seasonRows = [...bySeason.values()]
    .sort((a, b) => (seasonOrder.get(b.season.id) ?? 0) - (seasonOrder.get(a.season.id) ?? 0))
    .map((r) => ({
      ...r,
      contributions: contributions(r),
      avgRating: r.ratedApps > 0 ? (r.ratingSum / r.ratedApps).toFixed(2) : "—",
    }));

  return {
    player,
    seasonRows,
    total: {
      ...total,
      contributions: contributions(total),
      avgRating: total.ratedApps > 0 ? (total.ratingSum / total.ratedApps).toFixed(2) : "—",
    },
  };
}

export function computeHonorsAndRecords(seasons = [], matches = [], filters = {}) {
  // 荣誉时间线按赛季筛选
  const timelineSeasons = [...seasons]
    .filter((s) => !filters.seasonId || filters.seasonId === "all" || s.id === filters.seasonId)
    .reverse();

  const hasArchiveGap = timelineSeasons.some((s) => s.hasArchiveGap);

  // 最大比分胜利（按净胜球）与最大比分失利（按净负球），支持并列
  let maxWinGd = 0;
  let largestWins = [];
  let maxLossGd = 0;
  let largestLosses = [];

  for (const m of matches) {
    const { own, opp } = getOwnAndOppGoals(m);
    const gd = own - opp;
    if (gd > 0) {
      if (gd > maxWinGd) {
        maxWinGd = gd;
        largestWins = [m];
      } else if (gd === maxWinGd) {
        largestWins.push(m);
      }
    } else if (gd < 0) {
      const lossMag = -gd;
      if (lossMag > maxLossGd) {
        maxLossGd = lossMag;
        largestLosses = [m];
      } else if (lossMag === maxLossGd) {
        largestLosses.push(m);
      }
    }
  }

  // 连续纪录按时间正序计算
  const chronological = [...matches].sort(
    (a, b) => (a.playedAt ?? 0) - (b.playedAt ?? 0) || String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id))
  );

  const computeStreak = (predicate) => {
    let best = [];
    let current = [];
    for (const m of chronological) {
      if (predicate(m)) {
        current.push(m);
        if (current.length > best.length) best = [...current];
      } else {
        current = [];
      }
    }
    return best.length
      ? {
          count: best.length,
          startDate: best[0].date,
          endDate: best[best.length - 1].date,
          matches: best,
          verifiableOnly: hasArchiveGap,
        }
      : null;
  };

  return {
    timelineSeasons,
    largestWins: maxWinGd > 0 ? { gd: maxWinGd, matches: largestWins } : null,
    largestLosses: maxLossGd > 0 ? { gd: -maxLossGd, matches: largestLosses } : null,
    longestWinStreak: computeStreak((m) => getOwnResult(m) === "W"),
    longestUnbeatenStreak: computeStreak((m) => getOwnResult(m) !== "L"),
    hasArchiveGap,
  };
}
