const ROLE_GROUPS = [
  { id: 'ATT', label: '前锋线', roles: new Set(['ST', 'CF', 'LW', 'RW', 'SS']) },
  { id: 'MID', label: '中场线', roles: new Set(['CAM', 'AM', 'CM', 'LM', 'RM', 'CDM', 'DM']) },
  { id: 'DEF', label: '后防线', roles: new Set(['CB', 'LB', 'RB', 'LWB', 'RWB']) },
  { id: 'GK', label: '门将', roles: new Set(['GK']) },
];

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function matchResultForTeam(match, teamId) {
  if (!match?.score || match.score.length < 2) return null;
  const isHome = match.homeId === teamId;
  const ownGoals = Number(match.score[isHome ? 0 : 1]);
  const oppGoals = Number(match.score[isHome ? 1 : 0]);
  if (!Number.isFinite(ownGoals) || !Number.isFinite(oppGoals)) return null;
  const code = ownGoals > oppGoals ? 'W' : ownGoals === oppGoals ? 'D' : 'L';
  const opponentName = isHome ? (match.awayName ?? '对手') : (match.homeName ?? '对手');
  return { code, label: { W: '胜', D: '平', L: '负' }[code], scoreText: `${ownGoals}-${oppGoals}`, opponentName, id: match.id };
}

function renderPlayerRow(player, { escape, roleLabels, isAi, fitnessMap, compact = false }) {
  const grade = String(player.grade ?? 'C').toUpperCase();
  const roleLabel = roleLabels[player.role] ?? player.role ?? '球员';
  const upgrade = Number(player.upgradeLevel ?? 0) > 0 ? `<span class="dossier-upgrade">+${Number(player.upgradeLevel)}</span>` : '';
  const fitnessVal = isAi && finite(fitnessMap?.[player.id]?.fitness) ? Math.round(Number(fitnessMap[player.id].fitness)) : null;
  const fitnessColor = fitnessVal === null ? '' : fitnessVal >= 80 ? 'is-high' : fitnessVal >= 65 ? 'is-mid' : 'is-low';
  const fitnessHtml = fitnessVal !== null
    ? `<div class="dossier-fitness"><i class="${fitnessColor}" style="width:${Math.max(0, Math.min(100, fitnessVal))}%"></i><span>${fitnessVal}%</span></div>`
    : '';
  return `<article class="dossier-player-item ${compact ? 'is-compact' : ''}">
    <span class="grade grade-${escape(grade)}">${escape(grade)}</span>
    <div class="dossier-player-meta">
      <div class="dossier-player-name"><b>${escape(player.name)}</b>${upgrade}</div>
      <small>${escape(roleLabel)}</small>
      ${fitnessHtml}
    </div>
    <strong class="yffm-num dossier-ovr">${finite(player.overall) ? Number(player.overall) : '—'}</strong>
  </article>`;
}

