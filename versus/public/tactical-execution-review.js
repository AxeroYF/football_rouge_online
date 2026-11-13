const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const zoneName=value=>String(value).replace('defensiveThird','后场').replace('buildUp','中后场').replace('finalThird','前场').replace('box','禁区').replace('farLeft','左边路').replace('leftHalfSpace','左肋').replace('rightHalfSpace','右肋').replace('farRight','右边路').replace('center','中路').replace(':','·');
export function tacticalExecutionReviewMarkup(summary) {
  if(!summary?.teams?.length)return '';
  return `<section class="report-panel tactical-execution-review"><h2>战术执行复盘</h2><div class="tactical-execution-review-grid">${summary.teams.map(team=>{
    const zones=Object.entries(team.blockedZones??{}).sort((a,b)=>b[1]-a[1]).slice(0,3);
    return `<article><h3>${escape(team.name)}</h3><dl><dt>触发压迫</dt><dd>${team.press.attempts} 次 · 随后夺回 ${team.press.recoveries} 次</dd><dt>压迫参与负荷</dt><dd>${team.press.playerSeconds} 人秒</dd><dt>重点盯防</dt><dd>${team.mark.actions} 次 · 随后夺回 ${team.mark.turnovers} 次</dd><dt>指定出球与受压调整</dt><dd>${team.build.attempts} 次 · 完成 ${team.build.successes} 次 · 备用路线 ${team.build.escape} 次</dd><dt>角球套路</dt><dd>${team.corners.attempts} 次 · 形成射门 ${team.corners.shots} 次 · 二点夺回 ${team.corners.secondBalls} 次</dd><dt>条件轮换</dt><dd>${team.rotations} 人</dd></dl><p>球权丢失较多区域：${zones.length?zones.map(([zone,count])=>`${escape(zoneName(zone))} ${count}次`).join('；'):'无记录'}</p></article>`;
  }).join('')}</div><p>按实际行动累计，同一次行动可涉及多个战术；记录先后关系，不将一次进球或失误归因于单一指令。人秒为参与人数乘以行动时间。</p></section>`;
}
