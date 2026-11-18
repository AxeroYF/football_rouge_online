const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const format = (value, digits = 0) => value === null ? '— 未记录' : value.toFixed(digits);
const SHOTS = new Set(['shot','goal','save','miss','block']);

// Rebuild from the authoritative event history, so joining and reconnecting do
// not create invented samples. Saves and blocks belong to the attacking team.
export function broadcastShotSeries(match) {
  const seen = new Set(), shots = [[], []];
  for (const event of match.events ?? []) {
    if (!SHOTS.has(event.type) || number(event.xg) === null || number(event.minute) === null) continue;
    if (event.id != null && seen.has(event.id)) continue;
    if (event.id != null) seen.add(event.id);
    const side = [0,1].includes(event.attackingTeamIndex) ? event.attackingTeamIndex
      : [0,1].includes(event.teamIndex) ? (['save','block'].includes(event.type) ? 1 - event.teamIndex : event.teamIndex) : null;
    if (side !== null) shots[side].push({minute:event.minute,xg:event.xg,goal:event.type === 'goal'||event.goal===true,text:event.text ?? ''});
  }
  shots.forEach(list => list.sort((a,b) => a.minute-b.minute));
  const totals = shots.map(list => list.reduce((sum, shot) => sum + shot.xg, 0));
  const complete = shots.every((list,side) => {
    const stats = match.teams?.[side]?.stats ?? {};
    return number(stats.shots) === list.length && number(stats.xg) !== null && Math.abs(stats.xg-totals[side]) <= .025;
  });
  const end = Math.max(number(match.minute) ?? 0,...shots.flat().map(shot => shot.minute));
  return {shots,totals,complete,end,horizon:Math.max(90,Math.ceil(end/15)*15)};
}

export function broadcastDataModel(match) {
  const stats = [0,1].map(side => match.teams?.[side]?.stats ?? {});
  const pair = key => stats.map(value => number(value[key]));
  const possession = pair('possession'), total = possession[0] + possession[1];
  const possessionShare = possession.every(value => value !== null) && total > 0 ? Math.round(possession[0]/total*100) : null;
  return {pair,possession:possessionShare === null ? [null,null] : [possessionShare,100-possessionShare],series:broadcastShotSeries(match)};
}

function comparison(label, values, digits = 0, suffix = '') {
  const total = values[0] + values[1];
  const widths = values.map(value => values.every(item => item !== null) && total > 0 ? value/total*100 : 0);
  return `<div class="broadcast-data-row"><div><b>${format(values[0],digits)}${values[0] === null ? '' : suffix}</b><span>${label}</span><b>${format(values[1],digits)}${values[1] === null ? '' : suffix}</b></div><div class="broadcast-data-track" aria-hidden="true"><i style="width:${widths[0]}%"></i><i style="width:${widths[1]}%"></i></div></div>`;
}

function overview(model) {
  return `<div class="broadcast-data-possession">${comparison('控球率',model.possession,0,'%')}</div><div class="broadcast-data-kpis">${[['射门','shots',0],['射正','shotsOnTarget',0],['期望进球 xG <em class="yffm-estimate">估算</em>','xg',2]].map(([label,key,digits])=>`<article><small>${label}</small><div><b>${format(model.pair(key)[0],digits)}</b><span>:</span><b>${format(model.pair(key)[1],digits)}</b></div></article>`).join('')}</div>${[['角球','corners'],['扑救','saves'],['犯规','fouls'],['黄牌','yellowCards'],['红牌','redCards']].map(([label,key])=>comparison(label,model.pair(key))).join('')}`;
}

