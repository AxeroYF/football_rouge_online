import {WAGES_PER_HOUR,MAINTENANCE_PER_LEVEL_HOUR,WONDER_MAINTENANCE_PER_HOUR} from '../../shared/config/operating-costs.mjs';
import { FAN_PREFERENCES } from '../../shared/config/fans.mjs';
import { RESOURCE_DEFINITIONS } from '../../shared/config/resources.mjs';
import { resourceAmountMarkup, resourceIconMarkup } from './resource-markup.js?v=20260908-fans-v1';
const format = new Intl.NumberFormat('zh-CN');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const currentCapacity = (state, id) => state?.resources?.current?.[id] ?? state?.resources?.hourly?.[id] ?? 0;

export function fanSourcesMarkup(state, pending = false) {
  const fans=state?.resources?.fans, total=state?.resources?.balances?.fans??0;
  if(!fans)return '<section class="resource-hover-panel"><header><h2>球迷</h2></header><p class="fan-summary">球迷分配暂不可用</p></section>';
  const sources=(state.resources.sources??[]).filter(s=>s.type==='territory').sort((a,b)=>b.fans-a.fans||String(a.label).localeCompare(String(b.label),'zh-CN'));
  return `<section class="resource-hover-panel" aria-label="球迷分配">
    <header><h2>${resourceIconMarkup('fans')}球迷</h2><strong data-resource-total="fans">${format.format(total)}</strong></header>
    <div class="fan-summary"><span>+${format.format(fans.hourlyGrowth)} /小时</span><span>闲置 ${format.format(fans.available)}</span><span>已分配 ${format.format(fans.assigned)} / 需求 ${format.format(fans.required)}</span></div>
    <div class="fan-preferences" role="group" aria-label="球迷分配偏好">${Object.entries(FAN_PREFERENCES).map(([id,label])=>`<button type="button" data-fan-preference="${id}" aria-pressed="${fans.preference===id}" ${pending?'disabled':''}>${label}</button>`).join('')}</div>
    <p class="fan-rule">基础需求每块地 ${format.format(fans.perTerritory)} 球迷，奇观可降低局部需求，缺额按比例产出。${fans.preference==='balanced'?'综合收益按金币、生产力、科技值的价值权重自动择优。':'优先提高所选资源收益，其次比较综合收益。'}每满一小时增长 ${fans.hourlyGrowth} 人。</p>
    <div class="resource-source-scroll" tabindex="0" aria-label="球迷分配明细"><table><thead><tr><th>地块</th><th>球迷 / 利用率</th></tr></thead><tbody>${sources.length?sources.map(s=>`<tr data-fan-territory="${escapeHtml(s.territoryId)}"><td>${escapeHtml(s.label)}</td><td><b>${format.format(s.fans)} / ${format.format(s.fanRequirement)}</b><small>${format.format(s.fans/s.fanRequirement*100)}%</small></td></tr>`).join(''):'<tr><td colspan="2" class="resource-source-empty">暂无已占领地块</td></tr>'}</tbody></table></div>
  </section>`;
}

