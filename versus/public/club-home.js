import {broadcastMinuteLabel} from "./broadcast-key-plays.js";
import {competitionAvailability, assignedLineupScheme} from './lineup-competition.js';
import {divisionStandingsMarkup} from './division-ui.js';
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
  if(starters.length<11)todo.push({type:'首发缺员',severity:'danger',text:`首发 ${starters.length}/11 人，请补齐阵容`,tab:'squad',action:'补齐首发'});
  if(blocked.length)todo.push({type:'出场受限',severity:'danger',text:blocked.map(p=>`${p.player.name} · ${p.label}`).join('；'),tab:'squad',action:'检查阵容'});
  if(tired.length)todo.push({type:'体能预警',severity:'warn',text:`${tired.map(p=>p.name).join('、')} 低于赛前轮换参考值 ${threshold}%`,tab:'squad',action:'安排轮换'});
  const sponsorship = own.clubManagement?.sponsorship;
  const offers = (sponsorship?.offers ?? []).filter(o=>o.status==='pending');
  if(offers.length)todo.push({type:'赞助报价',severity:'info',text:`${offers.length} 份赞助报价等待处理`,tab:'club',action:'查看报价'});
  const expiring = (sponsorship?.activeContracts ?? []).filter(c=>finite(c.remainingSeasons) && Number(c.remainingSeasons)<=1 && Number(c.remainingSeasons)>0);
  if(expiring.length)todo.push({type:'合同提醒',severity:'warn',text:`${expiring.length} 份赞助合同将在本赛季结束后到期`,tab:'club',action:'查看合同'});
  const ownRank = league.teams?.find(team => team.id === own.id)?.rank;
  return {own,season,now,history,last,state,fixture,broadcast,scheme,todo,ownRank,future};
}

