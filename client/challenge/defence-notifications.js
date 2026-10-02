import {patchMarkup} from '../ui/patch-markup.js';
import {firstLegScoreText} from './first-leg-score.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function defenceEntries(state) {
  const id=state?.playerId;
  if(!id)return {active:[],history:[]};
  return {
    active:Object.values(state.world?.activeChallenges??{}).filter(c=>c.defenderId===id||c.defenderCoalitionContributors?.includes(id)),
    history:(state.battleHistory??[]).filter(b=>!(state.battleReportReadIds??[]).includes(b.challengeId??b.id)&&(b.defenderId===id||b.defender?.id===id||b.defenderCoalitionContributors?.includes(id))),
  };
}
export function coalitionAttackEntries(state){
 const id=state?.playerId,participates=c=>Boolean(id&&c.coalitionId&&(c.attackerId===id||c.coalitionContributors?.includes(id)));
 return {active:Object.values(state?.world?.activeChallenges??{}).filter(participates),history:(state?.battleHistory??[]).filter(b=>participates(b)&&!(state.battleReportReadIds??[]).includes(b.challengeId??b.id))};
}
export function createDefenceNotifications({root,getState,store,request,territoryName,showToast,showBroadcast}) {
  if(!root)return;
  let accountId=null,seen=new Set(),lastMarkup='',viewer=null,epoch=0;
  const dismissing=new Set();
  const dismissButton=b=>`<button type="button" data-dismiss-battle-report="${esc(b.challengeId??b.id)}">知道了</button>`;
  const acknowledged={battle:new Set(),bond:new Set()};
  async function dismissNotice(kind,id){
    const owner=getState()?.playerId,generation=epoch,key=owner+':'+kind+':'+id;
    if(dismissing.has(key)||acknowledged[kind].has(id))return;
    dismissing.add(key);acknowledged[kind].add(id);
    // Remove only this notification. Saving an acknowledgement must not repaint the game.
    const attribute=kind==='bond'?'data-dismiss-pvp-notice':'data-dismiss-battle-report';
    for(const button of root.querySelectorAll('['+attribute+']'))if(button.getAttribute(attribute)===id)button.closest('article')?.remove();
    root.hidden=!root.children.length;lastMarkup='';
    try{
      await request()(kind==='bond'?'/api/campaign/pvp-notice/read':'/api/campaign/battle-report/read',{method:'POST',body:kind==='bond'?{noticeId:id}:{challengeId:id}});
    }catch(error){if(owner===getState()?.playerId&&generation===epoch){acknowledged[kind].delete(id);render();showToast(error.message||'通知确认失败，请重试');}}
    finally{if(generation===epoch)dismissing.delete(key);}
  }
  const title=id=>territoryName(id)??id;
  async function openReport(id) {
    if(viewer)viewer.opened=false;
    const owner=getState()?.playerId;
    try {
      const snapshot=await request()('/api/campaign/territory/challenge?id='+encodeURIComponent(id));
      if(owner!==getState()?.playerId)return;
      const current={snapshot,opened:true};viewer=current;
      showBroadcast(current,{onClose:()=>{current.opened=false;}});
      const refresh=async()=>{
        if(!current.opened||current!==viewer||owner!==getState()?.playerId||current.snapshot.completed)return;
        try {const next=await request()('/api/campaign/territory/challenge?id='+encodeURIComponent(id));
          if(!current.opened||current!==viewer||owner!==getState()?.playerId)return;
          current.snapshot=next;current.renderOverlay?.();
        }catch { /* Retry without erasing the last verified score. */ }
        if(current.opened&&!current.snapshot.completed)setTimeout(refresh,1000);
      };
      if(!snapshot.completed)setTimeout(refresh,1000);
    }catch(error){showToast(error.message||'战报读取失败');}
  }
  function render() {
    let state=getState();
    if(accountId!==state?.playerId){accountId=state?.playerId;epoch++;dismissing.clear();seen=new Set();acknowledged.battle.clear();acknowledged.bond.clear();if(viewer)viewer.opened=false;viewer=null;}
    if(state)state={...state,battleReportReadIds:[...(state.battleReportReadIds??[]),...acknowledged.battle],pvpNoticeReadIds:[...(state.pvpNoticeReadIds??[]),...acknowledged.bond]};
    const {active,history}=defenceEntries(state);
    let fresh=false;
    for(const c of active)if(!seen.has(c.id)){
      seen.add(c.id);fresh=true;showToast(`领地遭到攻击！${c.attackerTeamName??'敌方'} 正在进攻 ${title(c.territoryId)}`);
    }
    const bondMarkup=(state?.pvpNotices??[]).filter(n=>!(state.pvpNoticeReadIds??[]).includes(n.id)).slice().reverse().map(n=>`<article class="campaign-live-card" data-ui-key="bond-${esc(n.id)}"><strong>进攻保证金</strong><span>${esc(n.text)}</span><small>${esc(new Date(n.createdAt).toLocaleString('zh-CN'))}</small><div class="battle-report-actions"><button type="button" data-dismiss-pvp-notice="${esc(n.id)}">知道了</button></div></article>`).join('');
    const coalition=coalitionAttackEntries(state);
    const coalitionMarkup=coalition.active.map(c=>`<button type="button" class="campaign-live-card" data-ui-key="coalition-${esc(c.id)}" data-defence-report="${esc(c.id)}"><span class="campaign-live-kicker">联军进攻 · 点击观战</span><strong>${esc(c.attackerTeamName??'联军')} · ${esc(title(c.territoryId))}</strong><small>${c.phase==='second-leg'?'第二回合':c.phase==='intermission'?'回合间休息':'第一回合'} · ${esc(firstLegScoreText({challenge:c}))}</small></button>`).join('')+coalition.history.map(b=>`<article class="campaign-live-card" data-ui-key="coalition-report-${esc(b.challengeId??b.id)}"><span class="campaign-live-kicker">联军进攻战报 · ${b.captured?'占领成功':'未占领'}</span><strong>${esc(title(b.territoryId))} · ${(b.aggregateScore??b.score??[]).map(esc).join(' : ')}</strong><div class="battle-report-actions"><button type="button" data-defence-report="${esc(b.challengeId??b.id)}">查看战报</button>${dismissButton(b)}</div></article>`).join('');
    const markup=coalitionMarkup+bondMarkup+active.map(c=>`<button type="button" class="campaign-live-card defence-alert" data-ui-key="attack-${esc(c.id)}" data-defence-report="${esc(c.id)}"><span class="campaign-live-kicker">⚠ 领地遭到攻击</span><strong>${esc(title(c.territoryId))} · ${esc(c.attackerTeamName??'敌方')}</strong><small>${c.phase==='second-leg'?'第二回合':c.phase==='intermission'?'回合间休息':'第一回合'} · 点击观战</small><small>${esc(firstLegScoreText({challenge:c}))}</small></button>`).join('')+
      history.map(b=>`<article class="campaign-live-card defence-report" data-ui-key="defence-${esc(b.challengeId??b.id)}"><span class="campaign-live-kicker">防守战报 · ${b.captured?'领地失守':'领地保留'}</span><strong>${esc(title(b.territoryId))} · ${esc(b.teams?.[0]?.name??b.attackerTeamName??'进攻方')} ${(b.aggregateScore??b.score??[]).map(esc).join(' : ')} ${esc(b.teams?.[1]?.name??b.defenderName??'防守方')}</strong><small>${esc(new Date(b.settledAt??b.playedAt).toLocaleString('zh-CN'))}</small><div class="battle-report-actions"><button type="button" data-defence-report="${esc(b.challengeId??b.id)}">查看战报</button>${dismissButton(b)}</div></article>`).join('');
    root.hidden=!markup;
    if(markup!==lastMarkup){patchMarkup(root,markup);lastMarkup=markup;}
    if(fresh){
      const center=root.closest('#campaign-notifications');
      if(center?.classList.contains('is-collapsed'))center.querySelector('[data-notification-toggle]')?.click();
      root.parentElement.scrollTop=0;
    }
  }
  root.onclick=event=>{const bond=event.target.closest('[data-dismiss-pvp-notice]');if(bond&&root.contains(bond)){dismissNotice('bond',bond.dataset.dismissPvpNotice);return;}const dismiss=event.target.closest('[data-dismiss-battle-report]');if(dismiss&&root.contains(dismiss)){dismissNotice('battle',dismiss.dataset.dismissBattleReport);return;}const button=event.target.closest('[data-defence-report]');if(button&&root.contains(button))openReport(button.dataset.defenceReport);};
  store.subscribe?.(render);render();
}
