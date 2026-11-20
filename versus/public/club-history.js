// YFFM1 「俱乐部数据」交互视图控制器（原生 ES 模块）
// 暴露 5 类标准接线回调：
// 1. loadHistory({ clubId })            — 读取队史
// 2. onFilterChange({ tab, filters, page }) — 筛选及翻页
// 3. onOpenMatchDetail({ matchId, match, context }) — 打开比赛详情
// 4. onPlayReplay({ matchId, match, context })      — 播放已有回放
// 5. onOpenPlayerCareer({ playerId, player, filters }) — 打开球员效力记录

import {
  LEADERBOARD_CONFIGS,
  RATING_MIN_APPEARANCES,
  competitionScopeLabel,
  computeHeadToHead,
  computeHonorsAndRecords,
  computePlayerCareer,
  computePlayerLeaderboards,
  computeSummary,
  filterMatches,
  formatPerGame,
  getOwnResult,
} from "./club-history-core.js";

const TABS = [
  { id: "overview", label: "队史总览" },
  { id: "matches", label: "全部比赛" },
  { id: "h2h", label: "交手记录" },
  { id: "players", label: "球员榜单" },
  { id: "honors", label: "荣誉与纪录" },
];

const RESULT_LABEL = { W: "胜", D: "平", L: "负" };

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreOrderMarkup(match, clubName, oppName) {
  const homeName = match.venue === "home" ? clubName : oppName;
  const awayName = match.venue === "home" ? oppName : clubName;
  const pen = match.penalties ? ` <span class="ch-pill emerald">${esc(match.penalties.label)}</span>` : "";
  return `<div class="ch-score-cell">${match.homeGoals} : ${match.awayGoals}${pen}<span class="ch-score-order">${esc(homeName)}（主） - ${esc(awayName)}（客）</span></div>`;
}

