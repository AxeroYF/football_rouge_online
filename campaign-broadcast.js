import { CHALLENGE_SECOND_LEG_COOLDOWN_MS } from "./shared/config/challenge.mjs";
import { PLAY_STYLE_LABELS as STYLES, ROLE_LABELS, TACTIC_LABELS as TACTICS } from "./shared/football/labels.js";
import {
  activateStandardWindow,
  deactivateStandardWindow,
  registerStandardWindow,
} from "./client/ui/standard-window.js";

const EVENT_MARKS = { kickoff:"开",duel:"对抗",attack:"推进",counter:"反击",save:"扑救",miss:"射门",block:"封堵",tackle:"抢断",interception:"拦截",goal:"进球",butterFingers:"黄油手",ownGoal:"乌龙球",superWorldie:"超级世界波",foul:"犯规",yellow:"黄牌",red:"红牌",injury:"伤退",substitution:"换人",lightning:"雷击",weather:"天气",blackWhistle:"争议判罚",corner:"角球",setPiece:"定位球",setPieceDuel:"争顶",clearance:"解围",penaltyAwarded:"点球",halftime:"半场",extraTimeStart:"加时",extraTimeHalfTime:"加时半场",extraTimeEnd:"加时结束",penaltyShootoutStart:"点球大战",penaltyShootoutEqualise:"人数调整",penaltyShootoutKick:"点球主罚",penalties:"点球结束",tactical:"战术",penalty:"点球",shootout:"点球大战",fulltime:"结束",abandoned:"终止" };
const EVENT_ICONS = { goal:"⚽",butterFingers:"🧤",ownGoal:"↩",superWorldie:"★",yellow:"■",red:"■",injury:"✚",substitution:"↔",lightning:"ϟ",weather:"≈",blackWhistle:"⚖",penaltyAwarded:"P",penalty:"P",shootout:"P",penaltyShootoutStart:"P",penaltyShootoutEqualise:"↔",penaltyShootoutKick:"P",penalties:"■",save:"◆",block:"◆",tackle:"◆",interception:"◆",setPiece:"◆",setPieceDuel:"◆",clearance:"◇",corner:"◇",miss:"○",tactical:"↔",halftime:"Ⅱ",extraTimeStart:"Ⅱ",extraTimeHalfTime:"Ⅱ",extraTimeEnd:"Ⅱ",fulltime:"■",abandoned:"!" };
export const SECOND_LEG_COOLDOWN_MS = CHALLENGE_SECOND_LEG_COOLDOWN_MS;

const escapeHtml = (value) => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
const weatherProfile = (environment = {}) => ({ key:environment.weather ?? environment.key ?? "sunny", name:{sunny:"晴朗",rain:"雨天",storm:"雷暴",snow:"雪天",superStorm:"超级雷暴"}[environment.weather ?? environment.key] ?? "晴朗" });
const weatherIcon = (weather) => ({ sunny:"☀️",rain:"🌧️",storm:"⛈️",snow:"🌨️",superStorm:"⚡" }[weather?.key] ?? "🌤️");
const fieldRoleAbbreviation = (role) => ROLE_LABELS[role] ?? role ?? "球员";

function liveStatusMarkers(player) {
  const stats = player.matchStats ?? player.stats ?? {};
  const marker = (type, symbol, count, label) => count > 0 ? `<span class="live-status-marker status-${type}" title="${label}">${symbol}${count > 1 ? `<em>${count}</em>` : ""}</span>` : "";
  return `<span class="live-status-markers">${[
    marker("goal","⚽",Number(stats.goals ?? 0),"进球"), marker("assist","👟",Number(stats.assists ?? 0),"助攻"),
    marker("yellow","",Number(stats.yellowCards ?? 0),"黄牌"), marker("red","",Math.max(Number(stats.redCards ?? 0),player.sentOff ? 1 : 0),"红牌"),
    marker("injury","+",player.injury ? 1 : 0,"受伤"),
  ].join("")}</span>`;
}

