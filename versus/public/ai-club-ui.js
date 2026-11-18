const phases = [['opening','默认'],['leading','领先'],['trailing','落后']];
const possessionLabels = {possession:'控球组织',wingPlay:'边路推进',vertical:'纵向推进',balanced:'均衡推进',longBall:'长传支点'};
const blockLabels = {highPress:'高位压迫',midBlock:'中位防守',lowBlock:'低位防守'};

function planDescription(plan, phase) {
  const label = phases.find(([key])=>key===phase)?.[1] ?? '默认';
  const timing = Number(plan.planAfter)>0 ? `${plan.planAfter} 分钟后，` : '';
  return phase==='opening' ? `${label} · 开局执行` : `${timing}${label}时执行`;
}

export function aiClubBoardsMarkup(team, escape, pitch) {
  if (!team.aiClub) return '';
  const additions = team.aiClub.additions ?? [];
  return `<section class="ai-club-boards">
    <header class="ai-club-boards-heading"><h3>战术方案</h3><p>${escape(team.aiClub.label)}</p></header>
    <div class="ai-club-schemes">${(team.aiSchemes??[]).map((scheme,index)=>{
      const plan = scheme.tacticalPlans.opening;
      return `<details class="ai-scheme-card" open>
        <summary><span class="ai-scheme-number">${String(index+1).padStart(2,'0')}</span><span>${escape(scheme.name)}</span></summary>
        <div class="ai-scheme-content">
          <div class="ai-board-controls" role="group" aria-label="${escape(scheme.name)}站位">${phases.map(([key,label])=>`<button type="button" class="${key==='opening'?'active':''}" aria-pressed="${key==='opening'}" data-ai-board="${index}" data-ai-phase="${key}">${label}</button>`).join('')}</div>
          <dl class="ai-plan-metrics"><div><dt>进攻</dt><dd data-ai-possession="${index}">${possessionLabels[plan.possessionStyle]??'均衡推进'}</dd></div><div><dt>防守</dt><dd data-ai-block="${index}">${blockLabels[plan.defensiveBlock]??'中位防守'}</dd></div></dl>
          <div class="ai-scheme-pitch" data-ai-pitch="${index}">${pitch({...team,starters:scheme.starters})}</div>
          <p class="ai-plan-caption" data-ai-plan="${index}" aria-live="polite">${escape(planDescription(plan,'opening'))}</p>
        </div>
      </details>`;
    }).join('')}</div>
    <details class="ai-club-notes"><summary>阵容与补员 <span>${additions.length} 名补充球员</span></summary><div>
      ${(team.aiDecision?.reasons??[]).length?`<p>${team.aiDecision.reasons.map(escape).join('；')}</p>`:''}
      ${additions.length?`<ul>${additions.map(p=>`<li><b>${escape(p.name)}</b><span>${escape(p.sourceClub)} · ${escape(p.reason)}</span></li>`).join('')}</ul>`:'<p>全部来自本俱乐部球员库。</p>'}
    </div></details>
  </section>`;
}

export function bindAiClubBoards(root,team,pitch) {
  root.querySelectorAll('[data-ai-board]').forEach(button=>button.onclick=()=>{
    const index=Number(button.dataset.aiBoard),phase=button.dataset.aiPhase;
    const scheme=team.aiSchemes[index],plan=scheme.tacticalPlans[phase];
    const positions=scheme.positionPresets[plan.positionPreset];
    root.querySelector(`[data-ai-pitch="${index}"]`).innerHTML=pitch({...team,starters:scheme.starters.map(p=>({...p,position:positions[p.id]}))});
    root.querySelectorAll(`[data-ai-board="${index}"]`).forEach(control=>{
      const selected=control===button;
      control.classList.toggle('active',selected);
      control.setAttribute('aria-pressed',String(selected));
    });
    root.querySelector(`[data-ai-possession="${index}"]`).textContent=possessionLabels[plan.possessionStyle]??'均衡推进';
    root.querySelector(`[data-ai-block="${index}"]`).textContent=blockLabels[plan.defensiveBlock]??'中位防守';
    root.querySelector(`[data-ai-plan="${index}"]`).textContent=planDescription(plan,phase);
  });
}
