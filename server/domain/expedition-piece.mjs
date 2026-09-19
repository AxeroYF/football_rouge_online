import { canUseTerritory } from '../../shared/config/diplomacy.mjs';
import { expeditionArtIcon, expeditionStyle, isExpeditionStyle } from '../../shared/config/expedition-art.mjs';
export const EXPEDITION_TOKEN_ID = "default";
export const EXPEDITION_TOKEN_URL = expeditionArtIcon(EXPEDITION_TOKEN_ID);
export const EXPEDITION_MIN_MOVE_MS = 60_000;
export const EXPEDITION_MAX_MOVE_MS = 600_000;

function ownedTerritoryIds(account, world) {
  return world?.players?.[account?.id]?.territoryIds ?? [];
}

function fallbackTerritoryId(account, world) {
  const owned = ownedTerritoryIds(account, world);
  const preferred = account?.homeTerritoryId ?? world?.players?.[account?.id]?.capitalTerritoryId;
  return owned.includes(preferred) ? preferred : owned[0] ?? null;
}

function centroid(index, territoryId) {
  const territory = index?.territories?.find((entry) => entry.territoryId === territoryId);
  const point = territory?.centroid;
  if (!Array.isArray(point) || point.length !== 2 || !point.every((value) => Number.isFinite(Number(value)))) {
    throw new Error("地块缺少有效的中心坐标");
  }
  return point.map(Number);
}

function haversineDistanceKm([leftLng, leftLat], [rightLng, rightLat]) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(rightLat - leftLat);
  const longitudeDelta = radians(rightLng - leftLng);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function expeditionMoveDuration(distanceKmValue) {
  const distanceKm = Math.max(0, Number(distanceKmValue) || 0);
  const minutes = Math.max(1, Math.min(10, Math.ceil(distanceKm / 250)));
  return minutes * 60_000;
}

export function normalizeExpeditionPiece(account, world, now = Date.now()) {
  if (!account || !world) return { changed: false, piece: null };
  const owned = ownedTerritoryIds(account, world);
  if (!account.homeTerritoryId || !owned.length) {
    const changed = account.expeditionPiece !== null && account.expeditionPiece !== undefined;
    account.expeditionPiece = null;
    return { changed, piece: null };
  }
  let changed = false;
  let piece = account.expeditionPiece;
  if (!piece || piece.schemaVersion !== 1) {
    piece = { schemaVersion: 1, tokenId: EXPEDITION_TOKEN_ID, territoryId: fallbackTerritoryId(account, world), movement: null };
    changed = true;
  }
  if (!isExpeditionStyle(piece.tokenId)) {
    piece.tokenId = EXPEDITION_TOKEN_ID;
    changed = true;
  }
  // Old footballer selections migrate to the matching vehicle without moving it.
  if (piece.tokenId !== 'default' && piece.tokenId !== expeditionStyle(piece.tokenId).id) {
    piece.tokenId=expeditionStyle(piece.tokenId).id;changed=true;
  }
  if(piece.movement?.transport==='airport'){account.expeditionPiece=piece;return {changed,piece};}
  if(piece.movement&&!canUseTerritory(world,account.id,piece.movement.toTerritoryId)){piece.movement=null;changed=true;}
  if (piece.movement && Number(piece.movement.arrivesAt) <= Number(now)) {
    piece.territoryId = canUseTerritory(world,account.id,piece.movement.toTerritoryId)
      ? piece.movement.toTerritoryId
      : fallbackTerritoryId(account, world);
    piece.movement = null;
    changed = true;
  }
  if (!canUseTerritory(world,account.id,piece.territoryId)) {
    piece.territoryId = fallbackTerritoryId(account, world);
    piece.movement = null;
    changed = true;
  }
  account.expeditionPiece = piece;
  return { changed, piece };
}

export function publicExpeditionPiece(account, world, now = Date.now()) {
  const { piece } = normalizeExpeditionPiece(account, world, now);
  if (!piece) return null;
  const movement = piece.movement ? {
    ...piece.movement,
    remainingMs: Math.max(0, Number(piece.movement.arrivesAt) - Number(now)),
  } : null;
  return {
    schemaVersion: 1,
    tokenId: piece.tokenId,
    styleId: expeditionStyle(piece.tokenId).id,
    styleName: expeditionStyle(piece.tokenId).name,
    tokenUrl: expeditionArtIcon(piece.tokenId),
    territoryId: piece.territoryId,
    moving: Boolean(movement),
    movement,
  };
}

export function expeditionAttackSource(account, world, now = Date.now()) {
  const { piece } = normalizeExpeditionPiece(account, world, now);
  if (!piece?.territoryId) throw new Error("远征战棋尚未部署");
  if (piece.movement) {
    throw Object.assign(new Error("远征队正在行军，抵达后才能发起进攻"), { statusCode: 409 });
  }
  return piece.territoryId;
}

export function territoryTravelEstimate(territoryIndex, sourceTerritoryId, targetTerritoryId) {
  const distanceKm = haversineDistanceKm(centroid(territoryIndex, sourceTerritoryId), centroid(territoryIndex, targetTerritoryId));
  return { fromTerritoryId:sourceTerritoryId, toTerritoryId:targetTerritoryId, distanceKm, durationMs:expeditionMoveDuration(distanceKm) };
}

export function estimateExpeditionMove({ account, world, territoryIndex, targetTerritoryId, now = Date.now() }) {
  const sourceTerritoryId = expeditionAttackSource(account, world, now);
  const target = String(targetTerritoryId ?? "");
  if (!canUseTerritory(world,account.id,target)) {
    throw new Error("远征战棋只能移动到自己或盟友的领土");
  }
  if (target === sourceTerritoryId) throw new Error("远征队已经驻扎在该地块");
  return territoryTravelEstimate(territoryIndex, sourceTerritoryId, target);
}

export function moveExpeditionPiece({ account, world, territoryIndex, targetTerritoryId, now = Date.now() }) {
  const estimate = estimateExpeditionMove({ account,world,territoryIndex,targetTerritoryId,now });
  account.expeditionPiece.movement = {
    ...estimate,
    startedAt: Number(now),
    arrivesAt: Number(now) + estimate.durationMs,
  };
  return publicExpeditionPiece(account, world, now);
}

export function cancelExpeditionMovement(account, world, now = Date.now()) {
  const { piece } = normalizeExpeditionPiece(account,world,now);
  if (!piece?.movement) {
    throw Object.assign(new Error("远征队当前没有移动任务"),{statusCode:409});
  }
  const canceledMovement={...piece.movement,canceledAt:Number(now)};
  piece.territoryId=piece.movement.fromTerritoryId;
  piece.movement=null;
  return {piece:publicExpeditionPiece(account,world,now),canceledMovement};
}

export function selectExpeditionStyle(account, world, tokenId, now = Date.now()) {
  if (typeof tokenId !== "string" || !isExpeditionStyle(tokenId)) throw Object.assign(new Error("未知的远征单位外观"), {statusCode:400});
  const {piece}=normalizeExpeditionPiece(account,world,now);
  if (!piece) throw Object.assign(new Error("请先完成建队并建立总部"), {statusCode:409});
  piece.tokenId=expeditionStyle(tokenId).id;
  return publicExpeditionPiece(account,world,now);
}

export function placeExpeditionPiece(account, territoryId) {
  if (!account) return;
  account.expeditionPiece = {
    schemaVersion: 1,
    tokenId: isExpeditionStyle(account.expeditionPiece?.tokenId) ? account.expeditionPiece.tokenId : EXPEDITION_TOKEN_ID,
    territoryId: String(territoryId),
    movement: null,
  };
}