export function resourceSourcesMarkup(state, id) {
  if(id==='fans')return fanSourcesMarkup(state);


  const definition = RESOURCE_DEFINITIONS[id];
  if (!['gold', 'production', 'science', 'oil'].includes(id)) return '';
  const perHour=id==='gold'||id==='oil';
  const total = id==='oil'?state?.resources?.oil?.hourly??0:id === 'gold' ? state?.resources?.hourly?.gold ?? 0 : currentCapacity(state, id);
  const sources = id==='oil'?state?.resources?.oil?.sources:state?.resources?.sources;
  const rows = (sources ?? []).filter(source => Number.isFinite(source.yields?.[id]) && (perHour?source.yields[id]!==0:source.yields[id]>0))
    .sort((a,b) => b.yields[id] - a.yields[id] || String(a.label).localeCompare(String(b.label), 'zh-CN'));
  return `<section class="resource-hover-panel" aria-label="${definition.name}来源">
    <header><h2>${resourceIconMarkup(id)}${definition.name}</h2><strong data-resource-total="${id}">${perHour&&total>0?'+':''}${format.format(total)}${perHour?' /小时':''}</strong></header>
    <div class="resource-source-scroll" tabindex="0" aria-label="${definition.name}来源明细">
      <table><thead><tr><th scope="col">来源</th><th scope="col">${perHour?'每小时收支':'当前贡献'}</th></tr></thead>
      <tbody>${rows.length ? rows.map(source=>`<tr data-resource-source="${escapeHtml(source.id)}"><td>${escapeHtml(source.label)}${source.details?.length?`<details class="resource-expense-details"><summary>费用明细</summary>${source.details.map(g=>`<small>${escapeHtml(g.label)}：${g.count} × ${g.rate} = ${g.total}/小时</small>`).join('')}</details>`:''}${(source.districtYields??[]).filter(d=>d.operating&&d.resource===id).map(d=>`<small>${escapeHtml(d.name)} LV${d.level} · 基础贡献 +${format.format(d.fullYield*source.fans/source.fanRequirement)}</small>`).join('')}${source.type==='territory'&&source.fanRequirement?`<small>球迷 ${format.format(source.fans)} / ${format.format(source.fanRequirement)}</small>`:''}</td><td data-source-amount="${source.yields[id]}">${source.yields[id]>0?'+':''}${format.format(source.yields[id])}</td></tr>`).join('') : `<tr><td colspan="2" class="resource-source-empty">${Array.isArray(sources)?'暂无来源':'来源明细暂不可用'}</td></tr>`}</tbody></table>
    </div>${id==='gold'&&state?.resources?.expenses?`<p class="resource-expense-rule">工资：C/B/A/S/X 每人每小时 ${Object.values(WAGES_PER_HOUR).join('/')} 金币；同类重复卡只计一次，强化不加薪。普通建筑每级每小时 ${MAINTENANCE_PER_LEVEL_HOUR} 金币，机场每小时 20 金币，奇观 ${WONDER_MAINTENANCE_PER_HOUR} 金币。${state.resources.expenses.discountPercent?'拉莫内达宫减免 '+state.resources.expenses.discountPercent+'%，按减免后费用累计扣款。':''}<br>新建完工起收费，升级中按原等级。服务器运行时按在线及离线时间累计，停服期间暂停收支，满 1 金币扣除；余额不足扣至 0，超额免除，不累积欠款。</p>`:''}</section>`;
}

