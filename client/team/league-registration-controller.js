import {createPlayerFilter} from '../player-card/player-filter.js';
import {bindCardTransferDrag} from './card-transfer-drag.js';
import {representativePlayers} from '../../shared/config/representative-players.mjs';
import {playerCardMarkup} from '../player-card/player-card.js';
import {enhancementFamily} from '../../shared/config/enhancement.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
export function createLeagueRegistrationController({panel,getCampaignState,getCampaignRequest,campaignStore,showToast,renderHost,onDetail}){
 let limit=36,filteredIds=[];
 let ids=null,base='',owner=null,pending=false,error='',leave=null,search='',position='',club='',nationality='',selected=new Set(),unbindDrag=()=>{};
 const identity=()=>getCampaignState()?.playerId;
 const registration=()=>getCampaignState()?.leagueRegistration;
 const players=()=>getCampaignState()?.draft?.roster??[];
 const uniquePlayers=()=>{const all=players(),registered=new Map(all.filter(p=>ids?.has(p.id)).map(p=>[enhancementFamily(p),p]));return representativePlayers(all).map(p=>registered.get(enhancementFamily(p))??p);};
 function move(playerIds,target){if(pending||registration()?.locked)return;
  if(target==='all'){for(const id of playerIds)ids.delete(id);}else{const byId=new Map(players().map(p=>[p.id,p]));for(const id of playerIds){if(ids.has(id)||!byId.has(id))continue;if(ids.size>=23){showToast('最多注册 23 人');break;}const p=byId.get(id);if([...ids].some(other=>byId.has(other)&&enhancementFamily(byId.get(other))===enhancementFamily(p)))continue;ids.add(id);}}
  selected.clear();renderHost();
 }
 const dirty=()=>ids!==null&&JSON.stringify([...ids])!==base;
 function ensure(){if(owner!==identity()){owner=identity();limit=36;ids=null;error='';leave=null;pending=false;selected.clear();}
  if(ids===null&&registration()){ids=new Set(registration().playerIds);base=JSON.stringify([...ids]);}
 }
 function reset(){selected.clear();ids=new Set(registration()?.playerIds??[]);base=JSON.stringify([...ids]);error='';}
 async function save(){ensure();if(pending||!dirty())return;if(registration()?.locked)return showToast('联赛期间不能更改名单');
  pending=true;error='';renderHost();const account=owner;
  try{const value=await getCampaignRequest()('/api/campaign/league/registration',{method:'POST',body:{playerIds:[...ids],version:base}});if(account!==identity())return;
   campaignStore.setState({...getCampaignState(),leagueRegistration:value.registration});reset();showToast('联赛注册名单已保存');
  }catch(e){if(account===identity())error=e.message||'保存失败，请重试';}finally{if(account===identity()){pending=false;renderHost();}}
 }
 function requestLeave(action){if(pending){showToast('正在保存，请稍候');return false;}if(dirty()){leave=action;renderHost();return false;}action();return true;}
 function markup(){unbindDrag();ensure();if(!ids)return '<p class="team-batch-loading">正在读取联赛注册名单…</p>';
  if(!dirty()&&base!==JSON.stringify(registration()?.playerIds??[]))reset();
  const locked=registration()?.locked||pending,all=uniquePlayers(),owned=new Set(all.map(p=>p.id)),missing=[...ids].filter(id=>!owned.has(id));
  const available=all.filter(p=>!ids.has(p.id)),eligible=available.filter(createPlayerFilter({search,position,club,nationality},{includeSourceName:false}));
  filteredIds=eligible.map(p=>p.id);
  const select=(key,label,value,values)=>`<select data-registration-filter="${key}" aria-label="${label}"><option value="">全部${label}</option>${[...new Set(values.filter(Boolean))].sort().map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
  const card=(p,side)=>`<article class="team-batch-card ${selected.has(p.id)?'is-selected':''}" data-registration-card="${esc(p.id)}" data-ui-key="registration-${side}-${esc(p.id)}"><div class="team-batch-card-top"><input type="checkbox" data-registration-select="${esc(p.id)}" aria-label="选择${esc(p.name)}" ${selected.has(p.id)?'checked':''} ${locked?'disabled':''}><button type="button" data-card-drag aria-label="拖动${esc(p.name)}" ${locked?'disabled':''}>⠿</button><span>${ids.has(p.id)?'已注册':esc(p.role)}</span></div>${playerCardMarkup(p,{variant:'mini',animated:false,deferred:true,className:'team-batch-card-art'})}<div class="team-batch-card-bottom"><button data-registration-detail="${esc(p.id)}"><strong>${esc(p.name)}</strong><small>${esc(p.role)} · +${p.upgradeLevel??0} · 详情</small></button></div></article>`;
  const columns=['all','registered'].map(side=>{const list=side==='all'?eligible:all.filter(p=>ids.has(p.id));return `<section class="team-batch-column" data-registration-column="${side}"><header><b>${side==='all'?'可选球员':'联赛注册'} ${side==='all'?eligible.length+' / '+available.length:ids.size+' / 23'}</b><button data-registration-select-all="${side}" ${locked?'disabled':''}>${side==='all'?'选择筛选结果':'选择已注册球员'}</button></header><div class="team-batch-list league-registration-list" data-ui-key="registration-list-${side}">${list.slice(0,side==='all'?limit:23).map(p=>card(p,side)).join('')||'<p class="team-batch-empty">暂无球员</p>'}${side==='all'&&list.length>limit?`<button data-registration-more style="grid-column:1/-1">继续显示（${limit} / ${list.length}）</button>`:''}</div></section>`;}).join('');
  return `<div class="league-registration-toolbar"><input data-registration-filter="search" value="${esc(search)}" placeholder="筛选左侧可选球员" aria-label="搜索球员">${select('position','位置',position,all.flatMap(p=>[p.role,p.secondaryRole]))}${select('club','俱乐部',club,all.map(p=>p.club))}${select('nationality','国家队',nationality,all.map(p=>p.nationality))}</div><div class="league-registration-status"><strong>已注册 ${ids.size} / 23</strong><span>${registration()?.locked?'联赛进行中 · 名单锁定':'拖动或勾选加入 · 体力伤病独立'}</span></div><div class="league-registration-board">${columns}</div><footer class="team-batch-footer"><div class="team-batch-selection">已选 ${selected.size} 人<button data-registration-add ${locked||!selected.size?'disabled':''}>加入联赛 →</button><button data-registration-remove ${locked||!selected.size?'disabled':''}>← 移出联赛</button><button data-registration-clear ${!selected.size?'disabled':''}>清空选择</button></div><div class="team-batch-savebar"><span>${missing.length?`${missing.length} 名球员已离队，请重置`:registration()?.locked?'联赛期间名单锁定':dirty()?'有未保存修改':ids.size<11?'不足 11 人，可能无法正常出战':'名单自动沿用'}</span><button data-registration-reset ${pending?'disabled':''}>重置</button><button data-registration-save ${locked||!dirty()||missing.length?'disabled':''}>${pending?'保存中…':'保存注册'}</button></div>${error?`<p class="team-batch-error" role="alert">${esc(error)}</p>`:''}</footer>${leave?'<div class="team-batch-modal"><section role="dialog" aria-modal="true" aria-label="未保存注册名单"><h3>注册名单尚未保存</h3><p>返回编辑并保存，或放弃本次调整。</p><footer><button data-registration-continue>继续编辑</button><button data-registration-discard>放弃调整</button></footer></section></div>':''}`;
 }
 function bind(){
  panel.querySelectorAll('[data-registration-filter]').forEach(el=>el[el.tagName==='SELECT'?'onchange':'oninput']=()=>{const k=el.dataset.registrationFilter;if(k==='search')search=el.value;if(k==='position')position=el.value;if(k==='club')club=el.value;if(k==='nationality')nationality=el.value;selected.clear();limit=36;renderHost();});
  const more=panel.querySelector('[data-registration-more]');if(more)more.onclick=()=>{limit+=36;renderHost();};
  unbindDrag=bindCardTransferDrag(panel,{cardSelector:'[data-registration-card]',columnSelector:'[data-registration-column]',canDrag:()=>!pending&&!leave&&!registration()?.locked,onDrop:(card,column)=>move(selected.has(card.dataset.registrationCard)?selected:[card.dataset.registrationCard],column.dataset.registrationColumn)});
  panel.querySelectorAll('[data-registration-select]').forEach(el=>el.onchange=()=>{if(pending||registration()?.locked)return;const id=el.dataset.registrationSelect;selected.has(id)?selected.delete(id):selected.add(id);renderHost();});
  panel.querySelectorAll('[data-registration-select-all]').forEach(el=>el.onclick=()=>{if(pending||registration()?.locked)return;(el.dataset.registrationSelectAll==='all'?filteredIds:[...ids]).forEach(id=>selected.add(id));renderHost();});
  panel.querySelectorAll('[data-registration-card]').forEach(el=>el.onclick=e=>{if(e.target.closest('button,input'))return;const input=el.querySelector('input');if(!input.disabled)input.onchange();});
  panel.querySelectorAll('[data-registration-detail]').forEach(el=>el.onclick=()=>onDetail(el.dataset.registrationDetail));
  const on=(key,fn)=>{const el=panel.querySelector(`[data-registration-${key}]`);if(el)el.onclick=fn;};
  on('save',save);on('reset',()=>{reset();renderHost();});on('add',()=>move(selected,'registered'));on('remove',()=>move(selected,'all'));on('clear',()=>{selected.clear();renderHost();});
  on('continue',()=>{leave=null;renderHost();});on('discard',()=>{reset();const action=leave;leave=null;action?.();});
  const modal=panel.querySelector('.team-batch-modal'),shell=panel.querySelector('.league-registration-shell');
  if(shell)for(const child of shell.children)child.inert=Boolean(modal&&child!==modal);
  if(modal){modal.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();leave=null;renderHost();}if(e.key==='Tab'){e.preventDefault();const buttons=[...modal.querySelectorAll('button')];buttons[(buttons.indexOf(document.activeElement)+1)%buttons.length]?.focus();}};if(!modal.contains(document.activeElement))queueMicrotask(()=>modal.querySelector('button')?.focus());}
 }
 return {markup,bind,requestLeave,get pending(){return pending;},get dirty(){return dirty();}};
}