export function clubDetailMarkup(team, {
  escape,
  badge,
  pitch,
  matchRow,
  aiBoards = '',
  roleLabels = {},
  leagueTeams = [],
} = {}) {
  const e = escape;
  const standingEntry = (leagueTeams ?? []).find(t => t.id === team.id) ?? {};
  const division = team.division ?? standingEntry.division ?? '';
  const rank = team.rank ?? standingEntry.rank;
  const table = team.table ?? standingEntry.table ?? {};
  const played = Number(table.played ?? 0);
  const won = Number(table.won ?? 0);
  const drawn = Number(table.drawn ?? 0);
  const lost = Number(table.lost ?? 0);
  const points = finite(table.points) ? Number(table.points) : (won * 3 + drawn);
  const gd = Number(table.goalsFor ?? 0) - Number(table.goalsAgainst ?? 0);
  const gdText = `${gd > 0 ? '+' : ''}${gd}`;

  const roster = Array.isArray(team.roster) ? [...team.roster] : [];
  const sortedByOvr = [...roster].sort((a, b) => Number(b.overall ?? 0) - Number(a.overall ?? 0));
  const avgOvr = roster.length
    ? (roster.reduce((sum, p) => sum + Number(p.overall ?? 0), 0) / roster.length).toFixed(1)
    : '—';

  const recentHistory = Array.isArray(team.recentHistory) ? team.recentHistory : [];
  const formItems = recentHistory.slice(0, 5).map(m => matchResultForTeam(m, team.id)).filter(Boolean);
  const formHtml = formItems.length
    ? formItems.map(item => `<span class="home-form result-${item.code}" title="vs ${e(item.opponentName)} (${item.scoreText})">${item.label}</span>`).join('')
    : '<span class="dossier-muted">暂无战绩</span>';

  const crestHtml = badge?.(team) || `<span aria-hidden="true">${e((team.name ?? 'FC').slice(0, 2))}</span>`;
  const divisionBadge = division
    ? `<span class="yffm-competition comp-${division === 'B' ? 'b' : 'a'}">${e(division)}级联赛</span>`
    : '';
  const typeBadge = `<span class="dossier-type-pill ${team.isAi ? 'is-ai' : 'is-player'}">${team.isAi ? 'AI 俱乐部' : '玩家俱乐部'}</span>`;
  const friendlyAction = team.canInviteFriendly
    ? `<button type="button" class="button primary league-friendly-invite" data-friendly-invite="${e(team.id)}">发起友谊赛</button>`
    : '';

  // Key 4 players for Overview tab
  const topPlayers = sortedByOvr.slice(0, 4);
  const topPlayersHtml = topPlayers.length
    ? `<section class="dossier-section"><header><h3>核心主力</h3><small>按总评前 ${topPlayers.length} 名</small></header><div class="dossier-key-grid">${topPlayers.map(p => renderPlayerRow(p, { escape: e, roleLabels, isAi: team.isAi, fitnessMap: team.playerFitness })).join('')}</div></section>`
    : '';

  // Quick last 3 matches strip for Overview tab
  const quickMatches = formItems.slice(0, 3);
  const quickMatchesHtml = quickMatches.length
    ? `<section class="dossier-section"><header><h3>近期三场速览</h3><button type="button" class="home-text-button" data-dossier-jump="history">全部战绩 ↗</button></header><div class="dossier-quick-matches">${quickMatches.map(item => `<button type="button" class="dossier-match-chip" ${item.id ? `data-league-match-detail="${e(item.id)}"` : 'disabled'}><span class="dossier-opp">vs ${e(item.opponentName)}</span><b class="yffm-num">${e(item.scoreText)}</b><em class="home-form result-${item.code}">${item.label}</em></button>`).join('')}</div></section>`
    : '';

  // Full Roster grouped by position line
  const usedIds = new Set();
  const groupedSections = ROLE_GROUPS.map(group => {
    const players = sortedByOvr.filter(p => group.roles.has(String(p.role ?? '').toUpperCase()));
    players.forEach(p => usedIds.add(p.id));
    if (!players.length) return '';
    return `<div class="dossier-roster-group"><header><h4>${group.label}</h4><span>${players.length} 人</span></header><div class="dossier-roster-grid">${players.map(p => renderPlayerRow(p, { escape: e, roleLabels, isAi: team.isAi, fitnessMap: team.playerFitness, compact: true })).join('')}</div></div>`;
  }).filter(Boolean);
  const others = sortedByOvr.filter(p => !usedIds.has(p.id));
  if (others.length) {
    groupedSections.push(`<div class="dossier-roster-group"><header><h4>其他位置</h4><span>${others.length} 人</span></header><div class="dossier-roster-grid">${others.map(p => renderPlayerRow(p, { escape: e, roleLabels, isAi: team.isAi, fitnessMap: team.playerFitness, compact: true })).join('')}</div></div>`);
  }
  const fullRosterHtml = groupedSections.length
    ? groupedSections.join('')
    : '<p class="league-empty">暂无球员名单数据。</p>';

  // History panel preserving exact app.js hooks ([data-team-history-list], [data-team-history-load])
  const historyTotal = Number(team.historyTotal ?? recentHistory.length);
  const historyPanel = historyTotal
    ? `<section class="league-team-history dossier-history"><header><h3>历史战绩</h3><small>已显示最近 ${recentHistory.length} 场 · 共 ${historyTotal} 场</small></header><div data-team-history-list>${recentHistory.map(match => matchRow(match, team.id)).join('')}</div>${recentHistory.length < historyTotal ? `<button type="button" class="button secondary league-team-history-load" data-team-history-load>加载更多比赛（剩余 ${historyTotal - recentHistory.length} 场）</button>` : ''}</section>`
    : `<section class="league-team-history dossier-history"><header><h3>历史战绩</h3></header><p class="league-empty">还没有比赛记录。</p></section>`;

  const tabs = [
    { id: 'overview', label: '阵型与核心' },
    { id: 'roster', label: `完整名单 (${roster.length})` },
    ...(team.isAi && aiBoards ? [{ id: 'ai', label: 'AI 战术方案' }] : []),
    { id: 'history', label: `历史战绩 (${historyTotal})` },
  ];

  return `
    <div class="club-dossier" data-club-dossier>
      <header class="club-dossier-hero">
        <div class="dossier-hero-top">
          <div class="dossier-identity">
            <span class="home-crest dossier-crest">${crestHtml}</span>
            <div class="dossier-title-block">
              <div class="dossier-badges">${divisionBadge}${typeBadge}</div>
              <h2>${e(team.name)}</h2>
              <p class="dossier-record">${played} 赛 · ${won}胜 ${drawn}平 ${lost}负</p>
            </div>
          </div>
          <div class="league-team-detail-actions">
            ${friendlyAction}
            <button type="button" class="icon-button" data-close-league-dialog aria-label="关闭">×</button>
          </div>
        </div>
        <div class="club-dossier-kpis">
          <div><small>联赛排名</small><b class="yffm-num">${finite(rank) ? `第 ${Number(rank)} 名` : '—'}</b></div>
          <div><small>积分 / 净胜</small><b class="yffm-num">${points} <em>(${gdText})</em></b></div>
          <div><small>阵型 / 均评</small><b class="yffm-num">${e(team.formation ?? '待定')} <em>· ${avgOvr}</em></b></div>
          <div><small>近五场战绩</small><div class="dossier-form-row">${formHtml}</div></div>
        </div>
      </header>

      <nav class="club-dossier-tabs" role="tablist" aria-label="俱乐部详情视图">
        ${tabs.map((tab, idx) => `<button type="button" role="tab" class="${idx === 0 ? 'active' : ''}" aria-selected="${idx === 0 ? 'true' : 'false'}" data-dossier-tab="${tab.id}">${tab.label}</button>`).join('')}
      </nav>

      <div class="club-dossier-body">
        <section class="dossier-panel" data-dossier-panel="overview">
          <div class="dossier-pitch-wrap">
            <div class="dossier-pitch-head">
              <h3>当前首发阵型</h3>
              <span class="yffm-num">${e(team.formation ?? '阵型待定')}</span>
            </div>
            ${pitch(team)}
          </div>
          ${topPlayersHtml}
          ${quickMatchesHtml}
        </section>

        <section class="dossier-panel" data-dossier-panel="roster" hidden>
          ${fullRosterHtml}
        </section>

        ${team.isAi && aiBoards ? `<section class="dossier-panel dossier-ai-panel" data-dossier-panel="ai" hidden>${aiBoards}</section>` : ''}

        <section class="dossier-panel" data-dossier-panel="history" hidden>
          ${historyPanel}
        </section>
      </div>
    </div>
  `;
}

export function bindClubDetailTabs(root) {
  if (!root) return;
  const switchTab = targetId => {
    root.querySelectorAll('[data-dossier-tab]').forEach(btn => {
      const active = btn.dataset.dossierTab === targetId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    root.querySelectorAll('[data-dossier-panel]').forEach(panel => {
      panel.hidden = panel.dataset.dossierPanel !== targetId;
    });
  };
  root.querySelectorAll('[data-dossier-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.dossierTab));
  });
  root.querySelectorAll('[data-dossier-jump]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.dossierJump));
  });
}
