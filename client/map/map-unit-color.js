export function mapUnitColor(value){return /^#[0-9a-f]{6}$/i.test(value??'')?value:'#4fa86d';}
export function compactUnitBadge(map){return map.getZoom()<Math.max(6,(map.getMinZoom?.()??3)+.3);}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function unitTeamBadge({color,kind='expedition',ownerName='',own=false,compact=false}={}){
 const label=kind==='scout'?'球探':'远征队';
 const symbol=kind==='scout'
  ? '<path d="M7 5h3v7H5l2-7Zm7 0h3l2 7h-5V5ZM10 8h4"/><circle cx="6.5" cy="14.5" r="3.5"/><circle cx="17.5" cy="14.5" r="3.5"/>'
  : '<path d="m5 10 7-6 7 6M5 17l7-6 7 6"/>';
 return `<span class="map-unit-team-badge${compact?' is-compact':''}${own?' is-own':''}" style="--unit-color:${mapUnitColor(color)}" data-unit-kind="${kind==='scout'?'scout':'expedition'}" aria-hidden="true"><span class="map-unit-team-shield"><svg viewBox="0 0 30 36" focusable="false"><path class="map-unit-team-field" d="M2 2h26v20c0 6-9 11-13 12C11 33 2 28 2 22Z"/><g transform="translate(3 5)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${symbol}</g></svg></span>${own?'<span class="map-unit-team-self">我</span>':''}<span class="map-unit-team-name">${esc(ownerName||'未知球队')} · ${label}</span></span>`;
}