function trends(model, names) {
  const {shots,totals,complete,end,horizon} = model.series;
  if (!complete) return '<div class="broadcast-data-empty">本场缺少完整射门记录，暂不绘制走势。<small>总览仍显示比赛统计。</small></div>';
  const ceiling = Math.max(1,Math.ceil(Math.max(...totals)*2)/2);
  const x = minute => 34 + minute/horizon*332, y = value => 140-value/ceiling*114;
  const paths = shots.map((list,side) => {
    let sum = 0, d = `M34 140`;
    const markers = list.map(shot => {
      sum += shot.xg; d += ` L${x(shot.minute).toFixed(2)} ${y(sum).toFixed(2)}`;
      return `<circle class="data-side-${side}${shot.goal ? ' is-goal' : ''}" cx="${x(shot.minute).toFixed(2)}" cy="${y(sum).toFixed(2)}" r="${shot.goal ? 4.5 : 2.5}" tabindex="0"><title>${escape(names[side])} · ${shot.minute}′ · ${shot.goal ? '进球 · ' : ''}xG ${shot.xg.toFixed(2)} · ${escape(shot.text)}</title></circle>`;
    }).join('');
    d += ` L${x(end).toFixed(2)} ${y(sum).toFixed(2)}`;
    return `<path class="data-side-${side}" d="${d}"/>${markers}`;
  });
  const grid = [0,.5,1].map(f => `<line x1="34" x2="366" y1="${y(ceiling*f)}" y2="${y(ceiling*f)}"/><text x="27" y="${y(ceiling*f)+4}" text-anchor="end">${(ceiling*f).toFixed(1)}</text>`).join('');
  const axis = [0,horizon/2,horizon].map(minute=>`<text x="${x(minute)}" y="160" text-anchor="middle">${minute}′</text>`).join('');
  const buckets = Array.from({length:horizon/15},(_,i)=>shots.map(list=>list.filter(shot=>shot.minute > i*15 && shot.minute <= (i+1)*15 || i === 0 && shot.minute === 0).length));
  const maximum = Math.max(1,...buckets.flat());
  return `<section class="broadcast-data-chart"><header><b>累计 xG <em class="yffm-estimate">估算</em></b><small>● 进球节点</small></header><svg viewBox="0 0 390 170" role="img" aria-label="双方累计预期进球曲线"><title>${escape(names[0])} ${totals[0].toFixed(2)}，${escape(names[1])} ${totals[1].toFixed(2)}。大圆点表示进球。</title><g class="broadcast-chart-grid">${grid}${axis}</g>${paths.join('')}</svg>${shots.flat().length ? '' : '<p class="broadcast-chart-note">尚未产生射门</p>'}</section><section class="broadcast-data-chart"><header><b>射门分布</b><small>每 15 分钟</small></header><div class="broadcast-shot-buckets" style="--bucket-count:${buckets.length}">${buckets.map((counts,i)=>`<div class="broadcast-shot-bucket" aria-label="${i*15}至${(i+1)*15}分钟，${escape(names[0])}${counts[0]}次，${escape(names[1])}${counts[1]}次"><div>${counts.map((count,side)=>`<span><b>${count}</b><i class="data-side-${side}" style="height:${count/maximum*46}px"></i></span>`).join('')}</div><small>${i*15}–${(i+1)*15}′</small></div>`).join('')}</div></section>`;
}

function details(model, v4 = false) {
  const groups = [
    ['进攻来源',[['正常控球回合','normalPossessions',0],['转换控球回合','transitionPossessions',0],['非转换射门','normalShots',0],['转换射门','transitionShots',0],['非转换 xG（估算）','normalXg',2],['转换 xG（估算）','transitionXg',2]]],
    ['防守与纪律',[['抢断','tackles',0],['拦截','interceptions',0],['封堵','blocks',0],['解围','clearances',0],['压迫夺回','pressuresWon',0],['换人','substitutions',0]]],
  ];
  if(v4)groups[0]=['传球与射门',[['传球','passes',0],['传球成功','completed',0],['射门','shots',0],['射正','shotsOnTarget',0],['期望进球 xG <em class="yffm-estimate">估算</em>','xg',2]]];
  return groups.map(([title,rows])=>`<section class="broadcast-data-detail"><h3>${title}</h3>${rows.filter(([,key])=>model.pair(key).some(value=>value!==null)).map(([label,key,digits])=>comparison(label,model.pair(key),digits)).join('')}</section>`).join('');
}

export function broadcastDataMarkup(match, selected = 'overview') {
  const tabs = {overview:'总览',trends:'走势',details:'攻防'}, tab = Object.hasOwn(tabs,selected) ? selected : 'overview';
  const names = [0,1].map(side=>match.teams?.[side]?.name ?? `球队 ${side+1}`), model = broadcastDataModel(match);
  return `<section class="broadcast-v2-data-panel broadcast-data"><header><h2>比赛数据</h2><div class="broadcast-data-tabs" role="tablist" aria-label="比赛数据视图">${Object.entries(tabs).map(([key,label])=>`<button type="button" role="tab" id="broadcast-data-tab-${key}" data-broadcast-data-tab="${key}" aria-selected="${tab === key}" aria-controls="broadcast-data-content" tabindex="${tab === key ? 0 : -1}">${label}</button>`).join('')}</div></header><div class="broadcast-data-legend">${names.map((name,side)=>`<span class="data-side-${side}" title="${escape(name)}"><i></i>${escape(name)}</span>`).join('')}</div><div class="broadcast-data-body" id="broadcast-data-content" role="tabpanel" aria-labelledby="broadcast-data-tab-${tab}" tabindex="0">${match.metricDefinitions?.model ? `<small class="broadcast-chart-note" title="${escape(match.metricDefinitions.xg)}">xG 为射门质量估算</small>` : ""}${tab === 'overview' ? overview(model) : tab === 'trends' ? trends(model,names) : details(model,match.engineProfile==='v4-spatial')}</div></section>`;
}
