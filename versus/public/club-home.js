import {competitionAvailability, assignedLineupScheme} from './lineup-competition.js';
import {normalizeFitnessThreshold} from './fitness-rules.js';

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const number = (value, digits = 0) => finite(value) ? Number(value).toLocaleString('zh-CN', {maximumFractionDigits:digits, minimumFractionDigits:digits}) : '—';
export const recentClubMatches = league => (league.recentMatches ?? []).filter(m => m.competition !== 'season-final' && [m.homeId,m.awayId].includes(league.ownTeam?.id)).sort((a,b)=>Number(b.playedAt)-Number(a.playedAt));

export function clubHomeModel(league, fixtures = [], broadcasts = []) {
  const own = league.ownTeam ?? {}, season = league.season ?? {}, now = Number(league.serverTime ?? Date.now());
  const history = recentClubMatches(league);
  const future = fixtures.filter(f=>f.competition !== 'season-final' && f.status !== 'complete').sort((a,b)=>Number(a.startsAt)-Number(b.startsAt));
  const live = future.find(f=>f.status === 'live');
  const last = history[0];
  // Give a just-finished result a short place of honour; do not infer a new season date.
  const recentFinish = last && now >= Number(last.playedAt) && now - Number(last.playedAt) < 5 * 60_000;
  let state = future.length ? 'pre' : 'off';
  if (recentFinish) state = 'post';
  if (season.status === 'registration') state = 'off';
  if (live) state = 'live';
  const fixture = live ?? future[0] ?? null;
  const broadcast = broadcasts.find(b=>(live?.broadcastCode && b.code === live.broadcastCode) || (live?.v4MatchId && b.v4MatchId === live.v4MatchId));
  const competition = fixture?.competition ?? 'league';
  const scheme = assignedLineupScheme(own,competition);
  const starterIds = scheme?.preferredStarterIds ?? own.roster?.filter(p=>p.starter || p.isStarter).map(p=>p.id) ?? [];
  const roster = own.roster ?? [], starters = roster.filter(p=>starterIds.includes(p.id));
  const blocked = starters.map(p=>({player:p,...competitionAvailability(p,competition)})).filter(p=>p.unavailable);
  const threshold = normalizeFitnessThreshold(scheme?.fitnessThreshold ?? own.fitnessThreshold);
  const tired = starters.filter(p=>!competitionAvailability(p,competition).unavailable && competitionAvailability(p,competition).fitness<threshold);
  const todo = [];
  if(starters.length<11)todo.push({type:'首发缺员',text:`首发 ${starters.length}/11 人，请补齐阵容`,tab:'squad',action:'补齐首发'});
  if(blocked.length)todo.push({type:'出场受限',text:blocked.map(p=>`${p.player.name} · ${p.label}`).join('；'),tab:'squad',action:'检查阵容'});
  if(tired.length)todo.push({type:'体能预警',text:`${tired.map(p=>p.name).join('、')} 低于赛前轮换参考值 ${threshold}%`,tab:'squad',action:'安排轮换'});
  const sponsorship = own.clubManagement?.sponsorship;
  const offers = (sponsorship?.offers ?? []).filter(o=>o.status==='pending');
  if(offers.length)todo.push({type:'赞助报价',text:`${offers.length} 份赞助报价等待处理`,tab:'club',action:'查看报价'});
  const expiring = (sponsorship?.activeContracts ?? []).filter(c=>finite(c.remainingSeasons) && Number(c.remainingSeasons)<=1 && Number(c.remainingSeasons)>0);
  if(expiring.length)todo.push({type:'合同提醒',text:`${expiring.length} 份赞助合同将在本赛季结束后到期`,tab:'club',action:'查看合同'});
  const standings = (league.teams ?? []).filter(t=>t.division===own.division).sort((a,b)=>a.rank-b.rank);
  const index = standings.findIndex(t=>t.id===own.id);
  const snapshot = count => {
    const start = Math.max(0, Math.min(index - Math.floor(count / 2), standings.length - count));
    return standings.slice(start, start + count);
  };
  return {own,season,now,history,last,state,fixture,broadcast,scheme,todo,standings,index,snapshot,future};
}