function broadcastMagnet(player) {
  const assignedRole = player.assignedRole ?? player.role;
  const position = player.position ?? { x:50, y:50 };
  const status = player.sentOff ? "红牌" : player.injury ? "伤退" : "";
  const fitness = clamp(Math.round(player.fitness ?? 100),0,100);
  const upgrade = Number(player.upgradeLevel ?? 0);
  const tooltip = `${player.name}\n${fieldRoleAbbreviation(assignedRole)} · 总评 ${Math.round(player.overall ?? 0)} · 评分 ${Number(player.rating ?? 0).toFixed(1)} · 体力 ${fitness}`;
  const captain = player.captain && player.active ? `<span class="league-captain-badge">C</span>` : "";
  const side = Number.isInteger(player.broadcastTeamIndex) ? ` broadcast-side-${player.broadcastTeamIndex}` : "";
  return `<button type="button" class="magnet live-magnet league-squad-magnet s4-broadcast-magnet${side} grade-${String(player.grade ?? "C").toLowerCase()} fit-primary ${status ? "inactive unavailable" : ""}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${position.x}%;top:${position.y}%" disabled>${captain}${liveStatusMarkers(player)}<span class="league-magnet-role">${escapeHtml(fieldRoleAbbreviation(assignedRole))}</span><b>${escapeHtml(player.name)}</b><i>${Math.round(player.overall ?? 0)}</i><span class="league-magnet-fitness" aria-label="体力 ${fitness}"><span style="width:${fitness}%"></span></span><span class="s4-broadcast-rating">评分 ${Number(player.rating ?? 0).toFixed(1)}</span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8,upgrade)}">+${upgrade}</em>` : ""}</button>`;
}

function pitchMarkup(content) {
  return `<div class="pitch broadcast-v2-pitch broadcast-pitch s4-readonly-pitch"><div class="pitch-lines"><span class="pitch-halfway"></span><span class="pitch-center-circle"></span><span class="pitch-center-mark"></span><span class="pitch-penalty-box pitch-penalty-box-top"></span><span class="pitch-goal-box pitch-goal-box-top"></span><span class="pitch-penalty-arc pitch-penalty-arc-top"></span><span class="pitch-penalty-mark pitch-penalty-mark-top"></span><span class="pitch-penalty-box pitch-penalty-box-bottom"></span><span class="pitch-goal-box pitch-goal-box-bottom"></span><span class="pitch-penalty-arc pitch-penalty-arc-bottom"></span><span class="pitch-penalty-mark pitch-penalty-mark-bottom"></span></div><span class="zone-label att">前场</span><span class="zone-label mid">中场</span><span class="zone-label def">后场</span><span class="zone-label gk">门将</span>${content}</div>`;
}

function combinedPosition(position = { x:50,y:50 }, teamIndex = 0) {
  const x = clamp(position.x,4,96); const y = clamp(position.y,4,96);
  return teamIndex === 0 ? { x,y:50+y*.5 } : { x:100-x,y:50-y*.5 };
}

function combinedPitchMarkup(teams) {
  const magnets = teams.flatMap((team,teamIndex)=>(team.players??[]).filter((player)=>player.active||player.sentOff||player.injury).map((player)=>broadcastMagnet({ ...player,position:combinedPosition(player.position,teamIndex),broadcastTeamIndex:teamIndex }))).join("");
  const labels = `<span class="broadcast-v2-half-label away">${escapeHtml(teams[1].name)} · ${escapeHtml(teams[1].formation)}</span><span class="broadcast-v2-half-label home">${escapeHtml(teams[0].name)} · ${escapeHtml(teams[0].formation)}</span>`;
  return pitchMarkup(`${labels}${magnets}`);
}

function matchEventMarkup(entry) {
  return `<details class="match-event event-${escapeHtml(entry.type)} importance-${escapeHtml(entry.importance ?? "normal")}" ${entry.importance === "major" ? "open" : ""}><summary><b>${Math.ceil(Number(entry.minute ?? 0))}'</b><span class="event-icon" aria-hidden="true">${EVENT_ICONS[entry.type] ?? "•"}</span><i>${EVENT_MARKS[entry.type] ?? "动态"}</i><span>${escapeHtml(entry.text ?? "比赛事件")}${entry.assistId ? `<mark class="assist-mark">助攻</mark>` : ""}</span></summary>${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}${Number.isFinite(Number(entry.xg)) ? `<small>xG ${Number(entry.xg).toFixed(2)}</small>` : ""}</details>`;
}

