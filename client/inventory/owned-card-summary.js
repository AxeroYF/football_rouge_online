const key=card=>String(card.cardDefinitionId??card.card?.cardDefinitionId??card.id??card.playerId);
export function ownedCardLevels(roster=[]){const result=new Map();for(const card of roster){const id=key(card),level=Math.max(0,Number(card.upgradeLevel)||0);result.set(id,Math.max(result.get(id)??0,level));}return result;}
export function ownedCardText(card,levels){const id=key(card);return levels.has(id)?`已拥有 · 最高 +${levels.get(id)}`:'未拥有';}