export function clubHomeMarkup(league, {fixtures=[],broadcasts=[],escape, badge, card, time, countdown, detail=null, detailState='idle'} = {}) {
  const m=clubHomeModel(league,fixtures,broadcasts), {own,season,last,state,fixture}=m;
  const e=escape;
  const btn=(tab,label,primary=false)=>`<button type="button" class="button ${primary?'primary':'secondary'}" data-league-tab="${tab}">${label}</button>`;
  const crest=team=>`<span class="home-crest">${badge(team)||`<span aria-hidden="true">${e((team?.name??'FC').slice(0,2))}</span>`}</span>`;
  const comp=(competition='league')=>`<span class="yffm-competition comp-${competition==='cup'?'cup':own.division==='B'?'b':'a'}">${competition==='cup'?'冠军杯':competition==='friendly'?'友谊赛':`${e(own.division??'—')}级联赛`}</span>`;
  const identity=`<header class="home-identity">${crest(own)}<div><small>CLUB HOUSE · 俱乐部主场</small><h1>${e(own.name)}</h1><p>${comp()}<span>${e(season.name??'当前赛季')} · 第 ${number(season.currentRound)} / ${number(season.totalRounds)} 轮</span></p></div><dl class="home-resources"><div><dt>俱乐部资金</dt><dd class="yffm-num">${number(league.wallet?.balance)}</dd></div><div><dt>平均体能</dt><dd class="yffm-num">${number(league.report?.availability?.averageFitness)}%</dd></div><div><dt>本场阵容方案</dt><dd>${e(m.scheme?.name??'未绑定')}</dd></div></dl></header>`;
  let hero;
  if(state==='off'){
    hero=`<div class="home-match-meta">${comp()}<span>赛程间歇</span></div><div class="home-off-season"><div><small>赛季日程</small><h2>${season.status==='registration'?'新赛季备战中':'本队暂无待赛场次'}</h2><p>${season.status==='completed'?`本赛季最终排名：${e(own.division??'—')}级第 ${number(m.standings[m.index]?.rank)} 名。新赛季时间待定。`:'下一场开球时间待定，可先检查阵容。'}</p></div>${btn('squad','规划阵容',true)}</div>`;
  }else{
    const post=state==='post', ownIsHome=post?last.homeId===own.id:fixture.venue==='home';
    const opponentId=post?(ownIsHome?last.awayId:last.homeId):fixture.opponentId;
    const opponent=(league.teams??[]).find(t=>t.id===opponentId)??{name:post?(ownIsHome?last.awayName:last.homeName):fixture.opponentName};
    const sides=ownIsHome?[own,opponent]:[opponent,own];
    const score=post?last.score:m.broadcast?.score;
    const status=post?'全场结束 · FT':state==='live'?`比赛进行中${finite(m.broadcast?.minute)?` · ${number(m.broadcast.minute)}′`:''}`:time(fixture.startsAt);
    const ownGoals = post ? last.score[ownIsHome ? 0 : 1] : null;
    const opponentGoals = post ? last.score[ownIsHome ? 1 : 0] : null;
    const earned = ownGoals === opponentGoals ? 1 : ownGoals > opponentGoals ? 3 : 0;
    const resultNote = last?.competition === 'league' ? `联赛积分 +${earned}` : '全场结束';
    const actions=post?`<button class="button primary" data-league-match-detail="${e(last.id)}">查看比赛记录</button>`:state==='live'?`<button class="button primary" ${fixture.v4MatchId?`data-watch-v4="${e(fixture.v4MatchId)}"`:fixture.broadcastCode?`data-watch-room="${e(fixture.broadcastCode)}"`:'data-league-tab="television"'}>进入比赛直播</button>`:`${btn('squad','检查阵容',true)}${btn('schedule','查看赛程')}`;
    hero=`<div class="home-match-meta">${comp(post?last.competition:fixture.competition)}<span>${e(post?last.label:fixture.label??'下一场比赛')}</span><span class="home-match-status ${state==='live'?'is-live':''}" ${state==='live'?'data-home-live-clock':''}>${state==='live'?'<i></i>':''}${e(status)}</span></div><div class="home-scorebug"><div>${crest(sides[0])}<b>${e(sides[0].name)}</b><small>主场</small></div><div class="home-score-centre"><small>${post?'最终比分':state==='live'?'LIVE':'距离开赛'}</small><strong class="yffm-num ${state==='pre'?'is-countdown':''}" ${state==='pre'?`data-home-countdown="${fixture.startsAt}"`:state==='live'?'data-home-live-score':''}>${score?score.join(' : '):state==='pre'?e(countdown(fixture.startsAt,m.now)):'— : —'}</strong></div><div>${crest(sides[1])}<b>${e(sides[1].name)}</b><small>客场</small></div></div><footer><span>${post?resultNote:state==='live'?'关键事件支持真实轨迹回放':m.todo.length?`${m.todo.length} 项球队事项待检查`:'首发阵容齐整'}</span><div>${actions}</div></footer>`;
  }
  const self=m.standings[m.index], table=self?.table??{};
  const diff=Number(table.goalsFor??0)-Number(table.goalsAgainst??0);
  const form=m.history.slice(0,5).map(match=>{const i=match.homeId===own.id?0:1;const result=match.score[i]>match.score[1-i]?'W':match.score[i]===match.score[1-i]?'D':'L';return `<span class="home-form result-${result}" title="${e(`${match.homeName} ${match.score.join(':')} ${match.awayName}`)}">${{W:'胜',D:'平',L:'负'}[result]}</span>`;}).join('')||'<span class="home-muted">暂无战绩</span>';
  const rows=m.snapshot(5).map(t=>`<tr class="${t.id===own.id?'is-own':''} ${m.snapshot(3).some(s=>s.id===t.id)?'mobile-nearby':'desktop-nearby'}" data-render-key="home-rank-${e(t.id)}"><td>${number(t.rank)}</td><td>${badge(t)}<button data-league-team-detail="${e(t.id)}">${e(t.name)}</button>${t.id===own.id?'<em>我方</em>':''}</td><td>${number(t.table?.played)}</td><td>${number(Number(t.table?.goalsFor??0)-Number(t.table?.goalsAgainst??0))}</td><td><strong>${number(t.table?.points)}</strong></td></tr>`).join('');
  const standings=`<section class="home-panel home-standing"><header><div><small>YOUR POSITION</small><h2>本队联赛处境</h2></div><button class="home-text-button" data-home-standings>完整 A / B 榜单 ↗</button></header><div class="home-kpis"><div><small>当前排名</small><b class="yffm-num">${number(self?.rank)}<em> / ${m.standings.length}</em></b></div><div><small>积分 / 净胜球</small><b class="yffm-num">${number(table.points)}<em> / ${diff>0?'+':''}${number(diff)}</em></b></div><div><small>距榜首 / 领先下位</small><b class="yffm-num">${self?number(m.standings[0].table.points-table.points):'—'}<em> / ${m.standings[m.index+1]?number(table.points-m.standings[m.index+1].table.points):'—'}</em></b></div><div><small>近五场 · 左侧最新</small><div>${form}</div></div></div><div class="home-table-wrap"><table class="home-table yffm-num"><thead><tr><th>名次</th><th>球队</th><th>赛</th><th>净胜</th><th>积分</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  const todos=`<section class="home-panel home-todos"><header><div><small>CLUB ACTIONS</small><h2>俱乐部待办</h2></div><span class="home-count">${m.todo.length} 项</span></header><div>${m.todo.length?m.todo.map((t,i)=>`<article data-render-key="todo-${i}"><span class="home-todo-label">${t.type}</span><p>${e(t.text)}</p>${btn(t.tab,t.action)}</article>`).join(''):'<div class="home-empty"><b>✓ 阵容齐整，当前无待办</b><p>本场首发符合出场条件，暂无体能或赞助提醒。</p></div>'}</div></section>`;
  const past=last?`<div class="home-mini-score"><span>${e(last.homeName)}</span><b class="yffm-num">${last.score.join(' : ')}</b><span>${e(last.awayName)}</span></div><div data-home-last-stats>${clubHomeStatsMarkup(detail,e,detailState)}</div>`:'<div class="home-empty"><b>等待首场哨响</b><p>完成比赛后将在这里显示赛果与技术统计。</p></div>';
  const games=m.future.slice(0,3).map(f=>`<article class="home-fixture">${comp(f.competition)}<span>${f.venue==='home'?'主场':'客场'} · ${e(f.opponentName)}</span><time>${e(time(f.startsAt))}</time></article>`).join('')||'<p class="home-muted">暂无已排定比赛</p>';
  const best=league.report?.bestPlayer, player=(own.roster??[]).find(p=>p.id===best?.id);
  const headlines=[league.report?.economy?.coinChange?`今日金币 ${league.report.economy.coinChange>0?'+':''}${number(league.report.economy.coinChange)}`:null,own.clubManagement?.stadium?`主场 ${own.clubManagement.stadium.displayName??own.clubManagement.stadium.name} · ${number(own.clubManagement.stadium.capacity)} 座`:null,league.inboxUnreadCount?`${league.inboxUnreadCount} 封未读俱乐部消息`:null].filter(Boolean).slice(0,3);
  return `<div class="club-home" data-home-state="${state}">${identity}<section class="home-match-hero">${hero}</section><div class="home-main-grid">${standings}${todos}</div><div class="home-bottom-grid"><details class="home-panel home-recent" data-preserve-open="home-recent"><summary>上一场比赛摘要 <span>展开 / 收起</span></summary><div class="home-detail-body">${last?`<button class="home-text-button" data-league-match-detail="${e(last.id)}">${e(last.label)} · 比赛记录 ↗</button>`:''}${past}</div></details><details class="home-panel home-calendar" data-preserve-open="home-calendar"><summary>近期三场赛程 <span>展开 / 收起</span></summary><div class="home-detail-body">${games}${btn('schedule','完整日程')}</div></details><section class="home-panel home-brief"><header><div><small>CLUB BRIEF</small><h2>球队近况</h2></div></header>${best?`<div class="home-player">${player?`<div class="yffm-card-slot size-s">${card(player,{interactive:false})}</div>`:''}<div><b>${e(best.name)}</b><p>本队最佳 · 评分 <span class="yffm-num">${number(best.averageRating,2)}</span></p></div></div>`:'<p class="home-muted">比赛后更新球员表现</p>'}<ul>${headlines.map(t=>`<li>${e(t)}</li>`).join('')||'<li>俱乐部动态将在这里更新</li>'}</ul>${btn('inbox','查看俱乐部消息')}</section></div><details class="home-archive home-panel" data-preserve-open="home-tools"><summary>赛果档案与球员检索</summary><div class="home-detail-body" data-home-tools></div></details></div>`;
}

export function clubHomeStatsMarkup(detail,escape,state='idle') {
  const teams=detail?.report?.teams??detail?.teams??[], stats=teams.map(t=>t.stats??{});
  const possession=stats.map(s=>s.possession), total=possession.reduce((a,n)=>a+(finite(n)?Number(n):0),0);
  const known=possession.length===2 && possession.every(finite) && total>0;
  const left=known?Math.round(Number(possession[0])/total*100):null;
  const goals=(detail?.importantEvents??detail?.report?.events??[]).filter(e=>e.type==='goal'||e.type==='penaltyGoal'||e.type==='ownGoal').map(e=>`${e.minute}′ ${e.text??''}`).slice(0,4);
  const players=teams.flatMap(t=>t.players??[]).filter(p=>finite(p.rating)).sort((a,b)=>Number(b.rating)-Number(a.rating));
  return `<div class="home-stat-line"><b>${known?left+'%':'—'}</b><span>控球率${known?'':' · 未记录'}</span><b>${known?(100-left)+'%':'—'}</b></div><div class="home-possession" aria-hidden="true">${known?`<i style="width:${left}%"></i><i style="width:${100-left}%"></i>`:''}</div><div class="home-stat-line"><b>${number(stats[0]?.xg,2)}</b><span>xG <em class="yffm-estimate">估算</em></span><b>${number(stats[1]?.xg,2)}</b></div>${!stats.length?`<p class="home-muted">${state==='loading'?'正在读取比赛统计…':state==='error'?'统计暂时无法读取，请打开比赛记录重试':'— 未记录'}</p>`:''}${goals.length?`<p class="home-goals">${goals.map(escape).join('<br>')}</p>`:''}${players.length?`<p class="home-mvp">本场最佳 · ${escape(players[0].name??'')} <b>${number(players[0].rating,1)}</b></p>`:''}`;
}
