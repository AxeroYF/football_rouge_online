const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num = value => Number(value ?? 0).toLocaleString('zh-CN');
export function inboxNavigation(message) {
  const p = message.payload ?? {}, actions = [];
  if (p.rewards?.some(r => r.quantity > 0) || p.packType || p.packIds?.length || p.offerId || p.offerIds?.length) actions.push(['packs','查看礼包']);
  if (p.cardId || p.cardIds?.length || ['trade-result','transfer'].includes(message.type)) actions.push(['cards','查看球员卡']);
  if (['matchweek','medical','lineup','daily-report'].includes(message.type)) actions.push(['squad','调整阵容'],['schedule','查看赛程']);
  if (['friendly','friendly-invite'].includes(message.type)) actions.push(['schedule','查看赛程']);
  if (['prediction','prediction-share'].includes(message.type)) actions.push(['predictions','查看预测']);
  if (['trade-offer','trade-result','trade-public','transfer'].includes(message.type)) actions.push(['market','交易市场']);
  return actions;
}
export const inboxNavButton = (target,label) => `<button type="button" class="button secondary" data-inbox-nav="${esc(target)}">${esc(label)}</button>`;
export function inboxActionsMarkup(message) {
  const actions = inboxNavigation(message);
  return actions.length ? `<nav class="mail-content-actions" aria-label="邮件相关功能">${actions.map(([target,label]) => inboxNavButton(target,label)).join('')}</nav>` : '';
}
export function inboxContext(message) {
  const p = message.payload ?? {};
  const competition = p.competitionLabel ?? ({league:'联赛',cup:'杯赛',friendly:'友谊赛'})[p.competition];
  return [competition,p.seasonName ?? message.seasonName,p.seasonDate ?? message.seasonDate].filter(Boolean).join(' · ');
}
function section(title,body) { return `<section class="mail-content-section"><h3>${title}</h3>${body}</section>`; }
function details(title,body) { return `<details class="mail-content-details"><summary>${title}</summary><div>${body}</div></details>`; }
function nextMarkup(next) {
  if (!next) return '<p class="muted">暂无已确定的后续赛程。</p>';
  return `<section class="mail-next-match"><small>下一场 · ${esc(next.competitionName ?? '比赛')} · ${esc(next.label ?? '')}</small><b>${esc(next.name ?? next.opponentName)}</b><span>${next.venue === 'home' ? '主场' : next.venue === 'away' ? '客场' : '场地待定'}${next.startsAt ? ` · ${esc(new Date(next.startsAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}))}` : ''}</span></section>`;
}
function availabilityMarkup(availability) {
  if (!availability) return '';
  const items = [...(availability.injured ?? []).map(p => `${p.name} · 伤缺${p.rounds}轮`),
    ...(availability.suspended ?? []).map(p => `${p.name} · ${availability.competitionName ?? '联赛'}停赛${p.rounds}场`)];
  return items.length ? section(`下一场${esc(availability.competitionName ?? '比赛')} · 伤停`, `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul><small class="muted">结算时记录，最新状态以战术板为准。</small>`) : '';
}
export function inboxStructuredMarkup(message, {matchRow = () => ''} = {}) {
  const p = message.payload ?? {};
  if (message.type === 'matchweek' && p.settlementVersion === 1) {
    const rewardLines = (p.rewards ?? []).flatMap(r => [r.amount ? `${r.sponsorCount ? `带资进组 · ${num(r.sponsorCount)}人 × ${num(r.unit)}` : "比赛奖励"} +${num(r.amount)} 金币` : '',r.quantity ? `${({champion:'冠军奖励',runnerUp:'亚军奖励',advance:'晋级奖励'})[r.award] ?? '比赛奖励'} · ${r.packName ?? '礼包'} ×${r.quantity}` : ''].filter(Boolean));
    if (p.homeTicketIncome) {
      const {amount, attendance} = p.homeTicketIncome;
      const crowd = Number.isFinite(attendance) ? ` · ${num(attendance)} 名观众入场` : '';
      rewardLines.push(`主场门票 +${num(amount)} 金币${crowd}`);
    }
    const rewards = rewardLines.length ? section('已自动到账',`<ul>${rewardLines.map(line => `<li>${esc(line)}</li>`).join('')}</ul>`) : '';
    const wear=p.nineDragonsWear;
    const wearNote=wear ? section('九龙拉棺 · 本体卡永久损耗',`<p>${esc(wear.name)} · 基础总评 ${num(wear.before)} → ${num(wear.after)}</p>`) : '';
    const rotations = p.autoRotations?.length ? details(`赛前轮换 · ${p.autoRotations.length}处`, `<ul>${p.autoRotations.map(r => `<li>${esc(r.outName)} → ${esc(r.inName)}<small>${esc(r.reason)}</small></li>`).join('')}</ul><small class="muted">仅用于本场出场阵容。</small>`) : '';
    const alerts = [...(p.injured ?? []).map(player => `${player.name} · 伤缺${player.rounds}轮`),...(p.suspended ?? []).map(player => `${player.name} · ${p.competition === 'cup' ? '杯赛' : '联赛'}停赛${player.rounds}场`)];
    const currentAvailability = alerts.length && (!p.nextAvailability || p.nextAvailability.competition !== p.competition)
      ? details(`本项${p.competition === 'cup' ? '杯赛' : '联赛'} · 赛后伤停`,`<ul>${alerts.map(text => `<li>${esc(text)}</li>`).join('')}</ul>`) : '';
    return `<div class="league-mail-body mail-content"><div class="mail-score"><span>${esc(p.ownName)}<small>${p.venue === 'home' ? '主场' : '客场'}</small></span><strong>${num(p.ownScore)} : ${num(p.opponentScore)}</strong><span>${esc(p.opponentName)}</span></div>${p.penalties ? `<p class="muted">点球 ${num(p.penalties[0])}:${num(p.penalties[1])}</p>` : ''}${p.competition === 'league' ? `<p class="mail-standing">${esc(p.division ?? 'A')}级第${num(p.rank)}名 · ${num(p.points)}分</p>` : ''}${rewards}${wearNote}${availabilityMarkup(p.nextAvailability)}${currentAvailability}${nextMarkup(p.next)}${rotations}${p.results?.length > 1 ? details('本轮赛果',p.results.map(matchRow).join('')) : ''}${inboxActionsMarkup(message)}</div>`;
  }
  if (message.type === 'daily-report' && message.report) {
    const report = message.report, today = report.today ?? {}, availability = report.availability ?? {};
    const results = (today.results ?? []).map(r => `<li><span>${esc(({league:"联赛",cup:"杯赛",friendly:"友谊赛"})[r.competition] ?? "比赛")} · ${esc(r.label ?? (r.round ? `第${r.round}轮` : ""))} · ${r.venue === 'home' ? '主场' : '客场'} · ${esc(r.opponentName)}</span><b>${num(r.scoreFor)}:${num(r.scoreAgainst)}</b></li>`).join('');
    const warnings = [...(availability.injured ?? []).map(p => `${p.name}伤缺${p.rounds}轮`),...(availability.suspended ?? []).map(p => `${p.name}联赛停赛${p.rounds}场`),...(availability.lowFitness ?? []).map(p => `${p.name}体能${p.fitness}`)];
    return `<div class="league-mail-body mail-content"><div class="mail-summary-grid"><span><small>今日战绩</small><b>${num(today.wins)}胜 ${num(today.draws)}平 ${num(today.losses)}负</b></span><span><small>平均体能</small><b>${num(availability.averageFitness)}</b></span><span><small>金币变化</small><b>${Number(report.economy?.coinChange) > 0 ? '+' : ''}${num(report.economy?.coinChange)}</b></span></div>${warnings.length ? details(`阵容提醒 · ${warnings.length}项`, `<ul>${warnings.map(line => `<li>${esc(line)}</li>`).join('')}</ul><small class="muted">日报快照；杯赛停赛请查看战术板。</small>`) : ''}${nextMarkup(report.nextOpponent)}${results ? details('今日赛果',`<ul>${results}</ul>`) : '<p class="muted">今日暂无赛果。</p>'}${report.topPlayers?.length ? details('球员表现',`<ul>${report.topPlayers.slice(0,3).map(p => `<li>${esc(p.name)} · ${num(p.goals)}球 ${num(p.assists)}助 · 评分${Number(p.averageRating ?? 0).toFixed(2)}</li>`).join('')}</ul>`) : ''}${inboxActionsMarkup(message)}</div>`;
  }
  if (message.type === 'activity-digest') {
    return `<div class="league-mail-body mail-content"><p class="muted">今日${num(p.total)}条${p.total > 40 ? ' · 展示最近40条' : ''}</p><ol class="mail-activity-list">${[...(p.entries ?? [])].reverse().map(entry => `<li><time>${esc(new Date(entry.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}))}</time><p>${esc(entry.summary)}</p>${entry.destination === 'television' ? inboxNavButton('television','查看直播') : inboxNavButton('enhancement','球员强化')}</li>`).join('')}</ol></div>`;
  }
  return null;
}
export function inboxPlainBodyMarkup(message) {
  const body = String(message.body ?? '').trim();
  const paragraphs = body.split(/\r?\n+/).filter(Boolean);
  const markup = paragraphs.map(text => `<p>${esc(text)}</p>`).join('');
  return `<div class="league-mail-body mail-content">${body.length > 600 ? details('完整说明',markup) : markup}${inboxActionsMarkup(message)}</div>`;
}
