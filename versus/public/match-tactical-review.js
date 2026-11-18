const plans={normal:'默认预案',leading:'领先预案',trailing:'落后预案'};
const periods=['上半场','下半场','加时上半场','加时下半场'];
const issues={noOutlet:'缺少短传点',fewAngles:'接应角度不足',noScreen:'上抢无人封线',lateScreen:'封线距离过远',
  noCover:'套上无人补位',lateCover:'补位距离过远',forcedRegroup:'反抢转为回收',isolatedPress:'反抢缺少支援',fewBehind:'球后保护不足'};
const advice={
  noOutlet:'把最近的同侧中场移到持球人斜后方 22 米内，给他一条绕开对手的回传路线。',
  fewAngles:'保留一个近接应点，把第二名队友移向另一侧，让两条短传线在持球人处错开至少 30°。',
  noScreen:'在上抢球员身后留一名中场，把「压迫分工」调为「优先封锁传球线」，再检查是否出现配对的封线任务。',
  lateScreen:'把负责封线的球员移近对手内侧接应线，重新预览他上抢配合时能否进入传球线 4 米内。',
  noCover:'让同侧后腰留在前插边卫内侧提供保护，或将另一侧边卫改为留守，检查套上时能否配对补位。',
  lateCover:'把补位中场的起点移近前插边卫身后的通道，检查他与保护目标的距离能否缩到 8 米内。',
  forcedRegroup:'把一名中场移近丢球侧，争取在球周围 16 米内留两名外场球员。若希望全队回防，可将「丢球应对」设为「立即回撤」。',
  isolatedPress:'把第二名支援球员移近第一上抢者，检查丢球后 16 米内是否有两人参与反抢。',
  fewBehind:'减少一侧边卫的前插，让后腰留在球后，检查回收时球与本方底线之间能否保留三名外场球员。',
};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mmss=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const stamp=c=>c.added===undefined?mmss(c.seconds):mmss(c.seconds-c.added)+'+'+mmss(c.added);
const clock=c=>`${periods[c.period-1]??''} ${stamp(c)}`;

const examples=item=>[item.evidence,...(item.moreEvidence??[])];
export function resolveReviewEvidence(review,params){
  const mode=params.get('plan'),issue=params.get('issue'),plan=review?.plans?.[mode];
  if(!Object.hasOwn(plans,mode)||!Object.hasOwn(advice,issue)||!plan)return null;
  for(const check of plan.checks){
    const records=[check,...plan.intervals.map(s=>s.checks?.[check.id])];
    for(const row of records){
      const occurrence=row?.occurrences?.[issue];
      const e=occurrence&&examples(occurrence).find(s=>s.playerKey===params.get('player')&&String(s.time)===params.get('t'));
      if(e)return {mode,planLabel:plans[mode],issue,label:issues[issue],checkId:check.id,advice:advice[issue],playerId:e.playerKey.replace(/^[01]:/,''),
        playerName:e.playerName,detail:e.detail,stamp:clock(e.clock),schemeId:review.lineupSchemeId,reportId:review.reportId};
    }
  }
  return null;
}
function replay(review,sample,mode,issue){
  if(!sample)return '';
  const params=new URLSearchParams({match:review.fixtureId,report:review.reportId,t:String(sample.time),player:sample.playerKey});
  if(issue){params.set('plan',mode);params.set('issue',issue);}
  const save=new URLSearchParams(globalThis.location?.search).get('save');
  if(save)params.set('save',save);
  const label=escape(clock(sample.clock));
  const adjust=issue?` <button type="button" class="button secondary" data-review-adjust="${escape(params)}">去战术板调整</button>`:'';
  return `<div class="tactical-evidence">${review.replayAvailable===false?label:`<a target="_blank" rel="noopener" href="/v4-preview/?${escape(params)}">回看 ${label}</a>`} · ${escape(sample.detail)}${adjust}</div>`;
}
function checkMarkup(review,mode,check,used,showPreview=true){
  const predicted=check.preview.issues;
  const actual=Object.entries(check.occurrences);
  const missing=predicted.filter(key=>!Object.hasOwn(check.occurrences,key));
  const observations=actual.map(([key,item])=>{
    const spans=showPreview?review.plans[mode].intervals.filter(s=>s.checks?.[check.id]?.occurrences?.[key]).length:1;
    const recurring=item.episodes>=2||spans>=2;
    const frequency=item.episodes?`${item.episodes} 个独立回合，`:spans>=2?`至少 ${spans} 个执行时段，`:'';
    const points=examples(item).map(s=>replay(review,s,mode,key));
    return `<li><strong>${predicted.includes(key)?'预警重现':'实战新发现'} · ${escape(issues[key])}</strong>（${frequency}${item.count} 个采样时点）
      ${recurring?`<p><b>反复出现 · 建议调整</b> ${escape(advice[key])}</p>`:''}${points[0]}${points.length>1?`<details><summary>其他回合证据</summary>${points.slice(1).join('')}</details>`:''}</li>`;
  }).join('');
  const verdict=!used?'本场未启用，无法对照。':!check.samples?'该时段没有可评估的场景。':
    `实战 ${check.samples} 个可评估时点，${check.flagged} 个出现问题。${missing.length?'本场样本未见'+missing.map(k=>issues[k]).join('、')+'。':''}`;
  return `<section class="match-tactical-check"><h5>${escape(check.label)}</h5>
    ${showPreview?`<p><b>赛前预览</b> ${escape(check.preview.detail)}${predicted.length?' 预警涉及'+escape(predicted.map(k=>issues[k]).join('、'))+'。':''}</p>`:''}
    <p><b>实战</b> ${escape(verdict)}</p>${observations?`<ul>${observations}</ul>`:replay(review,check.example)}</section>`;
}
export function matchTacticalReviewMarkup(review,unavailable=false){
  if(!review)return unavailable?`<section class="match-tactical-review"><h3>V4 战术复盘</h3><p>${unavailable==='unreadable'?'本场战术记录暂时无法读取或校验。':'本场没有保存可对照的战术评估记录。'}</p></section>`:'';
  return `<section class="match-tactical-review"><h3>V4 战术复盘</h3><p>赛前预览采用开赛时锁定的首发与预案。实战按本队实际切换时间分段，同一问题持续数秒可计入多个采样时点。</p>
    ${review.replayAvailable===false?'<p>本场录像已超出保留范围，仍可查看当时记录的位置与任务。</p>':''}
    ${Object.entries(plans).map(([mode,label])=>{
      const plan=review.plans[mode],used=plan.intervals.length>0;
      const spans=plan.intervals.map(i=>escape(clock(i.from))+'–'+escape(stamp(i.to))).join('，');
      const intervals=plan.intervals.length>1?plan.intervals.map(span=>{
        const rows=plan.checks.map(c=>checkMarkup(review,mode,{...c,samples:0,flagged:0,occurrences:{},example:null,...span.checks[c.id]},true,false)).join('');
        return `<details><summary>${escape(clock(span.from))}–${escape(stamp(span.to))} · 分段证据</summary><div class="match-tactical-grid">${rows}</div></details>`;
      }).join(''):'';
      return `<details ${mode==='normal'?'open':''}><summary>${label} · ${used?plan.intervals.length+' 段':'本场未启用'}</summary>
        ${used?`<p>执行时段　${spans}</p>`:''}<div class="match-tactical-grid">${plan.checks.map(c=>checkMarkup(review,mode,c,used)).join('')}</div>${intervals}</details>`;
    }).join('')}</section>`;
}