export function createResourceController({ trigger, windowRoot, getState, setPreference, showToast = () => {}, onOpenOil = () => {} }) {
  const documentRef = trigger.ownerDocument, viewport = documentRef.defaultView;
  const buttons = [...trigger.querySelectorAll('[data-resource-trigger]')];
  let activeId = null, hideTimer = null, renderedKey = '', lastState = getState(), pending = false;
  const stopHide = () => { if (hideTimer !== null) viewport.clearTimeout(hideTimer); hideTimer = null; };
  function close() {
    stopHide(); activeId = null; windowRoot.hidden = true;
    for (const button of buttons) button.setAttribute('aria-expanded','false');
  }
  function position() {
    if (windowRoot.hidden) return;
    const button = buttons.find(b=>b.dataset.resourceTrigger===activeId), rect = button.getBoundingClientRect();
    const width = Math.min(360, viewport.innerWidth - 16);
    const top = trigger.getBoundingClientRect().bottom;
    windowRoot.style.width = width + 'px';
    windowRoot.style.left = Math.max(8, Math.min(rect.right - width, viewport.innerWidth - width - 8)) + 'px';
    windowRoot.style.top = top + 'px';
    windowRoot.style.setProperty('--resource-source-height', Math.max(80, Math.min(360, viewport.innerHeight - top - (activeId==='fans'?265:activeId==='gold'&&lastState?.resources?.expenses?265:106))) + 'px');
  }
  function render() {
    const state = lastState, id = activeId;
    const key = JSON.stringify({id, fans:state?.resources?.fans, balance:state?.resources?.balances?.fans, oil:state?.resources?.oil, pending, sources:state?.resources?.sources, total:id==='gold'?state?.resources?.hourly?.gold:currentCapacity(state,id)});
    if (key === renderedKey) return;
    const scroll = windowRoot.querySelector('.resource-source-scroll');
    const scrollTop = scroll?.scrollTop ?? 0, focused = documentRef.activeElement === scroll;
    const focusedPreference=windowRoot.contains(documentRef.activeElement)?documentRef.activeElement?.dataset?.fanPreference:null;
    windowRoot.innerHTML = id==='fans'?fanSourcesMarkup(state,pending):resourceSourcesMarkup(state,id);
    if(focusedPreference&&!pending)windowRoot.querySelector(`[data-fan-preference="${focusedPreference}"]`)?.focus({preventScroll:true});
    renderedKey = key;
    const nextScroll = windowRoot.querySelector('.resource-source-scroll');
    if (nextScroll) { nextScroll.scrollTop = scrollTop; if (focused) nextScroll.focus({preventScroll:true}); }
  }
  function open(id) {
    if (trigger.hidden || !buttons.some(b=>b.dataset.resourceTrigger===id)) return;
    stopHide();
    if (activeId !== id) { renderedKey = ''; windowRoot.replaceChildren(); }
    activeId = id; render(); windowRoot.hidden = false; position();
    for (const button of buttons) button.setAttribute('aria-expanded', String(button.dataset.resourceTrigger===id));
  }
  function scheduleHide() { stopHide(); if(windowRoot.contains(documentRef.activeElement))return; hideTimer = viewport.setTimeout(close,200); }
  for (const button of buttons) {
    const id=button.dataset.resourceTrigger;
    if(id==='oil')button.addEventListener('click',()=>{close();onOpenOil();});
    button.addEventListener('pointerenter',event=>{ if(event.pointerType!=='touch')open(id); });
    button.addEventListener('pointerleave',event=>{
      if(event.pointerType==='touch')return;
      if(windowRoot.contains(event.relatedTarget))stopHide();else scheduleHide();
    });
    button.addEventListener('focusin',()=>{ if(button.matches(':focus-visible'))open(id); });
    // Touch has no hover. It uses the same compact source popover.
    button.addEventListener('pointerup',event=>{ if(event.pointerType==='touch'&&id!=='oil'){ if(activeId===id&&!windowRoot.hidden)close();else open(id); } });
    button.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();if(id==='oil'){close();onOpenOil();}else open(id);}
    });
  }
  windowRoot.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-fan-preference]');
    if(!button||pending||!setPreference||button.dataset.fanPreference===lastState?.resources?.fans?.preference)return;
    const preference=button.dataset.fanPreference;
    pending=true;render();
    try{await setPreference(preference);lastState=getState();}
    catch(error){showToast(error.message||'球迷分配保存失败');}
    finally{pending=false;if(!windowRoot.hidden){render();position();windowRoot.querySelector(`[data-fan-preference="${lastState?.resources?.fans?.preference}"]`)?.focus({preventScroll:true});}}
  });
  windowRoot.addEventListener('pointerenter',stopHide);
  windowRoot.addEventListener('pointerleave',event=>{ if(event.pointerType!=='touch')scheduleHide(); });
  windowRoot.addEventListener('focusin',stopHide);
  documentRef.addEventListener('focusin',event=>{
    if(!trigger.contains(event.target)&&!windowRoot.contains(event.target))close();
  });
  documentRef.addEventListener('pointerdown',event=>{
    if(!trigger.contains(event.target)&&!windowRoot.contains(event.target))close();
  }, {capture:true});
  documentRef.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!windowRoot.hidden){
      const focusedInside=windowRoot.contains(documentRef.activeElement);
      const button=buttons.find(b=>b.dataset.resourceTrigger===activeId);
      if(focusedInside)button?.focus({preventScroll:true});
      close();event.preventDefault();event.stopPropagation();
    }
  }, {capture:true});
  viewport.addEventListener('resize',position);
  function update(state=getState()) {
    lastState=state;
    const gold=state?.wallet?.gold;
    const goldHourly=state?.resources?.hourly?.gold??0;
    trigger.hidden=!Number.isSafeInteger(gold)||gold<0;
    trigger.querySelector('#gold-balance').textContent=format.format(gold ?? 0);
    const growth=trigger.querySelector('#gold-growth');
    if(growth){growth.textContent=`${goldHourly>0?'+':''}${format.format(goldHourly)}/h`;growth.classList.toggle('is-negative',goldHourly<0);}
    trigger.querySelector('[data-resource-slot="production"]').innerHTML=resourceAmountMarkup('production',currentCapacity(state,'production'));
    trigger.querySelector('[data-resource-slot="science"]').innerHTML=resourceAmountMarkup('science',currentCapacity(state,'science'));
    const oilSlot=trigger.querySelector('[data-resource-slot="oil"]');
    if(oilSlot)oilSlot.innerHTML=resourceAmountMarkup('oil',state?.resources?.balances?.oil??0);
    const fanSlot=trigger.querySelector('[data-resource-slot="fans"]');
    if(fanSlot)fanSlot.innerHTML=resourceAmountMarkup('fans',state?.resources?.balances?.fans??0);
    for(const button of buttons){
      const id=button.dataset.resourceTrigger, value=id==='gold'?gold:['fans','oil'].includes(id)?state?.resources?.balances?.[id]:currentCapacity(state,id);
      button.setAttribute('aria-label',`${RESOURCE_DEFINITIONS[id].name} ${format.format(value ?? 0)}${id==='gold'?`，每小时净变化 ${format.format(goldHourly)} 金币`:''}，${id==='oil'?'悬停查看收支，点击交易':'查看来源'}`);
    }
    trigger.removeAttribute('title');
    for(const node of trigger.querySelectorAll('[title]'))node.removeAttribute('title');
    if(trigger.hidden)close();else if(!windowRoot.hidden){render();position();}
  }
  return {update,open,close};
}
