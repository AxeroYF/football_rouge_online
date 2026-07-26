import { REAL_PLAYER_BY_ID } from "./player-pool.js";

export const S4_ASSET_SCHEMA_VERSION = 1;
export const S4_ROSTER_LIMIT = 33;
export const S4_EXTERNAL_CARD_EXEMPT_LEVEL = 3;

const clone = (value) => structuredClone(value);
const isLegend = (playerId) => Boolean(REAL_PLAYER_BY_ID[playerId]?.legendAbility);
const activeCard = (card) => card && card.status !== "recycled";
const cardStrength = (card) => Number(card.upgradeLevel ?? 0) * 1000
  + Number(card.traitIds?.length ?? 0) * 10
  - Number(card.acquiredAt ?? 0) / 1e15;

function cardId(playerId, ownerId, now, sequence) {
  return `s4-card-${String(playerId).replace(/[^a-zA-Z0-9_-]/g, "")}-${String(ownerId).replace(/[^a-zA-Z0-9_-]/g, "")}-${Number(now).toString(36)}-${sequence.toString(36)}`;
}

function normalizeCard(card) {
  card.upgradeLevel = Math.max(0, Math.min(8, Math.floor(Number(card.upgradeLevel ?? 0))));
  card.traitIds = Array.isArray(card.traitIds) ? [...new Set(card.traitIds.map(String))] : [];
  card.acquisitionSource ??= "legacy-migration";
  card.externalAcquisition = Boolean(card.externalAcquisition);
  card.status ??= "active";
  card.createdAt ??= card.acquiredAt ?? Date.now();
  card.acquiredAt ??= card.createdAt;
  return card;
}

export function ensureS4Assets(state) {
  state.s4Assets ??= {
    schemaVersion:S4_ASSET_SCHEMA_VERSION,
    nextCardSequence:1,
    ownerships:{},
    cards:{},
    traitOffers:{},
    transactions:[],
  };
  const assets = state.s4Assets;
  assets.schemaVersion = S4_ASSET_SCHEMA_VERSION;
  assets.nextCardSequence = Math.max(1, Number(assets.nextCardSequence ?? 1));
  assets.ownerships ??= {};
  assets.cards ??= {};
  assets.traitOffers ??= {};
  assets.transactions ??= [];
  Object.values(assets.cards).forEach(normalizeCard);
  assertS4AssetInvariants(state);
  return assets;
}

export function cardsForOwner(state, ownerId, playerId = null) {
  return Object.values(state.s4Assets?.cards ?? {})
    .filter((card) => activeCard(card) && card.ownerId === ownerId && (!playerId || card.playerId === playerId))
    .sort((left, right) => cardStrength(right) - cardStrength(left) || String(left.id).localeCompare(String(right.id)));
}

export function cardsForPlayer(state, playerId) {
  return Object.values(state.s4Assets?.cards ?? {})
    .filter((card) => activeCard(card) && card.playerId === playerId)
    .sort((left, right) => cardStrength(right) - cardStrength(left) || String(left.id).localeCompare(String(right.id)));
}

export function representativeCard(state, ownerId, playerId) {
  return cardsForOwner(state, ownerId, playerId)[0] ?? null;
}

export function ownershipOwner(state, playerId) {
  return state.s4Assets?.ownerships?.[playerId] ?? null;
}

export function ownsPlayerRights(state, ownerId, playerId) {
  return isLegend(playerId) || ownershipOwner(state, playerId) === ownerId;
}

export function isRosterExemptCard(state, card) {
  if (!activeCard(card) || Number(card.upgradeLevel ?? 0) < S4_EXTERNAL_CARD_EXEMPT_LEVEL) return false;
  if (!card.externalAcquisition || !["market", "direct-trade"].includes(card.acquisitionSource)) return false;
  return ownershipOwner(state, card.playerId) !== card.ownerId;
}

export function rosterFamilyUsesSlot(state, ownerId, playerId) {
  const cards = cardsForOwner(state, ownerId, playerId);
  if (!cards.length) return false;
  if (ownershipOwner(state, playerId) === ownerId) return true;
  return cards.some((card) => !isRosterExemptCard(state, card));
}

export function rosterSlotUsage(state, ownerId) {
  const families = new Set(cardsForOwner(state, ownerId).map((card) => card.playerId));
  return [...families].filter((playerId) => rosterFamilyUsesSlot(state, ownerId, playerId)).length;
}

export function createS4Card(state, options) {
  const assets = state.s4Assets;
  if (!assets || !REAL_PLAYER_BY_ID[options.playerId]) throw new Error("无法创建未知球员卡");
  const sequence = assets.nextCardSequence++;
  const acquiredAt = Number(options.acquiredAt ?? Date.now());
  const card = normalizeCard({
    id:options.id ?? cardId(options.playerId, options.ownerId, acquiredAt, sequence),
    playerId:options.playerId,
    ownerId:options.ownerId,
    upgradeLevel:options.upgradeLevel ?? 0,
    traitIds:clone(options.traitIds ?? []),
    acquisitionSource:options.acquisitionSource ?? "system",
    externalAcquisition:Boolean(options.externalAcquisition),
    acquiredAt,
    createdAt:Number(options.createdAt ?? acquiredAt),
    status:"active",
  });
  if (assets.cards[card.id]) throw new Error("球员卡ID重复");
  assets.cards[card.id] = card;
  if (options.grantOwnership && !isLegend(card.playerId)) {
    const current = ownershipOwner(state, card.playerId);
    if (current && current !== card.ownerId) throw new Error("该非传奇球员所有权已属于其他玩家");
    assets.ownerships[card.playerId] = card.ownerId;
  }
  return card;
}

