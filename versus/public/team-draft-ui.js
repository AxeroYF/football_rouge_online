import {TEAM_DRAFT_FORMATIONS,TEAM_DRAFT_STYLES,TEAM_DRAFT_STAGES,TEAM_DRAFT_LIMIT} from './team-draft-config.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function draftPreferencesMarkup(preferences={}) {
  return `<div class="batch-preferences"><label class="field"><span>阵型</span><select name="formation">${Object.keys(TEAM_DRAFT_FORMATIONS).map(value=>`<option ${value===(preferences.formation??'4-3-3')?'selected':''}>${value}</option>`).join('')}</select></label><label class="field"><span>战术风格</span><select name="style">${Object.entries(TEAM_DRAFT_STYLES).map(([value,label])=>`<option value="${value}" ${value===(preferences.style??'balanced')?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
}

export function batchDraftMarkup(draft,{renderCard,roleLabels={},pending=false,preview=null,animate=false}={}) {
  const disabled=pending?'disabled':animate?'disabled data-batch-reveal-lock':'';
  if(draft.mode!=='batch') return `<section class="league-shell batch-draft"><header class="batch-header"><div><h1>建队选人</h1></div></header><form class="batch-legacy" id="batch-draft-preferences-form">${draftPreferencesMarkup()}<p>旧版未完成的选人进度将替换为新的整队建队流程。</p><button class="button primary" ${disabled}>开始整队建队</button></form></section>`;
  const attempt=draft.candidates.find(a=>a.number===preview)??draft.current;
  const isPreview=!!attempt&&attempt.number!==draft.current?.number;
  const preferences=attempt??draft.preferences, number=attempt?.number??draft.attemptsUsed+1;
  const revealed=attempt?.revealed??0, complete=!!attempt?.complete, remaining=draft.limit-draft.attemptsUsed;
  const slots=TEAM_DRAFT_FORMATIONS[preferences.formation];
  const stageFor=role=>['ST','LW','RW'].includes(role)?0:['GK','LB','CB','RB','LWB','RWB'].includes(role)?2:1;
  const counts=TEAM_DRAFT_STAGES.map((_,stage)=>slots.filter(([role])=>stageFor(role)===stage).length*2);
  const stepper=TEAM_DRAFT_STAGES.map((label,stage)=>`<div class="batch-step ${stage<revealed?'is-done':stage===revealed?'is-next':''}"><b>${stage<revealed?'✓':String(stage+1).padStart(2,'0')}</b><span>${label}<small>${counts[stage]} 人 · ${stage<revealed?'已揭晓':'等待揭晓'}</small></span></div>`).join('');
  const card=(player,index,newly=false)=>{
    const flipping=animate&&newly;
    const legendary=player.grade==='S'||player.grade==='X'||Boolean(player.legendary||player.legend);
    const highlight=flipping&&(legendary||Number(player.overall)>=85)?`<div class="batch-highlight ${legendary||Number(player.overall)>=90?'is-elite':'is-rare'}" aria-hidden="true">${Array.from({length:8},(_,i)=>`<i style="--spark:${i};left:${6+i%2*88}%;top:${12+Math.floor(i/2)*24}%"></i>`).join('')}</div>`:'';
    return `<article class="batch-player ${flipping?'is-revealing':''}" style="--batch-delay:${index*650}ms" aria-label="${escape(player.name)}，${player.overall}，${roleLabels[player.draftRole]??player.draftRole}${complete?`，${player.starter?'首发':'替补'}`:''}"><div class="batch-card-turn"><div class="batch-card-back" aria-hidden="true"><b>YF</b></div><div class="batch-card-front">${renderCard(player)}${highlight}</div></div><div class="batch-player-role"><span>${escape(roleLabels[player.draftRole]??player.draftRole)}</span>${complete?`<b class="${player.starter?'starter':''}">${player.starter?'首发':'替补'}</b>`:''}</div></article>`;
  };
  const groups=TEAM_DRAFT_STAGES.map((label,stage)=>{
    const players=(attempt?.players??[]).filter(p=>p.stage===stage);
    if(!players.length)return '';
    return `<section class="batch-group" data-batch-stage="${stage}"><header><h3>${label}</h3><span>${players.length} 人</span></header><div class="batch-cards">${players.map((p,i)=>card(p,i,stage===revealed-1&&!isPreview)).join('')}</div></section>`;
  });
  const action=complete?`<div class="batch-decision"><button class="button primary" data-league-finish="${number}" ${disabled}>确认这套阵容</button><button class="button secondary" data-batch-candidate="${number}" data-saved="${!attempt.candidate}" ${disabled}>${attempt.candidate?'移出候选':'☆ 加入候选'}</button>${!isPreview&&remaining>0?`<button class="button secondary" data-batch-reroll="${number}" ${disabled}>再开一套 · 余 ${remaining} 次</button>`:''}</div>`:`<button class="button primary batch-reveal" data-batch-reveal="${revealed}" data-attempt="${number}" ${disabled}>${pending?'正在集结…':`揭晓${TEAM_DRAFT_STAGES[revealed]}`} <span>${counts[revealed]} 人 →</span></button>`;
  const candidates=draft.candidates.map(c=>`<article class="batch-candidate ${attempt?.number===c.number?'is-selected':''}"><button data-batch-preview="${c.number}" ${disabled}><span>候选 ${String(c.number).padStart(2,'0')}<b>${c.averageOverall}<small>平均能力</small></b></span><strong>${c.formation} · ${TEAM_DRAFT_STYLES[c.style]}</strong><small>${c.players.filter(p=>p.starter).slice().sort((a,b)=>b.overall-a.overall).slice(0,3).map(p=>escape(p.name)).join(' / ')}</small></button></article>`).join('');
  const pitch=slots.map(([role,x,y])=>`<i style="left:${x}%;top:${y}%">${escape(roleLabels[role]??role)}</i>`).join('');
  return `<section class="league-shell batch-draft ${animate?'has-reveal-motion is-flipping':''} ${complete?'has-lineup':''}" aria-busy="${pending}">
    <header class="batch-header"><div><small>${escape(draft.teamName)}</small><h1>建队选人</h1></div><div class="batch-chances"><span>已用次数 <b>${draft.attemptsUsed} / ${TEAM_DRAFT_LIMIT}</b></span><div>${Array.from({length:TEAM_DRAFT_LIMIT},(_,i)=>`<i class="${i<draft.attemptsUsed?'used':''}" aria-hidden="true"></i>`).join('')}</div></div></header>
    <div class="batch-layout"><main class="batch-main"><div class="batch-stepper">${stepper}</div>
      <section class="batch-stage ${complete?'is-complete':''}"><div class="batch-stadium-lines" aria-hidden="true"></div><header class="batch-stage-head"><div><small>${isPreview?'候选':'阵容'} ${String(number).padStart(2,'0')}</small><h2>${complete?'阵容预览':revealed?TEAM_DRAFT_STAGES[revealed-1]:'待揭晓'}</h2><p>${preferences.formation} <span>·</span> ${TEAM_DRAFT_STYLES[preferences.style]} ${complete?`<span>·</span> 平均能力 ${attempt.averageOverall}`:''}</p></div><div class="batch-total" role="status" aria-live="polite"><b>${attempt?.players.length??0}</b><span>/ 22 人</span></div></header>
      ${isPreview?`<button class="batch-return" data-batch-preview="0" ${disabled}>← 返回当前建队进度</button>`:''}
      <div class="batch-actions">${action}</div>
      ${!revealed?`<div class="batch-ready"><div class="batch-pitch">${pitch}</div><span class="batch-ready-count">11 名首发 · 11 名替补</span></div>`:`<div class="batch-full-roster ${complete?'is-complete':'is-partial'}" style="--revealed-groups:${revealed}">${groups.join('')}</div>`}
      ${complete&&!isPreview&&(!attempt.candidate||!remaining)?`<p class="batch-stage-note">${remaining?'重开后，未加入候选的阵容将被丢弃。':'机会已用完，请确认当前阵容或候选。'}</p>`:''}</section>
      ${!draft.current&&!isPreview?`<form class="batch-edit-preferences" id="batch-draft-preferences-form">${draftPreferencesMarkup(draft.preferences)}<button class="button secondary" ${disabled}>更新建队偏好</button></form>`:''}</main>
      <aside class="batch-sidebar">${complete?draftLineupBoardMarkup(attempt,roleLabels):''}<section class="batch-shortlist"><header><h2>候选阵容 <span>${draft.candidates.length}</span></h2></header>${candidates||'<div class="batch-shortlist-empty"><b>☆</b><p>暂无候选</p></div>'}</section></aside></div></section>`;
}


