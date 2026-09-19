import { registerStandardWindow,activateStandardWindow,deactivateStandardWindow } from '../ui/standard-window.js';
import { resourceAmountMarkup } from '../resources/resource-markup.js?v=20260907-resource-hover-v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ownStatus=w=>w.owners.some(o=>o.mine&&o.status==='active')?'我已拥有':w.owners.some(o=>o.mine)?'我正在建造':w.owners.some(o=>o.status==='active')?'全服已建造':'尚未建成';
export function wonderCatalogDetails(w){
 w={...w,owners:w.owners.filter(o=>o.status==='active'||o.mine)};
 const c=w.collection,active=w.owners.filter(o=>o.status==='active').length;
 const meter=(value,total,label)=>`<div class="wonder-collection-meter"><span>${label}<b>${value} / ${total}</b></span><progress max="${total}" value="${Math.min(value,total)}" aria-label="${label} ${value}/${total}"></progress></div>`;
 return `<header><small>${esc(w.region)}</small><h2>${esc(w.label)}</h2><span class="wonder-owned-badge">${ownStatus(w)}</span></header>
  <section><h3>奇观效果</h3><p>${esc(w.effectText)}</p>${w.dependency?`<p class="wonder-catalog-pending">待${esc(w.dependency)}开放后生效</p>`:''}</section>
  <section><h3>建造需求</h3><div class="wonder-catalog-cost"><span>生产力总需求</span>${w.construction.totalProduction?resourceAmountMarkup('production',w.construction.totalProduction):'<b>尚未配置</b>'}</div><ul>${w.requirements.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></section>
  ${c?`<section data-wonder-collection><h3>我的球员收集 <small>${c.met?'已满足':'未满足'}</small></h3><p>${esc(c.filterLabel)}</p>${meter(c.current,c.required,'不同球员')}${c.requiredNationalities?meter(c.nationalities,c.requiredNationalities,'不同国籍'):''}</section>`:''}
  <section><h3>全服拥有情况 <small>已建成 ${active} · 我的在建 ${w.owners.length-active}</small></h3>${w.owners.length?`<ul class="wonder-owner-list">${w.owners.map(o=>`<li><strong>${esc(o.ownerName)}${o.mine?' <em>我</em>':''}</strong><span>${esc(o.territoryLabel)}</span><small>${o.status==='active'?'已建成':`建造中 · ${o.progress.toFixed(1)}%`}</small></li>`).join('')}</ul>`:'<p class="wonder-catalog-note">全服尚未建成</p>'}</section>`;
}
export function createWonderCatalogController({root,trigger,getState,getRequest,campaignStore,onOpen=()=>{},onClose=()=>{},loadViewer=()=>import('./wonder-model-viewer.js?v=20260908-wonder-catalog-v1')}){
 let data=null,selected=null,region='全部',query='',generation=0,pending=null,viewer=null,viewerPromise=null,modelId=null,listKey='',detailKey='';
 root.innerHTML=`<div class="standard-window__surface wonder-catalog-surface"><header class="wonder-catalog-header"><div><h1>奇观</h1><span data-wonder-count>全服奇观图鉴</span></div><button type="button" data-stage-window-close aria-label="关闭奇观预览">×</button></header><p class="wonder-catalog-status" data-wonder-status role="status"></p><div class="wonder-catalog-layout"><aside class="wonder-catalog-sidebar"><input type="search" data-wonder-search placeholder="搜索奇观" aria-label="搜索奇观"><nav aria-label="奇观地区">${['全部','欧洲','南美洲'].map(r=>`<button type="button" data-wonder-region="${r}" aria-pressed="${r==='全部'}">${r}</button>`).join('')}</nav><div class="wonder-catalog-list" data-wonder-list></div></aside><div class="wonder-catalog-detail"><section class="wonder-model-panel"><div class="wonder-model-host" data-wonder-model></div><p data-wonder-model-status role="status"></p><footer><span>拖动旋转 · 滚轮或双指缩放</span><button type="button" data-wonder-model-reset>重置视角</button><button type="button" data-wonder-model-retry hidden>重试</button></footer></section><div class="wonder-catalog-facts" data-wonder-facts></div></div></div></div>`;
 const $=s=>root.querySelector(s),host=$('[data-wonder-model]'),status=$('[data-wonder-status]');
 const visible=()=>data?.wonders.filter(w=>(region==='全部'||w.region===region)&&(!query||w.label.toLowerCase().includes(query.toLowerCase())))??[];
 function close(reason='request'){generation++;pending=null;viewer?.dispose();viewer=null;viewerPromise=null;modelId=null;root.hidden=true;deactivateStandardWindow(root,{restoreFocus:reason!=='superseded'});if(reason!=='superseded')onClose();}
 async function showModel(w){
  if(modelId===w.wonderId)return;modelId=w.wonderId;const version=generation;
  $('[data-wonder-model-status]').textContent='正在加载模型…';$('[data-wonder-model-retry]').hidden=true;
  try{
   if(!viewerPromise)viewerPromise=loadViewer();const module=await viewerPromise;
   if(root.hidden||generation!==version||modelId!==w.wonderId)return;
   viewer??=module.createWonderModelViewer(host);await viewer.select(w.modelUrl);
   if(root.hidden||generation!==version||modelId!==w.wonderId)return;
   $('[data-wonder-model-status]').textContent='';
  }catch(error){if(root.hidden||generation!==version||modelId!==w.wonderId)return;$('[data-wonder-model-status]').textContent='模型加载失败，请重试';$('[data-wonder-model-retry]').hidden=false;viewerPromise=null;}
 }
 function render(){
  if(root.hidden||!data)return;
  const items=visible();if(!items.some(w=>w.wonderId===selected))selected=items[0]?.wonderId??null;
  $('[data-wonder-count]').textContent=`全服 ${data.wonders.length} 座奇观 · 我的 ${data.wonders.filter(w=>w.owners.some(o=>o.mine)).length} 座`;
  const list=$('[data-wonder-list]'),html=items.map(w=>`<button type="button" data-catalog-wonder="${esc(w.wonderId)}" aria-pressed="${w.wonderId===selected}"><img src="${esc(w.iconPath)}" alt="${esc(w.label)}模型缩略图" loading="lazy"><span><strong>${esc(w.label)}</strong><small>${ownStatus(w)}</small></span></button>`).join('')||'<p>没有匹配的奇观</p>';
  if(html!==listKey){const scroll=list.scrollTop,left=list.scrollLeft;const focus=root.ownerDocument.activeElement?.dataset?.catalogWonder;list.innerHTML=html;listKey=html;list.scrollTop=scroll;list.scrollLeft=left;if(focus)[...list.querySelectorAll('[data-catalog-wonder]')].find(n=>n.dataset.catalogWonder===focus)?.focus({preventScroll:true});}
  const w=data.wonders.find(w=>w.wonderId===selected),facts=$('[data-wonder-facts]');$('.wonder-catalog-detail').hidden=!w;
  if(!w){viewer?.dispose();viewer=null;modelId=null;return;}
  const detail=wonderCatalogDetails(w);if(detail!==detailKey){const scroll=facts.scrollTop;facts.innerHTML=detail;facts.scrollTop=scroll;detailKey=detail;}
  showModel(w);
 }
 async function refresh(){
  if(root.hidden||pending)return;const token={generation};pending=token;
  try{const value=await getRequest()('/api/campaign/wonders');if(root.hidden||generation!==token.generation)return;data=value;status.textContent='';render();}
  catch(error){if(!root.hidden&&generation===token.generation)status.textContent=data?'暂时无法更新，稍后自动重试':'读取奇观失败，稍后自动重试';}
  finally{if(pending===token)pending=null;}
 }
 function open(){if(!getState()?.setupComplete)return;generation++;pending=null;activateStandardWindow(root);onOpen();status.textContent=data?'':'正在读取全服奇观…';render();refresh();}
 root.addEventListener('input',event=>{if(event.target.matches('[data-wonder-search]')){query=event.target.value;render();}});
 root.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.catalogWonder){selected=button.dataset.catalogWonder;detailKey='';$('[data-wonder-facts]').scrollTop=0;render();}
  if(button.dataset.wonderRegion){region=button.dataset.wonderRegion;for(const node of root.querySelectorAll('[data-wonder-region]'))node.setAttribute('aria-pressed',String(node.dataset.wonderRegion===region));render();}
  if(button.hasAttribute('data-wonder-model-reset'))viewer?.reset();
  if(button.hasAttribute('data-wonder-model-retry')){modelId=null;render();}
 });
 registerStandardWindow(root,{onRequestClose:close});trigger.addEventListener('click',open);
 campaignStore.subscribe(({state,previousState})=>{
  trigger.hidden=!state?.setupComplete;
  if(state?.playerId!==previousState?.playerId||!state?.setupComplete){close();data=null;selected=null;listKey='';detailKey='';$('[data-wonder-list]').replaceChildren();$('[data-wonder-facts]').replaceChildren();$('.wonder-catalog-detail').hidden=true;return;}
  if(!root.hidden)refresh();
 });trigger.hidden=!getState()?.setupComplete;
 return {open,close,refresh};
}
