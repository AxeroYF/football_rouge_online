import { createS4BondCatalog } from '../../engine/s4-v2.1/versus/public/bond-rules.js';
const cache=new WeakMap();
export function campaignBondCatalog(players){
 if(!Array.isArray(players))return [];
 if(!cache.has(players)){
  const definitions=[...new Map(players.filter(p=>!p.isX&&!p.xPlayer).map(p=>[p.cardDefinitionId??p.id,p])).values()];
  cache.set(players,createS4BondCatalog(definitions));
 }
 return cache.get(players);
}
