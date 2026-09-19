import {researchLevelsFor,researchLevelPreview} from '../../shared/config/research-preview.mjs';
import {advancedResearchLevel,ADVANCED_RESEARCH_WORK} from '../../shared/config/advanced-research.mjs';
import {researchProgress,researchRemainingTime} from '../../shared/config/formation-research.mjs';
import {researchArt} from './research-art.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createTopicResearchController({root,topic,getState,campaignStore,getRequest}){
 const events=new AbortController();let busy=false,disposed=false,key='',offset=0,previewLevel=1,message='';const accountId=getState()?.playerId;
 const server=()=>getState()?.formationResearch;
 const level=()=>advancedResearchLevel({formationResearch:server()},topic.id);
 const bonus=l=>l?researchLevelPreview(topic,l).bonus:0;
 const enhance=topic.branch==='enhancement',unit=enhance?'个百分点':'%';
 function render(){
  if(disposed)return;const data=server(),current=level(),max=researchLevelsFor(topic).length,job=data?.active,mine=job?.topicId===topic.id;
  const next=Math.min(max,current+1),cost=data?.topicRequirements?.[topic.branch]?.[previewLevel-1]??ADVANCED_RESEARCH_WORK[topic.branch][previewLevel-1];
  const nextKey=JSON.stringify([current,job?.id,busy,previewLevel,message,cost]);
  if(nextKey!==key){key=nextKey;
   root.innerHTML=`<div class="research-selected-object"><div class="research-subject-art">${researchArt(topic)}</div><div><h2>${esc(topic.label)}${enhance?` → +${topic.target}`:''}</h2><p>${enhance?`主卡 +${topic.main} · 材料 +${topic.material}`:'降低远征队球员比赛体能消耗'}</p></div><div class="research-subject-level"><small>研究等级</small><strong>Lv.${current}</strong><span>${enhance?`成功率 ${Math.min(100,topic.baseChance+bonus(current))}%`:`体能消耗 −${bonus(current)}%`}</span></div></div>
   <div class="research-route-header"><h3>等级成长</h3></div><div class="research-level-scroller"><div class="research-level-route">${researchLevelsFor(topic).map(l=>`<button type="button" class="research-level-node" data-topic-level="${l}" aria-pressed="${l===previewLevel}"><span class="research-level-badge">${l}</span><small>${l<=current?'已完成':`等级 ${l}`}</small><strong>${enhance?'+':'−'}${bonus(l)}<em>${unit}</em></strong><span>${enhance?'成功率增益':'比赛体能消耗'}</span></button>`).join('')}</div></div>
   <section class="research-level-detail"><div class="research-level-detail-heading"><span>等级 ${previewLevel}</span><h3>${enhance?'强化成功率':'比赛体能消耗'}</h3><strong>${enhance?`${topic.baseChance}% → ${Math.min(100,topic.baseChance+bonus(previewLevel))}%`:`−${bonus(previewLevel)}%`}</strong></div><div class="research-level-detail-body"><dl><div><dt>科技需求</dt><dd>${cost}</dd></div><div><dt>前置等级</dt><dd>${previewLevel===1?'无':previewLevel-1}</dd></div></dl></div></section>
   <div class="formation-research-requirement"><span>${current>=max?'研究已满级':`Lv.${current} → Lv.${next}`}</span><b>${enhance?`成功率 ${Math.min(100,topic.baseChance+bonus(current))}% → ${Math.min(100,topic.baseChance+bonus(next))}%`:`体能减耗 ${bonus(current)}% → ${bonus(next)}%`}</b></div>
   ${mine?'<div class="formation-progress-labels"><span data-topic-work></span><b data-topic-percent></b></div><div class="formation-progress-track" role="progressbar" aria-label="研究进度" aria-valuemin="0" aria-valuemax="100"><i></i></div>':''}
   <div class="formation-research-timing"><span data-topic-speed></span><span data-topic-time></span></div>
   <div class="formation-research-actions"><button type="button" class="research-start" data-topic-start ${busy||job||current>=max?'disabled':''}>${current>=max?'已达最高等级':mine?'研究中':job?'其他方向研究中':`研究 Lv.${next} · ${(data?.topicRequirements?.[topic.branch]??ADVANCED_RESEARCH_WORK[topic.branch])[current]} 科技`}</button>${mine?`<button type="button" class="formation-cancel" data-topic-cancel ${busy?'disabled':''}>中止研究</button>`:''}</div><p class="research-topic-status" role="status">${esc(message)}</p>`;
  }
  const rate=data?.sciencePerMinute??0,progress=mine?researchProgress(job,Date.now()+offset):null;
  root.querySelector('[data-topic-speed]').textContent=current>=max?'':`科技 ${Number(rate.toFixed(2))}/分钟`;
  root.querySelector('[data-topic-time]').textContent=current>=max?'':progress?researchRemainingTime(progress.remaining):job?'':researchRemainingTime(rate>0?(data?.topicRequirements?.[topic.branch]??ADVANCED_RESEARCH_WORK[topic.branch])[current]/rate*60000:null).replace('剩余','预计');
  if(progress){root.querySelector('[data-topic-work]').textContent=`${progress.completed.toFixed(1)} / ${job.required}`;root.querySelector('[data-topic-percent]').textContent=`${Math.floor(progress.percent)}%`;const bar=root.querySelector('.formation-progress-track');bar.setAttribute('aria-valuenow',String(Math.floor(progress.percent)));bar.querySelector('i').style.width=progress.percent+'%';}
 }
 async function action(kind){
  if(busy)return;busy=true;message='';render();
  try{const value=await getRequest()('/api/campaign/research/'+kind,{method:'POST',body:{revision:server()?.revision,topicId:topic.id,jobId:server()?.active?.id}});if(getState()?.playerId!==accountId)return;campaignStore.setState(value.state,{source:'topic-research'});message=kind==='cancel'?'研究已中止':'研究已开始';}
  catch(e){message=e.message||'操作失败，请重试';}finally{busy=false;render();}
 }
 root.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.dataset.topicLevel){previewLevel=Number(el.dataset.topicLevel);render();}if(el.hasAttribute('data-topic-start'))action('start-topic');if(el.hasAttribute('data-topic-cancel')&&confirm('中止本级研究？本级进度将清零，已完成等级保留。'))action('cancel');},{signal:events.signal});
 const merge=()=>{offset=(server()?.serverNow??Date.now())-Date.now();render();};
 previewLevel=Math.min(researchLevelsFor(topic).length,level()+1);const unsubscribe=campaignStore.subscribe(merge),timer=setInterval(render,1000);merge();
 return {dispose(){disposed=true;unsubscribe();clearInterval(timer);events.abort();}};
}
