import { ROLE_LABELS } from '../../shared/football/labels.js';
import { escapePlayerCardHtml as esc } from '../player-card/player-card.js';

export function benchFilterOptions(roster) {
  const unique = values => [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const roles = new Set(roster.flatMap(p=>[p.role,p.secondaryRole]).filter(Boolean));
  return {position:[...Object.keys(ROLE_LABELS).filter(role=>roles.has(role)),...unique([...roles].filter(role=>!ROLE_LABELS[role]))],
    club:unique(roster.map(p=>p.club)),nationality:unique(roster.map(p=>p.nationality))};
}
export function filterBenchPlayers(players, filters) {
  return players.filter(p=>(!filters.position || p.role===filters.position || p.secondaryRole===filters.position)
    && (!filters.club || p.club===filters.club) && (!filters.nationality || p.nationality===filters.nationality));
}
export function benchFiltersMarkup(options, filters, {open=false,shown=0,total=0}={}) {
  const labels={position:'具体位置',club:'俱乐部',nationality:'国家队'};
  return `<details class="league-bench-filters" data-bench-filters ${open?'open':''}><summary>筛选 <span>${shown} / ${total} 人</span></summary><div class="league-bench-filter-controls">${Object.entries(labels).map(([key,label])=>`<label><span>${label}</span><select data-bench-filter="${key}" aria-label="替补席${label}"><option value="">全部</option>${options[key].map(value=>`<option value="${esc(value)}" ${filters[key]===value?'selected':''}>${key==='position'?esc(value+' · '+(ROLE_LABELS[value]??value)):esc(value)}</option>`).join('')}</select></label>`).join('')}</div><div class="league-bench-filter-footer"><small>位置匹配主位置或副位置</small><button type="button" data-bench-filter-reset>清空筛选</button></div></details>`;
}
