export const RESOURCE_VERSION = '20260908-world598-resources-v1';
export const RESOURCE_HOUR_MS = 3_600_000;
export const YIELD_RESOURCE_IDS = Object.freeze(['gold', 'production', 'science']);
export const RESOURCE_DEFINITIONS = Object.freeze({
 oil:Object.freeze({id:'oil',name:'石油',icon:'./assets/ui/resources/oil.svg',color:'#d7b15e',unit:'单位',description:'油井每小时开采，可累积、交易，用于远征队和球探移动。'}),
  gold: Object.freeze({ id: 'gold', name: '金币', icon: './assets/ui/gold-coin.svg', color: '#e7bd57', unit: '金币', description: '俱乐部资金，用于现有建设、球员和运营支出。' }),
  production: Object.freeze({ id: 'production', name: '生产力', icon: './assets/ui/resources/production.svg', color: '#edaa61', unit: '生产力', description: '当前建设能力，由领地产出合计。所有在建设施平均分配生产力；空闲时不积累。' }),
  science: Object.freeze({ id: 'science', name: '科技值', icon: './assets/ui/resources/science.svg', color: '#73cceb', unit: '科技值', description: '当前研究能力，由领地产出合计，决定科技研究的推进速度；空闲时不积累。' }),
  fans: Object.freeze({ id: 'fans', name: '球迷', icon: './assets/ui/resources/fans.svg', color: '#9fcf7f', unit: '人', description: '支持俱乐部的球迷群体，与俱乐部发展和主场经营相关。' }),
  sponsorship: Object.freeze({ id: 'sponsorship', name: '赞助商', icon: './assets/ui/resources/sponsorship.svg', color: '#bba3ee', unit: '份合同', description: '通过合同与俱乐部合作，提供约定的权益和收益。' }),
});
export const TERRAIN_LABELS = Object.freeze({ forest: '森林', mountain: '山脉', hills: '丘陵', plains: '平原', coastal: '沿海' });
// One design-budget point is 12 gold/hour, 1 production capacity, or 1 science capacity.
// This is a distribution weight, not a player exchange or construction price.
export const YIELD_BUDGET_WEIGHTS = Object.freeze({ gold: 12, production: 1, science: 1 });
export function resourceBudget(yields) { return YIELD_RESOURCE_IDS.reduce((sum, id) => sum + (yields?.[id] ?? 0) / YIELD_BUDGET_WEIGHTS[id], 0); }
export function validateTerritoryResources(catalog, index) {
  if (catalog?.schemaVersion !== 1 || !catalog.version || catalog.periodMs !== RESOURCE_HOUR_MS || !catalog.territories) throw new Error('地块资源配置版本无效');
  const ids = new Set(index.territories.map(t => t.territoryId));
  if (Object.keys(catalog.territories).length !== ids.size) throw new Error('地块资源配置数量不一致');
  for (const [id, profile] of Object.entries(catalog.territories)) {
    if (!ids.has(id) || !Array.isArray(profile.terrain) || !profile.terrain.length || profile.terrain.some(t => !Object.hasOwn(TERRAIN_LABELS, t))) throw new Error('地块资源分类无效：' + id);
    if (!profile.yields || Object.keys(profile.yields).some(key => !YIELD_RESOURCE_IDS.includes(key)) || YIELD_RESOURCE_IDS.some(key => !Number.isSafeInteger(profile.yields[key]) || profile.yields[key] < 0) || !YIELD_RESOURCE_IDS.some(key => profile.yields[key] > 0)) throw new Error('地块资源产量无效：' + id);
  }
  return catalog;
}