function matchStatsMarkup(match) {
  const [left,right] = match.teams.map((team)=>team.stats ?? {});
  const possessionTotal = Number(left.possession ?? 0)+Number(right.possession ?? 0)||1;
  const rows = [["控球",`${Math.round(Number(left.possession??0)/possessionTotal*100)}%`,`${Math.round(Number(right.possession??0)/possessionTotal*100)}%`],["射门",left.shots??0,right.shots??0],["射正",left.shotsOnTarget??0,right.shotsOnTarget??0],["xG",Number(left.xg??0).toFixed(2),Number(right.xg??0).toFixed(2)],["犯规",left.fouls??0,right.fouls??0],["红牌",left.redCards??0,right.redCards??0]];
  return `<div class="live-stats">${rows.map(([label,a,b])=>`<div><b>${a}</b><span>${label}</span><b>${b}</b></div>`).join("")}</div>`;
}

function phaseLabel(match) {
  if (match.phase === "finished") return "比赛结束";
  if (match.segment === "penalties") return "点球大战";
  if (match.segment === "extra") return "加时赛";
  return match.minute <= 45 ? "上半场" : "下半场";
}

function strategiesMarkup(teams) {
  return `<footer class="broadcast-v2-team-strategies">${teams.map((team)=>`<div><i></i><span><b>${escapeHtml(team.name)}</b><small>${escapeHtml(TACTICS[team.tactic]??team.tactic)} · ${escapeHtml(STYLES[team.style]??team.style)} · ${escapeHtml(team.formation)} · 适配 ${Math.round(Number(team.tacticalFit??100))}%</small></span></div>`).join("")}</footer>`;
}

function dockBroadcastTeamStrategies(root) {
  const source = root?.querySelector?.(".broadcast-v2-field-column>.broadcast-v2-team-strategies");
  const heading = root?.querySelector?.(".broadcast-v2-commentary>header>h2");
  if (!source || !heading) return;
  const dock = document.createElement("div");
  dock.className = source.className;
  dock.innerHTML = source.innerHTML;
  heading.after(dock);
  source.remove();
}

function captureEventFeedScroll(root) {
  const feed = root?.querySelector?.(".event-feed");
  if (!feed) return null;
  return { scrollTop:feed.scrollTop,scrollHeight:feed.scrollHeight,followingLatest:feed.scrollTop<=12 };
}

function restoreEventFeedScroll(root, snapshot) {
  if (!snapshot) return;
  const feed = root?.querySelector?.(".event-feed");
  if (!feed) return;
  feed.scrollTop = snapshot.followingLatest ? 0 : snapshot.scrollTop + Math.max(0,feed.scrollHeight-snapshot.scrollHeight);
}