export function clubHomeMarkup(league, {fixtures=[],broadcasts=[],escape, badge, card, standingRows, time, countdown, detail=null, detailState='idle', playerSearch='', archive=''} = {}) {
  const m=clubHomeModel(league,fixtures,broadcasts), {own,season,last,state,fixture}=m;
  const e=escape;
  const btn=(tab,label,primary=false)=>`<button type="button" class="button ${primary?'primary':'secondary'}" data-league-tab="${tab}">${label}</button>`;
  const crest=(team,size='lg')=>`<span class="home-crest home-crest-${size}">${badge(team)||`<span aria-hidden="true">${e((team?.name??'FC').slice(0,2))}</span>`}</span>`;
  const comp=(competition='league')=>`<span class="yffm-competition comp-${competition==='cup'?'cup':own.division==='B'?'b':'a'}">${competition==='cup'?'冠军杯':competition==='friendly'?'友谊赛':`${e(own.division??'—')}级联赛`}</span>`;
  const avgFitness = finite(league.report?.availability?.averageFitness) ? `${number(league.report.availability.averageFitness)}%` : '—';
  const stadiumName = own.clubManagement?.stadium?.displayName ?? own.clubManagement?.stadium?.name ?? '';
  const clubMetaLeft = `<div class="home-stage-club">${comp()}<b>${e(own.name)}</b><span>${e(season.name??'当前赛季')} · 第 ${number(season.currentRound)}/${number(season.totalRounds)} 轮${stadiumName?` · ${e(stadiumName)}`:''}</span></div>`;

  // TIER 1: Version B Pure Broadcast Matchday Stage (Merging Club Identity + Match Hero)
  let hero;
  if(state==='off'){
    hero=`<div class="home-match-meta">${clubMetaLeft}<span class="home-match-status">赛程间歇</span></div><div class="home-off-season"><div><small>俱乐部主场 · 赛季窗口</small><h2>${season.status==='registration'?'新赛季备战中':'当前暂无待赛场次'}</h2><p>${season.status==='completed'?`本赛季最终排名：${e(own.division??'—')}级第 ${number(m.ownRank)} 名。新赛季开赛时间待定，可先整理阵容与续约。`:'下一场正式比赛时间待定，可前往战术板检查默认、领先、落后三套预案。'}</p></div><div class="home-stage-actions">${btn('squad','规划阵容',true)}${btn('schedule','查看赛程')}</div></div>`;
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
    const actions=post
      ? `<button type="button" class="button primary" data-league-match-detail="${e(last.id)}">查看比赛记录</button>${btn('schedule','查看赛程')}`
      : state==='live'
      ? `<button type="button" class="button primary is-live-cta" ${fixture.v4MatchId?`data-watch-v4="${e(fixture.v4MatchId)}"`:fixture.broadcastCode?`data-watch-room="${e(fixture.broadcastCode)}"`:'data-league-tab="television"'}>进入比赛直播</button>`
      : `${btn('squad', m.todo.some(t=>t.tab==='squad') ? '检查阵容（需处理）' : '检查阵容', true)}${btn('schedule','查看赛程')}`;
    const matchLabel = e(post?last.label:fixture.label??'下一场比赛');
    hero=`<div class="home-match-meta">${clubMetaLeft}<span class="home-match-status ${state==='live'?'is-live':''}" ${state==='live'?'data-home-live-clock':''}>${state==='live'?'<i></i>':''}${e(status)}</span></div><div class="home-scorebug"><div class="home-side ${sides[0].id===own.id?'is-own-side':''}">${crest(sides[0],'lg')}<b>${e(sides[0].name)}</b><small>主场${sides[0].id===own.id?' · 我方':''}</small></div><div class="home-score-centre"><div class="home-centre-tag">${comp(post?last.competition:fixture.competition)}<span>${matchLabel}</span></div><small>${post?'最终比分':state==='live'?'LIVE 实时比分':'距离开赛'}</small><strong class="yffm-num ${state==='pre'?'is-countdown':''}" ${state==='pre'?`data-home-countdown="${fixture.startsAt}"`:state==='live'?'data-home-live-score':''}>${score?score.join(' : '):state==='pre'?e(countdown(fixture.startsAt,m.now)):'— : —'}</strong><div class="home-stage-actions">${actions}</div></div><div class="home-side ${sides[1].id===own.id?'is-own-side':''}">${crest(sides[1],'lg')}<b>${e(sides[1].name)}</b><small>客场${sides[1].id===own.id?' · 我方':''}</small></div></div><footer><span>本场方案：<b>${e(m.scheme?.name??'未绑定')}</b> · 平均体能：<b class="yffm-num">${avgFitness}</b></span><span>${post?resultNote:state==='live'?'关键事件支持真实轨迹小圆点回放':m.todo.length?`${m.todo.length} 项俱乐部待办需核查`:'首发 11 人齐整 · 可随时迎战'}</span></footer>`;
  }

  const standings = divisionStandingsMarkup(league, standingRows, e);

  const todos=`<section class="home-panel home-todos"><header><div><h2>俱乐部待办</h2></div><span class="home-count ${m.todo.length?'has-items':'is-clear'}">${m.todo.length?`${m.todo.length} 项待处理`:'全员就绪'}</span></header><div>${m.todo.length?m.todo.map((t,i)=>`<article class="todo-${t.severity??'warn'}" data-render-key="todo-${i}"><span class="home-todo-label">${t.type}</span><p>${e(t.text)}</p>${btn(t.tab,t.action)}</article>`).join(''):`<div class="home-empty"><b>✓ 首发齐整，当前无待办事项</b><p>本场阵容符合出场条件，暂无伤停、低体能或合同报价提醒。</p></div>`}</div></section>`;

  // TIER 3: Spacious 6:6 Dual-Column Split (Last Match Recap + Fixtures & Club Brief)
  const teamLabel = (id, name) => {
    const team = (league.teams ?? []).find(t => t.id === id) ?? (id === own.id ? own : null);
    return `<span class="home-recap-team"><span class="home-recap-badges">${team ? badge(team) : ""}</span><b>${e(name ?? team?.name ?? "待定")}</b></span>`;
  };
  const kickoffTime = timestamp => {
    if (!finite(timestamp)) return "时间待定";
    const date = new Date(Number(timestamp));
    return `${date.getMonth()+1}月${date.getDate()}日 周${"日一二三四五六"[date.getDay()]} · ${time(timestamp, false)}`;
  };
  const past=last?`<div class="home-mini-score">${teamLabel(last.homeId,last.homeName)}<b class="yffm-num">${last.score.join(' : ')}</b>${teamLabel(last.awayId,last.awayName)}</div><div data-home-last-stats>${clubHomeStatsMarkup(detail,e,detailState)}</div>`:'<div class="home-empty"><b>等待首场哨响</b><p>完成比赛后将在这里展示赛果、控球率与估算 xG。</p></div>';
  const games=m.future.slice(0,3).map(f=>`<article class="home-fixture"><div class="home-fixture-left">${comp(f.competition)}<span class="home-venue-tag">${f.venue==='home'?'主场':'客场'}</span>${teamLabel(f.opponentId,f.opponentName)}</div><time>${e(kickoffTime(f.startsAt))}</time></article>`).join('')||'<p class="home-muted">暂无已排定后续比赛</p>';
  const best=league.report?.bestPlayer, player=(own.roster??[]).find(p=>p.id===best?.id);
  const headlines=[league.report?.economy?.coinChange?`今日资金变动 ${league.report.economy.coinChange>0?'+':''}${number(league.report.economy.coinChange)}`:null,own.clubManagement?.stadium?`主场 ${own.clubManagement.stadium.displayName??own.clubManagement.stadium.name} · 容量 ${number(own.clubManagement.stadium.capacity)} 座`:null,league.inboxUnreadCount?`${league.inboxUnreadCount} 封未读俱乐部消息等待查看`:null].filter(Boolean).slice(0,3);

  const recentPanel=`<details class="home-panel home-recent" data-preserve-open="home-recent" open><summary><span>上一场比赛摘要</span><em>展开 / 收起</em></summary><div class="home-detail-body">${last?`<div class="home-subhead"><span>${e(last.label)}</span><button type="button" class="home-text-button" data-league-match-detail="${e(last.id)}">查看完整比赛记录 ↗</button></div>`:''}${past}</div></details>`;

  const scheduleBriefPanel=`<details class="home-panel home-calendar-brief" data-preserve-open="home-calendar" open><summary><span>近期赛程与球队动态</span><em>展开 / 收起</em></summary><div class="home-detail-body"><div class="home-subhead"><span>近期三场赛程</span><button type="button" class="home-text-button" data-league-tab="schedule">完整日程 ↗</button></div><div class="home-fixture-list">${games}</div><div class="home-brief-divider"></div><div class="home-subhead"><span>球队近况与简报</span><button type="button" class="home-text-button" data-league-tab="inbox">俱乐部收件箱 ↗</button></div>${best?`<div class="home-player">${player?`<div class="yffm-card-slot size-s">${card(player,{interactive:false})}</div>`:''}<div><b>${e(best.name)}</b><p>本队最佳表现 · 场均评分 <span class="yffm-num">${number(best.averageRating,2)}</span></p></div></div>`:''}<ul class="home-brief-list">${headlines.map(t=>`<li>${e(t)}</li>`).join('')||'<li>俱乐部动态将在比赛与经营结算后更新</li>'}</ul></div></details>`;

  return `<div class="club-home club-home-v2" data-home-state="${state}">
    <section class="home-match-hero is-broadcast-v2">${hero}</section>
    <div class="home-main-grid">${standings}<div class="home-side-column">${todos}${playerSearch}</div></div>
    <div class="home-bottom-grid is-dual">${recentPanel}${scheduleBriefPanel}</div>
    <details class="home-archive home-panel" data-preserve-open="home-tools" open><summary>赛果档案</summary><div class="home-detail-body" data-home-tools><button type="button" class="home-text-button" data-league-tab="club-history" data-history-start="matches">查看本队完整队史 ↗</button>${archive}</div></details>
  </div>`;
}

