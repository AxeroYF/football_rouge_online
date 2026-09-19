import {advancedResearchTopic} from '../../shared/config/advanced-research.mjs';
import {FORMATION_RESEARCH_DIRECTIONS} from '../../shared/config/formation-research.mjs';
import { registerStandardWindow,activateStandardWindow,deactivateStandardWindow } from '../ui/standard-window.js';
import { neutralRewardMarkup, rewardEscape as esc } from './neutral-reward-markup.js?v=20260908-wonder-race-v1';
import { BUILDING_RULES } from '../../shared/config/buildings.mjs';
export function productionTargets(state,label=id=>id){
 const targets=[],catalog=state?.buildings?.catalog??[];
 for(const [territoryId,t]of Object.entries(state?.buildings?.territories??{})){
  if(!t.canManage)continue;
  for(const b of t.buildings??[])if((b.status==='constructing'||b.upgradeTo)&&b.productionWork)targets.push({
   key:b.id,territoryId,buildingId:b.id,label:label(territoryId)+' · '+(b.name??b.label)+'（在建）',
   remaining:(b.productionWork.required-b.productionWork.completed)/BUILDING_RULES.productionPeriodMs
  });
  for(const type of t.availableTypes??[]){const d=catalog.find(c=>c.type===type);if(d)targets.push({
   key:territoryId+':'+type,territoryId,type,label:label(territoryId)+' · 新建'+d.label,remaining:d.buildCostProduction
  });}
 }
 return targets;
}
export function researchRewardMarkup(state,reward,pending=false){
 const data=state?.formationResearch,job=data?.active;
 if(!job)return '<section><h3>投入研究进度</h3><p>请先开始一项科技研究，奖励会保留。</p></section>';
 const topic=advancedResearchTopic(job.topicId),slot=data.slots?.find(s=>s.id===job.slotId);
 const title=topic?({biology:'生物研究',enhancement:'强化研究'}[topic.branch]+' · '+topic.label):((slot?.name??'阵型研究')+' · '+(FORMATION_RESEARCH_DIRECTIONS.find(d=>d.id===job.direction)?.label??job.direction));
 const remaining=Math.max(0,job.required-job.completed),amount=Math.min(reward.amount,remaining),left=Math.max(0,reward.amount-amount);
 return '<section><h3>投入当前研究</h3><strong>'+esc(title)+' · LV'+job.level+'</strong><p>当前进度 '+Number(job.completed.toFixed(2))+' / '+job.required+'</p><p>本次投入 '+Number(amount.toFixed(2))+' 研究进度'+(left>0?'，剩余 '+Number(left.toFixed(2))+' 保留':'')+'，不改变科技产出。</p><button class="ui-button ui-button--primary" data-apply-research-reward '+(pending?'disabled':'')+'>'+(pending?'正在投入…':'投入研究')+'</button></section>';
}
export function createNeutralRewardController({root,trigger,getState,getRequest,campaignStore,onState,showToast,territoryLabel}){
 let pending=false,selected='',shown=new Set(),currentRewardId=null;
 const rewards=()=>getState()?.neutralRewards?.pending??[];
 function close(){root.hidden=true;deactivateStandardWindow(root);}
 function render(){
  if(root.hidden)return;
  const list=rewards(),r=list.find(r=>r.id===currentRewardId)??list.find(r=>r.kind==='production')??list[0];currentRewardId=r?.id;
  const targets=productionTargets(getState(),territoryLabel);if(!targets.some(t=>t.key===selected))selected=targets[0]?.key??'';
  const target=targets.find(t=>t.key===selected),overflow=Math.max(0,(r?.amount??0)-(target?.remaining??Infinity));
  root.innerHTML='<div class="standard-window__surface neutral-reward-surface"><header><div><small>资源存储</small><h2>待处理奖励</h2></div><button class="ui-button" data-stage-window-close aria-label="关闭待处理奖励">×</button></header>'+
   (list.length?'<div class="reward-choice-list">'+list.map(x=>'<button class="ui-button '+(x.id===r.id?'is-selected':'')+'" data-reward-id="'+esc(x.id)+'">'+neutralRewardMarkup(x,{preview:false})+'</button>').join('')+'</div>':'<p>暂无待处理奖励</p>')+
   (r?.kind==='production'?'<section><h3>选择投入的建设项目</h3><p>可投入在建项目，或立即新建。奖励在指派前保留，不进入生产力余额。</p>'+
    (targets.length?'<label>项目<select data-reward-target '+(pending?'disabled':'')+'>'+targets.map(t=>'<option value="'+esc(t.key)+'" '+(t.key===selected?'selected':'')+'>'+esc(t.label)+'</option>').join('')+'</select></label><p class="reward-allocation">'+(target?.buildingId?'剩余需求约 '+Math.ceil(target.remaining):'新建需求 '+target?.remaining)+' 生产力'+(overflow>0?'；本次超出的 '+Math.ceil(overflow)+(r.source==='wonder-competition'?' 生产力继续保留':' 生产力不会保留'):'')+'</p><button class="ui-button ui-button--primary" data-apply-reward '+(pending?'disabled':'')+'>'+(pending?'正在投入…':target?.buildingId?'投入项目':'新建并投入')+'</button>':'<p>当前没有可用项目或建筑槽位。请获得可建设领地后回到这里指派，奖励会保留。</p>')+'</section>':'')+
   (r?.kind==='research'?researchRewardMarkup(getState(),r,pending):'')+'</div>';
 }
 function open(rewardId){if(!getState()?.setupComplete)return;if(typeof rewardId==='string')currentRewardId=rewardId;activateStandardWindow(root);render();}
 function update(){
  const list=rewards();trigger.hidden=!getState()?.setupComplete||!list.length;trigger.textContent='待处理奖励 '+list.length;
  const unseen=list.find(r=>r.kind==='production'&&r.source!=='wonder-competition'&&!shown.has(r.id));for(const r of list)shown.add(r.id);
  if(unseen){currentRewardId=unseen.id;open();}else render();
  if(!getState()?.setupComplete){shown=new Set();close();}
 }
 root.addEventListener('change',e=>{if(e.target.matches('[data-reward-target]')){selected=e.target.value;render();}});
 root.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.rewardId){currentRewardId=b.dataset.rewardId;render();return;}
  if(b.hasAttribute('data-apply-research-reward')){
   const job=getState()?.formationResearch?.active;if(pending||!job)return;
   const rewardId=currentRewardId;pending=true;render();
   try{const v=await getRequest()('/api/campaign/rewards/research',{method:'POST',body:{rewardId,jobId:job.id}});campaignStore.setState(v.state,{source:'neutral-research'});onState(v.state);showToast(v.researchCompleted?(v.reward?.status==='pending'?'研究已完成，剩余奖励已保留':'研究已完成'):'研究进度已投入');if(!rewards().length)close();}
   catch(error){showToast(error.message);try{const v=await getRequest()('/api/campaign/state');campaignStore.setState(v.state,{source:'reward-refresh'});onState(v.state);}catch{}}
   finally{pending=false;render();}return;
  }
  if(!b.hasAttribute('data-apply-reward')||pending)return;
  const target=productionTargets(getState(),territoryLabel).find(t=>t.key===selected);if(!target)return;
  const rewardId=currentRewardId;pending=true;render();
  try{const {key,label,remaining,...body}=target;const v=await getRequest()('/api/campaign/rewards/production',{method:'POST',body:{...body,rewardId}});
   campaignStore.setState(v.state,{source:'neutral-production'});onState(v.state);showToast('生产力已投入建设项目');if(!rewards().length)close();
  }catch(error){showToast(error.message);try{const v=await getRequest()('/api/campaign/state');campaignStore.setState(v.state,{source:'reward-refresh'});onState(v.state);}catch{}}
  finally{pending=false;render();}
 });
 registerStandardWindow(root,{onRequestClose:close});trigger.addEventListener('click',open);
 campaignStore.subscribe(update);update();return {open,close,update};
}
