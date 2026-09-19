import {activeOilExtractor} from '../../shared/buildings/oil-extraction.mjs';
import {oilDeposit} from '../../shared/config/oil-deposits.mjs';
import { RESOURCE_DEFINITIONS, TERRAIN_LABELS, YIELD_RESOURCE_IDS } from '../../shared/config/resources.mjs';
import { goldAmountMarkup } from '../ui/currency.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatter = new Intl.NumberFormat('zh-CN');
export function resourceIconMarkup(id, size = 24) {
  const definition = RESOURCE_DEFINITIONS[id]; if (!definition) return '';
  const url = new URL('../../' + definition.icon.replace(/^\.\//, ''), import.meta.url).href;
  return `<img class="resource-icon" src="${url}?v=20260912-resource-barrel-v2" width="${size}" height="${size}" alt="" aria-hidden="true" draggable="false">`;
}
export function resourceAmountMarkup(id, amount, { signed = false, showName = false } = {}) {
  const d=RESOURCE_DEFINITIONS[id]; if(!d)return '';
  const text=Number.isFinite(amount) ? `${signed && amount > 0 ? '+' : ''}${formatter.format(amount)}` : '—';
  const content = id === 'gold' ? goldAmountMarkup(amount, {signed}) : `${resourceIconMarkup(id)}<b>${text}</b>`;
  return `<span class="resource-amount" data-resource="${id}" title="${esc(d.name)} ${text}">${content}${showName ? `<span class="resource-name">${d.name}</span>` : ''}</span>`;
}
export function territoryOilMarkup(profile,{compact=false}={}){
 if(!profile||!Object.hasOwn(profile,'oilDeposit'))return '';
 if(!profile.oilDeposit)return '<small class="territory-no-oil">战略资源：无石油</small>';
 return `<div class="territory-oil-info" data-territory-oil="present">${resourceIconMarkup('oil',22)}<span><b>战略资源：石油</b><small>${profile.oilWellActive?(profile.oilExtractorKind==='wonder'?'奇观油田 · 每小时 +3 石油':'油井已建成 · 每小时 +3 石油'):'含石油资源 · 修建油井后每小时 +3 石油'}${compact||profile.oilExtractorKind==='wonder'?'':' · 油井单等级，不可升级'}</small></span></div>`;
}
export function territoryResourceMarkup(profile, { compact = false } = {}) {
  if (!profile?.yields) return territoryOilMarkup(profile,{compact});
  const terrain=(profile.terrain ?? []).map(id=>TERRAIN_LABELS[id]).filter(Boolean).join(' · ');
  return `<div class="territory-resource-block ${compact ? 'is-compact' : ''}"><div class="territory-resource-heading"><span>${esc(terrain)}</span><small>${profile.fanRequirement?'实际产出':'地块产出'}</small></div><div class="territory-yield-list">${YIELD_RESOURCE_IDS.filter(id=>(profile.baseYields??profile.yields)[id]>0).map(id=>resourceAmountMarkup(id,profile.yields[id],{signed:true,showName:!compact})).join('')}</div>${(profile.districtYields??[]).map(d=>`<div class="territory-fan-usage">${esc(d.name)} LV${d.level}：${d.operating?'基础贡献 +'+formatter.format(d.fullYield*(profile.fanRequirement?profile.fans/profile.fanRequirement:1))+' '+esc(d.resourceName)+'（满产 '+d.fullYield+'，奇观另计）':'同类产出仅取最高，此处暂停产出'}</div>`).join('')}${profile.shopGoldFull?`<div class="territory-fan-usage">其中商店 LV${profile.shopLevel}：${formatter.format(profile.shopGold??0)} 金币/小时（满产 ${formatter.format(profile.shopGoldFull)}）</div>`:''}${profile.fanRequirement?`<div class="territory-fan-usage">${resourceIconMarkup('fans',18)} ${formatter.format(profile.fans)} / ${formatter.format(profile.fanRequirement)} · 利用率 ${formatter.format(profile.fans/profile.fanRequirement*100)}%</div>`:''}${territoryOilMarkup(profile,{compact})}</div>`;
}

export function territoryResourceProfile(metadata, state) {
  const source=state?.resources?.sources?.find(s=>s.type==='territory'&&s.territoryId===metadata?.territoryId);
  if(!metadata)return undefined;
  const oil=oilDeposit(metadata.territoryId),buildings=state?.world?.territories?.[metadata.territoryId]?.buildings??[];
  const extractor=oil?activeOilExtractor(buildings):null;
  return {...metadata.resources,...source,oilDeposit:oil,oilWellActive:Boolean(extractor),oilExtractorKind:extractor?(extractor.type==='oil-well'?'oil-well':'wonder'):null};
}
