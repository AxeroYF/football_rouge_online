import crypto from "node:crypto";
import { offlineDisplayAttributeValue } from "../../engine/s4-v2.1/versus/offline-attribute-settings.js";

export function createPlayerCardInstance(source, upgradeLevel = 0) {
  const player = structuredClone(source);
  const id = `player-card:${crypto.randomUUID()}`;
  // S4 +1/+2/+3 add 1/2/3 ability points. Fusion itself is not enabled here.
  const bonus = Math.max(0, Math.min(3, Math.floor(Number(upgradeLevel) || 0)));
  const attributes = Object.fromEntries(Object.entries(player.attributes ?? {}).map(([key, value]) => [
    key, Number.isFinite(value) ? offlineDisplayAttributeValue(value + bonus) : value,
  ]));
  delete player.card;
  return {
    ...player, id, playerId: id, cardInstanceId: id,
    cardDefinitionId: source.cardDefinitionId ?? source.id,
    baseOverall: Number(source.overall), overall: Number(source.overall) + bonus,
    effectiveOverall: Number(source.overall) + bonus,
    attributes, effectiveAttributes: { ...attributes },
    referenceAttributes: { ...(source.referenceAttributes ?? source.attributes) },
    upgradeLevel: bonus, upgradeBonus: bonus,
    acquisitionSource: "scouting",
  };
}
