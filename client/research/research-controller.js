import {createTopicResearchController} from './topic-research-controller.js';
import { createFormationResearchController } from './formation-research-controller.js';
import { RESEARCH_BRANCHES as branches, RESEARCH_TOPICS as topics, normalizeResearchSelection, researchLevelPreview } from '../../shared/config/research-preview.mjs';
import { registerStandardWindow, activateStandardWindow, deactivateStandardWindow } from '../ui/standard-window.js';
import { resourceAmountMarkup } from '../resources/resource-markup.js';
import { researchArt } from './research-art.js';
import { researchTreeLayout } from './research-layout.js';
export { researchArt } from './research-art.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const description=t=>t.branch==='enhancement'?`主卡 +${t.main} 与材料 +${t.material}，强化目标 +${t.target}`:`使用${t.label}${t.branch==='formation'?'阵型':'战术'}时生效`;
export function researchDetails(topic,level){
 const p=researchLevelPreview(topic,level),enhance=topic.branch==='enhancement';
 return `<div class="research-level-detail-heading"><span>等级 ${level}</span><h3>${enhance?'成功率增益':'比赛属性增益'}</h3><strong>+${p.bonus}<small>${p.unit}</small></strong></div><div class="research-level-detail-body"><dl>${enhance?`<div><dt>基础成功率</dt><dd>${p.base}%</dd></div><div><dt>研究后成功率</dt><dd>${p.result}%</dd></div>`:''}<div><dt>前置等级</dt><dd>${level===1?'无':`等级 ${level-1}`}</dd></div><div><dt>研究需求</dt><dd>待配置</dd></div></dl></div>`;
}
export function createResearchController({root,trigger,getState,campaignStore,onOpen=()=>{},onClose=()=>{},storage,getRequest}){
 try{storage??=globalThis.localStorage;}catch{}
 let branch=null,selection={},activeLevel=1,playerId=null,formationController=null,topicController=null;
 root.innerHTML=`<div class="standard-window__surface research-surface"><header class="research-header"><button type="button" data-research-back hidden aria-label="返回研究方向">←</button><div class="research-title"><img src="./assets/ui/resources/science.svg" alt=""><h1>科技研究</h1><span data-research-subtitle></span></div><div class="research-capacity"><span>当前科技值</span><b data-research-capacity></b></div><button type="button" data-stage-window-close aria-label="关闭科技研究">×</button></header><main class="research-content" data-research-content></main></div>`;
 const $=s=>root.querySelector(s),content=$('[data-research-content]');
 const key=()=>`yellowdogs-research-selection-v3:${playerId}`;
 function load(){try{selection=normalizeResearchSelection(JSON.parse(storage?.getItem(key())??'{}'));}catch{selection=normalizeResearchSelection();}}
 function saveSelection(){try{storage?.setItem(key(),JSON.stringify(selection));}catch{}}
 function capacity(){const amount=Number(getState()?.resources?.current?.science??0);$('[data-research-capacity]').innerHTML=resourceAmountMarkup('science',Number.isFinite(amount)?Math.max(0,amount):0);}
 function selected(){return topics.find(t=>t.branch===branch&&t.id===selection[branch]);}
 function selector(topic){
  if(branch==='enhancement'){
   const main=topic?.main??2,material=topic?.material??1,list=topics.filter(t=>t.branch===branch);
   return `<div class="research-combination"><label>主卡强化等级<select data-research-main>${[...new Set(list.map(t=>t.main))].map(n=>`<option value="${n}" ${n===main?'selected':''}>+${n}</option>`).join('')}</select></label><span>+</span><label>材料强化等级<select data-research-material>${list.filter(t=>t.main===main).map(t=>`<option value="${t.material}" ${t.material===material?'selected':''}>+${t.material}</option>`).join('')}</select></label><button type="button" data-research-set>设定研究组合</button></div>`;
  }
  const list=topics.filter(t=>t.branch===branch);
  return `<label class="research-object-select">选择研究${branch==='formation'?'阵型':'战术'}<select data-research-object><option value="">请选择${branch==='formation'?'阵型':'战术'}</option>${list.map(t=>`<option value="${t.id}" ${t.id===topic?.id?'selected':''}>${esc(t.label)}${branch==='tactic'?` · ${t.kind}`:''}</option>`).join('')}</select></label>`;
 }
 function render(){
  formationController?.dispose();formationController=null;topicController?.dispose();topicController=null;
  $('[data-research-back]').hidden=!branch;content.scrollTop=0;
  if(!branch){$('[data-research-subtitle]').textContent='';content.innerHTML=`<section class="research-overview"><div class="research-directions">${branches.map(b=>`<button type="button" data-research-direction="${b.id}" class="research-direction ${b.id==='tactic'?'is-future':''}"><div class="research-direction-art">${researchArt(b.example)}</div><h3>${b.label}</h3></button>`).join('')}</div></section>`;return;}
  const b=branches.find(b=>b.id===branch);$('[data-research-subtitle]').textContent=b.label;
  if(branch==='biology'){const topic=topics.find(t=>t.branch==='biology');content.innerHTML='<section class="research-workspace" data-research-route></section>';topicController=createTopicResearchController({root:$('[data-research-route]'),topic,getState,campaignStore,getRequest});return;}
  if(branch==='formation'){formationController=createFormationResearchController({root:content,storage,playerId,getState,campaignStore,getRequest});return;}
  const topic=selected();
  content.innerHTML=`<section class="research-workspace"><div class="research-object-header"><div><h2>研究对象</h2></div><div class="research-selector">${selector(topic)}</div></div><div data-research-route></div></section>`;
  renderRoute();
 }
 function renderRoute(){
  topicController?.dispose();topicController=null;
  const host=$('[data-research-route]'),topic=selected();
  if(!topic){host.innerHTML=`<div class="research-object-empty"><div>${researchArt(branches.find(b=>b.id===branch).example)}</div><h3>先选择一个研究${branch==='formation'?'阵型':branch==='tactic'?'战术':'组合'}</h3></div>`;return;}
  if(branch==='enhancement'){topicController=createTopicResearchController({root:host,topic,getState,campaignStore,getRequest});return;}
  const {nodes}=researchTreeLayout(topic),enhance=branch==='enhancement';
  host.innerHTML=`<div class="research-selected-object"><div class="research-subject-art">${researchArt(topic)}</div><div><h2>${esc(topic.label)}${enhance?` <span>→ +${topic.target}</span>`:''}</h2>${enhance?`<p>${description(topic)}</p>`:''}</div><div class="research-subject-level"><small>研究等级</small><strong>未研究</strong><span>${enhance?`基础成功率 ${topic.baseChance}%`:'当前增益 +0%'}</span></div></div><div class="research-route-header"><h3>等级成长</h3></div><div class="research-level-scroller"><div class="research-level-route">${nodes.map(n=>`<button type="button" class="research-level-node" data-research-level="${n.level}" data-topic-id="${topic.id}" aria-pressed="${n.level===activeLevel}"><span class="research-level-badge">${n.level}</span><small>等级 ${n.level}</small><strong>+${n.bonus}<em>${n.unit}</em></strong><span>${enhance?'成功率增益':'比赛属性增益'}</span></button>`).join('')}</div></div><section class="research-level-detail" data-research-level-detail>${researchDetails(topic,activeLevel)}</section><div class="research-action"><button class="research-start" disabled>研究尚未开放</button></div>`;
 }
 function choose(id){const topic=topics.find(t=>t.branch===branch&&t.id===id);selection[branch]=topic?.id??null;activeLevel=1;saveSelection();renderRoute();}
 function close(reason='request'){topicController?.dispose();topicController=null;formationController?.dispose();formationController=null;root.hidden=true;deactivateStandardWindow(root,{restoreFocus:reason!=='superseded'});trigger.setAttribute('aria-expanded','false');if(reason!=='superseded')onClose();}
 function open(){if(!getState()?.setupComplete)return;if(playerId!==getState().playerId){playerId=getState().playerId;load();}branch=null;activeLevel=1;activateStandardWindow(root);onOpen();trigger.setAttribute('aria-expanded','true');capacity();render();}
 root.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;
  if(button.dataset.researchDirection){branch=button.dataset.researchDirection;activeLevel=1;render();}
  if(button.hasAttribute('data-research-back')){if(formationController?.back())return;branch=null;render();}
  if(button.hasAttribute('data-research-set'))choose(`enhancement:${$('[data-research-main]').value}:${$('[data-research-material]').value}`);
  if(button.dataset.researchLevel){activeLevel=Number(button.dataset.researchLevel);for(const n of root.querySelectorAll('[data-research-level]'))n.setAttribute('aria-pressed',String(Number(n.dataset.researchLevel)===activeLevel));$('[data-research-level-detail]').innerHTML=researchDetails(selected(),activeLevel);}
 });
 root.addEventListener('change',e=>{
  if(e.target.matches('[data-research-object]'))choose(e.target.value);
  if(e.target.matches('[data-research-main]')){const main=Number(e.target.value),before=Number($('[data-research-material]').value),list=topics.filter(t=>t.branch==='enhancement'&&t.main===main);$('[data-research-material]').innerHTML=list.map(t=>`<option value="${t.material}" ${t.material===before?'selected':''}>+${t.material}</option>`).join('');}
 });
 registerStandardWindow(root,{onRequestClose:close});trigger.addEventListener('click',open);trigger.hidden=!getState()?.setupComplete;
 campaignStore.subscribe(({state,previousState})=>{trigger.hidden=!state?.setupComplete;if(!state?.setupComplete||state.playerId!==previousState?.playerId){close();playerId=state?.playerId??null;branch=null;load();}if(!root.hidden)capacity();});
 return {open,close};
}
