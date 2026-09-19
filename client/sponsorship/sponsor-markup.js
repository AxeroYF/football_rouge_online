import { goldAmountMarkup } from '../ui/currency.js';
import { resourceIconMarkup } from '../resources/resource-markup.js?v=20260907-resource-hover-v1';
import { NEUTRAL_SPONSOR_REWARD } from '../../shared/config/sponsorship.mjs';
export const sponsorEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sponsorLogoMarkup(brand,{className=''}={}) {
 if(!brand)return '';
 const id=sponsorEscape(brand.id),src=sponsorEscape(brand.icon);
 return `<span class="sponsor-logo ${brand.surface==='dark'?'is-dark':''} ${className}" data-sponsor-brand="${id}"><img src="${src}" alt="${sponsorEscape(brand.name)}" draggable="false" decoding="async"></span>`;
}
export function sponsorRewardPreviewMarkup(){
 return `<div class="sponsor-reward-preview">${resourceIconMarkup('sponsorship',20)}<span>征服奖励 · ${Math.round(NEUTRAL_SPONSOR_REWARD.chance*100)}% 获得赞助合同</span></div>`;
}
export function sponsorRewardMarkup(offer){
 if(!offer)return '';
 return `<div class="sponsor-conquest-reward">${sponsorLogoMarkup(offer.sponsor)}<span><strong>${sponsorEscape(offer.sponsor?.name)} · ${sponsorEscape(offer.typeName)}</strong><span>${offer.durationDays} 天 · ${goldAmountMarkup(offer.hourlyGold)} /小时</span></span><button type="button" class="ui-button" data-open-sponsorship>查看合同</button></div>`;
}
export function broadcastSponsorMarkup(venue){
 const seen=new Set();
 const brands=(venue?.sponsors??[]).filter(s=>s?.id&&!seen.has(s.id)&&seen.add(s.id)).slice(0,3);
 if(!brands.length)return '';
 return `<aside class="broadcast-sponsor-boards" aria-label="主场普通赞助商">${brands.map(b=>`<div class="broadcast-sponsor-board" title="${sponsorEscape(b.name)}">${sponsorLogoMarkup(b)}</div>`).join('')}</aside>`;
}