export function clubHomeStatsMarkup(detail,escape,state='idle') {
  const teams=detail?.report?.teams??detail?.teams??[], stats=teams.map(t=>t.stats??{});
  const possession=stats.map(s=>s.possession), total=possession.reduce((a,n)=>a+(finite(n)?Number(n):0),0);
  const known=possession.length===2 && possession.every(finite) && total>0;
  const left=known?Math.round(Number(possession[0])/total*100):null;
  const goals=(detail?.importantEvents??detail?.report?.events??[]).filter(e=>e.type==='goal'||e.type==='penaltyGoal'||e.type==='ownGoal').slice(0,4);
  const players=teams.flatMap(t=>t.players??[]).filter(p=>finite(p.rating)).sort((a,b)=>Number(b.rating)-Number(a.rating));
  return `<div class="home-stat-line"><b>${known?left+'%':'—'}</b><span>控球率${known?'':' · 未记录'}</span><b>${known?(100-left)+'%':'—'}</b></div><div class="home-possession" aria-hidden="true">${known?`<i style="width:${left}%"></i><i style="width:${100-left}%"></i>`:''}</div><div class="home-stat-line"><b>${number(stats[0]?.xg,2)}</b><span>xG <em class="yffm-estimate">估算</em></span><b>${number(stats[1]?.xg,2)}</b></div>${!stats.length?`<p class="home-muted">${state==='loading'?'正在读取比赛统计…':state==='error'?'统计暂时无法读取，请打开比赛记录重试':'— 未记录'}</p>`:''}${goals.length?`<ul class="home-goals">${goals.map(event => `<li><time>${broadcastMinuteLabel(event.minute)}′</time><span>${escape(event.text ?? "")}</span></li>`).join("")}</ul>`:''}${players.length?`<p class="home-mvp">本场最佳 · ${escape(players[0].name??'')} <b>${number(players[0].rating,1)}</b></p>`:''}`;
}
