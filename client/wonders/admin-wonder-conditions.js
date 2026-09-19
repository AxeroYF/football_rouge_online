const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const emptyConstruction = () => ({ totalProduction: null, adjacentBuildings: [], terrain: { anyOf: [], allOf: [] }, playerCollection: null });
export const copyConstruction = item => structuredClone(item.construction ?? emptyConstruction());
export const sameDraft = (draft, item) => draft.text === item.effectText && JSON.stringify(draft.construction) === JSON.stringify(item.construction ?? emptyConstruction());
export function constructionSummary(value, options) {
  const c = value ?? emptyConstruction(), names = (values, choices) => values.map(v => choices.find(o => o.value === v)?.label ?? v).join('、');
  const p = c.playerCollection;
  return [
    `生产力：${c.totalProduction ?? '待定'}`,
    `相邻建筑（全部）：${names(c.adjacentBuildings, options.buildings) || '不限'}`,
    `地形（任选一项）：${names(c.terrain.anyOf, options.terrain) || '不限'}；地形（全部）：${names(c.terrain.allOf, options.terrain) || '不限'}`,
    p ? `收集：${p.minDistinctPlayers} 名不同球员；国籍：${p.nationalities?.join('、') || '不限'}；俱乐部：${p.clubs?.join('、') || '不限'}；位置：${names(p.pools ?? [], options.pools) || '不限'}；至少 ${p.minNationalities ?? 1} 种国籍` : '球员收集：不限',
  ].join('\n');
}
export function constructionEditor(c, options, disabled, live = false) {
  const checks = (group, choices, values) => `<div class="wonder-checks">${choices.map(o => `<label><input type="checkbox" data-condition="${group}" value="${esc(o.value)}" ${values.includes(o.value) ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}</div>`;
  const p = c.playerCollection;
  return `<section class="wonder-requirements"><h3>建设要求</h3><p class="wonder-help">各类条件同时满足；不需要的条件留空。${live?"保存后用于新开工的奇观；已开工项目保留原条件。":"这里只暂存设计，不直接启用。"}</p>
    <fieldset ${disabled ? 'disabled' : ''}><label for="wonder-production">生产力总需求</label><input id="wonder-production" type="number" min="1" max="1000000000" step="1" value="${c.totalProduction ?? ''}" placeholder="待定"><p class="wonder-help">总工程量，沿用每点生产力每分钟推进 1 点的规则。</p>
    <h4>相邻建筑</h4>${checks('adjacent', options.buildings, c.adjacentBuildings)}<p class="wonder-help">需有已建成的己方陆地邻接设施；勾选多个时全部需要，全部不选则不限。</p>
    <h4>地形要求</h4><span class="wonder-field-caption">以下地形至少满足一项</span>${checks('terrain-any', options.terrain, c.terrain.anyOf)}<span class="wonder-field-caption">同时必须包含以下地形</span>${checks('terrain-all', options.terrain, c.terrain.allOf)}<p class="wonder-help">例如：上方选“丘陵、山脉”，下方选“森林”，即森林且为丘陵或山脉。两组都不选则不限。</p>
    <label class="wonder-collection-toggle"><input type="checkbox" id="wonder-collection-enabled" ${p ? 'checked' : ''}>设置球员收集要求</label>
    <fieldset class="wonder-collection-fields" ${!p ? 'disabled hidden' : ''}>
      <label>不同球员人数<input id="wonder-player-count" type="number" min="1" max="10000" step="1" required value="${p?.minDistinctPlayers ?? 1}"></label>
      <label>至少不同国籍数<input id="wonder-nationality-count" type="number" min="1" max="10000" step="1" value="${p?.minNationalities ?? ''}" placeholder="不限"></label>
      <label>球员国籍<input id="wonder-nationalities" list="wonder-nationality-options" value="${esc(p?.nationalities?.join('、') ?? '')}" placeholder="不限；例如葡萄牙、巴西"><datalist id="wonder-nationality-options">${options.nationalities.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist></label>
      <label>所属俱乐部<input id="wonder-clubs" list="wonder-club-options" value="${esc(p?.clubs?.join('、') ?? '')}" placeholder="不限；例如皇家马德里"><datalist id="wonder-club-options">${options.clubs.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist></label>
      <div class="wonder-pool-fields"><span class="wonder-field-caption">球员位置</span>${checks('pool', options.pools, p?.pools ?? [])}</div>
    </fieldset><p class="wonder-help">国籍、俱乐部可用顿号或逗号填写多个，同一项内满足一个即可；不同项同时满足。按持有的不同球员计数，重复卡不重复计数，也不消耗球员。</p></fieldset></section>`;
}
export function readConstruction(root) {
  const number = id => { const value = root.querySelector(id).value; return value === '' ? null : Number(value); };
  const checked = group => [...root.querySelectorAll(`[data-condition="${group}"]:checked`)].map(n => n.value).sort();
  const strings = id => [...new Set(root.querySelector(id).value.split(/[,，、;；\n]/).map(s => s.trim()).filter(Boolean))].sort();
  let playerCollection = null;
  if (root.querySelector('#wonder-collection-enabled').checked) {
    playerCollection = { minDistinctPlayers: number('#wonder-player-count') };
    for (const [key, values] of [['nationalities', strings('#wonder-nationalities')], ['clubs', strings('#wonder-clubs')], ['pools', checked('pool')]]) if (values.length) playerCollection[key] = values;
    const minNationalities = number('#wonder-nationality-count');
    if (minNationalities !== null) playerCollection.minNationalities = minNationalities;
  }
  return { totalProduction: number('#wonder-production'), adjacentBuildings: checked('adjacent'), terrain: { anyOf: checked('terrain-any'), allOf: checked('terrain-all') }, playerCollection };
}
