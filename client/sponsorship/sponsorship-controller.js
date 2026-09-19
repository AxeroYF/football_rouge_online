import { goldAmountMarkup } from '../ui/currency.js';
import { registerStandardWindow, activateStandardWindow, deactivateStandardWindow } from '../ui/standard-window.js';
import { sponsorEscape as esc, sponsorLogoMarkup } from './sponsor-markup.js?v=20260908-sponsorship-v1';
const fmtDate = value => new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export function contractTimeLeft(milliseconds){
 const minutes=Math.max(0,Math.ceil(milliseconds/60000)),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60);
 return days?days+' 天 '+hours+' 小时':hours?hours+' 小时 '+minutes%60+' 分钟':minutes+' 分钟';
}
export function sponsorshipWindowMarkup(view,{tab='pending',pending=false,confirmReject=null,now=Date.now(),territoryLabel=id=>id??''}={}){
 const offers=view?.offers??[],contracts=view?.contracts??[],active=contracts.filter(c=>c.status==='active'&&c.expiresAt>now),expired=contracts.filter(c=>c.status==='expired'||c.expiresAt<=now);
 const tabs=[['pending','待签约',offers.length],['active','生效中',active.length],['expired','已到期',expired.length],['brands','品牌图鉴',view?.brands?.length??0]];
 const cards=(tab==='pending'?offers:tab==='active'?active:expired).map(c=>{
  const isOffer=tab==='pending',isExpired=!isOffer&&(c.status==='expired'||c.expiresAt<=now);
  const rejected=confirmReject===c.id;
  return `<article class="sponsor-contract" data-sponsor-card="${esc(c.id)}">
   <header>${sponsorLogoMarkup(c.sponsor)}<div><span class="sponsor-tier is-${esc(c.type)}">${esc(c.typeName)}</span><h3>${esc(c.sponsor?.name)}</h3></div></header>
   <dl><div><dt>期限</dt><dd>${c.durationDays} 天</dd></div><div><dt>每小时</dt><dd>${goldAmountMarkup(c.hourlyGold)}</dd></div><div><dt>${isOffer?'总收益':'已发放'}</dt><dd>${goldAmountMarkup(isOffer?c.totalGold:c.earnedGold)}</dd></div></dl>
   ${isOffer?`<p class="sponsor-source">来自 ${esc(territoryLabel(c.sourceTerritoryId))}</p>`:`<p class="sponsor-time" data-sponsor-expires="${c.expiresAt}">${isExpired?'已到期':'剩余 '+contractTimeLeft(c.expiresAt-now)}</p><p class="sponsor-next">${isExpired?'到期 '+fmtDate(c.expiresAt):'下次发放 '+fmtDate(c.nextPaymentAt)}</p>`}
   ${isOffer?`<footer>${rejected?`<span>放弃这份合同？</span><button class="ui-button" type="button" data-sponsor-action="reject" data-offer-id="${esc(c.id)}" ${pending?'disabled':''}>确认放弃</button><button class="ui-button" type="button" data-sponsor-cancel ${pending?'disabled':''}>取消</button>`:`<button class="ui-button ui-button--primary" type="button" data-sponsor-action="accept" data-offer-id="${esc(c.id)}" ${pending||!c.canSign?'disabled':''}>${esc(c.blockedReason??'签约')}</button><button class="ui-button" type="button" data-sponsor-discard="${esc(c.id)}" ${pending?'disabled':''}>放弃</button>`}</footer>`:''}
  </article>`;
 }).join('');
 const body=tab==='brands'?`<div class="sponsor-brand-grid">${(view?.brands??[]).map(b=>`<article>${sponsorLogoMarkup(b)}<strong>${esc(b.name)}</strong></article>`).join('')}</div>`:
  cards?`<div class="sponsor-contract-grid">${cards}</div>`:`<div class="sponsor-empty">${tab==='pending'?'暂无待签约合同':tab==='active'?'暂无生效合同':'暂无到期合同'}${tab==='pending'?'<p>征服中立地块有机会获得，签约后开始计时。</p>':''}</div>`;
 return `<div class="standard-window__surface sponsorship-surface">
  <header class="sponsorship-header"><div><h2>赞助商</h2><span class="sponsorship-income">${goldAmountMarkup(view?.hourlyGold??0)} /小时</span></div><button class="ui-button" type="button" data-stage-window-close aria-label="关闭赞助商">×</button></header>
  <div class="sponsor-slots">${(view?.types??[]).map(t=>`<span>${esc(t.name)} <b>${view.slots?.[t.id]?.used??0} / ${t.limit}</b></span>`).join('')}</div>
  <nav class="sponsor-tabs" aria-label="合同分类">${tabs.map(([id,label,count])=>`<button type="button" data-sponsor-tab="${id}" aria-current="${id===tab?'page':'false'}" class="${id===tab?'is-active':''}">${label}<b>${count}</b></button>`).join('')}</nav>
  <div class="sponsor-content" data-sponsor-content aria-busy="${pending}">${body}</div>
 </div>`;
}
export function createSponsorshipController({root,trigger,getState,getRequest,campaignStore,onOpen=()=>{},onClose=()=>{},onState=()=>{},showToast=()=>{},territoryLabel,now=Date.now}){
 let tab='pending',pending=false,confirmReject=null,key='';
 function render(force=false){
  if(root.hidden)return;
  const view=getState()?.sponsorship,newKey=JSON.stringify({view,tab,pending,confirmReject});
  if(!force&&key===newKey)return;key=newKey;
  const scroll=root.querySelector('[data-sponsor-content]')?.scrollTop??0;
  const active=root.ownerDocument.activeElement;
  const focusKey=active?.dataset?.offerId?{offer:active.dataset.offerId,action:active.dataset.sponsorAction}:active?.dataset?.sponsorTab?{tab:active.dataset.sponsorTab}:null;
  root.innerHTML=sponsorshipWindowMarkup(view,{tab,pending,confirmReject,now:now(),territoryLabel});
  root.querySelector('[data-sponsor-content]').scrollTop=scroll;
  if(focusKey){
   const elements=[...root.querySelectorAll('[data-offer-id], [data-sponsor-tab]')];
   elements.find(el=>focusKey.tab?el.dataset.sponsorTab===focusKey.tab:el.dataset.offerId===focusKey.offer&&el.dataset.sponsorAction===focusKey.action)?.focus({preventScroll:true});
  }
 }
 function close(){if(root.hidden)return;root.hidden=true;deactivateStandardWindow(root);onClose();}
 async function refresh(){
  try{const value=await getRequest()('/api/campaign/state');campaignStore.setState(value.state,{source:'sponsorship-refresh'});onState(value.state);}
  catch(error){showToast(error.message||'合同读取失败');}
 }
 function open(){
  if(!getState()?.setupComplete)return;
  onOpen();tab=(getState().sponsorship?.offers?.length??0)>0?'pending':'active';confirmReject=null;
  activateStandardWindow(root);render(true);refresh();
 }
 async function respond(offerId,action){
  if(pending)return;pending=true;render();
  try{
   const value=await getRequest()('/api/campaign/sponsorship/respond',{method:'POST',body:{offerId,action}});
   campaignStore.setState(value.state,{source:'sponsorship-respond'});onState(value.state);confirmReject=null;
   showToast(action==='accept'?'签约成功，一小时后开始发放金币':'已放弃合同');
  }catch(error){showToast(error.message||'合同处理失败');await refresh();}
  finally{pending=false;render(true);}
 }
 function update(state=getState()){
  trigger.hidden=!state?.setupComplete;
  if(!state?.setupComplete){close();return;}
  render();
 }
 root.addEventListener('click',event=>{
  const button=event.target.closest?.('button');if(!button||button.disabled)return;
  if(button.dataset.sponsorTab){tab=button.dataset.sponsorTab;confirmReject=null;key='';render(true);root.querySelector('[data-sponsor-content]').scrollTop=0;}
  if(button.dataset.sponsorDiscard){confirmReject=button.dataset.sponsorDiscard;render(true);}
  if(button.hasAttribute('data-sponsor-cancel')){confirmReject=null;render(true);}
  if(button.dataset.sponsorAction)respond(button.dataset.offerId,button.dataset.sponsorAction);
 });
 trigger.addEventListener('click',open);
 registerStandardWindow(root,{onRequestClose:close});
 campaignStore.subscribe(({state})=>update(state));update();
 return {open,close,update,refresh};
}
