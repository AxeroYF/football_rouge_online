import {createPlayerFilter} from '../player-card/player-filter.js';
import {bindCardTransferDrag} from './card-transfer-drag.js';
import {playerCardMarkup} from '../player-card/player-card.js';
import {createBatchDraft,squadOf} from './team-batch-model.js';
import {createRequestId} from '../core/request-id.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const names={expedition:'远征',garrison:'留守'};
export function createTeamBatchController({panel,getCampaignState,getCampaignRequest,campaignStore,showToast,renderHost,onDetail}){
 let unbindDrag=()=>{},limits={expedition:36,garrison:36};
 let draft=null,pending=false,error='',selected=new Set(),tab='expedition',filters={search:'',position:'',club:'',nationality:'',min:'',upgrade:''},filtersOpen=false,review=null,leave=null,requestId=null,owner=null,epoch=0;
 const identity=()=>getCampaignState()?.playerId??getCampaignState()?.world?.viewerId??null;
 const reset=()=>{limits={expedition:36,garrison:36};epoch++;draft=null;pending=false;error='';selected.clear();review=null;leave=null;requestId=null;};
 const ensureOwner=()=>{if(owner!==identity()){reset();owner=identity();}};
 const changed=()=>draft?.changes()??[];
 const invalidate=()=>{review=null;requestId=null;error='';};
 const draw=()=>renderHost();
 async function load(){ensureOwner();if(pending)return;pending=true;error='';draw();const token=epoch,account=owner;
  try{const data=await getCampaignRequest()('/api/campaign/squads/batch');if(token!==epoch||account!==identity())return;
   if(draft){const missing=draft.refresh(data.snapshot);if(missing.length)error=`${missing.length} 名球员已离队或代表卡变化，其调整已移除，请重新选择。`;}else draft=createBatchDraft(data.snapshot);
   selected=new Set([...selected].filter(id=>data.snapshot.players.some(p=>p.id===id)&&!data.snapshot.locks[id]));review=null;requestId=null;
  }catch(e){if(token===epoch)error=e.message||'读取编队失败';}finally{if(token===epoch){pending=false;draw();}}
 }
 const starters=squad=>{const value=draft?.base.tactics?.squads?.[squad]??(squad==='expedition'?draft?.base.tactics:null);return value?.planSnapshots?.__s4V2?.starters??value?.starters??[];};
 const visible=squad=>{const matches=createPlayerFilter(filters);return (draft?.base.players??[]).filter(p=>squadOf(draft.assignments,p.id)===squad&&matches(p));};
 const displayed=()=>['expedition','garrison'].flatMap(visible);
 const count=squad=>draft.base.players.filter(p=>squadOf(draft.assignments,p.id)===squad).length;
 function body(){return {version:draft.base.version,changes:changed()};}
 async function preview(){if(pending||!changed().length)return;pending=true;error='';draw();const token=epoch,account=owner;
  try{const data=await getCampaignRequest()('/api/campaign/squads/batch-preview',{method:'POST',body:body()});if(token===epoch&&account===identity())review=data;}
  catch(e){if(token===epoch)error=e.message||'检查失败，草稿已保留';}finally{if(token===epoch){pending=false;draw();}}
 }
 async function save(){if(pending||!review)return;pending=true;error='';requestId??=createRequestId();const payload={...body(),requestId},token=epoch,account=owner;draw();
  try{const data=await getCampaignRequest()('/api/campaign/squads/batch',{method:'POST',body:payload});if(token!==epoch||account!==identity())return;
   draft=createBatchDraft(data.snapshot);selected.clear();review=null;requestId=null;
   campaignStore?.setState({...getCampaignState(),...data.statePatch},{source:'player-squad-batch'});showToast('编队已保存');const action=leave;leave=null;if(action)action();
  }catch(e){if(token===epoch){error=e.message||'保存失败，草稿已保留';if(e.status===409||e.statusCode===409)review=null;}}
  finally{if(token===epoch){pending=false;draw();}}
 }
 function requestLeave(action){if(pending){showToast('正在处理编队，请稍候');return false;}if(changed().length){leave=action;review=null;draw();return false;}action();return true;}
 function markup(){unbindDrag();ensureOwner();if(!draft)return `<div class="team-batch-loading">${pending?'正在读取编队…':esc(error||'读取编队后开始批量调整')}<button data-batch-load ${pending?'disabled':''}>重试</button></div>`;
  const changes=changed(),exp=count('expedition'),hiddenSelected=[...selected].filter(id=>!displayed().some(p=>p.id===id)).length;
  const options=(key,values,label)=>`<label>${label}<select data-batch-filter="${key}"><option value="">全部</option>${values.map(v=>`<option value="${esc(v)}" ${filters[key]===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
  const values=key=>[...new Set(draft.base.players.map(p=>p[key]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'zh-CN'));
  const summaries=['expedition','garrison'].map(s=>{const list=draft.base.players.filter(p=>squadOf(draft.assignments,p.id)===s);return `<button data-batch-tab="${s}" aria-pressed="${tab===s}"><b>${names[s]} ${list.length}${s==='expedition'?'/22':''}</b><small>${['GK','DEF','MID','ATT'].map((pool,i)=>`${['门','后','中','前'][i]} ${list.filter(p=>p.pool===pool).length}`).join(' · ')}</small></button>`;}).join('');
  const columns=['expedition','garrison'].map(s=>`<section class="team-batch-column" data-batch-column="${s}"><header><b>${names[s]}球员</b><button data-batch-select-all="${s}" ${pending?'disabled':''}>选择筛选结果 ${visible(s).filter(p=>!draft.base.locks[p.id]).length} 人</button></header><div class="team-batch-list" data-ui-key="batch-list-${s}">${visible(s).slice(0,limits[s]).map(p=>{
   const changed=squadOf(draft.base.assignments,p.id)!==s,lock=draft.base.locks[p.id];
   return `<article class="team-batch-card ${selected.has(p.id)?'is-selected':''} ${changed?'is-changed':''} ${lock?'is-locked':''}" data-batch-row="${esc(p.id)}" data-ui-key="batch-${s}-${esc(p.id)}"><div class="team-batch-card-top"><input type="checkbox" data-batch-select="${esc(p.id)}" aria-label="选择${esc(p.name)}" ${selected.has(p.id)?'checked':''} ${pending||lock?'disabled':''}><button type="button" data-card-drag aria-label="拖动${esc(p.name)}调队" ${pending||lock?'disabled':''}>⠿</button><span>${lock?esc(lock):changed?'待调入'+names[s]:names[s]+' · '+(starters(squadOf(draft.base.assignments,p.id)).includes(p.id)?'首发':'替补')}</span></div>${playerCardMarkup(p,{variant:'mini',animated:false,deferred:true,className:'team-batch-card-art'})}<div class="team-batch-card-bottom"><button data-batch-detail="${esc(p.id)}" aria-label="查看${esc(p.name)}详情"><strong>${esc(p.name)}</strong><small>${esc(p.role)}${p.secondaryRole?' / '+esc(p.secondaryRole):''} · 详情</small></button>${changed?`<button data-batch-revert="${esc(p.id)}" ${pending?'disabled':''}>撤销</button>`:''}</div></article>`;
  }).join('')||'<p class="team-batch-empty">没有符合条件的球员</p>'}${visible(s).length>limits[s]?`<button data-batch-more="${s}" style="grid-column:1/-1">继续显示（${limits[s]} / ${visible(s).length}）</button>`:''}</div></section>`).join('');
  const warning=['expedition','garrison'].flatMap(s=>{const players=draft.base.players.filter(p=>squadOf(draft.assignments,p.id)===s);return players.length<11?[`${names[s]}不足 11 人`]:!players.some(p=>p.pool==='GK')?[`${names[s]}没有门将`]:[];}).join('；');
  const name=id=>esc(draft.base.players.find(p=>p.id===id)?.name??id);
  let dialog='';
  if(review||leave)dialog=`<div class="team-batch-modal"><section role="dialog" aria-modal="true" aria-label="${review?'检查编队调整':'未保存的编队'}"><h3>${review?'检查编队调整':'有未保存的调整'}</h3>${review?`<p>调入远征 ${changes.filter(c=>c.squadId==='expedition').length} 人 · 调入留守 ${changes.filter(c=>c.squadId==='garrison').length} 人</p>${review.lineupChanges.map(c=>`<p><b>${names[c.squad]}首发</b><br>调出：${c.removed.map(name).join('、')||'无'}<br>预计补位：${c.added.map(name).join('、')||'无'}${c.remaining<11?`<br>当前已设置首发 ${c.remaining} 人`:''}</p>`).join('')}<small>保留现有阵型、站位，按最终名单统一补位。</small>`:'<p>保存后调整才会生效。可以继续编辑或放弃本次调整。</p>'}${error?`<p role="alert">${esc(error)}</p>`:''}<footer><button data-batch-continue ${pending?'disabled':''}>继续编辑</button>${!review?`<button data-batch-discard-leave>放弃调整</button>`:''}<button ${review?'data-batch-save':'data-batch-preview'} ${pending||exp>22?'disabled':''}>${pending?'处理中…':review?`保存 ${changes.length} 人调整`:'保存并继续'}</button></footer></section></div>`;
  return `<div class="team-batch-toolbar"><input data-batch-filter="search" value="${esc(filters.search)}" placeholder="搜索姓名、俱乐部或国家" aria-label="搜索球员"><details ${filtersOpen?'open':''} data-batch-filters><summary>筛选</summary><div>${options('position',[...new Set(draft.base.players.flatMap(p=>[p.role,p.secondaryRole]).filter(Boolean))].sort(),'位置')}${options('club',values('club'),'俱乐部')}${options('nationality',values('nationality'),'国家队')}<label>最低能力<input type="number" data-batch-filter="min" value="${esc(filters.min)}" min="0" max="99"></label>${options('upgrade',['0','1','2','3','4','5','6','7','8'],'强化等级')}<button data-batch-clear-filters>清空筛选</button></div></details><button data-batch-load ${pending?'disabled':''}>刷新并保留草稿</button></div><div class="team-batch-summary">${summaries}</div><div class="team-batch-board" data-active-squad="${tab}">${columns}</div><footer class="team-batch-footer"><div class="team-batch-selection">已选 ${selected.size} 人${hiddenSelected?`（${hiddenSelected} 人不在当前结果中）`:''}<button data-batch-clear-selection ${pending?'disabled':''}>清空选择</button><button data-batch-move="expedition" ${pending||!selected.size?'disabled':''}>调入远征</button><button data-batch-move="garrison" ${pending||!selected.size?'disabled':''}>调入留守</button></div><div class="team-batch-savebar"><span>${exp>22?`远征 ${exp}/22，需调出 ${exp-22} 人`:warning||'调整仅在保存后生效'}<strong> · ${changes.length} 人待调整</strong></span><button data-batch-undo ${pending||!draft.canUndo?'disabled':''}>撤销上一步</button><button data-batch-reset ${pending||!changes.length?'disabled':''}>放弃全部</button><button data-batch-preview ${pending||!changes.length||exp>22?'disabled':''}>${pending?'处理中…':'检查并保存'}</button></div>${error&&!dialog?`<p class="team-batch-error" role="alert">${esc(error)}</p>`:''}<details class="team-batch-changes"><summary>查看 ${changes.length} 人调整</summary>${changes.map(c=>`<p>${name(c.playerId)} → ${names[c.squadId]} <button data-batch-revert="${esc(c.playerId)}" ${pending?'disabled':''}>撤销</button></p>`).join('')}</details></footer>${dialog}`;
 }
 function bind(){
  unbindDrag=bindCardTransferDrag(panel,{cardSelector:'[data-batch-row]',columnSelector:'[data-batch-column]',canDrag:card=>!pending&&!review&&!leave&&!draft?.base.locks[card.dataset.batchRow],onDrop:(card,column)=>{if(pending)return;const id=card.dataset.batchRow,target=column.dataset.batchColumn;if(squadOf(draft.assignments,id)===target)return;draft.move(selected.has(id)?selected:[id],target);selected.clear();invalidate();draw();}});

  const modal=panel.querySelector('.team-batch-modal section');
  panel.querySelectorAll('.team-batch-shell>header,.team-batch-toolbar,.team-batch-summary,.team-batch-board,.team-batch-footer').forEach(el=>{el.inert=Boolean(modal);});
  if(modal){
   modal.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!pending){review=null;leave=null;draw();}}else if(e.key==='Tab'){const buttons=[...modal.querySelectorAll('button:not(:disabled)')];if(!buttons.length){e.preventDefault();return;}const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
   if(!modal.contains(panel.ownerDocument.activeElement))queueMicrotask(()=>modal.querySelector('button:not(:disabled)')?.focus());
  }
  panel.querySelectorAll('[data-batch-filter]').forEach(el=>{el[el.tagName==='SELECT'?'onchange':'oninput']=()=>{filters[el.dataset.batchFilter]=el.value;limits={expedition:36,garrison:36};draw();};});
  const detail=panel.querySelector('[data-batch-filters]');if(detail)detail.querySelector('summary').onclick=e=>{e.preventDefault();filtersOpen=!filtersOpen;draw();};
  panel.querySelectorAll('[data-batch-select]').forEach(el=>el.onchange=()=>{if(pending)return;el.checked?selected.add(el.dataset.batchSelect):selected.delete(el.dataset.batchSelect);draw();});
  panel.querySelectorAll('[data-batch-row]').forEach(el=>el.onclick=e=>{if(e.target.closest('button,input')||pending)return;const input=el.querySelector('input');if(!input.disabled){input.checked=!input.checked;input.onchange();}});
  panel.querySelectorAll('button').forEach(el=>{const d=el.dataset;if(d.batchDetail)el.onclick=()=>onDetail(d.batchDetail);
   else if(d.batchMore)el.onclick=()=>{limits[d.batchMore]+=36;draw();};
   else if(d.batchTab)el.onclick=()=>{tab=d.batchTab;draw();};
   else if('batchLoad'in d)el.onclick=load;
   else if(d.batchSelectAll)el.onclick=()=>{if(pending)return;visible(d.batchSelectAll).filter(p=>!draft.base.locks[p.id]).forEach(p=>selected.add(p.id));draw();};
   else if(d.batchMove)el.onclick=()=>{if(pending)return;draft.move(selected,d.batchMove);selected.clear();invalidate();draw();};
   else if(d.batchRevert)el.onclick=()=>{if(pending)return;draft.revert(d.batchRevert);invalidate();draw();};
   else if('batchClearSelection'in d)el.onclick=()=>{selected.clear();draw();};
   else if('batchClearFilters'in d)el.onclick=()=>{Object.keys(filters).forEach(k=>filters[k]='');draw();};
   else if('batchUndo'in d)el.onclick=()=>{draft.undo();invalidate();draw();};
   else if('batchReset'in d)el.onclick=()=>requestLeave(()=>{draft.reset();selected.clear();invalidate();draw();});
   else if('batchPreview'in d)el.onclick=preview;
   else if('batchSave'in d)el.onclick=save;
   else if('batchContinue'in d)el.onclick=()=>{review=null;leave=null;draw();};
   else if('batchDiscardLeave'in d)el.onclick=()=>{draft.reset();selected.clear();invalidate();const action=leave;leave=null;action?.();draw();};
  });
 }
 return {markup,bind,load,ensureOwner,requestLeave,reset,get loaded(){return Boolean(draft);},get dirty(){return changed().length>0;},get pending(){return pending;}};
}
