import { BUILDING_DEFINITIONS } from './buildings.mjs';

export const emptyWonderConstruction = () => ({ totalProduction: null, adjacentBuildings: [], terrain: { anyOf: [], allOf: [] }, playerCollection: null });
const terrain = [{ value: 'plains', label: '平原' }, { value: 'hills', label: '丘陵' }, { value: 'mountain', label: '山脉' }, { value: 'forest', label: '森林' }, { value: 'coastal', label: '沿海' }];
export function wonderRequirementOptions(players = [], proposals = {}) {
  const countries = Object.values(proposals).flatMap(p => p.construction?.playerCollection?.nationalities ?? []);
  const values = items => [...new Set(items.filter(Boolean))].sort((a,b) => a.localeCompare(b, 'zh-CN'));
  return {
    buildings: Object.values(BUILDING_DEFINITIONS).map(b => ({ value: b.type, label: b.label })), terrain,
    nationalities: values([...players.map(p => p.nationality), ...countries]),
    clubs: values(players.map(p => p.club)),
    pools: [{ value: 'GK', label: '门将' }, { value: 'DEF', label: '后卫' }, { value: 'MID', label: '中场' }, { value: 'ATT', label: '前锋' }],
  };
}
const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) invalid(label + '格式不正确');
}
function integer(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) invalid(label + `须为 1–${max} 的整数`);
  return value;
}
function list(value, choices, label) {
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || !choices.includes(v))) invalid(label + '包含无效选项');
  return [...new Set(value)].sort();
}
export function normalizeWonderConstruction(value, options) {
  object(value, ['totalProduction','adjacentBuildings','terrain','playerCollection'], '建设条件');
  object(value.terrain, ['anyOf','allOf'], '地形条件');
  const result = {
    totalProduction: value.totalProduction === null ? null : integer(value.totalProduction, 1000000000, '生产力总需求'),
    adjacentBuildings: list(value.adjacentBuildings, options.buildings.map(o => o.value), '相邻建筑'),
    terrain: { anyOf: list(value.terrain.anyOf, options.terrain.map(o => o.value), '任选地形'), allOf: list(value.terrain.allOf, options.terrain.map(o => o.value), '必需地形') },
    playerCollection: null,
  };
  if (value.playerCollection !== null) {
    const c = value.playerCollection;
    object(c, ['minDistinctPlayers','nationalities','clubs','pools','minNationalities'], '球员收集');
    const normalized = { minDistinctPlayers: integer(c.minDistinctPlayers, 10000, '球员人数') };
    for (const key of ['nationalities','clubs','pools']) {
      const values = list(c[key] ?? [], key === 'pools' ? options.pools.map(o => o.value) : options[key], { nationalities:'国籍',clubs:'俱乐部',pools:'位置' }[key]);
      if (values.length) normalized[key] = values;
    }
    if (c.minNationalities != null) {
      normalized.minNationalities = integer(c.minNationalities, normalized.minDistinctPlayers, '至少不同国籍数');
      if (normalized.nationalities && normalized.minNationalities > normalized.nationalities.length) invalid('不同国籍数不能超过所选国籍种类');
    }
    result.playerCollection = normalized;
  }
  return result;
}