export function createClubHistoryController(container, options = {}) {
  const hooks = {
    loadHistory: options.loadHistory ?? null,
    onFilterChange: options.onFilterChange ?? null,
    onOpenMatchDetail: options.onOpenMatchDetail ?? null,
    onPlayReplay: options.onPlayReplay ?? null,
    onOpenPlayerCareer: options.onOpenPlayerCareer ?? null,
  };

  const state = {
    status: options.initialStatus ?? "ready", // ready | loading | error
    errorMessage: options.errorMessage ?? "",
    data: options.data ?? null,
    tab: options.initialTab ?? "overview",
    filters: {
      seasonId: "all",
      competition: "official",
      venue: "all",
      opponentQuery: "",
      result: "all",
    },
    page: 1,
    pageSize: options.pageSize ?? 8,
    h2hQuery: "",
    selectedOpponentId: null,
    h2hMobileView: "list", // list | detail
    h2hScrollTop: 0,
    playerBoard: "scorers",
    modal: null, // { type: 'match' | 'replay' | 'career' | 'streak', payload }
  };

  function getMaps() {
    const data = state.data ?? { seasons: [], opponents: [], players: [], matches: [], club: { name: "俱乐部", shortName: "队" } };
    return {
      seasonMap: new Map((data.seasons ?? []).map((s) => [s.id, s])),
      opponentMap: new Map((data.opponents ?? []).map((o) => [o.id, o])),
      playerMap: new Map((data.players ?? []).map((p) => [p.id, p])),
    };
  }

  function crest(team, small = false) {
    const images = options.renderTeamBadges?.(team) ?? "";
    const size = small ? " sm" : "";
    if (images) return `<span class="ch-crest has-badges${size}">${images}</span>`;
    return `<span class="ch-crest${size}">${esc(team?.shortName ?? team?.short ?? "队")}</span>`;
  }

  function emitFilterChange() {
    hooks.onFilterChange?.({ tab: state.tab, filters: { ...state.filters }, page: state.page });
  }

  let requestVersion = 0;
  async function reload(clubId) {
    if (!hooks.loadHistory) return;
    const version = ++requestVersion;
    state.status = "loading";
    state.errorMessage = "";
    render();
    try {
      const result = await hooks.loadHistory({ clubId: clubId ?? state.data?.club?.id });
      if (version !== requestVersion) return;
      state.data = result;
      state.status = "ready";
    } catch (err) {
      if (version !== requestVersion) return;
      state.status = "error";
      state.errorMessage = err?.message || "读取队史数据失败，请检查网络或存档连接。";
    }
    render();
  }

  function setData(data, status = "ready", errorMessage = "") {
    state.data = data;
    state.status = status;
    state.errorMessage = errorMessage;
    state.page = 1;
    state.selectedOpponentId = null;
    state.h2hMobileView = "list";
    state.modal = null;
    render();
  }

  function navigate({ tab, seasonId, competition, opponentId } = {}) {
    if (tab && TABS.some((t) => t.id === tab)) state.tab = tab;
    if (seasonId !== undefined) state.filters.seasonId = seasonId;
    if (competition !== undefined) state.filters.competition = competition;
    if (opponentId !== undefined) {
      state.selectedOpponentId = opponentId;
      state.h2hMobileView = "detail";
    }
    state.page = 1;
    emitFilterChange();
    render();
  }

  function openMatchDetail(matchId) {
    const match = (state.data?.matches ?? []).find((m) => m.id === matchId);
    if (!match || !match.hasDetail) return;
    const context = { tab: state.tab, selectedOpponentId: state.selectedOpponentId, filters: { ...state.filters } };
    if (hooks.onOpenMatchDetail) {
      return hooks.onOpenMatchDetail({ matchId, match, context });
    }
    state.modal = { type: "match", payload: match };
    render();
  }

  function playReplay(matchId) {
    const match = (state.data?.matches ?? []).find((m) => m.id === matchId);
    if (!match || !match.hasReplay) return;
    const context = { tab: state.tab, selectedOpponentId: state.selectedOpponentId, filters: { ...state.filters } };
    if (hooks.onPlayReplay) {
      return hooks.onPlayReplay({ matchId, match, context });
    }
    state.modal = { type: "replay", payload: match };
    render();
  }

  function openPlayerCareer(playerId) {
    const player = (state.data?.players ?? []).find((p) => p.id === playerId);
    if (!player) return;
    if (hooks.onOpenPlayerCareer) {
      hooks.onOpenPlayerCareer({ playerId, player, filters: { ...state.filters } });
    }
    state.modal = { type: "career", payload: player };
    render();
  }

  function renderOverview(scopedMatches, summary, maps) {
    if (!state.data?.matches?.length) {
      return `<div class="ch-state-box"><b>尚未有队史比赛记录</b><p>完成俱乐部首场正式比赛后，这里会自动统计总战绩、历季排名、射手榜和交手记录。</p></div>`;
    }
    if (!scopedMatches.length) {
      return `<div class="ch-state-box"><b>当前筛选条件下暂无比赛</b><p>尝试切换其他赛季或赛事范围。</p><button type="button" class="ch-btn primary" data-ch-reset-global>重置为全部赛季 · 正式比赛</button></div>`;
    }

    const scopedSeasons = state.data.seasons.filter(s => state.filters.seasonId === "all" || s.id === state.filters.seasonId);
    const totalHonors = scopedSeasons.flatMap((s) => s.honors ?? []);
    const topScorers = computePlayerLeaderboards(scopedMatches, state.data.players, "scorers").slice(0, 3);
    const topRivals = computeHeadToHead(scopedMatches, state.data.opponents).slice(0, 3);

    const seasonsMarkup = [...scopedSeasons]
      .reverse()
      .map((s) => {
        const isChamp = (s.honors ?? []).some((h) => h.tier === "gold");
        const rankText = s.finalRank ? `第 ${s.finalRank} 名` : "待排定";
        return `<button type="button" class="ch-season-row ${isChamp ? "is-champion" : ""}" data-ch-jump-season="${esc(s.id)}">
          <div class="ch-season-left">
            <span class="ch-pill ${s.division === "A" ? "emerald" : "blue"}">${esc(s.shortName)} · ${esc(s.divisionName)}</span>
            <b>${esc(rankText)}</b>
            ${s.inProgress ? `<span class="ch-pill amber">进行中</span>` : ""}
            ${s.movement === "promoted" ? `<span class="ch-pill emerald">↑ ${esc(s.movementLabel)}</span>` : ""}
            ${(s.honors ?? []).map((h) => `<span class="ch-pill amber">🏆 ${esc(h.label)}</span>`).join("")}
          </div>
          <small style="color:var(--ch-muted)">${esc(s.cupStage)} ›</small>
        </button>`;
      })
      .join("");

    const honorsStrip = totalHonors.length
      ? totalHonors.map((h) => `<span class="ch-pill ${h.tier === "gold" ? "amber" : ""}">🏆 ${esc(h.label)}</span>`).join("")
      : `<span style="color:var(--ch-muted);font-size:12px">暂无冠军或奖牌荣誉</span>`;

    const scorersMarkup = topScorers.length
      ? topScorers
          .map(
            (r) => `<button type="button" class="ch-mini-row" data-ch-open-player="${esc(r.player.id)}">
              <div class="ch-mini-main">
                <span class="ch-rank-dot top-${r.rank}">${r.rank}</span>
                <div>
                  <b>${esc(r.player.name)}</b>
                  <span class="ch-pill ${r.player.status === "active" ? "emerald" : ""}" style="margin-left:6px">${r.player.status === "active" ? "在队" : "离队"}</span>
                </div>
              </div>
              <strong class="ch-num">${r.goals ?? "—"} 球 <small style="color:var(--ch-muted);font-weight:600">(${r.appearances}场)</small></strong>
            </button>`
          )
          .join("")
      : `<p style="margin:0;color:var(--ch-muted);font-size:12px">当前范围暂无球员进球明细</p>`;

    const rivalsMarkup = topRivals
      .map(
        (item) => `<button type="button" class="ch-mini-row" data-ch-jump-rival="${esc(item.opponent.id)}">
          <div class="ch-mini-main">
            ${crest(item.opponent,true)}
            <div><b>${esc(item.opponent.name)}</b></div>
          </div>
          <span class="ch-num" style="font-size:12px;color:var(--ch-muted)">
            <b style="color:var(--ch-ink)">${item.total.total}场</b> · ${item.total.wins}胜${item.total.draws}平${item.total.losses}负 · <b style="color:var(--ch-emerald)">${item.total.winRate}</b>
          </span>
        </button>`
      )
      .join("");

    return `
      <div class="ch-kpi-grid">
        <div class="ch-kpi">
          <small>总战绩（总场次 = 胜 + 平 + 负）</small>
          <div class="ch-kpi-val"><strong>${summary.total}场</strong></div>
          <div class="ch-kpi-sub ch-num">${summary.wins} 胜 · ${summary.draws} 平 · ${summary.losses} 负</div>
        </div>
        <div class="ch-kpi">
          <small>胜率（平局计入分母）</small>
          <div class="ch-kpi-val"><strong style="color:var(--ch-emerald)">${summary.winRate}</strong></div>
          <div class="ch-kpi-sub">已完赛 ${summary.total} 场</div>
        </div>
        <div class="ch-kpi">
          <small>进失球与净胜球</small>
          <div class="ch-kpi-val">
            <strong>${summary.goalsFor} : ${summary.goalsAgainst}</strong>
            <span class="ch-pill ${summary.goalDiff >= 0 ? "emerald" : ""}">${summary.goalDiff >= 0 ? `+${summary.goalDiff}` : summary.goalDiff}</span>
          </div>
          <div class="ch-kpi-sub">场均进 ${formatPerGame(summary.goalsFor, summary.total)} / 失 ${formatPerGame(summary.goalsAgainst, summary.total)}</div>
        </div>
        <div class="ch-kpi honor-kpi">
          <small>队史主要荣誉</small>
          <div class="ch-kpi-val"><strong style="color:var(--ch-amber)">${totalHonors.length}项</strong></div>
          <div class="ch-kpi-sub">点击下方赛季查看完整战绩</div>
        </div>
      </div>

      <div class="ch-overview-grid">
        <div class="ch-stack">
          <section class="ch-card">
            <div class="ch-card-head"><h2>历季级别与排名</h2><small>点击赛季直达该季比赛</small></div>
            <div class="ch-season-list">${seasonsMarkup}</div>
          </section>
          <section class="ch-card">
            <div class="ch-card-head"><h2>主要荣誉</h2><small>全部赛季累计</small></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">${honorsStrip}</div>
          </section>
        </div>
        <div class="ch-stack">
          <section class="ch-card">
            <div class="ch-card-head"><h2>队史射手前三</h2><small>点击查看本队生涯</small></div>
            <div class="ch-mini-list">${scorersMarkup}</div>
          </section>
          <section class="ch-card">
            <div class="ch-card-head"><h2>交手最多对手</h2><small>点击进入交锋详情</small></div>
            <div class="ch-mini-list">${rivalsMarkup}</div>
          </section>
        </div>
      </div>`;
  }

  function renderMatches(maps) {
    const filtered = filterMatches(state.data?.matches ?? [], state.filters, maps.opponentMap);
    const summary = computeSummary(filtered);
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const pageItems = filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    const clubName = state.data?.club?.name ?? "本队";

    const rowsMarkup = pageItems.length
      ? pageItems
          .map((m) => {
            const season = maps.seasonMap.get(m.seasonId);
            const opp = maps.opponentMap.get(m.opponentId);
            const res = getOwnResult(m);
            const legacyTag = !m.hasDetail && !m.hasPlayerDetails ? `<span class="ch-pill">仅比分存档</span>` : "";
            return `<tr>
              <td class="ch-num"><b>${esc(season?.shortName ?? m.seasonId)}</b><span class="ch-score-order">${esc(m.date)}</span></td>
              <td><b>${esc(m.competitionName)}</b><span class="ch-score-order">${esc(m.round)}</span></td>
              <td><span class="ch-pill ${m.venue === "home" ? "emerald" : ""}">${m.venue === "home" ? "主" : "客"}</span></td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  ${crest(opp,true)}
                  <div><b>${esc(opp?.name ?? m.opponentId)}</b>${!m.hasPlayerDetails ? `<span class="ch-score-order">无球员明细</span>` : ""}</div>
                </div>
              </td>
              <td>${scoreOrderMarkup(m, clubName, opp?.name ?? m.opponentId)}</td>
              <td><span class="ch-res-badge res-${res}">${RESULT_LABEL[res]}</span></td>
              <td>
                <div class="ch-actions-cell">
                  <button type="button" class="ch-btn" data-ch-open-detail="${esc(m.id)}" ${m.hasDetail ? "" : "disabled"} title="${m.hasDetail ? "查看比赛详情" : "该老比赛仅存比分，无详细战报"}">${m.hasDetail ? "详情" : "无详情"}</button>
                  <button type="button" class="ch-btn" data-ch-play-replay="${esc(m.id)}" ${m.hasReplay ? "" : "disabled"} title="${m.hasReplay ? "播放比赛回放" : "该场暂无回放"}">${m.hasReplay ? "▶ 回放" : "无回放"}</button>
                  ${legacyTag}
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : "";

    return `<section class="ch-card">
      <div class="ch-card-head">
        <div><h2>全部比赛</h2><small>回放保留至比赛当天结束（北京时间）</small></div>
        <small class="ch-num">当前筛选：${summary.total} 场（${summary.wins}胜 ${summary.draws}平 ${summary.losses}负 · 胜率 ${summary.winRate}）</small>
      </div>
      <div class="ch-filter-bar">
        <input class="ch-input" type="search" value="${esc(state.filters.opponentQuery)}" placeholder="搜索对手名称 / 曾用名 / 轮次..." data-ch-filter="opponentQuery" />
        <select class="ch-select" data-ch-filter="venue">
          <option value="all" ${state.filters.venue === "all" ? "selected" : ""}>主客不限</option>
          <option value="home" ${state.filters.venue === "home" ? "selected" : ""}>仅主场</option>
          <option value="away" ${state.filters.venue === "away" ? "selected" : ""}>仅客场</option>
        </select>
        <select class="ch-select" data-ch-filter="result">
          <option value="all" ${state.filters.result === "all" ? "selected" : ""}>赛果不限</option>
          <option value="W" ${state.filters.result === "W" ? "selected" : ""}>仅胜场</option>
          <option value="D" ${state.filters.result === "D" ? "selected" : ""}>仅平局</option>
          <option value="L" ${state.filters.result === "L" ? "selected" : ""}>仅负场</option>
        </select>
        <button type="button" class="ch-btn" data-ch-reset-matches>重置筛选</button>
      </div>
      ${
        pageItems.length
          ? `<div class="ch-table-wrap"><table class="ch-table">
              <thead><tr><th>赛季 / 日期</th><th>赛事 / 轮次</th><th>主客</th><th>对手</th><th>比分（主 - 客）</th><th>赛果</th><th>操作</th></tr></thead>
              <tbody>${rowsMarkup}</tbody>
            </table></div>
            <div class="ch-pager">
              <span>第 ${state.page} / ${totalPages} 页 · 共 ${filtered.length} 场</span>
              <div style="display:flex;gap:6px">
                <button type="button" class="ch-btn" data-ch-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
                <button type="button" class="ch-btn" data-ch-page="${state.page + 1}" ${state.page >= totalPages ? "disabled" : ""}>下一页</button>
              </div>
            </div>`
          : `<div class="ch-state-box"><b>没有符合条件的比赛</b><p>请放宽主客、赛果或对手搜索条件。</p><button type="button" class="ch-btn primary" data-ch-reset-matches>清空筛选条件</button></div>`
      }
    </section>`;
  }

  function renderH2H(scopedMatches, maps) {
    const allRivals = computeHeadToHead(scopedMatches, state.data?.opponents ?? []);
    const q = state.h2hQuery.trim().toLowerCase();
    const visibleRivals = q
      ? allRivals.filter((r) => [r.opponent.name, ...(r.opponent.previousNames ?? [])].some((n) => n.toLowerCase().includes(q)))
      : allRivals;

    if (!allRivals.length) {
      return `<div class="ch-state-box"><b>暂无交手记录</b><p>当前统计范围内没有已完赛的交手对手。</p></div>`;
    }

    if (!visibleRivals.some((r) => r.opponent.id === state.selectedOpponentId)) {
      state.selectedOpponentId = visibleRivals[0]?.opponent.id ?? null;
    }
    const selected = visibleRivals.find((r) => r.opponent.id === state.selectedOpponentId) ?? null;
    const clubName = state.data?.club?.name ?? "本队";

    const listMarkup = visibleRivals.length
      ? visibleRivals
          .map((item) => {
            const latest = item.latest;
            const latestScore = latest ? `${latest.homeGoals}:${latest.awayGoals}` : "—";
            return `<button type="button" class="ch-rival-item ${item.opponent.id === selected?.opponent.id ? "active" : ""}" data-ch-select-rival="${esc(item.opponent.id)}">
              <div class="ch-rival-top">
                <div class="ch-mini-main">
                  ${crest(item.opponent,true)}
                  <div>
                    <b>${esc(item.opponent.name)}</b>
                    ${item.opponent.previousNames?.length ? `<span class="ch-score-order">曾用名：${esc(item.opponent.previousNames.join("、"))}</span>` : ""}
                  </div>
                </div>
                <strong class="ch-num" style="color:var(--ch-emerald);font-size:13px">${item.total.winRate}</strong>
              </div>
              <div class="ch-rival-meta">
                <span>${item.total.total} 场 · ${item.total.wins}胜 ${item.total.draws}平 ${item.total.losses}负</span>
                <span>最近 ${latestScore}</span>
              </div>
            </button>`;
          })
          .join("")
      : `<div class="ch-state-box" style="padding:24px 12px"><b>未找到匹配对手</b><p>支持按现用名或历史曾用名搜索。</p></div>`;

    const detailMarkup = selected
      ? `<section class="ch-card">
          <button type="button" class="ch-btn ch-mobile-back" data-ch-h2h-back>‹ 返回对手列表</button>
          <div class="ch-card-head">
            <div class="ch-mini-main">
              ${crest(selected.opponent)}
              <div>
                <h2 style="font-size:18px">对阵 ${esc(selected.opponent.name)}</h2>
                <small>${selected.opponent.previousNames?.length ? `已合并改名前记录（曾用名：${esc(selected.opponent.previousNames.join("、"))}）` : "按球队身份关联全部历史交锋"}</small>
              </div>
            </div>
            <span class="ch-pill emerald ch-num">共 ${selected.total.total} 场 · 胜率 ${selected.total.winRate}</span>
          </div>
          <div class="ch-h2h-splits">
            <div class="ch-split-box">
              <small>总战绩与进失球</small>
              <strong>${selected.total.wins}胜 ${selected.total.draws}平 ${selected.total.losses}负</strong>
              <span class="ch-score-order">进 ${selected.total.goalsFor} 失 ${selected.total.goalsAgainst}（净胜 ${selected.total.goalDiff >= 0 ? `+${selected.total.goalDiff}` : selected.total.goalDiff}）</span>
            </div>
            <div class="ch-split-box">
              <small>主客场拆分</small>
              <strong>主 ${selected.home.wins}胜${selected.home.draws}平${selected.home.losses}负 · 客 ${selected.away.wins}胜${selected.away.draws}平${selected.away.losses}负</strong>
              <span class="ch-score-order">主场 ${selected.home.total}场 (${selected.home.winRate}) · 客场 ${selected.away.total}场 (${selected.away.winRate})</span>
            </div>
            <div class="ch-split-box">
              <small>最近五次交锋（新→旧）</small>
              <div class="ch-form-strip">${selected.last5.map((f) => `<span class="ch-res-badge res-${f.result}">${RESULT_LABEL[f.result]}</span>`).join("")}</div>
            </div>
          </div>
          <div class="ch-table-wrap"><table class="ch-table">
            <thead><tr><th>赛季 / 日期</th><th>赛事 / 轮次</th><th>主客</th><th>比分（主 - 客）</th><th>赛果</th><th>操作</th></tr></thead>
            <tbody>${selected.matches
              .map((m) => {
                const s = maps.seasonMap.get(m.seasonId);
                const res = getOwnResult(m);
                return `<tr>
                  <td class="ch-num"><b>${esc(s?.shortName ?? m.seasonId)}</b><span class="ch-score-order">${esc(m.date)}</span></td>
                  <td><b>${esc(m.competitionName)}</b><span class="ch-score-order">${esc(m.round)}</span></td>
                  <td><span class="ch-pill ${m.venue === "home" ? "emerald" : ""}">${m.venue === "home" ? "主" : "客"}</span></td>
                  <td>${scoreOrderMarkup(m, clubName, selected.opponent.name)}</td>
                  <td><span class="ch-res-badge res-${res}">${RESULT_LABEL[res]}</span></td>
                  <td><div class="ch-actions-cell">
                    <button type="button" class="ch-btn" data-ch-open-detail="${esc(m.id)}" ${m.hasDetail ? "" : "disabled"}>${m.hasDetail ? "详情" : "无详情"}</button>
                    <button type="button" class="ch-btn" data-ch-play-replay="${esc(m.id)}" ${m.hasReplay ? "" : "disabled"}>${m.hasReplay ? "▶ 回放" : "无回放"}</button>
                  </div></td>
                </tr>`;
              })
              .join("")}</tbody>
          </table></div>
        </section>`
      : `<div class="ch-state-box"><b>请选择一位对手</b><p>从左侧选择任意交手过的球队查看详细战绩。</p></div>`;

    return `<div class="ch-h2h-layout" data-mobile-view="${state.h2hMobileView}">
      <aside class="ch-card ch-h2h-master">
        <div class="ch-card-head"><h2>交手对手（${visibleRivals.length}）</h2><small>按场次降序</small></div>
        <div style="margin-bottom:10px"><input class="ch-input" style="width:100%" type="search" value="${esc(state.h2hQuery)}" placeholder="搜索对手名或曾用名..." data-ch-h2h-search /></div>
        <div class="ch-h2h-list" data-ch-h2h-scroll>${listMarkup}</div>
      </aside>
      <div class="ch-h2h-detail">${detailMarkup}</div>
    </div>`;
  }

  function renderPlayers(scopedMatches, summary) {
    const config = LEADERBOARD_CONFIGS.find((c) => c.key === state.playerBoard) ?? LEADERBOARD_CONFIGS[0];
    const rows = computePlayerLeaderboards(scopedMatches, state.data?.players ?? [], state.playerBoard);

    const subtabs = LEADERBOARD_CONFIGS.map(
      (c) => `<button type="button" class="${c.key === state.playerBoard ? "active" : ""}" data-ch-board="${c.key}">${c.label}</button>`
    ).join("");

    const formatCells = (r) => {
      switch (state.playerBoard) {
        case "scorers":
          return [r.goals, r.appearances, formatPerGame(r.goals, r.appearances)];
        case "assists":
          return [r.assists, r.appearances, formatPerGame(r.assists, r.appearances)];
        case "contributions":
          return [r.contributions, r.goals, r.assists];
        case "appearances":
          return [r.appearances, `${r.seasonCount} 赛季`, r.player.status === "active" ? "在队" : "离队"];
        case "saves":
          return [r.saves, r.appearances, formatPerGame(r.saves, r.appearances)];
        case "rating":
          return [r.avgRating.toFixed(2), `${r.ratedApps} 场`, `≥ ${RATING_MIN_APPEARANCES} 场`];
        default:
          return [r.goals, r.appearances, "—"];
      }
    };

    const bodyMarkup = rows.length
      ? `<div class="ch-table-wrap"><table class="ch-table">
          <thead><tr><th>名次</th><th>球员（点击展开本队生涯）</th><th>位置</th><th>状态</th><th>${config.primaryLabel}</th><th>${config.auxLabels[0]}</th><th>${config.auxLabels[1]}</th></tr></thead>
          <tbody>${rows
            .map((r) => {
              const [c1, c2, c3] = formatCells(r);
              const stintTag = r.player.stints?.length > 1 ? `<span class="ch-pill amber" style="margin-left:6px">回归合并</span>` : "";
              return `<tr class="ch-player-row" data-ch-open-player="${esc(r.player.id)}" tabindex="0">
                <td><span class="ch-rank-dot ${r.rank <= 3 ? `top-${r.rank}` : ""}">${r.rank}</span></td>
                <td><b>${esc(r.player.name)}</b>${stintTag}</td>
                <td>${esc(r.player.roleLabel)} (${esc(r.player.role)})</td>
                <td><span class="ch-pill ${r.player.status === "active" ? "emerald" : ""}">${r.player.status === "active" ? "在队" : "离队"}</span></td>
                <td class="ch-num" style="font-size:15px;font-weight:800;color:var(--ch-emerald)">${esc(c1 ?? "—")}</td>
                <td class="ch-num">${esc(c2 ?? "—")}</td>
                <td class="ch-num" style="color:var(--ch-muted)">${esc(c3 ?? "—")}</td>
              </tr>`;
            })
            .join("")}</tbody>
        </table></div>`
      : `<div class="ch-state-box"><b>暂无入榜球员</b><p>${state.playerBoard === "rating" ? `场均评分榜要求当前筛选范围内至少有 ${RATING_MIN_APPEARANCES} 场有效评分记录。` : "当前筛选范围内没有具备球员明细的比赛记录。"}</p></div>`;

    return `<section class="ch-card">
      <div class="ch-card-head">
        <h2>球员榜单 · ${config.label}</h2>
        <small>统计基于 ${summary.withPlayerDetails} 场含球员明细的比赛${summary.missingPlayerDetails ? `（${summary.missingPlayerDetails} 场旧档缺明细）` : ""}</small>
      </div>
      <div class="ch-subtabs">${subtabs}</div>
      ${bodyMarkup}
    </section>`;
  }

  function renderHonors(scopedMatches, maps) {
    const hr = computeHonorsAndRecords(state.data?.seasons ?? [], scopedMatches, state.filters);
    const scopeLabel = `${state.filters.seasonId === "all" ? "全部赛季" : maps.seasonMap.get(state.filters.seasonId)?.name ?? state.filters.seasonId} · ${competitionScopeLabel(state.filters.competition)}`;
    const clubName = state.data?.club?.name ?? "本队";

    const recordMatchesLinks = (matches) =>
      matches
        .map((m) => {
          const opp = maps.opponentMap.get(m.opponentId);
          return `<button type="button" class="ch-btn" data-ch-open-detail="${esc(m.id)}" ${m.hasDetail ? "" : "disabled"}>${esc(m.date)} vs ${esc(opp?.name ?? m.opponentId)} (${m.homeGoals}:${m.awayGoals})</button>`;
        })
        .join("");

    const streakCard = (title, streak, typeKey) => {
      if (!streak) {
        return `<div class="ch-record-card"><div class="ch-record-top"><small>${title}</small></div><div class="ch-record-val">—</div><small style="color:var(--ch-muted)">当前范围暂无记录</small></div>`;
      }
      return `<div class="ch-record-card">
        <div class="ch-record-top">
          <small>${title}</small>
          ${streak.verifiableOnly ? `<span class="ch-pill amber" title="因旧赛季存在归档缺场，标注为可核实记录">可核实记录</span>` : `<span class="ch-pill emerald">完整可证</span>`}
        </div>
        <div class="ch-record-val">${streak.count} 场</div>
        <div style="font-size:12px;color:var(--ch-muted)" class="ch-num">${esc(streak.startDate)} 至 ${esc(streak.endDate)}</div>
        <div><button type="button" class="ch-btn primary" data-ch-open-streak="${typeKey}">查看整段 ${streak.count} 场赛程</button></div>
      </div>`;
    };

    const timelineRows = hr.timelineSeasons.length
      ? hr.timelineSeasons
          .map(
            (s) => `<tr>
              <td><b>${esc(s.name)}</b></td>
              <td><span class="ch-pill ${s.division === "A" ? "emerald" : "blue"}">${esc(s.divisionName)}</span></td>
              <td class="ch-num"><b>${s.finalRank ? `第 ${s.finalRank} 名` : "—"}</b> ${s.inProgress ? `<span class="ch-pill amber">当前排名</span>` : ""}</td>
              <td>${s.movement === "promoted" ? `<span class="ch-pill emerald">↑ ${esc(s.movementLabel)}</span>` : esc(s.movementLabel)}</td>
              <td>${esc(s.cupStage)}</td>
              <td>${(s.honors ?? []).length ? s.honors.map((h) => `<span class="ch-pill amber">🏆 ${esc(h.label)}</span>`).join(" ") : "—"}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="6" style="text-align:center;color:var(--ch-muted)">暂无赛季记录</td></tr>`;

    return `
      <section class="ch-card">
        <div class="ch-card-head">
          <h2>队史纪录</h2>
          <small>纪录统计范围：${esc(scopeLabel)}</small>
        </div>
        <div class="ch-records-grid">
          <div class="ch-record-card">
            <div class="ch-record-top"><small>最大比分胜利（按净胜球）</small>${hr.largestWins && hr.largestWins.matches.length > 1 ? `<span class="ch-pill amber">${hr.largestWins.matches.length} 场并列</span>` : ""}</div>
            <div class="ch-record-val" style="color:var(--ch-emerald)">${hr.largestWins ? `+${hr.largestWins.gd} 球` : "—"}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${hr.largestWins ? recordMatchesLinks(hr.largestWins.matches) : `<small style="color:var(--ch-muted)">暂无胜场</small>`}</div>
          </div>
          <div class="ch-record-card">
            <div class="ch-record-top"><small>最大比分失利（按净负球）</small>${hr.largestLosses && hr.largestLosses.matches.length > 1 ? `<span class="ch-pill amber">${hr.largestLosses.matches.length} 场并列</span>` : ""}</div>
            <div class="ch-record-val" style="color:var(--ch-red)">${hr.largestLosses ? `${hr.largestLosses.gd} 球` : "—"}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${hr.largestLosses ? recordMatchesLinks(hr.largestLosses.matches) : `<small style="color:var(--ch-muted)">暂无负场</small>`}</div>
          </div>
          ${streakCard("最长连胜纪录", hr.longestWinStreak, "win")}
          ${streakCard("最长不败纪录", hr.longestUnbeatenStreak, "unbeaten")}
        </div>
      </section>
      <section class="ch-card">
        <div class="ch-card-head"><h2>历季荣誉时间线</h2><small>按赛季筛选展示</small></div>
        <div class="ch-table-wrap"><table class="ch-table">
          <thead><tr><th>赛季</th><th>级别</th><th>最终 / 当前排名</th><th>升降级</th><th>杯赛阶段</th><th>主要荣誉</th></tr></thead>
          <tbody>${timelineRows}</tbody>
        </table></div>
      </section>`;
  }

  function renderModal(scopedMatches, maps) {
    if (!state.modal) return "";
    const clubName = state.data?.club?.name ?? "本队";
    if (state.modal.type === "match" || state.modal.type === "replay") {
      const m = state.modal.payload;
      const opp = maps.opponentMap.get(m.opponentId);
      const season = maps.seasonMap.get(m.seasonId);
      const res = getOwnResult(m);
      const isReplay = state.modal.type === "replay";
      const statsRows = (m.playerStats ?? []).length
        ? `<div class="ch-table-wrap"><table class="ch-table">
            <thead><tr><th>球员</th><th>方式</th><th>进球</th><th>助攻</th><th>扑救</th><th>评分</th></tr></thead>
            <tbody>${m.playerStats
              .map((ps) => {
                const p = maps.playerMap.get(ps.playerId);
                return `<tr><td><b>${esc(p?.name ?? ps.playerId)}</b></td><td>${ps.started ? "首发" : "替补"}</td><td class="ch-num">${ps.goals ?? "—"}</td><td class="ch-num">${ps.assists ?? "—"}</td><td class="ch-num">${ps.saves ?? "—"}</td><td class="ch-num">${ps.rating ?? "—"}</td></tr>`;
              })
              .join("")}</tbody>
          </table></div>`
        : `<p style="margin:0;color:var(--ch-muted);font-size:13px">该场老比赛未记录单场球员明细（统计覆盖已明确标出）。</p>`;

      return `<div class="ch-modal-overlay" data-ch-modal-backdrop>
        <div class="ch-modal" role="dialog" aria-modal="true">
          <header>
            <div>
              <small>${isReplay ? "REPLAY HOOK PREVIEW" : "MATCH DETAIL HOOK PREVIEW"} · ID: ${esc(m.id)}</small>
              <h3>${esc(season?.name ?? m.seasonId)} · ${esc(m.competitionName)} ${esc(m.round)}</h3>
            </div>
            <button type="button" class="ch-close-btn" data-ch-close-modal aria-label="关闭">×</button>
          </header>
          <div class="ch-modal-body">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:12px 14px;border-radius:10px;background:rgba(148,163,184,0.08)">
              <div>${scoreOrderMarkup(m, clubName, opp?.name ?? m.opponentId)}</div>
              <span class="ch-res-badge res-${res}">本队：${RESULT_LABEL[res]}</span>
            </div>
            ${m.note ? `<p style="margin:0;font-size:13px;color:#f59e0b">${esc(m.note)}</p>` : ""}
            ${isReplay ? `<div class="ch-state-box" style="padding:20px"><b>已触发「播放已有回放」接口</b><p>正式接入项目后，此处将直接调用游戏原生关键事件回放器（传入 matchId: <code>${esc(m.id)}</code>）。</p></div>` : statsRows}
          </div>
        </div>
      </div>`;
    }

    if (state.modal.type === "career") {
      const player = state.modal.payload;
      const career = computePlayerCareer(scopedMatches, state.data?.seasons ?? [], player);
      const stintsHtml = (player.stints ?? [])
        .map((st, idx) => `<span class="ch-pill ${idx > 0 ? "amber" : "emerald"}">${esc(st.from)}–${esc(st.to)}：${esc(st.note)}</span>`)
        .join("");
      return `<div class="ch-modal-overlay" data-ch-modal-backdrop>
        <div class="ch-modal" role="dialog" aria-modal="true">
          <header>
            <div>
              <small>PLAYER CLUB CAREER · ID: ${esc(player.id)}</small>
              <h3>${esc(player.name)} · 本队生涯贡献</h3>
            </div>
            <button type="button" class="ch-close-btn" data-ch-close-modal aria-label="关闭">×</button>
          </header>
          <div class="ch-modal-body">
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              <span class="ch-pill ${player.status === "active" ? "emerald" : ""}">${player.status === "active" ? "在队" : "离队"}</span>
              <span class="ch-pill">${esc(player.roleLabel)} (${esc(player.role)})</span>
              ${stintsHtml}
            </div>
            <div class="ch-table-wrap"><table class="ch-table">
              <thead><tr><th>赛季</th><th>级别</th><th>出场(首发/替补)</th><th>进球</th><th>助攻</th><th>参与</th><th>扑救</th><th>场均评分</th></tr></thead>
              <tbody>
                ${career.seasonRows
                  .map(
                    (r) => `<tr>
                      <td><b>${esc(r.season.name)}</b></td>
                      <td>${esc(r.season.divisionName)}</td>
                      <td class="ch-num">${r.appearances} (${r.starts}/${r.subs})</td>
                      <td class="ch-num"><b>${r.goals ?? "—"}</b></td>
                      <td class="ch-num">${r.assists ?? "—"}</td>
                      <td class="ch-num">${r.contributions ?? "—"}</td>
                      <td class="ch-num">${r.saves ?? "—"}</td>
                      <td class="ch-num">${r.avgRating}</td>
                    </tr>`
                  )
                  .join("")}
                <tr style="background:rgba(16,185,129,0.08);font-weight:800">
                  <td colspan="2">当前筛选范围合计（与榜单一致）</td>
                  <td class="ch-num">${career.total.appearances} (${career.total.starts}/${career.total.subs})</td>
                  <td class="ch-num" style="color:var(--ch-emerald)">${career.total.goals ?? "—"}</td>
                  <td class="ch-num">${career.total.assists ?? "—"}</td>
                  <td class="ch-num">${career.total.contributions ?? "—"}</td>
                  <td class="ch-num">${career.total.saves ?? "—"}</td>
                  <td class="ch-num">${career.total.avgRating}</td>
                </tr>
              </tbody>
            </table></div>
          </div>
        </div>
      </div>`;
    }

    if (state.modal.type === "streak") {
      const { title, streak } = state.modal.payload;
      return `<div class="ch-modal-overlay" data-ch-modal-backdrop>
        <div class="ch-modal" role="dialog" aria-modal="true">
          <header>
            <div>
              <small>CLUB STREAK SEQUENCE</small>
              <h3>${esc(title)} · ${streak.count} 场（${esc(streak.startDate)} 至 ${esc(streak.endDate)}）</h3>
            </div>
            <button type="button" class="ch-close-btn" data-ch-close-modal aria-label="关闭">×</button>
          </header>
          <div class="ch-modal-body">
            <div class="ch-table-wrap"><table class="ch-table">
              <thead><tr><th>日期</th><th>赛事</th><th>对手</th><th>比分</th><th>赛果</th><th>操作</th></tr></thead>
              <tbody>${streak.matches
                .map((m) => {
                  const opp = maps.opponentMap.get(m.opponentId);
                  const res = getOwnResult(m);
                  return `<tr>
                    <td class="ch-num">${esc(m.date)}</td>
                    <td>${esc(m.competitionName)} ${esc(m.round)}</td>
                    <td><b>${esc(opp?.name ?? m.opponentId)}</b></td>
                    <td>${scoreOrderMarkup(m, clubName, opp?.name ?? m.opponentId)}</td>
                    <td><span class="ch-res-badge res-${res}">${RESULT_LABEL[res]}</span></td>
                    <td><button type="button" class="ch-btn" data-ch-open-detail="${esc(m.id)}" ${m.hasDetail ? "" : "disabled"}>${m.hasDetail ? "看详情" : "仅比分"}</button></td>
                  </tr>`;
                })
                .join("")}</tbody>
            </table></div>
          </div>
        </div>
      </div>`;
    }

    return "";
  }

  function render() {
    const maps = getMaps();
    const club = state.data?.club ?? { name: "俱乐部", shortName: "队", crestColor: "#10b981" };

    // 加载中与读取失败态
    if (state.status === "loading") {
      container.innerHTML = `<section class="yffm-ch">
        <div class="ch-header"><div class="ch-club-id"><div class="ch-crest">…</div><div class="ch-title-block"><h1>正在读取俱乐部队史…</h1><p class="ch-coverage">正在整理赛季归档与球员贡献</p></div></div></div>
        <div class="ch-skeleton-grid"><div class="ch-skeleton"></div><div class="ch-skeleton"></div><div class="ch-skeleton"></div><div class="ch-skeleton"></div></div>
        <div class="ch-skeleton" style="height:260px"></div>
      </section>`;
      return;
    }

    if (state.status === "error") {
      container.innerHTML = `<section class="yffm-ch">
        <div class="ch-state-box">
          <b>读取俱乐部数据失败</b>
          <p>${esc(state.errorMessage || "暂时无法读取队史档案，请稍后重试。")}</p>
          <button type="button" class="ch-btn primary" data-ch-retry>重新加载</button>
        </div>
      </section>`;
      bindEvents();
      return;
    }

    // 全局筛选（不含全部比赛页的局部主客/对手/赛果筛选）
    const globalScoped = filterMatches(
      state.data?.matches ?? [],
      { seasonId: state.filters.seasonId, competition: state.filters.competition },
      maps.opponentMap
    );
    const summary = computeSummary(globalScoped);
    const seasonName = state.filters.seasonId === "all" ? "全部赛季" : maps.seasonMap.get(state.filters.seasonId)?.name ?? state.filters.seasonId;
    const scopeText = `${seasonName} · ${competitionScopeLabel(state.filters.competition)}`;
    const coverageText =
      summary.total > 0
        ? `${summary.total} 场${competitionScopeLabel(state.filters.competition)}，${summary.withPlayerDetails} 场有球员明细`
        : `当前范围暂无已完赛记录`;

    const tabContent =
      state.tab === "overview"
        ? renderOverview(globalScoped, summary, maps)
        : state.tab === "matches"
        ? renderMatches(maps)
        : state.tab === "h2h"
        ? renderH2H(globalScoped, maps)
        : state.tab === "players"
        ? renderPlayers(globalScoped, summary)
        : renderHonors(globalScoped, maps);

    container.innerHTML = `<section class="yffm-ch">
      <header class="ch-header">
        <div class="ch-club-id">
          ${crest(club)}
          <div class="ch-title-block">
            <div class="ch-title-row">
              <h1>${esc(club.name)} · 俱乐部数据</h1>
              <span class="ch-scope-pill">${esc(scopeText)}</span>
            </div>
            <p class="ch-coverage">
              <span>统计覆盖：${esc(coverageText)}</span>
              ${summary.missingPlayerDetails > 0 ? `<span class="ch-coverage-warn">含 ${summary.missingPlayerDetails} 场早期档案缺球员明细</span>` : ""}
            </p>
          </div>
        </div>
        <div class="ch-global-filters">
          <select class="ch-select" aria-label="筛选赛季" data-ch-global="seasonId">
            <option value="all" ${state.filters.seasonId === "all" ? "selected" : ""}>全部赛季</option>
            ${(state.data?.seasons ?? [])
              .map((s) => `<option value="${esc(s.id)}" ${state.filters.seasonId === s.id ? "selected" : ""}>${esc(s.name)} (${esc(s.divisionName)})</option>`)
              .join("")}
          </select>
          <select class="ch-select" aria-label="筛选赛事" data-ch-global="competition">
            <option value="official" ${state.filters.competition === "official" ? "selected" : ""}>正式比赛</option>
            <option value="league_A" ${state.filters.competition === "league_A" ? "selected" : ""}>甲级联赛 (A)</option>
            <option value="league_B" ${state.filters.competition === "league_B" ? "selected" : ""}>乙级联赛 (B)</option>
            <option value="cup" ${state.filters.competition === "cup" ? "selected" : ""}>冠军杯</option>
            ${[["season-final","赛季总决赛"],["worldcup","黄狗世界杯"],["legacyLeague","旧制联赛"]].filter(([id]) => state.data.matches.some(m => id === "legacyLeague" ? m.competition === "league" && !m.division : m.competition === id)).map(([id,label]) => `<option value="${id}" ${state.filters.competition === id ? "selected" : ""}>${label}</option>`).join("")}
            <option value="friendly" ${state.filters.competition === "friendly" ? "selected" : ""}>友谊赛</option>
            <option value="all" ${state.filters.competition === "all" ? "selected" : ""}>全部赛事（含友谊赛）</option>
          </select>
        </div>
      </header>
      <nav class="ch-tabs" aria-label="俱乐部数据页签">
        ${TABS.map((t) => `<button type="button" class="${t.id === state.tab ? "active" : ""}" data-ch-tab="${t.id}" aria-current="${t.id === state.tab ? "page" : "false"}">${t.label}</button>`).join("")}
      </nav>
      <div class="ch-panel-host">${tabContent}</div>
      ${renderModal(globalScoped, maps)}
    </section>`;

    // 恢复交手记录左侧列表滚动位置
    const h2hScroll = container.querySelector("[data-ch-h2h-scroll]");
    if (h2hScroll && state.h2hScrollTop > 0) {
      h2hScroll.scrollTop = state.h2hScrollTop;
    }

    bindEvents(globalScoped);
  }

  function bindEvents(globalScoped = []) {
    container.querySelector("[data-ch-retry]")?.addEventListener("click", () => reload());

    container.querySelectorAll("[data-ch-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.chTab;
        emitFilterChange();
        render();
      });
    });

    container.querySelectorAll("[data-ch-global]").forEach((sel) => {
      sel.addEventListener("change", () => {
        state.filters[sel.dataset.chGlobal] = sel.value;
        state.page = 1;
        emitFilterChange();
        render();
      });
    });

    container.querySelector("[data-ch-reset-global]")?.addEventListener("click", () => {
      state.filters.seasonId = "all";
      state.filters.competition = "official";
      state.page = 1;
      emitFilterChange();
      render();
    });

    container.querySelectorAll("[data-ch-jump-season]").forEach((btn) => {
      btn.addEventListener("click", () => navigate({ tab: "matches", seasonId: btn.dataset.chJumpSeason }));
    });

    container.querySelectorAll("[data-ch-jump-rival]").forEach((btn) => {
      btn.addEventListener("click", () => navigate({ tab: "h2h", opponentId: btn.dataset.chJumpRival }));
    });

    container.querySelectorAll("[data-ch-open-player]").forEach((el) => {
      el.addEventListener("click", () => openPlayerCareer(el.dataset.chOpenPlayer));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPlayerCareer(el.dataset.chOpenPlayer);
        }
      });
    });

    container.querySelectorAll("[data-ch-filter]").forEach((el) => {
      const ev = el.tagName === "INPUT" ? "input" : "change";
      el.addEventListener(ev, () => {
        state.filters[el.dataset.chFilter] = el.value;
        state.page = 1;
        emitFilterChange();
        render();
        if (el.tagName === "INPUT") {
          const next = container.querySelector(`[data-ch-filter="${el.dataset.chFilter}"]`);
          next?.focus();
          next?.setSelectionRange(next.value.length, next.value.length);
        }
      });
    });

    container.querySelector("[data-ch-reset-matches]")?.addEventListener("click", () => {
      state.filters.venue = "all";
      state.filters.result = "all";
      state.filters.opponentQuery = "";
      state.page = 1;
      emitFilterChange();
      render();
    });

    container.querySelectorAll("[data-ch-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.page = Number(btn.dataset.chPage) || 1;
        emitFilterChange();
        render();
      });
    });

    const h2hScroll = container.querySelector("[data-ch-h2h-scroll]");
    h2hScroll?.addEventListener("scroll", () => {
      state.h2hScrollTop = h2hScroll.scrollTop;
    });

    const h2hInput = container.querySelector("[data-ch-h2h-search]");
    h2hInput?.addEventListener("input", () => {
      state.h2hQuery = h2hInput.value;
      render();
      const next = container.querySelector("[data-ch-h2h-search]");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });

    container.querySelectorAll("[data-ch-select-rival]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedOpponentId = btn.dataset.chSelectRival;
        state.h2hMobileView = "detail";
        render();
      });
    });

    container.querySelector("[data-ch-h2h-back]")?.addEventListener("click", () => {
      state.h2hMobileView = "list";
      render();
    });

    container.querySelectorAll("[data-ch-board]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.playerBoard = btn.dataset.chBoard;
        render();
      });
    });

    container.querySelectorAll("[data-ch-open-detail]").forEach((btn) => {
      btn.addEventListener("click", () => openMatchDetail(btn.dataset.chOpenDetail));
    });

    container.querySelectorAll("[data-ch-play-replay]").forEach((btn) => {
      btn.addEventListener("click", () => playReplay(btn.dataset.chPlayReplay));
    });

    container.querySelectorAll("[data-ch-open-streak]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hr = computeHonorsAndRecords(state.data?.seasons ?? [], globalScoped, state.filters);
        const isWin = btn.dataset.chOpenStreak === "win";
        const streak = isWin ? hr.longestWinStreak : hr.longestUnbeatenStreak;
        if (streak) {
          state.modal = { type: "streak", payload: { title: isWin ? "最长连胜纪录" : "最长不败纪录", streak } };
          render();
        }
      });
    });

    container.querySelector("[data-ch-close-modal]")?.addEventListener("click", () => {
      state.modal = null;
      render();
    });

    container.querySelector("[data-ch-modal-backdrop]")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) {
        state.modal = null;
        render();
      }
    });
  }

  render();

  return {
    render,
    reload,
    setData,
    navigate,
    getState: () => ({ ...state, filters: { ...state.filters } }),
  };
}
