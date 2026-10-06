import {S4_ENHANCEMENT} from '../../shared/config/enhancement.mjs';
import {playerCardMarkup,escapePlayerCardHtml as esc} from '../player-card/player-card.js';
import {roleGroup} from '../../engine/s4-v2.1/game/public/schema.js';
export const warehouseFilters=()=>({search:'',grade:'all',position:'all',upgradeLevel:'all',nationality:'all',usable:false,count:24});
export function warehouseEntries(cards,filter={},canOperate=p=>!p.blocked){
 const f={...warehouseFilters(),...filter},text=f.search.trim().toLowerCase();
 return cards.filter(p=>(f.grade==='all'||p.grade===f.grade)&&(f.position==='all'||roleGroup(p.role)===f.position)&&(f.upgradeLevel==='all'||Number(p.upgradeLevel??0)===Number(f.upgradeLevel))&&(f.nationality==='all'||p.nationality===f.nationality)&&(!f.usable||canOperate(p))&&(!text||[p.name,p.sourceName,p.club,p.nationality,p.ownerName].join(' ').toLowerCase().includes(text)));
}
export function cardWarehouseMarkup(cards,{key,states={},action=()=>'',selected=()=>false,pending=false,canOperate=p=>!p.blocked}={}){
 const f=states[key]??=warehouseFilters(),items=warehouseEntries(cards,f,canOperate);
 const options=(field,label,values)=>`<select aria-label="${label}" data-warehouse-filter="${field}" ${pending?'disabled':''}>${[['all',field==='upgradeLevel'?'全部等级':label],...values].map(([v,n])=>`<option value="${esc(v)}" ${String(f[field])===String(v)?'selected':''}>${esc(n)}</option>`).join('')}</select>`;
 return `<section class="social-card-warehouse" data-warehouse="${esc(key)}" data-ui-key="warehouse:${esc(key)}"><div class="social-warehouse-filters ${f.mobileExpanded?'is-expanded':''}"><input type="search" aria-label="搜索球员" placeholder="姓名、俱乐部、国家、提供方" data-warehouse-filter="search" value="${esc(f.search)}" ${pending?'disabled':''}><button type="button" class="social-warehouse-expand" data-warehouse-expand aria-expanded="${!!f.mobileExpanded}" ${pending?'disabled':''}>${f.mobileExpanded?'收起筛选':'筛选'}</button>${options('grade','评级',['X','S','A','B','C'].map(v=>[v,v]))}${options('position','位置',[['GK','门将'],['DEF','后卫'],['MID','中场'],['ATT','前锋']])}<label class="social-upgrade-filter"><span>强化等级</span>${options('upgradeLevel','强化等级',Array.from({length:S4_ENHANCEMENT.maxLevel+1},(_,i)=>[i,i===0?'未强化':'+'+i]))}</label>${options('nationality','国家',[...new Set(cards.map(p=>p.nationality).filter(Boolean))].sort().map(v=>[v,v]))}<label><input type="checkbox" data-warehouse-filter="usable" ${f.usable?'checked':''} ${pending?'disabled':''}>仅可操作</label><button type="button" data-warehouse-reset ${pending?'disabled':''}>重置</button></div><div class="social-warehouse-count">${items.length} / ${cards.length} 张${cards.some(selected)?` · 已选 ${cards.filter(selected).length} 张`:''}</div><div class="social-warehouse-scroll" data-warehouse-scroll tabindex="0"><div class="cm-card-grid social-warehouse-grid">${items.slice(0,f.count).map(p=>`<article class="cm-card social-warehouse-card ${selected(p)?'is-selected':''}" data-ui-key="${esc(p.id??p.playerId)}">${playerCardMarkup({...p,playerId:p.id??p.playerId},{variant:'standard',animated:false,deferred:true})}<strong>${esc(p.name)}</strong>${p.ownerName?`<small>${esc(p.ownerName)}</small>`:''}${p.blocked?`<small class="social-card-blocked">${esc(p.blocked)}</small>`:''}<div class="social-card-action">${action(p)}</div></article>`).join('')||'<p class="cm-empty">没有符合条件的球员卡</p>'}</div>${items.length>f.count?`<button type="button" class="social-warehouse-more" data-warehouse-more ${pending?'disabled':''}>加载更多（已显示 ${Math.min(f.count,items.length)} / ${items.length}）</button>`:''}</div></section>`;
}
export function bindWarehouseControls(root,states,render,isPending=()=>false){
 function change(e){const node=e.target;if(!node.matches?.('[data-warehouse-filter]')||isPending())return;
  if(e.type==='input'&&node.type!=='search'||e.type==='change'&&node.type==='search')return;
  const pane=node.closest('[data-warehouse]'),key=pane.dataset.warehouse,f=states[key]??=warehouseFilters();
  f[node.dataset.warehouseFilter]=node.type==='checkbox'?node.checked:node.value;f.count=24;
  pane.querySelector('[data-warehouse-scroll]').scrollTop=0;render();
 }
 root.addEventListener('input',change);root.addEventListener('change',change);
 root.addEventListener('click',e=>{const button=e.target.closest?.('[data-warehouse-more],[data-warehouse-reset],[data-warehouse-expand]');if(!button||isPending())return;
  const pane=button.closest('[data-warehouse]'),key=pane.dataset.warehouse;
  if(button.hasAttribute('data-warehouse-expand')){const f=states[key]??=warehouseFilters();f.mobileExpanded=!f.mobileExpanded;}else if(button.hasAttribute('data-warehouse-reset')){states[key]=warehouseFilters();pane.querySelector('[data-warehouse-scroll]').scrollTop=0;}else(states[key]??=warehouseFilters()).count+=24;
  render();
 });
}
