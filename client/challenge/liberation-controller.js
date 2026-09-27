import {patchMarkup} from '../ui/patch-markup.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function createLiberationController({documentRef,getState,store,request,territoryName,onWorldChanged,showToast}) {
  const notices=documentRef.querySelector('#campaign-liberation-notices'),result=documentRef.querySelector('#battle-result-liberation');
  let battleId=null,busy=null,seen=new Set(),owner=null;
  function markup(p) {
    return `<article class="campaign-live-card" data-ui-key="liberation-${esc(p.challengeId)}"><strong>${esc(territoryName(p.territoryId)??p.territoryId)} · 收复成功</strong><p>原属 ${esc(p.originalOwnerName)}，请选择收下，或解放并归还给原来的玩家。</p>${p.canLiberate?'':'<p>原始所有者目前不是你的盟友，暂时无法解放。</p>'}<div><button type="button" class="button secondary" data-liberation-action="keep" data-challenge-id="${esc(p.challengeId)}" ${busy?'disabled':''}>收下</button> <button type="button" class="button" data-liberation-action="liberate" data-challenge-id="${esc(p.challengeId)}" ${busy||!p.canLiberate?'disabled':''}>解放并归还</button></div></article>`;
  }
  function render() {
    const state=getState();if(owner!==state?.playerId){owner=state?.playerId;seen=new Set();battleId=null;busy=null;}
    const choices=state?.pendingLiberations??[];
    for(const [root,entries] of [[notices,choices],[result,choices.filter(p=>p.challengeId===battleId)]])if(root){root.hidden=!entries.length;patchMarkup(root,entries.map(markup).join(''));}
    if(choices.some(p=>!seen.has(p.challengeId))){
      const center=notices?.closest('#campaign-notifications');
      if(center?.classList.contains('is-collapsed'))center.querySelector('[data-notification-toggle]')?.click();
    }
    choices.forEach(p=>seen.add(p.challengeId));
  }
  async function click(event) {
    const button=event.target.closest('[data-liberation-action]');if(!button || busy)return;
    const p=(getState()?.pendingLiberations??[]).find(p=>p.challengeId===button.dataset.challengeId);if(!p)return;
    const accountId=getState()?.playerId,action=button.dataset.liberationAction;
    busy=p.challengeId;render();
    try {
      const value=await request()('/api/campaign/territory/liberation',{method:'POST',body:{territoryId:p.territoryId,challengeId:p.challengeId,action}});
      if(accountId!==getState()?.playerId)return;
      store.setState(value.state,{source:'territory-liberation'});onWorldChanged?.();
      showToast(action==='liberate'?'地块已解放，归还给原来的玩家':'地块已收下');
    }catch(error){if(accountId===getState()?.playerId)showToast(error.message||'地块处理失败，请重试');}
    finally {if(accountId===getState()?.playerId){busy=null;render();}}
  }
  for(const root of [notices,result])if(root)root.onclick=click;
  store.subscribe?.(render);render();
  return {showBattle(battle){battleId=battle?.challengeId??battle?.id;render();}};
}