export function transferS4Card(state, cardIdValue, buyerId, source = "market", acquiredAt = Date.now()) {
  const card = state.s4Assets?.cards?.[String(cardIdValue)];
  if (!activeCard(card)) throw new Error("球员卡不存在或已被回收");
  if (card.ownerId === buyerId) throw new Error("不能把球员卡转移给当前持有人");
  card.previousOwnerId = card.ownerId;
  card.ownerId = buyerId;
  card.acquisitionSource = source;
  card.externalAcquisition = true;
  card.acquiredAt = Number(acquiredAt);
  return card;
}

export function recycleS4Card(state, cardIdValue, reason, now = Date.now()) {
  const card = state.s4Assets?.cards?.[String(cardIdValue)];
  if (!activeCard(card)) throw new Error("球员卡不存在或已被回收");
  card.status = "recycled";
  card.recycledAt = now;
  card.recycleReason = reason;
  return card;
}

export function transferPlayerOwnership(state, playerId, fromOwnerId, toOwnerId) {
  if (isLegend(playerId)) throw new Error("传奇球员不使用唯一所有权");
  if (ownershipOwner(state, playerId) !== fromOwnerId) throw new Error("卖家不拥有该球员所有权");
  if (!cardsForOwner(state, toOwnerId, playerId).length) throw new Error("新所有者必须至少持有一张该球员卡");
  state.s4Assets.ownerships[playerId] = toOwnerId;
  return toOwnerId;
}

export function returnPlayerOwnershipToSystem(state, playerId, ownerId) {
  if (ownershipOwner(state, playerId) !== ownerId) throw new Error("你不拥有该球员所有权");
  delete state.s4Assets.ownerships[playerId];
}

export function recordS4AssetTransaction(state, transaction) {
  const entry = {
    id:transaction.id,
    type:transaction.type,
    playerId:transaction.playerId,
    cardIds:clone(transaction.cardIds ?? []),
    fromOwnerId:transaction.fromOwnerId ?? null,
    toOwnerId:transaction.toOwnerId ?? null,
    amount:Number(transaction.amount ?? 0),
    metadata:clone(transaction.metadata ?? {}),
    createdAt:Number(transaction.createdAt ?? Date.now()),
  };
  state.s4Assets.transactions.push(entry);
  state.s4Assets.transactions = state.s4Assets.transactions.slice(-5000);
  return entry;
}

export function assertS4AssetInvariants(state) {
  const assets = state.s4Assets;
  if (!assets) throw new Error("S4资产结构不存在");
  for (const [playerId, ownerId] of Object.entries(assets.ownerships)) {
    if (!REAL_PLAYER_BY_ID[playerId]) throw new Error(`所有权引用未知球员：${playerId}`);
    if (isLegend(playerId)) throw new Error(`传奇球员不能登记唯一所有权：${playerId}`);
    if (!cardsForOwner(state, ownerId, playerId).length) throw new Error(`球员所有权缺少锚点卡：${playerId}`);
  }
  for (const card of Object.values(assets.cards)) {
    if (!REAL_PLAYER_BY_ID[card.playerId]) throw new Error(`球员卡引用未知球员：${card.playerId}`);
    if (!card.ownerId) throw new Error(`球员卡缺少持有人：${card.id}`);
    if (Number(card.upgradeLevel) < 0 || Number(card.upgradeLevel) > 8) throw new Error(`球员卡强化等级无效：${card.id}`);
  }
  if (state.ruleset === "S4") {
    const teamsByOwner = new Map((state.teams ?? []).filter((team) => team.ownerId).map((team) => [team.ownerId, team]));
    for (const [playerId, ownerId] of Object.entries(assets.ownerships)) {
      if (!teamsByOwner.has(ownerId)) throw new Error(`球员所有权持有人没有S4球队：${playerId}`);
    }
    for (const card of Object.values(assets.cards).filter(activeCard)) {
      if (!teamsByOwner.has(card.ownerId)) throw new Error(`球员卡持有人没有S4球队：${card.id}`);
    }
    for (const [ownerId, team] of teamsByOwner) {
      const cardFamilies = new Set(cardsForOwner(state, ownerId).map((card) => card.playerId));
      const rosterFamilies = new Set(team.rosterIds ?? []);
      if (cardFamilies.size !== rosterFamilies.size || [...cardFamilies].some((playerId) => !rosterFamilies.has(playerId))) {
        throw new Error(`球队名单与S4球员卡资产不一致：${team.id}`);
      }
      if (rosterSlotUsage(state, ownerId) > S4_ROSTER_LIMIT) throw new Error(`球队超过${S4_ROSTER_LIMIT}人大名单额度：${team.id}`);
    }
  }
  return true;
}

export function publicS4Card(state, card) {
  return {
    id:card.id,
    playerId:card.playerId,
    upgradeLevel:Number(card.upgradeLevel ?? 0),
    traitIds:clone(card.traitIds ?? []),
    acquisitionSource:card.acquisitionSource,
    externalAcquisition:Boolean(card.externalAcquisition),
    rosterExempt:isRosterExemptCard(state, card),
    status:card.status,
    acquiredAt:card.acquiredAt,
  };
}

export function publicS4AssetsForOwner(state, ownerId) {
  const cards = cardsForOwner(state, ownerId);
  const ownershipPlayerIds = Object.entries(state.s4Assets.ownerships)
    .filter(([, candidateOwnerId]) => candidateOwnerId === ownerId)
    .map(([playerId]) => playerId);
  return {
    rosterLimit:S4_ROSTER_LIMIT,
    rosterSlotsUsed:rosterSlotUsage(state, ownerId),
    ownershipPlayerIds,
    cards:cards.map((card) => publicS4Card(state, card)),
  };
}