function matchLayoutMarkup(match) {
  const latest = match.events.at(-1);
  const latestIcon = latest ? EVENT_ICONS[latest.type] ?? "•" : "";
  const weather = match.weather;
  const feed = match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`;
  return `<div class="broadcast-v2-layout"><section class="broadcast-v2-field-column stand-none"><header class="broadcast-v2-venue-head"><div><small>HOME STADIUM</small><h2>${escapeHtml(match.teams[0].name)} 主场</h2></div><span>${weatherIcon(weather)} ${escapeHtml(weather.name)} · ${match.phase === "finished" ? "最终比赛阵型" : "实时比赛阵型"}</span></header><div class="broadcast-v2-stadium pitch-striped">${combinedPitchMarkup(match.teams)}</div>${strategiesMarkup(match.teams)}</section><aside class="broadcast-v2-sidebar"><section class="commentary-panel match-center-panel broadcast-v2-commentary"><header><h2>${match.phase === "finished" ? "比赛详情" : "实时战况"}</h2><span>${match.events.length}</span></header>${latest ? `<div class="latest-event event-${escapeHtml(latest.type)}"><i>${latestIcon}</i><b>${Math.ceil(Number(latest.minute??0))}'</b><span>${escapeHtml(latest.text??"比赛事件")}</span></div>` : ""}<div class="event-feed">${feed}</div></section><section class="broadcast-v2-data-panel"><header><div><small>MATCH DATA</small><h2>比赛数据</h2></div><span>${escapeHtml(match.teams[0].name)} / ${escapeHtml(match.teams[1].name)}</span></header>${matchStatsMarkup(match)}</section></aside></div>`;
}

function screenMarkup(broadcast) {
  const { match } = broadcast;
  const center = match.segment === "penalties" ? `${match.penalties?.[0]??0}:${match.penalties?.[1]??0}` : `${match.minute}'`;
  return `<div class="broadcast-v2-content"><section class="broadcast-screen"><header class="broadcast-toolbar"><button class="button secondary" data-leave-broadcast>${broadcast.actionLabel}</button><div><i>${broadcast.live ? "LIVE" : "FT"}</i><b>黄狗风云比赛电视台</b><small>地块争夺赛 · 第 ${broadcast.legNumber} 回合${broadcast.live ? "" : " · 回合结束"}</small>${broadcast.live ? "" : `<em class="broadcast-toolbar-result">最终详情 · ${escapeHtml(match.teams[0].name)} ${match.score[0]} : ${match.score[1]} ${escapeHtml(match.teams[1].name)}</em>`}</div><span><b>S4 V2.1 ENGINE</b><small>服务器实时转播</small></span></header><section class="match-shell broadcast-match-shell"><header class="scoreboard"><div><small>${escapeHtml(match.teams[0].name)}</small><b>${match.score[0]}</b><em>${match.teams[0].activeCount} 人 · ${escapeHtml(match.teams[0].formation)}</em></div><span><small>${phaseLabel(match)}</small><strong>${center}</strong><em>${weatherIcon(match.weather)} ${escapeHtml(match.weather.name)}</em></span><div><small>${escapeHtml(match.teams[1].name)}</small><b>${match.score[1]}</b><em>${match.teams[1].activeCount} 人 · ${escapeHtml(match.teams[1].formation)}</em></div></header>${matchLayoutMarkup(match)}</section></section></div>`;
}

function liveMatch(broadcast) {
  const latest=broadcast?.events?.at(-1);
  const minute=Math.ceil(Number(broadcast?.minute ?? latest?.minute ?? 0));
  const shootout=Boolean(broadcast?.penalties)||["penaltyShootoutStart","penaltyShootoutEqualise","penaltyShootoutKick","penalties"].includes(latest?.type);
  return {
    minute,
    score:[...(broadcast?.score ?? [0,0])],
    phase:broadcast?.finished?"finished":"playing",
    segment:shootout?"penalties":minute>90?"extra":"regular",
    penalties:broadcast?.penalties ?? null,
    weather:weatherProfile(broadcast?.environment),
    events:broadcast?.events ?? [],
    teams:(broadcast?.teams ?? []).map((team)=>({ ...team,activeCount:team.activeCount??team.players?.filter((player)=>player.active).length??0 })),
  };
}

export const CAMPAIGN_LIVE_POLL_MS = 1000;

// Kept for callers from older bundles. Live density no longer depends on the
// final event count; snapshots now arrive at the same fixed cadence as S4.
export function campaignPlaybackTickMs() {
  return CAMPAIGN_LIVE_POLL_MS;
}