export function draftLineupBoardMarkup(attempt,roleLabels={}) {
  const starters=attempt.players.filter(p=>p.starter);
  const rows=[['ST','LW','RW'],['DM','AM','LM','RM','CM'],['LB','RB','CB','LWB','RWB'],['GK']];
  const pieces=rows.flatMap((roles,row)=>{
    const players=starters.filter(p=>roles.includes(p.draftRole)).sort((a,b)=>a.position.x-b.position.x||a.position.y-b.position.y);
    return players.map((p,index)=>{
      const x=players.length===1?50:players.length===2?32+index*36:players.length===3?20+index*30:12+index*76/(players.length-1),y=[17,43,69,90][row];
      return `<div class="batch-lineup-player grade-${escape(p.grade?.toLowerCase())}" style="left:${x}%;top:${y}%" title="${escape(p.name)} · ${escape(roleLabels[p.draftRole]??p.draftRole)} · ${p.overall}" aria-label="${escape(p.name)}，${escape(roleLabels[p.draftRole]??p.draftRole)}，能力 ${p.overall}"><div><span>${escape(p.draftRole)}</span><b>${p.overall}</b></div><strong>${escape(p.name)}</strong></div>`;
    });
  }).join('');
  return `<section class="batch-lineup"><header><h2>推荐最强首发</h2><span>${attempt.formation}</span></header><div class="batch-lineup-content"><div class="batch-lineup-pitch" role="img" aria-label="${attempt.formation} 推荐首发战术板"><div class="batch-lineup-markings" aria-hidden="true"><i></i><i></i></div>${pieces}</div><footer><span>首发平均能力</span><b>${attempt.startingOverall??Math.round(starters.reduce((n,p)=>n+p.overall,0)/11*10)/10}</b></footer></div></section>`;
}

// One flip finishes before the next begins. Keep the batch mounted until it ends.
export function createBatchRevealController(env=globalThis) {
  let root=null,timer=null;
  function clear(){if(timer!==null)env.clearTimeout(timer);timer=null;root=null;}
  function mount(nextRoot){
    clear();root=nextRoot;
    if(!root?.classList.contains('is-flipping'))return;
    const cards=root.querySelectorAll('.batch-player.is-revealing');
    const finish=()=>{
      if(!root)return;
      root.classList.remove('is-flipping');
      root.querySelectorAll('[data-batch-reveal-lock]').forEach(button=>{button.disabled=false;button.removeAttribute('data-batch-reveal-lock');});
      timer=null;
    };
    timer=env.setTimeout(finish,Math.max(0,cards.length-1)*650+700);
  }
  return {mount,destroy:clear};
}