export function showCampaignBroadcast(controller, { onClose } = {}) {
  const overlay=document.querySelector("#campaign-broadcast");
  if (!controller?.snapshot?.live?.broadcast) { onClose?.(); return; }
  const close=()=>{
    if (controller.renderOverlay===render) controller.renderOverlay=null;
    overlay.hidden=true;
    deactivateStandardWindow(overlay);
    overlay.replaceChildren();
    controller.opened=false;
    onClose?.();
  };
  registerStandardWindow(overlay,{onRequestClose:close});
  const render=({reset=false}={})=>{
    const broadcast=controller.snapshot?.live?.broadcast;
    if (!broadcast) { close(); return; }
    if (reset) overlay.replaceChildren();
    const feedScroll=reset ? null : captureEventFeedScroll(overlay);
    const legNumber=Number(controller.snapshot.live.legNumber ?? broadcast.legNumber ?? 1);
    overlay.hidden=false;
    overlay.innerHTML=screenMarkup({match:liveMatch(broadcast),live:!broadcast.finished,legNumber,actionLabel:"退出观赛"});
    dockBroadcastTeamStrategies(overlay);
    restoreEventFeedScroll(overlay,feedScroll);
    overlay.querySelector("[data-leave-broadcast]").onclick=close;
  };
  controller.renderOverlay=render;
  activateStandardWindow(overlay);
  render();
}

export function startCampaignBroadcastBackground(initialSnapshot, { fetchSnapshot, onOpen, onFinish, onUpdate } = {}) {
  if (!initialSnapshot?.challenge?.id || !initialSnapshot?.live?.broadcast) return null;
  const widget=document.querySelector("#campaign-live-widget");
  const state={
    snapshot:initialSnapshot,
    opened:false,
    finishedNotified:false,
    polling:false,
    timer:null,
    renderOverlay:null,
    liveKey:initialSnapshot.live.key ?? `leg-${initialSnapshot.live.legNumber}`,
    pendingLegReset:false,
  };
  const update=()=>{
    const snapshot=state.snapshot;
    const broadcast=snapshot?.live?.broadcast;
    if (snapshot?.completed) {
      if (widget) { widget.hidden=true; widget.replaceChildren(); }
      state.renderOverlay?.();
      onUpdate?.(state);
      if (!state.finishedNotified) {
        state.finishedNotified=true;
        clearInterval(state.timer);
        onFinish?.(snapshot,state);
      }
      return;
    }
    if (!broadcast) return;
    const match=liveMatch(broadcast);
    const phase=snapshot.challenge?.phase ?? snapshot.live?.phase;
    const remaining=Math.max(0,Number(snapshot.challenge?.secondLegStartsAt ?? 0)-Date.now());
    const status=phase==="intermission"?"首回合结束":broadcast.finished?"回合结束":"LIVE · 服务器实时比赛";
    const timing=phase==="intermission"
      ? "整备 "+Math.ceil(remaining/1000)+" 秒"
      : Math.ceil(Number(match.minute??0))+"\' · 第 "+Number(snapshot.live.legNumber??1)+" 回合";
    if (widget) {
      widget.hidden=false;
      widget.innerHTML=`<button type="button" class="campaign-live-card"><span class="campaign-live-kicker">${status}</span><strong>${escapeHtml(match.teams?.[0]?.name??"我方")} <b>${match.score[0]} : ${match.score[1]}</b> ${escapeHtml(match.teams?.[1]?.name??"守军")}</strong><small>${timing}</small></button>`;
      widget.querySelector("button").onclick=()=>{state.opened=true;onOpen?.(state);};
    }
    state.renderOverlay?.({reset:state.pendingLegReset});
    state.pendingLegReset=false;
    onUpdate?.(state);
  };
  const refresh=async()=>{
    if (state.polling||state.finishedNotified) return;
    state.polling=true;
    try {
      const next=await fetchSnapshot?.();
      if (next) {
        const nextKey=next.live?.key ?? (next.live ? `leg-${next.live.legNumber}` : null);
        state.pendingLegReset=Boolean(nextKey && state.liveKey && nextKey!==state.liveKey);
        state.liveKey=nextKey ?? state.liveKey;
        state.snapshot=next;
      }
      update();
    } catch {
      // A transient polling failure leaves the last verified server snapshot on screen.
    } finally {
      state.polling=false;
    }
  };
  state.stop=()=>{
    clearInterval(state.timer);
    if (widget) { widget.hidden=true; widget.replaceChildren(); }
    state.renderOverlay=null;
  };
  state.timer=setInterval(refresh,CAMPAIGN_LIVE_POLL_MS);
  update();
  return state;
}
